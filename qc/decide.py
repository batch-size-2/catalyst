"""Backend side: KPI tables -> verdict. Owned by the backend engineer (PLAN_v3 §3.5).

Usage (no images needed): uv run python -m qc.decide tests/fixtures/kpis_fake.csv --baseline fake_baseline
"""

import argparse
from math import comb
from pathlib import Path

import numpy as np
import pandas as pd

from qc.provenance import provenance
from qc.schema import (
    KPI_TABLE, KPI_UNITS, IMAGING_COLUMNS, PARTICLE_COLUMNS, Descriptor, Difference,
    Evidence, Fingerprint, Power, Segment, SharedStrips, Tables, evidence_path, load_config,
)

NON_QUANTITY = {"batch", "image_id", "strip_id", "px_um", "area_um2"}


def num(value) -> float | None:
    return None if value is None or pd.isna(value) else float(value)


def split_tables(kpis: pd.DataFrame, particles: pd.DataFrame | None = None,
                 imaging: pd.DataFrame | None = None) -> dict[str, Tables]:
    """One Tables per batch; missing tables become empty frames with the schema columns."""
    particles = pd.DataFrame(columns=PARTICLE_COLUMNS) if particles is None else particles
    imaging = pd.DataFrame(columns=IMAGING_COLUMNS) if imaging is None else imaging
    batches = dict.fromkeys(b for frame in (kpis, particles, imaging) for b in frame["batch"])
    take = lambda frame, name: frame[frame["batch"] == name].reset_index(drop=True)
    return {str(name): Tables(kpis=take(kpis, name), particles=take(particles, name),
                              imaging=take(imaging, name)) for name in batches}


def evaluate(tables: dict[str, Tables], batch: str, cfg: dict) -> Evidence:
    return compare(tables[cfg["baseline"]], tables[batch], cfg)


def min_achievable_p(n1: int, n2: int) -> float:
    """Smallest p a label-shuffle test can reach: 2/N for equal counts (mirror arrangements tie), else 1/N."""
    return min(1.0, (2 if n1 == n2 else 1) / comb(n1 + n2, n1))


def power(n1: int, n2: int, alpha: float) -> Power:
    """How far a label-shuffle test on n1 vs n2 segments can go (PLAN_v3 §3.5)."""
    min_p = min_achievable_p(n1, n2)
    limited = min_p >= alpha
    extra = 0 if not limited else next(
        (m for m in range(1, 21) if min_achievable_p(n1 + m, n2) < alpha), None)
    return Power(n_segments=(n1, n2), n_arrangements=comb(n1 + n2, n1), min_p=min_p,
                 limited=limited, extra_strips_needed=extra)


def segments_of(kpis: pd.DataFrame, batch: str, quantities: list[str]) -> list[Segment]:
    """One Segment per strip_id; per-quantity value = area-weighted mean over the strip's images."""
    if kpis.empty:
        return []
    df = kpis.assign(strip_id=kpis["strip_id"].fillna(kpis["image_id"]))
    segments = []
    for strip_id, group in df.groupby("strip_id"):
        area = group["area_um2"] if "area_um2" in group else pd.Series(np.nan, index=group.index)
        weights = area.where(area.notna() & (area > 0), 1.0)
        values = {}
        for q in quantities:
            col = group[q] if q in group else pd.Series(np.nan, index=group.index, dtype=float)
            have = col.notna()
            values[q] = float(np.average(col[have], weights=weights[have])) if have.any() else None
        segments.append(Segment(batch=batch, strip_id=str(strip_id),
                                image_ids=[str(i) for i in group["image_id"]],
                                area_um2=num(area.sum(min_count=1)), shared=False, values=values))
    return segments


