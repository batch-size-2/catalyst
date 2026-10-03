"""Decision statistics: t-intervals, family-wise permutation p, statuses, verdict (PLAN_v4 §3.5)."""

import itertools
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import f as f_dist
from scipy.stats import t as t_dist

from qc.decide import contradictions, evaluate, split_tables, units_to_settle
from qc.schema import ControlResult, Controls, load_config
from tests.synth import QUANTITIES, synth_kpis

FAKE = Path(__file__).parent / "fixtures" / "kpis_fake.csv"
CFG = load_config() | {"version": "test", "data_dir": "data", "baseline": "r"}
PASSED = Controls(ran=True, passed=True)
KEY = ["si_graphite_ratio", "si_d50_um", "si_internal_void_frac", "si_contrast_ratio", "porosity_apparent"]


def one_column(batch: str, strips: dict[str, float]) -> list[dict]:
    return [{"batch": batch, "image_id": f"{batch}_{s}", "strip_id": s, "test_q": v}
            for s, v in strips.items()]


def test_hand_computed_p_exact():
    cfg = CFG | {"key_descriptors": ["test_q"], "margins": {"test_q": 5.0}}
    rows = one_column("b", {"x1": 10, "x2": 11, "x3": 12}) + one_column("r", {"y1": 0, "y2": 1, "y3": 2})
    evidence = evaluate(split_tables(pd.DataFrame(rows)), "b", cfg)
    d = next(d for d in evidence.differences if d.name == "test_q")
    assert d.p == 0.1 and d.status == "UNCLEAR" and evidence.power.limited  # mirror tie: 2/20
    rows += one_column("r", {"y4": 3})
    evidence = evaluate(split_tables(pd.DataFrame(rows)), "b", cfg)
    d = next(d for d in evidence.differences if d.name == "test_q")
    assert d.p == 1 / 35 and d.status == "DIFFERENT"


def test_interval_matches_scipy_pooled_t():
    b, r = [0.5, 0.7, 0.9, 1.1], [0.2, 0.4, 0.6]
    rows = one_column("b", {f"s{i}": v for i, v in enumerate(b)}) + \
        one_column("r", {f"t{i}": v for i, v in enumerate(r)})
    cfg = CFG | {"key_descriptors": ["test_q"], "margins": {"test_q": 1.0}}
    d = next(d for d in evaluate(split_tables(pd.DataFrame(rows)), "b", cfg).differences
             if d.name == "test_q")
    df, (n1, n2) = len(b) + len(r) - 2, (len(b), len(r))
    sp = np.sqrt((np.var(b, ddof=1) * (n1 - 1) + np.var(r, ddof=1) * (n2 - 1)) / df)
    half = t_dist.ppf(0.95, df) * sp * np.sqrt(1 / n1 + 1 / n2)
    diff = np.mean(b) - np.mean(r)
    assert d.difference == diff and d.interval == (diff - half, diff + half)


def shifted_batch(n_batch=6, n_ref=7, shift=6.0):
    layout = {"b": {f"S{i}": 1 for i in range(n_batch)}, "r": {f"T{i}": 1 for i in range(n_ref)}}
    return split_tables(synth_kpis(layout, batch_shift={"b": {"si_graphite_ratio": shift}}))


def test_shift_rejects_with_driver():
    evidence = evaluate(shifted_batch(), "b", CFG, controls=PASSED)
    assert evidence.verdict == "REJECT" and evidence.drivers[0] == "si_graphite_ratio"
    d = next(d for d in evidence.differences if d.name == "si_graphite_ratio")
    assert d.status == "DIFFERENT" and d.p < CFG["alpha"]


def test_self_split_calibration():
    baseline = pd.read_csv(FAKE).query("batch == 'fake_baseline'")
    n_different = 0
    for combo in itertools.combinations(baseline["strip_id"].unique(), 3):
        b = baseline[baseline["strip_id"].isin(combo)].assign(batch="split_b")
        r = baseline[~baseline["strip_id"].isin(combo)].assign(batch="split_r")
        evidence = evaluate(split_tables(pd.concat([b, r])), "split_b",
                            CFG | {"baseline": "split_r", "unit": "strip"})  # strip-level calibration; images within a strip are correlated
        n_different += any(d.status == "DIFFERENT" for d in evidence.differences if d.used)
    assert n_different <= 0.2 * 35  # sanity bound against treating images as independent


def test_accept_is_reachable():
    layout = {"b": {f"B{i}": 1 for i in range(10)}, "r": {f"R{i}": 1 for i in range(10)}}
    cfg = CFG | {"margins": {q: 3 * QUANTITIES[q][1] for q in KEY}, "odd_sd": None}
    evidence = evaluate(split_tables(synth_kpis(layout)), "b", cfg, controls=PASSED)
    assert evidence.verdict == "ACCEPT"
    assert all(d.status == "SIMILAR" for d in evidence.differences if d.used)


