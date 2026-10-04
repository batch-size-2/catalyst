"""Texts from one Evidence by fixed templates (PLAN_v4 §3.8). No language model.

explain() gives the answer sentence, the next steps and four audience texts, each a list of sentences.
"""

import json
import math
import re
from pathlib import Path

import yaml

from qc.schema import DETECTORS, PARTICLE_TYPES_PATH, Difference, Evidence, Explanations, Odd

DICTIONARY_PATH = Path("config/kpi_dictionary.yaml")
GRAPHITE_MAH_G, SIOX_MAH_G, SI_MAH_G = 372, 1500, 3600
SI_EXPANSION, GRAPHITE_EXPANSION = 2.8, 0.1
BRUGGEMAN = 1.5
STATUS_PHRASES = {
    "DIFFERENT": "differs from the baseline",
    "UNCLEAR": "is not settled",
    "SIMILAR": "matches the baseline",
}
METRIC_WORDS = {
    "noise": "noise", "sharpness": "sharpness", "p1": "brightness", "p50": "brightness", "p99": "brightness",
    "black_level": "black level", "saturated_frac": "saturation", "curtaining_index": "curtaining",
}


def load_dictionary(path: Path = DICTIONARY_PATH, types_path: Path = PARTICLE_TYPES_PATH) -> dict:
    """The KPI dictionary, with a name for every fitted particle type the dictionary doesn't describe yet."""
    dictionary = (yaml.safe_load(path.read_text()) or {}) if path.exists() else {}
    if types_path.exists():
        described = dictionary.get("particle_types") or {}
        for t in json.loads(types_path.read_text()).get("types", []):
            described[t["id"]] = {"name": f"share of {t['id']} particles", "unit": "fraction",
                                  "meaning": t.get("name", "")} | (described.get(t["id"]) or {})
        dictionary["particle_types"] = described
    return dictionary


def entry(q: str, dictionary: dict) -> dict:
    if q.startswith("type_share:"):
        return (dictionary.get("particle_types") or {}).get(q.removeprefix("type_share:"), {}) or {}
    return dictionary.get(q, {}) or {}


def label(q: str, dictionary: dict) -> str:
    name = entry(q, dictionary).get("name")
    if name:
        return name
    return f"share of {q.removeprefix('type_share:')} particles" if q.startswith("type_share:") else q


def batch_name(batch: str) -> str:
    return batch.replace("_", " ")


def fmt(value: float | None, unit: str) -> str:
    if value is None:
        return "—"
    if unit == "fraction":
        return f"{100 * value:.3g}%"
    if unit == "um":
        return f"{value:.3g} µm"
    return f"{value:.3g}"


def fmt_pair(a: float | None, b: float | None, unit: str, sep: str = " → ") -> str:
    """Two values with the same number of decimals: 3 significant figures of the larger (web lib.fmtPair)."""
    f = 100 if unit == "fraction" else 1
    vals = [abs(v * f) for v in (a, b) if v is not None and math.isfinite(v)]
    if not vals:
        return f"{fmt(a, unit)}{sep}{fmt(b, unit)}"
    top = max(vals)
    dec = min(6, max(0, 2 - math.floor(math.log10(top)))) if top else 0
    suffix = "%" if unit == "fraction" else " µm" if unit == "um" else ""
    one = lambda v: "—" if v is None or not math.isfinite(v) else f"{0 if v == 0 else f'{v * f:.{dec}f}'}{suffix}"
    return f"{one(a)}{sep}{one(b)}"


def fmt_range(lo: float, hi: float, unit: str) -> str:
    """A reference range; every measured quantity is non-negative, so the lower end is clipped at 0."""
    return fmt_pair(max(lo, 0.0), hi, unit, " to ")


def raw(value: float | None, unit: str) -> str:
    if value is None:
        return "—"
    return f"{value:.3g}" + (" µm" if unit == "um" else "")


def sentence(text: str) -> str:
    text = str(text).strip()
    if not text:
        return ""
    text = text[0].upper() + text[1:]
    return text if text.endswith((".", "!", "?")) else f"{text}."


def join_and(items: list[str]) -> str:
    items = list(dict.fromkeys(items))
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} and {items[-1]}" if items else ""


