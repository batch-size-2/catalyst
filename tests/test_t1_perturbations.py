"""T1 perturbation functions (scripts/experiments/T1_invariance_audit.py): they must keep
dtype and shape, and each must touch only what the ticket's table says."""

import importlib.util
from pathlib import Path

import numpy as np
import pytest

from qc.measure import black_level, segment, valid_rows
from qc.schema import Field, Phase

from test_ml import PX, synth_field

_SPEC = importlib.util.spec_from_file_location(
    "t1_invariance_audit", Path(__file__).resolve().parent.parent / "scripts" / "experiments" / "T1_invariance_audit.py"
)
t1 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(t1)


@pytest.fixture(scope="module")
def field() -> Field:
    channels, _, _ = synth_field(seed=11, shape=(480, 960), n_si=12)
    return Field("Batch_1", "t1_synth", "2080_1016000", channels, PX)


def test_every_perturbation_keeps_dtype_and_shape(field):
    for name, fn in t1.PERTURBATIONS.items():
        out = fn(field, t1.rng_for(field.image_id, name))
        assert set(out) == set(field.channels), name
        for k, img in out.items():
            assert img.dtype == np.uint8 and img.shape == field.channels[k].shape, (name, k)


def test_hflip_twice_is_identity(field):
    once = t1.hflip(field, t1.rng_for(field.image_id, "hflip"))
    twice = t1.hflip(Field(field.batch, field.image_id, field.strip_id, once, field.px_um), None)
    assert all(np.array_equal(twice[k], field.channels[k]) for k in field.channels)


def test_gain120_leaves_black_level_pixels_unchanged(field):
    out = t1.gain120(field, t1.rng_for(field.image_id, "gain120"))
    for k, img in field.channels.items():
        at_black = img == black_level(img)
        assert at_black.any(), k
        assert (out[k][at_black] == img[at_black]).all(), k


def test_dg_add_only_darkens_inlens_graphite_in_top_40pc(field):
    out = t1.dg_add(field, t1.rng_for(field.image_id, "dg_add"))
    for k in ("BSE", "ETD"):
        assert np.array_equal(out[k], field.channels[k]), k
    mask = segment(field.channels, field.px_um)
    rows = valid_rows(mask.shape[0])
    top_end = rows.start + round(0.40 * (rows.stop - rows.start))
    changed = out["InLens"] != field.channels["InLens"]
    allowed = (mask == Phase.GRAPHITE)
    allowed[:rows.start] = allowed[top_end:] = False
    assert changed.any(), "the synthetic field has graphite in its top rows"
    assert not (changed & ~allowed).any()
    img = field.channels["InLens"].astype(float)
    b = black_level(field.channels["InLens"])
    assert (out["InLens"][changed].astype(float) - b <= 0.30 * (img[changed] - b) + 0.51).all()


def test_dg_remove_only_brightens_dark_inlens_graphite(field):
    out = t1.dg_remove(field, t1.rng_for(field.image_id, "dg_remove"))
    for k in ("BSE", "ETD"):
        assert np.array_equal(out[k], field.channels[k]), k
    mask = segment(field.channels, field.px_um)
    rows = valid_rows(mask.shape[0])
    allowed = (mask == Phase.GRAPHITE)
    allowed[:rows.start] = allowed[rows.stop:] = False
    changed = out["InLens"] != field.channels["InLens"]
    assert not (changed & ~allowed).any()
    img = field.channels["InLens"].astype(float)
    b = black_level(field.channels["InLens"])
    assert (img[changed] - b < 55).all()
    expected = np.clip(b + (img[changed] - b) / 0.30, 0, 255)
    assert np.isclose(out["InLens"][changed].astype(float), expected, atol=0.51).all()


def test_rng_seeding_is_deterministic_and_per_key(field):
    a = t1.noise5(field, t1.rng_for(field.image_id, "noise5"))
    b = t1.noise5(field, t1.rng_for(field.image_id, "noise5"))
    assert all(np.array_equal(a[k], b[k]) for k in a)
    c = t1.noise5(field, t1.rng_for("other_image", "noise5"))
    assert not np.array_equal(a["BSE"], c["BSE"])
