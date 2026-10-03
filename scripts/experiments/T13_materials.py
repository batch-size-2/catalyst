"""T13: report-only materials descriptors per image and per batch (docs/experiments/T13.md).

Usage: PYTHONPATH=. uv run python scripts/experiments/T13_materials.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

from qc.attribute import strip_group
from qc.io import iter_fields
from qc.measure import binder_profile, horizontal_pores, particles, segment, si_class_shares

OUT = Path("out/experiments/T13")
KNOWN = [Path("data/Batch_1"), Path("data/Batch_2"), Path("data/Batch_3")]
BASELINE = "Batch_3"


def interval(v: np.ndarray, level: float = 0.90) -> tuple[float, float, float]:
    v = v[np.isfinite(v)]
    m = float(v.mean())
    if len(v) < 2:
        return m, np.nan, np.nan
    h = stats.t.ppf(0.5 + level / 2, len(v) - 1) * v.std(ddof=1) / np.sqrt(len(v))
    return m, m - h, m + h


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    images, parts = [], {}
    for d in KNOWN:
        for f in iter_fields(d):
            mask = segment(f.channels, f.px_um)
            parts[f.image_id] = particles(mask, f.px_um, f.channels)
            images.append({"batch": f.batch, "image_id": f.image_id, "strip": strip_group(f.strip_id),
                           **binder_profile(mask), **horizontal_pores(mask, f.px_um)})
            print(f"{f.batch}/{f.image_id}: {len(parts[f.image_id])} particles", flush=True)
    df = pd.DataFrame(images)
    base_tex = pd.concat([parts[i] for i in df.loc[df.batch == BASELINE, "image_id"]])["texture"]
    texture_max = float(np.nanpercentile(pd.to_numeric(base_tex, errors="coerce"), 90))
    shares = pd.DataFrame([si_class_shares(parts[i], texture_max) for i in df.image_id])
    df = pd.concat([df, shares], axis=1)
    df.to_csv(OUT / "per_image.csv", index=False)

    cols = [c for c in df.columns if c.startswith(("si_share_", "binder_", "hpore_"))]
    rows = []
    for c in cols:
        base = interval(df.loc[df.batch == BASELINE, c].to_numpy(float))[0]
        base_strip = df[df.batch == BASELINE].groupby("strip")[c].mean().mean()
        for b, g in df.groupby("batch"):
            m, lo, hi = interval(g[c].to_numpy(float))
            strip_mean = g.groupby("strip")[c].mean().mean()
            differs = b != BASELINE and np.isfinite(lo) and not (lo <= base <= hi) and np.sign(m - base) == np.sign(strip_mean - base_strip)
            rows.append({"descriptor": c, "batch": b, "mean": m, "ci90_lo": lo, "ci90_hi": hi, "strip_mean": strip_mean,
                         "n_images": len(g), "n_strips": g.strip.nunique(), "differs_from_baseline": bool(differs)})
    summary = pd.DataFrame(rows)
    summary.to_csv(OUT / "summary.csv", index=False)
    rank = df.sort_values("si_share_dim_ragged", ascending=False)[["batch", "image_id", "strip", "si_share_dim_ragged"]].head(5)
    sanity = set(rank.head(2).strip) == {"2316"}
    (OUT / "result.json").write_text(json.dumps({"texture_max": texture_max, "sanity_2316_top2": sanity,
                                                "top5_dim_ragged": rank.to_dict("records")}, indent=2, default=float))
    print(f"texture_max (Batch_3 p90) = {texture_max:.3f}; strip 2316 top 2 on dim_ragged: {sanity}")
    print(rank.to_string(index=False))
    print(summary.round(4).to_string(index=False))


if __name__ == "__main__":
    main()
