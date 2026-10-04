"""Known-answer control rules and the saved controls file. No images."""

import json

from qc.control_check import decision_hash, judge_control, load_controls, reference_for, write_controls
from qc.decide import compare
from qc.schema import PARTICLE_COLUMNS, Control, Controls, Tables
from tests.synth import QUANTITIES, synth_kpis
from tests.test_compare import CFG, KEY, shifted_batch


def _control(name, kind, driver) -> Control:
    return Control(name, kind, driver, ["S0", "S1"], [])


def test_negative_and_positive_pass_rules():
    tables = shifted_batch()
    evidence = compare(tables["r"], tables["b"], CFG)
    positive = judge_control(_control("pos_si", "positive", "si_graphite_ratio"), evidence)
    assert positive.passed and positive.top_driver == "si_graphite_ratio"
    wrong = judge_control(_control("pos_size", "positive", "si_d50_um"), evidence)
    assert not wrong.passed and wrong.top_driver == "si_graphite_ratio"
    negative = judge_control(_control("neg_brightness_up", "negative", None), evidence)
    assert not negative.passed

    from qc.decide import split_tables

    layout = {"b": {f"B{i}": 1 for i in range(8)}, "r": {f"R{i}": 1 for i in range(8)}}
    calm = split_tables(synth_kpis(layout))
    cfg = CFG | {"margins": {q: 3 * QUANTITIES[q][1] for q in KEY}, "odd_sd": None}
    similar = compare(calm["r"], calm["b"], cfg)
    assert judge_control(_control("neg_noise5", "negative", None), similar).passed
    assert not judge_control(_control("pos_voids", "positive", "si_internal_void_frac"), similar).passed


def test_reference_drops_source_strips_and_keeps_named_images():
    rows = [
        {"batch": "r", "image_id": "keep", "strip_id": "S0"},
        {"batch": "r", "image_id": "drop", "strip_id": "S0"},
        {"batch": "r", "image_id": "stay", "strip_id": "S9"},
    ]
    frame = __import__("pandas").DataFrame(rows)
    empty = __import__("pandas").DataFrame(columns=PARTICLE_COLUMNS)
    baseline = Tables(kpis=frame, particles=empty, imaging=frame.copy())
    control = Control("shared", "negative", None, ["S0"], [], ["keep"])
    ref = reference_for(baseline, control)
    assert set(ref.kpis["image_id"]) == {"keep", "stay"}
    assert set(ref.imaging["image_id"]) == {"keep", "stay"}


def test_stale_controls_file_is_ignored(tmp_path):
    path = tmp_path / "controls.json"
    cfg = CFG | {"baseline": "Batch_3"}
    saved = Controls(ran=True, passed=True)
    write_controls(cfg, saved, path)
    assert load_controls(cfg, path).passed is True

    stale = json.loads(path.read_text())
    stale["config_sha256"] = "0" * 64
    path.write_text(json.dumps(stale))
    assert load_controls(cfg, path).ran is False

    write_controls(cfg, saved, path)
    other = json.loads(path.read_text())
    other["baseline"] = "Batch_1"
    other["config_sha256"] = decision_hash(cfg | {"baseline": "Batch_1"})
    path.write_text(json.dumps(other))
    assert load_controls(cfg, path).ran is False

    path.write_text("{")
    assert load_controls(cfg, path).ran is False
    assert load_controls(cfg, tmp_path / "missing.json").ran is False
