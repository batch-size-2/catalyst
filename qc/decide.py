"""Backend side: KPI tables -> verdict. Owned by the backend engineer (PLAN_v3 §3.5).

Usage (no images needed): uv run python -m qc.decide tests/fixtures/kpis_fake.csv --baseline fake_baseline
"""

import argparse
import itertools
from math import comb
from pathlib import Path
from typing import NamedTuple

import numpy as np
import pandas as pd
from scipy.stats import t

from qc.explain import explain, load_dictionary
from qc.provenance import provenance
from qc.schema import (
    IMAGING_COLUMNS, KPI_TABLE, KPI_UNITS, PARTICLE_COLUMNS, Controls, Descriptor, Difference, Evidence,
    Fingerprint, ImagingCheck, Odd, Power, Segment, Status, Tables, Unit, UnitView, evidence_path, load_config,
)

NON_QUANTITY = {"batch", "image_id", "strip_id", "px_um", "area_um2"}
T_CLIP = 1e12


def num(value) -> float | None:
    return None if value is None or pd.isna(value) else float(value)


def sig(value: float | None) -> str:
    return "—" if value is None else f"{value:.3g}"


def split_tables(kpis: pd.DataFrame, particles: pd.DataFrame | None = None,
                 imaging: pd.DataFrame | None = None) -> dict[str, Tables]:
    """One Tables per batch; missing tables become empty frames with the schema columns."""
    particles = pd.DataFrame(columns=PARTICLE_COLUMNS) if particles is None else particles
    imaging = pd.DataFrame(columns=IMAGING_COLUMNS) if imaging is None else imaging
    batches = dict.fromkeys(b for frame in (kpis, particles, imaging) for b in frame["batch"])
    take = lambda frame, name: frame[frame["batch"] == name].reset_index(drop=True)
    return {str(name): Tables(kpis=take(kpis, name), particles=take(particles, name),
                              imaging=take(imaging, name)) for name in batches}


def read_tables(kpis_csv: Path) -> dict[str, Tables]:
    """Read a KPI table and optional particles/imaging sidecars beside it."""
    files = {path.name: path for path in sidecars(kpis_csv)}
    return split_tables(pd.read_csv(kpis_csv),
                        pd.read_csv(files["particles.csv"]) if "particles.csv" in files else None,
                        pd.read_csv(files["imaging.csv"]) if "imaging.csv" in files else None)


def sidecars(kpis_csv: Path) -> list[Path]:
    return [path for path in (kpis_csv.with_name("particles.csv"), kpis_csv.with_name("imaging.csv"))
            if path.exists()]


def typed_particles(particles: pd.DataFrame) -> pd.DataFrame:
    """Keep typed particles with finite numeric area."""
    columns = ["image_id", "type", "area_um2"]
    if not set(columns) <= set(particles.columns):
        return pd.DataFrame(columns=columns)
    typed = particles[columns].copy().reset_index(drop=True)
    typed["area_um2"] = pd.to_numeric(typed["area_um2"], errors="coerce")
    typed = typed.loc[typed["type"].notna() & np.isfinite(typed["area_um2"])].copy()
    if typed.empty:
        return typed
    typed["type"] = typed["type"].astype(str)
    return typed


def type_share_table(particles: pd.DataFrame) -> pd.DataFrame:
    """Per-image area shares over typed particles with finite area."""
    typed = typed_particles(particles)
    if typed.empty:
        return pd.DataFrame(columns=["image_id"])
    area = typed.pivot_table(index="image_id", columns="type", values="area_um2",
                             aggfunc="sum", fill_value=0.0)
    total = area.sum(axis=1)
    shares = area.div(total.where(total > 0), axis=0).fillna(0.0)
    out = shares.drop(columns="unassigned", errors="ignore").add_prefix("type_share:")
    out["unassigned_share"] = shares["unassigned"] if "unassigned" in shares else 0.0
    return out.reset_index().rename_axis(columns=None)


def new_type_share(particles: pd.DataFrame) -> float | None:
    """Pooled unassigned share over typed particles with finite area."""
    typed = typed_particles(particles)
    total = typed["area_um2"].sum() if len(typed) else 0.0
    return (float(typed.loc[typed["type"] == "unassigned", "area_um2"].sum() / total)
            if total > 0 else None)


