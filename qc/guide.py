"""Claude as a guide, not a judge (design/README.md, "Claude as a guide").

Catalyst decides; Claude points and explains. The verdict, every status and every number come from
the evidence. Claude reads the evidence and the dictionary entries (never images) and writes a short
summary and a walkthrough. It can't write numbers: each one is a slot such as {diff:si_graphite_ratio}
that Catalyst fills in from the evidence. A sentence with an unknown slot, a number of its own, a
banned word or too many words is dropped; two drops, no API key or any error fall back to the fixed
template below, which uses the same slots.

The one what-if Catalyst computes for it: the batch's means with its odd tiles left out (qc.decide.compare).
"""

import hashlib
import json
import os
import re
import threading

from qc.decide import compare, read_tables
from qc.explain import (
    batch_name, entry, fmt, fmt_range, join_and, label, load_dictionary, odd_by_tile, sentence, top_quantities,
)
from qc.schema import KPI_TABLE, Evidence, Tables, guide_path, load_config

MODEL = os.environ.get("CATALYST_CLAUDE_MODEL", "claude-opus-5")  # PLAN_v4 §3.10: Claude Opus
PROMPT_VERSION = 1
CALL_LOCK = threading.Lock()
TARGETS = ("verdict", "moved", "tiles", "next")
TITLES = {"verdict": "What decided it", "moved": "The biggest move", "tiles": "Where it comes from",
          "next": "What to do next"}
MAX_WORDS, MAX_SUMMARY, MAX_STEPS, MAX_STEP_SENTENCES, MAX_DROPS = 28, 3, 4, 2, 2
SLOT = re.compile(r"\{(diff|shift|interval|tile|range|whatif|count):([^{}\s]+)\}")
BANNED = re.compile(r"\b(significant\w*|crucial\w*|notabl\w*|defect\w*|alarming\w*)\b", re.I)
NUMBER_WORDS = re.compile(r"\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|"
                          r"fifteen|sixteen|seventeen|eighteen|nineteen|twenty|half|twice|double|triple)\b", re.I)
VERDICTS = re.compile(r"\b(accept\w*|investigat\w*|reject\w*)\b", re.I)

SYSTEM = """You are a guide inside Catalyst, a quality-control app for SEM images of battery anodes.
Catalyst has already compared a batch against a baseline with fixed statistical rules and set the
verdict. You never decide, measure or change anything. You explain what Catalyst found to an analyst,
in plain words, and point at where to look.

Write JSON that matches the schema:
- summary: at most 3 sentences on what stood out.
- steps: at most 4 walkthrough steps, in this order when they apply: "verdict" (why the rules gave
  this verdict), "moved" (the biggest move), "tiles" (which tiles carry it), "next" (what to do next).
  Each step has a title of at most 5 words and 1 or 2 sentences.

House rules (a sentence that breaks one is deleted before anyone sees it):
- Never write a number yourself, neither as digits nor as words. Every number is a slot from the
  `slots` list, written exactly as given, e.g. {diff:si_graphite_ratio} or {tile:4ih2ggld.si_graphite_ratio}.
  Each slot's `says` field shows what Catalyst will print in its place. Use only listed slots.
- At most 28 words per sentence. Plain words; use the quantity `label`, never its code name.
- "Differs", never "defective". Say "not settled" when a status is UNCLEAR.
- Never use "significant", "crucial" or "notable".
- Don't restate the verdict word in the summary; the page already shows it.
- Next steps only from `next_steps` and the dictionary `supplier_check`. Don't invent causes;
  dictionary causes are "possible causes to check".
- If a what-if is listed, you may quote it with its whatif slot. Don't speculate beyond it."""

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "array", "items": {"type": "string"}},
        "steps": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "target": {"type": "string", "enum": list(TARGETS)},
                "title": {"type": "string"},
                "sentences": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["target", "title", "sentences"],
            "additionalProperties": False,
        }},
    },
    "required": ["summary", "steps"],
    "additionalProperties": False,
}


