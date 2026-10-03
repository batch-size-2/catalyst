"""Per-image feature table for batch attribution (PLAN_v4 §3.14). Owned by the ML engineer.

One row per image, `META_COLUMNS` plus features in five families, each with its own prefix so a
family can be switched on or off in qc/attribute.py:

    reg_   regional: cheap phase descriptors per ~15 um tile, summarised over tiles (mean, SD, CV,
           p10/p50/p90) plus a normalised top-to-bottom slope
    edge_  the top and bottom 5% rows that segment() ignores, measured separately (artefact-prone)
    tex_   texture: uniform LBP histograms on every channel (whole image, and BSE inside graphite
           and inside Si) and GLCM statistics per channel
    par_   particle aggregates from particles(): size quantiles, contrast, voids, shape, type shares
    kpi_   the 15 whole-image descriptors from kpis()
    img_   imaging descriptors per channel: acquisition, not material. Kept apart on purpose
    deep_  optional: pretrained DINOv2 tile embeddings, added by qc/deep.py (not computed here)

Leakage rule (AGENT_HANDOVER §4 G4): strip_id, image height or width, px_um and XResolution are
never features. `assert_no_leakage()` enforces it on every table this module writes.

Usage: uv run python -m qc.features [data/Batch_1 ...]   # default: every folder in data/ -> out/features.csv
"""

import numpy as np
import pandas as pd
from skimage.feature import graycomatrix, graycoprops, local_binary_pattern

from qc.measure import (
    _chords,
    _otsu,
    black_level,
    imaging,
    kpis,
    particles,
    preprocess,
    segment,
    valid_rows,
)
from qc.schema import FEATURE_TABLE, KPI_UNITS, Field, Phase

META_COLUMNS = ["batch", "image_id", "strip_id"]
FAMILIES = ("reg", "edge", "tex", "par", "kpi", "img")
MATERIAL_FAMILIES = ("reg", "edge", "tex", "par", "kpi")
DEEP_FAMILY = "deep"           # pretrained DINOv2 embeddings, written by qc/deep.py (optional extra)
ALL_FAMILIES = (*FAMILIES, DEEP_FAMILY)
FORBIDDEN = ("strip", "height", "width", "px_um", "xres", "resolution", "shape")

TILE_UM = 15.0
TILE_MIN_VALID = 0.5
PROFILE_BANDS = 5
TEXTURE_STEP = 2          # LBP/GLCM at 2x downsample (0.05 um/px)
LBP_P, LBP_R = 8, 1
LBP_BINS = LBP_P + 2
GLCM_LEVELS = 32
GLCM_DISTANCES = (1, 4)   # at TEXTURE_STEP: 0.1 um and 0.4 um
GLCM_PROPS = ("contrast", "homogeneity", "energy", "correlation")
TILE_QUANTITIES = ("si_frac", "pore_frac", "graphite_frac", "binder_frac", "si_graphite", "graphite_chord_um", "pore_chord_um")
SUMMARIES = ("mean", "sd", "cv", "p10", "p50", "p90")


def assert_no_leakage(columns) -> None:
    """Raises if any feature column could identify a strip rather than the material."""
    bad = [c for c in columns if c not in META_COLUMNS and any(f in c.lower() for f in FORBIDDEN)]
    if bad:
        raise ValueError(f"leaky feature columns: {bad}")


def feature_columns(df: pd.DataFrame, families=MATERIAL_FAMILIES) -> list[str]:
    """Feature columns of `df` belonging to the given families, in table order."""
    prefixes = tuple(f"{f}_" for f in families)
    return [c for c in df.columns if c not in META_COLUMNS and c.startswith(prefixes)]


def family_of(column: str) -> str:
    return column.split("_", 1)[0]


# ---------------------------------------------------------------- regional

