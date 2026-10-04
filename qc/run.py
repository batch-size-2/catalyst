"""Zero-touch runner: images -> KPI table -> verdict. The CLI and qc/api.py both call run().

Usage: uv run python -m qc.run --batch data/Batch_2 [data/Batch_3 ...]
"""

import argparse
import importlib
import inspect
import json
import os
import re
import threading
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd
from skimage.exposure import rescale_intensity
from skimage.io import imsave

from qc.control_check import load_controls
from qc.decide import evaluate, split_tables
from qc.explain import explain, load_dictionary
from qc.io import field_paths, load_field, tile_geometry
from qc.measure import imaging, kpis, particles, segment
from qc.provenance import git, provenance, rules_frozen
from qc.schema import (
    ATTRIBUTION_MODEL_PATH, CONFIG_PATH, IMAGING_COLUMNS, IMAGING_TABLE, KPI_TABLE, KPI_TABLE_COLUMNS, KPI_UNITS,
    PARTICLE_COLUMNS, PARTICLE_TABLE, Evidence, Field, Phase, Tables, attribution_path, evidence_path, phases_path,
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


StageProgress = Callable[[str, int, int, str], None]


def attribute(image_dir: Path, balanced: int | None = None, progress: StageProgress | None = None) -> dict:
    """Pat's attribute_images() with her frozen model; returns out/attribution/<folder>.json.

    `progress(stage, done, total, tile)` is passed on when her function takes it (feature-detected).
    """
    module = attribution_module()
    if module is None:
        raise NotImplementedError("batch attribution is not available yet (qc/attribute.py)")
    model = module.load_model()
    if model is None:
        raise FileNotFoundError(f"no {ATTRIBUTION_MODEL_PATH}: run `uv run python -m qc.attribute --fit` first")
    takes_progress = "progress" in inspect.signature(module.attribute_images).parameters
    module.attribute_images(image_dir, model, balanced=balanced, **({"progress": progress} if progress and takes_progress else {}))
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
    controls = load_controls(cfg)
    results = []
    for batch_dir in batch_dirs:
        evidence = evaluate(tables, batch_dir.name, cfg, controls)
        evidence.explanations = explain(evidence, load_dictionary())
        tiffs = sorted({p for d in (baseline_dir, batch_dir) for p in d.iterdir()
                        if p.suffix.lower() in TIFF_SUFFIXES})
        evidence.provenance = provenance(tiffs, cfg, data_dir)
        path = evidence_path(evidence.batch, evidence.baseline)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(evidence.model_dump_json(indent=2))
        results.append(evidence)
    return results


def load_evidence(path: Path) -> Evidence:
    """One evidence file. Files from before the plain-word texts get them written now, from their own numbers,
    so an old comparison reads like a new one (its verdict, numbers and provenance are untouched)."""
    evidence = Evidence.model_validate_json(path.read_text())
    if not evidence.explanations.summary:
        evidence = evidence.model_copy(update={"explanations": explain(evidence, load_dictionary())})
    return evidence


def tile_particles(image_dir: Path, image_id: str, top: int = 8) -> dict:
    """A tile's size (cropped, full-resolution px) and its `top` largest silicon particles away from the edge,
    from out/particles.csv, in the frame the previews use. No particles until the tile is measured."""
    paths = field_paths(image_dir).get(image_id) if image_dir.is_dir() else None
    if not paths:
        raise FileNotFoundError(f"no tile {image_dir.name}/{image_id}")
    height, width, px_um = tile_geometry(paths.get("BSE") or next(iter(paths.values())))
    rows = []
    if PARTICLE_TABLE.exists():
        table = pd.read_csv(PARTICLE_TABLE, dtype={"batch": str, "image_id": str},
                            usecols=lambda c: c in {"batch", "image_id", "d_um", "type", "x_px", "y_px", "border"})
        mine = table[(table["batch"] == image_dir.name) & (table["image_id"] == image_id)].dropna(subset=["d_um", "x_px", "y_px"])
        if "border" in mine:
            mine = mine[~mine["border"].fillna(False).astype(bool)]
        rows = [{"x": float(r.x_px), "y": float(r.y_px), "d_um": float(r.d_um),
                 "type": None if pd.isna(getattr(r, "type", None)) else str(r.type)}
                for r in mine.nlargest(max(0, min(top, 50)), "d_um").itertuples()]
    return {"width": width, "height": height, "px_um": None if np.isnan(px_um) else float(px_um), "particles": rows}


def measure_folder(image_dir: Path, progress: Progress | None = None) -> int:
    """Measure one folder (e.g. an Identify drop) into out/ tables and masks, without comparing it."""
    measured = measure([image_dir], progress)
    save_tables(measured)
    return len(measured.kpis)


class RulesFrozen(Exception):
    """The `rules-frozen` tag exists, so config/decision.yaml may not change (AGENTS.md)."""


def set_baseline(baseline: str, path: Path = CONFIG_PATH) -> dict:
    """Write the default `baseline` into config/decision.yaml, keeping the rest of the file as written.

    Refuses once the `rules-frozen` tag exists, and when git can't tell (not a checkout, no git).
    """
    if git("rev-parse", "--git-dir") is None:
        raise RulesFrozen("can't check the rules-frozen tag (no git checkout), so the config stays as it is")
    frozen, _ = rules_frozen()
    if frozen:
        raise RulesFrozen(f"rules are frozen at {frozen[:7]}: the default baseline can't change without a new freeze")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", baseline):
        raise ValueError(f"invalid batch name {baseline!r}")
    cfg = load_config(path)
    if not (Path(cfg["data_dir"]) / baseline).is_dir():
        raise FileNotFoundError(f"no folder {cfg['data_dir']}/{baseline}")
    line = f"baseline: {baseline}"
    text, n = re.subn(r"(?m)^baseline:.*$", lambda _: line, path.read_text(), count=1)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text if n else f"{text.rstrip()}\n{line}\n")
    if load_config(tmp).get("baseline") != baseline:
        tmp.unlink()
        raise ValueError("the new config/decision.yaml didn't read back")
    os.replace(tmp, path)
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
    imsave(phases_path(field.batch, field.image_id), small.astype(np.uint8), check_contrast=False)