def imaging_words(metrics: list[str]) -> str:
    """'noise and brightness differ on all three detectors, sharpness on BSE and ETD' from BSE.noise, ..."""
    where: dict[str, list[str]] = {}
    for m in metrics:
        channel, _, metric = m.rpartition(".")
        kind = METRIC_WORDS.get(metric, metric)
        where.setdefault(kind, [])
        if channel and channel not in where[kind]:
            where[kind].append(channel)
    groups: dict[tuple[str, ...], list[str]] = {}
    order = {d: i for i, d in enumerate(DETECTORS)}
    for kind, channels in where.items():
        groups.setdefault(tuple(sorted(channels, key=lambda c: (order.get(c, len(order)), c))), []).append(kind)
    def on(channels: tuple[str, ...]) -> str:
        if not channels:
            return ""
        return " on all three detectors" if len(channels) == len(DETECTORS) else f" on {join_and(list(channels))}"

    parts = sorted(groups.items(), key=lambda g: -len(g[0]))
    if not parts:
        return ""
    (channels, kinds), rest = parts[0], parts[1:]
    head = f"{join_and(kinds)} {'differs' if len(kinds) == 1 else 'differ'}{on(channels)}"
    return ", ".join([head, *(f"{join_and(k)}{on(c)}" for c, k in rest)])


def causes(d, dictionary: dict) -> str | None:
    field = "if_higher" if d.difference is not None and d.difference > 0 else "if_lower"
    text = entry(d.name, dictionary).get(field)
    if not text:
        return None
    text = str(text).strip()
    if not text:
        return None
    if not text.lower().startswith("possible causes"):
        text = f"Possible causes to check: {text}"
    return sentence(text)


def top_quantities(evidence: Evidence, n: int | None = 3) -> list[Difference]:
    """Used key quantities that are not settled as similar, in the driver ranking.

    Of two mirrored particle-type shares only the higher-ranked is kept (twin_share).
    """
    by_name = {d.name: d for d in evidence.differences if d.used and d.status != "SIMILAR"}
    names = [q for q in evidence.drivers if q in by_name]
    names.extend(d.name for d in evidence.differences if d.name in by_name and d.name not in names)
    top = [by_name[q] for q in names if q != twin_share(evidence)]
    return top if n is None else top[:n]


def twin_share(evidence: Evidence) -> str | None:
    """Of exactly two particle-type shares that mirror each other, the lower-ranked one, which isn't shown.

    They mirror when one went up by about what the other went down and both got the same status;
    otherwise both are shown, so a share that isn't settled is never hidden behind a settled one.
    """
    shares = [d for d in evidence.differences if d.name.startswith("type_share:")]
    if len(shares) != 2:
        return None
    a, b = shares
    if (a.status != b.status or a.used != b.used or a.difference is None or b.difference is None
            or a.difference * b.difference > 0):  # opposite signs, or both unchanged (a self-check)
        return None
    if abs(a.difference + b.difference) > 0.25 * max(abs(a.difference), abs(b.difference)):
        return None
    rank = {q: i for i, q in enumerate(evidence.drivers)}
    return max((a.name, b.name), key=lambda q: (rank.get(q, len(rank)), q == b.name))


def within_tolerance(evidence: Evidence) -> list[str]:
    """Every quantity settled as similar, minus the paused ones and the mirrored share."""
    twin = twin_share(evidence)
    return [d.name for d in evidence.differences
            if d.status == "SIMILAR" and d.note != "imaging changed" and d.name != twin]


def fmt_sigma(s: float | None) -> str:
    """'+2.1σ', rounded half away from zero like the UI, with a real minus and no '-0.0'."""
    if s is None or not math.isfinite(s):
        return "—"
    r = int(abs(s) * 10 + 0.5 + 1e-9) / 10
    return f"{'+' if s > 0 else '−'}{r:.1f}σ" if r else "0.0σ"


def odd_by_tile(evidence: Evidence) -> dict[str, list[Odd]]:
    """Odd entries (one per unit and quantity) grouped by tile, or by strip at the strip unit."""
    units: dict[str, list[Odd]] = {}
    for odd in evidence.odd_images if evidence.unit == "image" else evidence.odd_strips:
        units.setdefault(odd.image_ids[0] if evidence.unit == "image" else odd.strip_id, []).append(odd)
    return units


def tiles_phrase(ids: list[str], unit: str) -> str:
    noun = "tile" if unit == "image" else "strip"
    return f"{noun} {ids[0]}" if len(ids) == 1 else f"{noun}s {join_and(ids)}"


