"""T9 post-hoc control (not pre-registered): erase k=3 PCs of row-shuffled imaging covariates.

Same covariance structure as the real covariates, link to the images broken. If accuracy stays near the
plain run, the collapse in T9 is specific to the imaging; if it also collapses, the erasure itself
destroys signal at n = 31.

Usage: PYTHONPATH=. uv run python scripts/experiments/T9_control.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from qc import attribute as A
from qc.features import MATERIAL_FAMILIES, load_features

from T9_imaging_erasure import BASELINE, DARK, EXCLUDE, OUT, two_way  # noqa: E402

N_DRAWS = 20


def main() -> None:
    df = load_features()
    dark = pd.read_csv("out/experiments/T2/dark_share.csv").set_index("image_id")["dark_graphite_share"]
    df[DARK] = dark.loc[df["image_id"]].to_numpy()
    covs = [c for c in df.columns if c.startswith("img_") and c not in EXCLUDE and c != DARK] + [DARK]
    shuf = [f"shuf_{c}" for c in covs]
    runs = {"1 B3-vs-rest tex": (two_way(df), {"families": ("tex",)}),
            "4 three-way material>deep": (df, {"staged": (MATERIAL_FAMILIES, ("deep",)), "baseline": BASELINE})}
    rng = np.random.default_rng(0)
    result = {}
    for name, (data, kw) in runs.items():
        accs = []
        for _ in range(N_DRAWS):
            d = data.copy()
            d[shuf] = d[covs].to_numpy()[rng.permutation(len(d))]
            accs.append(A.loso_cv(d, residualize={"columns": shuf, "scope": "all", "k": 3}, **kw)["balanced_accuracy"])
        result[name] = {"draws": N_DRAWS, "mean": float(np.mean(accs)), "p05": float(np.percentile(accs, 5)), "p95": float(np.percentile(accs, 95))}
        print(name, json.dumps(result[name]), flush=True)
    (OUT / "control.json").write_text(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
