"""T2: dark-graphite share in InLens, and how much the deep stage leans on it (docs/experiments/T2.md).

Usage:
  PYTHONPATH=. uv run python scripts/experiments/T2_dark_graphite.py            # steps 1-4, the 31 known images
  PYTHONPATH=. uv run python scripts/experiments/T2_dark_graphite.py --unseen   # step 5, report-only
"""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

from qc import attribute as A
from qc.features import MATERIAL_FAMILIES, load_features
from qc.io import iter_fields
from qc.measure import dark_graphite_share, segment

OUT = Path("out/experiments/T2")
KNOWN = [Path("data/Batch_1"), Path("data/Batch_2"), Path("data/Batch_3")]
UNSEEN = Path("data/Hackathon-Polaron-test")
SHARES = ["dark_graphite_share", "dark_graphite_share_top"]
COV = "img_inlens_dark_graphite_share"  # img_ family: never in a model family, so no leakage into the fit
N_PERM = 200


def measure(dirs: list[Path]) -> pd.DataFrame:
    rows = []
    for d in dirs:
        for f in iter_fields(d):
            rows.append({"batch": f.batch, "image_id": f.image_id, "strip": A.strip_group(f.strip_id),
                         **dark_graphite_share(segment(f.channels, f.px_um), f.channels)})
            print(f"{f.batch}/{f.image_id}: {rows[-1]['dark_graphite_share']:.3f}", flush=True)
    return pd.DataFrame(rows)


def correlations(df: pd.DataFrame, shares: pd.DataFrame) -> pd.DataFrame:
    part = A.model_parts(A.load_model())["variation"]
    Xr = A.Reducer.from_json(part["features"], part["reducer"])(A._matrix(df, part["features"]))
    names = A.Reducer.from_json(part["features"], part["reducer"]).names
    pcs = pd.DataFrame(Xr[:, A._deep_pcs(names)], columns=[n for n in names if n.startswith("deep_pc")])
    m = shares.set_index("image_id").loc[df["image_id"]].reset_index()
    others = {c: df[c].to_numpy(float) for c in df.columns if c.startswith("img_")}
    rows = []
    for pc in pcs.columns:
        for name, v in {**{s: m[s].to_numpy(float) for s in SHARES}, **others}.items():
            ok = np.isfinite(v) & np.isfinite(pcs[pc].to_numpy())
            if ok.sum() < 5 or np.std(v[ok]) == 0:
                continue
            rows.append({"pc": pc, "with": name, "pearson": pearsonr(pcs[pc][ok], v[ok])[0], "spearman": spearmanr(pcs[pc][ok], v[ok])[0]})
    return pd.DataFrame(rows)


def loso_runs(df: pd.DataFrame) -> dict:
    staged = (MATERIAL_FAMILIES, ("deep",))
    out = {}
    for name, kw in {"deep": {"families": ("deep",)}, "material>deep": {"staged": staged, "baseline": "Batch_3"}}.items():
        for resid in (None, [COV]):
            key = f"{name}{' | resid' if resid else ''}"
            cv = A.loso_cv(df, residualize=resid, **kw)
            out[key] = {"balanced_accuracy": cv["balanced_accuracy"], "confusion": cv["confusion"], "chosen_C": cv["chosen_C"]}
            if resid:
                out[key]["null"] = A.permutation_null(df, n=N_PERM, seed=0, residualize=resid, **kw)
            print(key, json.dumps(out[key]), flush=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--unseen", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.unseen:
        s = measure([UNSEEN])
        s.to_csv(OUT / "dark_share_unseen.csv", index=False)
        print(s.to_string())
        return
    shares = measure(KNOWN)
    shares.to_csv(OUT / "dark_share.csv", index=False)
    summary = shares.groupby("batch")[SHARES].agg(["min", "median", "max"]).round(3)
    by_strip = shares.groupby(["strip", "batch"])[SHARES].mean().round(3)
    print(summary.to_string(), "\n", by_strip.to_string())
    df = load_features()
    assert set(df.batch) == {"Batch_1", "Batch_2", "Batch_3"} and len(df) == 31
    df[COV] = shares.set_index("image_id").loc[df["image_id"], "dark_graphite_share"].to_numpy()
    corr = correlations(df.drop(columns=[COV]), shares)
    corr.to_csv(OUT / "correlations.csv", index=False)
    top = corr[corr["with"].isin(SHARES)].pivot(index="pc", columns="with", values=["pearson", "spearman"]).round(2)
    print(top.to_string())
    runs = loso_runs(df)
    (OUT / "result.json").write_text(json.dumps({"summary": json.loads(summary.to_json()),
                                                "runs": runs}, indent=2, default=float))


if __name__ == "__main__":
    main()
