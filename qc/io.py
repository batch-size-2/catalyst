from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import tifffile

UM_PER_UNIT = {2: 25_400.0, 3: 10_000.0}


def load_image(path: Path) -> tuple[np.ndarray, float]:
    """Returns (2D greyscale array in original dtype, µm per pixel or NaN)."""
    with tifffile.TiffFile(path) as tif:
        page = tif.pages[0]
        img = page.asarray()
        res, unit = page.tags.get("XResolution"), page.tags.get("ResolutionUnit")
        px_um = np.nan
        if res and unit and int(unit.value) in UM_PER_UNIT:
            num, den = res.value
            px_um = UM_PER_UNIT[int(unit.value)] * den / num
    return (img[..., 0] if img.ndim == 3 else img), px_um


def iter_fields(batch_dir: Path) -> Iterator[tuple[str, dict[str, np.ndarray], float]]:
    """Yields (image_id, {detector: image}, px_um) per field of view.

    Files are named <image_id>_<detector>.tif, e.g. img_4ih2ggld_BSE.tif.
    """
    groups: dict[str, list[Path]] = defaultdict(list)
    for path in sorted(batch_dir.glob("*.tif")):
        groups[path.stem.rsplit("_", 1)[0]].append(path)
    for image_id, paths in groups.items():
        channels, px_um = {}, np.nan
        for path in paths:
            channels[path.stem.rsplit("_", 1)[1]], px_um = load_image(path)
        yield image_id, channels, px_um
