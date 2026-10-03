"""The contract between the two halves of the pipeline (PLAN_v1 §3.1).

    ML side:      channels -> segment() -> mask -> kpis() -> one row  (qc/measure.py)
    Glue:         data/<batch>/*.tif -> out/kpis.csv -> evidence      (qc/run.py)
    Backend side: KPI table -> judge() -> out/evidence/<batch>.json   (qc/decide.py)
    UI:           reads evidence + mask overlays via the API          (qc/api.py, web/)

Adding a KPI or a field is fine, just tell your partner.
Renaming/removing anything here, or changing a unit, needs both of you.
"""

from dataclasses import dataclass, field
from enum import IntEnum
from pathlib import Path
from typing import Literal, NamedTuple

import numpy as np
import pandas as pd
import yaml
from pydantic import BaseModel

DETECTORS = ("BSE", "ETD", "InLens")


@dataclass
class Field:
    """One field of view (tile) as loaded by qc/io.py. The ML functions get its channels and px_um."""

    batch: str
    image_id: str
    strip_id: str | None
    channels: dict[str, np.ndarray]
    px_um: float


class Phase(IntEnum):
    """Label codes used in segmentation masks."""

    PORE = 0
    GRAPHITE = 1
    SI = 2
    BINDER = 3
    IGNORE = 255


KPI_UNITS: dict[str, str] = {
    "si_area_frac": "fraction",
    "si_d50_um": "um",
    "si_d90_um": "um",
    "si_internal_void_frac": "fraction",
    "si_contrast_ratio": "ratio",
    "si_fragments_per_1e4um2": "count",
    "si_dispersion_cv": "ratio",
    "porosity_apparent": "fraction",
    "si_graphite_ratio": "ratio",
    "si_agglomerate_frac": "fraction",
    "si_corr_length_um": "um",
    "graphite_chord_um": "um",
    "graphite_anisotropy": "ratio",
    "pore_chord_um": "um",
    "pore_connectivity": "fraction",
}

KPI_TABLE_COLUMNS = ["batch", "image_id", "strip_id", "px_um", *KPI_UNITS]

PARTICLE_COLUMNS = [
    "batch", "image_id", "strip_id", "particle_id", "d_um", "area_um2", "contrast_ratio",
    "inlens_ratio", "void_frac", "texture", "solidity", "border", "type", "y_px", "x_px",
]
IMAGING_COLUMNS = [
    "batch", "image_id", "strip_id", "channel", "black_level", "p1", "p50", "p99",
    "noise", "sharpness", "saturated_frac", "curtaining_index",
]


class Tables(NamedTuple):
    """Everything measured for a set of batch folders (PLAN_v3 §3.1)."""

    kpis: pd.DataFrame
    particles: pd.DataFrame
    imaging: pd.DataFrame


@dataclass
class Control:
    """A synthetic batch built from reference fields with a known answer (PLAN_v3 §3.7, §3.13).

    kept_in_reference holds image_ids of split-strip images that stay in the reference.
    """

    name: str
    kind: Literal["negative", "positive"]
    expected_driver: str | None
    source_strips: list[str]
    fields: list[Field]
    kept_in_reference: list[str] = field(default_factory=list)

TileStatus = Literal["CONFORMING", "SUSPECT", "NON_CONFORMING"]
Verdict = Literal["ACCEPT", "INVESTIGATE", "REJECT"]


class TileResult(BaseModel):
    image_id: str
    strip_id: str | None
    status: TileStatus
    kpis: dict[str, float | None]
    reasons: list[str]


class KpiResult(BaseModel):
    name: str
    unit: str
    band: tuple[float, float]
    baseline_mean: float
    batch_mean: float | None
    n_outside: int


class NonConforming(BaseModel):
    x: int
    n: int
    ci: tuple[float, float]
    unit: Literal["tile", "strip"] = "tile"


class Evidence(BaseModel):
    batch: str
    baseline: str
    verdict: Verdict
    next_action: str
    nonconforming: NonConforming
    kpis: list[KpiResult]
    tiles: list[TileResult]
    n_images: dict[str, int]
    config_version: str


CONFIG_PATH = Path("config/decision.yaml")
OUT_DIR = Path("out")
KPI_TABLE = OUT_DIR / "kpis.csv"
PARTICLE_TABLE = OUT_DIR / "particles.csv"
IMAGING_TABLE = OUT_DIR / "imaging.csv"
PARTICLE_TYPES_PATH = Path("config/particle_types.json")
ATTRIBUTION_MODEL_PATH = Path("config/attribution_model.json")
EVIDENCE_DIR = OUT_DIR / "evidence"
FEATURE_TABLE = OUT_DIR / "features.csv"
ATTRIBUTION_DIR = OUT_DIR / "attribution"


def crop_path(type_id: str, n: int) -> Path:
    return OUT_DIR / "crops" / type_id / f"{n}.png"


def evidence_path(batch: str) -> Path:
    return EVIDENCE_DIR / f"{batch}.json"


def attribution_path(name: str) -> Path:
    """Batch attribution result (qc/attribute.py) for one run, e.g. a drop folder."""
    return ATTRIBUTION_DIR / f"{name}.json"


def mask_path(batch: str, image_id: str) -> Path:
    """Mask overlay PNG (BSE + coloured phases) for eyeballing and the dashboard."""
    return OUT_DIR / "masks" / batch / f"{image_id}.png"


def load_config(path: Path = CONFIG_PATH) -> dict:
    return yaml.safe_load(path.read_text())
