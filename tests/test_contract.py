from pathlib import Path

import numpy as np
import pandas as pd

from qc.decide import compare
from qc.measure import kpis, segment
from qc.schema import KPI_TABLE_COLUMNS, KPI_UNITS, Evidence, Phase

FAKE = Path(__file__).parent / "fixtures" / "kpis_fake.csv"
CFG = {"version": "test", "ci_level": 0.9, "margin_k_sd": 1.5}


def test_ml_side_returns_contract_types():
    rng = np.random.default_rng(0)
    channels = {d: rng.integers(0, 255, (64, 96), dtype=np.uint8) for d in ("BSE", "ETD", "Inlens")}
    mask = segment(channels, px_um=0.025)
    assert mask.shape == (64, 96) and mask.dtype == np.uint8
    assert set(np.unique(mask)) <= {int(p) for p in Phase}
    values = kpis(mask, px_um=0.025)
    assert set(values) <= set(KPI_UNITS)
    assert all(isinstance(v, float) for v in values.values())


def test_backend_side_returns_valid_evidence():
    table = pd.read_csv(FAKE)
    assert list(table.columns) == KPI_TABLE_COLUMNS
    baseline = table[table["batch"] == "baseline"]
    for name, batch in table[table["batch"] != "baseline"].groupby("batch"):
        evidence = compare(baseline, batch, CFG)
        assert Evidence.model_validate_json(evidence.model_dump_json()) == evidence
