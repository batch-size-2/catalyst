import json
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest
import yaml
from fastapi.testclient import TestClient

import qc.guide as guide_module
from qc.api import app
from qc.decide import evaluate, read_tables
from qc.explain import explain
from qc.guide import SLOT, call_claude, check, guide, parse_claude, problem, slots, template, whatifs
from qc.schema import Evidence, evidence_path, load_config

FIXTURES = Path(__file__).parent / "fixtures"
CFG = load_config()
DICT = {"si_graphite_ratio": {"name": "silicon-to-graphite ratio", "supplier_check": "Confirm the recipe."},
        "si_d50_um": {"name": "median silicon particle size"},
        "particle_types": {"porous_si": {"name": "share of T1 particles"}}}


def with_texts(ev: Evidence, dictionary=DICT) -> Evidence:
    return ev.model_copy(update={"explanations": explain(ev, dictionary)})


@pytest.fixture
def evidence():
    return with_texts(Evidence.model_validate(json.loads((FIXTURES / "evidence_example.json").read_text())))


@pytest.fixture
def in_tmp(tmp_path, monkeypatch):
    config = Path("config/decision.yaml").read_text()
    monkeypatch.chdir(tmp_path)
    Path("config").mkdir()
    Path("config/decision.yaml").write_text(config)


@pytest.fixture
def table(evidence):
    return slots(evidence, DICT, [], CFG)


def ok(text, table, evidence):
    return problem(text, table, evidence, DICT)


def test_slots_come_from_the_evidence(evidence, table):
    assert table["diff:si_graphite_ratio"]["text"] == "0.090 → 0.115"
    assert table["shift:si_graphite_ratio"]["text"] == "+1.3σ"  # 0.025 / 0.03 × 1.5 = 1.25, half away from zero like the UI
    assert table["tile:exb02.si_graphite_ratio"]["tile"] == "exb02"
    assert table["count:odd_tiles"]["text"] == "2"
    assert "shift:si_graphite_ratio" not in slots(evidence, DICT, [], CFG | {"margins": {"si_graphite_ratio": 0.03}})


def test_template_uses_only_known_slots_and_passes_its_own_rules(evidence, table):
    plain = template(evidence, DICT, table, [], CFG)
    assert plain["source"] == "template" and [s["target"] for s in plain["steps"]] == ["verdict", "moved", "tiles", "next"]
    texts = [*plain["summary"], *(s for st in plain["steps"][:3] for s in st["sentences"])]
    used = {f"{k}:{v}" for t in texts for k, v in SLOT.findall(t)}
    assert used and used <= set(plain["slots"])
    assert [t for t in texts if ok(t, table, evidence)] == []


def test_house_rules(evidence, table):
    assert ok("Silicon-to-graphite ratio moved {diff:si_graphite_ratio} and is not settled.", table, evidence) is None
    assert ok("Ratio moved by 0.025.", table, evidence) == "a number outside a slot"
    assert ok("Two tiles carry it.", table, evidence) == "a number outside a slot"
    assert ok("Only one tile carries it.", table, evidence) == "a number outside a slot"
    assert ok("It moved {diff:nope}.", table, evidence).startswith("unknown slot")
    assert ok("A significant move.", table, evidence).startswith("banned word")
    assert ok("The batch is defective.", table, evidence).startswith("banned word")
    assert ok(" ".join(["word"] * 29), table, evidence) == "over 28 words"


def test_names_with_digits_are_allowed(evidence, table):
    """Batch names, labels with digits and tile ids are names, not numbers (review B2)."""
    ev = evidence.model_copy(update={"batch": "Batch_1", "baseline": "Batch_3"})
    assert ok("Batch 1 leans away from Batch 3 on silicon-to-graphite ratio {shift:si_graphite_ratio}.", table, ev) is None
    assert ok("Tile exb02 stands out on the share of T1 particles.", table, ev) is None
    assert ok("Batch 1 has 12 odd tiles.", table, ev) == "a number outside a slot"


def test_no_verdict_or_wrong_status_gets_through(evidence, table):
    """Claude can't say or imply a disposition, or give a property another status (review B1)."""
    for text in ("The batch matches the baseline and is safe to ship.", "Release it; the rules are cautious.",
                 "Accept the batch and move on.", "Nothing to worry about here.", "The batch passes the checks.",
                 "The batch fails on silicon.", "There are no issues with this batch.", "It looks good overall.",
                 "Example batch is usable as delivered.", "It can go to production.",
                 "Example batch is clearly worse than the baseline.", "Release the batch."):
        assert ok(text, table, evidence) is not None, text
    assert ok("Silicon-to-graphite ratio {diff:si_graphite_ratio} is within tolerance.", table, evidence).startswith("says similar")
    assert ok("Silicon-to-graphite ratio differs.", table, evidence).startswith("says different")
    assert ok("Median silicon particle size {diff:si_d50_um} is not settled.", table, evidence) is None
    # statuses can't be swapped between two properties in one sentence, and synonyms count
    swapped = "The silicon-to-graphite ratio is within tolerance, while the median silicon particle size is not settled."
    assert ok(swapped, table, evidence).startswith("says similar")
    for phrase in ("sits inside the tolerance", "is unchanged", "is consistent with the baseline"):
        assert ok(f"Silicon-to-graphite ratio {phrase}.", table, evidence).startswith("says similar"), phrase
    assert ok("A third of the tiles carry it.", table, evidence) == "a number outside a slot"
    summary, steps, dropped = check({"summary": ["The ratio {diff:si_graphite_ratio} is not settled."],
                                     "steps": [{"target": "verdict", "title": "Fine to release", "sentences": ["The rules held it."]}]},
                                    table, evidence, DICT)
    assert steps[0]["title"] == "What decided it" and not dropped