def imaging_check(ref_imaging: pd.DataFrame, batch_imaging: pd.DataFrame, cfg: dict) -> ImagingCheck:
    """Compare each channel and metric with the non-outlier baseline range."""
    if ref_imaging.empty or batch_imaging.empty:
        return ImagingCheck()
    outliers = set()
    if {"image_id", "channel", "black_level"} <= set(ref_imaging.columns):
        medians = ref_imaging.groupby("channel")["black_level"].median()
        threshold = cfg["imaging_black_outlier"]
        for row in ref_imaging.dropna(subset=["black_level"]).itertuples():
            if row.channel in medians and abs(row.black_level - medians[row.channel]) > threshold:
                outliers.add(str(row.image_id))
    baseline = ref_imaging[~ref_imaging["image_id"].isin(outliers)]
    changed = set()
    metric_pad = cfg["imaging_min_pad"]
    for channel, rows in baseline.groupby("channel"):
        batch_rows = batch_imaging[batch_imaging["channel"] == channel]
        for metric in IMAGING_COLUMNS[4:]:
            if metric not in rows or metric not in batch_rows:
                continue
            values = pd.to_numeric(rows[metric], errors="coerce").dropna()
            if len(values) < 2:
                continue
            low, high = float(values.min()), float(values.max())
            pad = max(cfg["imaging_widen"] * (high - low), metric_pad.get(metric, 0))
            batch_values = pd.to_numeric(batch_rows[metric], errors="coerce").dropna()
            if ((batch_values < low - pad) | (batch_values > high + pad)).any():
                changed.add(f"{channel}.{metric}")
    curtained = set()
    curtain_limit = cfg["curtaining_max"]
    if curtain_limit is not None:
        for frame in (ref_imaging, batch_imaging):
            if {"image_id", "channel", "curtaining_index"} <= set(frame.columns):
                images = frame.loc[(frame["channel"] == "BSE")
                                   & (frame["curtaining_index"] > curtain_limit), "image_id"]
                curtained.update(str(image_id) for image_id in images.dropna())
    return ImagingCheck(changed=bool(changed), changed_metrics=sorted(changed),
                        outliers_in_reference=sorted(outliers), curtained_images=sorted(curtained))


def evaluate(tables: dict[str, Tables], batch: str, cfg: dict, controls: Controls | None = None) -> Evidence:
    return compare(tables[cfg["baseline"]], tables[batch], cfg, controls)


def min_achievable_p(n1: int, n2: int) -> float:
    """Smallest p a label-shuffle test can reach: 2/N for equal counts (mirror arrangements tie), else 1/N."""
    return min(1.0, (2 if n1 == n2 else 1) / comb(n1 + n2, n1))


def power(n1: int, n2: int, alpha: float) -> Power:
    """How far a label-shuffle test on n1 vs n2 units can go (PLAN_v3 §3.5)."""
    min_p = min_achievable_p(n1, n2)
    limited = min_p >= alpha
    extra = 0 if not limited else next(
        (m for m in range(1, 21) if min_achievable_p(n1 + m, n2) < alpha), None)
    return Power(n_segments=(n1, n2), n_arrangements=comb(n1 + n2, n1), min_p=min_p,
                 limited=limited, extra_needed=extra)


def segments_of(kpis: pd.DataFrame, batch: str, quantities: list[str], unit: Unit) -> list[Segment]:
    """Build the comparison units; strip values are area-weighted means over their images."""
    if kpis.empty:
        return []
    df = kpis.assign(strip_id=kpis["strip_id"].fillna(kpis["image_id"]))
    segments = []
    group_by = "strip_id" if unit == "strip" else "image_id"
    for _, group in df.groupby(group_by):
        area = group["area_um2"] if "area_um2" in group else pd.Series(np.nan, index=group.index)
        weights = area.where(area.notna() & (area > 0), 1.0)
        values = {}
        for q in quantities:
            col = group[q] if q in group else pd.Series(np.nan, index=group.index, dtype=float)
            have = col.notna()
            values[q] = float(np.average(col[have], weights=weights[have])) if have.any() else None
        segments.append(Segment(batch=batch, strip_id=str(group["strip_id"].iloc[0]),
                                image_ids=[str(i) for i in group["image_id"]],
                                area_um2=num(area.sum(min_count=1)), values=values))
    return segments


class Stats(NamedTuple):
    diff: float | None
    interval: tuple[float, float] | None
    T: float | None                     # observed two-sample t statistic
    sp: float | None                    # pooled SD of the segment values
    n: tuple[int, int]                  # (batch, reference) values


