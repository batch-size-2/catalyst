"""Synthetic controls with a known answer, built from reference images (PLAN_v3 §3.7, §3.13).

Each control is a batch of transformed reference fields; the comparison must come out as the
control's kind says (negative -> SIMILAR, positive -> DIFFERENT with the expected driver).

Usage: uv run python -m qc.controls [--baseline data/Batch_3]
"""

import argparse
import itertools
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.ndimage import binary_erosion, distance_transform_edt, zoom
from skimage.measure import regionprops

from qc.io import iter_fields
from qc.measure import (
    _border_ids,
    _upsample,
    black_level,
    kpis,
    label_si,
    segment,
)
from qc.schema import OUT_DIR, Control, Field, Phase

CONTROL_NAMES = [
    "neg_brightness_up", "neg_brightness_down", "neg_contrast_up", "neg_contrast_down",
    "neg_black_plus20", "neg_noise5", "neg_curtaining",
    "pos_si_plus50", "pos_si_plus100", "pos_voids", "pos_si_scale150",
]
SHARED_CONTROL_NAMES = ["shared_unchanged", "shared_diluted", "unshared_change"]
MAX_DONORS = 400
MAX_PASTE_ATTEMPTS = 3000
DONOR_D_UM = (1.0, 10.0)
SUMMARY_KPIS = [
    "si_graphite_ratio", "si_d50_um", "si_internal_void_frac", "porosity_apparent", "si_contrast_ratio"
]


def _u8(x: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(x), 0, 255).astype(np.uint8)


def _mk_fields(fields: list[Field], name: str, chan_list: list[dict]) -> list[Field]:
    """Control fields: same strip_id and image content (transformed), image_id gets ~name."""
    return [
        Field(
            batch=f"_controls/{name}",
            image_id=f"{f.image_id}~{name}",
            strip_id=f.strip_id,
            channels=ch,
            px_um=f.px_um,
        )
        for f, ch in zip(fields, chan_list)
    ]


# --- negative transforms: per field -> {channel: image} ---


def _neg_brightness(factor: float):
    def apply(field: Field, rng: np.random.Generator) -> dict:
        return {
            k: _u8((img.astype(np.float32) - black_level(img)) * factor + black_level(img))
            for k, img in field.channels.items()
        }

    return apply


def _neg_contrast(factor: float):
    def apply(field: Field, rng: np.random.Generator) -> dict:
        return {
            k: _u8((img.astype(np.float32) - img.mean()) * factor + img.mean())
            for k, img in field.channels.items()
        }

    return apply


def _neg_black(delta: float):
    def apply(field: Field, rng: np.random.Generator) -> dict:
        return {k: _u8(img.astype(np.float32) + delta) for k, img in field.channels.items()}

    return apply


def _neg_noise(sigma: float):
    def apply(field: Field, rng: np.random.Generator) -> dict:
        return {
            k: _u8(img.astype(np.float32) + rng.normal(0, sigma, img.shape))
            for k, img in field.channels.items()
        }

    return apply


def _neg_curtaining(field: Field, rng: np.random.Generator) -> dict:
    """Per-column offsets: 3 sinusoids (periods 0.5-3 um, total amplitude ~6) + N(0,2)."""
    _, w = next(iter(field.channels.values())).shape
    x = np.arange(w) * field.px_um
    col = sum(
        2.0 * np.sin(2 * np.pi * x / period + phase)
        for period, phase in zip(rng.uniform(0.5, 3.0, 3), rng.uniform(0, 2 * np.pi, 3))
    ) + rng.normal(0, 2, w)
    return {k: _u8(img.astype(np.float32) + col[None, :]) for k, img in field.channels.items()}


# --- positive transforms ---


