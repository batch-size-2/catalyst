from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import tifffile

from qc.schema import Field

DETECTOR_ALIASES = {"bse": "BSE", "etd": "ETD", "se": "ETD", "inlens": "InLens"}
EDGE_CROP_PX = 8
UM_PER_UNIT = {2: 25_400.0, 3: 10_000.0}


def load_image(path: Path) -> tuple[np.ndarray, float]:
    """Returns (2D uint8, stitch-border columns cropped; µm per pixel or NaN)."""
    with tifffile.TiffFile(path) as tif:
        page = tif.pages[0]
        img = page.asarray()
        res, unit = page.tags.get("XResolution"), page.tags.get("ResolutionUnit")
        px_um = np.nan
        if res and unit and int(unit.value) in UM_PER_UNIT:
            num, den = res.value
            px_um = UM_PER_UNIT[int(unit.value)] * den / num
    img = img[..., 0] if img.ndim == 3 else img
    return img[:, EDGE_CROP_PX:-EDGE_CROP_PX], px_um


def field_paths(batch_dir: Path) -> dict[str, dict[str, Path]]:
    """{image_id: {detector: path}} for files named img_<image_id>_<detector>.tif."""
    fields: dict[str, dict[str, Path]] = defaultdict(dict)
    for path in sorted(batch_dir.iterdir()):
        if path.suffix.lower() not in {".tif", ".tiff"} or "_" not in path.stem:
            continue
        stem, detector = path.stem.rsplit("_", 1)
        fields[stem.removeprefix("img_")][DETECTOR_ALIASES.get(detector.lower(), detector)] = path
    return dict(fields)


def load_field(batch: str, image_id: str, paths: dict[str, Path]) -> Field:
    channels, px_um = {}, np.nan
    for detector, path in paths.items():
        channels[detector], px_um = load_image(path)
    height = next(iter(channels.values())).shape[0]
    return Field(batch=batch, image_id=image_id, strip_id=f"P{height}", channels=channels, px_um=px_um)


def iter_fields(batch_dir: Path) -> Iterator[Field]:
    for image_id, paths in field_paths(batch_dir).items():
        yield load_field(batch_dir.name, image_id, paths)
