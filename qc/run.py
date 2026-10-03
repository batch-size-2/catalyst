"""Zero-touch runner: images -> KPI table -> verdict. The CLI and qc/api.py both call run().

Usage: uv run python -m qc.run --batch data/Batch_2 [data/Batch_3 ...]
"""

import argparse
import importlib
import json
import re
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd
from skimage.exposure import rescale_intensity
from skimage.io import imsave

from qc.decide import evaluate, split_tables
from qc.explain import explain, load_dictionary
from qc.io import field_paths, load_field
from qc.measure import imaging, kpis, particles, segment
from qc.provenance import provenance, rules_frozen
from qc.schema import (
    ATTRIBUTION_MODEL_PATH, CONFIG_PATH, IMAGING_COLUMNS, IMAGING_TABLE, KPI_TABLE, KPI_TABLE_COLUMNS, KPI_UNITS,
    PARTICLE_COLUMNS, PARTICLE_TABLE, Evidence, Field, Phase, Tables, attribution_path, evidence_path,
    load_config, mask_path,
)
from qc.types import assign_types, load_types

Progress = Callable[[int, int, str], None]
OVERLAY_RGB = {Phase.PORE: (40, 120, 255), Phase.SI: (255, 140, 0), Phase.BINDER: (190, 90, 255)}
TIFF_SUFFIXES = {".tif", ".tiff"}


def attribution_module():
    """Pat's qc.attribute, or None until that module exists (an error inside it still raises)."""
    try:
        return importlib.import_module("qc.attribute")
    except ModuleNotFoundError as error:
        if error.name != "qc.attribute":
            raise
        return None


def read_json(path: Path):
    """JSON written by Pat's tools; NaN/Infinity (Python's json default) become null for the browser."""
    return json.loads(path.read_text(), parse_constant=lambda _: None)


def attribute(image_dir: Path, balanced: int | None = None) -> dict:
    """Pat's attribute_images() with her frozen model; returns out/attribution/<folder>.json."""
    module = attribution_module()
    if module is None:
        raise NotImplementedError("batch attribution is not available yet (qc/attribute.py)")
    model = module.load_model()
    if model is None:
        raise FileNotFoundError(f"no {ATTRIBUTION_MODEL_PATH}: run `uv run python -m qc.attribute --fit` first")
    module.attribute_images(image_dir, model, balanced=balanced)
    return read_json(attribution_path(image_dir.name))


def run(batch_dirs: list[Path], cfg: dict, progress: Progress | None = None) -> list[Evidence]:
    """Measures the baseline and each batch, compares each batch, writes out/ tables and evidence JSON."""
    data_dir = Path(cfg["data_dir"])
    baseline_dir = data_dir / cfg["baseline"]
    if not baseline_dir.is_dir():
        raise FileNotFoundError(f"baseline folder {baseline_dir} not found (set `baseline` in config/decision.yaml)")
    measured = measure([baseline_dir, *(d for d in batch_dirs if d.name != baseline_dir.name)], progress)
    save_tables(measured)
    tables = split_tables(measured.kpis, measured.particles, measured.imaging)
    results = []
    for batch_dir in batch_dirs:
        evidence = evaluate(tables, batch_dir.name, cfg)
        evidence.explanations = explain(evidence, load_dictionary())
        tiffs = sorted({p for d in (baseline_dir, batch_dir) for p in d.iterdir()
                        if p.suffix.lower() in TIFF_SUFFIXES})
        evidence.provenance = provenance(tiffs, cfg, data_dir)
        path = evidence_path(evidence.batch, evidence.baseline)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(evidence.model_dump_json(indent=2))
        results.append(evidence)
    return results


def measure_folder(image_dir: Path, progress: Progress | None = None) -> int:
    """Measure one folder (e.g. an Identify drop) into out/ tables and masks, without comparing it."""
    measured = measure([image_dir], progress)
    save_tables(measured)
    return len(measured.kpis)


class RulesFrozen(Exception):
    """The `rules-frozen` tag exists, so config/decision.yaml may not change (AGENTS.md)."""


