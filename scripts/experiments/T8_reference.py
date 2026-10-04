"""T8 post-hoc reference (NOT pre-registered): the same T8 code with no copies at all.

Separates the effect of augmentation from that of the code path (nested C, sample weights).

Usage: PYTHONPATH=.:scripts/experiments uv run python scripts/experiments/T8_reference.py
"""

import json

import T1_invariance_audit as T1
from T8_train_augmentation import OUT, loso
from qc import attribute as A
from qc.features import MATERIAL_FAMILIES, load_features


def main() -> None:
    orig = load_features().reset_index(drop=True)
    meta = orig.set_index("image_id")[["batch", "strip_id"]]
    cache = T1.read_cache()
    cache = cache[cache.perturbation != "none"].copy()
    cache["batch"] = cache["image_id"].map(meta["batch"])
    cache["strip_id"] = cache["image_id"].map(meta["strip_id"])
    none = cache.iloc[:0]
    models = {"deep": A.usable_features(orig, ("deep",)),
              "material>deep": (A.usable_features(orig, MATERIAL_FAMILIES), A.usable_features(orig, ("deep",)))}
    res = {f"none | {mn}": loso(orig, none, feats, None, nested=True, eval_copies=cache) for mn, feats in models.items()}
    print(json.dumps(res, indent=1))
    (OUT / "reference.json").write_text(json.dumps(res, indent=2, default=float))


if __name__ == "__main__":
    main()
