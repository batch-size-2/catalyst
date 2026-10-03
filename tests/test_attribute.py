"""qc/features.py and qc/attribute.py on synthetic fields: three designed "batches" with real material
differences (Si loading, Si particle size) and no strip, size or pixel-size leakage."""

import json
from pathlib import Path

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


# ---------------------------------------------------------------- deep_ family (no torch needed)

def _fake_embed(x: np.ndarray) -> np.ndarray:
    """Stand-in for DINOv2: a few tile statistics, so the plumbing is tested without the model."""
    return np.stack([x.mean((1, 2)), x.std((1, 2)), np.percentile(x, 10, axis=(1, 2)), np.percentile(x, 90, axis=(1, 2))], 1)


def test_deep_features_columns_and_merge(table):
    from qc import deep as D

    ch, _, _ = synth_field(seed=7, shape=(480, 960), n_si=20)
    field = Field("Batch_1", "img_x", "1_1016000", ch, PX)
    assert D.tiles(D.stretch(ch["InLens"]), scale=2, tile=64).shape[1:] == (64, 64)
    assert D.tiles(np.zeros((40, 40), np.float32), scale=2, tile=64).shape == (1, 64, 64)  # padded
    row = D.deep_features(field, embed=_fake_embed, tile=64)
    cols = [c for c in row if c.startswith("deep_")]
    assert cols[0] == "deep_inlens_s2_mean_000" and len(cols) == 8
    F.assert_no_leakage(row)
    deep = pd.DataFrame([row | {"image_id": table["image_id"].iloc[0], "batch": table["batch"].iloc[0]}])
    merged = D.merge_deep(table, deep)
    assert len(merged) == len(table) and merged[cols].notna().sum().min() == 1
    again = D.merge_deep(merged, deep.assign(**{cols[0]: 99.0}))  # replaces, never duplicates
    assert len(again) == len(table) and again[cols[0]].max() == 99.0


@pytest.fixture(scope="module")
def deep_table(table) -> pd.DataFrame:
    """The synthetic table plus 300 deep_ columns: noise, with the batch signal in 3 directions."""
    rng = np.random.default_rng(0)
    y = table["batch"].map({"Batch_1": -1.0, "Batch_2": 1.0, "Batch_3": 0.0}).to_numpy()
    basis = rng.normal(size=(3, 300))
    deep = rng.normal(size=(len(table), 300)) + 3 * np.column_stack([y, y**2, y]) @ basis
    return pd.concat([table, pd.DataFrame(deep, columns=[f"deep_inlens_s2_mean_{k:03d}" for k in range(300)])], axis=1)


def test_reducer_fits_pca_inside_folds_and_roundtrips(deep_table, tmp_path):
    cv = A.loso_cv(deep_table, ("deep",))
    assert cv["n_features"] == 300 and cv["balanced_accuracy"] >= 0.75
    model = A.fit_model(deep_table, "Batch_3", ("deep",))
    assert model["model_features"] == [f"deep_pc{i:02d}" for i in range(1, A.DEEP_COMPONENTS + 1)]
    assert len(model["coef"][0]) == A.DEEP_COMPONENTS and len(model["baseline_stats"]["mean"]) == A.DEEP_COMPONENTS
    A.save_model(model, tmp_path / "m.json")
    loaded = A.load_model(tmp_path / "m.json")
    p1, p2 = A.predict(model, deep_table), A.predict(loaded, deep_table)
    assert np.allclose(p1["p_Batch_1"], p2["p_Batch_1"])
    assert all(r["feature"].startswith("deep_pc") for r in p1["reasons"].iloc[0])
    mixed = A.fit_model(deep_table, "Batch_3", (*F.MATERIAL_FAMILIES, "deep"))  # material columns pass through
    assert mixed["model_features"][-1] == f"deep_pc{A.DEEP_COMPONENTS:02d}" and "kpi_si_d50_um" in mixed["model_features"]
    assert A.predict(mixed, deep_table)["predicted"].notna().all()


