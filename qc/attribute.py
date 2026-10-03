"""Batch attribution and baseline distance (PLAN_v4 §3.15-3.16). Owned by the ML engineer.

Answers two questions, kept apart from the QC verdict in qc/decide.py:

  1. Which known batch does an unseen image look like? A standardised, L2-regularised multinomial
     logistic regression on the per-image features from qc/features.py (material families only by
     default). Evaluated with leave-one-strip-out CV, a permutation null over strip segments and a
     shared-strip check. The fitted coefficients are saved as JSON so every prediction is auditable.
  2. Is it inside the baseline's (Batch_3) distribution at all? Two-sided z-scores per feature against
     the baseline strip segments, a root-mean-square z distance, and an "unfamiliar" flag calibrated
     on the baseline's own leave-one-strip-out distances. An image can be confidently attributed and
     still be unfamiliar; both are reported.

Rule 2 of PLAN_v3 ("no classifier trained on batch folders") is relaxed by PLAN_v4 for this track
only: the accept/reject verdict is still the statistical comparison in qc/decide.py.

Usage:
  uv run python -m qc.attribute --evaluate [--families reg,tex,...]   # out/attribution/evaluation.json
  uv run python -m qc.attribute --fit                                  # config/attribution_model.json
  uv run python -m qc.attribute --dry-run [--seed 0]                   # hold out 3 images per batch, refit, predict
  uv run python -m qc.attribute --images data/<drop> [--balanced 3]    # out/attribution/<drop>.json
"""

import json
import time
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from sklearn.linear_model import LogisticRegression

from qc.features import FAMILIES, MATERIAL_FAMILIES, META_COLUMNS, assert_no_leakage, family_of, feature_columns, load_features
from qc.schema import ATTRIBUTION_DIR, ATTRIBUTION_MODEL_PATH, attribution_path, load_config

C_GRID = (0.01, 0.03, 0.1, 0.3, 1.0)
N_PERMUTATIONS = 200
MIN_FRACTION_FINITE = 0.8     # features with fewer finite values are dropped before fitting
UNFAMILIAR_QUANTILE = 1.0     # flag threshold = this quantile of the baseline's own held-out distances
Z_FLAG = 2.0                  # |z| beyond which a feature is listed as deviating from the baseline
N_REASONS = 5


# ---------------------------------------------------------------- groups and matrices

def strip_group(strip_id) -> str:
    """The physical strip: strip_id without the XResolution suffix (same rule as types.fit_types)."""
    return str(strip_id).split("_")[0]


def segments_of(df: pd.DataFrame) -> pd.Series:
    """(batch, strip) segment label per row: the unit for permutations (PLAN_v3 §3.5)."""
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


def loso_cv(df: pd.DataFrame, families=MATERIAL_FAMILIES, features: list[str] | None = None, seed: int = 0, nested: bool = True) -> dict:
    """Leave-one-strip-out: every fold holds out all images of one physical strip, in every batch.

    Standardisation is fit inside each fold. C is chosen by an inner LOSO when `nested`.
    """
    features = features or usable_features(df, families)
    X, y, groups = _matrix(df, features), df["batch"].to_numpy(str), df["strip_id"].map(strip_group).to_numpy(str)
    classes = sorted(np.unique(y))
    pred = np.empty(len(y), dtype=object)
    probs = np.full((len(y), len(classes)), np.nan)
    chosen = []
    for g in np.unique(groups):
        test = groups == g
        if len(np.unique(y[~test])) < 2:
            pred[test] = classes[0]
            continue
        std = Standardiser(X[~test])
        Ztr, Zte = std(X[~test]), std(X[test])
        C = _choose_c(Ztr, y[~test], groups[~test], seed=seed) if nested else C_GRID[2]
        chosen.append(C)
        model = _fit_lr(Ztr, y[~test], C, seed)
        pred[test] = model.predict(Zte)
        p = model.predict_proba(Zte)
        for j, c in enumerate(model.classes_):
            probs[test, classes.index(c)] = p[:, j]
    per_image = pd.DataFrame(
        {"batch": y, "image_id": df["image_id"].to_numpy(), "strip": groups, "predicted": pred.astype(str), "correct": pred.astype(str) == y}
    )
    for j, c in enumerate(classes):
        per_image[f"p_{c}"] = probs[:, j]
    return {
        "families": list(families),
        "n_features": len(features),
        "n_images": int(len(y)),
        "n_strips": int(len(np.unique(groups))),
        "balanced_accuracy": balanced_accuracy(y, pred.astype(str)),
        "confusion": confusion(y, pred.astype(str), classes),
        "chosen_C": sorted(set(chosen)),
        "per_image": per_image,
    }


