"""ML side: channels -> mask -> KPIs, particle table, imaging descriptors. Owned by the ML engineer.

Usage: uv run python -m qc.measure [data/Batch_1 ...]   # default: every folder in data/ -> out/
"""

import numpy as np
import pandas as pd
from scipy.ndimage import (
    binary_dilation,
    binary_fill_holes,
    distance_transform_edt,
    laplace,
    uniform_filter1d,
)
from scipy.signal import fftconvolve
from skimage.filters import gaussian, threshold_multiotsu
from skimage.measure import label, regionprops
from skimage.morphology import closing, disk, h_maxima, opening
from skimage.segmentation import watershed
from skimage.transform import downscale_local_mean

from qc.schema import Phase

WORK_STEP = 2
IGNORE_ROWS_FRAC = 0.05
MIN_SI_AREA_UM2 = 0.25
BINDER_MAX_WIDTH_UM = 0.15
FRAGMENT_MAX_D_UM = 1.0
DISPERSION_WINDOW_UM = 20
AGGLOMERATE_CLOSE_UM = 0.5
AGGLOMERATE_MIN_D_UM = 5
RING_UM = (1, 3)
CORR_RMAX_UM = 20
WATERSHED_H_UM = 0.25
MIN_RING_PIXELS = 20
SI_MIN_CONTRAST = 1.5  # SI objects dimmer than this x the graphite mode become BINDER

PARTICLE_FEATURE_COLUMNS = [
    "particle_id", "d_um", "area_um2", "contrast_ratio", "inlens_ratio", "void_frac",
    "texture", "solidity", "border", "y_px", "x_px",
]


def black_level(img: np.ndarray) -> float:
    """The grey level of "nothing": 0.5th percentile, on a 2x subsample for speed."""
    return float(np.percentile(img[::2, ::2], 0.5))


def preprocess(channels: dict[str, np.ndarray]) -> np.ndarray:
    """Black-subtracted BSE, clipped >= 0, cropped to even size, 2x block-mean, Gaussian sigma 1."""
    bse = channels["BSE"]
    work = np.clip(bse.astype(np.float32) - black_level(bse), 0, None)
    h, w = work.shape
    work = work[: h - h % WORK_STEP, : w - w % WORK_STEP]
    work = downscale_local_mean(work, (WORK_STEP, WORK_STEP))
    return gaussian(work, sigma=1, preserve_range=True).astype(np.float32)


def valid_rows(h: int) -> slice:
    """Rows kept for measurement: top and bottom IGNORE_ROWS_FRAC of h are excluded."""
    n = round(IGNORE_ROWS_FRAC * h)
    return slice(n, h - n)


def _otsu(work: np.ndarray) -> tuple[float, float]:
    """3-class multi-Otsu on a work-res image; percentile fallback when it can't split."""
    vals = work[valid_rows(work.shape[0]), ::2]
    try:
        thresholds = threshold_multiotsu(vals, classes=3)
        if not np.all(np.isfinite(thresholds)):
            raise ValueError("non-finite thresholds")
    except Exception:
        thresholds = np.percentile(vals, (33, 66))
    return float(thresholds[0]), float(thresholds[1])


def default_thresholds(channels: dict[str, np.ndarray]) -> tuple[float, float]:
    """Per-image pore/graphite/Si thresholds in black-subtracted grey levels."""
    return _otsu(preprocess(channels))


