from pathlib import Path
from types import SimpleNamespace

import yaml

from qc.decide import evaluate, read_tables, split_tables
from qc.explain import causes, explain, label, load_dictionary
from qc.schema import Controls, load_config
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
    explanations = explain(evidence, dictionary)
    return [explanations.operator, explanations.engineer, explanations.scientist, explanations.manager]


def test_fake_shift_explanations_and_capacity():
    evidence = evaluate(read_tables(FAKE), "fake_shift", CFG)
    explanations = explain(evidence, DICT)
    difference = next(d for d in evidence.differences if d.name == "si_graphite_ratio")
    assert evidence.verdict == "REJECT"
    assert explanations.operator.startswith("REJECT.") and "Hold it" in explanations.operator
    assert (f"silicon to graphite ratio is {difference.batch:.3g} against "
            f"{difference.reference:.3g} in the reference: it differs from the reference."
            in explanations.engineer)
    assert "Possible causes to check: more silicon in the recipe." in explanations.engineer
    assert "At the supplier: the recipe sheet." in explanations.engineer
    assert "Main driver: silicon to graphite ratio." in explanations.manager

    s_batch = difference.batch / (1 + difference.batch)
    s_reference = difference.reference / (1 + difference.reference)
    capacity = lambda s, silicon: s * silicon + (1 - s) * 372
    changes = [capacity(s_batch, silicon) / capacity(s_reference, silicon) - 1
               for silicon in (1500, 3600)]
    expected = f"{min(changes):+.0%} to {max(changes):+.0%}"
    assert expected in explanations.manager
    assert "Capacity and swelling." in explanations.manager
    assert all("defect" not in text.lower() for text in texts(evidence, DICT))


def test_missing_dictionary_fields_are_omitted():
    evidence = evaluate(read_tables(FAKE), "fake_shift", CFG)
    explanations = explain(evidence, {})
    assert "si_graphite_ratio" in explanations.engineer
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
    assert explanations.operator == "ACCEPT. The batch matches the reference. Release it."
    assert "Every key quantity is within the agreed margin." in explanations.manager
    assert "Indicative" not in explanations.manager


def test_particle_type_labels_and_causes():
    assert label("type_share:T1", DICT) == "bright dense"
    assert label("type_share:T2", DICT) == "share of particle type T2"
    difference = SimpleNamespace(name="test_q", difference=1.0)
    assert causes(difference, {"test_q": {"if_higher": "higher value"}}) == \
        "Possible causes to check: higher value."
    assert causes(difference, {"test_q": {"if_higher": "Possible causes to check: higher value."}}) == \
        "Possible causes to check: higher value."


def test_load_dictionary(tmp_path):
    missing = tmp_path / "missing.yaml"
    assert load_dictionary(missing) == {}
    path = tmp_path / "dictionary.yaml"
    path.write_text(yaml.safe_dump(DICT))
    assert load_dictionary(path) == DICT
