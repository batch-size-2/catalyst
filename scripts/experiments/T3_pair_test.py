"""T3: shared-strip pair test (docs/experiments/T3.md, MODEL_LITERATURE_REVIEW §5.2).

Do Batch_1 and Batch_2 images of one strip differ more than two same-batch images of one strip?
Label-free representations, exact rank-sum tests. Reads out/features.csv (31 known images only).

Usage: PYTHONPATH=. uv run python scripts/experiments/T3_pair_test.py
"""

import json
from itertools import combinations
from math import comb
from pathlib import Path

import numpy as np
import pandas as pd

from qc.attribute import Reducer, Standardiser, strip_group, usable_features
from qc.features import DEEP_FAMILY, MATERIAL_FAMILIES, load_features

OUT = Path("out/experiments/T3")
KNOWN = {"Batch_1", "Batch_2", "Batch_3"}
CROSS = {"B1-B2": ("Batch_1", "Batch_2"), "B2-B3": ("Batch_2", "Batch_3"), "B1-B3": ("Batch_1", "Batch_3")}


def representations(df: pd.DataFrame) -> dict[str, np.ndarray]:
    deep_cols = [c for c in df.columns if c.startswith(f"{DEEP_FAMILY}_")]
    X = df[deep_cols].to_numpy(float)
    red = Reducer(X, deep_cols)
    pcs = red(X)
    pcs = (pcs - pcs.mean(0)) / pcs.std(0, ddof=1)
    mat_cols = usable_features(df, MATERIAL_FAMILIES)
    M = df[mat_cols].apply(pd.to_numeric, errors="coerce").to_numpy(float)
    return {"deep": pcs, "material": Standardiser(M)(M)}, mat_cols


def pairs(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for i, j in combinations(range(len(df)), 2):
        a, b = df.iloc[i], df.iloc[j]
        if strip_group(a.strip_id) != strip_group(b.strip_id):
            continue
        ba, bb = sorted([a.batch, b.batch])
        kind = "same" if ba == bb else next(k for k, v in CROSS.items() if v == (ba, bb))
        rows.append({"i": i, "j": j, "strip": strip_group(a.strip_id), "kind": kind, "batch_a": ba, "batch_b": bb,
                     "image_a": a.image_id if a.batch == ba else b.image_id, "image_b": b.image_id if a.batch == ba else a.image_id})
    return pd.DataFrame(rows)


def rank_sum_p(test: np.ndarray, ref: np.ndarray) -> dict:
    """One-sided exact p: share of all size-len(test) subsets of the pooled values whose rank-sum is >= observed."""
    pooled = np.concatenate([test, ref])
    ranks = pd.Series(pooled).rank().to_numpy()
    k = len(test)
    obs = ranks[:k].sum()
    sums = np.array([ranks[list(s)].sum() for s in combinations(range(len(pooled)), k)])
    return {"p": float((sums >= obs - 1e-9).mean()), "n_subsets": comb(len(pooled), k), "rank_sum": float(obs),
            "all_above": bool(test.min() > ref.max()), "test": test.round(3).tolist(), "ref_range": [round(float(ref.min()), 3), round(float(ref.max()), 3)]}


def strip_level(p: pd.DataFrame, kind: str) -> tuple[np.ndarray, np.ndarray, list, list]:
    test = p[p.kind == kind].groupby("strip")["d"].mean()
    ref = p[p.kind == "same"].groupby("strip")["d"].mean()
    return test.to_numpy(), ref.to_numpy(), list(test.index), list(ref.index)


def feature_step(df: pd.DataFrame, p: pd.DataFrame, cols: list[str]) -> list[dict]:
    M = df[cols].apply(pd.to_numeric, errors="coerce")
    same = p[p.kind == "same"]
    cross = p[p.kind == "B1-B2"]
    diff = lambda q: np.array([M.iloc[r.j].to_numpy() - M.iloc[r.i].to_numpy() if df.iloc[r.i].batch == r.batch_a else M.iloc[r.i].to_numpy() - M.iloc[r.j].to_numpy() for r in q.itertuples()])
    sd = np.sqrt(np.nanmean(diff(same) ** 2, axis=0))  # RMS: same-batch pair signs are arbitrary
    d = diff(cross) / np.where(sd > 0, sd, np.nan)  # Batch_2 minus Batch_1, in same-batch pair SDs
    out = []
    for c, col in enumerate(cols):
        v = d[:, c]
        if np.all(np.isfinite(v)) and (np.all(v > 2) or np.all(v < -2)):
            out.append({"feature": col, "d_sd": v.round(2).tolist(), "min_abs": float(np.abs(v).min())})
    return sorted(out, key=lambda r: -r["min_abs"])[:3]


def main() -> None:
    df = load_features()
    assert set(df.batch) == KNOWN and len(df) == 31, (set(df.batch), len(df))
    df = df.sort_values(["batch", "image_id"]).reset_index(drop=True)
    reps, mat_cols = representations(df)
    base = pairs(df)
    counts = base.kind.value_counts().to_dict()
    assert counts == {"same": 18, "B2-B3": 5, "B1-B2": 3, "B1-B3": 1}, counts
    OUT.mkdir(parents=True, exist_ok=True)
    result = {"pair_counts": counts}
    for name, Z in reps.items():
        p = base.copy()
        p["d"] = [float(np.linalg.norm(Z[r.i] - Z[r.j])) for r in p.itertuples()]
        p.to_csv(OUT / f"pairs_{name}.csv", index=False)
        res = {}
        for kind in ("B1-B2", "B2-B3"):
            pair = rank_sum_p(p[p.kind == kind].d.to_numpy(), p[p.kind == "same"].d.to_numpy())
            t, r, ts, rs = strip_level(p, kind)
            strip = rank_sum_p(t, r) | {"test_strips": ts, "ref_strips": rs}
            res[kind] = {"pair_level": pair, "strip_level": strip}
        if name == "material" and res["B1-B2"]["strip_level"]["p"] < 0.05:
            res["features"] = feature_step(df, p, mat_cols)
        res["same_batch_by_strip"] = p[p.kind == "same"].groupby("strip").d.agg(["count", "mean"]).round(3).reset_index().to_dict("records")
        res["cross"] = p[p.kind != "same"][["strip", "kind", "image_a", "image_b", "d"]].round(3).to_dict("records")
        result[name] = res
    result["n_material_features"] = len(mat_cols)
    (OUT / "result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
