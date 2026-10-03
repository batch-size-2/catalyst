import json
from pathlib import Path

import numpy as np
import pandas as pd
import tifffile
import yaml
from fastapi.testclient import TestClient
from scipy.ndimage import gaussian_filter

from qc.api import app
from qc.decide import judge
from qc.io import field_paths, iter_fields
from qc.measure import kpis, segment
from qc.run import run
from qc.schema import DETECTORS, KPI_TABLE_COLUMNS, KPI_UNITS, Evidence, Phase, evidence_path, mask_path

FAKE = Path(__file__).parent / "fixtures" / "kpis_fake.csv"
CFG = {"version": "test", "data_dir": "data", "baseline": "base", "reference_exclude": [],
       "band_coverage": 0.95, "ci_level": 0.9, "reject_lower_bound": 0.05}


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


def test_ml_side_returns_contract_types():
    rng = np.random.default_rng(0)
    channels = {d: rng.integers(0, 255, (64, 96), dtype=np.uint8) for d in DETECTORS}
    mask = segment(channels, 0.025)
    assert mask.shape == (64, 96) and mask.dtype == np.uint8
    assert set(np.unique(mask)) <= {int(p) for p in Phase}
    for values in (kpis(mask, 0.025, channels), kpis(mask, 0.025), kpis(np.full_like(mask, Phase.IGNORE), 0.025)):
        assert set(values) <= set(KPI_UNITS) and all(isinstance(v, float) for v in values.values())


def test_reference_exclude_drops_baseline_images():
    table = pd.read_csv(FAKE)
    baseline, batch = table[table["batch"] == "fake_baseline"], table[table["batch"] == "fake_ok"]
    assert judge(baseline, batch, CFG | {"reference_exclude": ["b01", "b02"]}).n_images["baseline"] == 5


def test_backend_side_returns_valid_evidence():
    table = pd.read_csv(FAKE)
    assert list(table.columns) == KPI_TABLE_COLUMNS
    baseline = table[table["batch"] == "fake_baseline"]
    verdicts = {name: judge(baseline, batch, CFG) for name, batch in table.groupby("batch")}
    for evidence in verdicts.values():
        assert Evidence.model_validate_json(evidence.model_dump_json()) == evidence
    assert {k: v.verdict for k, v in verdicts.items()} == {
        "fake_baseline": "ACCEPT", "fake_ok": "ACCEPT", "fake_borderline": "INVESTIGATE", "fake_bad": "REJECT"}


def test_end_to_end_run(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    fake_batch(Path("data/base"), 4)
    fake_batch(Path("data/new"), 2)
    [evidence] = run([Path("data/new")], CFG)
    assert Evidence.model_validate_json(evidence_path("new").read_text()) == evidence
    assert len(evidence.tiles) == 2 and all(mask_path("new", t.image_id).exists() for t in evidence.tiles)
    assert set(pd.read_csv("out/kpis.csv")["batch"]) == {"base", "new"}
    assert len(field_paths(Path("data/base"))) == 4


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
    assert client.get(f"/api/masks/new/{evidence.tiles[0].image_id}.png").status_code == 200
