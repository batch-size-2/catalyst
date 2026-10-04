"""Indicative battery impact of a batch against the baseline (PLAN §3.8, §3.19; docs/APP.md feature 6).

Textbook relations on the batch means of the measured descriptors. The sampling interval comes
from a hierarchical bootstrap (strips, then images within a strip); the constant ranges in
config/impact.yaml (Si vs SiOx, transport exponent) are spanned on top, so every interval is the
widest of its per-constant intervals. Context for people: never an input to the verdict, never
a prediction of cell performance.

Usage: uv run python -m qc.impact --batch Batch_1 [--baseline Batch_3]
"""

import argparse
from collections.abc import Callable
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
import yaml
from pydantic import BaseModel

from qc.schema import KPI_TABLE, OUT_DIR, load_config

IMPACT_CONFIG = Path("config/impact.yaml")
IMPACT_DIR = OUT_DIR / "impact"
INPUTS = {
    "si_area_frac": "fraction", "graphite_area_frac": "fraction", "porosity_apparent": "fraction",
    "si_d32_um": "um", "si_d90_um": "um", "si_internal_void_frac": "fraction",
    "si_agglomerate_frac": "fraction", "si_dispersion_cv": "ratio",
}
LABEL = "Indicative: textbook relations on measured 2D statistics, not a prediction."
WORST_NOTE = ("Worst cases are textbook failure chains, not forecasts: a shift in the anode alone does not make a "
              "cell unsafe. They are what the cell maker's tests should rule out for this lot before it ships.")
SEVERITY = {"performance": 1, "reliability": 2, "safety": 3}

Effect = Literal["better", "worse", "similar", "unsettled"]


class NotMeasured(LookupError):
    """The batch or the baseline has no rows in the KPI table."""

Means = dict[str, np.ndarray]


class Range(BaseModel):
    value: float | None
    low: float | None
    high: float | None


class Input(BaseModel):
    kpi: str
    unit: str
    batch: Range
    baseline: Range


class Fact(BaseModel):
    label: str
    unit: str
    batch: Range
    baseline: Range


class Line(BaseModel):
    name: str
    points: list[tuple[float, float]]
    batch: str | None = None


class Marker(BaseModel):
    batch: str
    x: Range
    y: Range


class Threshold(BaseModel):
    axis: Literal["x", "y"]
    value: float
    label: str


class Curve(BaseModel):
    title: str
    x_label: str
    x_unit: str
    y_label: str
    y_unit: str
    x_log: bool = False
    y_log: bool = False
    lines: list[Line]
    markers: list[Marker]
    thresholds: list[Threshold] = []


class WorstCase(BaseModel):
    headline: str
    severity: Literal["performance", "reliability", "safety"]
    trigger: Literal["likely", "possible"]   # moves the adverse way / the interval can't rule it out
    adverse: float                           # the adverse end of the change interval
    chain: list[str]
    likelihood: str
    prevents: list[str]
    refs: list[str]
    detail: str | None = None


class Impact(BaseModel):
    id: str
    property: str
    measure: str
    unit: str
    higher_is: Literal["better", "worse"]
    effect: Effect
    batch: Range
    baseline: Range
    change: Range
    consequence: str
    mechanism: str
    formula: str
    inputs: list[Input]
    facts: list[Fact]
    assumptions: list[str]
    caveats: list[str]
    refs: list[str]
    curve: Curve | None
    absolute: bool = True            # False: the per-batch values are not meaningful on their own, read the change
    worst_case: WorstCase | None = None


class Scenario(BaseModel):
    cycles: list[int]
    baseline: list[float]
    batch_low: list[float]
    batch_mid: list[float]
    batch_high: list[float]
    fade_scale: Range
    baseline_cycles_to_80: float | None
    cycles_to_80: Range
    assumptions: list[str]