def test_power_limit_investigates():
    layout = {"b": {"X1": 1, "X2": 1}, "r": {"Y1": 1, "Y2": 1, "Y3": 1}}
    tables = split_tables(synth_kpis(layout, batch_shift={"b": {"si_d90_um": 10.0}}))  # non-key
    evidence = evaluate(tables, "b", CFG, controls=PASSED)
    assert evidence.verdict == "INVESTIGATE" and evidence.power.limited
    assert any("Too few images" in reason for reason in evidence.reasons)
    assert "more images" in evidence.next_action
    strips = evaluate(tables, "b", CFG | {"unit": "strip"}, controls=PASSED)
    assert any("Too few strips" in reason for reason in strips.reasons)
    assert "more strips" in strips.next_action


def test_odd_units_flagged_and_toggleable():
    tables = split_tables(pd.read_csv(FAKE))
    evidence = evaluate(tables, "fake_odd", CFG | {"baseline": "fake_baseline"})
    odd_images = [o for o in evidence.odd_images if o.strip_id == "D1" and o.quantity == "si_graphite_ratio"]
    assert {o.image_ids[0] for o in odd_images} == {"fake_odd_D1_0", "fake_odd_D1_1"}
    assert any(reason.startswith("Image fake_odd_D1_") for reason in evidence.reasons)
    assert any(o.strip_id == "D1" and o.quantity == "si_graphite_ratio" for o in evidence.odd_strips)
    assert not any(reason.startswith("Strip ") for reason in evidence.reasons)
    strips = evaluate(tables, "fake_odd", CFG | {"baseline": "fake_baseline", "unit": "strip"})
    assert any("Strip D1" in reason for reason in strips.reasons)
    off = evaluate(tables, "fake_odd", CFG | {"baseline": "fake_baseline", "odd_sd": None})
    assert off.odd_images == [] and off.odd_strips == []


def test_contradictions():
    driving, other = {"q": "SIMILAR"}, {"q": "UNCLEAR"}
    assert contradictions(driving, other) == []
    driving, other = {"q": "DIFFERENT"}, {"q": "SIMILAR"}
    assert contradictions(driving, other) == ["q"]
    driving, other = {"q": "SIMILAR"}, {"q": "DIFFERENT"}
    assert contradictions(driving, other) == ["q"]


def test_both_units():
    tables = split_tables(pd.read_csv(FAKE))
    evidences = {}
    for unit in ("image", "strip"):
        evidence = evaluate(tables, "fake_ok",
                            CFG | {"baseline": "fake_baseline", "unit": unit})
        evidences[unit] = evidence
        assert evidence.unit == unit
        assert evidence.other_unit.unit == ("strip" if unit == "image" else "image")
        used = {d.name for d in evidence.differences if d.used}
        assert set(evidence.other_unit.statuses) == used
    assert evidences["image"].power.n_segments == (7, 17)
    assert evidences["image"].other_unit.power.n_segments == (6, 7)
    assert evidences["strip"].power.n_segments == (6, 7)
    assert evidences["strip"].other_unit.power.n_segments == (7, 17)
    assert {d.name: d.margin for d in evidences["image"].differences} == {
        d.name: d.margin for d in evidences["strip"].differences}


def test_unit_contradiction_investigates():
    cfg = CFG | {"key_descriptors": ["test_q"], "margins": {"test_q": 1.0}, "odd_sd": None}
    rows = [
        {"batch": "b", "strip_id": "X", "image_id": f"b_X_{i}", "test_q": 2.0}
        for i in range(12)
    ]
    rows += [
        {"batch": "b", "strip_id": f"Y{i}", "image_id": f"b_Y{i}", "test_q": 0.05 if i % 2 == 0 else -0.05}
        for i in range(10)
    ]
    rows += [
        {"batch": "r", "strip_id": f"R{i}", "image_id": f"r_R{i}", "test_q": 0.05 if i % 2 == 0 else -0.05}
        for i in range(10)
    ]
    tables = split_tables(pd.DataFrame(rows))
    image = evaluate(tables, "b", cfg | {"baseline": "r", "unit": "image"}, controls=PASSED)
    image_status = next(d.status for d in image.differences if d.name == "test_q")
    assert image_status == "DIFFERENT"
    assert image.other_unit.statuses["test_q"] == "SIMILAR"
    assert image.other_unit.contradictions == ["test_q"]
    assert image.verdict == "INVESTIGATE"
    assert any("per image but SIMILAR per strip" in reason for reason in image.reasons)
    strip = evaluate(tables, "b", cfg | {"baseline": "r", "unit": "strip"}, controls=PASSED)
    assert strip.verdict == "INVESTIGATE"
    assert next(d.status for d in strip.differences if d.name == "test_q") == "SIMILAR"


def test_failed_controls_cap_the_verdict():
    tables = shifted_batch()
    failed = Controls(ran=True, passed=False, results=[
        ControlResult(name="neg_brightness", kind="negative", expected_driver=None,
                      statuses={"si_graphite_ratio": "DIFFERENT"}, top_driver=None, passed=False)])
    evidence = evaluate(tables, "b", CFG, controls=failed)
    assert evidence.verdict == "INVESTIGATE"
    assert evidence.reasons[0].startswith("Controls failed")
    assert any("differs from the reference" in reason for reason in evidence.reasons)
    assert evaluate(tables, "b", CFG, controls=None).verdict == "REJECT"