def _si_donors(
    fields: list[Field], rng: np.random.Generator, max_donors: int = MAX_DONORS
) -> list[dict]:
    """Channel crops + masks of non-border Si particles 1-10 um, reservoir-sampled."""
    donors, seen = [], 0
    for f in fields:
        mask = segment(f.channels, f.px_um)
        labels, _, step = label_si(mask, f.px_um)
        full = _upsample(labels, mask.shape, step)
        borders = _border_ids(full, mask)
        for prop in regionprops(full):
            d_um = np.sqrt(4 * prop.area * f.px_um**2 / np.pi)
            if not (DONOR_D_UM[0] <= d_um <= DONOR_D_UM[1]) or prop.label in borders:
                continue
            y0, x0, y1, x1 = prop.bbox
            donor = {
                "channels": {k: ch[y0:y1, x0:x1].copy() for k, ch in f.channels.items()},
                "mask": full[y0:y1, x0:x1] == prop.label,
            }
            if len(donors) < max_donors:
                donors.append(donor)
            elif (j := int(rng.integers(seen + 1))) < max_donors:
                donors[j] = donor
            seen += 1
    return donors


def _si_boost(fields: list[Field], donors: list[dict], factor: float, rng: np.random.Generator) -> list[dict]:
    """Paste donor Si particles onto graphite until Si px grow `factor`x."""
    out = []
    for f in fields:
        mask = segment(f.channels, f.px_um)
        want = int((mask == Phase.SI).sum() * factor)
        added, attempts = int((mask == Phase.SI).sum()), 0
        chans = {k: v.copy() for k, v in f.channels.items()}
        occupied = np.zeros(mask.shape, bool)
        order = rng.permutation(len(donors)) if donors else np.array([], dtype=int)
        h_img, w_img = mask.shape
        while added < want and attempts < MAX_PASTE_ATTEMPTS and len(order):
            donor = donors[order[attempts % len(order)]]
            attempts += 1
            dm = donor["mask"]
            dh, dw = dm.shape
            if dh >= h_img or dw >= w_img:
                continue
            y, x = int(rng.integers(0, h_img - dh)), int(rng.integers(0, w_img - dw))
            if not (mask[y : y + dh, x : x + dw][dm] == Phase.GRAPHITE).all():
                continue
            if occupied[y : y + dh, x : x + dw][dm].any():
                continue
            for k in chans.keys() & donor["channels"].keys():
                chans[k][y : y + dh, x : x + dw][dm] = donor["channels"][k][dm]
            occupied[y : y + dh, x : x + dw][dm] = True
            added += int(dm.sum())
        out.append(chans)
    return out