def t_stats(batch_values: list[float], ref_values: list[float], ci_level: float) -> Stats:
    """Pooled two-sample stats over segment values; None-safe below df = 1."""
    n1, n2 = len(batch_values), len(ref_values)
    if n1 == 0 or n2 == 0:
        return Stats(None, None, None, None, (n1, n2))
    b, r = np.asarray(batch_values, float), np.asarray(ref_values, float)
    diff = float(b.mean() - r.mean())
    df = n1 + n2 - 2
    if df < 1:
        return Stats(diff, None, 0.0, None, (n1, n2))
    ss = float(((b - b.mean()) ** 2).sum() + ((r - r.mean()) ** 2).sum())
    sp = float(np.sqrt(ss / df))
    se = sp * float(np.sqrt(1 / n1 + 1 / n2))
    if se == 0:
        T = 0.0 if diff == 0 else float(np.sign(diff) * T_CLIP)
    else:
        T = float(np.clip(diff / se, -T_CLIP, T_CLIP))
    half = float(t.ppf((1 + ci_level) / 2, df)) * se
    interval = (float(diff - half), float(diff + half)) if np.isfinite(half) else None
    return Stats(diff, interval, T, sp, (n1, n2))


def permutation_p(units: list[Segment], n1: int, keys: list[str], cfg: dict) -> dict[str, float]:
    """Family-wise max-|T| p per used key quantity (single-step Westfall-Young).

    units: batch segments first (n1), then reference. Enumerates all arrangements when
    C(n, n1) <= n_resamples (the observed one included), else n_resamples seeded draws.
    """
    n = len(units)
    if not keys or n1 < 1 or n1 >= n:
        return {}
    if comb(n, n1) <= cfg["n_resamples"]:
        membership = np.array([[i in c for i in range(n)]
                               for c in itertools.combinations(range(n), n1)])
        exact = True
    else:
        rng = np.random.default_rng(cfg["seed"])
        membership = np.zeros((cfg["n_resamples"], n), dtype=bool)
        for row in range(cfg["n_resamples"]):
            membership[row, rng.choice(n, size=n1, replace=False)] = True
        exact = False

    V = np.array([[np.nan if (v := s.values.get(q)) is None else v for s in units] for q in keys])
    mask, X = np.isfinite(V), np.where(np.isfinite(V), V, 0.0)
    A = membership.astype(float)
    n1q = (A @ mask.T).T                                # (Q, R) valued units in the batch slot
    s1, sq1 = (A @ X.T).T, (A @ (X * X).T).T
    n2q = mask.sum(1)[:, None] - n1q
    s2, sq2 = X.sum(1)[:, None] - s1, (X * X).sum(1)[:, None] - sq1
    m1 = np.divide(s1, n1q, out=np.zeros_like(s1), where=n1q > 0)
    m2 = np.divide(s2, n2q, out=np.zeros_like(s2), where=n2q > 0)
    ss = np.maximum(sq1 - s1 * m1 + sq2 - s2 * m2, 0.0)  # n = 0 slots contribute 0
    df = n1q + n2q - 2
    with np.errstate(divide="ignore", invalid="ignore"):
        se = np.sqrt(ss / df) * np.sqrt(1.0 / n1q + 1.0 / n2q)
    diff = m1 - m2
    T = np.where((df >= 1) & (se > 0), diff / np.where(se > 0, se, 1.0),
                 np.where((df >= 1) & (diff != 0), np.sign(diff) * T_CLIP, 0.0))
    M = np.abs(np.clip(T, -T_CLIP, T_CLIP)).max(axis=0)  # (R,) max over quantities

    p = {}
    for i, q in enumerate(keys):
        obs = abs(t_stats([v for s in units[:n1] if (v := s.values.get(q)) is not None],
                          [v for s in units[n1:] if (v := s.values.get(q)) is not None],
                          cfg["ci_level"]).T or 0.0)
        hits = int((M >= obs - 1e-9 * max(1.0, obs)).sum())
        p[q] = hits / len(M) if exact else (1 + hits) / (1 + cfg["n_resamples"])
    return p


