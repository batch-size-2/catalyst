"""Zero-touch runner: images -> KPI table -> verdict. The CLI and app.py both call run().

Usage: uv run python -m qc.run --batch data/Batch_2 [data/Batch_3 ...]
"""

import argparse
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd
from skimage.exposure import rescale_intensity
from skimage.io import imsave

from qc.io import field_paths, load_field
from qc.judge import judge
from qc.measure import kpis, segment
from qc.schema import (
    CONFIG_PATH, KPI_TABLE, KPI_TABLE_COLUMNS, KPI_UNITS, Evidence, Field, Phase, evidence_path, load_config,
    preview_path,
)

Progress = Callable[[int, int, str], None]
OVERLAY_RGB = {Phase.PORE: (40, 120, 255), Phase.SI_PARTICLE: (255, 140, 0)}


def run(batch_dirs: list[Path], cfg: dict, progress: Progress | None = None) -> list[Evidence]:
    """Measures the baseline and each batch, judges each batch, writes kpis.csv and evidence JSON."""
    baseline_dir = Path(cfg["data_dir"]) / cfg["baseline"]
    if not baseline_dir.is_dir():
        raise FileNotFoundError(f"baseline folder {baseline_dir} not found (set `baseline` in config/decision.yaml)")
    table = measure([baseline_dir, *(d for d in batch_dirs if d.name != baseline_dir.name)], progress)
    save_kpi_table(table)
    baseline = table[table["batch"] == baseline_dir.name]
    results = []
    for batch_dir in batch_dirs:
        evidence = judge(baseline, table[table["batch"] == batch_dir.name], cfg)
        evidence_path(evidence.batch).parent.mkdir(parents=True, exist_ok=True)
        evidence_path(evidence.batch).write_text(evidence.model_dump_json(indent=2))
        results.append(evidence)
    return results


def measure(batch_dirs: list[Path], progress: Progress | None = None) -> pd.DataFrame:
    jobs = [(d.name, image_id, paths) for d in batch_dirs for image_id, paths in field_paths(d).items()]
    rows = []
    for i, (batch, image_id, paths) in enumerate(jobs):
        if progress:
            progress(i, len(jobs), f"{batch}/{image_id}")
        rows.append(measure_field(load_field(batch, image_id, paths)))
    return pd.DataFrame(rows, columns=KPI_TABLE_COLUMNS)


def measure_field(field: Field) -> dict:
    """A tile that fails to segment or measure gets NaN KPIs (-> SUSPECT) instead of crashing the run."""
    try:
        mask = segment(field)
        values = kpis(field, mask)
        save_preview(field, mask)
    except Exception as error:
        print(f"  ! {field.batch}/{field.image_id}: {error!r}")
        values = {}
    return {"batch": field.batch, "image_id": field.image_id, "strip_id": field.strip_id, "px_um": field.px_um} | {
        k: values.get(k, np.nan) for k in KPI_UNITS
    }


def save_preview(field: Field, mask: np.ndarray, step: int = 4) -> None:
    grey = field.channels["BSE"][::step, ::step]
    lo, hi = np.percentile(grey, (1, 99))
    rgb = np.repeat(rescale_intensity(grey, in_range=(lo, hi), out_range=(0, 255))[..., None], 3, axis=2)
    small = mask[::step, ::step]
    for phase, color in OVERLAY_RGB.items():
        rgb[small == phase] = 0.5 * rgb[small == phase] + 0.5 * np.array(color)
    path = preview_path(field.batch, field.image_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    imsave(path, rgb.astype(np.uint8), check_contrast=False)


def save_kpi_table(new: pd.DataFrame) -> None:
    """Replaces the rows of the batches just measured, keeps the rest."""
    KPI_TABLE.parent.mkdir(parents=True, exist_ok=True)
    if KPI_TABLE.exists():
        old = pd.read_csv(KPI_TABLE)
        new = pd.concat([old[~old["batch"].isin(new["batch"])], new], ignore_index=True)
    new.to_csv(KPI_TABLE, index=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run batch QC against the baseline in config/decision.yaml.")
    parser.add_argument("--batch", type=Path, nargs="+", required=True)
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    args = parser.parse_args()
    for evidence in run(args.batch, load_config(args.config), lambda i, n, label: print(f"[{i + 1}/{n}] {label}")):
        nc = evidence.nonconforming
        print(f"{evidence.batch}: {evidence.verdict} ({nc.x}/{nc.n} non-conforming) -> {evidence.next_action}")
