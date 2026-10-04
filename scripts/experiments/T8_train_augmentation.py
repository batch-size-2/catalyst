"""T8: train-time augmentation with T1's perturbed copies (docs/experiments/T8.md).

Usage:
  PYTHONPATH=.:scripts/experiments uv run python scripts/experiments/T8_train_augmentation.py --compute    # missing copies
  PYTHONPATH=.:scripts/experiments uv run python scripts/experiments/T8_train_augmentation.py --evaluate   # 6 entries + nulls
"""

import argparse
import json
import time
import zlib
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

import T1_invariance_audit as T1
from qc import attribute as A
from qc import deep as D
from qc.features import MATERIAL_FAMILIES, load_features

OUT = Path("out/experiments/T8")
NUISANCE = ("noise5", "blur1", "gain120", "gamma125", "shade125", "curtain", "hflip")
N_PERM = 200
NULL_C = A.C_GRID[2]
BASELINE = "Batch_3"
CLASSES = ["Batch_1", "Batch_2", "Batch_3"]


# ---------------------------------------------------------------- copies

def dg_kind(share: float) -> str:
    return "dg_remove" if share > 0.1 else "dg_add"


def compute() -> None:
    fields = T1.load_fields()
    shares = pd.read_csv(T1.SHARES_PATH).set_index("image_id")["dark_graphite_share"].to_dict()
    cache = T1.read_cache()
    done = set(zip(cache["image_id"], cache["perturbation"]))
    jobs = [(i, p) for i in sorted(fields) for p in NUISANCE] + [(i, dg_kind(shares[i])) for i in sorted(fields)]
    pending = [j for j in jobs if j not in done]
    print(f"{len(pending)} copies to compute", flush=True)
    embed = D.default_embed()
    t0 = time.time()
    for n, (image_id, p) in enumerate(pending, 1):
        f = fields[image_id]
        row = T1.feature_row(replace(f, channels=T1.PERTURBATIONS[p](f, T1.rng_for(image_id, p))), embed)
        row["perturbation"] = p
        cache = pd.concat([cache, pd.DataFrame([row])], ignore_index=True)
        if n % 5 == 0 or n == len(pending):
            T1.write_cache(cache)
            print(f"  {n}/{len(pending)} ({(time.time() - t0) / n:.1f} s each), last {image_id}:{p}", flush=True)


# ---------------------------------------------------------------- augmented fit (mirrors attribute._fit_part)

def _jitter(Z: np.ndarray, names: list[str], image_ids, sigma: dict[str, float], k: int) -> np.ndarray:
    fam = np.array([sigma["deep PCs"] if n.startswith("deep_pc") else sigma.get(n.split("_", 1)[0], 0.0) for n in names])
    out = []
    for j in range(k):
        noise = np.vstack([np.random.default_rng(zlib.crc32(f"{i}:jitter{j}".encode())).normal(size=Z.shape[1]) for i in image_ids])
        out.append(Z + noise * fam)
    return np.vstack(out)


def fit_part(orig: pd.DataFrame, copies: pd.DataFrame, y_of, features: list[str], C: float, jitter: dict | None = None) -> dict:
    """Reducer and scaler on the originals; logistic regression on originals + copies, each image weighing 1."""
    X = A._matrix(orig, features)
    red = A.Reducer(X, features)
    std = A.Standardiser(red(X))
    y = y_of(orig)
    part = {"features": list(features), "model_features": red.names, "reducer": red.to_json(), "classes": sorted(set(y)), "C": C, "mean": std.mean, "sd": std.sd}
    if len(part["classes"]) < 2:
        return part | {"coef": np.zeros((1, len(red.names))), "intercept": np.zeros(1)}
    Zo = std(red(X))
    if jitter is not None:
        k = jitter["k"]
        Zc, yc, wc = _jitter(Zo, red.names, orig["image_id"], jitter["sigma"], k), np.tile(y, k), np.full(len(y) * k, 1 / (1 + k))
        w = np.full(len(y), 1 / (1 + k))
    else:
        Zc = std(red(A._matrix(copies, features))) if len(copies) else np.empty((0, Zo.shape[1]))
        yc = y_of(copies)
        k_per = copies["image_id"].value_counts().reindex(orig["image_id"]).fillna(0).to_numpy()
        w = 1 / (1 + k_per)
        wc = 1 / (1 + copies["image_id"].map(copies["image_id"].value_counts()).to_numpy()) if len(copies) else np.empty(0)
    lr = LogisticRegression(C=C, class_weight="balanced", max_iter=5000, random_state=0)
    lr.fit(np.vstack([Zo, Zc]), np.concatenate([y, yc]), sample_weight=np.concatenate([w, wc]))
    return part | {"classes": [str(c) for c in lr.classes_], "coef": lr.coef_, "intercept": lr.intercept_}


