import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml
from fastapi.testclient import TestClient

from qc import slab
from qc.api import app
from qc.schema import load_config

CFG = load_config() | {"data_dir": "data", "baseline": "base"}


def fake_tables(rng: np.random.Generator) -> tuple[pd.DataFrame, pd.DataFrame]:
    kpis, particles = [], []
    for batch, si, pore in (("base", 0.06, 0.10), ("dense", 0.08, 0.06)):
        for i in range(3):
            image_id = f"{batch}{i}"
            kpis.append({"batch": batch, "image_id": image_id, "strip_id": f"s{i}", "px_um": 0.025,
                         "si_area_frac": si + 0.003 * i, "porosity_apparent": pore + 0.002 * i, "si_d50_um": 3.5,
                         "si_agglomerate_frac": 0.4, "si_corr_length_um": 1.7})
            particles += [{"batch": batch, "image_id": image_id, "d_um": d, "void_frac": 0.0, "border": False}
                          for d in rng.lognormal(np.log(1.5), 0.6, 120)]
    return pd.DataFrame(kpis), pd.DataFrame(particles)


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    Path("data/base").mkdir(parents=True)
    Path("data/dense").mkdir()
    Path("out").mkdir()
    kpis, particles = fake_tables(np.random.default_rng(0))
    kpis.to_csv("out/kpis.csv", index=False)
    particles.to_csv("out/particles.csv", index=False)
    return tmp_path


def test_true_fractions_anchor_baseline_and_keep_si_share():
    si, gr, pore = slab.true_fractions(0.06, 0.10, 0.10)
    assert pore == pytest.approx(slab.BASELINE_TRUE_POROSITY)
    assert si / (si + gr) == pytest.approx(0.06 / 0.90) and si + gr + pore == pytest.approx(1)
    assert slab.true_fractions(0.06, 0.05, 0.10)[2] == pytest.approx(slab.BASELINE_TRUE_POROSITY / 2)


def test_capacity_share_is_textbook():
    expected = 0.05 * 2.33 * 3579 / (0.05 * 2.33 * 3579 + 0.65 * 2.26 * 372)
    assert slab.capacity_share(0.05, 0.65) == pytest.approx(expected)
    assert slab.capacity_share(0.05, 0.65, slab.SIOX_Q_MAH_G) < expected


def test_blend_lithiates_silicon_first_and_ends_full():
    curve = slab.blend(0.4)
    assert (np.diff(curve["u"]) <= 1e-9).all()
    early = slab.FILL <= 0.2
    assert (curve["x_si"][early] >= curve["x_gr"][early]).all()
    assert curve["x_si"][-1] == pytest.approx(1, abs=1e-3) and curve["x_gr"][-1] == pytest.approx(1, abs=1e-3)
    assert np.allclose(0.4 * curve["x_si"] + 0.6 * curve["x_gr"], slab.FILL, atol=2e-3)


def test_full_cell_keeps_the_anode_above_zero_volts_at_slow_charge():
    p = slab.physics(0.05, 0.65, 0.30, 0.0)
    assert p["curve"]["u"][-1] > slab.ETA_PER_C * 0.25
    margin = np.array(slab.fast_charge(p["anode"]["u"], p["porosity"])["plating_margin_v"])
    slow, fast = slab.C_RATES.tolist().index(0.25), slab.C_RATES.tolist().index(8)
    assert (margin[slow] > 0).all() and (margin[fast] < 0).any()
    one_c = slab.C_RATES.tolist().index(1)
    assert (margin[one_c][-1] > 0).all()  # CC-CV: no plating at the end of a 1C charge


def test_local_soc_keeps_mean_and_leads_at_separator():
    profile = slab.local_fill(np.array([0.1, 0.5, 0.9]), np.array([0.8, 0.8, 0.8]))
    assert np.allclose(profile.mean(-1), [0.1, 0.5, 0.9], atol=1e-6)
    assert (profile >= 0).all() and (profile <= 1).all()
    assert (profile[:, 0] >= profile[:, -1]).all()


def test_lower_porosity_swells_more_and_plates_sooner():
    open_, dense = slab.physics(0.05, 0.65, 0.30, 0.0), slab.physics(0.05, 0.70, 0.25, 0.0)
    assert dense["porosity"][-1] < open_["porosity"][-1]
    assert slab.plating_onset_c(dense["anode"]["u"], dense["porosity"]) \
        < slab.plating_onset_c(open_["anode"]["u"], open_["porosity"])
    hollow = slab.swelling(0.05, 0.65, 0.30, 0.2, np.ones(1), np.ones(1), 0.5)[0][0]
    assert hollow < slab.swelling(0.05, 0.65, 0.30, 0.0, np.ones(1), np.ones(1), 0.5)[0][0]


def test_packing_hits_target_fractions(workspace):
    result = slab.build("base")
    for key in ("porosity", "si_frac", "graphite_frac"):
        assert result["achieved"][key] == pytest.approx(result["targets"][key], abs=0.015)
    assert result["targets"]["porosity"] == pytest.approx(slab.BASELINE_TRUE_POROSITY, abs=0.01)
    assert len(result["graphite"][0]) == len(result["graphite_columns"])
    assert len(result["silicon"][0]) == len(result["silicon_columns"])
    assert slab.build("base") is result  # cached


def test_api_slab(workspace):
    client = TestClient(app)
    body = client.get("/api/slab/dense").json()
    json.dumps(body, allow_nan=False)
    assert body["targets"]["porosity"] < slab.BASELINE_TRUE_POROSITY
    assert body["indicators"]["plating_onset_c"]["value"] \
        < client.get("/api/slab/base").json()["indicators"]["plating_onset_c"]["value"]
    assert body["section"] is None  # no TIFFs in the fake data folder
    assert client.get("/api/slab/dense?image=dense1").json()["n_images"] == 1
    assert client.get("/api/slab/missing").status_code == 404
