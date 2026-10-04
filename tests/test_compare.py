"""Decision statistics: t-intervals, family-wise permutation p, statuses, verdict (PLAN §3.5)."""

import itertools
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import t as t_dist

from qc.decide import contradictions, evaluate, odd_units, split_tables, units_to_settle
from qc.schema import ControlResult, Controls, Segment, load_config
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


def _failed() -> Controls:
    return Controls(ran=True, passed=False, results=[
        ControlResult(name="neg_brightness_up", kind="negative", expected_driver=None,
                      statuses={"si_graphite_ratio": "DIFFERENT"}, top_driver="si_graphite_ratio", passed=False),
        ControlResult(name="pos_si_scale", kind="positive", expected_driver="si_d50_um",
                      statuses={}, top_driver=None, passed=False),
    ])


def test_failed_controls_only_block_accept():
    """A failed control leaves the verdict and next action as they are with no controls at all."""
    shifted = shifted_batch()
    failed = _failed()
    none = evaluate(shifted, "b", CFG, controls=None)
    blocked = evaluate(shifted, "b", CFG, controls=failed)
    assert none.verdict == "REJECT" and blocked.verdict == "REJECT"
    assert blocked.next_action == none.next_action
    assert any(reason == "Controls failed (neg_brightness_up, pos_si_scale): ACCEPT needs passed controls."
               for reason in blocked.reasons)
    assert blocked.reasons[0] == none.reasons[0]

    layout = {"b": {f"B{i}": 1 for i in range(10)}, "r": {f"R{i}": 1 for i in range(10)}}
    calm = split_tables(synth_kpis(layout))
    cfg = CFG | {"baseline": "r", "odd_sd": None,
                 "margins": {q: 3 * QUANTITIES[q][1] for q in KEY}}
    missing = evaluate(calm, "b", cfg)
    same = evaluate(calm, "b", cfg, controls=failed)
    assert missing.verdict == "INVESTIGATE" and same.verdict == "INVESTIGATE"
    assert same.next_action == missing.next_action
    passed = evaluate(calm, "b", cfg, controls=PASSED)
    assert passed.verdict == "ACCEPT"


def test_determinism_and_random_branch():
    tables = shifted_batch()
    one, two = evaluate(tables, "b", CFG), evaluate(tables, "b", CFG)
    assert one.model_dump() == two.model_dump()
    small = evaluate(tables, "b", CFG | {"n_resamples": 100})
    for d in small.differences:
        if d.p is not None:
            assert d.p >= 1 / 101
    assert small.model_dump() == evaluate(tables, "b", CFG | {"n_resamples": 100}).model_dump()


def test_odd_range_is_clipped_for_wording_only():
    refs = [Segment(batch="r", strip_id=f"R{i}", image_ids=[f"r{i}"], area_um2=1.0,
                    values={"si_internal_void_frac": v, "si_contrast_ratio": c})
            for i, (v, c) in enumerate([(0.0, 0.2), (0.0, 1.0), (0.0, 4.0), (0.02, 5.0)])]
    batch = [Segment(batch="b", strip_id="B", image_ids=["b0"], area_um2=1.0,
                     values={"si_internal_void_frac": 0.2, "si_contrast_ratio": 20.0})]
    odds = odd_units(batch, refs, ["si_internal_void_frac", "si_contrast_ratio"], {"odd_sd": 3})
    by_q = {o.quantity: o for o in odds}
    assert by_q["si_internal_void_frac"].range[0] == 0
    assert by_q["si_internal_void_frac"].range[1] <= 1
    assert by_q["si_contrast_ratio"].range[0] == 0
    assert by_q["si_contrast_ratio"].range[1] > 1


def test_units_to_settle_hand_checked():
    assert units_to_settle(0.0, 1.0, 3, 7, 1.0, 0.9) == 3
    assert units_to_settle(1.0, 1.0, 3, 7, 1.0, 0.9) is None
