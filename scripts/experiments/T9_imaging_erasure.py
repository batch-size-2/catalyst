"""T9: remove what the measured imaging explains, then re-evaluate (docs/experiments/T9.md).

Usage: PYTHONPATH=. uv run python scripts/experiments/T9_imaging_erasure.py
Needs out/features.csv (31 known images) and out/experiments/T2/dark_share.csv (from T2).
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from qc import attribute as A
from qc.features import MATERIAL_FAMILIES, load_features

OUT = Path("out/experiments/T9")
DARK = "img_inlens_dark_graphite_share"
EXCLUDE = {"img_bse_p1", "img_bse_p50", "img_bse_p99"}  # composition-sensitive: removing them would remove material
N_PERM = 200
BASELINE = "Batch_3"


def two_way(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["batch"] = np.where(out["batch"] == BASELINE, BASELINE, "rest")
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = load_features()
    assert set(df.batch) == {"Batch_1", "Batch_2", "Batch_3"} and len(df) == 31
    dark = pd.read_csv("out/experiments/T2/dark_share.csv").set_index("image_id")["dark_graphite_share"]
    df[DARK] = dark.loc[df["image_id"]].to_numpy()
    covs = [c for c in df.columns if c.startswith("img_") and c not in EXCLUDE and c != DARK] + [DARK]
    assert len(covs) == 22, len(covs)
    spec = lambda k: {"columns": covs, "scope": "all", "k": k}
    staged = (MATERIAL_FAMILIES, ("deep",))
    runs = {
        "1 B3-vs-rest tex": (two_way(df), {"families": ("tex",)}),
        "2 B3-vs-rest material": (two_way(df), {"families": MATERIAL_FAMILIES}),
        "3 three-way deep": (df, {"families": ("deep",)}),
        "4 three-way material>deep": (df, {"staged": staged, "baseline": BASELINE}),
    }
    result = {"covariates": covs}
    for name, (data, kw) in runs.items():
        plain = A.loso_cv(data, **kw)["balanced_accuracy"]
        erased = A.loso_cv(data, residualize=spec(3), **kw)
        null = A.permutation_null(data, n=N_PERM, seed=0, residualize=spec(3), **kw)
        result[name] = {"plain": plain, "erased_k3": erased["balanced_accuracy"], "erased_confusion": erased["confusion"], "null_k3": null}
        if name[0] in "14":
            result[name] |= {f"erased_k{k}": A.loso_cv(data, residualize=spec(k), **kw)["balanced_accuracy"] for k in (1, 5)}
        print(name, json.dumps(result[name], default=float), flush=True)
        (OUT / "result.json").write_text(json.dumps(result, indent=2, default=float))


if __name__ == "__main__":
    main()
