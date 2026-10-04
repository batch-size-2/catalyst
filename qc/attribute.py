"""Batch attribution and baseline distance (PLAN_v4 §3.15-3.16). Owned by the ML engineer.

Answers two questions, kept apart from the QC verdict in qc/decide.py:

  1. Which known batch does an unseen image look like? A standardised, L2-regularised multinomial
     logistic regression on the per-image features from qc/features.py (material families only by
     default). The optional deep_ family (qc/deep.py, pretrained DINOv2) is first reduced to
     DEEP_COMPONENTS principal components fit on the training rows (see Reducer); reasons then name
     deep_pcNN. Evaluated with leave-one-strip-out CV, a permutation null over strip segments and a
     shared-strip check. The fitted coefficients are saved as JSON so every prediction is auditable.
  2. Is it inside the baseline's (Batch_3) distribution at all? Two-sided z-scores per feature against
     the baseline strip segments, a root-mean-square z distance, and an `outside_baseline` flag
     calibrated on the baseline's own leave-one-strip-out distances.

Every image is always assigned to a batch (the task designer's rule, PLAN_v4 Rule 11): a weak call
is reported as a weak call, never as a non-answer. What says how weak:

  - `stage_baseline` and `stage_variation`: "different from the baseline?" and "in what way?", each
    with its own confidence, so "surely not Batch_3, weak lean to Batch_2" is a legitimate answer.
    The bet follows them: the baseline if it is at least as likely as not, else the leading variation.
    Each carries its held-out `record`; a stage that does not beat guessing is `established: false`,
    gets a `note`, and every option it cannot tell apart stays in the prediction set (docs/experiments/T18.md);
  - "baseline or not" is calibrated with Venn-Abers on the model's own out-of-fold (strip-held-out)
    probabilities (docs/experiments/T14.md): a probability and the `interval` those points allow;
  - `confidence`: the calibrated probability of the predicted batch; `confidence_tier` high / medium /
    low with `confidence_record`, how often held-out calls in that tier were right;
  - `prediction_set`: the batches that contain the truth at rate 1 - CONFORMAL_ALPHA (conformal on
    the held-out probabilities; loose at this sample size, shown beside the bet);
  - `unfamiliar`: the image is outside the range of the batch it was assigned to.

A staged model (`staged=(families_1, families_2)`, CLI `--staged a,b:c`) fits "baseline or not" and
"which variation" as two logistic regressions on different families and multiplies them.

Reasons carry a plain-language `text`: named features are stated against the baseline in SD; a
deep_pcNN component is translated into the named material features it moves with on the training set.
`explain.importance` says which inputs each stage leans on over all training images.

Rule 2 of PLAN_v4 allows a classifier on batch labels for this track
only: the accept/reject verdict is still the statistical comparison in qc/decide.py.

Usage:
  uv run python -m qc.attribute --evaluate [--families reg,tex,...]   # out/attribution/evaluation.json
  uv run python -m qc.attribute --fit [--families deep | --staged tex:deep]   # config/attribution_model.json
  uv run python -m qc.attribute --dry-run [--repeats 30] [--seed 0]    # hold out 3 images per batch, refit, predict
  uv run python -m qc.attribute --images data/<drop> [--balanced 3]    # out/attribution/<drop>.json
"""

import json
import time
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from scipy.stats import binom
import yaml
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

from qc.features import ALL_FAMILIES, DEEP_FAMILY, FAMILIES, MATERIAL_FAMILIES, assert_no_leakage, describe, family_of, feature_columns, load_features
from qc.schema import ATTRIBUTION_DIR, ATTRIBUTION_MODEL_PATH, attribution_path, load_config

C_GRID = (0.01, 0.03, 0.1, 0.3, 1.0)
N_PERMUTATIONS = 200
MIN_FRACTION_FINITE = 0.8     # features with fewer finite values are dropped before fitting
UNFAMILIAR_QUANTILE = 1.0     # flag threshold = this quantile of a batch's own held-out distances
Z_FLAG = 2.0                  # |z| beyond which a feature is listed as deviating from the baseline
N_REASONS = 5
DEEP_COMPONENTS = 10          # deep_ columns are replaced by this many principal components
TIERS = (("high", 0.75), ("medium", 0.5), ("low", 0.0))   # confidence tier = first whose minimum is reached
CONFORMAL_ALPHA = 0.2         # prediction sets aim to contain the true batch in 1 - alpha of images
TRANSLATE_MIN_R = 0.5         # a deep component is "explained by" named features with |r| at least this
TRANSLATE_TOP = 3
IMPORTANCE_TOP = 8            # features listed per stage in explain.importance
SD_SAME = 0.5                 # |z| below this reads "about the same as the baseline"
ESTABLISHED_P = 0.05          # a stage is "established" when its held-out record beats a coin flip at this one-sided binomial p
DICTIONARY_PATH = Path("config/kpi_dictionary.yaml")
IMAGING_FAMILY = "img"        # acquisition, not material: never a model input, but named when an image pattern tracks it


# ---------------------------------------------------------------- groups and matrices

def strip_group(strip_id) -> str:
    """The physical strip: strip_id without the XResolution suffix (same rule as types.fit_types)."""
    return str(strip_id).split("_")[0]


def segments_of(df: pd.DataFrame) -> pd.Series:
    """(batch, strip) segment label per row: the unit for permutations (PLAN_v4 §3.5)."""
    return df["batch"].astype(str) + "|" + df["strip_id"].map(strip_group)


def usable_features(df: pd.DataFrame, families=MATERIAL_FAMILIES) -> list[str]:
    cols = feature_columns(df, families)
    assert_no_leakage(cols)
    keep = []
    for c in cols:
        v = pd.to_numeric(df[c], errors="coerce")
        if v.notna().mean() >= MIN_FRACTION_FINITE and v.std(skipna=True) > 0:
            keep.append(c)
    return keep


def _matrix(df: pd.DataFrame, features: list[str]) -> np.ndarray:
    return df[features].apply(pd.to_numeric, errors="coerce").to_numpy(float)


class Standardiser:
    """Column mean/SD from the training rows; NaN -> training mean (zero after scaling)."""

    def __init__(self, X: np.ndarray):
        self.mean = np.nanmean(X, axis=0)
        sd = np.nanstd(X, axis=0, ddof=1)
        self.sd = np.where(np.isfinite(sd) & (sd > 0), sd, 1.0)

    def __call__(self, X: np.ndarray) -> np.ndarray:
        Z = (X - self.mean) / self.sd
        return np.nan_to_num(Z, nan=0.0, posinf=0.0, neginf=0.0)


class Reducer:
    """Replaces the deep_ columns by their first DEEP_COMPONENTS principal components, fit on the
    training rows after standardising; every other column passes through unchanged."""

    def __init__(self, X: np.ndarray | None, features: list[str], k: int = DEEP_COMPONENTS):
        self.features = list(features)
        self.deep = np.array([f.startswith(f"{DEEP_FAMILY}_") for f in self.features], bool)
        self.std, self.components = None, None
        if X is not None and self.deep.any():
            self.std = Standardiser(X[:, self.deep])
            Z = self.std(X[:, self.deep])
            k = max(1, min(k, len(Z) - 1, Z.shape[1]))
            _, _, vt = np.linalg.svd(Z - Z.mean(axis=0), full_matrices=False)
            self.components = vt[:k] * np.sign(vt[:k, [0]] + 1e-12)  # deterministic sign

    @property
    def names(self) -> list[str]:
        kept = [f for f, d in zip(self.features, self.deep) if not d]
        n = 0 if self.components is None else len(self.components)
        return kept + [f"{DEEP_FAMILY}_pc{i + 1:02d}" for i in range(n)]

    def __call__(self, X: np.ndarray) -> np.ndarray:
        if self.components is None:
            return X[:, ~self.deep]
        return np.hstack([X[:, ~self.deep], self.std(X[:, self.deep]) @ self.components.T])

    def to_json(self) -> dict | None:
        if self.components is None:
            return None
        return {"mean": self.std.mean.tolist(), "sd": self.std.sd.tolist(), "components": self.components.tolist()}

    @classmethod
    def from_json(cls, features: list[str], d: dict | None) -> "Reducer":
        r = cls(None, features)
        if d:
            r.std = Standardiser.__new__(Standardiser)
            r.std.mean, r.std.sd = np.asarray(d["mean"]), np.asarray(d["sd"])
            r.components = np.asarray(d["components"])
        return r