def test_residualize_is_off_by_default_and_removes_a_covariate_from_the_deep_pcs(deep_table):
    plain = A.loso_cv(deep_table, ("deep",))
    assert A.loso_cv(deep_table, ("deep",), residualize=None)["per_image"].equals(plain["per_image"])
    assert "residualize" not in A._fit_parts(deep_table, A.usable_features(deep_table, ("deep",)), None)["all"]
    df = deep_table.copy()
    y = df["batch"].map({"Batch_1": -1.0, "Batch_2": 1.0, "Batch_3": 0.0})
    df["img_y"], df["img_y2"] = y, y**2  # together they span the designed deep signal
    cols = ["img_y", "img_y2"]
    part = A._fit_parts(df, A.usable_features(df, ("deep",)), None, residualize=cols)["all"]
    Xr = A.Reducer.from_json(part["features"], part["reducer"])(A._matrix(df, part["features"]))
    resid = A._residualise(Xr, A._matrix(df, cols), part["residualize"])
    cov = A._matrix(df, cols) - A._matrix(df, cols).mean(axis=0)
    assert np.allclose(resid[:, part["residualize"]["pcs"]].T @ cov, 0, atol=1e-6)
    assert plain["balanced_accuracy"] >= 0.75 and A.loso_cv(df, ("deep",), residualize=cols)["balanced_accuracy"] < 0.6


# ---------------------------------------------------------------- always a bet, confidence, stages, reasons

def test_every_image_gets_a_batch_even_when_unlike_anything(table):
    model = A.fit_model(table, "Batch_3")
    odd = table.iloc[[0, 9, 17]].copy()
    cols = F.feature_columns(odd, F.MATERIAL_FAMILIES)
    odd.loc[odd.index[0], cols] = np.nan                                  # nothing measured
    odd.loc[odd.index[1], cols] = odd.loc[odd.index[1], cols] * -40 + 9   # far from every batch
    out = A.predict(model, odd)
    assert out["predicted"].isin(model["classes"]).all() and np.isfinite(out["confidence"]).all()
    assert all(p in s for p, s in zip(out["predicted"], out["prediction_set"]))
    assert out["confidence_tier"].isin([name for name, _ in A.TIERS]).all()
    assert out["unfamiliar"].iloc[1] == True and out["predicted"].iloc[1] in model["classes"]  # noqa: E712


def test_calibration_is_built_from_out_of_fold_calls(table):
    model = A.fit_model(table, "Batch_3")
    cal = model["calibration"]
    assert cal["n"] == len(table) and sum(t["n"] for t in cal["tiers"]) == len(table)
    assert sum(t["right"] for t in cal["tiers"]) == round(cal["accuracy"] * cal["n"])
    assert 0 <= cal["conformal"]["qhat"] <= 1 and cal["stages"]["baseline"]["n"] == len(table)
    probs = np.array([[0.5, 0.3, 0.2], [0.1, 0.2, 0.7]])
    for t in (0.2, 1.0, 5.0):
        scaled = A._temper(probs, t)
        assert np.allclose(scaled.sum(axis=1), 1) and (scaled.argmax(axis=1) == probs.argmax(axis=1)).all()
    assert A._temper(probs, 0.2).max() > probs.max() > A._temper(probs, 5.0).max()
    out = A.predict(model, table).iloc[0]
    assert out["confidence_record"]["n"] == next(t["n"] for t in cal["tiers"] if t["tier"] == out["confidence_tier"])


def test_stage_calls_say_different_from_baseline_then_in_what_way(table):
    model = A.fit_model(table, "Batch_3")
    out = A.predict(model, table)
    base, other = out[out["predicted"] == "Batch_3"].iloc[0], out[out["predicted"] != "Batch_3"].iloc[0]
    assert base["stage_baseline"]["call"] == "Batch_3" and base["stage_variation"] is None
    assert other["stage_baseline"]["call"] == "not Batch_3" and other["stage_variation"]["call"] == other["predicted"]
    assert 0.5 <= other["stage_variation"]["confidence"] <= 1
    calls = A._stage_calls(np.array([0.34, 0.33, 0.33]), ["Batch_1", "Batch_2", "Batch_3"], "Batch_3")
    assert calls["stage_baseline"]["call"] == "not Batch_3" and abs(calls["stage_variation"]["confidence"] - 0.34 / 0.67) < 1e-9


