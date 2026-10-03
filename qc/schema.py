"""The contract between the two halves of the pipeline (PLAN_v1 §4.1).

    ML side:      Field -> segment() -> mask -> kpis() -> one row     (qc/measure.py)
    Glue:         data/<batch>/*.tif -> out/kpis.csv -> evidence      (qc/run.py)
    Backend side: KPI table -> judge() -> out/evidence/<batch>.json   (qc/judge.py)
    Dashboard:    reads evidence + previews only                      (app.py)

Adding a KPI or a field is fine, just tell your partner.
Renaming/removing anything here, or changing a unit, needs both of you.
"""

from dataclasses import dataclass
from enum import IntEnum
from pathlib import Path
from typing import Literal

import numpy as np
import yaml
from pydantic import BaseModel

DETECTORS = ("BSE", "ETD", "InLens")


@dataclass
class Field:
    """One field of view (tile) with its co-registered detector images."""

    batch: str
    image_id: str
    strip_id: str | None
    channels: dict[str, np.ndarray]
    px_um: float


class Phase(IntEnum):
    """Label codes used in segmentation masks."""

    PORE = 0
    GRAPHITE = 1
    SI_PARTICLE = 2
    BINDER_FILM = 3
    IGNORE = 255


KPI_UNITS: dict[str, str] = {
    "si_frac": "fraction",
    "si_graphite_ratio": "ratio",
    "si_d50_um": "um",
    "fragments_per_1e4um2": "per 1e4 um2",
    "apparent_porosity": "fraction",
}

KPI_TABLE_COLUMNS = ["batch", "image_id", "strip_id", "px_um", *KPI_UNITS]

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
EVIDENCE_DIR = OUT_DIR / "evidence"


def evidence_path(batch: str) -> Path:
    return EVIDENCE_DIR / f"{batch}.json"


def preview_path(batch: str, image_id: str) -> Path:
    return OUT_DIR / "previews" / batch / f"{image_id}.png"


def load_config(path: Path = CONFIG_PATH) -> dict:
    return yaml.safe_load(path.read_text())
