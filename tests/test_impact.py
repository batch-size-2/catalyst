"""qc/impact.py: textbook relations, intervals, effects and the API wrapper."""

import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from qc.impact import NotMeasured, effect_of, impact_report, load_impact_config, Range

ROOT = Path(__file__).parent.parent


def frame(batch: str, n_strips: int = 4, per_strip: int = 3, noise: float = 0.0, seed: int = 0,
          **values: float) -> pd.DataFrame:
    base = dict(si_area_frac=0.06, si_graphite_ratio=0.075, porosity_apparent=0.10, si_d50_um=3.6,
                si_d90_um=6.5, si_internal_void_frac=0.003, si_agglomerate_frac=0.44, si_dispersion_cv=0.65)
    base.update(values)
    rng = np.random.default_rng(seed)
    rows = []
    for s in range(n_strips):
        for i in range(per_strip):
            row = {k: v * (1 + noise * rng.standard_normal()) for k, v in base.items()}
            rows.append({"batch": batch, "image_id": f"{batch}_{s}_{i}", "strip_id": f"{batch}_S{s}", **row})
    return pd.DataFrame(rows)


def config(**overrides) -> dict:
    cfg = load_impact_config(ROOT / "config/impact.yaml")
    cfg["n_resamples"] = 200
    cfg.update(overrides)
    return cfg


def by_id(report):
    return {impact.id: impact for impact in report.impacts}


def test_identical_batches_are_similar_everywhere():
    kpis = pd.concat([frame("ref"), frame("new")])
    report = impact_report(kpis, None, "new", "ref", config())
    for impact in report.impacts:
        assert impact.effect == "similar", impact.id
        assert impact.change.value == pytest.approx(0)
    assert report.scenario.cycles_to_80.value == pytest.approx(report.scenario.cycles_to_80.low)
    assert report.scenario.fade_scale.value == pytest.approx(1)
    assert report.scenario.cycles_to_80.value == pytest.approx(500)
    assert report.scenario.batch_mid == pytest.approx(report.scenario.baseline)


def test_capacity_matches_the_rule_of_mixtures():
    si = {"name": "Si", "capacity_mah_g": 3579, "expansion": 2.8, "density_g_cm3": 2.33}
    kpis = pd.concat([frame("ref"), frame("new", si_area_frac=0.12, si_graphite_ratio=0.15)])
    report = impact_report(kpis, None, "new", "ref", config(silicon=[si]))

    def expected(ratio: float) -> float:
        s = ratio / (1 + ratio)
        w = s * 2.33 / (s * 2.33 + (1 - s) * 2.26)
        return w * 3579 + (1 - w) * 372

    capacity = by_id(report)["capacity"]
    assert capacity.batch.value == pytest.approx(expected(0.15))
    assert capacity.baseline.value == pytest.approx(expected(0.075))
    assert capacity.change.value == pytest.approx(expected(0.15) / expected(0.075) - 1)


def test_more_silicon_trades_capacity_for_swelling_and_sei():
    kpis = pd.concat([frame("ref", noise=0.05), frame("new", noise=0.05, seed=1, si_area_frac=0.12,
                                                       si_graphite_ratio=0.15)])
    impacts = by_id(impact_report(kpis, None, "new", "ref", config()))
    assert impacts["capacity"].effect == "better"
    assert impacts["swelling"].effect == "worse"
    assert impacts["sei"].effect == "worse"
    assert impacts["capacity"].change.low > 0


def test_lower_porosity_slows_transport_by_bruggeman():
    kpis = pd.concat([frame("ref", porosity_apparent=0.30), frame("new", porosity_apparent=0.15)])
    transport = by_id(impact_report(kpis, None, "new", "ref", config(transport_exponent=[1.5, 1.5])))["transport"]
    assert transport.effect == "worse"
    assert transport.change.value == pytest.approx(0.5 ** 1.5 - 1)


def test_coarser_silicon_cracks_harder_but_has_less_surface():
    kpis = pd.concat([frame("ref"), frame("new", si_d50_um=7.2, si_d90_um=13.0)])
    impacts = by_id(impact_report(kpis, None, "new", "ref", config()))
    assert impacts["cracking"].effect == "worse"
    assert impacts["sei"].effect == "better"  # no particle table: D50 stands in for D32
    assert impacts["sei"].change.value == pytest.approx(0.5 - 1)


def test_particle_table_gives_the_sauter_diameter():
    kpis = pd.concat([frame("ref", n_strips=1, per_strip=1), frame("new", n_strips=1, per_strip=1)])
    particles = pd.DataFrame([
        {"batch": b, "image_id": f"{b}_0_0", "d_um": d, "border": border}
        for b, ds in (("ref", [1.0, 3.0]), ("new", [2.0, 2.0])) for d, border in zip(ds, [False, False])
    ] + [{"batch": "new", "image_id": "new_0_0", "d_um": 50.0, "border": True}])
    sei = by_id(impact_report(kpis, particles, "new", "ref", config()))["sei"]
    d32_ref = (1 + 27) / (1 + 9)
    assert sei.change.value == pytest.approx(d32_ref / 2.0 - 1)  # the edge particle is left out


def test_noisy_samples_stay_unsettled():
    kpis = pd.concat([frame("ref", n_strips=4, per_strip=2, noise=0.3),
                      frame("new", n_strips=4, per_strip=2, noise=0.3, seed=3, si_area_frac=0.063)])
    assert by_id(impact_report(kpis, None, "new", "ref", config()))["capacity"].effect == "unsettled"