def permutation_null(df: pd.DataFrame, families=MATERIAL_FAMILIES, n: int = N_PERMUTATIONS, seed: int = 0, features=None) -> dict:
    """Balanced accuracy of the same LOSO pipeline when batch labels are shuffled across strip segments.

    Labels move with whole segments so the strip structure of the null matches the data. Fixed C
    (middle of the grid) to keep it affordable; the real run with nested C is compared against it.
    """
    rng = np.random.default_rng(seed)
    features = features or usable_features(df, families)
    seg = segments_of(df)
    seg_batch = df.groupby(seg)["batch"].first()
    scores = []
    for _ in range(n):
        shuffled = pd.Series(rng.permutation(seg_batch.to_numpy()), index=seg_batch.index)
        fake = df.copy()
        fake["batch"] = seg.map(shuffled).to_numpy()
        if fake["batch"].nunique() < 2:
            continue
        scores.append(loso_cv(fake, families, features=features, seed=seed, nested=False)["balanced_accuracy"])
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


def evaluate(df: pd.DataFrame, families_sets: dict[str, tuple] | None = None, n_perm: int = N_PERMUTATIONS, seed: int = 0, out_dir: Path = ATTRIBUTION_DIR) -> dict:
    """The whole feature-discovery report: LOSO per family set, nulls, shared strips, feature ranking."""
    families_sets = families_sets or {
        "regional": ("reg",), "edge": ("edge",), "texture": ("tex",), "particles": ("par",), "kpis": ("kpi",),
        "imaging": ("img",), "material": MATERIAL_FAMILIES, "all": FAMILIES,
    }
    report: dict = {"n_images": int(len(df)), "batches": sorted(df["batch"].unique()), "family_sets": {}}
    for name, fams in families_sets.items():
        if not usable_features(df, fams):
            continue
        t = time.time()
        cv = loso_cv(df, fams, seed=seed)
        null = permutation_null(df, fams, n=n_perm, seed=seed) if n_perm else None
        report["family_sets"][name] = {
            k: v for k, v in cv.items() if k != "per_image"
        } | {"null": null, "above_null": bool(null and cv["balanced_accuracy"] > null["p95"]), "shared_strips": shared_strip_check(df, cv), "seconds": round(time.time() - t, 1)}
        print(f"{name:10s} acc={cv['balanced_accuracy']:.2f} null95={null['p95'] if null else float('nan'):.2f} features={cv['n_features']}")
    ranking = rank_features(df)
    report["top_features"] = ranking.to_dict(orient="records")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "evaluation.json").write_text(json.dumps(report, indent=1, default=_json_default))
    ranking.to_csv(out_dir / "feature_ranking.csv", index=False)
    return report


# ---------------------------------------------------------------- model

def fit_model(df: pd.DataFrame, baseline: str, families=MATERIAL_FAMILIES, seed: int = 0, C: float | None = None) -> dict:
    """Fits on every row of `df` and returns a JSON-serialisable model with its own LOSO estimate.

    Includes the baseline-distance calibration: per-feature mean/SD of the baseline strip segments and
    the unfamiliar threshold (max held-out RMS-z distance of the baseline's own images).
    """
    features = usable_features(df, families)
    X, y, groups = _matrix(df, features), df["batch"].to_numpy(str), df["strip_id"].map(strip_group).to_numpy(str)
    std = Standardiser(X)
    Z = std(X)
    C = C or _choose_c(Z, y, groups, seed=seed)
    lr = _fit_lr(Z, y, C, seed)
    cv = loso_cv(df, families, features=features, seed=seed)
    base = baseline_stats(df, features, baseline)
    return {
        "version": "v4-draft",
        "fitted_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "families": list(families),
        "features": features,
        "classes": [str(c) for c in lr.classes_],
        "baseline": baseline,
        "C": C,
        "mean": std.mean.tolist(),
        "sd": std.sd.tolist(),
        "coef": lr.coef_.tolist(),
        "intercept": lr.intercept_.tolist(),
        "trained_on": {b: sorted(df.loc[df["batch"] == b, "image_id"].astype(str)) for b in lr.classes_},
        "loso": {"balanced_accuracy": cv["balanced_accuracy"], "confusion": cv["confusion"], "n_strips": cv["n_strips"]},
        "baseline_stats": base,
    }