def summary(evidence: Evidence, dictionary: dict) -> str:
    """The answer in one plain sentence, without code names or the verdict word."""
    b = batch_name(evidence.batch)
    if any(r.startswith("Contains a particle type not seen before") for r in evidence.reasons):
        return f"{b} contains a particle type the baseline doesn't have."
    top = top_quantities(evidence, None)
    contra = set(evidence.other_unit.contradictions)
    different = [d for d in top if d.status == "DIFFERENT" and d.name not in contra][:2]
    if different:
        return f"{b} differs from the baseline on {join_and([label(d.name, dictionary) for d in different])}."
    split = [d for d in top if d.status == "DIFFERENT" and d.name in contra][:2]
    if split:
        return (f"{b} differs from the baseline on {join_and([label(d.name, dictionary) for d in split])} per tile "
                f"but not per strip, so it isn't settled.")
    if evidence.verdict == "ACCEPT":
        return f"{b} matches the baseline on every key property."
    unclear = [d for d in top if d.status == "UNCLEAR" and d.difference is not None][:2]
    if unclear:
        sides = [("a higher " if d.difference > 0 else "a lower ") + label(d.name, dictionary) for d in unclear]
        if len(sides) == 2 and sides[0].split()[1] == sides[1].split()[1]:
            sides[1] = label(unclear[1].name, dictionary)
        settled = "it isn't settled" if len(unclear) == 1 else "neither is settled"
        return f"{b} has {' and '.join(sides)} than the baseline, but {settled}."
    checked = "every key property that could be checked" if evidence.imaging.changed else "every key property"
    if evidence.imaging.changed:
        why = "the images differ from the baseline's, so some properties are paused"
    elif evidence.controls.ran and not evidence.controls.passed:
        why = "the known-answer controls failed"
    elif not evidence.controls.ran:
        why = "the known-answer controls haven't been run"
    elif evidence.power.limited:
        why = "there are too few tiles to confirm it"
    else:
        why = "a rule fired that needs a closer look"
    return f"{b} looks like the baseline on {checked}, but {why}."


def rules(evidence: Evidence, dictionary: dict) -> list[str]:
    """The verdict rules that fired (qc.decide.verdict_of), one line each, in precedence order."""
    used = [d for d in evidence.differences if d.used]
    contra = set(evidence.other_unit.contradictions)
    different = [label(d.name, dictionary) for d in used if d.status == "DIFFERENT" and d.name not in contra]
    unclear = [d for d in used if d.status == "UNCLEAR" and d.name != twin_share(evidence)]
    odd = odd_by_tile(evidence)
    noun = "tiles" if evidence.unit == "image" else "strips"
    n1, n2 = evidence.power.n_segments
    fired = [
        (any(r.startswith("Contains a particle type not seen before") for r in evidence.reasons),
         "A particle type the baseline doesn't have"),
        (bool(different), f"Differs beyond the tolerance on {join_and(different)}"),
        (evidence.imaging.changed, "Imaging differs from the baseline"),
        (bool(odd), f"{len(odd)} of {evidence.n_images.get('batch', n1)} {noun} outside the baseline range"),
        (bool(contra), f"{join_and([label(q, dictionary) for q in contra])} changes status between tiles and strips"),
        (evidence.power.limited, f"Too few {noun} to confirm any difference ({n1} vs {n2})"),
        (bool(unclear), f"{len(unclear)} key propert{'y' if len(unclear) == 1 else 'ies'} not settled"),
        (evidence.controls.ran and not evidence.controls.passed, "Known-answer controls failed"),
        (not evidence.controls.ran, "Known-answer controls not run"),
        (not used, "No key property measured on both sides"),
    ]
    return [line for hit, line in fired if hit] if evidence.verdict != "ACCEPT" else []


def plain(text: str, evidence: Evidence, dictionary: dict) -> str:
    """decide.py's next action in words: metric lists dropped, quantity codes replaced by names."""
    if evidence.imaging.changed_metrics:
        text = re.sub(r"(?<=imaging settings) \([^)]*\)", "", text)
    paused = [d.name for d in evidence.differences if d.note == "imaging changed"]
    if paused:
        text = text.replace(", ".join(paused), join_and([label(q, dictionary) for q in paused]))
    for q in sorted({d.name for d in evidence.differences}, key=len, reverse=True):
        text = re.sub(rf"(?<![\w:]){re.escape(q)}(?![\w:])", label(q, dictionary), text)
    text = text.replace(" (Sync 2)", "").replace("the reference", "the baseline")
    return sentence(text.replace("imaging settings", "microscope settings").replace("Run the controls", "Run the known-answer controls"))


