"""Sampling and segmentation uncertainty for the descriptors (PLAN_v4 §3.6).

The integral range of a phase (area under its 2D normalised autocorrelation) predicts how much
the measured phase fraction varies with imaged area -- the "how many images are enough" estimate.

Usage: uv run python -m qc.uncertainty --batch data/Batch_3
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from qc.io import iter_fields
from qc.measure import (
    default_thresholds,
    kpis,
    segment,
    two_point,
    valid_rows,
)
from qc.schema import KPI_UNITS, OUT_DIR, Phase

SUBSAMPLE = 4


def threshold_variants(
    channels: dict[str, np.ndarray], px_um: float, offsets: tuple = (-5, 5)
) -> dict[int, dict[str, float]]:
    """KPIs re-measured with both segmentation thresholds shifted by `offsets` grey levels (incl. 0)."""
    t0, t1 = default_thresholds(channels)
    return {
        off: kpis(
            segment(channels, px_um, thresholds=(t0 + off, t1 + off)), px_um, channels
        )
        for off in (0, *offsets)
    }


def integral_range(mask: np.ndarray, px_um: float, phase: Phase) -> dict:
    """phi, integral range (um^2), valid area and predicted phase-fraction SD for one image.

    a_int = integral of the 2D normalised autocorrelation C(h) over |h| <= CORR_RMAX_UM,
    computed as the angular integral 2*pi*int r*C(r) dr (identical for any media; the radial
    mean is the angular integral of the 2D C) and truncated at the first zero crossing --
    the raw uniform-weighted sum is badly biased by the noisy large-lag tail.
    """
    sub = mask[valid_rows(mask.shape[0])][::SUBSAMPLE, ::SUBSAMPLE]
    px = px_um * SUBSAMPLE
    w = sub != Phase.IGNORE
    x = sub == phase
    valid_area = float(w.sum() * px**2)
    phi = float(x.sum() / w.sum()) if w.sum() else np.nan
    r_um, c = two_point(mask, phase, px_um)
    if not w.sum() or phi <= 0 or phi >= 1 or not np.isfinite(c[0]):
        return {"phi": phi, "a_int_um2": np.nan, "valid_area_um2": valid_area, "predicted_sd": np.nan}
    below = np.nonzero(c <= 0)[0]
    stop = int(below[0]) if len(below) else len(c)
    a_int = float(np.trapezoid(2 * np.pi * r_um[:stop] * c[:stop], r_um[:stop]))
    return {
        "phi": phi,
        "a_int_um2": a_int,
        "valid_area_um2": valid_area,
        "predicted_sd": float(np.sqrt(phi * (1 - phi) * a_int / valid_area)) if a_int > 0 else np.nan,
    }


def area_needed(phi: float, a_int_um2: float, target_sd: float) -> float:
    """Imaged area (um^2) needed to reach `target_sd` on the phase fraction."""
    return float(phi * (1 - phi) * a_int_um2 / target_sd**2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Segmentation + sampling uncertainty per image.")
    parser.add_argument("--batch", type=Path, default=Path("data/Batch_3"))
    args = parser.parse_args()
    out_dir = OUT_DIR / "uncertainty"
    out_dir.mkdir(parents=True, exist_ok=True)
    variant_rows, range_rows = [], []
    for field in iter_fields(args.batch):
        try:
            t0, t1 = default_thresholds(field.channels)
            base = {"batch": field.batch, "image_id": field.image_id, "strip_id": field.strip_id}
            masks = {}
            for off in (0, -5, 5):
                masks[off] = segment(field.channels, field.px_um, thresholds=(t0 + off, t1 + off))
                variant_rows.append(base | {"offset": off} | kpis(masks[off], field.px_um, field.channels))
            for phase in (Phase.SI, Phase.PORE):
                range_rows.append(base | {"phase": phase.name} | integral_range(masks[0], field.px_um, phase))
        except Exception as error:
            print(f"  ! {field.batch}/{field.image_id}: {error!r}")
    variants = pd.DataFrame(variant_rows)
    variants.to_csv(out_dir / "threshold_variants.csv", index=False)
    pd.DataFrame(range_rows).to_csv(out_dir / "integral_range.csv", index=False)
    print(f"wrote {out_dir}/threshold_variants.csv and integral_range.csv")
    print("mean |shift| of thresholds +/-5 vs 0:")
    by_image = variants.set_index(["image_id", "offset"])
    for kpi in KPI_UNITS:
        diffs = [
            abs(by_image.loc[(img, o), kpi] - by_image.loc[(img, 0), kpi])
            for img in by_image.index.levels[0]
            for o in (-5, 5)
            if (img, o) in by_image.index and (img, 0) in by_image.index
        ]
        print(f"  {kpi:24s} {np.nanmean(diffs):.4f}")
