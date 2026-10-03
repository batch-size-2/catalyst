"""Decision statistics: t-intervals, family-wise permutation p, statuses, verdict (PLAN_v3 §3.5)."""

import itertools
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import t as t_dist

from qc.decide import contradictions, evaluate, split_tables, strips_to_settle
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
                            CFG | {"baseline": "split_r"})
        n_different += any(d.status == "DIFFERENT" for d in evidence.differences if d.used)
    assert n_different <= 0.2 * 35  # sanity bound against treating images as independent


def test_accept_is_reachable():
    layout = {"b": {f"B{i}": 1 for i in range(10)}, "r": {f"R{i}": 1 for i in range(10)}}
    cfg = CFG | {"margins": {q: 3 * QUANTITIES[q][1] for q in KEY}, "odd_strip_sd": None}
    evidence = evaluate(split_tables(synth_kpis(layout)), "b", cfg, controls=PASSED)
    assert evidence.verdict == "ACCEPT"
    assert all(d.status == "SIMILAR" for d in evidence.differences if d.used)


def test_power_limit_investigates():
    layout = {"b": {"X1": 1, "X2": 1}, "r": {"Y1": 1, "Y2": 1, "Y3": 1}}
    tables = split_tables(synth_kpis(layout, batch_shift={"b": {"si_d90_um": 10.0}}))  # non-key
    evidence = evaluate(tables, "b", CFG, controls=PASSED)
    assert evidence.verdict == "INVESTIGATE" and evidence.power.limited
    assert any("Too few strips" in reason for reason in evidence.reasons)
    assert "more strips" in evidence.next_action


def test_odd_strip_flagged_and_toggleable():
    tables = split_tables(pd.read_csv(FAKE))
    evidence = evaluate(tables, "fake_odd", CFG | {"baseline": "fake_baseline"})
    assert any(o.strip_id == "D1" and o.quantity == "si_graphite_ratio" for o in evidence.odd_strips)
    assert any("D1" in reason for reason in evidence.reasons)
    off = evaluate(tables, "fake_odd", CFG | {"baseline": "fake_baseline", "odd_strip_sd": None})
    assert off.odd_strips == []


def test_contradictions_modes():
    driving, other = {"q": "SIMILAR"}, {"q": "UNCLEAR"}
    assert contradictions(driving, other, "contradiction") == []
    assert contradictions(driving, other, "any_status") == ["q"]
    driving, other = {"q": "DIFFERENT"}, {"q": "SIMILAR"}
    assert contradictions(driving, other, "contradiction") == ["q"]
    assert contradictions(driving, other, "any_status") == ["q"]


def test_both_shared_strip_variants():
    tables = split_tables(pd.read_csv(FAKE))
    for setting in ("exclude", "include"):
        evidence = evaluate(tables, "fake_ok",
                            CFG | {"baseline": "fake_baseline", "shared_strips": setting})
        used = {d.name for d in evidence.differences if d.used}
        assert set(evidence.shared_strips.other_status) == used


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


def test_strips_to_settle_hand_checked():
    assert strips_to_settle(0.0, 1.0, 3, 7, 1.0, 0.9) == 3
    assert strips_to_settle(1.0, 1.0, 3, 7, 1.0, 0.9) is None
