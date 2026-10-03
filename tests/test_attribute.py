"""qc/features.py and qc/attribute.py on synthetic fields: three designed "batches" with real material
differences (Si loading, Si particle size) and no strip, size or pixel-size leakage."""

import json

import numpy as np
import pandas as pd
import pytest

from qc import attribute as A
from qc import features as F
from qc.schema import Field

from test_ml import PX, synth_field

TILE_UM = 4.0  # synthetic fields are 12 um tall, so tiles must be small


def _batch(name: str, offset: int, n_si: int, scale: float, n_strips: int = 4, per_strip: int = 2) -> list[Field]:
    fields = []
    for s in range(n_strips):
        for k in range(per_strip):
            ch, _, _ = synth_field(seed=1000 * offset + 10 * s + k, shape=(480, 960), n_si=n_si)
            if scale != 1.0:  # rescale particle sizes: zoom every channel, crop or tile back to shape
                from scipy.ndimage import zoom

                for c in ("BSE", "ETD", "InLens"):
                    z = zoom(ch[c].astype(float), scale, order=1)
                    z = np.tile(z, (int(np.ceil(480 / z.shape[0])), int(np.ceil(960 / z.shape[1]))))[:480, :960]
                    ch[c] = np.clip(z, 0, 255).astype(np.uint8)
            fields.append(Field(name, f"{name}_s{s}_{k}", f"{offset * 10 + s}_1016000", ch, PX))
    return fields


@pytest.fixture(scope="module")
def table() -> pd.DataFrame:
    # Batch_1: many small Si particles; Batch_2: few large ones; Batch_3 (baseline): in between
    fields = _batch("Batch_1", 1, n_si=34, scale=0.7) + _batch("Batch_2", 2, n_si=10, scale=1.6) + _batch("Batch_3", 3, n_si=20, scale=1.0)
    return pd.DataFrame([F.image_features(f, tile_um=TILE_UM) for f in fields])


def test_feature_table_shape_and_families(table):
    assert list(table.columns[:3]) == F.META_COLUMNS
    assert len(table) == 24
    for fam in F.FAMILIES:
        assert F.feature_columns(table, (fam,)), fam
    F.assert_no_leakage(table.columns)
    assert not F.feature_columns(table, F.MATERIAL_FAMILIES) == F.feature_columns(table, F.FAMILIES)  # imaging kept apart
    # regional features see the designed Si loading
    d50 = table.groupby("batch")["kpi_si_d50_um"].mean()
    assert d50["Batch_1"] < d50["Batch_3"] < d50["Batch_2"]


def test_leakage_guard():
    with pytest.raises(ValueError):
        F.assert_no_leakage(["batch", "image_id", "reg_si_frac_mean", "strip_number"])
    with pytest.raises(ValueError):
        F.assert_no_leakage(["img_height"])
    F.assert_no_leakage(["batch", "image_id", "strip_id", "reg_si_frac_mean"])


def test_loso_separates_designed_batches_above_null(table):
    cv = A.loso_cv(table)
    assert cv["n_strips"] == 12 and cv["n_images"] == 24
    assert cv["balanced_accuracy"] >= 0.75
    null = A.permutation_null(table, n=15, seed=1)
    assert cv["balanced_accuracy"] > null["p95"]
    assert sum(cv["confusion"]["Batch_2"].values()) == 8


def test_model_roundtrip_predict_and_reasons(table, tmp_path):
    model = A.fit_model(table, "Batch_3")
    path = tmp_path / "m.json"
    A.save_model(model, path)
    loaded = A.load_model(path)
    assert loaded["classes"] == ["Batch_1", "Batch_2", "Batch_3"] and loaded["baseline"] == "Batch_3"
    assert not any(any(f in c for f in F.FORBIDDEN) for c in loaded["features"])
    p1, p2 = A.predict(model, table), A.predict(loaded, table)
    probs = p1[[f"p_{c}" for c in model["classes"]]].to_numpy()
    assert np.allclose(probs.sum(axis=1), 1) and np.allclose(probs, p2[[f"p_{c}" for c in model["classes"]]].to_numpy())
    assert (p1["predicted"] == table["batch"]).mean() >= 0.9  # training fit
    assert all(len(r) == A.N_REASONS for r in p1["reasons"])
    assert {"feature", "z", "contribution"} <= set(p1["reasons"][0][0])
    json.dumps(model, default=A._json_default)


def test_balanced_assignment_gives_k_per_class():
    rng = np.random.default_rng(0)
    probs = rng.dirichlet(np.ones(3), size=9)
    assigned = A.balanced_assignment(probs, ["a", "b", "c"], 3)
    assert sorted(assigned) == ["a"] * 3 + ["b"] * 3 + ["c"] * 3
    # unanimous argmax would break balance; assignment must still give 3 each
    skew = np.tile([0.8, 0.1, 0.1], (9, 1))
    assert sorted(A.balanced_assignment(skew, ["a", "b", "c"], 3)) == ["a"] * 3 + ["b"] * 3 + ["c"] * 3


def test_baseline_distance_flags_far_image_not_baseline(table):
    model = A.fit_model(table, "Batch_3")
    bs = model["baseline_stats"]
    assert bs["n_segments"] == 4 and bs["threshold"] is not None
    pred = A.predict(model, table)
    base = pred[pred["batch"] == "Batch_3"]
    assert base["unfamiliar"].sum() <= 1  # baseline images sit inside their own calibration
    far = table[table["batch"] == "Batch_3"].iloc[[0]].copy()
    for c in F.feature_columns(far, F.MATERIAL_FAMILIES):
        far[c] = far[c] * 5 + 3
    out = A.predict(model, far).iloc[0]
    assert out["unfamiliar"] is True or out["unfamiliar"] == True  # noqa: E712
    assert out["baseline_distance"] > bs["threshold"] and out["n_deviating"] > 0
    assert out["deviations"][0]["direction"] in ("above", "below")


def test_dry_run_holds_out_whole_strips(table):
    res = A.dry_run(table, "Batch_3", per_batch=2, seed=0)
    held = pd.DataFrame(res["held_out"])
    assert held.groupby("batch").size().tolist() == [2, 2, 2]
    assert {"balanced_accuracy", "balanced_assignment_accuracy", "train_loso", "C"} <= set(res)
    assert res["balanced_accuracy"] >= 0.5


def test_rank_features_uses_segment_means(table):
    rank = A.rank_features(table, top=10)
    assert {"feature", "family", "effect_size", "loso_acc", "mean_Batch_1", "mean_Batch_3"} <= set(rank.columns)
    assert rank["loso_acc"].iloc[0] >= 0.75
    assert rank["family"].isin(F.FAMILIES).all()
