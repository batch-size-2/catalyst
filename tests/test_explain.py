import json
from pathlib import Path
from types import SimpleNamespace

import yaml

from qc.decide import evaluate, read_tables, split_tables
from qc.explain import causes, explain, fmt_range, imaging_words, label, load_dictionary, top_quantities
from qc.schema import Controls, Evidence, load_config
from tests.synth import QUANTITIES, synth_kpis

FIXTURES = Path(__file__).parent / "fixtures"
FAKE = FIXTURES / "kpis_fake.csv"
CFG = load_config() | {"version": "test", "data_dir": "data", "baseline": "fake_baseline"}
DICT = {
    "si_graphite_ratio": {
        "name": "silicon to graphite ratio",
        "if_higher": "more silicon in the recipe.",
        "supplier_check": "the recipe sheet",
        "why_it_matters": "Capacity and swelling.",
    },
    "particle_types": {"T1": {"name": "bright dense"}},
}


def texts(evidence, dictionary):
    x = explain(evidence, dictionary)
    return [x.summary, *x.next_steps, *x.operator, *x.engineer, *x.scientist, *x.manager]


def test_fake_shift_explanations_and_capacity():
    evidence = evaluate(read_tables(FAKE), "fake_shift", CFG)
    explanations = explain(evidence, DICT)
    difference = next(d for d in evidence.differences if d.name == "si_graphite_ratio")
    assert evidence.verdict == "REJECT"
    assert explanations.operator == ["The batch differs from the baseline.", "Hold it and call the process engineer."]
    assert explanations.summary == "Fake shift differs from the baseline on silicon to graphite ratio."
    assert (f"Silicon to graphite ratio is {difference.batch:.3g} against "
            f"{difference.reference:.3g} in the baseline: it differs from the baseline."
            in explanations.engineer)
    assert "Possible causes to check: more silicon in the recipe." in explanations.engineer
    assert "At the supplier: The recipe sheet." in explanations.engineer
    assert "Main driver: silicon to graphite ratio." in explanations.manager
    assert explanations.rules[0].startswith("Differs beyond the tolerance on silicon to graphite ratio")
    assert explanations.next_steps[-1] == "At the supplier, for silicon to graphite ratio: the recipe sheet."

    s_batch = difference.batch / (1 + difference.batch)
    s_reference = difference.reference / (1 + difference.reference)
    capacity = lambda s, silicon: s * silicon + (1 - s) * 372
    changes = [capacity(s_batch, silicon) / capacity(s_reference, silicon) - 1
               for silicon in (1500, 3600)]
    expected = f"{min(changes):+.0%} to {max(changes):+.0%}"
    assert any(expected in s for s in explanations.manager)
    assert "Capacity and swelling." in explanations.manager
    assert all("defect" not in text.lower() for text in texts(evidence, DICT))


def test_missing_dictionary_fields_are_omitted():
    evidence = evaluate(read_tables(FAKE), "fake_shift", CFG)
    explanations = explain(evidence, {})
    assert any("si_graphite_ratio" in s.lower() for s in explanations.engineer)
    assert all("Possible causes" not in text and "At the supplier" not in text
               for text in texts(evidence, {}))


def test_accept_explanations():
    layout = {"b": {f"B{i}": 1 for i in range(10)}, "r": {f"R{i}": 1 for i in range(10)}}
    margins = {q: 3 * QUANTITIES[q][1] for q in
               ("si_graphite_ratio", "si_d50_um", "si_internal_void_frac", "si_contrast_ratio",
                "porosity_apparent")}
    evidence = evaluate(split_tables(synth_kpis(layout)), "b",
                        CFG | {"baseline": "r", "margins": margins, "odd_sd": None},
                        controls=Controls(ran=True, passed=True))
    explanations = explain(evidence, {})
    assert explanations.operator == ["The batch matches the baseline.", "Release it."]
    assert explanations.summary == "B matches the baseline on every key property."
    assert explanations.rules == []
    assert "Every key quantity is within the agreed margin." in explanations.manager
    assert not any("Indicative" in s for s in explanations.manager)


def test_odd_tiles_are_named_once_without_codes():
    evidence = Evidence.model_validate(json.loads((FIXTURES / "evidence_example.json").read_text()))
    dictionary = {"si_graphite_ratio": {"name": "silicon-to-graphite ratio"}, "si_d50_um": {"name": "median size"}}
    x = explain(evidence, dictionary)
    steps = " ".join(x.next_steps)
    assert steps.count("exb02") == 1 and steps.count("exb03") == 1
    assert x.summary.startswith("Example batch has a higher silicon-to-graphite ratio and median size")
    assert "si_graphite_ratio" not in " ".join([x.summary, *x.next_steps, *x.engineer])
    assert "2 of 9 tiles outside the baseline range" in x.rules  # tiles, not odd entries


def test_ranges_clip_at_zero_and_imaging_in_words():
    assert fmt_range(-0.00185, 0.007, "fraction") == "0% to 0.7%"
    assert fmt_range(0.0331, 0.117, "ratio") == "0.0331 to 0.117"
    metrics = ["BSE.noise", "BSE.p50", "ETD.noise", "ETD.sharpness", "InLens.p99", "InLens.noise", "ETD.p1"]
    assert imaging_words(metrics) == "noise and brightness differ on all three detectors, sharpness on ETD"
    assert imaging_words(["BSE.noise"]) == "noise differs on BSE"


def test_complementary_type_shares_count_once():
    evidence = Evidence.model_validate(json.loads((FIXTURES / "evidence_example.json").read_text()))
    shares = [d.model_copy(update={"name": f"type_share:T{i}", "status": "UNCLEAR", "difference": 0.1 * (-1) ** i})
              for i, d in enumerate(evidence.differences[:2], start=1)]
    evidence = evidence.model_copy(update={"differences": shares, "drivers": ["type_share:T2", "type_share:T1"]})
    assert [d.name for d in top_quantities(evidence)] == ["type_share:T2"]


def test_particle_type_labels_and_causes():
    assert label("type_share:T1", DICT) == "bright dense"
    assert label("type_share:T2", DICT) == "share of T2 particles"
    difference = SimpleNamespace(name="test_q", difference=1.0)
    assert causes(difference, {"test_q": {"if_higher": "higher value"}}) == \
        "Possible causes to check: higher value."
    assert causes(difference, {"test_q": {"if_higher": "Possible causes to check: higher value."}}) == \
        "Possible causes to check: higher value."


def test_load_dictionary(tmp_path):
    missing = tmp_path / "missing.yaml"
    assert load_dictionary(missing, missing) == {}
    path = tmp_path / "dictionary.yaml"
    path.write_text(yaml.safe_dump(DICT))
    assert load_dictionary(path, missing) == DICT
    types = tmp_path / "types.json"
    types.write_text(json.dumps({"types": [{"id": "T1", "name": "x"}, {"id": "T2", "name": "mid, grey"}]}))
    merged = load_dictionary(path, types)["particle_types"]
    assert merged["T1"]["name"] == "bright dense"  # the dictionary's own entry wins
    assert merged["T2"] == {"name": "share of T2 particles", "unit": "fraction", "meaning": "mid, grey"}