def sigma(value: float | None, d, similar_margin: float) -> float | None:
    """A difference in baseline SDs: the margin is similar_margin SDs (the UI's ±1.5σ tolerance)."""
    return None if value is None or not d.margin else value / d.margin * similar_margin


def whatifs(evidence: Evidence, cfg: dict) -> list[dict]:
    """Per quantity with odd tiles: the batch re-compared without the tiles that are odd on it."""
    by_tile = odd_by_tile(evidence)
    if evidence.unit != "image" or not by_tile or not KPI_TABLE.exists():
        return []
    tables = read_tables(KPI_TABLE)
    batch, reference = tables.get(evidence.batch), tables.get(evidence.baseline)
    measured = {i for s in evidence.fingerprint.segments for i in s.image_ids}
    if batch is None or reference is None or set(batch.kpis["image_id"]) != measured:
        return []  # the tables moved on since this evidence was written
    tiles_on: dict[str, list[str]] = {}
    for tile, odds in by_tile.items():
        for odd in odds:
            tiles_on.setdefault(odd.quantity, []).append(tile)
    without: dict[tuple[str, ...], dict] = {}
    out = []
    for q, ids in tiles_on.items():
        key = tuple(ids)
        if key not in without:
            rest = Tables(*(f[~f["image_id"].isin(ids)] if "image_id" in f else f for f in batch))
            without[key] = ({d.name: d for d in compare(reference, rest, cfg | {"baseline": evidence.baseline}).differences}
                            if len(rest.kpis) >= 2 else {})
        d = without[key].get(q)
        if d is not None and d.batch is not None:
            out.append({"id": len(out) + 1, "tiles": ids, "quantity": q, "batch": d.batch,
                        "difference": d.difference, "margin": d.margin, "status": d.status,
                        "n_tiles": len(batch.kpis) - len(ids), "unit": d.unit})
    return out


def slots(evidence: Evidence, dictionary: dict, ifs: list[dict], similar_margin: float) -> dict[str, dict]:
    """Every number the text may quote: rendered text plus where it comes from."""
    table: dict[str, dict] = {}
    for d in evidence.differences:
        if d.reference is None or d.batch is None:
            continue
        name = label(d.name, dictionary)
        table[f"diff:{d.name}"] = {"text": f"{fmt(d.reference, d.unit)} → {fmt(d.batch, d.unit)}",
                                   "source": f"differences · {d.name}", "label": name}
        if (s := sigma(d.difference, d, similar_margin)) is not None:
            table[f"shift:{d.name}"] = {"text": f"{s:+.1f}σ", "source": f"differences · {d.name}", "label": name}
        if d.interval and (lo := sigma(d.interval[0], d, similar_margin)) is not None:
            hi = sigma(d.interval[1], d, similar_margin)
            table[f"interval:{d.name}"] = {"text": f"{lo:+.1f}σ to {hi:+.1f}σ",
                                           "source": f"differences · {d.name} · interval", "label": name}
    for tile, odds in odd_by_tile(evidence).items():
        for odd in odds:
            table[f"tile:{tile}.{odd.quantity}"] = {
                "text": f"{tile} · {fmt(odd.value, unit_of(evidence, odd.quantity))}",
                "source": f"odd tiles · {odd.quantity}", "tile": tile, "batch": evidence.batch,
                "label": label(odd.quantity, dictionary)}
            table[f"range:{odd.quantity}"] = {
                "text": fmt_range(odd.range[0], odd.range[1], unit_of(evidence, odd.quantity)),
                "source": f"odd tiles · {odd.quantity} · baseline range", "label": label(odd.quantity, dictionary)}
    for w in ifs:
        d = next(d for d in evidence.differences if d.name == w["quantity"])
        shift = sigma(w["difference"], d, similar_margin)
        table[f"whatif:{w['id']}"] = {
            "text": fmt(w["batch"], w["unit"]),
            "source": (f"Catalyst recomputed {w['quantity']} without {', '.join(w['tiles'])}: mean of "
                       f"{w['n_tiles']} tiles" + (f", {shift:+.1f}σ" if shift is not None else "")
                       + f", {w['status'].lower()}"),
            "label": label(w["quantity"], dictionary)}
    counts = {
        "batch_tiles": evidence.n_images.get("batch"), "baseline_tiles": evidence.n_images.get("baseline"),
        "odd_tiles": len(odd_by_tile(evidence)),
        "imaging_settings": len(evidence.imaging.changed_metrics) if evidence.imaging.changed else None,
        "unclear": sum(d.used and d.status == "UNCLEAR" for d in evidence.differences),
        "similar": sum(d.status == "SIMILAR" for d in evidence.differences),
        "rules": len(evidence.explanations.rules) or None,
    }
    for key, n in counts.items():
        if n is not None:
            table[f"count:{key}"] = {"text": str(n), "source": f"evidence · {key.replace('_', ' ')}"}
    return table