def test_check_drops_bad_sentences_and_replaces_bad_titles(evidence, table):
    summary, steps, dropped = check({
        "summary": ["Ratio rose {diff:si_graphite_ratio}.", "It rose by 0.025."],
        "steps": [{"target": "moved", "title": "Step 1 of 4", "sentences": ["Ratio moved most: {shift:si_graphite_ratio}."]},
                  {"target": "elsewhere", "title": "x", "sentences": ["Fine."]}],
    }, table, evidence, DICT)
    assert summary == ["Ratio rose {diff:si_graphite_ratio}."]
    assert steps[0]["title"] == "The biggest move"
    assert len(dropped) == 2


def test_complementary_shares_hide_only_a_same_status_mirror(evidence):
    shares = [evidence.differences[0].model_copy(update={"name": "type_share:T1", "difference": -0.2, "status": "UNCLEAR"}),
              evidence.differences[0].model_copy(update={"name": "type_share:T2", "difference": 0.2, "status": "UNCLEAR"})]
    mirror = evidence.model_copy(update={"differences": shares, "drivers": ["type_share:T2", "type_share:T1"]})
    assert explain(mirror, {}).twin == "type_share:T1" and explain(mirror, {}).ranked == ["type_share:T2"]
    split = shares[0].model_copy(update={"status": "SIMILAR"})
    unsettled = mirror.model_copy(update={"differences": [split, shares[1]], "drivers": ["type_share:T1", "type_share:T2"]})
    x = explain(unsettled, {})
    assert x.twin is None and x.ranked == ["type_share:T2"] and "1 key property not settled" in x.rules


def test_whatif_recomputes_without_exactly_the_named_tiles(in_tmp):
    Path("out").mkdir()
    Path("out/kpis.csv").write_text((FIXTURES / "kpis_fake.csv").read_text())
    cfg = load_config() | {"version": "test", "baseline": "fake_baseline"}
    ev = with_texts(evaluate(read_tables(Path("out/kpis.csv")), "fake_odd", cfg), {})
    ifs = whatifs(ev, cfg)
    odd = [o.image_ids[0] for o in ev.odd_images if o.quantity == "si_graphite_ratio"]
    w = next(w for w in ifs if w["quantity"] == "si_graphite_ratio")
    assert odd and w["tiles"] == odd and w["n_tiles"] == ev.n_images["batch"] - len(odd)
    kept = pd.read_csv("out/kpis.csv").query("batch == 'fake_odd' and image_id not in @odd")
    assert w["batch"] == pytest.approx(kept["si_graphite_ratio"].mean())
    table = slots(ev, {}, ifs, cfg)
    tiles = " and ".join(f"{{tile:{t}.si_graphite_ratio}}" for t in odd)
    assert problem(f"Without {tiles} it averages {{whatif:{w['id']}}}.", table, ev, {}) is None
    assert problem(f"Without them it averages {{whatif:{w['id']}}}.", table, ev, {}) == "a what-if without exactly its tiles"
    plain = template(ev, {}, table, ifs, cfg)  # the fixed wording passes its own house rules, what-if included
    assert [s for s in plain["summary"] + [x for st in plain["steps"][:3] for x in st["sentences"]]
            if problem(s, table, ev, {})] == []
    assert any("{whatif:" in x for st in plain["steps"] for x in st["sentences"])
    pd.read_csv("out/kpis.csv").assign(si_graphite_ratio=lambda f: f["si_graphite_ratio"] * 2).to_csv("out/kpis.csv", index=False)
    assert whatifs(ev, cfg) == []  # the table moved on: no what-if rather than a wrong one


def test_without_a_key_the_template_answers(evidence, monkeypatch, in_tmp):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    out = guide(evidence, "claude", ask=True)
    assert out["source"] == "template" and "ANTHROPIC_API_KEY" in out["fallback_reason"]


def test_refusal_is_cached_as_the_template(evidence, monkeypatch, in_tmp):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    response = SimpleNamespace(stop_reason="refusal", content=[])
    with pytest.raises(ValueError, match="refused"):
        parse_claude(response)
    monkeypatch.setattr(guide_module, "call_claude", lambda body: parse_claude(response))
    out = guide(evidence, "claude", ask=True)
    assert out["source"] == "template" and "refused" in out["fallback_reason"]
    monkeypatch.setattr(guide_module, "call_claude", lambda body: (_ for _ in ()).throw(AssertionError("cached")))
    again = guide(evidence, "claude")
    assert again["fallback_reason"] == out["fallback_reason"]


