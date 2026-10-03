import json
from pathlib import Path

import pytest

import qc.guide as guide_module
from qc.explain import explain
from qc.guide import SLOT, check, guide, problem, slots, template
from qc.schema import Evidence

FIXTURES = Path(__file__).parent / "fixtures"
DICT = {"si_graphite_ratio": {"name": "silicon-to-graphite ratio", "supplier_check": "Confirm the recipe."},
        "si_d50_um": {"name": "median silicon particle size"}}


@pytest.fixture
def evidence():
    ev = Evidence.model_validate(json.loads((FIXTURES / "evidence_example.json").read_text()))
    return ev.model_copy(update={"explanations": explain(ev, DICT)})


@pytest.fixture
def in_tmp(tmp_path, monkeypatch):
    config = Path("config/decision.yaml").read_text()
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(config)


@pytest.fixture
def table(evidence):
    return slots(evidence, DICT, [], 1.5)


def test_slots_come_from_the_evidence(evidence, table):
    assert table["diff:si_graphite_ratio"]["text"] == "0.09 → 0.115"
    assert table["shift:si_graphite_ratio"]["text"] == "+1.2σ"  # 0.025 / 0.03 × 1.5 = 1.25
    assert table["tile:exb02.si_graphite_ratio"]["tile"] == "exb02"
    assert table["count:odd_tiles"]["text"] == "2"


def test_template_uses_only_known_slots(evidence, table):
    plain = template(evidence, DICT, table, [], 1.5)
    assert plain["source"] == "template" and [s["target"] for s in plain["steps"]] == ["verdict", "moved", "tiles", "next"]
    texts = [*plain["summary"], *(s for st in plain["steps"] for s in st["sentences"])]
    used = {f"{k}:{v}" for t in texts for k, v in SLOT.findall(t)}
    assert used and used <= set(plain["slots"]) and plain["checks"]["numbers"] >= len(used)
    assert all(problem(s, table, True) is None for s in plain["summary"])


def test_house_rules_drop_bad_sentences(table):
    assert problem("Ratio moved {diff:si_graphite_ratio}.", table, False) is None
    assert problem("Ratio moved by 0.025.", table, False) == "a number outside a slot"
    assert problem("Two tiles carry it.", table, False) == "a number outside a slot"
    assert problem("It moved {diff:nope}.", table, False).startswith("unknown slot")
    assert problem("A significant move.", table, False).startswith("banned word")
    assert problem("The batch is defective.", table, False).startswith("banned word")
    assert problem("Investigate this batch.", table, True).startswith("restates the verdict")
    assert problem(" ".join(["word"] * 29), table, False) == "over 28 words"

    summary, steps, dropped = check({
        "summary": ["Ratio rose {diff:si_graphite_ratio}.", "It rose by 0.025."],
        "steps": [{"target": "moved", "title": "Step 1 of 4", "sentences": ["Ratio moved most: {shift:si_graphite_ratio}."]},
                  {"target": "elsewhere", "title": "x", "sentences": ["Fine."]}],
    }, table)
    assert summary == ["Ratio rose {diff:si_graphite_ratio}."]
    assert steps[0]["title"] == "The biggest move"  # a title with a number is replaced
    assert len(dropped) == 2


def test_without_a_key_the_template_answers(evidence, monkeypatch, in_tmp):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    out = guide(evidence, "claude")
    assert out["source"] == "template" and "ANTHROPIC_API_KEY" in out["fallback_reason"]


def test_claude_output_is_checked_cached_and_falls_back(evidence, monkeypatch, in_tmp):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    calls = []
    good = {"summary": ["The ratio leans higher, {diff:si_graphite_ratio}, but it is not settled."],
            "steps": [{"target": "moved", "title": "The biggest move", "sentences": ["It moved {shift:si_graphite_ratio}."]}]}

    def fake(body):
        calls.append(body)
        assert all("says" in s for s in body["slots"]) and "images" not in body
        return good

    monkeypatch.setattr(guide_module, "call_claude", fake)
    first, second = guide(evidence), guide(evidence)
    assert first["source"] == "claude" and first == second and len(calls) == 1  # cached
    assert first["slots"]["diff:si_graphite_ratio"]["text"] == "0.09 → 0.115"
    assert first["steps"][0]["source"] == "differences · si_graphite_ratio"

    monkeypatch.setattr(guide_module, "call_claude", lambda body: {
        "summary": ["It rose 30%.", "Two tiles."], "steps": []})
    monkeypatch.setattr(guide_module, "PROMPT_VERSION", 99)  # bust the cache
    bad = guide(evidence)
    assert bad["source"] == "template" and "house rules" in bad["fallback_reason"]

    def broken(body):
        raise RuntimeError("offline")

    monkeypatch.setattr(guide_module, "call_claude", broken)
    monkeypatch.setattr(guide_module, "PROMPT_VERSION", 100)
    assert "offline" in guide(evidence)["fallback_reason"]