def unit_of(evidence: Evidence, q: str) -> str:
    return next((d.unit for d in evidence.differences if d.name == q), "")


def template(evidence: Evidence, dictionary: dict, table: dict, ifs: list[dict], similar_margin: float) -> dict:
    """The fixed-wording summary and walkthrough, with the same slots Claude would use."""
    b = batch_name(evidence.batch)
    top = [d for d in top_quantities(evidence, 2) if f"diff:{d.name}" in table]
    by_tile = odd_by_tile(evidence)
    ranked = [q for q in evidence.drivers if any(o.quantity == q for odds in by_tile.values() for o in odds)]
    odd_q = ranked[0] if ranked else next((o.quantity for odds in by_tile.values() for o in odds), None)
    odd_tiles = [t for t, odds in by_tile.items() if any(o.quantity == odd_q for o in odds)]
    tile_slots = join_and([f"{{tile:{t}.{odd_q}}}" for t in odd_tiles])
    whatif = next((w for w in ifs if w["quantity"] == odd_q), None)
    paused = [label(d.name, dictionary) for d in evidence.differences if d.note == "imaging changed"]

    summary = []
    if top:
        moves = join_and([f"{label(d.name, dictionary)} {{diff:{d.name}}}" for d in top])
        statuses = {d.status for d in top}
        tail = ("beyond the tolerance" if statuses == {"DIFFERENT"} else
                ("it isn't settled" if len(top) == 1 else "neither is settled") if statuses == {"UNCLEAR"} else
                "not all of it is settled")
        summary.append(f"The largest moves are in {moves}, and {tail}." if len(top) > 1 else
                       f"The largest move is in {moves}, and {tail}.")
    else:
        summary.append("Every key property sits within the tolerance of the baseline.")
    carried = None
    if odd_tiles and whatif:
        d = next(d for d in evidence.differences if d.name == odd_q)
        before, after = sigma(d.difference, d, similar_margin), sigma(whatif["difference"], d, similar_margin)
        carried = before is not None and after is not None and abs(after) < abs(before) / 2
        summary.append(f"Most of the {label(odd_q, dictionary)} shift comes from {tile_slots}; without them {b} "
                       f"averages {{whatif:{whatif['id']}}}." if carried else
                       f"{tile_slots} sit outside the baseline range; without them {b} still averages "
                       f"{{whatif:{whatif['id']}}}.")
    elif odd_tiles:
        summary.append(f"{tile_slots} sit outside the baseline range on {label(odd_q, dictionary)}.")
    if evidence.imaging.changed:
        summary.append(f"The microscope settings also changed on {{count:imaging_settings}} settings, so "
                       f"{join_and(paused) or 'brightness-based properties'} are on hold.")

    steps = []
    if evidence.verdict == "ACCEPT":
        steps.append(step("verdict", ["Catalyst's fixed rules all passed: every key property is within tolerance "
                                      "and the controls passed."]))
    else:
        steps.append(step("verdict", ["This verdict comes from Catalyst's fixed rules, not a judgement call: "
                                      "{count:rules} of them fired.", "Any one of them is enough to hold a batch."],
                          "evidence · reasons"))
    lead = top[0] if top else None
    if lead and f"shift:{lead.name}" in table:
        name = label(lead.name, dictionary)
        status = {"UNCLEAR": f"Its interval {{interval:{lead.name}}} still overlaps the tolerance, so it isn't settled yet.",
                  "DIFFERENT": f"Its interval {{interval:{lead.name}}} clears the tolerance.",
                  "SIMILAR": f"Its interval {{interval:{lead.name}}} sits inside the tolerance."}[lead.status]
        steps.append(step("moved", [sentence(f"{name} moved most: {{shift:{lead.name}}}"),
                                    status if f"interval:{lead.name}" in table else ""]))
    if odd_tiles:
        lines = [f"{tile_slots} sit outside the baseline range {{range:{odd_q}}}."]
        if whatif:
            lines.append(f"Leave them out and {b} averages {{whatif:{whatif['id']}}}"
                         + (", within the tolerance of the baseline." if whatif["status"] == "SIMILAR" else "."))
        steps.append(step("tiles", lines))
    steps.append(step("next", evidence.explanations.next_steps[:MAX_STEP_SENTENCES] or [evidence.next_action],
                      "evidence · next steps"))
    return result("template", None, summary, steps, table)