def next_steps(evidence: Evidence, dictionary: dict) -> list[str]:
    """At most three steps: decide.py's next action in words, the odd tiles, then the supplier check."""
    steps = [plain(evidence.next_action, evidence, dictionary)]
    by_tile = odd_by_tile(evidence)
    remaining = [t for t in by_tile if not re.search(rf"\b{re.escape(t)}\b", steps[0])]
    if remaining:
        quantities = [label(o.quantity, dictionary) for t in remaining for o in by_tile[t]]
        also = "Also look at" if len(remaining) < len(by_tile) else "Look at"
        steps.append(f"{also} {tiles_phrase(remaining, evidence.unit)}: outside the baseline range on "
                     f"{join_and(quantities)}.")
    top = top_quantities(evidence, 1)
    check = entry(top[0].name, dictionary).get("supplier_check") if top else None
    if check and evidence.verdict != "ACCEPT":
        check = str(check).strip()
        steps.append(sentence(f"At the supplier, for {label(top[0].name, dictionary)}: "
                              f"{check[0].lower()}{check[1:]}"))
    return list(dict.fromkeys(s for s in steps if s))[:3]


def explain(evidence: Evidence, dictionary: dict) -> Explanations:
    headlines = {
        "ACCEPT": "The batch matches the baseline.",
        "REJECT": "The batch differs from the baseline.",
        "INVESTIGATE": "The batch needs a closer look before release.",
    }
    headline = headlines[evidence.verdict]
    action = "Release it." if evidence.verdict == "ACCEPT" else "Hold it and call the process engineer."
    operator = [headline, action]
    top = top_quantities(evidence)

    engineer = []
    for d in top:
        unit = d.unit or entry(d.name, dictionary).get("unit", "")
        engineer.append(sentence(f"{label(d.name, dictionary)} is {fmt(d.batch, unit)} against "
                                 f"{fmt(d.reference, unit)} in the baseline: it {STATUS_PHRASES[d.status]}"))
        if cause := causes(d, dictionary):
            engineer.append(cause)
        supplier = entry(d.name, dictionary).get("supplier_check")
        if supplier and (supplier := sentence(supplier)):
            engineer.append(f"At the supplier: {supplier}")
    if not top:
        engineer.append("Every key quantity is within the margin of the baseline.")

    differences = {d.name: d for d in evidence.differences}
    subject = "Tile" if evidence.unit == "image" else "Strip"
    for tile, odds in list(odd_by_tile(evidence).items())[:3]:
        parts = []
        for odd in odds:
            d = differences.get(odd.quantity)
            unit = d.unit if d else entry(odd.quantity, dictionary).get("unit", "")
            parts.append(f"{label(odd.quantity, dictionary)} ({fmt(odd.value, unit)}; baseline range "
                         f"{fmt_range(odd.range[0], odd.range[1], unit)})")
        engineer.append(f"{subject} {tile} stands out on {join_and(parts)}.")
    if evidence.imaging.changed:
        paused = [label(d.name, dictionary) for d in evidence.differences if d.note == "imaging changed"]
        engineer.append(sentence(f"Imaging differs from the baseline: {imaging_words(evidence.imaging.changed_metrics)}; check the "
                                 f"microscope settings before trusting {join_and(paused) or 'brightness-based quantities'}"))
    if (evidence.new_type_share is not None
            and any(reason.startswith("Contains a particle type not seen before") for reason in evidence.reasons)):
        engineer.append(f"{evidence.new_type_share:.1%} of the silicon area is a particle type not seen in the baseline.")
    engineer.append(f"Next: {plain(evidence.next_action, evidence, dictionary)}")

    n1, n2 = evidence.power.n_segments
    scientist = [f"Unit: {evidence.unit}, {n1} vs {n2}; {evidence.power.n_arrangements} label arrangements, "
                 f"smallest possible p {evidence.power.min_p:.2g}."]
    for d in evidence.differences:
        if not d.used:
            continue
        text = (f"{d.name}: {d.status}, {raw(d.batch, d.unit)} vs {raw(d.reference, d.unit)}, "
                f"difference {raw(d.difference, d.unit)}")
        if d.interval is not None:
            text += (f", interval {raw(d.interval[0], d.unit)} to {raw(d.interval[1], d.unit)} "
                     f"against a margin of ±{raw(d.margin, d.unit)}")
        if d.p is not None:
            text += f", family-wise p = {d.p:.2g}"
        scientist.append(f"{text}.")
    other_unit = evidence.other_unit.unit
    statuses = evidence.other_unit.statuses
    if statuses:
        scientist.append(f"Per {other_unit}: " + "; ".join(f"{q} {status}" for q, status in statuses.items()) + ".")
    if evidence.other_unit.contradictions:
        scientist.append(f"{', '.join(evidence.other_unit.contradictions)} changes status between the "
                         f"{evidence.unit} and the {other_unit} view.")
    for d in evidence.differences:
        if d.key and not d.used:
            scientist.append(f"{d.name} not used ({d.note or 'not measured'}).")
    if evidence.imaging.outliers_in_reference:
        scientist.append("Reference images left out of the imaging range: "
                         f"{', '.join(evidence.imaging.outliers_in_reference)}.")
    if evidence.imaging.curtained_images:
        scientist.append("Run-length descriptors blanked for curtained images: "
                         f"{', '.join(evidence.imaging.curtained_images)}.")
    if evidence.imaging.report_metrics:
        scientist.append("Imaging metrics outside the baseline range, not used for the verdict: "
                         f"{', '.join(evidence.imaging.report_metrics)}.")
    if not evidence.controls.ran:
        scientist.append("Controls not run.")
    elif evidence.controls.passed is True:
        scientist.append("Controls passed.")
    else:
        names = ", ".join(r.name for r in evidence.controls.results if not r.passed)
        scientist.append(f"Controls failed: {names}.")
    scientist.append("Images of one strip are correlated, so the image-level p can be too small; "
                     "the strip view is reported alongside.")

    manager = [headline]
    if top:
        manager.append(sentence(f"Main driver: {label(top[0].name, dictionary)}"))
    contradictions = set(evidence.other_unit.contradictions)
    reject_driver = next((d for d in top_quantities(evidence, None)
                          if d.status == "DIFFERENT" and d.name not in contradictions), None)
    if evidence.verdict == "REJECT" and reject_driver is not None:
        p = f"{reject_driver.p:.2g}" if reject_driver.p is not None else "—"
        manager.append(f"The difference is beyond the agreed margin (family-wise p = {p}).")
    elif evidence.verdict == "INVESTIGATE":
        manager.extend(["Not settled yet.", plain(evidence.next_action, evidence, dictionary)])
    elif evidence.verdict == "ACCEPT":
        manager.append("Every key quantity is within the agreed margin.")
    why = entry(top[0].name, dictionary).get("why_it_matters") if top else None
    if why := sentence(why or ""):
        manager.append(why)

    consequence = False
    silicon = next((d for d in top if d.name == "si_graphite_ratio"
                    and d.batch is not None and d.reference is not None
                    and d.batch > 0 and d.reference > 0), None)
    if silicon:
        s_b = silicon.batch / (1 + silicon.batch)
        s_r = silicon.reference / (1 + silicon.reference)
        cap = lambda s, c: s * c + (1 - s) * GRAPHITE_MAH_G
        changes = [cap(s_b, c) / cap(s_r, c) - 1 for c in (SIOX_MAH_G, SI_MAH_G)]
        lo, hi = min(changes), max(changes)
        manager.append(f"Indicative: silicon is {s_b:.0%} of the silicon and graphite area against {s_r:.0%}, "
                       f"about {lo:+.0%} to {hi:+.0%} theoretical capacity (graphite {GRAPHITE_MAH_G} mAh/g; "
                       f"SiOx {SIOX_MAH_G:,} to Si {SI_MAH_G:,} mAh/g) and {s_b / s_r:.1f}× the "
                       f"silicon-driven swelling (Si expands about {SI_EXPANSION:.0%} on lithiation, "
                       f"graphite about {GRAPHITE_EXPANSION:.0%}).")
        consequence = True
    porosity = next((d for d in top if d.name == "porosity_apparent" and d.used
                     and d.batch is not None and d.reference is not None
                     and d.batch > 0 and d.reference > 0), None)
    if porosity:
        change = (porosity.batch / porosity.reference) ** BRUGGEMAN - 1
        manager.append(f"Indicative: ion transport through the pores about {change:+.0%} "
                       f"(Bruggeman, porosity^{BRUGGEMAN:g}, on apparent porosity).")
        consequence = True
    if consequence:
        manager.append("These ranges are indicative, from textbook relations, not predictions.")

    return Explanations(summary=sentence(summary(evidence, dictionary)), rules=rules(evidence, dictionary),
                        ranked=[d.name for d in top_quantities(evidence, None)], twin=twin_share(evidence),
                        within_tolerance=within_tolerance(evidence),
                        next_steps=next_steps(evidence, dictionary),
                        operator=operator, engineer=engineer, scientist=scientist, manager=manager)
