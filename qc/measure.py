"""ML side: Field -> mask -> KPIs. Owned by the ML engineer (PLAN_v1 §4.2).

qc/run.py calls both functions once per field. To explore: `for f in qc.io.iter_fields(Path("data/Batch_1")): ...`
"""

import numpy as np
from skimage.filters import gaussian, threshold_multiotsu

from qc.schema import Field, Phase


def segment(field: Field) -> np.ndarray:
    """Returns uint8 mask (H, W) of Phase codes, same shape as the channels."""
    bse = gaussian(field.channels["BSE"], sigma=2, preserve_range=True)
    thresholds = threshold_multiotsu(bse[::4, ::4], classes=3)
    return np.digitize(bse, thresholds).astype(np.uint8)


def kpis(field: Field, mask: np.ndarray) -> dict[str, float]:
    """Keys must be in schema.KPI_UNITS. Never raises; omit or NaN what you can't compute."""
    pore, graphite, si = ((mask == p).mean() for p in (Phase.PORE, Phase.GRAPHITE, Phase.SI_PARTICLE))
    return {
        "si_frac": float(si),
        "si_graphite_ratio": float(si / graphite) if graphite else np.nan,
        "apparent_porosity": float(pore),
    }
