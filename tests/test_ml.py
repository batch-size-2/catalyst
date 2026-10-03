"""Tests for the ML side on a synthetic anode: graphite ~60, pores ~5, Si discs ~120 (2 um),
some with enclosed holes; InLens Si ~150, graphite ~100 with saturated pixels."""

import numpy as np
import pandas as pd
import pytest
from scipy.ndimage import binary_erosion
from sklearn.metrics import adjusted_rand_score

from qc.controls import make_controls, shared_strip_controls
from qc.measure import (
    DARK_GRAPHITE_INLENS, black_level, dark_graphite_share, default_thresholds, imaging, kpis, particles, segment,
)
from qc.schema import KPI_UNITS, Field, Phase
from qc.types import assign_types, fit_types, load_types, save_types, type_shares
from qc.uncertainty import area_needed, integral_range, threshold_variants

PX = 0.025
SI_D_UM = 2.0


def synth_field(seed=0, shape=(480, 960), n_si=20, holes=True, edge_disc=True, saturate=True):
    """Returns (channels, truth, disc_centers): a synthetic anode field with known geometry."""
    rng = np.random.default_rng(seed)
    h, w = shape
    truth = np.full((h, w), Phase.GRAPHITE, np.uint8)
    bse = rng.normal(60, 3, (h, w))
    inl = rng.normal(100, 3, (h, w))
    etd = rng.normal(90, 6, (h, w))
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(40):  # pore blobs, dark in every channel so black level ~ 0
        cy, cx, r = rng.uniform(0, h), rng.uniform(0, w), rng.uniform(4, 12)
        blob = (yy - cy) ** 2 + (xx - cx) ** 2 < r * r
        bse[blob] = rng.normal(5, 1.5, blob.sum())
        inl[blob] = rng.normal(4, 1.5, blob.sum())
        truth[blob] = Phase.PORE
    r_si = SI_D_UM / 2 / PX  # 40 px for a 2 um diameter
    centers = [(h * 0.5, w - 8.0)] if edge_disc else []
    attempts = 0
    while len(centers) < n_si and attempts < 5000:
        attempts += 1
        c = (rng.uniform(3 * r_si, h - 3 * r_si), rng.uniform(3 * r_si, w - 3 * r_si))
        if all((c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 > (2.4 * r_si) ** 2 for p in centers):
            centers.append(c)
    for i, (cy, cx) in enumerate(centers[:n_si]):
        disc = (yy - cy) ** 2 + (xx - cx) ** 2 <= r_si * r_si
        bse[disc] = rng.normal(120, 3, disc.sum())
        inl[disc] = rng.normal(150, 3, disc.sum())
        truth[disc] = Phase.SI
        if holes and i % 3 == 0:
            hole = (yy - cy) ** 2 + (xx - cx) ** 2 <= (0.35 * r_si) ** 2
            bse[hole] = rng.normal(5, 1.5, hole.sum())
            inl[hole] = rng.normal(70, 3, hole.sum())
        if saturate:
            inl[disc & (rng.random((h, w)) < 0.2)] = 255
    noise = rng.normal(0, 4, (h, w))
    channels = {
        "BSE": np.clip(bse + noise, 0, 255).astype(np.uint8),
        "ETD": np.clip(etd + noise, 0, 255).astype(np.uint8),
        "InLens": np.clip(inl, 0, 255).astype(np.uint8),
    }
    return channels, truth, centers[:n_si]


def test_segment_shape_ignore_and_thresholds():
    channels, truth, _ = synth_field()
    odd, _, _ = synth_field(seed=3, shape=(479, 961))
    for ch, shape in ((channels, (480, 960)), (odd, (479, 961))):
        mask = segment(ch, PX)
        assert mask.shape == shape and mask.dtype == np.uint8
    mask = segment(channels, PX)
    band = round(0.05 * mask.shape[0])
    assert (mask[:band] == Phase.IGNORE).all() and (mask[-band:] == Phase.IGNORE).all()
    assert (mask[band:-band] == truth[band:-band]).mean() > 0.90
    t0, t1 = default_thresholds(channels)
    shifted = segment(channels, PX, thresholds=(t0, t1 + 20))
    assert (shifted == Phase.SI).sum() < (mask == Phase.SI).sum()


def test_segment_dim_objects_become_binder():
    """Blobs at ~1.33x graphite pass the Si threshold but are too dim to be Si -> BINDER."""
    rng = np.random.default_rng(7)
    h, w = 480, 960
    bse = rng.normal(60, 3, (h, w))
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(30):  # pore blobs keep the black level near 0
        cy, cx, r = rng.uniform(0, h), rng.uniform(0, w), rng.uniform(4, 12)
        bse[(yy - cy) ** 2 + (xx - cx) ** 2 < r * r] = 5
    si_discs = np.zeros((h, w), bool)
    for cy, cx in ((240, 240), (120, 480)):
        si_discs |= (yy - cy) ** 2 + (xx - cx) ** 2 <= 40**2
    bse[si_discs] = rng.normal(120, 3, si_discs.sum())
    dim = np.zeros((h, w), bool)
    for cy, cx in ((240, 620), (120, 800), (360, 700)):
        blob = np.zeros((h, w), bool)
        for _ in range(6):  # irregular union of small discs
            dy, dx, r = rng.uniform(-14, 14), rng.uniform(-14, 14), rng.uniform(9, 16)
            blob |= (yy - (cy + dy)) ** 2 + (xx - (cx + dx)) ** 2 <= r * r
        dim |= blob
    bse[dim] = rng.normal(80, 3, dim.sum())
    channels = {
        "BSE": np.clip(bse + rng.normal(0, 2, (h, w)), 0, 255).astype(np.uint8),
        "ETD": np.clip(bse + rng.normal(0, 6, (h, w)), 0, 255).astype(np.uint8),
        "InLens": np.clip(bse + rng.normal(20, 3, (h, w)), 0, 255).astype(np.uint8),
    }
    t0, _ = default_thresholds(channels)
    mask = segment(channels, PX, thresholds=(t0, 70))
    dim_core = binary_erosion(dim, np.ones((7, 7)))  # edge halo blurs below t1
    assert (mask[dim_core] == Phase.BINDER).mean() > 0.9
    assert (mask[si_discs] == Phase.SI).mean() > 0.9


def test_kpis_values_and_robustness():
    channels, truth, _ = synth_field()
    vals = kpis(segment(channels, PX), PX, channels)
    assert set(vals) <= set(KPI_UNITS) and all(isinstance(v, float) for v in vals.values())
    band = truth[round(0.05 * truth.shape[0]) : -round(0.05 * truth.shape[0])]
    t_ratio = (band == Phase.SI).sum() / (band == Phase.GRAPHITE).sum()
    assert abs(vals["si_graphite_ratio"] / t_ratio - 1) < 0.15
    assert abs(vals["si_d50_um"] / SI_D_UM - 1) < 0.15
    assert vals["si_internal_void_frac"] > 0.005
    no_holes, _, _ = synth_field(seed=1, holes=False)
    vals_nh = kpis(segment(no_holes, PX), PX, no_holes)
    assert vals_nh["si_internal_void_frac"] < vals["si_internal_void_frac"]
    rng = np.random.default_rng(0)
    for m in (
        rng.integers(0, 4, (64, 96)).astype(np.uint8),
        np.full((64, 96), Phase.GRAPHITE, np.uint8),
        np.full((64, 96), Phase.IGNORE, np.uint8),
    ):
        assert set(kpis(m, PX)) <= set(KPI_UNITS)


def test_particles_table():
    channels, _, centers = synth_field()
    df = particles(segment(channels, PX), PX, channels)
    assert list(df.columns) == [
        "particle_id", "d_um", "area_um2", "contrast_ratio", "inlens_ratio", "void_frac",
        "texture", "solidity", "border", "y_px", "x_px",
    ]
    assert abs(len(df) - len(centers)) <= 1
    assert df["border"].sum() >= 1
    assert abs(np.nanmedian(df["inlens_ratio"]) - 1.5) < 0.15


def test_imaging_descriptors():
    img = np.full((200, 300), 60, np.uint8)
    img[50:70, 100:140] = 255
    desc = imaging({"BSE": img})["BSE"]
    assert set(desc) == {
        "black_level", "p1", "p50", "p99", "noise", "sharpness", "saturated_frac", "curtaining_index"
    }
    assert desc["saturated_frac"] == pytest.approx((img == 255).mean())
    rng = np.random.default_rng(0)
    x = np.arange(300)[None, :]
    striped = np.clip(60 + 15 * np.sin(2 * np.pi * x * PX / 1.0) + rng.normal(0, 2, (200, 300)), 0, 255)
    clean = np.clip(60 + rng.normal(0, 2, (200, 300)), 0, 255).astype(np.uint8)
    hi = imaging({"BSE": striped.astype(np.uint8)})["BSE"]["curtaining_index"]
    lo = imaging({"BSE": clean})["BSE"]["curtaining_index"]
    assert hi > 5 * lo


def synth_particles() -> pd.DataFrame:
    """Two well-separated populations across 4 strips and 2 batches."""
    rng = np.random.default_rng(0)
    rows = []
    pops = [
        dict(d=1.5, cr=2.0, ilr=1.5, tx=0.15, so=0.90),
        dict(d=6.0, cr=1.2, ilr=0.9, tx=0.40, so=0.70),
    ]
    for i in range(320):
        pop, p = i % 2, pops[i % 2]
        d = max(0.2, rng.normal(p["d"], 0.06 * p["d"]))
        rows.append(
            {
                "batch": f"B{1 + i % 2}", "image_id": f"img{i}", "strip_id": f"S{1 + i % 4}",
                "particle_id": i, "d_um": d, "area_um2": np.pi * d * d / 4, "pop": pop,
                "contrast_ratio": rng.normal(p["cr"], 0.05), "inlens_ratio": rng.normal(p["ilr"], 0.05),
                "void_frac": abs(rng.normal(0.02, 0.01)), "texture": rng.normal(p["tx"], 0.02),
                "solidity": np.clip(rng.normal(p["so"], 0.02), 0, 1), "border": False,
                "y_px": 0.0, "x_px": 0.0,
            }
        )
    return pd.DataFrame(rows)


def test_types_fit_assign_roundtrip(tmp_path):
    df = synth_particles()
    model = fit_types(df)
    out = assign_types(df, model)
    assert adjusted_rand_score(df["pop"], out["type"]) > 0.9
    path = tmp_path / "particle_types.json"
    save_types(model, path)
    assert (assign_types(df, load_types(path))["type"] == out["type"]).all()
    far = df.iloc[:1].copy()
    far["d_um"] = 500.0
    assert assign_types(far, model)["type"].iloc[0] == "unassigned"
    porous = df.iloc[:1].copy()
    porous["void_frac"] = 0.5
    assert assign_types(porous, model | {"porous_rule": True})["type"].iloc[0] == "porous"
    shares = type_shares(out)
    assert np.allclose(shares.sum(axis=1), 1.0)


def synth_batch(n_strips=5, imgs_per=2, shape=(240, 480)):
    fields = []
    for s in range(n_strips):
        for i in range(imgs_per):
            channels, _, _ = synth_field(seed=100 * s + i, shape=shape, n_si=5)
            fields.append(
                Field(batch="ref", image_id=f"s{s}i{i}", strip_id=f"S{s}", channels=channels, px_um=PX)
            )
    return fields


def _mean_kpis(fields):
    vals = [kpis(segment(f.channels, f.px_um), f.px_um, f.channels) for f in fields]
    return {k: np.nanmean([v.get(k, np.nan) for v in vals]) for k in KPI_UNITS}


def test_controls_move_what_they_should():
    fields = synth_batch()
    controls = make_controls(fields, PX, seed=0)
    again = make_controls(fields, PX, seed=0)
    assert [c.name for c in controls] == [c.name for c in again]
    for c1, c2 in zip(controls, again):
        for f1, f2 in zip(c1.fields, c2.fields):
            assert all(np.array_equal(f1.channels[k], f2.channels[k]) for k in f1.channels)
    by_name = {c.name: c for c in controls}
    assert all(len(c.source_strips) >= 2 for c in controls)
    originals = {f.image_id: f for f in fields}
    ref = _mean_kpis(
        [originals[f.image_id.split("~")[0]] for f in by_name["neg_brightness_up"].fields]
    )
    for name, c in by_name.items():
        got = _mean_kpis(c.fields)
        if c.kind == "negative":
            assert abs(got["si_graphite_ratio"] / ref["si_graphite_ratio"] - 1) < 0.10, name
        elif name == "pos_si_plus50":
            assert got["si_graphite_ratio"] > 1.3 * ref["si_graphite_ratio"]
        elif name == "pos_si_plus100":
            assert got["si_graphite_ratio"] > 1.7 * ref["si_graphite_ratio"]
        elif name == "pos_voids":
            assert got["si_internal_void_frac"] > ref["si_internal_void_frac"] + 0.02
        elif name == "pos_si_scale150":
            assert got["si_d50_um"] > 1.3 * ref["si_d50_um"]
            assert abs(got["si_graphite_ratio"] / ref["si_graphite_ratio"] - 1) < 0.25


def test_shared_strip_controls():
    fields = synth_batch()
    controls = {c.name: c for c in shared_strip_controls(fields, PX, seed=0)}
    assert set(controls) == {"shared_unchanged", "shared_diluted", "unshared_change"}
    for name in ("shared_unchanged", "shared_diluted"):
        c = controls[name]
        test_ids = {f.image_id.split("~")[0] for f in c.fields}
        assert not (set(c.kept_in_reference) & test_ids)
    for c in controls.values():
        orig = {f.image_id: f for f in fields}
        for f in c.fields:
            assert f.strip_id == orig[f.image_id.split("~")[0]].strip_id
    assert controls["unshared_change"].kept_in_reference == []
    assert shared_strip_controls(fields, PX, seed=0)[0].source_strips == controls[
        "shared_unchanged"
    ].source_strips


def test_uncertainty_helpers():
    channels, _, _ = synth_field(seed=2)
    variants = threshold_variants(channels, PX)
    assert set(variants) == {-5, 0, 5}
    ir = integral_range(segment(channels, PX), PX, Phase.SI)
    assert np.isfinite(ir["predicted_sd"]) and np.isfinite(ir["a_int_um2"])
    small = area_needed(ir["phi"], ir["a_int_um2"], 2 * ir["predicted_sd"])
    large = area_needed(ir["phi"], ir["a_int_um2"], ir["predicted_sd"] / 2)
    assert large > small


def test_dark_graphite_share_counts_dark_inlens_graphite_in_valid_rows():
    h, w = 300, 200
    mask = np.full((h, w), Phase.PORE, np.uint8)
    mask[:, :100] = Phase.GRAPHITE
    mask[:15], mask[-15:] = Phase.IGNORE, Phase.IGNORE  # what segment() does to the top/bottom 5%
    inlens = np.full((h, w), 150, np.uint8)
    inlens[:, 100:] = 0  # pores at 0 fix the black level
    inlens[15:105, :100] = 20  # top third of the valid rows: dark graphite
    inlens[200:210, :100] = 255  # saturated graphite is left out
    assert black_level(inlens) == 0 and 20 < DARK_GRAPHITE_INLENS < 150
    out = dark_graphite_share(mask, {"InLens": inlens})
    graphite = (270 - 10) * 100
    assert out["dark_graphite_share_top"] == pytest.approx(1.0, abs=0.03)  # smoothing blurs one row at each edge
    assert out["dark_graphite_share"] == pytest.approx(90 * 100 / graphite, abs=0.01)
    assert np.isnan(dark_graphite_share(mask, {"BSE": inlens})["dark_graphite_share"])