def test_determinism_and_random_branch():
    tables = shifted_batch()
    one, two = evaluate(tables, "b", CFG), evaluate(tables, "b", CFG)
    assert one.model_dump() == two.model_dump()
    small = evaluate(tables, "b", CFG | {"n_resamples": 100})
    for d in small.differences:
        if d.p is not None:
            assert d.p >= 1 / 101
    assert small.model_dump() == evaluate(tables, "b", CFG | {"n_resamples": 100}).model_dump()


def test_units_to_settle_hand_checked():
    assert units_to_settle(0.0, 1.0, 3, 7, 1.0, 0.9) == 3
    assert units_to_settle(1.0, 1.0, 3, 7, 1.0, 0.9) is None


def test_variance_ratio_matches_scipy_f_and_stays_out_of_the_verdict():
    b, r = [0.1, 0.5, 0.9, 1.3, 0.2], [0.4, 0.5, 0.6, 0.45, 0.55, 0.5]
    rows = one_column("b", {f"s{i}": v for i, v in enumerate(b)}) + \
        one_column("r", {f"t{i}": v for i, v in enumerate(r)})
    cfg = CFG | {"key_descriptors": ["test_q"], "margins": {"test_q": 1.0}}
    evidence = evaluate(split_tables(pd.DataFrame(rows)), "b", cfg)
    d = next(d for d in evidence.differences if d.name == "test_q")
    ratio = np.std(b, ddof=1) / np.std(r, ddof=1)
    lo, hi = (ratio / np.sqrt(f_dist.ppf(q, len(b) - 1, len(r) - 1)) for q in (0.95, 0.05))
    assert np.isclose(d.variance_ratio, ratio) and np.allclose(d.variance_ratio_interval, (lo, hi))
    assert lo < ratio < hi
    # one image per strip here, so the strip view gives the same ratio
    other = evidence.other_unit.variance_ratios["test_q"]
    assert np.isclose(other.ratio, ratio) and other.n == (len(b), len(r))
    # only key quantities and si_area_frac get it
    assert set(evidence.other_unit.variance_ratios) == {"test_q", "si_area_frac"}
    assert evidence.other_unit.variance_ratios["si_area_frac"].ratio is None  # not measured here

    # a batch with the reference's mean and 3x its spread: the ratio sees it, the verdict path does not
    spread = [{"batch": "b", "image_id": f"b{i}", "strip_id": f"s{i}", "test_q": 0.5 + 3 * (v - 0.5)}
               for i, v in enumerate(r)]
    rows = spread + one_column("r", {f"t{i}": v for i, v in enumerate(r)})
    evidence = evaluate(split_tables(pd.DataFrame(rows)), "b", cfg)
    d = next(d for d in evidence.differences if d.name == "test_q")
    assert np.isclose(d.variance_ratio, 3.0) and d.status != "DIFFERENT"
    assert not any("SD" in reason or "variance" in reason for reason in evidence.reasons)


def test_variance_ratio_needs_two_values_and_baseline_spread():
    rows = one_column("b", {"s0": 1.0}) + one_column("r", {"t0": 0.0, "t1": 1.0, "t2": 2.0})
    cfg = CFG | {"key_descriptors": ["test_q"], "margins": {"test_q": 1.0}}
    d = next(d for d in evaluate(split_tables(pd.DataFrame(rows)), "b", cfg).differences if d.name == "test_q")
    assert d.variance_ratio is None and d.variance_ratio_interval is None
    rows = one_column("b", {"s0": 1.0, "s1": 2.0}) + one_column("r", {"t0": 1.0, "t1": 1.0})
    d = next(d for d in evaluate(split_tables(pd.DataFrame(rows)), "b", cfg).differences if d.name == "test_q")
    assert d.variance_ratio is None


def test_silicon_content_is_area_and_solid_share():
    rows = [
        {"batch": "r", "image_id": "r0", "strip_id": "a", "si_area_frac": 0.06, "porosity_apparent": 0.10},
        {"batch": "r", "image_id": "r1", "strip_id": "b", "si_area_frac": 0.08, "porosity_apparent": 0.20},
        {"batch": "b", "image_id": "b0", "strip_id": "c", "si_area_frac": 0.09, "porosity_apparent": 0.10},
        {"batch": "b", "image_id": "b1", "strip_id": "c", "si_area_frac": 0.12, "porosity_apparent": 0.20},
    ]
    content = evaluate(split_tables(pd.DataFrame(rows)), "b", CFG).silicon_content
    area, solid = content.batch
    assert (area.name, solid.name) == ("si_area_frac", "si_solid_frac") and solid.unit == "fraction"
    assert np.isclose(area.value, 0.105) and np.isclose(solid.value, (0.09 / 0.9 + 0.12 / 0.8) / 2)
    assert area.interval[0] < area.value < area.interval[1]
    assert np.isclose(content.baseline[1].value, (0.06 / 0.9 + 0.08 / 0.8) / 2)
    assert set(solid.by_strip) == {"c"}