def test_unfamiliar_is_measured_against_the_assigned_batch(table):
    model = A.fit_model(table, "Batch_3")
    assert set(model["batch_stats"]) == set(model["classes"]) and model["batch_stats"]["Batch_3"] == model["baseline_stats"]
    out = A.predict(model, table)
    assert out["unfamiliar"].sum() <= 2                       # training images sit inside their own batch
    first = out[out["predicted"] == "Batch_1"].iloc[0]         # judged against Batch_1's range, not the baseline's
    assert first["predicted_threshold"] == model["batch_stats"]["Batch_1"]["threshold"]
    assert first["baseline_threshold"] == model["baseline_stats"]["threshold"] and "outside_baseline" in first


def test_reasons_read_in_material_terms(table, deep_table):
    reasons = A.predict(A.fit_model(table, "Batch_3"), table)["reasons"].iloc[0]
    assert all(r["stage"] == "all" and ("SD" in r["text"] or "about the same" in r["text"]) for r in reasons)
    assert all("Batch_3" in r["text"] and r["closest_batch"] in ("Batch_1", "Batch_2", "Batch_3") for r in reasons)
    model = A.fit_model(deep_table, "Batch_3", ("deep",))
    assert set(model["explain"]["translations"]["all"]) == set(model["model_features"])
    reasons = A.predict(model, deep_table)["reasons"].iloc[0]
    top = reasons[0]                                           # the designed signal moves with the material features
    assert top["label"].startswith("DINOv2 image pattern") and top["related"]
    assert all(abs(c["r"]) >= A.TRANSLATE_MIN_R and c["feature"] in model["explain"]["named"] for c in top["related"])
    assert "which moves with" in top["text"] and "r = " in top["text"]