def set_baseline(baseline: str, path: Path = CONFIG_PATH) -> dict:
    """Write the default `baseline` into config/decision.yaml, keeping the rest of the file as written."""
    frozen, _ = rules_frozen()
    if frozen:
        raise RulesFrozen(f"rules are frozen at {frozen[:7]}: the default baseline can't change without a new freeze")
    cfg = load_config(path)
    if not (Path(cfg["data_dir"]) / baseline).is_dir():
        raise FileNotFoundError(f"no folder {cfg['data_dir']}/{baseline}")
    text, n = re.subn(r"(?m)^baseline:.*$", f"baseline: {baseline}", path.read_text(), count=1)
    if not n:
        text += f"\nbaseline: {baseline}\n"
    path.write_text(text)
    return load_config(path)


def measure(batch_dirs: list[Path], progress: Progress | None = None) -> Tables:
    jobs = [(d.name, image_id, paths) for d in batch_dirs for image_id, paths in field_paths(d).items()]
    kpi_rows, particle_frames, imaging_rows = [], [], []
    for i, (batch, image_id, paths) in enumerate(jobs):
        kpi_row, particle_rows, img_rows = measure_field(load_field(batch, image_id, paths))
        kpi_rows.append(kpi_row)
        particle_frames.append(particle_rows)
        imaging_rows.extend(img_rows)
        if progress:
            progress(i + 1, len(jobs), f"{batch}/{image_id}")
    particles_all = (
        pd.concat(particle_frames, ignore_index=True) if particle_frames else pd.DataFrame()
    )
    return Tables(
        kpis=pd.DataFrame(kpi_rows, columns=KPI_TABLE_COLUMNS),
        particles=particles_all.reindex(columns=PARTICLE_COLUMNS),
        imaging=pd.DataFrame(imaging_rows, columns=IMAGING_COLUMNS),
    )


def measure_field(field: Field) -> tuple[dict, pd.DataFrame, list[dict]]:
    """A tile that fails to segment or measure gets NaN KPIs instead of crashing the run."""
    base = {"batch": field.batch, "image_id": field.image_id, "strip_id": field.strip_id}
    kpi_row = base | {"px_um": field.px_um, "area_um2": np.nan} | {k: np.nan for k in KPI_UNITS}
    table = pd.DataFrame(columns=[c for c in PARTICLE_COLUMNS if c not in base])
    irows = [base | {"channel": ch} | {k: np.nan for k in IMAGING_COLUMNS[4:]} for ch in field.channels]
    try:
        mask = segment(field.channels, field.px_um)
        kpi_row.update(kpis(mask, field.px_um, field.channels))
        save_overlay(field, mask)
        if np.isfinite(field.px_um):
            kpi_row["area_um2"] = float((mask != Phase.IGNORE).sum() * field.px_um**2)
        try:
            table = particles(mask, field.px_um, field.channels)
            model = load_types()
            table["type"] = assign_types(table, model)["type"].to_numpy() if model is not None else np.nan
        except Exception as error:
            print(f"  ! {field.batch}/{field.image_id} particles: {error!r}")
        try:
            descs = imaging(field.channels, field.px_um)
            irows = [
                base | {"channel": ch} | {k: descs.get(ch, {}).get(k, np.nan) for k in IMAGING_COLUMNS[4:]}
                for ch in field.channels
            ]
        except Exception as error:
            print(f"  ! {field.batch}/{field.image_id} imaging: {error!r}")
    except Exception as error:
        print(f"  ! {field.batch}/{field.image_id}: {error!r}")
    return kpi_row, table.assign(**base).reindex(columns=PARTICLE_COLUMNS), irows


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


def _replace_batch_rows(new: pd.DataFrame, path: Path) -> None:
    """Replaces the rows of the batches just measured in one CSV, keeps the rest."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        old = pd.read_csv(path)
        new = pd.concat([old[~old["batch"].isin(new["batch"])], new], ignore_index=True)
    new.to_csv(path, index=False)


def save_tables(tables: Tables) -> None:
    _replace_batch_rows(tables.kpis, KPI_TABLE)
    _replace_batch_rows(tables.particles, PARTICLE_TABLE)
    _replace_batch_rows(tables.imaging, IMAGING_TABLE)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run batch QC against the baseline in config/decision.yaml.")
    parser.add_argument("--batch", type=Path, nargs="+", required=True)
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    args = parser.parse_args()
    for evidence in run(args.batch, load_config(args.config), lambda done, total, tile: print(f"[{done}/{total}] {tile}")):
        n1, n2 = evidence.power.n_segments
        print(f"{evidence.batch}: {evidence.verdict} ({evidence.unit}s {n1} vs {n2}) -> {evidence.next_action}")
