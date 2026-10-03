import json
import sys
from pathlib import Path
from types import ModuleType

import numpy as np
import pandas as pd
import pytest
import tifffile
import yaml
from fastapi.testclient import TestClient
from scipy.ndimage import gaussian_filter

import qc.run as run_module
from qc.api import app
from qc.decide import evaluate, power, split_tables
from qc.io import field_paths, iter_fields, preview_png
from qc.measure import kpis, segment
from qc.provenance import sha256
from qc.run import attribution_module, read_json, run
from qc.schema import (
    DETECTORS, KPI_TABLE_COLUMNS, KPI_UNITS, Evidence, Phase, evidence_path, load_config, mask_path,
)
from tests.synth import fixture_frame

FIXTURES = Path(__file__).parent / "fixtures"
FAKE = FIXTURES / "kpis_fake.csv"
CFG = load_config() | {"version": "test", "data_dir": "data", "baseline": "base"}
FAKE_CFG = CFG | {"baseline": "fake_baseline"}


def fake_tiff(path: Path, seed: int, shape=(96, 160)) -> None:
    grey = gaussian_filter(np.random.default_rng(seed).normal(size=shape), 4)
    grey = np.uint8(255 * (grey - grey.min()) / np.ptp(grey))
    tifffile.imwrite(path, np.dstack([grey] * 3), photometric="rgb", resolution=(1_016_000, 1_016_000), resolutionunit=2)


def fake_batch(batch_dir: Path, n_fields: int, detectors=("BSE", "ETD", "Inlens")) -> None:
    batch_dir.mkdir(parents=True)
    for i in range(n_fields):
        for detector in detectors:
            fake_tiff(batch_dir / f"img_{batch_dir.name}{i}_{detector}.tif", seed=i)


def test_io_builds_fields_with_canonical_detectors(tmp_path):
    fake_batch(tmp_path / "b", 1, detectors=("BSE", "SE", "Inlens"))
    [field] = iter_fields(tmp_path / "b")
    assert set(field.channels) == set(DETECTORS)
    assert field.channels["BSE"].shape == (96, 160 - 16) and field.channels["BSE"].dtype == np.uint8
    assert abs(field.px_um - 0.025) < 1e-6 and field.strip_id == "96_1016000"
    assert set(field.black_level) == set(DETECTORS)
    assert all(isinstance(v, float) and 0 <= v <= 255 for v in field.black_level.values())


def test_ml_side_returns_contract_types():
    rng = np.random.default_rng(0)
    channels = {d: rng.integers(0, 255, (64, 96), dtype=np.uint8) for d in DETECTORS}
    mask = segment(channels, 0.025)
    assert mask.shape == (64, 96) and mask.dtype == np.uint8
    assert set(np.unique(mask)) <= {int(p) for p in Phase}
    for values in (kpis(mask, 0.025, channels), kpis(mask, 0.025), kpis(np.full_like(mask, Phase.IGNORE), 0.025)):
        assert set(values) <= set(KPI_UNITS) and all(isinstance(v, float) for v in values.values())


def test_fixture_is_what_synth_writes():
    table = pd.read_csv(FAKE)
    assert set(KPI_TABLE_COLUMNS) <= set(table.columns)
    assert fixture_frame().to_csv(index=False, float_format="%.5g") == FAKE.read_text()


def test_evaluate_fixture_round_trips():
    tables = split_tables(pd.read_csv(FAKE))
    for name in tables:  # includes fake_baseline vs itself
        evidence = evaluate(tables, name, FAKE_CFG)
        assert Evidence.model_validate_json(evidence.model_dump_json()) == evidence


def test_reference_exclude_drops_baseline_images():
    tables = split_tables(pd.read_csv(FAKE))
    excluded = list(tables["fake_baseline"].kpis["image_id"][:2])
    evidence = evaluate(tables, "fake_ok", FAKE_CFG | {"reference_exclude": excluded})
    assert evidence.n_images["baseline"] == len(tables["fake_baseline"].kpis) - 2


def test_segment_values_are_area_weighted():
    rows = [
        {"batch": "r", "image_id": "r1", "strip_id": "rs", "area_um2": 1.0, "si_area_frac": 0.5},
        {"batch": "b", "image_id": "b1", "strip_id": "s", "area_um2": 1.0, "si_area_frac": 0.0},
        {"batch": "b", "image_id": "b2", "strip_id": "s", "area_um2": 3.0, "si_area_frac": 1.0},
        {"batch": "b", "image_id": "b3", "strip_id": "s", "area_um2": 1.0, "si_area_frac": np.nan},
    ]
    [segment] = evaluate(split_tables(pd.DataFrame(rows)), "b", CFG | {"baseline": "r"}).fingerprint.segments
    assert segment.values["si_area_frac"] == 0.75  # (0*1 + 1*3) / 4; the NaN image is ignored
    assert segment.area_um2 == 5.0


