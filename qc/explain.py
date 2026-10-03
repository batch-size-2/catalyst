"""Four audience texts from one Evidence by fixed templates (PLAN_v4 §3.8). No language model."""

from pathlib import Path

import yaml

from qc.schema import Evidence, Explanations

DICTIONARY_PATH = Path("config/kpi_dictionary.yaml")
GRAPHITE_MAH_G, SIOX_MAH_G, SI_MAH_G = 372, 1500, 3600
SI_EXPANSION, GRAPHITE_EXPANSION = 2.8, 0.1
BRUGGEMAN = 1.5
STATUS_PHRASES = {
    "DIFFERENT": "differs from the reference",
    "UNCLEAR": "is not settled",
    "SIMILAR": "matches the reference",
}


def load_dictionary(path: Path = DICTIONARY_PATH) -> dict:
    return (yaml.safe_load(path.read_text()) or {}) if path.exists() else {}


def entry(q: str, dictionary: dict) -> dict:
    if q.startswith("type_share:"):
        return (dictionary.get("particle_types") or {}).get(q.removeprefix("type_share:"), {}) or {}
    return dictionary.get(q, {}) or {}


def label(q: str, dictionary: dict) -> str:
    name = entry(q, dictionary).get("name")
    if name:
        return name
    return f"share of particle type {q.removeprefix('type_share:')}" if q.startswith("type_share:") else q


def fmt(value: float | None, unit: str) -> str:
    if value is None:
        return "—"
    if unit == "fraction":
        return f"{100 * value:.3g}%"
    if unit == "um":
        return f"{value:.3g} µm"
    return f"{value:.3g}"


def raw(value: float | None, unit: str) -> str:
    if value is None:
        return "—"
    return f"{value:.3g}" + (" µm" if unit == "um" else "")


def sentence(text: str) -> str:
    text = str(text).strip()
    if not text:
        return ""
    return text if text.endswith((".", "!", "?")) else f"{text}."


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


def top_quantities(evidence: Evidence, n: int | None = 3):
    by_name = {d.name: d for d in evidence.differences if d.used and d.status != "SIMILAR"}
    names = [q for q in evidence.drivers if q in by_name]
    names.extend(d.name for d in evidence.differences if d.name in by_name and d.name not in names)
    top = [by_name[q] for q in names]
    return top if n is None else top[:n]


def explain(evidence: Evidence, dictionary: dict) -> Explanations:
    headlines = {
        "ACCEPT": "The batch matches the reference.",
        "REJECT": "The batch differs from the reference.",
        "INVESTIGATE": "The batch needs a closer look before release.",
    }
    headline = headlines[evidence.verdict]
    action = "Release it." if evidence.verdict == "ACCEPT" else "Hold it and call the process engineer."
    operator = f"{evidence.verdict}. {headline} {action}"
    top = top_quantities(evidence)

    engineer = []
    for d in top:
        unit = d.unit or entry(d.name, dictionary).get("unit", "")
        engineer.append(f"{label(d.name, dictionary)} is {fmt(d.batch, unit)} against "
                        f"{fmt(d.reference, unit)} in the reference: it "
                        f"{STATUS_PHRASES[d.status]}.")
        if cause := causes(d, dictionary):
            engineer.append(cause)
        supplier = entry(d.name, dictionary).get("supplier_check")
        if supplier:
            if supplier := sentence(supplier):
                engineer.append(f"At the supplier: {supplier}")
    if not top:
        engineer.append("Every key quantity is within the margin of the reference.")

    differences = {d.name: d for d in evidence.differences}
    odds = evidence.odd_images if evidence.unit == "image" else evidence.odd_strips
    for odd in odds[:3]:
        d = differences.get(odd.quantity)
        unit = d.unit if d else entry(odd.quantity, dictionary).get("unit", "")
        subject = f"Image {odd.image_ids[0]}" if evidence.unit == "image" else f"Strip {odd.strip_id}"
        engineer.append(f"{subject} stands out on {label(odd.quantity, dictionary)}: {fmt(odd.value, unit)} "
                        f"against a reference range of {fmt(odd.range[0], unit)} to {fmt(odd.range[1], unit)}.")
    if evidence.imaging.changed:
        engineer.append(f"Imaging changed ({', '.join(evidence.imaging.changed_metrics)}): check the microscope "
                        f"settings before trusting brightness-based quantities.")
    if (evidence.new_type_share is not None
            and any(reason.startswith("Contains a particle type not seen before") for reason in evidence.reasons)):
        engineer.append(f"{evidence.new_type_share:.1%} of the silicon area is a particle type not seen in the reference.")
    engineer.append(f"Next: {evidence.next_action}")

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
    if not evidence.controls.ran:
        scientist.append("Controls not run.")
    elif evidence.controls.passed is True:
        scientist.append("Controls passed.")
    else:
        names = ", ".join(r.name for r in evidence.controls.results if not r.passed)
        scientist.append(f"Controls failed: {names}.")
    scientist.append("Images of one strip are correlated, so the image-level p can be too small; "
                     "the strip view is reported alongside.")

    manager = [f"{evidence.verdict}. {headline}"]
    if top:
        manager.append(f"Main driver: {label(top[0].name, dictionary)}.")
    contradictions = set(evidence.other_unit.contradictions)
    reject_driver = next((d for d in top_quantities(evidence, None)
                          if d.status == "DIFFERENT" and d.name not in contradictions), None)
    if evidence.verdict == "REJECT" and reject_driver is not None:
        p = f"{reject_driver.p:.2g}" if reject_driver.p is not None else "—"
        manager.append(f"The difference is beyond the agreed margin (family-wise p = {p}).")
    elif evidence.verdict == "INVESTIGATE":
        manager.append(f"Not settled yet. {evidence.next_action}")
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

    return Explanations(operator=operator, engineer=" ".join(engineer), scientist=" ".join(scientist),
                        manager=" ".join(manager))