def analyze(ref_segs: list[Segment], batch_segs: list[Segment], cfg: dict,
            quantities: list[str], margins: dict[str, float | None], keys: set[str],
            unusable: dict[str, str],
            ) -> tuple[list[Difference], dict[str, Stats], Power]:
    """Steps A-C at one unit: per-quantity t-stats, family-wise p, status."""
    stats = {q: t_stats(values_of(batch_segs, q), values_of(ref_segs, q), cfg["ci_level"])
             for q in quantities}
    used_keys = [q for q in quantities if q in keys and q not in unusable and stats[q].diff is not None]
    units = ([s for s in batch_segs if has_value(s, used_keys)]
             + [s for s in ref_segs if has_value(s, used_keys)])
    n1 = len([s for s in batch_segs if has_value(s, used_keys)])
    p = permutation_p(units, n1, used_keys, cfg)

    differences = []
    for q in quantities:
        st, margin = stats[q], margins[q]
        is_key = q in keys
        used = is_key and q not in unusable and st.diff is not None
        note = ("not measured" if st.diff is None else unusable.get(q)) if is_key else None
        lo, hi = st.interval or (None, None)
        status = "UNCLEAR"
        if used:
            pq = p.get(q)
            if pq is not None and pq < cfg["alpha"] and margin is not None and abs(st.diff) > margin:
                status = "DIFFERENT"
            elif st.interval and margin is not None and -margin < lo < hi < margin:
                status = "SIMILAR"
        elif st.interval and margin is not None:
            if lo > margin or hi < -margin:
                status = "DIFFERENT"
            elif -margin < lo < hi < margin:
                status = "SIMILAR"
        differences.append(Difference(
            name=q, unit=unit_of(q), key=is_key, used=used,
            note=note,
            reference=num(np.mean(values_of(ref_segs, q))) if values_of(ref_segs, q) else None,
            batch=num(np.mean(values_of(batch_segs, q))) if values_of(batch_segs, q) else None,
            difference=st.diff, interval=st.interval, margin=num(margin),
            p=p.get(q) if used else None, status=status, n_segments=st.n))
    differences.sort(key=lambda d: 0 if d.used else 1 if d.key else 2)
    return differences, stats, power(n1, len(units) - n1, cfg["alpha"])


def values_of(segs: list[Segment], q: str) -> list[float]:
    return [s.values[q] for s in segs if s.values.get(q) is not None]


def unit_of(q: str) -> str:
    unit = KPI_UNITS.get(q)
    if unit is not None:
        return unit
    return "fraction" if q.startswith("type_share:") or q == "unassigned_share" else ""


def has_value(seg: Segment, keys: list[str]) -> bool:
    if keys:
        return any(seg.values.get(q) is not None for q in keys)
    return any(v is not None for v in seg.values.values())


def contradictions(driving: dict[str, Status], other: dict[str, Status]) -> list[str]:
    """Used key quantities that are DIFFERENT at one unit and SIMILAR at the other."""
    return [q for q in driving if q in other and {driving[q], other[q]} == {"DIFFERENT", "SIMILAR"}]


def odd_units(batch_segs: list[Segment], ref_segs: list[Segment], used_keys: list[str],
              cfg: dict) -> list[Odd]:
    """Batch units outside baseline mean ± odd_sd x SD of baseline values at that unit."""
    k = cfg.get("odd_sd")
    if k is None:
        return []
    out = []
    for q in used_keys:
        ref_vals = values_of(ref_segs, q)
        if len(ref_vals) < 3:
            continue
        mean, sd = float(np.mean(ref_vals)), float(np.std(ref_vals, ddof=1))
        for seg in batch_segs:
            value = seg.values.get(q)
            if value is not None and not mean - k * sd <= value <= mean + k * sd:
                out.append(Odd(strip_id=seg.strip_id, image_ids=seg.image_ids, quantity=q,
                               value=value, range=(mean - k * sd, mean + k * sd)))
    return out


def units_to_settle(diff: float, sp: float, n1q: int, n2q: int, margin: float,
                    ci_level: float) -> int | None:
    """Extra batch units for the interval (keeping diff and sp) to lie inside or outside ±margin."""
    for m in range(1, 21):
        df = n1q + m + n2q - 2
        half = float(t.ppf((1 + ci_level) / 2, df)) * sp * float(np.sqrt(1 / (n1q + m) + 1 / n2q))
        lo, hi = diff - half, diff + half
        if (-margin < lo < hi < margin) or lo > margin or hi < -margin:
            return m
    return None


