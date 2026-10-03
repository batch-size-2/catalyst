import json
from pathlib import Path

import numpy as np
import pandas as pd
import tifffile
import yaml
from fastapi.testclient import TestClient
from scipy.ndimage import gaussian_filter

from qc.api import app
from qc.decide import evaluate, power, split_tables
from qc.io import field_paths, iter_fields
from qc.measure import kpis, segment
from qc.run import run
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


def test_end_to_end_run(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    fake_batch(Path("data/base"), 4)
    fake_batch(Path("data/new"), 2)
    first, second = run([Path("data/new")], CFG), run([Path("data/new")], CFG)
    assert Evidence.model_validate_json(evidence_path("new").read_text()) == second[0]

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


def test_api_survives_stale_v1_evidence(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(yaml.safe_dump(CFG))
    Path("out/evidence").mkdir(parents=True)
    Path("out/evidence/old.json").write_text(json.dumps({"verdict": "ACCEPT", "tiles": []}))
    client = TestClient(app)
    assert client.get("/api/batches").json() == [{"name": "old", "has_images": False, "verdict": "ACCEPT"}]
    assert client.get("/api/evidence/old").status_code == 409
