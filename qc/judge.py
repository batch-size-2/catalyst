"""Backend side: KPI table -> verdict. Owned by the backend engineer (PLAN_v1 §4.4).

Usage (no images needed): uv run python -m qc.judge tests/fixtures/kpis_fake.csv --baseline fake_baseline
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import beta, t

from qc.schema import (
    KPI_TABLE, KPI_UNITS, Evidence, KpiResult, NonConforming, TileResult, evidence_path, load_config,
)


def judge(baseline: pd.DataFrame, batch: pd.DataFrame, cfg: dict) -> Evidence:
    """Pure stats on KPI tables (one row per tile). No images."""
    names = [k for k in KPI_UNITS if baseline[k].notna().sum() >= 2]
    alpha = (1 - cfg["band_coverage"]) / max(len(names), 1)
    bands = {k: tolerance_band(baseline[k].dropna(), alpha) for k in names}
    tiles = [judge_tile(row, bands) for row in batch.to_dict("records")]
    x, n = sum(tile.status == "NON_CONFORMING" for tile in tiles), len(tiles)
    lo, hi = binomial_ci(x, n, cfg["ci_level"])
    verdict, next_action = decide(tiles, x, n, lo, hi, cfg)
    return Evidence(
        batch=str(batch["batch"].iloc[0]),
        baseline=str(baseline["batch"].iloc[0]),
        verdict=verdict,
        next_action=next_action,
        nonconforming=NonConforming(x=x, n=n, ci=(lo, hi)),
        kpis=[KpiResult(name=k, unit=KPI_UNITS[k], band=bands[k], baseline_mean=baseline[k].mean(),
                        batch_mean=num(batch[k].mean()),
                        n_outside=int(((batch[k] < bands[k][0]) | (batch[k] > bands[k][1])).sum()))
              for k in names],
        tiles=tiles,
        n_images={"baseline": len(baseline), "batch": n},
        config_version=cfg["version"],
    )


def tolerance_band(values: pd.Series, alpha: float) -> tuple[float, float]:
    """Prediction interval for one new tile drawn from the baseline."""
    n, mean, sd = len(values), values.mean(), values.std()
    half = t.ppf(1 - alpha / 2, n - 1) * sd * np.sqrt(1 + 1 / n)
    return mean - half, mean + half


def judge_tile(row: dict, bands: dict[str, tuple[float, float]]) -> TileResult:
    outside = [f"{k} = {row[k]:.3g} outside [{lo:.3g}, {hi:.3g}]"
               for k, (lo, hi) in bands.items() if pd.notna(row[k]) and not lo <= row[k] <= hi]
    missing = [f"{k} not measured" for k in bands if pd.isna(row[k])]
    status = "NON_CONFORMING" if outside else "SUSPECT" if missing else "CONFORMING"
    return TileResult(image_id=str(row["image_id"]), strip_id=None if pd.isna(row["strip_id"]) else str(row["strip_id"]),
                      status=status, kpis={k: num(row[k]) for k in KPI_UNITS}, reasons=outside + missing)


def decide(tiles: list[TileResult], x: int, n: int, lo: float, hi: float, cfg: dict) -> tuple[str, str]:
    if n == 0:
        return "INVESTIGATE", "No tiles measured. Check the batch folder."
    if lo > cfg["reject_lower_bound"]:
        return "REJECT", f"Quarantine the lot: {x}/{n} tiles non-conforming, rate at least {lo:.0%}."
    suspect = [tile.image_id for tile in tiles if tile.status == "SUSPECT"]
    if x == 0 and not suspect:
        return "ACCEPT", f"Release. {n} clean tiles cannot rule out a non-conforming rate up to {hi:.0%}."
    if x == 0:
        return "INVESTIGATE", f"Review {len(suspect)} SUSPECT tile(s): {', '.join(suspect)}."
    m = extra_fields(x, n, cfg)
    more = f"Image ~{m} more fields" if m else "Image more fields"
    return "INVESTIGATE", f"{more} to resolve {x}/{n} non-conforming tiles."


def extra_fields(x: int, n: int, cfg: dict, max_extra: int = 200) -> int | None:
    """Extra fields needed, at the observed rate, before the lower bound clears the reject threshold."""
    for m in range(1, max_extra + 1):
        if binomial_ci(round(x / n * (n + m)), n + m, cfg["ci_level"])[0] > cfg["reject_lower_bound"]:
            return m
    return None


def binomial_ci(x: int, n: int, level: float) -> tuple[float, float]:
    """Exact (Clopper-Pearson) interval on a non-conforming fraction."""
    if n == 0:
        return 0.0, 1.0
    a = (1 - level) / 2
    return (0.0 if x == 0 else float(beta.ppf(a, x, n - x + 1)),
            1.0 if x == n else float(beta.ppf(1 - a, x + 1, n - x)))


def num(value) -> float | None:
    return None if pd.isna(value) else float(value)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Judge every batch in a KPI table against the baseline.")
    parser.add_argument("kpis_csv", type=Path, nargs="?", default=KPI_TABLE)
    parser.add_argument("--baseline", help="defaults to `baseline` in config/decision.yaml")
    args = parser.parse_args()
    cfg = load_config()
    table = pd.read_csv(args.kpis_csv)
    baseline = table[table["batch"] == (args.baseline or cfg["baseline"])]
    if baseline.empty:
        raise SystemExit(f"no rows for baseline {args.baseline or cfg['baseline']!r} in {args.kpis_csv}")
    for name, batch in table.groupby("batch"):
        evidence = judge(baseline, batch, cfg)
        evidence_path(name).parent.mkdir(parents=True, exist_ok=True)
        evidence_path(name).write_text(evidence.model_dump_json(indent=2))
        print(f"{name:20s} {evidence.verdict:12s} {evidence.next_action}")