def compare(ref: Tables, batch: Tables, cfg: dict, controls: Controls | None = None) -> Evidence:
    """Compare batch and reference at the configured unit, with the other unit alongside."""
    controls = controls or Controls()
    excluded = cfg.get("reference_exclude") or []
    ref_kpis = ref.kpis[~ref.kpis["image_id"].isin(excluded)].copy()
    ref_particles = ref.particles[~ref.particles["image_id"].isin(excluded)].copy()
    ref_imaging = ref.imaging[~ref.imaging["image_id"].isin(excluded)].copy()
    batch_kpis = batch.kpis.copy()
    batch_name = str(batch_kpis["batch"].iloc[0]) if len(batch_kpis) else "?"

    imaging = imaging_check(ref_imaging, batch.imaging, cfg)
    curtained = set(imaging.curtained_images)
    for frame in (ref_kpis, batch_kpis):
        for q in cfg["curtaining_sensitive"]:
            if q in frame:
                frame.loc[frame["image_id"].isin(curtained), q] = np.nan

    ref_kpis = ref_kpis.merge(type_share_table(ref_particles), on="image_id", how="left")
    batch_kpis = batch_kpis.merge(type_share_table(batch.particles), on="image_id", how="left")
    batch_new_type_share = new_type_share(batch.particles)

    type_share_quantities = sorted({
        q for frame in (ref_kpis, batch_kpis) for q in frame.columns if q.startswith("type_share:")
    })
    key_descriptors = list(cfg.get("key_descriptors", []))
    keys = set(key_descriptors)
    if cfg.get("key_type_shares", False):
        keys.update(type_share_quantities)
    unusable = ({q: "imaging changed" for q in cfg.get("imaging_sensitive", [])}
                if imaging.changed else {})

    others = [c for c in dict.fromkeys([*ref_kpis.columns, *batch_kpis.columns])
              if c not in NON_QUANTITY
              and any(c in f.columns and pd.api.types.is_numeric_dtype(f[c]) for f in (ref_kpis, batch_kpis))]
    quantities = list(dict.fromkeys([*key_descriptors, *type_share_quantities, *KPI_UNITS, *others]))

    unit = cfg.get("unit", "image")
    other = {"image": "strip", "strip": "image"}[unit]
    ref_image = segments_of(ref_kpis, cfg["baseline"], quantities, "image")
    batch_image = segments_of(batch_kpis, batch_name, quantities, "image")
    ref_strip = segments_of(ref_kpis, cfg["baseline"], quantities, "strip")
    batch_strip = segments_of(batch_kpis, batch_name, quantities, "strip")
    ref_drive, batch_drive = (ref_image, batch_image) if unit == "image" else (ref_strip, batch_strip)
    ref_other, batch_other = (ref_strip, batch_strip) if unit == "image" else (ref_image, batch_image)

    margins = {}
    for q in quantities:
        ref_vals = values_of(ref_image, q)
        margin = (cfg.get("margins") or {}).get(q)
        margins[q] = margin if margin is not None else (
            cfg["similar_margin"] * float(np.std(ref_vals, ddof=1)) if len(ref_vals) >= 2 else None)

    differences, stats, pow_ = analyze(ref_drive, batch_drive, cfg, quantities, margins, keys, unusable)
    drivers = [d.name for d in sorted(
        (d for d in differences if d.used and d.difference is not None and d.margin),
        key=lambda d: -abs(d.difference / d.margin))]

    driving_status = {d.name: d.status for d in differences if d.used}
    other_diffs, _, other_power = analyze(ref_other, batch_other, cfg, quantities, margins, keys, unusable)
    other_status = {d.name: d.status for d in other_diffs if d.used}
    contra = contradictions(driving_status, other_status)
    odd_images = odd_units(batch_image, ref_image, list(driving_status), cfg)
    odd_strips = odd_units(batch_strip, ref_strip, list(driving_status), cfg)
    odds = odd_images if unit == "image" else odd_strips

    verdict, reasons, next_action = verdict_of(differences, drivers, other_status, contra,
                                               odds, pow_, unit, imaging, controls,
                                               batch_new_type_share, stats, cfg)

    def describe(q: str, name: str | None = None) -> Descriptor:
        vals = values_of(batch_drive, q)
        interval = None
        if len(vals) >= 2:
            half = float(t.ppf((1 + cfg["ci_level"]) / 2, len(vals) - 1)) \
                * float(np.std(vals, ddof=1)) / float(np.sqrt(len(vals)))
            interval = (float(np.mean(vals) - half), float(np.mean(vals) + half))
        return Descriptor(name=name or q, unit=unit_of(q),
                          value=num(np.mean(vals)) if vals else None, interval=interval,
                          by_strip={s.strip_id: s.values.get(q) for s in batch_strip})

    return Evidence(
        batch=batch_name, baseline=cfg["baseline"], verdict=verdict, reasons=reasons,
        next_action=next_action, unit=unit, differences=differences, drivers=drivers, power=pow_,
        other_unit=UnitView(unit=other, power=other_power, statuses=other_status, contradictions=contra),
        odd_images=odd_images, odd_strips=odd_strips,
        new_type_share=batch_new_type_share, imaging=imaging, controls=controls,
        fingerprint=Fingerprint(segments=batch_strip,
                                descriptors=[describe(q) for q in quantities
                                             if q not in type_share_quantities],
                                type_shares=[describe(q, q.removeprefix("type_share:"))
                                             for q in type_share_quantities]),
        n_images={"batch": len(batch_kpis), "baseline": len(ref_kpis)},
        config_version=cfg["version"])


