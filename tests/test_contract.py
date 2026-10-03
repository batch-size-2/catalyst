from pathlib import Path

import numpy as np
import pandas as pd
import tifffile
from scipy.ndimage import gaussian_filter

from qc.io import field_paths, iter_fields
from qc.judge import judge
from qc.measure import kpis, segment
from qc.run import run
from qc.schema import DETECTORS, KPI_TABLE_COLUMNS, KPI_UNITS, Evidence, Field, Phase, evidence_path, preview_path

FAKE = Path(__file__).parent / "fixtures" / "kpis_fake.csv"
CFG = {"version": "test", "data_dir": "data", "baseline": "base",
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
    assert abs(field.px_um - 0.025) < 1e-6 and field.strip_id == "P96"


def test_ml_side_returns_contract_types():
    rng = np.random.default_rng(0)
    field = Field("b", "t0", None, {d: rng.integers(0, 255, (64, 96), dtype=np.uint8) for d in DETECTORS}, 0.025)
    mask = segment(field)
    assert mask.shape == (64, 96) and mask.dtype == np.uint8
    assert set(np.unique(mask)) <= {int(p) for p in Phase}
    values = kpis(field, mask)
    assert set(values) <= set(KPI_UNITS) and all(isinstance(v, float) for v in values.values())


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
    assert len(evidence.tiles) == 2 and all(preview_path("new", t.image_id).exists() for t in evidence.tiles)
    assert set(pd.read_csv("out/kpis.csv")["batch"]) == {"base", "new"}
    assert len(field_paths(Path("data/base"))) == 4