def _fit_lr(Z: np.ndarray, y: np.ndarray, C: float, seed: int = 0) -> LogisticRegression:
    return LogisticRegression(C=C, class_weight="balanced", max_iter=5000, random_state=seed).fit(Z, y)


def balanced_accuracy(y_true, y_pred) -> float:
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    per_class = [np.mean(y_pred[y_true == c] == c) for c in np.unique(y_true)]
    return float(np.mean(per_class))


def confusion(y_true, y_pred, classes) -> dict[str, dict[str, int]]:
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    return {a: {b: int(((y_true == a) & (y_pred == b)).sum()) for b in classes} for a in classes}


# ---------------------------------------------------------------- evaluation

def _choose_c(Z: np.ndarray, y: np.ndarray, groups: np.ndarray, grid=C_GRID, seed: int = 0) -> float:
    """Inner leave-one-strip-out over the C grid; ties go to the strongest regularisation."""
    if len(np.unique(groups)) < 3 or len(np.unique(y)) < 2:
        return grid[0]
    best, best_c = -1.0, grid[0]
    for C in grid:
        pred = _loso_predict(Z, y, groups, C, seed)
        acc = balanced_accuracy(y, pred)
        if acc > best + 1e-9:
            best, best_c = acc, C
    return best_c


def _loso_predict(Z, y, groups, C, seed=0, proba=False):
    pred = np.empty(len(y), dtype=object)
    probs = np.full((len(y), len(np.unique(y))), np.nan)
    classes = np.unique(y)
    for g in np.unique(groups):
        test = groups == g
        if len(np.unique(y[~test])) < 2:
            pred[test] = classes[0]
            continue
        model = _fit_lr(Z[~test], y[~test], C, seed)
        pred[test] = model.predict(Z[test])
        p = model.predict_proba(Z[test])
        for j, c in enumerate(model.classes_):
            probs[test, list(classes).index(c)] = p[:, j]
    return (pred, probs, classes) if proba else pred


def _fit_part(df: pd.DataFrame, y: np.ndarray, groups: np.ndarray, features: list[str], seed: int = 0, nested: bool = True, C: float | None = None) -> dict:
    """One logistic regression as plain data: reducer, scaler, coefficients. A single class fits nothing."""
    X = _matrix(df, features)
    red = Reducer(X, features)
    Xr = red(X)
    std = Standardiser(Xr)
    part = {"features": list(features), "model_features": red.names, "reducer": red.to_json(), "classes": sorted(map(str, np.unique(y))), "C": None, "mean": std.mean, "sd": std.sd}
    if len(part["classes"]) < 2:
        return part | {"coef": np.zeros((1, Xr.shape[1])), "intercept": np.zeros(1)}
    Z = std(Xr)
    C = C or (_choose_c(Z, y, groups, seed=seed) if nested else C_GRID[2])
    lr = _fit_lr(Z, y, C, seed)
    return part | {"classes": [str(c) for c in lr.classes_], "C": C, "coef": lr.coef_, "intercept": lr.intercept_}