def tile_table(mask: np.ndarray, px_um: float, tile_um: float = TILE_UM) -> pd.DataFrame:
    """One row per tile of the valid band: row, col, centre position (0..1 of the valid band), TILE_QUANTITIES.

    Tiles with under TILE_MIN_VALID of valid pixels are dropped. Positions are normalised so nothing
    depends on the image size.
    """
    rows = valid_rows(mask.shape[0])
    band = mask[rows]
    win = min(max(8, int(round(tile_um / px_um))), *band.shape)
    out = []
    ny, nx = band.shape[0] // win, band.shape[1] // win
    for i in range(ny):
        for j in range(nx):
            tile = band[i * win : (i + 1) * win, j * win : (j + 1) * win]
            valid = tile != Phase.IGNORE
            n = int(valid.sum())
            if n < TILE_MIN_VALID * tile.size:
                continue
            si, pore, gr, bi = [(tile == p).sum() for p in (Phase.SI, Phase.PORE, Phase.GRAPHITE, Phase.BINDER)]
            gch, pch = _chords(tile == Phase.GRAPHITE), _chords(tile == Phase.PORE)
            out.append(
                {
                    "row": i, "col": j,
                    "y": (i + 0.5) / ny, "x": (j + 0.5) / nx,
                    "si_frac": si / n, "pore_frac": pore / n, "graphite_frac": gr / n, "binder_frac": bi / n,
                    "si_graphite": si / gr if gr else np.nan,
                    "graphite_chord_um": gch.mean() * px_um if len(gch) else np.nan,
                    "pore_chord_um": pch.mean() * px_um if len(pch) else np.nan,
                }
            )
    return pd.DataFrame(out, columns=["row", "col", "y", "x", *TILE_QUANTITIES])


def _summarise(values: np.ndarray) -> dict[str, float]:
    v = values[np.isfinite(values)]
    if len(v) < 2:
        return {s: np.nan for s in SUMMARIES}
    mean, sd = float(v.mean()), float(v.std(ddof=1))
    p10, p50, p90 = np.percentile(v, (10, 50, 90))
    return {"mean": mean, "sd": sd, "cv": sd / mean if mean else np.nan, "p10": float(p10), "p50": float(p50), "p90": float(p90)}


def _profile_slope(tiles: pd.DataFrame, quantity: str) -> float:
    """Slope of the row-band means against normalised depth (0 top .. 1 bottom), relative to the mean."""
    if tiles.empty:
        return np.nan
    bands = tiles.assign(band=np.minimum((tiles["y"] * PROFILE_BANDS).astype(int), PROFILE_BANDS - 1))
    means = bands.groupby("band")[quantity].mean().dropna()
    if len(means) < 2 or not means.mean():
        return np.nan
    pos = (means.index.to_numpy() + 0.5) / PROFILE_BANDS
    return float(np.polyfit(pos, means.to_numpy() / means.mean(), 1)[0])


def regional_features(mask: np.ndarray, px_um: float, tile_um: float = TILE_UM) -> dict[str, float]:
    tiles = tile_table(mask, px_um, tile_um)
    out: dict[str, float] = {"reg_n_tiles": float(len(tiles))}
    for q in TILE_QUANTITIES:
        vals = tiles[q].to_numpy(float) if len(tiles) else np.array([])
        for s, v in _summarise(vals).items():
            out[f"reg_{q}_{s}"] = v
        out[f"reg_{q}_slope"] = _profile_slope(tiles, q)
    if len(tiles):
        out["reg_si_frac_top_bottom"] = _top_bottom_ratio(tiles, "si_frac")
        out["reg_pore_frac_top_bottom"] = _top_bottom_ratio(tiles, "pore_frac")
    else:
        out["reg_si_frac_top_bottom"] = out["reg_pore_frac_top_bottom"] = np.nan
    return out


def _top_bottom_ratio(tiles: pd.DataFrame, quantity: str) -> float:
    top, bottom = tiles[tiles["y"] < 0.5][quantity].mean(), tiles[tiles["y"] >= 0.5][quantity].mean()
    return float(top / bottom) if bottom else np.nan


def edge_features(channels: dict[str, np.ndarray], thresholds: tuple[float, float] | None = None) -> dict[str, float]:
    """Phase fractions in the rows segment() ignores (top and bottom 5%), thresholded like the rest."""
    work = preprocess(channels)
    th = thresholds if thresholds is not None else _otsu(work)
    rows = valid_rows(work.shape[0])
    out = {}
    for name, part in (("top", work[: rows.start]), ("bottom", work[rows.stop :])):
        if part.size == 0:
            out |= {f"edge_{name}_{p}": np.nan for p in ("si_frac", "pore_frac", "brightness")}
            continue
        cls = np.digitize(part, th)
        out[f"edge_{name}_si_frac"] = float((cls == 2).mean())
        out[f"edge_{name}_pore_frac"] = float((cls == 0).mean())
        out[f"edge_{name}_brightness"] = float(part.mean() / max(work[rows].mean(), 1e-6))
    return out


# ---------------------------------------------------------------- texture

