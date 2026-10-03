"""Zero-touch runner: images -> KPI table -> verdict. The CLI and qc/api.py both call run().

Usage: uv run python -m qc.run --batch data/Batch_2 [data/Batch_3 ...]
"""

import argparse
import importlib
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd
from skimage.exposure import rescale_intensity
from skimage.io import imsave

from qc.decide import evaluate, split_tables
from qc.io import field_paths, load_field
from qc.measure import kpis, segment
from qc.provenance import provenance
from qc.schema import (
    CONFIG_PATH, KPI_TABLE, KPI_TABLE_COLUMNS, KPI_UNITS, Attribution, Evidence, Field, Phase, attribution_path,
    evidence_path, load_config, mask_path,
)

Progress = Callable[[int, int, str], None]
OVERLAY_RGB = {Phase.PORE: (40, 120, 255), Phase.SI: (255, 140, 0), Phase.BINDER: (190, 90, 255)}
TIFF_SUFFIXES = {".tif", ".tiff"}


def attribution_predict():
    """Pat's qc.attribute.predict(dirs, progress) -> Attribution, or None until that module exists."""
    try:
        module = importlib.import_module("qc.attribute")
    except ModuleNotFoundError as error:
        if error.name != "qc.attribute":
            raise
        return None
    return getattr(module, "predict", None)


def attribute(dirs: list[Path], progress: Progress | None = None) -> Attribution:
    """Runs Pat's attribution on image folders, validates the result and writes out/attribution/<run>.json."""
    predict = attribution_predict()
    if predict is None:
        raise NotImplementedError("batch attribution is not available yet (qc/attribute.py)")
    result = Attribution.model_validate(predict(dirs, progress), from_attributes=True)
    path = attribution_path(result.run)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(result.model_dump_json(indent=2))
    return result


def run(batch_dirs: list[Path], cfg: dict, progress: Progress | None = None) -> list[Evidence]:
    """Measures the baseline and each batch, compares each batch, writes kpis.csv and evidence JSON."""
    data_dir = Path(cfg["data_dir"])
    baseline_dir = data_dir / cfg["baseline"]
    if not baseline_dir.is_dir():
        raise FileNotFoundError(f"baseline folder {baseline_dir} not found (set `baseline` in config/decision.yaml)")
    table = measure([baseline_dir, *(d for d in batch_dirs if d.name != baseline_dir.name)], progress)
    save_kpi_table(table)
    tables = split_tables(table)
    results = []
    for batch_dir in batch_dirs:
        evidence = evaluate(tables, batch_dir.name, cfg)
        tiffs = sorted({p for d in (baseline_dir, batch_dir) for p in d.iterdir()
                        if p.suffix.lower() in TIFF_SUFFIXES})
        evidence.provenance = provenance(tiffs, cfg, data_dir)
        evidence_path(evidence.batch).parent.mkdir(parents=True, exist_ok=True)
        evidence_path(evidence.batch).write_text(evidence.model_dump_json(indent=2))
        results.append(evidence)
    return results


def measure(batch_dirs: list[Path], progress: Progress | None = None) -> pd.DataFrame:
    jobs = [(d.name, image_id, paths) for d in batch_dirs for image_id, paths in field_paths(d).items()]
    rows = []
    for i, (batch, image_id, paths) in enumerate(jobs):
        rows.append(measure_field(load_field(batch, image_id, paths)))
        if progress:
            progress(i + 1, len(jobs), f"{batch}/{image_id}")
    return pd.DataFrame(rows, columns=KPI_TABLE_COLUMNS)


def measure_field(field: Field) -> dict:
    """A tile that fails to segment or measure gets NaN KPIs instead of crashing the run."""
    try:
        mask = segment(field.channels, field.px_um)
        values = kpis(mask, field.px_um, field.channels)
        save_overlay(field, mask)
        area_um2 = float((mask != Phase.IGNORE).sum() * field.px_um**2) if np.isfinite(field.px_um) else np.nan
    except Exception as error:
        print(f"  ! {field.batch}/{field.image_id}: {error!r}")
        values, area_um2 = {}, np.nan
    return {"batch": field.batch, "image_id": field.image_id, "strip_id": field.strip_id,
            "px_um": field.px_um, "area_um2": area_um2} | {k: values.get(k, np.nan) for k in KPI_UNITS}


def save_overlay(field: Field, mask: np.ndarray, step: int = 4) -> None:
    grey = field.channels["BSE"][::step, ::step]
    lo, hi = np.percentile(grey, (1, 99))
    rgb = np.repeat(rescale_intensity(grey, in_range=(lo, hi), out_range=(0, 255))[..., None], 3, axis=2)
    small = mask[::step, ::step]
    for phase, color in OVERLAY_RGB.items():
        rgb[small == phase] = 0.5 * rgb[small == phase] + 0.5 * np.array(color)
    path = mask_path(field.batch, field.image_id)
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
    for evidence in run(args.batch, load_config(args.config), lambda done, total, tile: print(f"[{done}/{total}] {tile}")):
        n1, n2 = evidence.power.n_segments
        print(f"{evidence.batch}: {evidence.verdict} ({evidence.unit}s {n1} vs {n2}) -> {evidence.next_action}")