class Report(BaseModel):
    batch: str
    baseline: str
    label: str
    interval: float
    similar_within: float
    n_resamples: int
    n_images: dict[str, int]
    n_strips: dict[str, int]
    composition: dict[str, dict[str, float | None]]
    impacts: list[Impact]
    scenario: Scenario | None    # None when there are too few strips or the inputs are missing
    summary: list[str]
    caveats: list[str]
    references: dict[str, str]
    worst: str | None            # id of the impact with the most severe worst case shown
    worst_note: str


def load_impact_config(path: Path = IMPACT_CONFIG) -> dict:
    return yaml.safe_load(path.read_text())


def read_tables(kpis_csv: Path = KPI_TABLE) -> tuple[pd.DataFrame, pd.DataFrame | None]:
    particles = kpis_csv.with_name("particles.csv")
    return pd.read_csv(kpis_csv), pd.read_csv(particles) if particles.exists() else None


def image_table(kpis: pd.DataFrame, particles: pd.DataFrame | None) -> pd.DataFrame:
    """One row per image with the impact inputs; si_d32_um is NaN where the particle table has no rows."""
    t = kpis.reindex(columns=list(dict.fromkeys(["batch", "image_id", "strip_id", "si_graphite_ratio", "si_d50_um",
                                                  *kpis.columns, *INPUTS])))
    for c in [*INPUTS, "si_graphite_ratio", "si_d50_um"]:
        t[c] = pd.to_numeric(t[c], errors="coerce")
    ratio = t["si_graphite_ratio"]
    t["graphite_area_frac"] = np.where(ratio > 0, t["si_area_frac"] / ratio.where(ratio > 0), np.nan)
    t["si_d32_um"] = np.nan
    if particles is not None and len(particles) and {"batch", "image_id", "d_um"} <= set(particles.columns):
        d = pd.to_numeric(particles["d_um"], errors="coerce")
        border = (particles["border"].astype(str).str.lower().isin(["true", "1"]) if "border" in particles
                  else pd.Series(False, index=particles.index))
        p = particles.assign(d_um=d)[~border & np.isfinite(d) & (d > 0)]
        sums = (p.assign(d3=p["d_um"] ** 3, d2=p["d_um"] ** 2)
                .groupby(["batch", "image_id"])[["d3", "d2"]].sum())
        t = t.drop(columns="si_d32_um").join((sums["d3"] / sums["d2"]).rename("si_d32_um"),
                                             on=["batch", "image_id"])
    return t


def strip_groups(frame: pd.DataFrame) -> list[np.ndarray]:
    strips = frame["strip_id"].astype(object).where(frame["strip_id"].notna(), frame["image_id"])
    strips = strips.astype(str).to_numpy()
    return [np.flatnonzero(strips == s) for s in pd.unique(strips)]


def means(frame: pd.DataFrame, n: int, rng: np.random.Generator) -> tuple[Means, Means]:
    """Point means over images, and n hierarchical-bootstrap means (strips, then images in a strip)."""
    cols = list(INPUTS)
    x = frame[cols].to_numpy(float)
    finite = np.isfinite(x)
    x0 = np.where(finite, x, 0.0)
    groups = strip_groups(frame)
    reps = np.full((n, len(cols)), np.nan)
    for b in range(n):
        idx = np.concatenate([g[rng.integers(len(g), size=len(g))]
                              for g in (groups[i] for i in rng.integers(len(groups), size=len(groups)))])
        w = finite[idx].sum(0)
        reps[b] = np.where(w > 0, x0[idx].sum(0) / np.maximum(w, 1), np.nan)
    with np.errstate(invalid="ignore"):
        point = np.where(finite.sum(0) > 0, x0.sum(0) / np.maximum(finite.sum(0), 1), np.nan)
    return ({c: point[i] for i, c in enumerate(cols)}, {c: reps[:, i] for i, c in enumerate(cols)})


def num(value) -> float | None:
    value = float(value)
    return value if np.isfinite(value) else None


