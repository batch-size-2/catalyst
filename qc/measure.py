"""ML side: channels -> mask -> KPIs. Owned by the ML engineer (PLAN_v1 §3.1-3.2).

Usage: uv run python -m qc.measure [data/Batch_1 ...]   # default: every folder in data/ -> out/kpis.csv + out/masks/
"""

import numpy as np
from skimage.filters import gaussian, threshold_multiotsu

from qc.schema import Phase


def segment(channels: dict[str, np.ndarray], px_um: float) -> np.ndarray:
    """channels: {"BSE" | "ETD" | "InLens": 2D uint8}. Returns uint8 mask (H, W) of Phase codes."""
    bse = gaussian(channels["BSE"], sigma=2, preserve_range=True)
    thresholds = threshold_multiotsu(bse[::4, ::4], classes=3)
    return np.digitize(bse, thresholds).astype(np.uint8)


def kpis(mask: np.ndarray, px_um: float, channels: dict[str, np.ndarray] | None = None) -> dict[str, float]:
    """Keys must be in schema.KPI_UNITS. Never raises; omit or NaN what you can't compute."""
    valid = (mask != Phase.IGNORE).sum()
    if not valid:
        return {}
    return {
        "si_area_frac": float((mask == Phase.SI).sum() / valid),
        "porosity_apparent": float((mask == Phase.PORE).sum() / valid),
    }


if __name__ == "__main__":
    import sys
    from pathlib import Path

    from qc.run import measure, save_kpi_table
    from qc.schema import KPI_TABLE, load_config

    data_dir = Path(load_config()["data_dir"])
    batch_dirs = [Path(p) for p in sys.argv[1:]] or sorted(p for p in data_dir.iterdir() if p.is_dir())
    save_kpi_table(measure(batch_dirs, lambda done, total, tile: print(f"[{done}/{total}] {tile}")))
    print(f"wrote {KPI_TABLE} and mask overlays in out/masks/")