def test_too_few_strips_never_settle():
    kpis = pd.concat([frame("ref"), frame("new", n_strips=2, si_area_frac=0.12, si_graphite_ratio=0.15)])
    report = impact_report(kpis, None, "new", "ref", config())
    assert {impact.effect for impact in report.impacts} == {"unsettled"}
    assert report.n_strips == {"new": 2, "ref": 4}
    assert any("Fewer than 3 strips" in caveat for caveat in report.caveats)
    assert report.scenario is None


def test_missing_values_do_not_crash_and_read_unsettled():
    kpis = pd.concat([frame("ref", si_agglomerate_frac=np.nan), frame("new", si_agglomerate_frac=np.nan)])
    agglomeration = by_id(impact_report(kpis, None, "new", "ref", config()))["agglomeration"]
    assert agglomeration.effect == "unsettled"
    assert agglomeration.change.value is None


def test_report_is_deterministic_and_json_safe():
    kpis = pd.concat([frame("ref", noise=0.1), frame("new", noise=0.1, seed=2, porosity_apparent=0.08)])
    one = impact_report(kpis, None, "new", "ref", config()).model_dump_json()
    two = impact_report(kpis, None, "new", "ref", config()).model_dump_json()
    assert one == two
    assert "NaN" not in one and "Infinity" not in one


def test_unknown_batch_raises():
    with pytest.raises(NotMeasured):
        impact_report(frame("ref"), None, "nope", "ref", config())


@pytest.mark.parametrize("low, high, higher_is, expected", [
    (-0.02, 0.03, "better", "similar"),
    (0.10, 0.30, "better", "better"),
    (0.10, 0.30, "worse", "worse"),
    (-0.30, -0.10, "worse", "better"),
    (-0.10, 0.20, "better", "unsettled"),
    (None, None, "better", "unsettled"),
])
def test_effect_of(low, high, higher_is, expected):
    assert effect_of(Range(value=0, low=low, high=high), higher_is, 0.05) == expected


def test_api_serves_the_report(tmp_path, monkeypatch):
    from qc.api import app

    shutil.copytree(ROOT / "config", tmp_path / "config")
    (tmp_path / "out").mkdir()
    pd.concat([frame("Batch_3"), frame("Batch_1", si_area_frac=0.08, si_graphite_ratio=0.1)]).to_csv(
        tmp_path / "out" / "kpis.csv", index=False)
    monkeypatch.chdir(tmp_path)
    client = TestClient(app)
    body = client.get("/api/impact/Batch_1").json()
    assert body["baseline"] == "Batch_3" and body["batch"] == "Batch_1"
    assert {i["id"] for i in body["impacts"]} == {
        "capacity", "swelling", "transport", "sei", "cracking", "agglomeration"}
    assert client.get("/api/impact/Batch_3?baseline=Batch_1").json()["baseline"] == "Batch_1"
    assert client.get("/api/impact/Batch_9").status_code == 404
    assert client.get("/api/impact/Batch_1?baseline=..").status_code == 400


def test_worst_cases_only_when_the_adverse_side_is_reached():
    same = impact_report(pd.concat([frame("ref"), frame("new")]), None, "new", "ref", config())
    assert same.worst is None and all(i.worst_case is None for i in same.impacts)

    denser = impact_report(pd.concat([frame("ref", porosity_apparent=0.30), frame("new", porosity_apparent=0.15)]),
                           None, "new", "ref", config())
    transport = by_id(denser)["transport"].worst_case
    assert transport.severity == "safety" and transport.trigger == "likely"
    assert denser.worst == "transport"


def test_less_capacity_reports_the_np_margin():
    si = {"name": "Si", "capacity_mah_g": 3579, "expansion": 2.8, "density_g_cm3": 2.33}
    report = impact_report(pd.concat([frame("ref"), frame("new", si_area_frac=0.03, si_graphite_ratio=0.035)]),
                           None, "new", "ref", config(silicon=[si]))
    capacity = by_id(report)["capacity"]
    assert capacity.effect == "worse" and capacity.worst_case.trigger == "likely"
    assert f"brings it to {1.1 * (1 + capacity.change.value):.2f}" in capacity.worst_case.detail
    assert "if Si" in capacity.worst_case.detail


def test_missing_columns_and_all_nan_inputs_stay_json_safe():
    kpis = pd.concat([frame("ref", porosity_apparent=np.nan, si_d50_um=np.nan),
                      frame("new", porosity_apparent=np.nan, si_d50_um=np.nan)]).drop(columns=["si_dispersion_cv"])
    particles = pd.DataFrame({"batch": ["ref"], "image_id": ["ref_0_0"], "d_um": ["x"]})  # no border, bad value
    report = impact_report(kpis, particles, "new", "ref", config())
    text = report.model_dump_json()
    assert "NaN" not in text and "Infinity" not in text
    assert by_id(report)["transport"].effect == "unsettled"
    assert by_id(report)["sei"].change.value is None


def test_api_without_kpi_table_is_404(tmp_path, monkeypatch):
    from qc.api import app

    shutil.copytree(ROOT / "config", tmp_path / "config")
    monkeypatch.chdir(tmp_path)
    assert TestClient(app).get("/api/impact/Batch_1").status_code == 404