def _work_channel(img: np.ndarray) -> np.ndarray:
    """Black-subtracted channel at TEXTURE_STEP, valid rows only, integer >= 0."""
    sub = img[::TEXTURE_STEP, ::TEXTURE_STEP].astype(np.int32) - int(black_level(img))
    return np.clip(sub[valid_rows(sub.shape[0])], 0, None)


def _lbp_hist(work: np.ndarray, where: np.ndarray | None = None) -> np.ndarray:
    codes = local_binary_pattern(work, LBP_P, LBP_R, method="uniform")
    sel = codes if where is None else codes[where]
    if sel.size < 50:
        return np.full(LBP_BINS, np.nan)
    hist = np.bincount(sel.astype(int).ravel(), minlength=LBP_BINS)[:LBP_BINS]
    return hist / hist.sum()


def _glcm_stats(work: np.ndarray) -> dict[str, float]:
    hi = np.percentile(work, 99.5) or 1.0
    q = np.clip(work.astype(np.float32) / hi * (GLCM_LEVELS - 1), 0, GLCM_LEVELS - 1).astype(np.uint8)
    glcm = graycomatrix(q, distances=list(GLCM_DISTANCES), angles=[0, np.pi / 2], levels=GLCM_LEVELS, symmetric=True, normed=True)
    out = {}
    for prop in GLCM_PROPS:
        vals = graycoprops(glcm, prop)  # (distances, angles)
        for d, dist in enumerate(GLCM_DISTANCES):
            out[f"{prop}_d{dist}"] = float(vals[d].mean())
        out[f"{prop}_aniso"] = float(vals[0, 0] / vals[0, 1]) if vals[0, 1] else np.nan
    return out


def texture_features(channels: dict[str, np.ndarray], mask: np.ndarray | None = None) -> dict[str, float]:
    out: dict[str, float] = {}
    for ch in ("BSE", "ETD", "InLens"):
        img = channels.get(ch)
        if img is None:
            continue
        work = _work_channel(img)
        for k, v in enumerate(_lbp_hist(work)):
            out[f"tex_{ch.lower()}_lbp{k}"] = float(v)
        for k, v in _glcm_stats(work).items():
            out[f"tex_{ch.lower()}_glcm_{k}"] = v
    if mask is not None and "BSE" in channels:
        work = _work_channel(channels["BSE"])
        msub = mask[::TEXTURE_STEP, ::TEXTURE_STEP]
        msub = msub[valid_rows(msub.shape[0])]
        msub = msub[: work.shape[0], : work.shape[1]]
        work = work[: msub.shape[0], : msub.shape[1]]
        for phase in (Phase.GRAPHITE, Phase.SI):
            for k, v in enumerate(_lbp_hist(work, msub == phase)):
                out[f"tex_bse_{phase.name.lower()}_lbp{k}"] = float(v)
    return out


# ---------------------------------------------------------------- particles, kpis, imaging

def particle_features(parts: pd.DataFrame, valid_area_um2: float) -> dict[str, float]:
    """Image-level aggregates of the particle table. Type shares appear when a `type` column exists."""
    out: dict[str, float] = {}
    if parts is None or parts.empty:
        return {"par_n_per_1e4um2": 0.0 if valid_area_um2 else np.nan}
    border = parts["border"].astype(str).str.lower().isin(("true", "1")) if parts["border"].dtype != bool else parts["border"]
    inner = parts[~border]
    out["par_n_per_1e4um2"] = float(len(parts) / (valid_area_um2 / 1e4)) if valid_area_um2 else np.nan
    d, area = inner["d_um"].to_numpy(float), inner["area_um2"].to_numpy(float)
    if len(d):
        order = np.argsort(d)
        cum = np.cumsum(area[order])
        for q in (10, 50, 90):
            out[f"par_d{q}_um"] = float(d[order][min(np.searchsorted(cum, q / 100 * cum[-1]), len(d) - 1)])
        out["par_d_mean_um"] = float(d.mean())
        out["par_log_d_sd"] = float(np.log(d[d > 0]).std()) if (d > 0).sum() > 1 else np.nan
        out["par_coarse_area_share"] = float(area[d > 5].sum() / area.sum()) if area.sum() else np.nan
    for col in ("contrast_ratio", "inlens_ratio", "texture", "solidity"):
        v = parts[col].to_numpy(float)
        out[f"par_{col}_p50"] = float(np.nanmedian(v)) if np.isfinite(v).any() else np.nan
        out[f"par_{col}_iqr"] = float(np.subtract(*np.nanpercentile(v, (75, 25)))) if np.isfinite(v).sum() > 1 else np.nan
    vf, a = parts["void_frac"].to_numpy(float), parts["area_um2"].to_numpy(float)
    ok = np.isfinite(vf) & np.isfinite(a)
    out["par_void_frac_aw"] = float(np.average(vf[ok], weights=a[ok])) if ok.any() and a[ok].sum() else np.nan
    out["par_porous_share"] = float(a[ok & (vf > 0.1)].sum() / a[ok].sum()) if ok.any() and a[ok].sum() else np.nan
    out["par_low_solidity_share"] = float((parts["solidity"] < 0.8).mean())
    if "type" in parts and parts["type"].notna().any():
        shares = parts.groupby(parts["type"].fillna("unassigned"))["area_um2"].sum()
        shares = shares / shares.sum()
        for t, s in shares.items():
            out[f"par_type_{str(t).lower()}_share"] = float(s)
    return out