class Calc:
    """Evaluates f(means, constant) for every constant variant, on the point means and the replicates."""

    def __init__(self, point: dict[str, Means], reps: dict[str, Means], batch: str, baseline: str, level: float):
        self.point, self.reps, self.batch, self.baseline = point, reps, batch, baseline
        self.q = ((1 - level) / 2, 1 - (1 - level) / 2)

    def range_of(self, pts: list, reps: list[np.ndarray]) -> Range:
        with np.errstate(all="ignore"):
            pts = np.asarray(pts, float)
            lows = [np.nanquantile(r, self.q[0]) for r in reps if np.isfinite(r).any()]
            highs = [np.nanquantile(r, self.q[1]) for r in reps if np.isfinite(r).any()]
            return Range(value=num(np.nanmean(pts)) if np.isfinite(pts).any() else None,
                         low=num(min(lows)) if lows else None, high=num(max(highs)) if highs else None)

    def side(self, name: str, f: Callable, variants: list) -> tuple[list, list[np.ndarray]]:
        with np.errstate(all="ignore"):
            return ([f(self.point[name], v) for v in variants],
                    [np.asarray(f(self.reps[name], v), float) for v in variants])

    def ranges(self, f: Callable, variants: list | None = None) -> tuple[Range, Range, Range]:
        variants = variants or [None]
        bp, br = self.side(self.batch, f, variants)
        rp, rr = self.side(self.baseline, f, variants)
        with np.errstate(all="ignore"):
            change = self.range_of([b / r - 1 for b, r in zip(bp, rp)], [b / r - 1 for b, r in zip(br, rr)])
        return self.range_of(bp, br), self.range_of(rp, rr), change


def effect_of(change: Range, higher_is: str, tol: float) -> Effect:
    lo, hi = change.low, change.high
    if lo is None or hi is None:
        return "unsettled"
    if -tol < lo and hi < tol:
        return "similar"
    if lo > 0 or hi < 0:
        return "better" if (lo > 0) == (higher_is == "better") else "worse"
    return "unsettled"


def pct(value: float | None) -> str:
    return "—" if value is None else "≈0%" if round(value * 100) == 0 else f"{value:+.0%}".replace("-", "−")


def grid(lo: float, hi: float, n: int = 60, log: bool = False) -> np.ndarray:
    return np.geomspace(lo, hi, n) if log else np.linspace(lo, hi, n)


def line(name: str, xs: np.ndarray, ys: np.ndarray, batch: str | None = None) -> Line:
    return Line(name=name, points=[(float(x), float(y)) for x, y in zip(xs, ys) if np.isfinite(y)], batch=batch)


