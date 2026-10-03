"""ML side: images -> KPI table. Owned by the ML engineer.

Usage: uv run python -m qc.measure [data_dir] [out_csv]
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from skimage.filters import threshold_multiotsu

from qc.io import iter_fields
from qc.schema import KPI_TABLE_COLUMNS, KPI_UNITS, Phase


def segment(channels: dict[str, np.ndarray], px_um: float) -> np.ndarray:
    """channels: {"BSE" | "ETD" | "Inlens": 2D image}. Returns uint8 mask (H, W) of Phase codes."""
    bse = channels["BSE"]
    pore_max = threshold_multiotsu(bse[::4, ::4], classes=3)[0]
    return np.where(bse <= pore_max, Phase.PORE, Phase.ACTIVE).astype(np.uint8)


def kpis(mask: np.ndarray, px_um: float) -> dict[str, float]:
    """Keys must be in KPI_UNITS. Never raises; missing keys become NaN in the table."""
    return {"porosity": float((mask == Phase.PORE).mean())}


def measure(data_dir: Path) -> pd.DataFrame:
    rows = []
    for batch_dir in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        for image_id, channels, px_um in iter_fields(batch_dir):
            values = kpis(segment(channels, px_um), px_um)
            rows.append({"batch": batch_dir.name, "image_id": image_id, "px_um": px_um}
                        | {k: values.get(k, np.nan) for k in KPI_UNITS})
            print(f"{batch_dir.name}/{image_id}: {values}")
    return pd.DataFrame(rows, columns=KPI_TABLE_COLUMNS)


if __name__ == "__main__":
    data_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
    out_csv = Path(sys.argv[2] if len(sys.argv) > 2 else "out/kpis.csv")
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    measure(data_dir).to_csv(out_csv, index=False)
    print(f"wrote {out_csv}")