def _label_median(values: np.ndarray, lab: np.ndarray) -> np.ndarray:
    """Median of `values` per label id (index 0 = background, 0.0). Vectorised."""
    meds = np.zeros(int(lab.max()) + 1)
    sel = lab.ravel() > 0
    if not sel.any():
        return meds
    labs = lab.ravel()[sel]
    vals = values.ravel()[sel].astype(np.float64)
    order = np.lexsort((vals, labs))
    labs, vals = labs[order], vals[order]
    counts = np.bincount(labs)
    ids = np.nonzero(counts)[0]
    starts = np.cumsum(counts)[ids] - counts[ids]
    meds[ids] = vals[starts + (counts[ids] - 1) // 2]
    return meds


def _upsample(small: np.ndarray, shape: tuple[int, int], step: int) -> np.ndarray:
    """Nearest upsample by `step` (np.repeat), then edge-pad/crop to `shape`."""
    up = np.repeat(np.repeat(small, step, axis=0), step, axis=1)
    pad_h, pad_w = shape[0] - up.shape[0], shape[1] - up.shape[1]
    if pad_h > 0 or pad_w > 0:
        up = np.pad(up, ((0, max(pad_h, 0)), (0, max(pad_w, 0))), mode="edge")
    return up[: shape[0], : shape[1]]


def segment(
    channels: dict[str, np.ndarray], px_um: float, thresholds: tuple[float, float] | None = None
) -> np.ndarray:
    """channels: {"BSE" | "ETD" | "InLens": 2D uint8}. Returns uint8 mask (H, W) of Phase codes.

    Works at WORK_STEP=2x downsample internally, upsamples the finished mask to full resolution.
    Hole filling and watershed splitting are NOT baked in (see label_si).
    """
    h0, w0 = channels["BSE"].shape[:2]
    work = preprocess(channels)
    th = thresholds if thresholds is not None else _otsu(work)
    cls = np.digitize(work, th).astype(np.uint8)  # 0 pore, 1 graphite, 2 Si

    px_work = px_um * WORK_STEP
    si = cls == Phase.SI
    # Thin bright rims along graphite edges are binder, not silicon; other opening losses -> graphite.
    r = max(1, round(BINDER_MAX_WIDTH_UM / px_work / 2))
    rim = si & ~opening(si, disk(r))
    near_graphite = binary_dilation(cls == Phase.GRAPHITE, np.ones((3, 3)))
    cls[rim & near_graphite] = Phase.BINDER
    cls[rim & ~near_graphite] = Phase.GRAPHITE

    si = cls == Phase.SI
    min_px = max(1, round(MIN_SI_AREA_UM2 / px_work**2))
    pieces = label(si, connectivity=2)
    too_small = np.bincount(pieces.ravel()) < min_px
    too_small[0] = False
    cls[si & too_small[pieces]] = Phase.GRAPHITE

    # Bright-but-not-Si objects (carbon-binder domain, surfaces seen through pores) -> BINDER
    vr = valid_rows(work.shape[0])
    g = _smoothed_mode(work[vr][cls[vr] == Phase.GRAPHITE])
    if g > 0:
        si = cls == Phase.SI
        pieces = label(si, connectivity=2)
        dim = _label_median(work, pieces) < SI_MIN_CONTRAST * g
        dim[0] = False
        cls[si & dim[pieces]] = Phase.BINDER

    rows = valid_rows(work.shape[0])
    cls[: rows.start] = Phase.IGNORE
    cls[rows.stop :] = Phase.IGNORE
    return _upsample(cls, (h0, w0), WORK_STEP).astype(np.uint8)


def label_si(mask: np.ndarray, px_um: float) -> tuple[np.ndarray, np.ndarray, int]:
    """Si particle labels (int32) and hole-filled Si mask at work res, plus the step used.

    Touching particles are split by a conservative watershed (h-maxima markers, h = 0.25 um).
    """
    step = WORK_STEP if min(mask.shape) >= 200 else 1
    sub = mask[::step, ::step]
    filled = binary_fill_holes(sub == Phase.SI)
    dist = distance_transform_edt(filled)
    h = max(1, round(WATERSHED_H_UM / (px_um * step)))
    markers = label(h_maxima(dist, h), connectivity=1)
    labels = (
        watershed(-dist, markers, mask=filled)
        if markers.max() > 0
        else label(filled, connectivity=2)
    )
    return labels.astype(np.int32), filled, step


def two_point(
    mask: np.ndarray, phase: Phase, px_um: float, r_max_um: float = CORR_RMAX_UM
) -> tuple[np.ndarray, np.ndarray]:
    """Normalised two-point correlation C(r) of a phase: r in um, C(0) = 1, C -> 0 far away.

    Computed on the valid band at 4x subsample by zero-padded FFT, radially averaged in 1-px bins.
    """
    sub = mask[valid_rows(mask.shape[0])][::4, ::4]
    w = sub != Phase.IGNORE
    x = (sub == phase).astype(np.float32)
    n_valid = w.sum()
    if not n_valid:
        return np.array([np.nan]), np.array([np.nan])
    phi = x.sum() / n_valid
    if phi <= 0 or phi >= 1:
        return np.array([np.nan]), np.array([np.nan])
    num = fftconvolve(x, x[::-1, ::-1], mode="full")
    cnt = fftconvolve(w.astype(np.float32), w[::-1, ::-1], mode="full")
    h, wdt = x.shape
    yy, xx = np.mgrid[-(h - 1) : h, -(wdt - 1) : wdt]
    px = px_um * 4
    keep = np.hypot(yy, xx) <= r_max_um / px
    bins = np.rint(np.hypot(yy, xx)[keep]).astype(int)
    s2 = np.bincount(bins, weights=num[keep]) / np.maximum(np.bincount(bins, weights=cnt[keep]), 1)
    c = (s2 - phi**2) / (phi - phi**2)
    return np.arange(len(c), dtype=np.float64) * px, c


def _border_ids(labels: np.ndarray, mask_like: np.ndarray) -> set:
    """Label ids touching the left/right image edge or adjacent to the IGNORE band."""
    ids = set(np.unique(np.concatenate([labels[:, 0], labels[:, -1]])).tolist())
    ids |= set(np.unique(labels[binary_dilation(mask_like == Phase.IGNORE, np.ones((3, 3))) & (labels > 0)]))
    ids.discard(0)
    return ids


def _smoothed_mode(values: np.ndarray) -> float:
    """Mode of a 256-bin histogram smoothed with a 5-bin box filter (comb-like data)."""
    idx = np.clip(np.rint(values), 0, 255).astype(np.int64)
    hist = uniform_filter1d(np.bincount(idx, minlength=256).astype(np.float64), size=5, mode="nearest")
    return float(np.argmax(hist))


def _phase_modes(mask: np.ndarray, channels: dict[str, np.ndarray]) -> dict[Phase, float]:
    """Smoothed BSE modes (black-subtracted) of the graphite and Si phases."""
    bse = channels["BSE"]
    sub = bse[::2, ::2].astype(np.float32) - black_level(bse)
    msub = mask[::2, ::2]
    return {p: _smoothed_mode(sub[msub == p]) for p in (Phase.SI, Phase.GRAPHITE) if (msub == p).any()}


def _chords(band_phase: np.ndarray) -> np.ndarray:
    """Lengths of horizontal runs of True pixels; runs touching the left/right edge excluded."""
    padded = np.pad(band_phase, ((0, 0), (1, 1)))
    diff = np.diff(padded.astype(np.int8), axis=1)
    starts = np.nonzero(diff == 1)[1]
    ends = np.nonzero(diff == -1)[1]  # run occupies cols start..end-1; per-row order pairs up
    inside = (starts > 0) & (ends < band_phase.shape[1])
    return (ends - starts)[inside]


def _mean_chord(band_phase: np.ndarray, px_um: float) -> float:
    chords = _chords(band_phase)
    return chords.mean() * px_um if len(chords) else np.nan


def kpis(mask: np.ndarray, px_um: float, channels: dict[str, np.ndarray] | None = None) -> dict[str, float]:
    """Keys must be in schema.KPI_UNITS. Never raises; a failed descriptor comes back NaN."""
    n_valid = int((mask != Phase.IGNORE).sum())
    if not n_valid:
        return {}
    out: dict[str, float] = {}

    def safe(name: str, fn) -> None:
        try:
            out[name] = float(fn())
        except Exception:
            out[name] = float("nan")

    si = mask == Phase.SI
    safe("si_area_frac", lambda: si.sum() / n_valid)
    safe("porosity_apparent", lambda: (mask == Phase.PORE).sum() / n_valid)
    n_graphite = int((mask == Phase.GRAPHITE).sum())
    safe("si_graphite_ratio", lambda: si.sum() / n_graphite if n_graphite else np.nan)

    cache: dict = {}

    def labelled() -> tuple:
        if "parts" not in cache:
            labels, filled, step = label_si(mask, px_um)
            sub = mask[::step, ::step]
            px = px_um * step
            ids = np.unique(labels[labels > 0])
            areas = np.bincount(labels.ravel(), minlength=int(labels.max()) + 1)[ids] * px**2
            d = np.sqrt(4 * areas / np.pi)
            border = np.isin(ids, list(_border_ids(labels, sub)))
            cache["parts"] = (ids, d, areas, border, filled, sub, px)
        return cache["parts"]

    def size_q(q: float) -> float:
        _, d, areas, border, *_ = labelled()
        d, areas = d[~border], areas[~border]
        if not len(d):
            return np.nan
        order = np.argsort(d)
        cum = np.cumsum(areas[order])
        return d[order][min(np.searchsorted(cum, q * cum[-1]), len(d) - 1)]

    safe("si_d50_um", lambda: size_q(0.5))
    safe("si_d90_um", lambda: size_q(0.9))
    safe(
        "si_internal_void_frac",
        lambda: (labelled()[4] & (labelled()[5] != Phase.SI)).sum() / labelled()[4].sum()
        if labelled()[4].sum()
        else np.nan,
    )
    if channels is not None:
        def contrast() -> float:
            modes = _phase_modes(mask, channels)
            return modes[Phase.SI] / modes[Phase.GRAPHITE] if modes.get(Phase.GRAPHITE) else np.nan
        safe("si_contrast_ratio", contrast)

    def fragments() -> float:
        *_, sub, px = labelled()
        pieces = label(sub == Phase.SI, connectivity=2)
        areas = np.bincount(pieces.ravel())[1:] * px**2
        valid_um2 = (sub != Phase.IGNORE).sum() * px**2
        return (np.sqrt(4 * areas / np.pi) < FRAGMENT_MAX_D_UM).sum() / (valid_um2 / 1e4)

    safe("si_fragments_per_1e4um2", fragments)

    def dispersion() -> float:
        *_, sub, px = labelled()
        rows = np.nonzero((sub != Phase.IGNORE).any(axis=1))[0]
        if not len(rows):
            return np.nan
        band = sub[rows[0] : rows[-1] + 1]
        win = int(min(round(DISPERSION_WINDOW_UM / px), min(band.shape)))
        if win < 1:
            return np.nan
        local = []
        for i in range(0, band.shape[0] - win + 1, win):
            for j in range(0, band.shape[1] - win + 1, win):
                w = band[i : i + win, j : j + win]
                if (w != Phase.IGNORE).mean() >= 0.5:
                    local.append((w == Phase.SI).sum() / (w != Phase.IGNORE).sum())
        return np.std(local) / np.mean(local) if len(local) >= 2 and np.mean(local) else np.nan

    safe("si_dispersion_cv", dispersion)

    def agglomerates() -> float:
        *_, sub, px = labelled()
        si_sub = sub == Phase.SI
        if not si_sub.sum():
            return np.nan
        closed = closing(si_sub, disk(max(1, round(AGGLOMERATE_CLOSE_UM / px))))
        domains = label(closed, connectivity=2)
        big = np.sqrt(4 * np.bincount(domains.ravel()) * px**2 / np.pi) > AGGLOMERATE_MIN_D_UM
        big[0] = False
        return si_sub[big[domains]].sum() / si_sub.sum()

    safe("si_agglomerate_frac", agglomerates)

    def corr_length() -> float:
        r_um, c = two_point(mask, Phase.SI, px_um)
        below = np.nonzero(c <= 1 / np.e)[0]
        if not len(below) or below[0] == 0:
            return np.nan
        i = below[0]
        return r_um[i - 1] + (c[i - 1] - 1 / np.e) / (c[i - 1] - c[i]) * (r_um[i] - r_um[i - 1])

    safe("si_corr_length_um", corr_length)

    band = mask[valid_rows(mask.shape[0])]
    safe("graphite_chord_um", lambda: _mean_chord(band == Phase.GRAPHITE, px_um))
    safe("pore_chord_um", lambda: _mean_chord(band == Phase.PORE, px_um))
    safe(
        "graphite_anisotropy",
        lambda: _mean_chord(band == Phase.GRAPHITE, px_um) / _mean_chord(band.T == Phase.GRAPHITE, px_um),
    )

    def connectivity() -> float:
        pore = band == Phase.PORE
        if not pore.sum():
            return np.nan
        sizes = np.bincount(label(pore, connectivity=1).ravel())[1:]
        return sizes.max() / pore.sum()

    safe("pore_connectivity", connectivity)
    return out


def particles(mask: np.ndarray, px_um: float, channels: dict[str, np.ndarray]) -> pd.DataFrame:
    """One row per labelled Si particle (PARTICLE_FEATURE_COLUMNS); never raises."""
    try:
        return _particles(mask, px_um, channels)
    except Exception:
        return pd.DataFrame(columns=PARTICLE_FEATURE_COLUMNS)


def _particles(mask: np.ndarray, px_um: float, channels: dict[str, np.ndarray]) -> pd.DataFrame:
    labels, _, step = label_si(mask, px_um)
    if int(labels.max()) == 0:
        return pd.DataFrame(columns=PARTICLE_FEATURE_COLUMNS)
    full = _upsample(labels, mask.shape, step)
    border_ids = _border_ids(full, mask)
    bse = channels["BSE"].astype(np.float32) - black_level(channels["BSE"])
    modes = _phase_modes(mask, channels)
    gr_mode = modes.get(Phase.GRAPHITE, np.nan)
    inlens = channels.get("InLens")
    inl_sub = inlens.astype(np.float32) - black_level(inlens) if inlens is not None else None
    margin = int(np.ceil(RING_UM[1] / px_um)) + 2
    rows = []
    for prop in regionprops(full):
        try:
            rows.append(
                _particle_row(prop, full, mask, bse, inlens, inl_sub, gr_mode, border_ids, margin, px_um)
            )
        except Exception:
            rows.append({"particle_id": int(prop.label)})
    return pd.DataFrame(rows, columns=PARTICLE_FEATURE_COLUMNS)


def _particle_row(
    prop, full, mask, bse, inlens, inl_sub, gr_mode, border_ids, margin, px_um
) -> dict:
    y0 = max(0, prop.bbox[0] - margin)
    x0 = max(0, prop.bbox[1] - margin)
    y1 = min(mask.shape[0], prop.bbox[2] + margin)
    x1 = min(mask.shape[1], prop.bbox[3] + margin)
    plab = full[y0:y1, x0:x1] == prop.label
    pmask = mask[y0:y1, x0:x1]
    area_px = plab.sum()
    area_um2 = area_px * px_um**2
    si_px = plab & (pmask == Phase.SI)
    pbse = bse[y0:y1, x0:x1]
    row = {
        "particle_id": int(prop.label),
        "d_um": float(np.sqrt(4 * area_um2 / np.pi)),
        "area_um2": float(area_um2),
        "void_frac": float((plab & (pmask != Phase.SI)).sum() / area_px),
        "solidity": float(prop.solidity),
        "border": bool(prop.label in border_ids),
        "y_px": float(prop.centroid[0]),
        "x_px": float(prop.centroid[1]),
    }
    si_bse = pbse[si_px]
    row["contrast_ratio"] = float(np.median(si_bse) / gr_mode) if si_px.sum() and gr_mode else np.nan
    pvals = pbse[plab]
    row["texture"] = float(pvals.std() / pvals.mean()) if pvals.mean() else np.nan
    if inl_sub is not None:
        icrop = inl_sub[y0:y1, x0:x1]
        unsat = inlens[y0:y1, x0:x1] < 255
        dist = distance_transform_edt(~plab) * px_um
        ring = (dist >= RING_UM[0]) & (dist <= RING_UM[1]) & (pmask == Phase.GRAPHITE) & unsat
        inside = plab & unsat
        row["inlens_ratio"] = (
            float(icrop[inside].mean() / icrop[ring].mean())
            if inside.sum() >= MIN_RING_PIXELS and ring.sum() >= MIN_RING_PIXELS
            else np.nan
        )
    else:
        row["inlens_ratio"] = np.nan
    return row


def imaging(channels: dict[str, np.ndarray], px_um: float = 0.025) -> dict[str, dict[str, float]]:
    """Per-channel imaging descriptors (PLAN_v3 §3.3); a failed channel comes back all-NaN."""
    keys = ["black_level", "p1", "p50", "p99", "noise", "sharpness", "saturated_frac", "curtaining_index"]
    out = {}
    for name, img in channels.items():
        try:
            out[name] = _imaging_channel(img, px_um)
        except Exception:
            out[name] = {k: float("nan") for k in keys}
    return out


def _bandpass(profile: np.ndarray, px_um: float, lo_um: float = 0.2, hi_um: float = 5.0) -> np.ndarray:
    """Keep only components with periods in [lo_um, hi_um] um via FFT masking."""
    n = len(profile)
    spec = np.fft.rfft(profile - profile.mean())
    freqs = np.fft.rfftfreq(n, d=px_um)
    spec[(freqs < 1 / hi_um) | (freqs > 1 / lo_um)] = 0
    return np.fft.irfft(spec, n)


def _imaging_channel(img: np.ndarray, px_um: float) -> dict[str, float]:
    sub = img[::2, ::2]
    subf = sub.astype(np.float32)
    b = black_level(img)
    resid = subf - gaussian(subf, sigma=1, preserve_range=True)
    resid = resid - np.median(resid)
    band = subf[valid_rows(subf.shape[0])] - b
    col_var = _bandpass(band.mean(axis=0), px_um * 2).var()
    row_var = _bandpass(band.mean(axis=1), px_um * 2).var()
    return {
        "black_level": b,
        "p1": float(np.percentile(sub, 1)),
        "p50": float(np.percentile(sub, 50)),
        "p99": float(np.percentile(sub, 99)),
        "noise": float(1.4826 * np.median(np.abs(resid))),
        "sharpness": float(laplace(subf).var()),
        "saturated_frac": float((img == 255).mean()),
        "curtaining_index": float(col_var / row_var) if row_var else np.nan,
    }


if __name__ == "__main__":
    import sys
    from pathlib import Path

    from qc.run import measure, save_tables
    from qc.schema import load_config

    data_dir = Path(load_config()["data_dir"])
    batch_dirs = [Path(p) for p in sys.argv[1:]] or sorted(p for p in data_dir.iterdir() if p.is_dir())
    save_tables(measure(batch_dirs, lambda done, total, tile: print(f"[{done}/{total}] {tile}")))
    print("wrote out/kpis.csv, out/particles.csv, out/imaging.csv and mask overlays in out/masks/")