def step(target: str, sentences: list[str], source: str | None = None, title: str | None = None) -> dict:
    return {"target": target, "title": title or TITLES[target], "sentences": [s for s in sentences if s],
            "source": source}


def result(source: str, model: str | None, summary: list[str], steps: list[dict], table: dict,
           dropped: list[str] | None = None, fallback: str | None = None) -> dict:
    texts = [*summary, *(s for st in steps for s in st["sentences"])]
    used = {f"{kind}:{key}" for text in texts for kind, key in SLOT.findall(text)}
    for st in steps:
        if not st.get("source"):
            sources = dict.fromkeys(table[f"{k}:{v}"]["source"] for s in st["sentences"] for k, v in SLOT.findall(s))
            st["source"] = " + ".join(list(sources)[:2]) or None
    return {"source": source, "model": model, "fallback_reason": fallback, "summary": summary, "steps": steps,
            "slots": {k: v for k, v in table.items() if k in used},
            "checks": {"numbers": sum(len(SLOT.findall(t)) for t in texts), "dropped": dropped or []}}


def problem(text: str, table: dict, summary: bool) -> str | None:
    """Why a sentence breaks the house rules, or None."""
    for kind, key in SLOT.findall(text):
        if f"{kind}:{key}" not in table:
            return f"unknown slot {{{kind}:{key}}}"
    bare = SLOT.sub(" ", text)
    if re.search(r"\d", bare) or NUMBER_WORDS.search(bare):
        return "a number outside a slot"
    if "{" in bare or "}" in bare:
        return "a malformed slot"
    if m := BANNED.search(bare):
        return f"banned word {m.group(0)!r}"
    if summary and (m := VERDICTS.search(bare)):
        return f"restates the verdict ({m.group(0)})"
    if len(SLOT.sub("x", text).split()) > MAX_WORDS:
        return f"over {MAX_WORDS} words"
    return None


def check(raw: dict, table: dict) -> tuple[list[str], list[dict], list[str]]:
    """Claude's JSON with every rule-breaking sentence dropped; returns summary, steps, drop notes."""
    dropped = []

    def keep(sentences, limit, in_summary):
        kept = []
        for s in sentences if isinstance(sentences, list) else []:
            s = str(s).strip()
            if not s:
                continue
            if why := problem(s, table, in_summary):
                dropped.append(f"{why}: {s[:80]}")
            elif len(kept) < limit:
                kept.append(s)
        return kept

    summary = keep(raw.get("summary"), MAX_SUMMARY, True)
    steps = []
    for item in (raw.get("steps") or [])[:MAX_STEPS]:
        target = item.get("target") if isinstance(item, dict) else None
        if target not in TARGETS:
            dropped.append(f"unknown step target {target!r}")
            continue
        sentences = keep(item.get("sentences"), MAX_STEP_SENTENCES, False)
        title = str(item.get("title") or "").strip()
        if not title or problem(title, {}, False) or len(title.split()) > 6 or SLOT.search(title):
            title = TITLES[target]
        if sentences:
            steps.append(step(target, sentences, title=title))
    return summary, steps, dropped


