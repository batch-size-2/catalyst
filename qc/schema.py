"""The contract between the two halves of the pipeline (PLAN_v4 §3.1).

    ML side:      channels -> segment() -> mask -> kpis() -> one row  (qc/measure.py)
    Glue:         data/<batch>/*.tif -> out/kpis.csv -> evidence      (qc/run.py)
    Backend side: KPI table -> evaluate()/compare() -> out/evidence/<baseline>/<batch>.json  (qc/decide.py)
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
from pydantic import BaseModel, field_validator

DETECTORS = ("BSE", "ETD", "InLens")


@dataclass
class Field:
    """One field of view (tile) as loaded by qc/io.py. The ML functions get its channels and px_um."""

    batch: str
    image_id: str
    strip_id: str | None
    channels: dict[str, np.ndarray]
    px_um: float
    black_level: dict[str, float] = field(default_factory=dict)


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

KPI_TABLE_COLUMNS = ["batch", "image_id", "strip_id", "px_um", "area_um2", *KPI_UNITS]
PARTICLE_COLUMNS = ["batch", "image_id", "strip_id", "particle_id", "d_um", "area_um2", "contrast_ratio",
                    "inlens_ratio", "void_frac", "texture", "solidity", "border", "type", "y_px", "x_px"]
IMAGING_COLUMNS = ["batch", "image_id", "strip_id", "channel", "black_level", "p1", "p50", "p99",
                   "noise", "sharpness", "saturated_frac", "curtaining_index"]


class Tables(NamedTuple):
    """The measured tables of one batch (PLAN_v4 §3.1)."""

    kpis: pd.DataFrame
    particles: pd.DataFrame
    imaging: pd.DataFrame


@dataclass
class Control:
    """A synthetic batch built from reference fields with a known answer (PLAN_v4 §3.7, §3.13).

    kept_in_reference holds image_ids of split-strip images that stay in the reference.
    """

    name: str
    kind: Literal["negative", "positive"]
    expected_driver: str | None
    source_strips: list[str]
    fields: list[Field]
    kept_in_reference: list[str] = field(default_factory=list)


Verdict = Literal["ACCEPT", "INVESTIGATE", "REJECT"]
Status = Literal["SIMILAR", "DIFFERENT", "UNCLEAR"]
Unit = Literal["image", "strip"]
Range = tuple[float, float]


class Segment(BaseModel):
    """The images of one strip, or one image, inside one batch folder: the unit of the statistics."""

    batch: str
    strip_id: str
    image_ids: list[str]
    area_um2: float | None
    values: dict[str, float | None]      # area-weighted mean over its images, per quantity


class Difference(BaseModel):
    name: str
    unit: str
    key: bool                            # in key_descriptors (or a type share when key_type_shares)
    used: bool                           # counts towards the verdict
    note: str | None = None              # why a key quantity is not used, e.g. "not measured"
    reference: float | None              # mean of reference segment values
    batch: float | None                  # mean of batch segment values
    difference: float | None             # batch - reference, in unit
    interval: Range | None = None        # ci_level t-interval on the difference
    margin: float | None                 # delta, in unit
    p: float | None = None               # family-wise permutation p (max-|T| over used key quantities)
    status: Status = "UNCLEAR"
    n_segments: tuple[int, int]          # (batch, reference) segments with a value


class Power(BaseModel):
    n_segments: tuple[int, int]          # (batch, reference) at the driving unit
    n_arrangements: int                  # C(n1 + n2, n1)
    min_p: float                         # smallest achievable p: 2/N if n1 == n2 else 1/N
    limited: bool                        # min_p >= alpha: no quantity can be DIFFERENT
    extra_needed: int | None             # 0 if not limited; else extra batch units that lift it (None if > 20)


class UnitView(BaseModel):
    """The comparison at the unit that does not drive the verdict (config `unit`)."""

    unit: Unit
    power: Power
    statuses: dict[str, Status]          # used key quantity -> status at this unit
    contradictions: list[str] = []       # used key quantities DIFFERENT at one unit and SIMILAR at the other


class Odd(BaseModel):
    strip_id: str
    image_ids: list[str]
    quantity: str
    value: float
    range: Range                         # baseline mean +/- odd_sd x SD of baseline values at that unit


class ImagingCheck(BaseModel):
    changed: bool = False
    changed_metrics: list[str] = []      # e.g. "BSE.black_level"
    outliers_in_reference: list[str] = []  # baseline image_ids left out of the imaging range (§3.3)
    curtained_images: list[str] = []      # image_ids whose run-length descriptors were blanked


class ControlResult(BaseModel):
    name: str
    kind: Literal["negative", "positive"]
    expected_driver: str | None
    statuses: dict[str, Status]
    top_driver: str | None
    passed: bool


class Controls(BaseModel):
    ran: bool = False
    passed: bool | None = None
    results: list[ControlResult] = []


class Descriptor(BaseModel):
    name: str
    unit: str
    value: float | None                  # mean of the batch's values at the driving unit
    interval: Range | None = None        # ci_level t-interval over them
    by_strip: dict[str, float | None]    # strip_id -> strip segment value


class Fingerprint(BaseModel):
    segments: list[Segment]
    descriptors: list[Descriptor]
    type_shares: list[Descriptor] = []


class Explanations(BaseModel):
    """Fixed-template texts (qc/explain.py). Each audience text is a list of sentences."""

    summary: str = ""                    # one plain sentence for the answer, no code names
    rules: list[str] = []                # the verdict rules that fired, one line each, in words
    next_steps: list[str] = []           # plain-word next steps; each tile named once
    ranked: list[str] = []               # used key quantities not settled as similar, in driver order, twin left out
    twin: str | None = None              # a particle-type share that mirrors the other one, so it isn't shown
    within_tolerance: list[str] = []     # quantities settled as similar, minus paused ones and the twin
    operator: list[str] = []
    engineer: list[str] = []
    scientist: list[str] = []
    manager: list[str] = []

    @field_validator("operator", "engineer", "scientist", "manager", mode="before")
    @classmethod
    def sentences(cls, value):
        """Evidence written before the texts became lists keeps loading: one string is one entry."""
        return [value] if isinstance(value, str) else value


class InputFile(BaseModel):
    path: str                            # relative to data_dir where possible
    sha256: str


class Provenance(BaseModel):
    inputs: list[InputFile]              # sorted by path
    git_commit: str | None
    git_dirty: bool | None
    config_sha256: dict[str, str]        # "decision": canonical JSON of the cfg used; plus config files present
    rules_frozen_commit: str | None
    rules_frozen_date: str | None
    created_at: str                      # ISO-8601 UTC; the only field that differs between identical runs


class Evidence(BaseModel):
    batch: str
    baseline: str
    verdict: Verdict
    reasons: list[str]                   # every verdict trigger that fired, in precedence order
    next_action: str
    unit: Unit
    differences: list[Difference]        # driving unit; used key quantities first
    drivers: list[str] = []              # used key quantities ranked by |difference| / margin
    power: Power
    other_unit: UnitView
    odd_images: list[Odd] = []
    odd_strips: list[Odd] = []
    new_type_share: float | None = None
    imaging: ImagingCheck = ImagingCheck()
    controls: Controls = Controls()
    fingerprint: Fingerprint
    n_images: dict[str, int]             # {"batch": n, "baseline": n}
    explanations: Explanations = Explanations()
    provenance: Provenance | None = None
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
PREVIEWS_DIR = OUT_DIR / "previews"


def crop_path(type_id: str, n: int) -> Path:
    return OUT_DIR / "crops" / type_id / f"{n}.png"


def evidence_path(batch: str, baseline: str) -> Path:
    """One comparison: keyed by baseline too, so a one-off baseline never overwrites the default one."""
    return EVIDENCE_DIR / baseline / f"{batch}.json"


def legacy_evidence_path(batch: str) -> Path:
    """Where evidence lived before it was keyed by baseline; still read, never written."""
    return EVIDENCE_DIR / f"{batch}.json"


def guide_path(batch: str, baseline: str) -> Path:
    """Claude's summary and walkthrough of one comparison (qc/guide.py), cached next to its evidence."""
    return OUT_DIR / "guide" / baseline / f"{batch}.json"


def attribution_path(name: str) -> Path:
    """Batch attribution result (qc/attribute.py) for one run, e.g. a drop folder."""
    return ATTRIBUTION_DIR / f"{name}.json"


def mask_path(batch: str, image_id: str) -> Path:
    """Mask overlay PNG (BSE + coloured phases) for eyeballing and the dashboard."""
    return OUT_DIR / "masks" / batch / f"{image_id}.png"


def load_config(path: Path = CONFIG_PATH) -> dict:
    return yaml.safe_load(path.read_text())