def test_power_arithmetic():
    p = power(3, 3, 0.1)
    assert (p.n_arrangements, p.min_p, p.limited, p.extra_needed) == (20, 0.1, True, 1)
    p = power(3, 4, 0.1)
    assert (p.n_arrangements, round(p.min_p, 4), p.limited, p.extra_needed) == (35, 0.0286, False, 0)
    p = power(2, 2, 0.1)
    assert (p.n_arrangements, round(p.min_p, 4), p.limited, p.extra_needed) == (6, 0.3333, True, 2)
    power(0, 0, 0.1)  # must not crash


def test_evidence_example_validates():
    raw = json.loads((FIXTURES / "evidence_example.json").read_text())
    assert Evidence.model_validate(raw).model_dump(mode="json") == raw


def test_api_reads_pat_attribution_files(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    path = Path("out/attribution/example_drop.json")
    path.parent.mkdir(parents=True)
    raw = json.loads((FIXTURES / "attribution_example.json").read_text())
    path.write_text(json.dumps(raw))
    evaluation = json.loads((FIXTURES / "attribution_evaluation_example.json").read_text())
    evaluation_path = Path("out/attribution/evaluation.json")
    evaluation_path.write_text(json.dumps(evaluation))
    client = TestClient(app)

    assert client.get("/api/attribution").json() == ["example_drop"]
    assert client.get("/api/attribution/example_drop").json() == raw
    assert client.get("/api/attribution-evaluation").json() == evaluation
    assert client.get("/api/attribution/missing").status_code == 404
    evaluation_path.unlink()
    assert client.get("/api/attribution-evaluation").status_code == 404


def test_api_reports_the_attribution_model_in_use(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    client = TestClient(app)
    assert client.get("/api/attribution-model").status_code == 404
    Path("config").mkdir()
    model = {"kind": "staged", "staged": [["tex"], ["deep"]], "fitted_at": "2026-10-03T21:27:23", "classes": ["Batch_1", "Batch_3"],
             "baseline": "Batch_3", "trained_on": {"Batch_1": ["a"], "Batch_3": ["b", "c"]}, "loso": {"balanced_accuracy": 0.66}}
    Path("config/attribution_model.json").write_text(json.dumps(model))
    status = client.get("/api/attribution-model").json()
    assert status["kind"] == "staged" and status["fitted_at"] == model["fitted_at"]
    assert status["n_trained_on"] == {"Batch_1": 1, "Batch_3": 2} and status["loso_balanced_accuracy"] == 0.66
    assert status["sha256"] == sha256(Path("config/attribution_model.json"))
    assert status["matches_frozen"] is None  # no rules-frozen tag here


def test_read_json_maps_nonstandard_numbers_to_null(tmp_path):
    path = tmp_path / "pat.json"
    path.write_text('{"nan": NaN, "positive": Infinity, "negative": -Infinity}')
    assert read_json(path) == {"nan": None, "positive": None, "negative": None}


def test_api_attribution_without_module_returns_501(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    monkeypatch.setitem(sys.modules, "qc.attribute", None)  # as if the module were absent
    response = TestClient(app).post("/api/attribution/drop")
    assert response.status_code == 501
    assert response.json()["detail"] == "batch attribution is not available yet (qc/attribute.py)"


def test_api_attribution_with_module_streams_and_writes(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    fake_batch(Path("upload_src"), 2)
    files = [("files", (p.name, p.read_bytes(), "image/tiff")) for p in sorted(Path("upload_src").iterdir())]
    client = TestClient(app)
    assert client.post("/api/batches/drop/files", files=files).json() == {"saved": 6}

    template = json.loads((FIXTURES / "attribution_example.json").read_text())
    fake = ModuleType("qc.attribute")
    seen = {}

    def attribute_images(image_dir, model, balanced=None):
        seen.update(image_dir=image_dir, model=model, balanced=balanced)
        result = template | {"run": image_dir.name}
        result["images"][0]["baseline_distance"] = float("nan")
        path = Path("out/attribution") / f"{image_dir.name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result))

    fake.load_model = lambda: {"x": 1}
    fake.attribute_images = attribute_images
    monkeypatch.setitem(sys.modules, "qc.attribute", fake)
    events = [json.loads(line) for line in client.post("/api/attribution/drop?balanced=3").text.splitlines()]
    assert events[-1]["type"] == "done" and events[-1]["attribution"]["run"] == "drop"
    assert events[-1]["attribution"]["images"][0]["baseline_distance"] is None
    assert seen == {"image_dir": Path("data/drop"), "model": {"x": 1}, "balanced": 3}


def test_api_attribution_without_model_returns_error(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    fake = ModuleType("qc.attribute")
    fake.load_model = lambda: None
    monkeypatch.setitem(sys.modules, "qc.attribute", fake)
    events = [json.loads(line) for line in TestClient(app).post("/api/attribution/drop").text.splitlines()]
    assert events[-1]["type"] == "error" and "--fit" in events[-1]["message"]


def test_attribution_module_detects_optional_module(monkeypatch):
    monkeypatch.setitem(sys.modules, "qc.attribute", None)  # as if the module were absent
    assert attribution_module() is None
    fake = ModuleType("qc.attribute")
    monkeypatch.setitem(sys.modules, "qc.attribute", fake)
    assert attribution_module() is fake

    def fail_import(_):
        raise ModuleNotFoundError("missing model dependency", name="missing_model_dependency")

    monkeypatch.setattr(run_module.importlib, "import_module", fail_import)
    with pytest.raises(ModuleNotFoundError, match="missing model dependency"):
        attribution_module()


def test_end_to_end_run(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    fake_batch(Path("data/base"), 4)
    fake_batch(Path("data/new"), 2)
    first, second = run([Path("data/new")], CFG), run([Path("data/new")], CFG)
    assert Evidence.model_validate_json(evidence_path("new", "base").read_text()) == second[0]
    assert second[0].explanations.summary and second[0].explanations.next_steps
    assert all(isinstance(s, str) for s in second[0].explanations.engineer)

    assert "area_um2" in pd.read_csv("out/kpis.csv").columns
    image_ids = [i for s in second[0].fingerprint.segments for i in s.image_ids]
    assert len(image_ids) == 2 and all(mask_path("new", i).exists() for i in image_ids)
    assert set(pd.read_csv("out/kpis.csv")["batch"]) == {"base", "new"}
    assert len(field_paths(Path("data/base"))) == 4

    provenance = second[0].provenance
    assert {i.path for i in provenance.inputs} == {str(p.relative_to("data")) for p in Path("data").glob("*/*.tif")}
    assert all(len(i.sha256) == 64 for i in provenance.inputs)
    a, b = first[0].model_dump(mode="json"), second[0].model_dump(mode="json")
    a["provenance"].pop("created_at"), b["provenance"].pop("created_at")
    assert a == b  # identical runs, only the timestamp differs


def test_api_upload_run_and_read(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    fake_batch(Path("data/base"), 3)
    fake_batch(Path("upload_src"), 2)
    client = TestClient(app)

    files = [("files", (p.name, p.read_bytes(), "image/tiff")) for p in sorted(Path("upload_src").iterdir())]
    assert client.post("/api/batches/new/files", files=files).json() == {"saved": 6}
    events = [json.loads(line) for line in client.post("/api/runs/new").text.splitlines()]
    assert [e["done"] for e in events if e["type"] == "progress"] == [1, 2, 3, 4, 5]
    assert events[-1]["type"] == "done"

    evidence = Evidence.model_validate(client.get("/api/evidence/new").json())
    assert {b["name"]: b["verdict"] for b in client.get("/api/batches").json()}["new"] == evidence.verdict
    image_id = evidence.fingerprint.segments[0].image_ids[0]
    assert client.get(f"/api/masks/new/{image_id}.png").status_code == 200


def test_api_tiles_joins_kpis(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    fake_batch(Path("data/base"), 2)
    Path("out").mkdir()
    pd.DataFrame([
        {"batch": "base", "image_id": "base0", "strip_id": "s0", "si_area_frac": 0.4},
        {"batch": "other", "image_id": "o0", "strip_id": "s1", "si_area_frac": 0.9},
    ]).to_csv("out/kpis.csv", index=False)
    tiles = TestClient(app).get("/api/tiles").json()
    assert sorted(t["image_id"] for t in tiles) == ["base0", "base1"]
    tile = next(t for t in tiles if t["image_id"] == "base0")
    assert tile["batch"] == "base" and tile["strip_id"] == "s0" and tile["has_mask"] is False
    assert tile["detectors"] == ["BSE", "ETD", "InLens"]
    assert tile["kpis"]["si_area_frac"] == 0.4 and tile["kpis"]["si_d50_um"] is None
    assert next(t for t in tiles if t["image_id"] == "base1")["kpis"] is None


def test_api_image_preview(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    fake_batch(Path("data/base"), 1)
    client = TestClient(app)
    url = "/api/images/base/base0/BSE?size=512"
    res = client.get(url)
    assert res.status_code == 200 and res.headers["content-type"] == "image/png"
    assert res.content.startswith(b"\x89PNG")
    assert client.get("/api/images/base/base0/bse?size=512").status_code == 200  # aliases
    assert client.get("/api/images/base/base0/SE?size=512").status_code == 200   # SE -> ETD
    assert client.get("/api/images/base/base0/InLens?size=2048").status_code == 200
    assert client.get("/api/images/base/base0/BSE?size=1024").status_code == 400
    assert client.get("/api/images/base/missing/BSE").status_code == 404
    assert client.get("/api/images/base/.hidden/BSE").status_code == 400


def test_preview_png_caches(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    fake_batch(Path("data/base"), 1)
    tif = next(Path("data/base").glob("*_BSE.tif"))
    first = preview_png(tif, 512)
    second = preview_png(tif, 512)
    assert first == second and str(first).endswith("base0_BSE_512.png")
    import time
    time.sleep(0.01)
    tif.touch()
    assert preview_png(tif, 512).stat().st_mtime >= tif.stat().st_mtime


def test_api_verify(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    fake_batch(Path("data/base"), 2)
    fake_batch(Path("data/new"), 1)
    run([Path("data/new")], CFG)
    client = TestClient(app)
    assert client.post("/api/verify/none").status_code == 404
    result = client.post("/api/verify/new").json()
    assert result["ok"] is True and result["config_ok"] is True
    assert all(f["ok"] for f in result["files"]) and len(result["files"]) > 0
    next(Path("data/base").glob("*.tif")).write_bytes(b"tampered")
    result = client.post("/api/verify/new").json()
    assert result["ok"] is False and not all(f["ok"] for f in result["files"])


def test_api_survives_stale_v1_evidence(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    Path("out/evidence/base").mkdir(parents=True)
    Path("out/evidence/base/old.json").write_text(json.dumps({"verdict": "ACCEPT", "tiles": []}))
    client = TestClient(app)
    assert client.get("/api/batches").json() == [{"name": "old", "has_images": False, "verdict": "ACCEPT"}]
    assert client.get("/api/evidence/old").status_code == 409


def test_one_off_baseline_is_stored_apart_from_the_default(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    fake_batch(Path("data/base"), 3)
    fake_batch(Path("data/other"), 3)
    fake_batch(Path("data/new"), 2)
    client = TestClient(app)
    for baseline in ("", "?baseline=other"):
        events = [json.loads(line) for line in client.post(f"/api/runs/new{baseline}").text.splitlines()]
        assert events[-1]["type"] == "done"
    assert evidence_path("new", "base").exists() and evidence_path("new", "other").exists()
    assert client.get("/api/evidence/new").json()["baseline"] == "base"
    assert client.get("/api/evidence/new?baseline=other").json()["baseline"] == "other"
    assert client.get("/api/evidence/new?baseline=../x").status_code == 400
    assert {(d["batch"], d["baseline"]) for d in client.get("/api/evidence").json()} == {("new", "base"), ("new", "other")}
    assert client.post("/api/verify/new?baseline=other").json()["ok"] is True
    assert load_config()["baseline"] == "base"  # the default didn't move


def test_settings_change_the_default_baseline_until_frozen(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text("version: t\ndata_dir: data\nbaseline: base\nunit: image\n")
    fake_batch(Path("data/base"), 1)
    fake_batch(Path("data/other"), 1)
    client = TestClient(app)
    settings = client.get("/api/settings").json()
    assert settings["baseline"] == "base" and settings["rules_frozen_commit"] is None
    assert set(settings["claude"]) == {"available", "model", "reason"}
    assert client.put("/api/settings/baseline", json={"baseline": "missing"}).status_code == 404
    assert client.put("/api/settings/baseline", json={"baseline": "other"}).json() == {"baseline": "other"}
    assert Path("config/decision.yaml").read_text() == "version: t\ndata_dir: data\nbaseline: other\nunit: image\n"

    monkeypatch.setattr(run_module, "rules_frozen", lambda: ("5d1ccfb1cc28", "2026-10-03"))
    response = client.put("/api/settings/baseline", json={"baseline": "base"})
    assert response.status_code == 409 and "frozen" in response.json()["detail"]
    assert load_config()["baseline"] == "other"


def test_api_measures_a_drop_folder(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    fake_batch(Path("data/drop_x"), 1)
    client = TestClient(app)
    events = [json.loads(line) for line in client.post("/api/measure/drop_x").text.splitlines()]
    assert events[-1] == {"type": "done", "measured": 1}
    assert next(t for t in client.get("/api/tiles").json() if t["batch"] == "drop_x")["kpis"] is not None
    assert client.post("/api/measure/missing").status_code == 404