def _pos_voids(field: Field, rng: np.random.Generator) -> dict:
    """Punch pore-brightness discs into 30% of Si particles >= 1 um, ~25% of each area."""
    mask = segment(field.channels, field.px_um)
    labels, _, step = label_si(mask, field.px_um)
    full = _upsample(labels, mask.shape, step)
    pore = mask == Phase.PORE
    meds = {
        k: float(np.median(ch[pore])) if pore.any() else float(np.percentile(ch, 1))
        for k, ch in field.channels.items()
    }
    chans = {k: v.copy() for k, v in field.channels.items()}
    for prop in regionprops(full):
        if np.sqrt(4 * prop.area * field.px_um**2 / np.pi) < 1.0 or rng.random() >= 0.3:
            continue
        y0, x0, y1, x1 = prop.bbox
        pm = full[y0:y1, x0:x1] == prop.label
        eroded = binary_erosion(pm, iterations=2)
        yy, xx = np.mgrid[0 : pm.shape[0], 0 : pm.shape[1]]
        target, voided = 0.25 * pm.sum(), 0
        while voided < target:
            dist = distance_transform_edt(eroded)
            if dist.max() < 1.5:
                break
            cy, cx = np.unravel_index(np.argmax(dist), dist.shape)
            r = min(np.sqrt((target - voided) / np.pi), dist[cy, cx] * 0.95)
            disc = (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r
            punch = disc & pm
            for k, ch in chans.items():
                ch[y0:y1, x0:x1][punch] = meds[k]
            voided += int(punch.sum())
            eroded = eroded & ~disc
    return chans


def _pos_si_scale(field: Field, rng: np.random.Generator, factor: float = 1.5) -> dict:
    """Scale 1/factor^2 of the non-border Si particles by `factor`; erase the rest (size, not amount)."""
    mask = segment(field.channels, field.px_um)
    labels, _, step = label_si(mask, field.px_um)
    full = _upsample(labels, mask.shape, step)
    borders = _border_ids(full, mask)
    chans = {k: v.copy() for k, v in field.channels.items()}
    gpos = np.flatnonzero((mask == Phase.GRAPHITE).ravel())
    h_img, w_img = mask.shape
    for prop in regionprops(full):
        if np.sqrt(4 * prop.area * field.px_um**2 / np.pi) < 1.0 or prop.label in borders:
            continue
        cy, cx = prop.centroid
        if rng.random() < 1 / factor**2:
            half = int(np.ceil(0.5 * factor * max(prop.bbox[2] - prop.bbox[0], prop.bbox[3] - prop.bbox[1]))) + 3
            y0, x0 = max(0, int(cy - half)), max(0, int(cx - half))
            y1, x1 = min(h_img, int(cy + half) + 1), min(w_img, int(cx + half) + 1)
            zm = zoom((full[y0:y1, x0:x1] == prop.label).astype(np.uint8), factor, order=0).astype(bool)
            zh, zw = zm.shape
            py0, px0 = int(cy - zh / 2), int(cx - zw / 2)
            ty0, tx0 = max(0, py0), max(0, px0)
            ty1, tx1 = min(h_img, py0 + zh), min(w_img, px0 + zw)
            sy0, sx0 = ty0 - py0, tx0 - px0
            place = zm[sy0 : sy0 + ty1 - ty0, sx0 : sx0 + tx1 - tx0] & (
                mask[ty0:ty1, tx0:tx1] != Phase.IGNORE
            )
            for k, ch in chans.items():
                zc = zoom(field.channels[k][y0:y1, x0:x1], factor, order=1)
                ch[ty0:ty1, tx0:tx1][place] = zc[sy0 : sy0 + ty1 - ty0, sx0 : sx0 + tx1 - tx0][place]
        elif len(gpos):
            pm = full[prop.bbox[0] : prop.bbox[2], prop.bbox[1] : prop.bbox[3]] == prop.label
            idx = rng.integers(0, len(gpos), int(pm.sum()))
            flat = np.flatnonzero(pm.ravel())
            for k, ch in chans.items():
                box = ch[prop.bbox[0] : prop.bbox[2], prop.bbox[1] : prop.bbox[3]]
                box.flat[flat] = field.channels[k].flat[gpos[idx]]
    return chans


# --- control builders ---


def iter_controls(
    fields: list[Field], px_um: float, seed: int = 0, n_strips: int = 3
) -> Iterator[Control]:
    """Yields the PLAN_v3 §3.7 controls one at a time (one control's fields in memory)."""
    rng = np.random.default_rng(seed)
    strips = sorted({f.strip_id for f in fields})
    n_src = min(n_strips, len(strips) - 2)
    if n_src < 2:
        raise ValueError(f"controls need >= {n_src + 2} reference strips, got {len(strips)}")
    source = sorted(rng.choice(strips, size=n_src, replace=False).tolist())
    targets = [f for f in fields if f.strip_id in source]
    donor_fields = [f for f in fields if f.strip_id not in source]

    def emit(name, kind, driver, chan_list):
        return Control(name, kind, driver, list(source), _mk_fields(targets, name, chan_list))

    negatives = [
        ("neg_brightness_up", _neg_brightness(1.2)),
        ("neg_brightness_down", _neg_brightness(0.8)),
        ("neg_contrast_up", _neg_contrast(1.2)),
        ("neg_contrast_down", _neg_contrast(0.8)),
        ("neg_black_plus20", _neg_black(20)),
        ("neg_noise5", _neg_noise(5)),
        ("neg_curtaining", _neg_curtaining),
    ]
    for name, fn in negatives:
        yield emit(name, "negative", None, [fn(f, rng) for f in targets])
    donors = _si_donors(donor_fields, rng)
    for name, factor in (("pos_si_plus50", 1.5), ("pos_si_plus100", 2.0)):
        yield emit(name, "positive", "si_graphite_ratio", _si_boost(targets, donors, factor, rng))
    yield emit("pos_voids", "positive", "si_internal_void_frac", [_pos_voids(f, rng) for f in targets])
    yield emit("pos_si_scale150", "positive", "si_d50_um", [_pos_si_scale(f, rng) for f in targets])


def make_controls(fields: list[Field], px_um: float, seed: int = 0, n_strips: int = 3) -> list[Control]:
    return list(iter_controls(fields, px_um, seed=seed, n_strips=n_strips))


def shared_strip_controls(fields: list[Field], px_um: float, seed: int = 0) -> list[Control]:
    """PLAN_v3 §3.13: test batches that share split strips with the reference (kept_in_reference)."""
    rng = np.random.default_rng(seed)
    by_strip: dict[str, list[Field]] = {}
    for f in fields:
        by_strip.setdefault(f.strip_id, []).append(f)
    splittable = sorted(s for s, fs in by_strip.items() if len(fs) >= 2)
    if len(splittable) < 2 or len(by_strip) - 2 < 2:
        raise ValueError("shared-strip controls need >= 2 splittable strips and >= 2 other strips")
    split_strips = sorted(rng.choice(splittable, size=2, replace=False).tolist())
    whole = sorted(
        rng.choice(sorted(set(by_strip) - set(split_strips)), size=2, replace=False).tolist()
    )
    source = sorted(split_strips + whole)
    test_fields, kept = [], []
    for s in split_strips:
        imgs = sorted(by_strip[s], key=lambda f: f.image_id)
        test_fields += imgs[: len(imgs) // 2]
        kept += [f.image_id for f in imgs[len(imgs) // 2 :]]
    whole_fields = [f for s in whole for f in by_strip[s]]
    donors = _si_donors([f for f in fields if f.strip_id not in source], rng)

    def unaltered(fs):
        return [(f, {k: v.copy() for k, v in f.channels.items()}) for f in fs]

    def boosted(fs):
        return list(zip(fs, _si_boost(fs, donors, 1.5, rng)))

    def mk(name, kind, driver, parts, kept_ids):
        return Control(
            name, kind, driver, list(source),
            _mk_fields([f for f, _ in parts], name, [ch for _, ch in parts]), list(kept_ids),
        )

    return [
        mk("shared_unchanged", "negative", None, unaltered(test_fields) + unaltered(whole_fields), kept),
        mk(
            "shared_diluted", "positive", "si_graphite_ratio",
            unaltered(test_fields) + boosted(whole_fields), kept,
        ),
        mk("unshared_change", "positive", "si_graphite_ratio", boosted(whole_fields), []),
    ]


def _field_kpis(field: Field) -> dict:
    return kpis(segment(field.channels, field.px_um), field.px_um, field.channels)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build controls from the baseline and measure them.")
    parser.add_argument("--baseline", type=Path, default=Path("data/Batch_3"))
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    fields = list(iter_fields(args.baseline))
    originals = {f.image_id: f for f in fields}
    px = fields[0].px_um if fields else 0.025
    cache: dict[str, dict] = {}

    def original_kpis(image_id: str) -> dict:
        if image_id not in cache:
            cache[image_id] = _field_kpis(originals[image_id])
        return cache[image_id]

    rows = []
    controls = itertools.chain(
        iter_controls(fields, px, seed=args.seed), shared_strip_controls(fields, px, seed=args.seed)
    )
    for control in controls:
        vals, refs = [], []
        for f in control.fields:
            vals.append(_field_kpis(f))
            refs.append(original_kpis(f.image_id.split("~")[0]))
        print(f"{control.name} ({control.kind}, driver={control.expected_driver}, {len(vals)} fields)")
        for k in SUMMARY_KPIS:
            m, r = np.nanmean([v.get(k, np.nan) for v in vals]), np.nanmean(
                [v.get(k, np.nan) for v in refs]
            )
            rows.append(
                {"control": control.name, "kind": control.kind, "expected_driver": control.expected_driver,
                 "n_fields": len(vals), "kpi": k, "control_mean": m, "original_mean": r, "shift": m - r}
            )
            print(f"    {k:24s} {m:8.4f}  vs untransformed {r:8.4f}  (shift {m - r:+.4f})")
    out = OUT_DIR / "controls" / "summary.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(out, index=False)
    print(f"wrote {out}")