def impact_report(kpis: pd.DataFrame, particles: pd.DataFrame | None, batch: str, baseline: str,
                  cfg: dict | None = None) -> Report:
    cfg = cfg or load_impact_config()
    table = image_table(kpis, particles)
    for name in (batch, baseline):
        if not (table["batch"] == name).any():
            raise NotMeasured(f"no measured images for {name!r} in the KPI table")
    rng = np.random.default_rng(cfg["seed"])
    n, level, tol = cfg["n_resamples"], cfg["interval"], cfg["similar_within"]
    frames = {name: table[table["batch"] == name].reset_index(drop=True) for name in (batch, baseline)}
    size_source = "particles"
    if any(frame["si_d32_um"].isna().all() for frame in frames.values()):
        size_source = "si_d50_um"
        for frame in frames.values():
            frame["si_d32_um"] = frame["si_d50_um"]
    point, reps = {}, {}
    for name, frame in frames.items():
        point[name], reps[name] = means(frame, n, rng)
    calc = Calc(point, reps, batch, baseline, level)
    n_units = {name: len(strip_groups(frame)) for name, frame in frames.items()}
    too_few = min(n_units.values()) < cfg["min_units"]
    silicon, graphite, spec = cfg["silicon"], cfg["graphite"], cfg["impacts"]
    alphas, crit = cfg["transport_exponent"], cfg["critical_size_um"]
    si_names = " / ".join(s["name"] for s in silicon)

    def share(m: Means) -> np.ndarray:
        return m["si_area_frac"] / (m["si_area_frac"] + m["graphite_area_frac"])

    def weight(m: Means, si: dict) -> np.ndarray:
        s = share(m)
        return s * si["density_g_cm3"] / (s * si["density_g_cm3"] + (1 - s) * graphite["density_g_cm3"])

    def capacity(m: Means, si: dict) -> np.ndarray:
        w = weight(m, si)
        return w * si["capacity_mah_g"] + (1 - w) * graphite["capacity_mah_g"]

    def swelling(m: Means, si: dict) -> np.ndarray:
        return m["si_area_frac"] * si["expansion"] + m["graphite_area_frac"] * graphite["expansion"]

    def inputs(*kpis_used: str) -> list[Input]:
        out = []
        for k in kpis_used:
            b, r, _ = calc.ranges(lambda m, _v, k=k: m[k])
            out.append(Input(kpi=k, unit=INPUTS[k], batch=b, baseline=r))
        return out

    def fact(label: str, unit: str, f: Callable, variants: list | None = None) -> Fact:
        b, r, _ = calc.ranges(f, variants)
        return Fact(label=label, unit=unit, batch=b, baseline=r)

    def marker(name: str, fx: Callable, fy: Callable, variants: list | None = None) -> Marker:
        variants = variants or [None]
        xp, xr = calc.side(name, fx, variants)
        yp, yr = calc.side(name, fy, variants)
        return Marker(batch=name, x=calc.range_of(xp, xr), y=calc.range_of(yp, yr))

    def build(key: str, f: Callable, variants: list | None, formula: str, used: list[str], facts: list[Fact],
              assumptions: list[str], caveats: list[str], curve: Curve | None, absolute: bool = True) -> Impact:
        s = spec[key]
        b, r, change = calc.ranges(f, variants)
        eff = "unsettled" if too_few else effect_of(change, s["higher_is"], tol)
        direction = s["if_higher"] if (change.value or 0) > 0 else s["if_lower"]
        consequence = (f"Within ±{tol:.0%} of {baseline.replace('_', ' ')} on the whole interval: "
                       "no change to expect from this measurement." if eff == "similar" else direction)
        bad = change.high if s["higher_is"] == "worse" else None if change.low is None else -change.low
        trigger = ("likely" if eff == "worse" else "possible"
                   if eff == "unsettled" and bad is not None and bad > tol else None)
        wc = cfg.get("worst_case", {}).get(key)
        return Impact(id=key, property=s["property"], measure=s["measure"], unit=s["unit"],
                      higher_is=s["higher_is"], effect=eff, batch=b, baseline=r, change=change,
                      consequence=consequence, mechanism=s["mechanism"], formula=formula,
                      inputs=inputs(*used), facts=facts, assumptions=assumptions, caveats=caveats,
                      refs=s["refs"], curve=curve, absolute=absolute,
                      worst_case=WorstCase(**wc, trigger=trigger, adverse=bad) if wc and trigger else None)

    markers = lambda fx, fy, v=None: [marker(name, fx, fy, v) for name in (baseline, batch)]
    solid_base = 1 - point[baseline]["porosity_apparent"]
    shares = grid(0, 0.3)
    si_text = "; ".join(f"{s['name']}: {s['capacity_mah_g']:,} mAh/g, +{s['expansion']:.0%} volume, "
                        f"{s['density_g_cm3']} g/cm³" for s in silicon)
    gr_text = (f"Graphite: {graphite['capacity_mah_g']} mAh/g, +{graphite['expansion']:.0%} volume, "
               f"{graphite['density_g_cm3']} g/cm³")
    porosity_caveat = ("Apparent porosity from a 2D section (pore back walls read as solid), "
                       "imaging-sensitive: see the imaging check in Compare first.")
    chemistry_caveat = f"The interval spans an unresolved choice between {si_names}, not only sampling noise."

    impacts = [
        build("capacity", capacity, silicon,
              "Q = w·Q_Si + (1 − w)·Q_graphite, w = silicon weight share of silicon + graphite",
              ["si_area_frac", "graphite_area_frac"],
              [fact("Silicon share of the active material (area ≈ volume)", "fraction", lambda m, _v: share(m)),
               fact("Silicon's share of the capacity", "fraction",
                    lambda m, si: weight(m, si) * si["capacity_mah_g"] / capacity(m, si), silicon)],
              [si_text, gr_text, "Area share in the section = volume share (stereology, isotropic sample)."],
              [chemistry_caveat,
               "Binder and carbon black read as graphite in BSE, so the absolute value is a little high; "
               "the change against the baseline is barely affected.",
               "First-cycle loss (larger for SiOx) and the cathode are not included: this is the anode "
               "material's capacity per gram, not the cell's."],
              Curve(title="Capacity rises steeply with silicon", x_label="Silicon share of active material",
                    x_unit="fraction", y_label="Specific capacity", y_unit="mAh/g",
                    lines=[line(s["name"], shares, capacity({"si_area_frac": shares,
                                                             "graphite_area_frac": 1 - shares}, s))
                           for s in silicon],
                    markers=markers(lambda m, _v: share(m), capacity, silicon),
                    thresholds=[Threshold(axis="y", value=graphite["capacity_mah_g"],
                                          label="Graphite alone")])),
        build("swelling", swelling, silicon, "ΔV / V = φ_Si·e_Si + φ_graphite·e_graphite",
              ["si_area_frac", "graphite_area_frac", "porosity_apparent"],
              [fact("Growth against the pore volume", "ratio",
                    lambda m, si: swelling(m, si) / m["porosity_apparent"], silicon),
               fact("Thickness growth if the pores absorb nothing", "fraction", swelling, silicon),
               fact("Thickness growth if the pores fill first", "fraction",
                    lambda m, si: np.maximum(swelling(m, si) - m["porosity_apparent"], 0), silicon)],
              [si_text, gr_text, "The current collector holds the electrode in-plane, so growth the pores "
               "do not absorb goes into thickness."],
              [chemistry_caveat, porosity_caveat,
               "The 'pores fill first' bound is a limiting case, not an expectation: particles push on their "
               "neighbours from the start, so real electrodes sit between the bounds, nearer the upper one."],
              Curve(title="Silicon dominates the swelling", x_label="Silicon share of active material",
                    x_unit="fraction", y_label="Volume gained at full charge", y_unit="fraction",
                    lines=[line(f"{s['name']} ({baseline.replace('_', ' ')} packing)", shares,
                                swelling({"si_area_frac": shares * solid_base,
                                          "graphite_area_frac": (1 - shares) * solid_base}, s))
                           for s in silicon],
                    markers=markers(lambda m, _v: share(m), swelling, silicon),
                    thresholds=[Threshold(axis="y", value=v, label=f"Pore volume, {name.replace('_', ' ')}")
                                for name in (baseline, batch)
                                if (v := num(point[name]["porosity_apparent"])) is not None])),
        build("transport", lambda m, a: m["porosity_apparent"] ** a, alphas, "D_eff / D = ε^α (Bruggeman)",
              ["porosity_apparent"],
              [],
              [f"Exponent α from {alphas[0]} (spheres, Bruggeman) to {alphas[1]} (aligned flakes, through-plane)."],
              [porosity_caveat, "Apparent porosity here (about 10%) is well below a typical calendered anode "
               "(around 30%), so the absolute transport is not meaningful; read the change against the baseline.",
               "The change holds only if both batches are under-counted by the same factor; a segmentation "
               "shift between them corrupts it too.",
               "At full charge the swelling silicon narrows the pores further; not included."],
              Curve(title="Fewer pores, much slower ions", x_label="Porosity", x_unit="fraction",
                    y_label="Effective transport (vs free electrolyte)", y_unit="fraction",
                    lines=[line(f"α = {a}", grid(0.02, 0.45), grid(0.02, 0.45) ** a) for a in alphas],
                    markers=markers(lambda m, _v: m["porosity_apparent"], lambda m, a: m["porosity_apparent"] ** a,
                                    alphas)), absolute=False),
        build("sei", lambda m, _v: 6 * m["si_area_frac"] / m["si_d32_um"], None, "S_Si = 6·φ_Si / D32",
              ["si_area_frac", "si_d32_um"],
              [],
              ["Spheres: surface per volume = 6 / D32 (Sauter diameter)."
               + (" D32 from the particle table, edge particles left out." if size_source == "particles"
                  else " No particle table: the median size D50 stands in for D32; D50 is larger than D32 "
                  "for a broad size spread, so the surface is lower still.")],
              ["Smooth spheres of the resolved particles: a lower bound. Real (BET) surface is far higher "
               "from roughness, internal pores and fines below the image resolution, so read the change, "
               "not the value.",
               "Section diameters underestimate 3D diameters; the bias is the same in both batches only if "
               "the size spreads have the same shape.",
               "Graphite carries SEI too and is not counted: this is the silicon part only.",
               "Cracking adds fresh surface over life (see Particle cracking); not included here."],
              Curve(title="Finer silicon, more SEI surface", x_label="Silicon particle size (D32)", x_unit="um",
                    y_label="Silicon surface per electrode volume", y_unit="m²/cm³", x_log=True, y_log=True,
                    lines=[line(f"{100 * point[name]['si_area_frac']:.1f}% silicon ({name.replace('_', ' ')})",
                                grid(0.05, 20, log=True),
                                6 * point[name]["si_area_frac"] / grid(0.05, 20, log=True), name)
                           for name in (baseline, batch)],
                    markers=markers(lambda m, _v: m["si_d32_um"],
                                    lambda m, _v: 6 * m["si_area_frac"] / m["si_d32_um"])), absolute=False),
        build("cracking", lambda m, _v: m["si_d90_um"], None, "G ∝ σ²·d / E, so G / G_c ≈ d / d_c",
              ["si_d90_um", "si_internal_void_frac"],
              [fact("D90 against the crystalline critical size (far above in both: cracking expected)", "ratio",
                    lambda m, _v: m["si_d90_um"] / crit["crystalline"]),
               fact("Share of the silicon expansion the internal voids can absorb", "fraction",
                    lambda m, si: m["si_internal_void_frac"] / (si["expansion"] / (1 + si["expansion"])), silicon)],
              [f"Critical diameters: {crit['crystalline']} µm crystalline, {crit['amorphous']} µm amorphous "
               "(in-situ TEM, single particles).", "Same lithiation strain for every size, so the crack "
               "driving force scales with particle size."],
              ["Both batches' silicon is far above the critical sizes, so dense silicon in either batch is "
               "expected to crack; size scales how hard it is driven, not whether.",
               "SiOx and porous or composite silicon crack less than dense silicon of the same size.",
               "Above the critical size every particle is expected to crack; a larger D90 means earlier and "
               "harder cracking, not a proportionally worse outcome.",
               "Section diameters under-represent the largest 3D particles, so D90 here is biased low."],
              Curve(title="Above a critical size, silicon cracks", x_label="Silicon particle size",
                    x_unit="um", y_label="Crack driving force against the threshold", y_unit="ratio",
                    x_log=True, y_log=True,
                    lines=[line(f"{kind.capitalize()} silicon", grid(0.05, 20, log=True),
                                grid(0.05, 20, log=True) / d) for kind, d in crit.items()],
                    markers=markers(lambda m, _v: m["si_d90_um"],
                                    lambda m, _v: m["si_d90_um"] / crit["crystalline"]),
                    thresholds=[Threshold(axis="x", value=d, label=f"{kind.capitalize()} critical size")
                                for kind, d in crit.items()]
                    + [Threshold(axis="y", value=1, label="Cracks above this line")])),
        build("agglomeration", lambda m, _v: m["si_agglomerate_frac"], None,
              "Measured directly: share of silicon area in Si-rich domains > ~5 µm",
              ["si_agglomerate_frac", "si_dispersion_cv"],
              [], ["Direction only: there is no textbook formula from clump share to cell performance."],
              ["2D sections can join or split clumps; batch-level means hide single clumped strips "
               "(see Compare's odd tiles)."],
              None),
    ]

    capacity_impact = impacts[0]
    if capacity_impact.worst_case and (np_design := cfg.get("np_design")):
        ends = []
        for si in silicon:
            c = calc.ranges(capacity, [si])[2]
            if None not in (c.value, c.low, c.high):
                ends.append(f"{np_design * (1 + c.value):.2f} ({np_design * (1 + c.low):.2f} to "
                            f"{np_design * (1 + c.high):.2f}) if {si['name']}")
        if ends:
            capacity_impact.worst_case.detail = (
                f"If the cell was balanced at N/P {np_design:.2f} for {baseline.replace('_', ' ')}, this lot brings it "
                f"to {'; '.join(ends)}. Below 1.00 the anode overfills at full charge.")
    shown = [i for i in impacts if i.worst_case]
    worst = max(shown, key=lambda i: (i.worst_case.trigger == "likely", SEVERITY[i.worst_case.severity],
                                      i.worst_case.adverse), default=None)

    sc = cfg["scenario"]
    k_base = (1 - sc["baseline_retention"]) / np.sqrt(sc["at_cycles"])
    f_lo, f_hi = sc["silicon_share_of_fade"]
    surface = lambda m: 6 * m["si_area_frac"] / m["si_d32_um"]
    crack = lambda m: m["si_area_frac"] * m["si_d90_um"]
    with np.errstate(all="ignore"):
        r_pts = [float(f(point[batch]) / f(point[baseline])) for f in (surface, crack)]
        r_reps = [f(reps[batch]) / f(reps[baseline]) for f in (surface, crack)]
    finite = lambda a: a[np.isfinite(a)]
    lo_reps, hi_reps = finite(np.fmin(*r_reps)), finite(np.fmax(*r_reps))
    r_mid = float(np.nanmean(r_pts)) if np.isfinite(r_pts).any() else np.nan
    r_low = float(np.quantile(lo_reps, calc.q[0])) if len(lo_reps) else np.nan
    r_high = float(np.quantile(hi_reps, calc.q[1])) if len(hi_reps) else np.nan
    scale = lambda r, f: 1 + f * (r - 1)
    scales = [scale(r, f) for r in (r_low, r_high) for f in (f_lo, f_hi)]
    k_mid, k_low, k_high = k_base * scale(r_mid, (f_lo + f_hi) / 2), k_base * min(scales), k_base * max(scales)
    cycles = np.linspace(0, sc["max_cycles"], 41).round().astype(int)
    retention = lambda k: [float(np.clip(1 - k * np.sqrt(c), 0, 1)) for c in cycles]
    to80 = lambda k: num((0.2 / k) ** 2) if k > 0 else None
    scenario = None if too_few or not np.isfinite([r_mid, r_low, r_high]).all() else Scenario(
        cycles=cycles.tolist(), baseline=retention(k_base), batch_low=retention(k_high),
        batch_mid=retention(k_mid), batch_high=retention(k_low),
        fade_scale=Range(value=num(k_mid / k_base), low=num(k_low / k_base), high=num(k_high / k_base)),
        baseline_cycles_to_80=to80(k_base),
        cycles_to_80=Range(value=to80(k_mid), low=to80(k_high), high=to80(k_low)),
        assumptions=[
            f"{baseline.replace('_', ' ')} is assumed to keep {sc['baseline_retention']:.0%} after "
            f"{sc['at_cycles']} cycles: an anchor for the picture, not a measurement. Only the fade-rate "
            "ratio carries information.",
            "Fade grows with √cycles (SEI-limited growth, a textbook law).",
            f"Our modelling choice, not a textbook law: silicon causes {f_lo:.0%} to {f_hi:.0%} of the fade, "
            "and that part scales with the silicon surface (SEI) or with silicon amount × coarse size "
            "(cracking), whichever gives the wider range.",
            "Not included: lithium plating, cathode wear, electrolyte dry-out, temperature, cycling protocol.",
        ])

    groups: dict[str, list[str]] = {}
    for imp in impacts:
        groups.setdefault(imp.effect, []).append(
            f"{imp.property} ({pct(imp.change.low)} to {pct(imp.change.high)})")
    words = {"better": "Better for the cell in these images", "worse": "Worse for the cell in these images",
             "unsettled": "Not settled by these images", "similar": "About the same"}
    r_label = baseline.replace("_", " ")
    summary = [f"{words[e]}: {', '.join(groups[e])}." for e in words if e in groups]
    if scenario and scenario.fade_scale.low is not None and scenario.fade_scale.high is not None:
        summary.append(f"Wear scenario: fade rate {scenario.fade_scale.low:.2g}–"
                       f"{scenario.fade_scale.high:.2g}× {r_label}'s.")
    strips = sorted(set(n_units.values()))

    def composition(name: str) -> dict[str, float | None]:
        m = point[name]
        parts = {"silicon": m["si_area_frac"], "graphite": m["graphite_area_frac"], "pores": m["porosity_apparent"]}
        parts["other"] = max(0.0, 1 - sum(v for v in parts.values() if np.isfinite(v)))
        return {k: num(v) for k, v in parts.items()}

    return Report(
        batch=batch, baseline=baseline, label=LABEL, interval=level, similar_within=tol, n_resamples=n,
        n_images={k: len(v) for k, v in frames.items()},
        n_strips=n_units,
        composition={name: composition(name) for name in (baseline, batch)},
        impacts=impacts, scenario=scenario, summary=summary,
        caveats=[
            f"Silicon chemistry not confirmed, so every silicon number spans {si_names}.",
            "2D sections only: 3D connectivity, electrode thickness and loading are not measured.",
            "No electrochemical data to check against: these are the directions and rough sizes "
            "textbook relations give, for people to weigh.",
            f"Intervals: {level:.0%}, hierarchical bootstrap over strips then images ({n} resamples), "
            f"widened to span the constant ranges. With {' to '.join(map(str, strips))} strips a percentile "
            "bootstrap tends to be too narrow.",
            "The intervals hold sampling noise only. Segmentation, stereology and porosity biases are not in "
            "them and can be larger, so 'better' or 'worse' means 'in these images', not 'proven'.",
        ] + ([f"Fewer than {cfg['min_units']} strips in a batch: the bootstrap interval is too narrow to "
              "trust, so every effect reads 'not settled'."] if too_few else []),
        references=cfg["references"],
        worst=worst.id if worst else None,
        worst_note=WORST_NOTE,
    )


def impact_path(batch: str, baseline: str) -> Path:
    return IMPACT_DIR / baseline / f"{batch}.json"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Indicative battery impact of a batch against the baseline.")
    parser.add_argument("--batch", required=True)
    parser.add_argument("--baseline", default=None)
    parser.add_argument("--kpis", type=Path, default=KPI_TABLE)
    args = parser.parse_args()
    baseline = args.baseline or load_config()["baseline"]
    report = impact_report(*read_tables(args.kpis), args.batch, baseline)
    path = impact_path(args.batch, baseline)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(report.model_dump_json(indent=2))
    print("\n".join(report.summary))
    print(f"wrote {path}")