def _eval_part(part: dict, feats: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(probabilities per part class, standardised features Z, coefficients per class, reduced features)."""
    features = part["features"]
    Xr = Reducer.from_json(features, part.get("reducer"))(feats.reindex(columns=features).apply(pd.to_numeric, errors="coerce").to_numpy(float))
    Z = np.nan_to_num((Xr - np.asarray(part["mean"], float)) / np.asarray(part["sd"], float), nan=0.0, posinf=0.0, neginf=0.0)
    coef, intercept = np.asarray(part["coef"], float), np.asarray(part["intercept"], float)
    if len(part["classes"]) < 2:
        return np.ones((len(feats), 1)), Z, np.zeros((1, Z.shape[1])), Xr
    logits = Z @ coef.T + intercept
    if coef.shape[0] == 1:  # binary: sklearn stores one row for classes[1]
        logits = np.column_stack([-logits[:, 0], logits[:, 0]])
        coef = np.vstack([-coef, coef])
    probs = np.exp(logits - logits.max(axis=1, keepdims=True))
    return probs / probs.sum(axis=1, keepdims=True), Z, coef, Xr


def other_label(baseline: str) -> str:
    return f"not {baseline}"


def _stage_features(df: pd.DataFrame, families, staged) -> list[str] | tuple[list[str], list[str]]:
    return (usable_features(df, staged[0]), usable_features(df, staged[1])) if staged else usable_features(df, families)


def _fit_parts(df: pd.DataFrame, features, baseline: str | None, seed: int = 0, nested: bool = True, C: float | None = None) -> dict[str, dict]:
    """{"all": part} for one three-way model, or {"baseline": part, "variation": part} when `features`
    is a pair: baseline-or-not on every row, then which variation on the rows that are not baseline."""
    y, groups = df["batch"].to_numpy(str), df["strip_id"].map(strip_group).to_numpy(str)
    if not isinstance(features, tuple):
        return {"all": _fit_part(df, y, groups, features, seed, nested, C)}
    rest = y != str(baseline)
    return {
        "baseline": _fit_part(df, np.where(rest, other_label(baseline), str(baseline)), groups, features[0], seed, nested, C),
        "variation": _fit_part(df[rest], y[rest], groups[rest], features[1], seed, nested, C),
    }


def _parts_proba(parts: dict[str, dict], feats: pd.DataFrame, classes: list[str], baseline: str | None) -> np.ndarray:
    """Probability per class in `classes`. Staged: p(baseline), and p(not baseline) x p(variation)."""
    probs = np.zeros((len(feats), len(classes)))
    if "all" in parts:
        probs[:] = np.nan
        p = _eval_part(parts["all"], feats)[0]
        for j, c in enumerate(parts["all"]["classes"]):
            probs[:, classes.index(c)] = p[:, j]
        return probs
    p1 = dict(zip(parts["baseline"]["classes"], _eval_part(parts["baseline"], feats)[0].T))
    p2 = _eval_part(parts["variation"], feats)[0]
    if str(baseline) in classes:
        probs[:, classes.index(str(baseline))] = p1.get(str(baseline), 0.0)
    for j, c in enumerate(parts["variation"]["classes"]):
        probs[:, classes.index(c)] = p1.get(other_label(baseline), 0.0) * p2[:, j]
    return probs


def loso_cv(df: pd.DataFrame, families=MATERIAL_FAMILIES, features=None, seed: int = 0, nested: bool = True, staged=None, baseline: str | None = None) -> dict:
    """Leave-one-strip-out: every fold holds out all images of one physical strip, in every batch.

    Reducer and standardisation are fit inside each fold. C is chosen by an inner LOSO when `nested`.
    `staged=(families_1, families_2)` evaluates the two-stage model (needs `baseline`).
    """
    features = features or _stage_features(df, families, staged)
    y, groups = df["batch"].to_numpy(str), df["strip_id"].map(strip_group).to_numpy(str)
    classes = sorted(np.unique(y))
    pred = np.empty(len(y), dtype=object)
    probs = np.full((len(y), len(classes)), np.nan)
    chosen = []
    for g in np.unique(groups):
        test = groups == g
        if len(np.unique(y[~test])) < 2:
            pred[test] = classes[0]
            continue
        parts = _fit_parts(df[~test], features, baseline, seed, nested)
        chosen += [p["C"] for p in parts.values() if p["C"] is not None]
        probs[test] = _parts_proba(parts, df[test], classes, baseline)
        pred[test] = [classes[j] for j in np.nan_to_num(probs[test], nan=-1.0).argmax(axis=1)]
    per_image = pd.DataFrame(
        {"batch": y, "image_id": df["image_id"].to_numpy(), "strip": groups, "predicted": pred.astype(str), "correct": pred.astype(str) == y}
    )
    for j, c in enumerate(classes):
        per_image[f"p_{c}"] = probs[:, j]
    flat = [f for fs in features for f in fs] if isinstance(features, tuple) else features
    return {
        "families": sorted({family_of(f) for f in flat}, key=ALL_FAMILIES.index) if staged else list(families),
        "staged": [list(s) for s in staged] if staged else None,
        "n_features": len(flat),
        "n_images": int(len(y)),
        "n_strips": int(len(np.unique(groups))),
        "balanced_accuracy": balanced_accuracy(y, pred.astype(str)),
        "confusion": confusion(y, pred.astype(str), classes),
        "chosen_C": sorted(set(chosen)),
        "per_image": per_image,
    }


def permutation_null(df: pd.DataFrame, families=MATERIAL_FAMILIES, n: int = N_PERMUTATIONS, seed: int = 0, features=None, staged=None, baseline: str | None = None) -> dict:
    """Balanced accuracy of the same LOSO pipeline when batch labels are shuffled across strip segments.

    Labels move with whole segments so the strip structure of the null matches the data. Fixed C
    (middle of the grid) to keep it affordable; the real run with nested C is compared against it.
    """
    rng = np.random.default_rng(seed)
    features = features or _stage_features(df, families, staged)
    seg = segments_of(df)
    seg_batch = df.groupby(seg)["batch"].first()
    scores = []
    for _ in range(n):
        shuffled = pd.Series(rng.permutation(seg_batch.to_numpy()), index=seg_batch.index)
        fake = df.copy()
        fake["batch"] = seg.map(shuffled).to_numpy()
        if fake["batch"].nunique() < 2:
            continue
        scores.append(loso_cv(fake, families, features=features, seed=seed, nested=False, staged=staged, baseline=baseline)["balanced_accuracy"])
    scores = np.asarray(scores)
    return {"n": int(len(scores)), "mean": float(scores.mean()), "p95": float(np.percentile(scores, 95)), "max": float(scores.max())}


def shared_strip_check(df: pd.DataFrame, cv: dict) -> list[dict]:
    """For strips imaged in more than one batch: were their held-out images attributed to the right folder?

    If yes, the model is reading the material of the batch, not the strip.
    """
    per = cv["per_image"]
    out = []
    for strip, rows in per.groupby("strip"):
        batches = sorted(rows["batch"].unique())
        if len(batches) < 2:
            continue
        out.append(
            {
                "strip": strip,
                "batches": batches,
                "n_images": int(len(rows)),
                "accuracy": float(rows["correct"].mean()),
                "predicted": {b: rows.loc[rows["batch"] == b, "predicted"].tolist() for b in batches},
            }
        )
    return out


def rank_features(df: pd.DataFrame, families=FAMILIES, top: int = 30) -> pd.DataFrame:
    """Univariate separation per feature, on strip-segment means so repeated images of a strip count once.

    effect = largest pairwise |difference of batch means| / pooled segment SD; loso_acc = balanced
    accuracy of a nearest-batch-mean rule on that feature alone, leaving one strip out.
    """
    features = usable_features(df, families)
    seg = segments_of(df)
    means = df.groupby(seg)[features].mean(numeric_only=True)
    batch = df.groupby(seg)["batch"].first()
    strip = pd.Series(means.index.str.split("|").str[1], index=means.index)
    rows = []
    for f in features:
        v = means[f]
        groups = {b: v[batch == b].dropna() for b in batch.unique()}
        pooled = np.sqrt(np.nanmean([g.var(ddof=1) for g in groups.values() if len(g) > 1])) if any(len(g) > 1 for g in groups.values()) else np.nan
        pairs = [abs(groups[a].mean() - groups[b].mean()) for a, b in combinations(groups, 2) if len(groups[a]) and len(groups[b])]
        effect = max(pairs) / pooled if pairs and pooled and np.isfinite(pooled) else np.nan
        pred = []
        for s in strip.unique():
            train = strip != s
            centres = {b: v[train & (batch == b)].mean() for b in groups}
            for idx in v[strip == s].index:
                pred.append(min(centres, key=lambda b: abs(v[idx] - centres[b])) if np.isfinite(v[idx]) else None)
        ok = [p is not None for p in pred]
        acc = balanced_accuracy(batch[strip.isin(strip.unique())][ok].to_numpy(), np.asarray(pred, dtype=object)[ok].astype(str)) if any(ok) else np.nan
        rows.append({"feature": f, "family": family_of(f), "effect_size": effect, "loso_acc": acc, **{f"mean_{b}": g.mean() for b, g in groups.items()}})
    table = pd.DataFrame(rows).sort_values(["loso_acc", "effect_size"], ascending=False)
    return table.head(top) if top else table


STAGED_SETS = {
    "texture > deep": (("tex",), (DEEP_FAMILY,)),
    "material > deep": (MATERIAL_FAMILIES, (DEEP_FAMILY,)),
    "texture > material": (("tex",), MATERIAL_FAMILIES),
}


def evaluate(df: pd.DataFrame, families_sets: dict[str, tuple] | None = None, n_perm: int = N_PERMUTATIONS, seed: int = 0, out_dir: Path = ATTRIBUTION_DIR, baseline: str | None = None, staged_sets: dict[str, tuple] | None = None) -> dict:
    """The whole feature-discovery report: LOSO per family set, nulls, shared strips, feature ranking.

    With `baseline`, the staged sets (baseline-or-not families > which-variation families) are scored too.
    """
    families_sets = families_sets or {
        "regional": ("reg",), "edge": ("edge",), "texture": ("tex",), "particles": ("par",), "kpis": ("kpi",),
        "imaging": ("img",), "material": MATERIAL_FAMILIES, "all": FAMILIES,
        "deep": (DEEP_FAMILY,), "deep+material": (*MATERIAL_FAMILIES, DEEP_FAMILY),
    }
    jobs = [(name, fams, None) for name, fams in families_sets.items()]
    if baseline is not None:
        jobs += [(name, (), pair) for name, pair in (STAGED_SETS if staged_sets is None else staged_sets).items()]
    report: dict = {"n_images": int(len(df)), "batches": sorted(df["batch"].unique()), "family_sets": {}}
    for name, fams, pair in jobs:
        if not all(usable_features(df, f) for f in (pair or (fams,))):
            continue
        t = time.time()
        cv = loso_cv(df, fams, seed=seed, staged=pair, baseline=baseline)
        null = permutation_null(df, fams, n=n_perm, seed=seed, staged=pair, baseline=baseline) if n_perm else None
        report["family_sets"][name] = {
            k: v for k, v in cv.items() if k != "per_image"
        } | {"null": null, "above_null": bool(null and cv["balanced_accuracy"] > null["p95"]), "shared_strips": shared_strip_check(df, cv), "seconds": round(time.time() - t, 1)}
        print(f"{name:18s} acc={cv['balanced_accuracy']:.2f} null95={null['p95'] if null else float('nan'):.2f} features={cv['n_features']}", flush=True)
    ranking = rank_features(df)
    report["top_features"] = ranking.to_dict(orient="records")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "evaluation.json").write_text(json.dumps(report, indent=1, default=_json_default))
    ranking.to_csv(out_dir / "feature_ranking.csv", index=False)
    return report


# ---------------------------------------------------------------- model

def venn_abers(scores: np.ndarray, labels: np.ndarray, score: float) -> tuple[float, float]:
    """Venn-Abers interval [p0, p1] for P(label = 1) at `score`: isotonic regression of the calibration
    labels on their scores, refitted with the new point added once as label 0 and once as label 1.
    The width says how little the calibration points pin the probability down.

    The two labels weigh the same in total, as in the classifier (class_weight="balanced"): the mix of
    unseen images is unknown, and an unweighted fit would carry the training mix into every call."""
    out = []
    for label in (0.0, 1.0):
        y = np.append(labels, label)
        weight = np.where(y == 1, 0.5 / max((y == 1).sum(), 1), 0.5 / max((y == 0).sum(), 1))
        iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(np.append(scores, score), y, sample_weight=weight)
        out.append(float(iso.predict([score])[0]))
    return min(out), max(out)


def _calibrated(raw: np.ndarray, classes: list[str], baseline: str, points: dict | None) -> tuple[np.ndarray, np.ndarray | None]:
    """Probabilities with a Venn-Abers "baseline or not", and its [p0, p1] interval per row.

    p(baseline) = p1 / (1 - p0 + p1) from the raw p(baseline) and the calibration `points` (`scores`,
    `labels`); the other batches share the rest in their raw proportions. Without points, or without the
    baseline and another batch among the classes, the raw probabilities pass through."""
    if not points or not len(points["scores"]) or baseline not in classes or len(classes) < 2:
        return raw, None
    b = classes.index(baseline)
    scores, labels = np.asarray(points["scores"], float), np.asarray(points["labels"], float)
    intervals = np.array([venn_abers(scores, labels, s) for s in raw[:, b]]).reshape(-1, 2)
    pb = intervals[:, 1] / (1 - intervals[:, 0] + intervals[:, 1])
    rest = np.delete(raw, b, axis=1)
    total = rest.sum(axis=1, keepdims=True)
    share = np.where(total > 0, rest / np.where(total > 0, total, 1.0), 1.0 / rest.shape[1])
    return np.insert((1 - pb)[:, None] * share, b, pb, axis=1), intervals


def _call(p: np.ndarray, classes: list[str], baseline: str) -> int:
    """The bet: the baseline if it is at least as likely as not, else the most likely other batch."""
    if baseline not in classes or len(classes) < 2:
        return int(np.argmax(p))
    b = classes.index(baseline)
    return b if p[b] >= 0.5 else max((j for j in range(len(classes)) if j != b), key=lambda j: p[j])


def tier_of(confidence: float) -> str:
    return next(name for name, low in TIERS if confidence >= low)


def _qhat(scores: np.ndarray, alpha: float) -> float:
    n = len(scores)
    return float(np.quantile(scores, min(1.0, np.ceil((n + 1) * (1 - alpha)) / n), method="higher"))


def calibrate(per_image: pd.DataFrame, classes: list[str], baseline: str, alpha: float = CONFORMAL_ALPHA) -> dict:
    """What the out-of-fold (strip-held-out) probabilities say about how far to trust a call.

    venn_abers: every image's out-of-fold p(baseline) with its label, the calibration points `predict`
    uses (`_calibrated`). No temperature: fitted held out it made the log loss worse (docs/experiments/T14.md).

    Everything else is a held-out record: the images of each strip are calibrated with the points of the
    other strips, then scored. accuracy, balanced_accuracy, confusion and log_loss of those calls
    (`raw_log_loss`: without calibration); tiers: right / n per confidence tier; stages: right / n for
    "baseline or not" and, among true variations called a variation, for "which variation"; conformal:
    `qhat` such that the set {class: p >= 1 - qhat} holds the true batch for about 1 - alpha of images,
    with the coverage and mean set size when qhat comes from the other strips too.
    """
    P = per_image[[f"p_{c}" for c in classes]].to_numpy(float)
    y, groups = per_image["batch"].to_numpy(str), per_image["strip"].to_numpy(str)
    ok = np.isfinite(P).all(axis=1) & np.isin(y, classes)
    P, y, groups = P[ok], y[ok], groups[ok]
    n = len(y)
    if not n:
        return {"n": 0, "tiers": [], "venn_abers": None, "conformal": None, "stages": {}}
    truth = np.array([classes.index(c) for c in y])
    b = classes.index(str(baseline)) if str(baseline) in classes and len(classes) > 1 else None
    points = None if b is None else {"scores": P[:, b], "labels": (truth == b).astype(float)}
    folds = [groups == g for g in np.unique(groups)]
    Q, width = P.copy(), np.zeros(n)
    for test in folds if points else []:
        Q[test], intervals = _calibrated(P[test], classes, str(baseline), {k: v[~test] for k, v in points.items()})
        width[test] = intervals[:, 1] - intervals[:, 0]
    pred = np.array([_call(q, classes, str(baseline)) for q in Q])
    right = pred == truth
    tiers = np.array([tier_of(c) for c in Q[np.arange(n), pred]], dtype=object)
    log_loss = lambda probs: float(-np.log(np.clip(probs[np.arange(n), truth], 1e-12, None)).mean())
    scores = 1 - Q[np.arange(n), truth]
    in_set = np.zeros_like(Q, bool)
    for test in folds:
        in_set[test] = Q[test] >= 1 - _qhat(scores[~test], alpha) if (~test).any() else True
    in_set[np.arange(n), pred] = True
    stages = {}
    if b is not None:
        s1 = (pred == b) == (truth == b)
        s2 = (pred != b) & (truth != b)
        stages = {"baseline": {"right": int(s1.sum()), "n": int(n)}, "variation": {"right": int(right[s2].sum()), "n": int(s2.sum())}}
        if (rec := stage_record(stages["variation"], len(classes) - 1)) and not rec["established"]:
            tiers[pred != b] = "low"  # as predict: a variation call the model cannot back is never more than low
    return {
        "method": "venn_abers" if points else "none",
        "n": int(n),
        "accuracy": float(right.mean()),
        "balanced_accuracy": balanced_accuracy(truth, pred),
        "confusion": confusion(y, np.array(classes)[pred], classes),
        "log_loss": log_loss(Q),
        "raw_log_loss": log_loss(P),
        "tiers": [{"tier": name, "min_confidence": low, "right": int(right[tiers == name].sum()), "n": int((tiers == name).sum())} for name, low in TIERS],
        "venn_abers": points and {"scores": points["scores"].tolist(), "labels": points["labels"].tolist(), "mean_width": float(width.mean())},
        "conformal": {"alpha": alpha, "qhat": _qhat(scores, alpha), "n": int(n),
                      "coverage": float(in_set[np.arange(n), truth].mean()), "mean_size": float(in_set.sum(axis=1).mean())},
        "stages": stages,
    }


def load_dictionary(path: Path = DICTIONARY_PATH) -> dict:
    return (yaml.safe_load(path.read_text()) or {}) if path.exists() else {}


def _segment_means(df: pd.DataFrame, columns: list[str]) -> tuple[pd.DataFrame, pd.Series]:
    seg = segments_of(df)
    return df[columns].apply(pd.to_numeric, errors="coerce").groupby(seg).mean(), df.groupby(seg)["batch"].first().astype(str)


def _moves_with(values: pd.DataFrame, component: pd.Series) -> list[tuple[str, float]]:
    """The columns of `values` a component correlates with: |r| >= TRANSLATE_MIN_R, at most TRANSLATE_TOP."""
    if values.empty:
        return []
    r = values.corrwith(component).dropna()
    top = r[r.abs() >= TRANSLATE_MIN_R].sort_values(key=np.abs, ascending=False).head(TRANSLATE_TOP)
    return [(f, round(float(v), 2)) for f, v in top.items()]


def explain_tables(df: pd.DataFrame, parts: dict[str, dict], baseline: str, dictionary: dict | None = None) -> dict:
    """What the reasons need to be readable: for every deep_pcNN the named material features it moves
    with on the training rows (|r| >= TRANSLATE_MIN_R, at most TRANSLATE_TOP), and for every named
    feature its label, its baseline mean and SD over strip segments, and each batch's mean. Plus what
    each stage leans on overall (`importance`)."""
    pool = usable_features(df, MATERIAL_FAMILIES)
    named_values = df[pool].apply(pd.to_numeric, errors="coerce") if pool else pd.DataFrame(index=df.index)
    translations: dict[str, dict] = {}
    used: set[str] = set()
    for role, part in parts.items():
        Xr = _eval_part(part, df)[3]
        translations[role] = {}
        for j, name in enumerate(part["model_features"]):
            if not name.startswith(f"{DEEP_FAMILY}_pc"):
                used.add(name)
                continue
            top = _moves_with(named_values, pd.Series(Xr[:, j], index=df.index))
            translations[role][name] = [{"feature": f, "r": r} for f, r in top]
            used |= {f for f, _ in top}
    columns = [c for c in df.columns if c in used]
    means, batch = _segment_means(df, columns)
    base = means[batch == str(baseline)]
    named = {}
    for c in columns:
        sd = float(base[c].std(ddof=1)) if base[c].notna().sum() > 1 else np.nan
        named[c] = {
            "label": describe(c, dictionary),
            "baseline_mean": float(base[c].mean()) if len(base) else np.nan,
            "baseline_sd": sd if np.isfinite(sd) and sd > 0 else np.nan,
            "batch_means": {b: float(means.loc[batch == b, c].mean()) for b in sorted(batch.unique())},
        }
    return {"translations": translations, "named": named, "importance": importance(df, parts, str(baseline), translations, named)}


def importance(df: pd.DataFrame, parts: dict[str, dict], baseline: str, translations: dict, named: dict) -> dict:
    """Which inputs each stage leans on, over the images it was trained on.

    Per model feature: the mean |coefficient x z| as a share of the stage's total. `families` sums the
    shares per feature family; `features` lists the IMPORTANCE_TOP largest with their label, the class a
    higher value pulls towards, and for a deep_pcNN the named features it moves with (`related`) and
    the imaging descriptors it moves with (`imaging`, same |r| rule): how much of that pattern may be
    the microscope rather than the material."""
    out = {}
    acquisition = df[usable_features(df, (IMAGING_FAMILY,))].apply(pd.to_numeric, errors="coerce")
    for role, part in parts.items():
        rows = df[df["batch"].astype(str) != baseline] if role == "variation" else df
        if len(part["classes"]) < 2 or rows.empty:
            continue
        _, Z, coef, _ = _eval_part(part, rows)
        Xr = _eval_part(part, df)[3]
        weight = np.abs(coef[:, None, :] * Z[None]).mean(axis=(0, 1))
        if not weight.sum() > 0:
            continue
        share = weight / weight.sum()
        names = part["model_features"]
        families: dict[str, float] = {}
        for name, v in zip(names, share):
            families[family_of(name)] = families.get(family_of(name), 0.0) + float(v)
        features = []
        for j in np.argsort(-share)[:IMPORTANCE_TOP]:
            name = names[j]
            deep = name.startswith(f"{DEEP_FAMILY}_pc")
            entry = {"feature": name, "label": f"DINOv2 image pattern {name.rsplit('pc', 1)[-1]}" if deep else named.get(name, {}).get("label", name),
                     "share": round(float(share[j]), 4), "higher_means": part["classes"][int(np.argmax(coef[:, j]))]}
            if deep:
                entry["related"] = [t | {"label": named.get(t["feature"], {}).get("label", t["feature"])} for t in translations.get(role, {}).get(name, [])]
                entry["imaging"] = [{"feature": f, "label": describe(f), "r": r} for f, r in _moves_with(acquisition, pd.Series(Xr[:, j], index=df.index))]
            features.append(entry)
        out[role] = {"n_features": len(names), "families": {f: round(v, 4) for f, v in sorted(families.items(), key=lambda kv: -kv[1])}, "features": features}
    return out


def fit_model(df: pd.DataFrame, baseline: str, families=MATERIAL_FAMILIES, seed: int = 0, C: float | None = None, staged=None) -> dict:
    """Fits on every row of `df` and returns a JSON-serialisable model with its own LOSO estimate.

    Includes: the confidence calibration from the out-of-fold probabilities (`calibrate`); per batch,
    the mean/SD of its strip segments and the threshold beyond which an image is outside that batch
    (`batch_stats`; `baseline_stats` is the baseline's entry); and the tables behind readable reasons
    (`explain_tables`). `staged=(families_1, families_2)` fits the two-stage model instead.
    `loso` is the held-out record of the calls as `predict` makes them (calibrated);
    `classifier_balanced_accuracy` is the uncalibrated argmax that `--evaluate` reports.
    """
    features = _stage_features(df, families, staged)
    parts = _fit_parts(df, features, baseline, seed, nested=True, C=C)
    cv = loso_cv(df, families, features=features, seed=seed, staged=staged, baseline=baseline)
    classes = sorted(df["batch"].astype(str).unique())
    space = parts.get("all") or parts["baseline"]  # distances are measured in this part's feature space
    reducer = Reducer.from_json(space["features"], space["reducer"])
    stats = {c: baseline_stats(df, space["features"], c, reducer) for c in classes}
    calibration = calibrate(cv["per_image"], classes, str(baseline))
    calls = calibration if calibration["n"] else cv
    model = {
        "version": "v4.2",
        "fitted_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "kind": "staged" if staged else "flat",
        "families": cv["families"],
        "staged": cv["staged"],
        "classes": classes,
        "baseline": str(baseline),
        "trained_on": {b: sorted(df.loc[df["batch"].astype(str) == b, "image_id"].astype(str)) for b in classes},
        "loso": {"balanced_accuracy": calls["balanced_accuracy"], "confusion": calls["confusion"], "n_strips": cv["n_strips"],
                 "classifier_balanced_accuracy": cv["balanced_accuracy"]},
        "calibration": calibration,
        "baseline_stats": stats.get(str(baseline)) or baseline_stats(df, space["features"], baseline, reducer),
        "batch_stats": stats,
        "explain": explain_tables(df, parts, str(baseline), load_dictionary()),
    }
    if staged:
        union = list(dict.fromkeys(f for part in parts.values() for f in part["features"]))
        return model | {"features": union, "model_features": space["model_features"], "C": {role: part["C"] for role, part in parts.items()}, "stages": parts}
    return model | {k: v for k, v in parts["all"].items() if k != "classes"}


def model_parts(model: dict) -> dict[str, dict]:
    """The fitted regressions of a model: {"baseline", "variation"} when staged, else {"all": the model}."""
    return model["stages"] if model.get("stages") else {"all": model}


def baseline_stats(df: pd.DataFrame, features: list[str], baseline: str, reducer: "Reducer | None" = None) -> dict:
    """Mean/SD per feature over the strip segments of one batch (the baseline, or any other), and the
    threshold beyond which an image is outside that batch.

    Threshold: for each strip of the batch, standardise by its other strips and take the RMS z of
    its images; the UNFAMILIAR_QUANTILE of those distances is the threshold. Images of the batch
    itself therefore sit at or below it (apart from the quantile's tail).
    """
    ref = df[df["batch"].astype(str) == str(baseline)]
    if ref.empty:
        return {"n_segments": 0, "mean": None, "sd": None, "threshold": None, "held_out_distances": []}
    reducer = reducer or Reducer(None, features)
    R = pd.DataFrame(reducer(_matrix(ref, features)), columns=reducer.names, index=ref.index)
    seg = ref["strip_id"].map(strip_group)
    seg_means = R.groupby(seg).mean()
    mean = seg_means.mean().to_numpy(float)
    sd = seg_means.std(ddof=1).to_numpy(float) if len(seg_means) > 1 else np.full(R.shape[1], np.nan)
    sd = np.where(np.isfinite(sd) & (sd > 0), sd, np.nan)
    distances = []
    for s in seg_means.index:
        others = seg_means.drop(index=s)
        if len(others) < 2:
            continue
        m, d = others.mean().to_numpy(float), others.std(ddof=1).to_numpy(float)
        d = np.where(np.isfinite(d) & (d > 0), d, np.nan)
        Xs = R[seg == s].to_numpy(float)
        distances += [_rms_z((x - m) / d) for x in Xs]
    threshold = float(np.quantile(distances, UNFAMILIAR_QUANTILE)) if distances else None
    return {
        "n_segments": int(len(seg_means)),
        "mean": [None if not np.isfinite(v) else float(v) for v in mean],
        "sd": [None if not np.isfinite(v) else float(v) for v in sd],
        "threshold": threshold,
        "held_out_distances": [round(float(v), 3) for v in distances],
    }


def _rms_z(z: np.ndarray) -> float:
    z = z[np.isfinite(z)]
    return float(np.sqrt(np.mean(z**2))) if len(z) else np.nan


def save_model(model: dict, path: Path = ATTRIBUTION_MODEL_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(model, indent=1, default=_json_default))


def load_model(path: Path = ATTRIBUTION_MODEL_PATH) -> dict | None:
    return json.loads(path.read_text()) if path.exists() else None


def _clause(model: dict, feature: str, value, r: float | None = None) -> dict | None:
    """One named feature of one image against the baseline: SD above or below, and the batch it sits closest to."""
    st = (model.get("explain") or {}).get("named", {}).get(feature)
    value = pd.to_numeric(value, errors="coerce")
    if not st or not np.isfinite(value) or not _finite(st["baseline_mean"]) or not _finite(st["baseline_sd"]):
        return None
    z = (float(value) - st["baseline_mean"]) / st["baseline_sd"]
    direction = "above" if z > 0 else "below"
    means = {b: m for b, m in st["batch_means"].items() if _finite(m)}
    text = f"{st['label']}: about the same as {model['baseline']}" if abs(z) < SD_SAME else f"{st['label']}: {abs(z):.1f} SD {direction} {model['baseline']}"
    out = {"feature": feature, "label": st["label"], "value": float(value), "baseline_z": round(float(z), 2), "direction": direction,
           "closest_batch": min(means, key=lambda b: abs(value - means[b])) if means else None, "text": text}
    return out if r is None else out | {"r": r}


def _finite(v) -> bool:
    return v is not None and np.isfinite(v)


def _reasons(model: dict, role: str, part: dict, z: np.ndarray, contrib: np.ndarray, row: pd.Series, n: int) -> list[dict]:
    """The `n` largest contributions of one part to its call, each with a plain-language text."""
    translations = (model.get("explain") or {}).get("translations", {}).get(role, {})
    out = []
    for j in np.argsort(-np.abs(contrib))[:n]:
        if contrib[j] == 0:
            continue
        name = part["model_features"][j] if "model_features" in part else part["features"][j]
        reason = {"feature": name, "z": round(float(z[j]), 2), "contribution": round(float(contrib[j]), 3), "stage": role}
        if name.startswith(f"{DEEP_FAMILY}_pc"):
            related = [c for t in translations.get(name, []) if (c := _clause(model, t["feature"], row.get(t["feature"]), t["r"]))]
            label = f"DINOv2 image pattern {name.rsplit('pc', 1)[-1]}"
            text = f"{label}, which moves with " + "; ".join(f"{c['text']} (r = {c['r']:+.2f})" for c in related) if related else f"{label}: an overall look of the InLens image that no single named measurement captures"
            reason |= {"label": label, "text": text, "related": related}
        elif (clause := _clause(model, name, row.get(name))) is not None:
            reason |= {"label": clause["label"], "text": clause["text"], "baseline_z": clause["baseline_z"], "closest_batch": clause["closest_batch"]}
        out.append(reason)
    return out


def stage_record(record: dict | None, options: int = 2) -> dict | None:
    """A stage's held-out record (right / n) and whether it beats guessing among its `options`:
    `p_value` = one-sided binomial P(at least this many right | chance), `established` = p_value < ESTABLISHED_P.
    A stage that is not established still makes its call (Rule 11); the call is then a lean, and says so."""
    if not record or not record.get("n"):
        return None
    right, n = int(record["right"]), int(record["n"])
    p = float(binom.sf(right - 1, n, 1 / options))
    return {"right": right, "n": n, "chance": round(1 / options, 4), "p_value": round(p, 4), "established": p < ESTABLISHED_P}


def _stage_calls(p: np.ndarray, classes: list[str], baseline: str, interval=None, stages: dict | None = None) -> dict:
    """"Different from the baseline?" and, if so, "in what way?": each with its own confidence.
    `interval` is the Venn-Abers [p0, p1] of p(baseline); it is reported as the range of the first confidence.
    `stages` is the model's held-out record per stage (`calibration.stages`); each call then carries its
    `record` (`stage_record`), so a stage that does no better than guessing is marked as not established."""
    if baseline not in classes:
        return {"stage_baseline": None, "stage_variation": None}
    stages = stages or {}
    b = classes.index(baseline)
    pb = float(p[b])
    first = {"call": baseline if pb >= 0.5 else other_label(baseline), "confidence": max(pb, 1 - pb), "p_baseline": pb}
    if interval is not None:
        low, high = float(interval[0]), float(interval[1])
        first["interval"] = [low, high] if pb >= 0.5 else [1 - high, 1 - low]
    if (rec := stage_record(stages.get("baseline"))) is not None:
        first["record"] = rec
    rest = [(c, float(p[j])) for j, c in enumerate(classes) if j != b]
    if pb >= 0.5 or not rest:
        return {"stage_baseline": first, "stage_variation": None}
    best, pbest = max(rest, key=lambda t: t[1])
    second = {"call": best, "confidence": pbest / (1 - pb)}
    if (rec := stage_record(stages.get("variation"), len(rest))) is not None:
        second["record"] = rec
        if not rec["established"]:
            names = " and ".join(c for c, _ in rest)
            second["note"] = (f"{names} are not told apart on held-out strips: {rec['right']} of {rec['n']} right, "
                              f"where guessing gets that many or more with probability {rec['p_value']:.2f}. {best} is a lean, not a finding.")
    return {"stage_baseline": first, "stage_variation": second}


def predict(model: dict, feats: pd.DataFrame, balanced: int | None = None) -> pd.DataFrame:
    """One row per image. Always a batch (`predicted`), and how far to trust it.

    p_<batch> and `confidence` are calibrated (`_calibrated`; `confidence_raw` is the classifier's own
    value); `predicted` follows the stages (`_call`); `confidence_tier` with `confidence_record` (held-out
    right / n in that tier); `stage_baseline` (with the Venn-Abers `interval` of its confidence) and
    `stage_variation`; `prediction_set`, the bet first; `reasons` with plain-language `text`; distance to the
    baseline (`baseline_distance`, `outside_baseline`, `deviations`) and to the predicted batch
    (`predicted_distance`, `unfamiliar`: outside the range of the batch it was assigned to).
    `balanced=k` additionally reports `assigned`: the joint assignment with exactly k images per
    class that maximises the summed log-probability (for a designed k-per-batch test).
    """
    classes, baseline = model["classes"], str(model["baseline"])
    parts = model_parts(model)
    evals = {role: _eval_part(part, feats) for role, part in parts.items()}
    raw = np.nan_to_num(_parts_proba(parts, feats, classes, baseline), nan=0.0)
    calibration = model.get("calibration") or {}
    probs, intervals = _calibrated(raw, classes, baseline, calibration.get("venn_abers"))
    tiers = {t["tier"]: t for t in calibration.get("tiers", [])}
    qhat = (calibration.get("conformal") or {}).get("qhat")
    space = "all" if "all" in parts else "baseline"
    pred_idx = [_call(p, classes, baseline) for p in probs]
    variation_record = stage_record((calibration.get("stages") or {}).get("variation"), max(len(classes) - 1, 1))
    explain_variation = variation_record is None or variation_record["established"]  # a coin flip gets a note, not reasons
    rows = []
    for i in range(len(feats)):
        k = pred_idx[i]
        row = feats.iloc[i]
        if "all" in parts:
            _, Z, coef, _ = evals["all"]
            reasons = _reasons(model, "all", parts["all"], Z[i], coef[parts["all"]["classes"].index(classes[k])] * Z[i], row, N_REASONS)
        else:
            first, second = parts["baseline"], parts["variation"]
            call = baseline if classes[k] == baseline else other_label(baseline)
            _, Z1, coef1, _ = evals["baseline"]
            c1 = coef1[first["classes"].index(call)] * Z1[i] if call in first["classes"] else np.zeros(Z1.shape[1])
            if classes[k] == baseline or classes[k] not in second["classes"] or len(second["classes"]) < 2 or not explain_variation:
                reasons = _reasons(model, "baseline", first, Z1[i], c1, row, N_REASONS)
            else:
                _, Z2, coef2, _ = evals["variation"]
                n1 = N_REASONS // 2
                reasons = _reasons(model, "baseline", first, Z1[i], c1, row, n1)
                reasons += _reasons(model, "variation", second, Z2[i], coef2[second["classes"].index(classes[k])] * Z2[i], row, N_REASONS - n1)
        confidence = float(probs[i, k])
        order = np.argsort(-probs[i])
        stage = _stage_calls(probs[i], classes, baseline, None if intervals is None else intervals[i], calibration.get("stages"))
        pset = [classes[k]] + [classes[j] for j in order if j != k and qhat is not None and probs[i, j] >= 1 - qhat]
        guess = ((stage["stage_variation"] or {}).get("record") or {}).get("established") is False
        if guess:  # cannot rule out what it cannot tell apart
            pset += [c for c in classes if c != baseline and c not in pset]
        tier = "low" if guess else tier_of(confidence)
        x = evals[space][3][i]
        own = _distance((model.get("batch_stats") or {}).get(classes[k]), model, x)
        base = baseline_distance(model, x)
        rows.append(
            {
                "batch": feats["batch"].iloc[i] if "batch" in feats else None,
                "image_id": feats["image_id"].iloc[i],
                "strip_id": feats["strip_id"].iloc[i] if "strip_id" in feats else None,
                **{f"p_{c}": float(probs[i, j]) for j, c in enumerate(classes)},
                "predicted": classes[k],
                "confidence": confidence,
                "confidence_raw": float(raw[i, k]),
                "confidence_tier": tier,
                "confidence_record": {"right": tiers[tier]["right"], "n": tiers[tier]["n"]} if tier in tiers else None,
                **stage,
                "prediction_set": pset,
                "reasons": reasons,
                **base,
                "predicted_distance": own["distance"],
                "predicted_threshold": own["threshold"],
                "unfamiliar": own["outside"],
            }
        )
    out = pd.DataFrame(rows)
    if balanced:
        out["assigned"] = balanced_assignment(probs, classes, balanced)
    return out


def _distance(stats: dict | None, model: dict, x: np.ndarray) -> dict:
    """RMS z of `x` against one batch's strip-segment statistics, the deviating features, and whether
    it is beyond that batch's own held-out distances."""
    if not stats or not stats.get("mean"):
        return {"distance": np.nan, "threshold": None, "outside": None, "n_deviating": 0, "deviations": []}
    mean = np.array([np.nan if v is None else v for v in stats["mean"]], float)
    sd = np.array([np.nan if v is None else v for v in stats["sd"]], float)
    z = (x - mean) / sd
    names = model.get("model_features", model["features"])
    named = (model.get("explain") or {}).get("named", {})
    order = np.argsort(-np.abs(np.nan_to_num(z)))
    deviations = [
        {"feature": names[j], "label": named.get(names[j], {}).get("label", names[j]), "z": round(float(z[j]), 2), "direction": "above" if z[j] > 0 else "below"}
        for j in order[:N_REASONS] if np.isfinite(z[j]) and abs(z[j]) >= Z_FLAG
    ]
    dist = _rms_z(z)
    threshold = stats.get("threshold")
    return {
        "distance": dist,
        "threshold": threshold,
        "outside": bool(dist > threshold) if threshold is not None and np.isfinite(dist) else None,
        "n_deviating": int(np.sum(np.abs(z[np.isfinite(z)]) >= Z_FLAG)),
        "deviations": deviations,
    }


def baseline_distance(model: dict, x: np.ndarray) -> dict:
    """Two-sided view against the baseline: RMS z over the model's features, deviating features, flag."""
    d = _distance(model.get("baseline_stats"), model, x)
    return {"baseline_distance": d["distance"], "baseline_threshold": d["threshold"], "outside_baseline": d["outside"],
            "n_deviating": d["n_deviating"], "deviations": d["deviations"]}


def balanced_assignment(probs: np.ndarray, classes: list[str], per_class: int) -> list[str]:
    """Hungarian assignment of images to `per_class` slots per class maximising summed log p.

    Images beyond len(classes) * per_class keep their unconstrained argmax.
    """
    n, k = probs.shape
    cost = -np.log(np.clip(probs, 1e-12, None))
    slots = np.repeat(np.arange(k), per_class)
    rows, cols = linear_sum_assignment(cost[:, slots])
    assigned = [classes[j] for j in probs.argmax(axis=1)]
    for r, c in zip(rows, cols):
        assigned[r] = classes[slots[c]]
    return assigned


# ---------------------------------------------------------------- commands

def _hold_out(df: pd.DataFrame, per_batch: int, rng: np.random.Generator) -> list:
    """`per_batch` row labels per batch: whole strips that no other batch shares first, then single images."""
    held = []
    for b, rows in df.groupby("batch"):
        strips = rows["strip_id"].map(strip_group)
        own = [s for s in strips.unique() if not ((df["batch"] != b) & (df["strip_id"].map(strip_group) == s)).any()]
        pick = []
        for s in rng.permutation(own):
            pick += rows.index[strips == s].tolist()
            if len(pick) >= per_batch:
                break
        if len(pick) < per_batch:
            rest = [i for i in rows.index if i not in pick]
            pick += list(rng.choice(rest, per_batch - len(pick), replace=False))
        held += pick[:per_batch]
    return held


def dry_run(df: pd.DataFrame, baseline: str, families=MATERIAL_FAMILIES, per_batch: int = 3, seed: int = 0, balanced: bool = True, staged=None) -> dict:
    """Rehearsal of the designed test: hold out `per_batch` images per batch (whole strips where
    possible, so held-out images never share a strip with training), refit, predict, score."""
    held = _hold_out(df, per_batch, np.random.default_rng(seed))
    test, train = df.loc[held], df.drop(index=held)
    model = fit_model(train, baseline, families, seed=seed, staged=staged)
    pred = predict(model, test, balanced=per_batch if balanced else None)
    truth = pred["batch"].astype(str).to_numpy()
    result = {
        "held_out": pred[["batch", "image_id", "strip_id", "predicted", "confidence", "confidence_tier", "prediction_set", "unfamiliar"]].to_dict(orient="records"),
        "balanced_accuracy": balanced_accuracy(truth, pred["predicted"].to_numpy(str)),
        "train_loso": model["loso"]["balanced_accuracy"],
        "C": model["C"],
    }
    if balanced:
        result["balanced_assignment_accuracy"] = balanced_accuracy(truth, pred["assigned"].to_numpy(str))
    return result


def dry_runs(df: pd.DataFrame, baseline: str, families=MATERIAL_FAMILIES, per_batch: int = 3, repeats: int = 30, seed: int = 0, staged=None) -> dict:
    """`repeats` dry runs with different held-out draws: one draw of nine images is too noisy to judge
    a model. Reports the spread of the accuracy, and on images the model never saw: how often each
    confidence tier was right, how often the prediction set held the truth, and its mean size."""
    runs = [dry_run(df, baseline, families, per_batch, seed + r, staged=staged) for r in range(repeats)]
    held = pd.DataFrame([h for r in runs for h in r["held_out"]])
    right = held["predicted"].astype(str) == held["batch"].astype(str)
    summary = lambda key: {"mean": float(np.mean([r[key] for r in runs])), "sd": float(np.std([r[key] for r in runs])),
                           "min": float(np.min([r[key] for r in runs])), "max": float(np.max([r[key] for r in runs]))}
    return {
        "repeats": repeats,
        "per_batch": per_batch,
        "distinct_draws": int(len({tuple(sorted(h["image_id"] for h in r["held_out"])) for r in runs})),
        "balanced_accuracy": summary("balanced_accuracy"),
        "balanced_assignment_accuracy": summary("balanced_assignment_accuracy"),
        "per_batch_accuracy": {b: float(right[held["batch"] == b].mean()) for b in sorted(held["batch"].astype(str).unique())},
        "tiers": [{"tier": name, "right": int(right[held["confidence_tier"] == name].sum()), "n": int((held["confidence_tier"] == name).sum())} for name, _ in TIERS],
        "prediction_set": {"coverage": float(np.mean([b in s for b, s in zip(held["batch"].astype(str), held["prediction_set"])])),
                           "mean_size": float(held["prediction_set"].map(len).mean())},
    }


def attribute_images(image_dir: Path, model: dict, balanced: int | None = None, progress=None) -> dict:
    """Features + prediction for every field in a flat folder; writes out/attribution/<folder>.json.

    progress(stage, done, total, tile), stage in "features" | "deep" | "predict"; prints when None.
    """
    from qc.features import build_features

    report = progress or (lambda stage, d, t, s: print(f"[{d}/{t}] {'' if stage == 'features' else stage + ' '}{s}"))
    feats = build_features([image_dir], lambda d, t, s: report("features", d, t, s))
    if any(f.startswith(f"{DEEP_FAMILY}_") for f in model["features"]):
        from qc.deep import build_deep, merge_deep

        feats = merge_deep(feats, build_deep([image_dir], lambda d, t, s: report("deep", d, t, s)))
    if progress:
        progress("predict", 0, 1, image_dir.name)
    pred = predict(model, feats, balanced=balanced)
    result = {
        "run": image_dir.name,
        "model": {"fitted_at": model["fitted_at"], "classes": model["classes"], "baseline": model["baseline"], "loso_balanced_accuracy": model["loso"]["balanced_accuracy"],
                  "kind": model.get("kind", "flat"), "families": model.get("families"), "staged": model.get("staged"), "calibration": model.get("calibration"),
                  "importance": (model.get("explain") or {}).get("importance")},
        "images": pred.drop(columns=["batch"]).to_dict(orient="records"),
        "summary": {c: int((pred["predicted"] == c).sum()) for c in model["classes"]} | {"unfamiliar": int(pred["unfamiliar"].fillna(False).sum())},
    }
    path = attribution_path(image_dir.name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=1, default=_json_default))
    print(f"wrote {path}")
    return result


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (pd.DataFrame,)):
        return o.to_dict(orient="records")
    if isinstance(o, float) and not np.isfinite(o):
        return None
    return str(o)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--evaluate", action="store_true", help="LOSO + permutation null per feature family on out/features.csv")
    ap.add_argument("--fit", action="store_true", help="fit on all rows of out/features.csv and save config/attribution_model.json")
    ap.add_argument("--dry-run", action="store_true", help="hold out 3 images per batch, refit, predict")
    ap.add_argument("--images", type=Path, help="flat folder of unseen images to attribute with the saved model")
    ap.add_argument("--families", default=",".join(MATERIAL_FAMILIES), help=f"comma list from {ALL_FAMILIES} (deep needs qc.deep)")
    ap.add_argument("--staged", default=None, help="two-stage model, e.g. tex:deep = baseline-or-not on tex, which variation on deep")
    ap.add_argument("--repeats", type=int, default=1, help="with --dry-run: repeat with this many held-out draws and report the spread")
    ap.add_argument("--balanced", type=int, default=None, help="also report the k-per-batch balanced assignment")
    ap.add_argument("--permutations", type=int, default=N_PERMUTATIONS)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    fams = tuple(args.families.split(","))
    staged = tuple(tuple(part.split(",")) for part in args.staged.split(":")) if args.staged else None
    if staged and len(staged) != 2:
        raise SystemExit("--staged takes two family lists separated by a colon, e.g. tex:deep")
    cfg = load_config()
    baseline = cfg.get("baseline", "Batch_3")
    if args.evaluate:
        evaluate(load_features(), n_perm=args.permutations, seed=args.seed, baseline=baseline)
        print(f"wrote {ATTRIBUTION_DIR / 'evaluation.json'} and feature_ranking.csv")
    if args.dry_run:
        rehearsal = dry_runs(load_features(), baseline, fams, repeats=args.repeats, seed=args.seed, staged=staged) if args.repeats > 1 else dry_run(load_features(), baseline, fams, seed=args.seed, staged=staged)
        print(json.dumps(rehearsal, indent=1, default=_json_default))
    if args.fit:
        model = fit_model(load_features(), baseline, fams, seed=args.seed, staged=staged)
        save_model(model)
        print(f"wrote {ATTRIBUTION_MODEL_PATH}: {len(model['features'])} features, C={model['C']}, LOSO balanced accuracy {model['loso']['balanced_accuracy']:.2f}")
    if args.images:
        model = load_model()
        if model is None:
            raise SystemExit(f"no {ATTRIBUTION_MODEL_PATH}: run --fit first")
        attribute_images(args.images, model, balanced=args.balanced)