def fit_parts(orig, copies, feats, C, jitter=None) -> dict:
    if not isinstance(feats, tuple):
        return {"all": fit_part(orig, copies, lambda d: d["batch"].to_numpy(str), feats, C, jitter)}
    stage1 = lambda d: np.where(d["batch"].to_numpy(str) == BASELINE, BASELINE, A.other_label(BASELINE))
    rest_o, rest_c = orig[orig.batch != BASELINE], copies[copies.batch != BASELINE]
    return {"baseline": fit_part(orig, copies, stage1, feats[0], C if not isinstance(C, dict) else C["baseline"], jitter),
            "variation": fit_part(rest_o, rest_c, lambda d: d["batch"].to_numpy(str), feats[1], C if not isinstance(C, dict) else C["variation"], jitter)}


def proba(parts, rows) -> np.ndarray:
    return np.nan_to_num(A._parts_proba(parts, rows, CLASSES, BASELINE if "baseline" in parts else None), nan=0.0)


def choose_c(orig, copies, feats, jitter) -> float:
    groups = orig["strip_id"].map(A.strip_group).to_numpy()
    best, best_c = -1.0, A.C_GRID[0]
    for C in A.C_GRID:
        pred = np.empty(len(orig), dtype=object)
        for g in np.unique(groups):
            te = groups == g
            tr = orig[~te]
            if tr["batch"].nunique() < 2:
                pred[te] = CLASSES[0]
                continue
            parts = fit_parts(tr, copies[copies.image_id.isin(tr.image_id)], feats, C, jitter)
            pred[te] = [CLASSES[j] for j in proba(parts, orig[te]).argmax(1)]
        acc = A.balanced_accuracy(orig["batch"].to_numpy(str), pred.astype(str))
        if acc > best + 1e-9:
            best, best_c = acc, C
    return best_c


def loso(orig, copies, feats, jitter=None, nested=True, eval_copies=None) -> dict:
    groups = orig["strip_id"].map(A.strip_group).to_numpy()
    probs = np.zeros((len(orig), 3))
    flips = {}
    for g in np.unique(groups):
        te = groups == g
        tr = orig[~te]
        tr_c = copies[copies.image_id.isin(tr.image_id)]
        C = choose_c(tr, tr_c, feats, jitter) if nested else NULL_C
        parts = fit_parts(tr, tr_c, feats, C, jitter)
        probs[te] = proba(parts, orig[te])
        if eval_copies is not None:
            held = orig[te].set_index("image_id")
            for pert, batch in (("noise5", BASELINE), ("blur1", BASELINE), ("dg_add", "Batch_1")):
                ec = eval_copies[(eval_copies.perturbation == pert) & eval_copies.image_id.isin(held.index[held.batch == batch])]
                if not len(ec):
                    continue
                p0 = proba(parts, held.loc[ec.image_id].reset_index())
                p1 = proba(parts, ec)
                key = f"{pert}x{batch}"
                d = flips.setdefault(key, {"n": 0, "predicted": 0, "stage_baseline": 0})
                d["n"] += len(ec)
                d["predicted"] += int((p0.argmax(1) != p1.argmax(1)).sum())
                d["stage_baseline"] += int(((p0[:, 2] >= 0.5) != (p1[:, 2] >= 0.5)).sum())
    pred = np.array(CLASSES)[probs.argmax(1)]
    y = orig["batch"].to_numpy(str)
    conf = probs.max(1)
    tiers = {t: {"right": int(((conf >= lo) & (conf < hi) & (pred == y)).sum()), "n": int(((conf >= lo) & (conf < hi)).sum())}
             for t, lo, hi in (("high", 0.75, 9), ("medium", 0.5, 0.75), ("low", 0, 0.5))}
    return {"balanced_accuracy": A.balanced_accuracy(y, pred), "right_per_batch": {b: int(((y == b) & (pred == b)).sum()) for b in CLASSES},
            "tiers": tiers, "flips": flips}


