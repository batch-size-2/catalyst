"""The contract between the two halves of the pipeline.

    ML side:      data/<batch>/*.tif  ->  out/kpis.csv           (qc/measure.py)
    Backend side: out/kpis.csv        ->  out/evidence/<batch>.json  (qc/decide.py)

Adding a KPI or a field is fine, just tell your partner.
Renaming/removing anything here, or changing a unit, needs both of you.
"""

from enum import IntEnum
from typing import Literal

from pydantic import BaseModel


class Phase(IntEnum):
    """Label codes used in segmentation masks."""

    PORE = 0
    ACTIVE = 1
    CBD = 2
    CRACK = 3


KPI_UNITS: dict[str, str] = {
    "porosity": "fraction",
    "d50_um": "um",
    "crack_frac": "fraction",
}

KPI_TABLE_COLUMNS = ["batch", "image_id", "px_um", *KPI_UNITS]


class KpiResult(BaseModel):
    name: str
    unit: str
    baseline_mean: float
    batch_mean: float
    diff: float
    ci90: tuple[float, float]
    margin: float
    status: Literal["pass", "fail", "uncertain"]


class Evidence(BaseModel):
    batch: str
    verdict: Literal["ACCEPT", "INVESTIGATE", "REJECT"]
    kpis: list[KpiResult]
    n_images: dict[str, int]
    config_version: str