def baseline_stats(df: pd.DataFrame, features: list[str], baseline: str) -> dict:
    """Mean/SD per feature over the baseline's strip segments, and the unfamiliar threshold.

    Threshold: for each baseline strip, standardise by the other baseline strips and take the RMS z of
    its images; the UNFAMILIAR_QUANTILE of those distances is the threshold. Images of the baseline
    itself therefore sit at or below it (apart from the quantile's tail).
    """
    ref = df[df["batch"].astype(str) == str(baseline)]
    if ref.empty:
        return {"n_segments": 0, "mean": None, "sd": None, "threshold": None, "held_out_distances": []}
    seg = ref["strip_id"].map(strip_group)
    seg_means = ref.groupby(seg)[features].mean(numeric_only=True)
    mean = seg_means.mean().to_numpy(float)
    sd = seg_means.std(ddof=1).to_numpy(float) if len(seg_means) > 1 else np.full(len(features), np.nan)
    sd = np.where(np.isfinite(sd) & (sd > 0), sd, np.nan)
    distances = []
    for s in seg_means.index:
        others = seg_means.drop(index=s)
        if len(others) < 2:
            continue
        m, d = others.mean().to_numpy(float), others.std(ddof=1).to_numpy(float)
        d = np.where(np.isfinite(d) & (d > 0), d, np.nan)
        Xs = _matrix(ref[seg == s], features)
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


def predict(model: dict, feats: pd.DataFrame, balanced: int | None = None) -> pd.DataFrame:
    """One row per image: probabilities, predicted batch, top reasons, baseline distance, unfamiliar flag.

    `balanced=k` additionally reports `assigned`: the joint assignment with exactly k images per
    class that maximises the summed log-probability (for the designed 3-per-batch test).
    """
    features, classes = model["features"], model["classes"]
    X = feats.reindex(columns=features).apply(pd.to_numeric, errors="coerce").to_numpy(float)
    Z = np.nan_to_num((X - np.asarray(model["mean"])) / np.asarray(model["sd"]))
    coef, intercept = np.asarray(model["coef"]), np.asarray(model["intercept"])
    logits = Z @ coef.T + intercept
    if coef.shape[0] == 1:  # binary: sklearn stores one row for classes[1]
        logits = np.column_stack([-logits[:, 0], logits[:, 0]])
        coef = np.vstack([-coef, coef])
    probs = np.exp(logits - logits.max(axis=1, keepdims=True))
    probs /= probs.sum(axis=1, keepdims=True)
    pred_idx = probs.argmax(axis=1)
    rows = []
    for i in range(len(feats)):
        k = pred_idx[i]
        contrib = coef[k] * Z[i]
        order = np.argsort(-np.abs(contrib))[:N_REASONS]
        reasons = [{"feature": features[j], "z": round(float(Z[i, j]), 2), "contribution": round(float(contrib[j]), 3)} for j in order if contrib[j] != 0]
        dist = baseline_distance(model, X[i])
        rows.append(
            {
                "batch": feats["batch"].iloc[i] if "batch" in feats else None,
                "image_id": feats["image_id"].iloc[i],
                "strip_id": feats["strip_id"].iloc[i] if "strip_id" in feats else None,
                **{f"p_{c}": float(probs[i, j]) for j, c in enumerate(classes)},
                "predicted": classes[k],
                "confidence": float(probs[i, k]),
                "reasons": reasons,
                **dist,
            }
        )
    out = pd.DataFrame(rows)
    if balanced:
        out["assigned"] = balanced_assignment(probs, classes, balanced)
    return out


