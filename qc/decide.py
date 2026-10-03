"""Backend side: KPI table -> verdicts. Owned by the backend engineer.

Usage: uv run python -m qc.decide [kpis_csv]
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml
from scipy.stats import norm

from qc.schema import KPI_UNITS, Evidence, KpiResult


def compare(baseline: pd.DataFrame, batch: pd.DataFrame, cfg: dict) -> Evidence:
    """Pure stats on KPI tables (one row per image). No images."""
    z = norm.ppf(0.5 + cfg["ci_level"] / 2)
    results = []
    for name, unit in KPI_UNITS.items():
        a, b = baseline[name].dropna(), batch[name].dropna()
        if len(a) < 2 or len(b) < 2:
            continue
        diff = b.mean() - a.mean()
        half = z * np.sqrt(a.var() / len(a) + b.var() / len(b))
        lo, hi, margin = diff - half, diff + half, cfg["margin_k_sd"] * a.std()
        status = "pass" if -margin < lo and hi < margin else "fail" if hi < -margin or lo > margin else "uncertain"
        results.append(KpiResult(name=name, unit=unit, baseline_mean=a.mean(), batch_mean=b.mean(),
                                 diff=diff, ci90=(lo, hi), margin=margin, status=status))
    return Evidence(batch=str(batch["batch"].iloc[0]), verdict=verdict(results), kpis=results,
                    n_images={"baseline": len(baseline), "batch": len(batch)},
                    config_version=cfg["version"])


def verdict(results: list[KpiResult]) -> str:
    statuses = {r.status for r in results}
    if "fail" in statuses:
        return "REJECT"
    if "uncertain" in statuses or not results:
        return "INVESTIGATE"
    return "ACCEPT"


if __name__ == "__main__":
    table = pd.read_csv(sys.argv[1] if len(sys.argv) > 1 else "out/kpis.csv")
    cfg = yaml.safe_load(Path("config/decision.yaml").read_text())
    baseline = table[table["batch"] == cfg["baseline"]]
    if baseline.empty:
        sys.exit(f"no rows for baseline batch {cfg['baseline']!r} (set it in config/decision.yaml)")
    out_dir = Path("out/evidence")
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, batch in table[table["batch"] != cfg["baseline"]].groupby("batch"):
        evidence = compare(baseline, batch, cfg)
        (out_dir / f"{name}.json").write_text(evidence.model_dump_json(indent=2))
        print(f"{name:24s} {evidence.verdict}")