def payload(evidence: Evidence, dictionary: dict, table: dict, ifs: list[dict]) -> dict:
    """What Claude reads: the evidence in plain fields, the dictionary entries it touches, the slots."""
    names = [d.name for d in evidence.differences]
    return {
        "batch": batch_name(evidence.batch), "baseline": batch_name(evidence.baseline),
        "verdict": evidence.verdict, "rules_that_fired": evidence.explanations.rules,
        "next_steps": evidence.explanations.next_steps,
        "ranking": evidence.drivers,
        "properties": [{"code": d.name, "label": label(d.name, dictionary), "status": d.status, "key": d.key,
                        "counts_towards_verdict": d.used, "note": d.note,
                        "slots": [k for k in (f"diff:{d.name}", f"shift:{d.name}", f"interval:{d.name}") if k in table]}
                       for d in evidence.differences],
        "odd_tiles": {tile: [o.quantity for o in odds] for tile, odds in odd_by_tile(evidence).items()},
        "imaging": {"changed": evidence.imaging.changed, "settings": evidence.imaging.changed_metrics},
        "controls_ran": evidence.controls.ran,
        "whatifs": [{"slot": f"whatif:{w['id']}", "what": f"{label(w['quantity'], dictionary)} of the batch "
                     f"without tiles {', '.join(w['tiles'])}", "status_then": w["status"]} for w in ifs],
        "dictionary": {q: {k: v for k, v in entry(q, dictionary).items()
                           if k in ("name", "meaning", "why_it_matters", "if_higher", "if_lower", "supplier_check")}
                       for q in names if entry(q, dictionary)},
        "slots": [{"slot": k, "says": v["text"], "about": v.get("label", v["source"])} for k, v in table.items()],
    }


def available() -> str | None:
    """None when Claude can be called, else why not."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return "Claude isn't configured: set ANTHROPIC_API_KEY for the API process."
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return "The anthropic package isn't installed: run `uv sync`."
    return None


def call_claude(body: dict) -> dict:
    import anthropic

    response = anthropic.Anthropic().messages.create(
        model=MODEL, max_tokens=4000, system=SYSTEM,
        messages=[{"role": "user", "content": json.dumps(body, ensure_ascii=False)}],
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
    )
    text = "".join(block.text for block in response.content if getattr(block, "type", "") == "text")
    return json.loads(text)


def guide(evidence: Evidence, source: str = "claude") -> dict:
    """Summary and walkthrough of one comparison: Claude's when it passes the checks, else the template."""
    dictionary, cfg = load_dictionary(), load_config()
    ifs = whatifs(evidence, cfg)
    table = slots(evidence, dictionary, ifs, cfg["similar_margin"])
    plain = template(evidence, dictionary, table, ifs, cfg["similar_margin"])
    if source != "claude":
        return plain
    if why := available():
        return plain | {"fallback_reason": why}

    body = payload(evidence, dictionary, table, ifs)
    key = hashlib.sha256(json.dumps([MODEL, PROMPT_VERSION, SYSTEM, body], sort_keys=True).encode()).hexdigest()
    cache = guide_path(evidence.batch, evidence.baseline)
    with CALL_LOCK:  # one call at a time, so a repeated request reads the cache instead of paying twice
        if cache.exists() and (cached := json.loads(cache.read_text())).get("key") == key:
            return cached["result"]
        try:
            raw = call_claude(body)
        except Exception as error:  # network, quota, schema: the template still answers
            return plain | {"fallback_reason": f"Claude call failed: {type(error).__name__}: {error}"[:300]}
        summary, steps, dropped = check(raw, table)
        if len(dropped) >= MAX_DROPS or not summary or not steps:
            out = plain | {"fallback_reason": f"Claude's text broke the house rules {len(dropped)} times",
                           "checks": plain["checks"] | {"dropped": dropped}}
        else:
            out = result("claude", MODEL, summary, steps, table, dropped)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"key": key, "result": out}, indent=1, ensure_ascii=False))
    return out