def baseline_distance(model: dict, x: np.ndarray) -> dict:
    """Two-sided view against the baseline: RMS z over the model's features, deviating features, flag."""
    bs = model.get("baseline_stats") or {}
    if not bs.get("mean"):
        return {"baseline_distance": np.nan, "unfamiliar": None, "deviations": []}
    mean = np.array([np.nan if v is None else v for v in bs["mean"]], float)
    sd = np.array([np.nan if v is None else v for v in bs["sd"]], float)
    z = (x - mean) / sd
    order = np.argsort(-np.abs(np.nan_to_num(z)))
    deviations = [
        {"feature": model["features"][j], "z": round(float(z[j]), 2), "direction": "above" if z[j] > 0 else "below"}
        for j in order[:N_REASONS] if np.isfinite(z[j]) and abs(z[j]) >= Z_FLAG
    ]
    dist = _rms_z(z)
    threshold = bs.get("threshold")
    return {
        "baseline_distance": dist,
        "baseline_threshold": threshold,
        "unfamiliar": bool(dist > threshold) if threshold is not None and np.isfinite(dist) else None,
        "n_deviating": int(np.sum(np.abs(z[np.isfinite(z)]) >= Z_FLAG)),
        "deviations": deviations,
    }


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

def dry_run(df: pd.DataFrame, baseline: str, families=MATERIAL_FAMILIES, per_batch: int = 3, seed: int = 0, balanced: bool = True) -> dict:
    """Rehearsal of the designed test: hold out `per_batch` images per batch (whole strips where
    possible, so held-out images never share a strip with training), refit, predict, score."""
    rng = np.random.default_rng(seed)
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
    test, train = df.loc[held], df.drop(index=held)
    model = fit_model(train, baseline, families, seed=seed)
    pred = predict(model, test, balanced=per_batch if balanced else None)
    truth = pred["batch"].astype(str).to_numpy()
    result = {
        "held_out": pred[["batch", "image_id", "strip_id", "predicted", "confidence", "unfamiliar"]].to_dict(orient="records"),
        "balanced_accuracy": balanced_accuracy(truth, pred["predicted"].to_numpy(str)),
        "train_loso": model["loso"]["balanced_accuracy"],
        "C": model["C"],
    }
    if balanced:
        result["balanced_assignment_accuracy"] = balanced_accuracy(truth, pred["assigned"].to_numpy(str))
    return result


def attribute_images(image_dir: Path, model: dict, balanced: int | None = None) -> dict:
    """Features + prediction for every field in a flat folder; writes out/attribution/<folder>.json."""
    from qc.features import build_features

    feats = build_features([image_dir], lambda d, t, s: print(f"[{d}/{t}] {s}"))
    pred = predict(model, feats, balanced=balanced)
    result = {
        "run": image_dir.name,
        "model": {"fitted_at": model["fitted_at"], "classes": model["classes"], "baseline": model["baseline"], "loso_balanced_accuracy": model["loso"]["balanced_accuracy"]},
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
    ap.add_argument("--families", default=",".join(MATERIAL_FAMILIES), help=f"comma list from {FAMILIES}")
    ap.add_argument("--balanced", type=int, default=None, help="also report the k-per-batch balanced assignment")
    ap.add_argument("--permutations", type=int, default=N_PERMUTATIONS)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    fams = tuple(args.families.split(","))
    cfg = load_config()
    baseline = cfg.get("baseline", "Batch_3")
    if args.evaluate:
        evaluate(load_features(), n_perm=args.permutations, seed=args.seed)
        print(f"wrote {ATTRIBUTION_DIR / 'evaluation.json'} and feature_ranking.csv")
    if args.dry_run:
        print(json.dumps(dry_run(load_features(), baseline, fams, seed=args.seed), indent=1, default=_json_default))
    if args.fit:
        model = fit_model(load_features(), baseline, fams, seed=args.seed)
        save_model(model)
        print(f"wrote {ATTRIBUTION_MODEL_PATH}: {len(model['features'])} features, C={model['C']}, LOSO balanced accuracy {model['loso']['balanced_accuracy']:.2f}")
    if args.images:
        model = load_model()
        if model is None:
            raise SystemExit(f"no {ATTRIBUTION_MODEL_PATH}: run --fit first")
        attribute_images(args.images, model, balanced=args.balanced)