def test_call_sets_effort_and_does_not_disable_thinking(monkeypatch):
    captured = {}

    class Messages:
        @staticmethod
        def create(**kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                stop_reason="end_turn",
                content=[SimpleNamespace(type="text", text='{"summary": ["Hi."], "steps": []}')],
            )

    class Client:
        def __init__(self, **kwargs):
            self.messages = Messages()

    monkeypatch.setitem(__import__("sys").modules, "anthropic", SimpleNamespace(Anthropic=Client))
    out = call_claude({"slots": []})
    assert out == {"summary": ["Hi."], "steps": []}
    assert captured["model"] == guide_module.MODEL
    assert captured["output_config"]["effort"] == "high"
    assert captured["output_config"]["format"]["type"] == "json_schema"
    assert "thinking" not in captured


def test_claude_is_called_only_when_asked_then_cached(evidence, monkeypatch, in_tmp):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    calls = []
    good = {"summary": ["The silicon-to-graphite ratio leans higher, {diff:si_graphite_ratio}, but it is not settled."],
            "steps": [{"target": "moved", "title": "The biggest move", "sentences": ["It moved {shift:si_graphite_ratio}."]}]}

    def fake(body):
        calls.append(body)
        assert all("says" in s for s in body["slots"]) and "images" not in body
        return good

    monkeypatch.setattr(guide_module, "call_claude", fake)
    assert guide(evidence, "claude")["source"] == "template" and not calls  # a GET never pays
    first, second = guide(evidence, "claude", ask=True), guide(evidence, "claude")
    assert first["source"] == "claude" and first == second and len(calls) == 1  # cached
    assert first["slots"]["diff:si_graphite_ratio"]["text"] == "0.090 → 0.115"

    Path(next(Path("out/guide").rglob("*.json"))).write_text("{broken")
    assert guide(evidence, "claude")["source"] == "template"  # a broken cache is a miss, not a 500


def test_two_drops_fall_back_and_errors_dont_cache(evidence, monkeypatch, in_tmp):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(guide_module, "call_claude", lambda body: {
        "summary": ["It rose 30%.", "Ship it.", "The ratio {diff:si_graphite_ratio} is not settled."],
        "steps": [{"target": "moved", "title": "Move", "sentences": ["It moved {shift:si_graphite_ratio}."]}]})
    bad = guide(evidence, "claude", ask=True)
    assert bad["source"] == "template" and "house rules 2 times" in bad["fallback_reason"]

    def broken(body):
        raise RuntimeError("offline")

    monkeypatch.setattr(guide_module, "call_claude", broken)
    monkeypatch.setattr(guide_module, "PROMPT_VERSION", 99)
    assert "offline" in guide(evidence, "claude", ask=True)["fallback_reason"]
    assert guide(evidence, "claude")["fallback_reason"] == "Claude hasn't written this one yet."


def test_api_guide_get_is_free_and_post_asks(evidence, monkeypatch, in_tmp):
    cfg = yaml.safe_load(Path("config/decision.yaml").read_text()) | {"data_dir": "data"}
    Path("config/decision.yaml").write_text(yaml.safe_dump(cfg))
    path = evidence_path(evidence.batch, cfg["baseline"])
    path.parent.mkdir(parents=True)
    path.write_text(evidence.model_copy(update={"baseline": cfg["baseline"]}).model_dump_json())
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    calls = []
    monkeypatch.setattr(guide_module, "call_claude", lambda body: calls.append(1) or {"summary": [], "steps": []})
    client = TestClient(app)
    assert client.get(f"/api/guide/{evidence.batch}").json()["source"] == "template" and not calls
    assert client.get(f"/api/guide/{evidence.batch}?source=claude").json()["source"] == "template" and not calls
    assert client.post(f"/api/guide/{evidence.batch}").status_code == 200 and calls == [1]
    assert client.get(f"/api/guide/{evidence.batch}?source=nope").status_code == 400


@pytest.mark.parametrize("batch", ["fake_ok", "fake_odd", "fake_shift", "fake_baseline"])
def test_template_passes_its_own_rules_on_every_synthetic_batch(batch, in_tmp):
    Path("out").mkdir()
    Path("out/kpis.csv").write_text((FIXTURES / "kpis_fake.csv").read_text())
    cfg = load_config() | {"version": "test", "baseline": "fake_baseline"}
    ev = with_texts(evaluate(read_tables(Path("out/kpis.csv")), batch, cfg), {})
    ifs = whatifs(ev, cfg)
    table = slots(ev, {}, ifs, cfg)
    plain = template(ev, {}, table, ifs, cfg)
    texts = plain["summary"] + [x for st in plain["steps"] for x in st["sentences"]]
    assert [(t, problem(t, table, ev, {})) for t in texts if problem(t, table, ev, {})] == []
    assert all(problem(s, table, ev, {}) is None for s in ev.explanations.next_steps)  # quotable as they are
