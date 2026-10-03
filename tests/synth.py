"""Synthetic KPI tables, so qc.decide.compare() can be exercised with no images.

Value = mean + strip effect N(0, strip_sd) + image noise N(0, image_sd) + shifts.
A strip_id in several batches is one physical strip: its effect is drawn from a hash of
(seed, strip_id, quantity), not from iteration order. Shifts are in units of strip_sd.

`python -m tests.synth` rewrites tests/fixtures/kpis_fake.csv deterministically (5 significant digits).
"""

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

from qc.schema import KPI_TABLE_COLUMNS, KPI_UNITS

FIXTURE = Path(__file__).parent / "fixtures" / "kpis_fake.csv"

# name: (mean, strip_sd, image_sd). Every KPI_UNITS key plus si_graphite_ratio (until KPI_UNITS gains it).
QUANTITIES = {
    "si_graphite_ratio": (0.09, 0.012, 0.006),
    "si_area_frac": (0.065, 0.008, 0.005),
    "si_d50_um": (3.2, 0.25, 0.15),
    "si_d90_um": (5.6, 0.4, 0.25),
    "si_internal_void_frac": (0.03, 0.004, 0.003),
    "si_contrast_ratio": (2.1, 0.05, 0.03),
    "si_fragments_per_1e4um2": (120.0, 12.0, 8.0),
    "si_dispersion_cv": (0.35, 0.03, 0.02),
    "porosity_apparent": (0.105, 0.013, 0.008),
}
FRACTIONS = {name for name in QUANTITIES if KPI_UNITS.get(name) == "fraction"} | {"si_graphite_ratio"}

# Mirrors the real strip layout: fake_baseline ~ Batch_3, fake_ok ~ Batch_2, fake_odd ~ Batch_1 (P2316).
LAYOUT = {
    "fake_baseline": {"R1": 3, "R2": 4, "R3": 3, "R4": 1, "R5": 1, "R6": 2, "R7": 3},
    "fake_ok": {"R4": 1, "R5": 1, "R7": 1, "O1": 2, "O2": 1, "O3": 1},
    "fake_odd": {"R4": 1, "D1": 2, "D2": 1, "D3": 1, "D4": 1, "D5": 1},
    "fake_shift": {"S1": 2, "S2": 1, "S3": 1, "S4": 2, "S5": 1, "S6": 1},
}
BATCH_SHIFT = {"fake_shift": {"si_graphite_ratio": 3.0}}
STRIP_SHIFT = {"D1": {"si_graphite_ratio": 8.0}}


def draw(seed: int, *parts: str) -> np.random.Generator:
    digest = hashlib.sha256(f"{seed}:{':'.join(map(str, parts))}".encode()).digest()
    return np.random.default_rng(int.from_bytes(digest[:8], "little"))


def synth_kpis(layout: dict[str, dict[str, int]], *,
               batch_shift: dict[str, dict[str, float]] | None = None,
               strip_shift: dict[str, dict[str, float]] | None = None,
               seed: int = 0) -> pd.DataFrame:
    batch_shift, strip_shift = batch_shift or {}, strip_shift or {}
    rows = []
    for batch, strips in layout.items():
        for strip_id, n_images in strips.items():
            for i in range(n_images):
                image_id = f"{batch}_{strip_id}_{i}"
                row = {"batch": batch, "image_id": image_id, "strip_id": strip_id, "px_um": 0.025,
                       "area_um2": float(6000 + draw(seed, "area", image_id).normal(0, 300))}
                for q, (mean, strip_sd, image_sd) in QUANTITIES.items():
                    value = mean + draw(seed, "strip", strip_id, q).normal(0, strip_sd)
                    value += draw(seed, "image", image_id, q).normal(0, image_sd)
                    value += strip_sd * (batch_shift.get(batch, {}).get(q, 0.0)
                                         + strip_shift.get(strip_id, {}).get(q, 0.0))
                    row[q] = float(np.clip(value, 0, 1)) if q in FRACTIONS else float(value)
                rows.append(row)
    columns = KPI_TABLE_COLUMNS + [q for q in QUANTITIES if q not in KPI_TABLE_COLUMNS]
    return pd.DataFrame(rows, columns=columns)


def fixture_frame() -> pd.DataFrame:
    return synth_kpis(LAYOUT, batch_shift=BATCH_SHIFT, strip_shift=STRIP_SHIFT)


if __name__ == "__main__":
    FIXTURE.write_text(fixture_frame().to_csv(index=False, float_format="%.5g"))
    print(f"wrote {FIXTURE}")
