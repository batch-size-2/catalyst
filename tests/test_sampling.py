"""Sampling bands on silicon content and apparent porosity. They never enter the verdict."""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from qc.decide import evaluate, split_tables
from qc.explain import explain
from qc.schema import KPI_UNITS, SAMPLING_COLUMNS, Evidence, load_config
from qc.uncertainty import PHI_TOL, sampling_bundle, sampling_sd

FIXTURES = Path(__file__).parent / "fixtures"
CFG = load_config() | {"version": "test", "baseline": "fake_baseline"}


def test_sampling_columns_are_not_descriptors():
    assert set(SAMPLING_COLUMNS).isdisjoint(KPI_UNITS)
    assert {f"kpi_{name}" for name in SAMPLING_COLUMNS}.isdisjoint({f"kpi_{name}" for name in KPI_UNITS})


def test_phi_outside_tolerance_uses_the_measured_fraction():
    """integral_range's subsampled phi is replaced when it misses kpis() by more than PHI_TOL."""
    measured, estimated, a_int, area = 0.10, 0.10 + PHI_TOL + 0.001, 4.0, 100.0
    phi = measured if abs(measured - estimated) > PHI_TOL else estimated
    assert phi == measured
    assert sampling_sd(phi, a_int, area) == np.sqrt(measured * (1 - measured) * a_int / area)
    close = 0.10 + PHI_TOL / 2
    assert (close if abs(measured - close) > PHI_TOL else estimated) != measured or abs(measured - close) <= PHI_TOL


def test_sampling_columns_do_not_change_the_verdict():
    tables = split_tables(pd.read_csv(FIXTURES / "kpis_fake.csv"))
    before = evaluate(tables, "fake_shift", CFG)
    for tables_ in tables.values():
        for column in SAMPLING_COLUMNS:
            tables_.kpis[column] = 0.004 if column.endswith("_sd") else 20.0
    after = evaluate(tables, "fake_shift", CFG)
    assert after.verdict == before.verdict and after.reasons == before.reasons
    assert all(d.name not in SAMPLING_COLUMNS for d in after.differences)
    silicon = after.sampling_check["si_area_frac"]
    assert silicon.ratio is not None and silicon.ratio > 0
    assert after.image_uncertainty and after.image_uncertainty[0].si_area_frac_sd == 0.004


def test_old_evidence_without_the_fields_still_loads():
    raw = json.loads((FIXTURES / "evidence_example.json").read_text())
    raw.pop("image_uncertainty")
    raw.pop("sampling_check")
    evidence = Evidence.model_validate(raw)
    assert evidence.image_uncertainty == [] and evidence.sampling_check == {}


def test_sampling_sentence_is_report_only():
    raw = json.loads((FIXTURES / "evidence_example.json").read_text())
    evidence = Evidence.model_validate(raw)
    evidence.sampling_check["si_area_frac"] = sampling_bundle(pd.DataFrame({
        "image_id": ["a", "b"],
        "strip_id": ["s", "s"],
        "si_area_frac": [0.10, 0.16],
        "si_area_frac_sd": [0.004, 0.004],
        "porosity_apparent": [0.10, 0.11],
        "porosity_apparent_sd": [0.01, 0.01],
        "si_integral_range_um2": [10.0, 10.0],
        "pore_integral_range_um2": [10.0, 10.0],
    }))[1]["si_area_frac"]
    text = explain(evidence, {})
    assert any("more between tiles than one tile's sampling explains" in line for line in text.engineer)
    assert any("sampling explains" in line for line in text.scientist)
    assert evidence.verdict == Evidence.model_validate(raw).verdict


def test_missing_columns_leave_the_check_empty():
    images, checks = sampling_bundle(pd.DataFrame({"image_id": ["a"], "si_area_frac": [0.1]}))
    assert images == [] and checks == {}