def compare(ref: Tables, batch: Tables, cfg: dict) -> Evidence:
    """Batch vs reference over strip segments. Walking skeleton: no decision statistics yet."""
    ref_kpis = ref.kpis[~ref.kpis["image_id"].isin(cfg.get("reference_exclude") or [])]
    batch_kpis = batch.kpis
    batch_name = str(batch_kpis["batch"].iloc[0]) if len(batch_kpis) else "?"

    others = [c for c in dict.fromkeys([*ref_kpis.columns, *batch_kpis.columns])
              if c not in NON_QUANTITY
              and any(c in f.columns and pd.api.types.is_numeric_dtype(f[c]) for f in (ref_kpis, batch_kpis))]
    quantities = list(dict.fromkeys([*cfg.get("key_descriptors", []), *KPI_UNITS, *others]))

    ref_segments = segments_of(ref_kpis, cfg["baseline"], quantities)
    batch_segments = segments_of(batch_kpis, batch_name, quantities)
    shared = sorted({s.strip_id for s in ref_segments} & {s.strip_id for s in batch_segments})
    for segment in ref_segments + batch_segments:
        segment.shared = segment.strip_id in shared

    variant = cfg.get("shared_strips", "exclude")
    drive = [ref_segments, batch_segments]
    if variant == "exclude":
        drive = [[s for s in segs if not s.shared] for segs in drive]
    ref_drive, batch_drive = drive

    values_of = lambda segs, q: [s.values[q] for s in segs if s.values.get(q) is not None]
    key = set(cfg.get("key_descriptors", []))
    differences = []
    for q in quantities:
        ref_vals = values_of(ref_segments, q)  # margin from the full reference, not the driving variant
        ref_sd = float(np.std(ref_vals, ddof=1)) if len(ref_vals) >= 2 else None
        margin = cfg.get("margins", {}).get(q)
        if margin is None and ref_sd is not None:
            margin = cfg["similar_margin"] * ref_sd
        ref_vals, batch_vals = values_of(ref_drive, q), values_of(batch_drive, q)
        ref_mean = num(np.mean(ref_vals)) if ref_vals else None
        batch_mean = num(np.mean(batch_vals)) if batch_vals else None
        is_key = q in key
        used = is_key and ref_mean is not None and batch_mean is not None
        differences.append(Difference(
            name=q, unit=KPI_UNITS.get(q, ""), key=is_key, used=used,
            note="not measured" if is_key and not used else None,
            reference=ref_mean, batch=batch_mean,
            difference=num(batch_mean - ref_mean) if ref_mean is not None and batch_mean is not None else None,
            margin=num(margin), n_segments=(len(batch_vals), len(ref_vals))))
    differences.sort(key=lambda d: 0 if d.used else 1 if d.key else 2)

    drivers = [d.name for d in sorted(
        (d for d in differences if d.used and d.difference is not None and d.margin),
        key=lambda d: -abs(d.difference / d.margin))]
    n_segments = tuple(sum(any(v is not None for v in s.values.values()) for s in segs)
                       for segs in (batch_drive, ref_drive))

    def describe(q: str) -> Descriptor:
        vals = values_of(batch_segments, q)
        return Descriptor(name=q, unit=KPI_UNITS.get(q, ""),
                          value=num(np.mean(vals)) if vals else None,
                          by_strip={s.strip_id: s.values.get(q) for s in batch_segments})

    return Evidence(
        batch=batch_name, baseline=cfg["baseline"], verdict="INVESTIGATE",
        reasons=["Comparison statistics not implemented yet (walking skeleton)."],
        next_action="No action yet: the comparison statistics land in the next commit.",
        differences=differences, drivers=drivers,
        power=power(n_segments[0], n_segments[1], cfg["alpha"]),
        shared_strips=SharedStrips(setting=variant, strips=shared),
        fingerprint=Fingerprint(segments=batch_segments,
                                descriptors=[describe(q) for q in quantities]),
        n_images={"batch": len(batch_kpis), "baseline": len(ref_kpis)},
        config_version=cfg["version"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compare every batch in a KPI table against the baseline.")
    parser.add_argument("kpis_csv", type=Path, nargs="?", default=KPI_TABLE)
    parser.add_argument("--baseline", help="defaults to `baseline` in config/decision.yaml")
    args = parser.parse_args()
    cfg = load_config()
    if args.baseline:
        cfg["baseline"] = args.baseline
    tables = split_tables(pd.read_csv(args.kpis_csv))
    if cfg["baseline"] not in tables:
        raise SystemExit(f"no rows for baseline {cfg['baseline']!r} in {args.kpis_csv}")
    for name in tables:
        evidence = evaluate(tables, name, cfg)
        evidence.provenance = provenance([args.kpis_csv], cfg, Path(cfg["data_dir"]))
        evidence_path(name).parent.mkdir(parents=True, exist_ok=True)
        evidence_path(name).write_text(evidence.model_dump_json(indent=2))
        n1, n2 = evidence.power.n_segments
        print(f"{name:20s} {evidence.verdict:12s} segments {n1} vs {n2} · "
              f"{len(evidence.shared_strips.strips)} shared strip(s)")