def _replace_batch_rows(new: pd.DataFrame, path: Path) -> None:
    """Replaces the rows of the batches just measured in one CSV, keeps the rest. Atomic, so a reader
    never sees half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        old = pd.read_csv(path)
        new = pd.concat([old[~old["batch"].isin(new["batch"])], new], ignore_index=True)
    tmp = path.with_suffix(".tmp")
    new.to_csv(tmp, index=False)
    os.replace(tmp, path)


TABLES_LOCK = threading.Lock()  # the API may measure a drop while a comparison runs


def identify_ready() -> dict:
    """Whether a live Identify drop can run offline: model file, deep import, cached DINOv2 weights."""
    model_present = ATTRIBUTION_MODEL_PATH.is_file()
    deep_ok = True
    try:
        import qc.deep  # noqa: F401
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except Exception:
        deep_ok = False
    cached = False
    if deep_ok:
        try:
            from huggingface_hub import try_to_load_from_cache
            from qc.deep import MODEL_ID, MODEL_REVISION
            cached = any(
                isinstance(try_to_load_from_cache(MODEL_ID, name, revision=MODEL_REVISION), str)
                for name in ("model.safetensors", "pytorch_model.bin")
            )
        except Exception:
            cached = False
    missing = []
    if not model_present:
        missing.append("the attribution model file is missing")
    if not deep_ok:
        missing.append("the image-model library isn't installed")
    elif not cached:
        missing.append("the DINOv2 weights aren't cached on this machine")
    return {
        "ok": not missing,
        "model_present": model_present,
        "deep_importable": deep_ok,
        "dinov2_cached": cached,
        "message": None if not missing else "Identify isn't ready: " + "; ".join(missing) + ".",
    }


def save_tables(tables: Tables) -> None:
    with TABLES_LOCK:
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