def test_staged_model_roundtrips_and_multiplies_its_stages(deep_table, tmp_path):
    staged = (F.MATERIAL_FAMILIES, ("deep",))
    cv = A.loso_cv(deep_table, staged=staged, baseline="Batch_3")
    assert cv["balanced_accuracy"] >= 0.75 and cv["staged"] == [list(F.MATERIAL_FAMILIES), ["deep"]]
    model = A.fit_model(deep_table, "Batch_3", staged=staged)
    assert model["kind"] == "staged" and set(model["stages"]) == {"baseline", "variation"}
    assert model["stages"]["baseline"]["classes"] == ["Batch_3", "not Batch_3"] and model["stages"]["variation"]["classes"] == ["Batch_1", "Batch_2"]
    A.save_model(model, tmp_path / "m.json")
    p1, p2 = A.predict(model, deep_table), A.predict(A.load_model(tmp_path / "m.json"), deep_table)
    cols = [f"p_{c}" for c in model["classes"]]
    assert np.allclose(p1[cols].sum(axis=1), 1) and np.allclose(p1[cols], p2[cols])
    assert (p1["predicted"] == deep_table["batch"]).mean() >= 0.9
    other = p1[p1["predicted"] != "Batch_3"]["reasons"].iloc[0]
    assert [r["stage"] for r in other] == ["baseline"] * (A.N_REASONS // 2) + ["variation"] * (A.N_REASONS - A.N_REASONS // 2)
    assert {r["stage"] for r in p1[p1["predicted"] == "Batch_3"]["reasons"].iloc[0]} == {"baseline"}
    null = A.permutation_null(deep_table, n=5, seed=1, staged=staged, baseline="Batch_3")
    assert cv["balanced_accuracy"] > null["p95"]


def test_repeated_dry_runs_report_spread_and_held_out_confidence(table):
    res = A.dry_runs(table, "Batch_3", per_batch=2, repeats=3)
    assert res["repeats"] == 3 and 1 <= res["distinct_draws"] <= 3
    assert res["balanced_accuracy"]["min"] <= res["balanced_accuracy"]["mean"] <= res["balanced_accuracy"]["max"]
    assert sum(t["n"] for t in res["tiers"]) == 3 * 6 and 0 <= res["prediction_set"]["coverage"] <= 1
    assert res["prediction_set"]["mean_size"] >= 1 and set(res["per_batch_accuracy"]) == {"Batch_1", "Batch_2", "Batch_3"}


def test_describe_gives_plain_names():
    assert F.describe("kpi_si_d50_um", {"si_d50_um": {"name": "median silicon particle size"}}) == "median silicon particle size"
    assert F.describe("reg_si_frac_sd") == "silicon fraction, spread between regions"
    assert F.describe("tex_inlens_glcm_homogeneity_d1") == "InLens texture smoothness at 0.05 um"
    assert F.describe("tex_bse_si_lbp4") == "BSE fine texture inside silicon: share of straight edges"
    assert F.describe("par_d50_um") == "median silicon particle size (D50)" and F.describe("par_solidity_iqr") == "spread of silicon particle compactness"
    assert F.describe("deep_pc03") == "deep_pc03"


def test_residualize_all_scope_with_reduced_covariates(deep_table):
    df = deep_table.copy()
    rng = np.random.default_rng(1)
    feats = A.usable_features(df, (*F.MATERIAL_FAMILIES, "deep"))
    for j in range(5):
        df[f"img_c{j}"] = df[feats[j]] * (j + 1) + rng.normal(size=len(df))  # covariates that track some features
    spec = {"columns": [f"img_c{j}" for j in range(5)], "scope": "all", "k": 2}
    part = A._fit_parts(df, feats, None, residualize=spec)["all"]
    fit = part["residualize"]
    assert fit["pcs"] == list(range(len(part["model_features"]))) and len(fit["cov_components"]) == 2
    Xr = A.Reducer.from_json(part["features"], part["reducer"])(A._matrix(df, part["features"]))
    raw = A._matrix(df, spec["columns"])
    resid = A._residualise(Xr, raw, fit)
    c = A._covariates(raw, fit)
    ok = np.isfinite(Xr).all(axis=0)
    r = resid[:, ok]
    assert ok.sum() > 10 and np.allclose((r - r.mean(0)).T @ (c - c.mean(0)), 0, atol=1e-6)  # no training covariance left
    assert A.loso_cv(df, features=feats, residualize=spec)["n_images"] == len(df)


# ---------------------------------------------------------------- reason wording (T4): text only

WORDING = A.REASON_WORDING_PATH  # the committed config/reason_wording.yaml (tests run from the repo root)
TEXT_KEYS = {"text", "basis", "caveat"}


def _numbers_only(pred: pd.DataFrame) -> list[dict]:
    """Every field of predict()'s rows except the wording layer's: reasons[].text/basis/caveat and row caveat."""
    rows = []
    for r in pred.drop(columns=["caveat"], errors="ignore").to_dict(orient="records"):
        r["reasons"] = [{k: v for k, v in x.items() if k not in TEXT_KEYS} for x in r["reasons"]]
        rows.append(r)
    return json.loads(json.dumps(rows, default=A._json_default))


@pytest.mark.parametrize("which", ["material", "staged"])
def test_wording_changes_text_only(table, deep_table, which, tmp_path):
    df = table if which == "material" else deep_table.assign(dark_graphite_share=np.linspace(0, 0.3, len(deep_table)))
    model = A.fit_model(df, "Batch_3") if which == "material" else A.fit_model(df, "Batch_3", staged=(F.MATERIAL_FAMILIES, ("deep",)))
    plain, worded = A.predict(model, df, wording_path=tmp_path / "absent.yaml"), A.predict(model, df, wording_path=WORDING)
    assert _numbers_only(plain) == _numbers_only(worded)          # probabilities, calls, tiers, sets, distances, reason order, z, contributions
    cfg = A.load_wording(WORDING)
    assert (worded["caveat"] == cfg["call_caveat"]).all()
    assert all(r["basis"] in ("imaging", "material") for rs in worded["reasons"] for r in rs)


def test_without_wording_file_there_are_no_new_keys(table, tmp_path):
    pred = A.predict(A.fit_model(table, "Batch_3"), table, wording_path=tmp_path / "absent.yaml")
    assert "caveat" not in pred.columns
    assert not any(TEXT_KEYS - {"text"} & set(r) for rs in pred["reasons"] for r in rs)


def test_deep_pc03_reason_gets_the_dark_graphite_text():
    cfg = A.load_wording(WORDING)
    reason = {"feature": "deep_pc03", "z": 1.2, "contribution": 0.1, "stage": "variation", "label": "DINOv2 image pattern 03", "text": "old", "related": []}
    shows, none, unmeasured = (A.apply_wording([reason], cfg, s)[0] for s in (0.25, 0.068, None))
    assert shows["text"] == "InLens image shows dark-graphite zones (share 0.25); an electrical imaging contrast, not a composition difference"
    assert none["text"].startswith("InLens image does not show dark-graphite zones (share 0.07)")
    assert "dark-graphite share not measured" in unmeasured["text"]
    assert shows["basis"] == "imaging" and shows["caveat"]
    assert {k: v for k, v in shows.items() if k not in TEXT_KEYS} == {k: v for k, v in reason.items() if k != "text"}
    assert A.apply_wording([reason | {"feature": "deep_pc01"}], cfg, 0.25)[0] == reason | {"feature": "deep_pc01", "basis": "material"}


def test_fine_texture_and_inlens_reasons_get_their_caveats():
    cfg = A.load_wording(WORDING)
    words = lambda f: A.apply_wording([{"feature": f, "z": 1.0, "contribution": 0.1, "stage": "baseline", "text": "t"}], cfg)[0]
    lbp = words("tex_bse_lbp3")
    assert lbp["basis"] == "imaging" and lbp["text"] == "t"
    assert lbp["caveat"] == "fine texture at the detector-noise scale (0.05 µm); changes with image noise"
    assert words("tex_bse_glcm_contrast_d1")["caveat"] == lbp["caveat"]
    assert words("tex_bse_glcm_contrast_d4")["basis"] == "material" and "caveat" not in words("tex_bse_glcm_contrast_d4")
    assert words("tex_bse_lbp3_r3")["basis"] == "material"            # a radius suffix is not the 2-pixel scale
    assert words("par_inlens_ratio_p50")["caveat"] == "InLens brightness; sensitive to electrical contrast and imaging"
    both = words("tex_inlens_glcm_energy_d1")["caveat"]
    assert "detector-noise" in both and "InLens brightness" in both
    assert words("kpi_si_d50_um") == {"feature": "kpi_si_d50_um", "z": 1.0, "contribution": 0.1, "stage": "baseline", "text": "t", "basis": "material"}


def test_predict_words_deep_pc_reasons_from_the_dark_share_column(deep_table):
    model = A.fit_model(deep_table, "Batch_3", ("deep",))
    with_share = A.predict(model, deep_table.assign(dark_graphite_share=0.2), wording_path=WORDING)
    without = A.predict(model, deep_table, wording_path=WORDING)
    pcs = [(a, b) for ra, rb in zip(with_share["reasons"], without["reasons"]) for a, b in zip(ra, rb) if a["feature"] in ("deep_pc03", "deep_pc04")]
    assert pcs, "the synthetic deep model should give a deep_pc03/04 reason somewhere"
    for a, b in pcs:
        assert a["text"].startswith("InLens image shows dark-graphite zones (share 0.20)") and a["basis"] == "imaging"
        assert "dark-graphite share not measured" in b["text"]


RESULTS = Path("results/Hackathon-Polaron-test.json")
REWORDED = Path("results/Hackathon-Polaron-test.reworded.json")
NUMBER_KEYS = ("predicted", "confidence", "confidence_raw", "confidence_tier", "confidence_record", "stage_baseline", "stage_variation", "prediction_set",
               "baseline_distance", "baseline_threshold", "outside_baseline", "n_deviating", "deviations", "predicted_distance", "predicted_threshold", "unfamiliar")


@pytest.mark.skipif(not REWORDED.exists(), reason="no reworded results")
def test_reworded_results_match_the_committed_numbers():
    old, new = json.loads(RESULTS.read_text()), json.loads(REWORDED.read_text())
    assert old["model"] == new["model"] and old["summary"] == new["summary"]
    assert [i["image_id"] for i in old["images"]] == [i["image_id"] for i in new["images"]]
    for a, b in zip(old["images"], new["images"]):
        for k in [k for k in a if k.startswith("p_")] + list(NUMBER_KEYS):
            assert a[k] == b[k], (a["image_id"], k)
        strip = lambda rs: [{k: v for k, v in r.items() if k not in TEXT_KEYS} for r in rs]
        assert strip(a["reasons"]) == strip(b["reasons"])
        assert set(b) - set(a) == {"caveat"}


@pytest.mark.skipif(not (Path("out/features.csv").exists() and A.ATTRIBUTION_MODEL_PATH.exists()), reason="needs out/features.csv and the frozen model")
def test_frozen_model_on_known_table_changes_text_only(tmp_path):
    model, df = A.load_model(), pd.read_csv("out/features.csv")
    plain = A.predict(model, df, wording_path=tmp_path / "absent.yaml")
    worded = A.predict(model, df.assign(dark_graphite_share=0.05), wording_path=WORDING)
    assert _numbers_only(plain) == _numbers_only(worded)