def verdict_of(differences: list[Difference], drivers: list[str], other: dict[str, Status],
               contra: list[str], odds: list[Odd], pow_: Power, unit: Unit,
               imaging: ImagingCheck, controls: Controls, new_type_share: float | None,
               stats: dict[str, Stats], cfg: dict) -> tuple[str, list[str], str]:
    """Verdict, reasons in precedence order, and next action from the first trigger."""
    failed = controls.ran and controls.passed is False
    failed_names = ", ".join(r.name for r in controls.results if not r.passed)
    new_type = new_type_share is not None and new_type_share > cfg["new_type_share"]
    different = [d for d in differences if d.used and d.status == "DIFFERENT" and d.name not in contra]
    unclear = [d for d in differences if d.used and d.status == "UNCLEAR"]
    no_used = not any(d.used for d in differences)
    ci_pct = f"{cfg['ci_level']:.0%}"
    noun = "images" if unit == "image" else "strips"
    driving = {d.name: d.status for d in differences if d.used}

    reasons = []
    if failed:
        reasons.append(f"Controls failed ({failed_names}): the method is not validated on this data.")
    if new_type:
        reason = f"Contains a particle type not seen before: {new_type_share:.3%} of the silicon area."
        reasons.append(reason + (" Imaging changed, so check the imaging first." if imaging.changed else ""))
    for d in different:
        quantity_unit = f" {d.unit}" if d.unit else ""
        reasons.append(f"{d.name} differs from the reference: {sig(d.batch)} vs {sig(d.reference)}{quantity_unit} "
                       f"(difference {sig(d.difference)}, margin ±{sig(d.margin)}, p = {sig(d.p)}).")
    if imaging.changed:
        reasons.append(f"Imaging changed ({', '.join(imaging.changed_metrics)}): "
                       f"{', '.join(cfg['imaging_sensitive'])} reported, not used.")
    for o in odds:
        if unit == "image":
            reasons.append(f"Image {o.image_ids[0]} (strip {o.strip_id}) is outside the reference range "
                           f"on {o.quantity}: {sig(o.value)} vs {sig(o.range[0])}–{sig(o.range[1])}.")
        else:
            reasons.append(f"Strip {o.strip_id} ({len(o.image_ids)} images) is outside the reference range "
                           f"on {o.quantity}: {sig(o.value)} vs {sig(o.range[0])}–{sig(o.range[1])}.")
    for q in contra:
        image_status = driving[q] if unit == "image" else other[q]
        strip_status = other[q] if unit == "image" else driving[q]
        reasons.append(f"{q} is {image_status} per image but {strip_status} per strip: the result "
                       f"depends on treating neighbouring images as independent.")
    if pow_.limited:
        n1, n2 = pow_.n_segments
        reasons.append(f"Too few {noun} to confirm any difference: {n1} vs {n2} {noun}, smallest "
                       f"possible p {sig(pow_.min_p)} ≥ alpha {sig(cfg['alpha'])}.")
    for d in unclear:
        if d.interval:
            quantity_unit = f" {d.unit}" if d.unit else ""
            reasons.append(f"{d.name} is unclear: {ci_pct} interval {sig(d.interval[0])} to "
                           f"{sig(d.interval[1])}{quantity_unit} against a margin of ±{sig(d.margin)}.")
        else:
            reasons.append(f"{d.name} is unclear: not enough {noun} for an interval.")
    if not controls.ran:
        reasons.append("Controls not run: ACCEPT needs passed controls.")
    if no_used:
        reasons.append("No key quantity is measured on both sides.")

    if failed:
        verdict = "INVESTIGATE"
    elif (new_type and not imaging.changed) or different:
        verdict = "REJECT"
    elif reasons:
        verdict = "INVESTIGATE"
    else:
        verdict = "ACCEPT"
        reasons = ["Every key quantity is within ±δ of the reference and the controls passed."]

    if failed:
        next_action = "Fix the failing controls before trusting any verdict."
    elif new_type:
        next_action = ("Check the imaging settings, then re-run." if imaging.changed else
                       "Hold the batch and send example crops of the unseen particle type "
                       "to a materials scientist.")
    elif different:
        top = next((q for q in drivers if q in {d.name for d in different}), different[0].name)
        d = next(d for d in different if d.name == top)
        quantity_unit = f" {d.unit}" if d.unit else ""
        next_action = (f"Hold the batch. Top driver: {d.name} ({sig(d.batch)} vs {sig(d.reference)}"
                       f"{quantity_unit}). Check it at the supplier.")
    elif imaging.changed:
        next_action = (f"Check the imaging settings ({', '.join(imaging.changed_metrics)}) against "
                       f"the reference before trusting {', '.join(cfg['imaging_sensitive'])}.")
    elif odds:
        odd = odds[0]
        next_action = (f"Check image {odd.image_ids[0]}: part of the batch may be different material."
                       if unit == "image" else
                       f"Check strip {odd.strip_id}: part of the batch may be different material.")
    elif contra:
        next_action = (f"Image more strips of this batch: {', '.join(contra)} changes status "
                       f"between the image and the strip view.")
    elif pow_.limited:
        n1, n2 = pow_.n_segments
        extra = f"at least {pow_.extra_needed} " if pow_.extra_needed is not None else ""
        next_action = (f"Collect {extra}more {noun} of this batch: with {n1} vs {n2} {noun} "
                       f"no difference can be confirmed.")
    elif unclear:
        top = max((d for d in unclear if d.margin and stats[d.name].sp is not None),
                  key=lambda d: abs(d.difference / d.margin), default=None)
        if top is None:
            next_action = f"Collect more {noun} to settle the unclear quantities."
        else:
            st = stats[top.name]
            m = units_to_settle(st.diff, st.sp, st.n[0], st.n[1], top.margin, cfg["ci_level"])
            next_action = (f"Collect ~{m} more {noun} to settle {top.name}." if m is not None else
                           f"{top.name} sits close to the margin: even 20 more {noun} may not settle "
                           f"it; ask whether a customer tolerance exists.")
    elif not controls.ran:
        next_action = "Run the controls (Sync 2), then re-run."
    elif no_used:
        next_action = "Check that the key descriptors are measured."
    else:
        next_action = "Release the batch."
    return verdict, reasons, next_action


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compare every batch in a KPI table against the baseline.")
    parser.add_argument("kpis_csv", type=Path, nargs="?", default=KPI_TABLE)
    parser.add_argument("--baseline", help="defaults to `baseline` in config/decision.yaml")
    args = parser.parse_args()
    cfg = load_config()
    if args.baseline:
        cfg["baseline"] = args.baseline
    tables = read_tables(args.kpis_csv)
    if cfg["baseline"] not in tables:
        raise SystemExit(f"no rows for baseline {cfg['baseline']!r} in {args.kpis_csv}")
    input_tables = [args.kpis_csv, *sidecars(args.kpis_csv)]
    for name in tables:
        evidence = evaluate(tables, name, cfg)
        evidence.explanations = explain(evidence, load_dictionary())
        evidence.provenance = provenance(input_tables, cfg, Path(cfg["data_dir"]))
        evidence_path(name).parent.mkdir(parents=True, exist_ok=True)
        evidence_path(name).write_text(evidence.model_dump_json(indent=2))
        n1, n2 = evidence.power.n_segments
        print(f"{name:20s} {evidence.verdict:12s} {evidence.unit}s {n1} vs {n2}")