def kpi_features(values: dict[str, float]) -> dict[str, float]:
    return {f"kpi_{k}": float(values.get(k, np.nan)) for k in KPI_UNITS}


def imaging_features(descs: dict[str, dict[str, float]]) -> dict[str, float]:
    return {f"img_{ch.lower()}_{k}": float(v) for ch, d in descs.items() for k, v in d.items()}


# ---------------------------------------------------------------- per image

def image_features(field: Field, mask: np.ndarray | None = None, parts: pd.DataFrame | None = None, tile_um: float = TILE_UM) -> dict:
    """Every family for one field. Never raises for a single family: a failed family is NaN."""
    row: dict = {"batch": field.batch, "image_id": field.image_id, "strip_id": field.strip_id}
    if mask is None:
        mask = segment(field.channels, field.px_um)
    valid_area = float((mask != Phase.IGNORE).sum() * field.px_um**2)
    for name, fn in (
        ("regional", lambda: regional_features(mask, field.px_um, tile_um)),
        ("edge", lambda: edge_features(field.channels)),
        ("texture", lambda: texture_features(field.channels, mask)),
        ("kpis", lambda: kpi_features(kpis(mask, field.px_um, field.channels))),
        ("particles", lambda: particle_features(_parts(field, mask, parts), valid_area)),
        ("imaging", lambda: imaging_features(imaging(field.channels, field.px_um))),
    ):
        try:
            row.update(fn())
        except Exception as error:
            print(f"  ! {field.batch}/{field.image_id} {name}: {error!r}")
    assert_no_leakage(row)
    return row


def _parts(field: Field, mask: np.ndarray, parts: pd.DataFrame | None) -> pd.DataFrame:
    if parts is not None:
        return parts
    from qc.types import assign_types, load_types

    table = particles(mask, field.px_um, field.channels)
    model = load_types()
    return assign_types(table, model) if model is not None and len(table) else table


def build_features(batch_dirs, progress=None, tile_um: float = TILE_UM) -> pd.DataFrame:
    from qc.io import field_paths, load_field

    jobs = [(d.name, image_id, paths) for d in batch_dirs for image_id, paths in field_paths(d).items()]
    rows = []
    for i, (batch, image_id, paths) in enumerate(jobs):
        rows.append(image_features(load_field(batch, image_id, paths), tile_um=tile_um))
        if progress:
            progress(i + 1, len(jobs), f"{batch}/{image_id}")
    df = pd.DataFrame(rows)
    assert_no_leakage(df.columns)
    return df


def save_features(df: pd.DataFrame, path=FEATURE_TABLE) -> None:
    """Replaces the rows of the batches in `df`, keeps the others (same rule as out/kpis.csv)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        old = pd.read_csv(path)
        df = pd.concat([old[~old["batch"].isin(df["batch"])], df], ignore_index=True)
    assert_no_leakage(df.columns)
    df.to_csv(path, index=False)


def load_features(path=FEATURE_TABLE) -> pd.DataFrame:
    df = pd.read_csv(path)
    assert_no_leakage(df.columns)
    return df


if __name__ == "__main__":
    import sys
    from pathlib import Path

    from qc.schema import load_config

    data_dir = Path(load_config()["data_dir"])
    batch_dirs = [Path(p) for p in sys.argv[1:]] or sorted(p for p in data_dir.iterdir() if p.is_dir())
    table = build_features(batch_dirs, lambda done, total, tile: print(f"[{done}/{total}] {tile}"))
    save_features(table)
    n = {f: len(feature_columns(table, (f,))) for f in FAMILIES}
    print(f"wrote {FEATURE_TABLE}: {len(table)} images, features per family {n}")
