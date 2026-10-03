from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import tifffile
from skimage.exposure import rescale_intensity
from skimage.io import imsave
from skimage.transform import resize

from qc.schema import Field, PREVIEWS_DIR

DETECTOR_ALIASES = {"bse": "BSE", "etd": "ETD", "se": "ETD", "inlens": "InLens"}
EDGE_CROP_PX = 8
UM_PER_UNIT = {2: 25_400.0, 3: 10_000.0}
PREVIEW_SIZES = (512, 2048)


def load_image(path: Path) -> tuple[np.ndarray, float, float]:
    """Returns (2D uint8 with stitch-border columns cropped, µm per pixel, raw XResolution tag); NaN if unknown."""
    with tifffile.TiffFile(path) as tif:
        page = tif.pages[0]
        img = page.asarray()
        res, unit = page.tags.get("XResolution"), page.tags.get("ResolutionUnit")
        xres = px_um = np.nan
        if res:
            num, den = res.value
            xres = num / den
            if unit and int(unit.value) in UM_PER_UNIT:
                px_um = UM_PER_UNIT[int(unit.value)] / xres
    img = img[..., 0] if img.ndim == 3 else img
    return img[:, EDGE_CROP_PX:-EDGE_CROP_PX], px_um, xres


def tile_geometry(path: Path) -> tuple[int, int, float]:
    """(height, width, µm per pixel) of a TIFF after the stitch-border crop, from its header only."""
    with tifffile.TiffFile(path) as tif:
        page = tif.pages[0]
        height, width = page.shape[:2]
        res, unit = page.tags.get("XResolution"), page.tags.get("ResolutionUnit")
        px_um = np.nan
        if res and unit and int(unit.value) in UM_PER_UNIT:
            num, den = res.value
            px_um = UM_PER_UNIT[int(unit.value)] / (num / den)
    return height, width - 2 * EDGE_CROP_PX, px_um


def field_paths(batch_dir: Path) -> dict[str, dict[str, Path]]:
    """{image_id: {detector: path}} for files named img_<image_id>_<detector>.tif."""
    fields: dict[str, dict[str, Path]] = defaultdict(dict)
    for path in sorted(batch_dir.iterdir()):
        if path.suffix.lower() not in {".tif", ".tiff"} or "_" not in path.stem:
            continue
        stem, detector = path.stem.rsplit("_", 1)
        fields[stem.removeprefix("img_")][DETECTOR_ALIASES.get(detector.lower(), detector)] = path
    return dict(fields)


def black_level(image: np.ndarray) -> float:
    """0.5th percentile of a uint8 image, from its 256-bin histogram (cheap on ~12 MP fields)."""
    cdf = np.cumsum(np.bincount(image.ravel(), minlength=256))
    return float(np.searchsorted(cdf, image.size * 0.005))


def load_field(batch: str, image_id: str, paths: dict[str, Path]) -> Field:
    """strip_id = "<height>_<xres>" groups tiles cut from one strip (PLAN_v4 §1.1). Provenance only, never a feature."""
    channels, black, px_um, xres = {}, {}, np.nan, np.nan
    for detector, path in paths.items():
        channels[detector], px_um, xres = load_image(path)
        black[detector] = black_level(channels[detector])
    height = next(iter(channels.values())).shape[0]
    strip_id = f"{height}_{round(xres)}" if np.isfinite(xres) else str(height)
    return Field(batch=batch, image_id=image_id, strip_id=strip_id, channels=channels, px_um=px_um,
                 black_level=black)


def iter_fields(batch_dir: Path) -> Iterator[Field]:
    for image_id, paths in field_paths(batch_dir).items():
        yield load_field(batch_dir.name, image_id, paths)


def preview_png(path: Path, max_side: int) -> Path:
    """A small PNG of one detector TIFF for the UI: 1–99 percentile stretch, longest side <= max_side.

    Cached at out/previews/<batch>/<image_id>_<detector>_<max_side>.png; reused while newer than the TIFF.
    """
    if max_side not in PREVIEW_SIZES:
        raise ValueError(f"preview size must be one of {PREVIEW_SIZES}")
    stem, detector = path.stem.rsplit("_", 1)
    cache = PREVIEWS_DIR / path.parent.name / f"{stem.removeprefix('img_')}_{detector}_{max_side}.png"
    if cache.exists() and cache.stat().st_mtime >= path.stat().st_mtime:
        return cache
    image, _, _ = load_image(path)
    lo, hi = np.percentile(image, (1, 99))
    stretched = rescale_intensity(image.astype(float), in_range=(lo, hi), out_range=(0, 255))
    scale = max_side / max(image.shape)
    if scale < 1:
        stretched = resize(stretched, (round(image.shape[0] * scale), round(image.shape[1] * scale)),
                           anti_aliasing=True, preserve_range=True)
    cache.parent.mkdir(parents=True, exist_ok=True)
    imsave(cache, stretched.astype(np.uint8), check_contrast=False)
    return cache