def evaluate() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cache = T1.read_cache()
    orig = load_features()
    assert set(orig.batch) == set(CLASSES) and len(orig) == 31
    orig = orig.reset_index(drop=True)
    meta = orig.set_index("image_id")[["batch", "strip_id"]]
    cache = cache[cache.perturbation != "none"].copy()
    cache["batch"] = cache["image_id"].map(meta["batch"])
    cache["strip_id"] = cache["image_id"].map(meta["strip_id"])
    shares = pd.read_csv(T1.SHARES_PATH).set_index("image_id")["dark_graphite_share"]
    nuis = cache[cache.perturbation.isin(NUISANCE)]
    dg = cache[cache.perturbation == cache.image_id.map(lambda i: dg_kind(shares[i]))]
    assert nuis.groupby("image_id").size().eq(len(NUISANCE)).all() and len(nuis.image_id.unique()) == 31, "missing nuisance copies: run --compute"
    assert dg.image_id.nunique() == 31, "missing dark-graphite copies: run --compute"
    drift = pd.read_csv(T1.DRIFT_PATH).set_index("perturbation").loc[list(NUISANCE)].median(numeric_only=True)
    sigma = {k: float(drift[k]) for k in ("tex", "reg", "par", "kpi", "edge", "deep PCs")}
    arms = {"a": {"copies": nuis}, "b": {"copies": pd.concat([nuis, dg])}, "c": {"copies": nuis.iloc[:0], "jitter": {"k": len(NUISANCE), "sigma": sigma}}}
    models = {"deep": A.usable_features(orig, ("deep",)),
              "material>deep": (A.usable_features(orig, MATERIAL_FAMILIES), A.usable_features(orig, ("deep",)))}
    res = {"sigma_jitter": sigma}
    for an, arm in arms.items():
        for mn, feats in models.items():
            r = loso(orig, arm["copies"], feats, arm.get("jitter"), nested=True, eval_copies=cache)
            res[f"{an} | {mn}"] = r
            print(an, mn, json.dumps(r), flush=True)
            (OUT / "result.json").write_text(json.dumps(res, indent=2, default=float))
    # nulls: same shuffles for all 6 entries; copies inherit the shuffled label
    rng = np.random.default_rng(0)
    seg = A.segments_of(orig)
    seg_batch = orig.groupby(seg)["batch"].first()
    scores = {k: [] for k in res if "|" in k}
    for s in range(N_PERM):
        shuffled = pd.Series(rng.permutation(seg_batch.to_numpy()), index=seg_batch.index)
        fake = orig.copy()
        fake["batch"] = seg.map(shuffled).to_numpy()
        if fake.batch.nunique() < 3:
            continue
        lab = fake.set_index("image_id")["batch"]
        for an, arm in arms.items():
            c = arm["copies"].copy()
            c["batch"] = c["image_id"].map(lab)
            for mn, feats in models.items():
                scores[f"{an} | {mn}"].append(loso(fake, c, feats, arm.get("jitter"), nested=False)["balanced_accuracy"])
        if (s + 1) % 20 == 0:
            print(f"null {s + 1}/{N_PERM}", flush=True)
    S = pd.DataFrame(scores)
    res["null"] = {k: {"p95": float(np.percentile(S[k], 95)), "mean": float(S[k].mean())} for k in S}
    res["null_best_of_6"] = {"p95": float(np.percentile(S.max(axis=1), 95)), "n": len(S)}
    (OUT / "result.json").write_text(json.dumps(res, indent=2, default=float))
    print(json.dumps({"null": res["null"], "best_of_6": res["null_best_of_6"]}, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--compute", action="store_true")
    ap.add_argument("--evaluate", action="store_true")
    a = ap.parse_args()
    if a.compute:
        compute()
    if a.evaluate:
        evaluate()
