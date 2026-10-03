"""Pretrained DINOv2 image features: the `deep_` family (PLAN_v4 §3.15). Owned by the ML engineer.

Optional: `uv sync --extra deep` installs CPU torch and transformers. The weights are the public
facebook/dinov2-small checkpoint at a pinned revision, downloaded once into the Hugging Face cache;
the images never leave the machine. Set HF_HUB_OFFLINE=1 after the first download to forbid any
network access. The model is used as is: no fine-tuning on our images.

Per image and channel in CHANNELS: drop the rows segment() ignores, stretch p1..p99 to 0..1 (removes
the black-level and contrast differences between imaging sessions), average SCALE x SCALE pixel
blocks, cut into TILE px tiles (~11 um at 25 nm/px), embed each tile (CLS token + mean patch token)
and pool over the tiles (mean and SD).

Columns: deep_<channel>_s<scale>_{mean,sd}_<k:03d>. qc/attribute.py replaces the family by its first
DEEP_COMPONENTS principal components, fit inside each training fold, before the logistic fit.

Usage: uv run --extra deep python -m qc.deep [data/Batch_1 ...]   # merges into out/features.csv
"""

from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd

from qc.features import META_COLUMNS, assert_no_leakage, load_features
from qc.measure import valid_rows
from qc.schema import FEATURE_TABLE, Field

MODEL_ID = "facebook/dinov2-small"
MODEL_REVISION = "ed25f3a31f01632728cabb09d1542f84ab7b0056"
CHANNELS = ("InLens",)
SCALE = 2
TILE = 224
BATCH = 16
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], np.float32)

Embed = Callable[[np.ndarray], np.ndarray]  # (n, TILE, TILE) in 0..1 -> (n, d)


def stretch(img: np.ndarray) -> np.ndarray:
    """Valid rows only, p1..p99 mapped to 0..1."""
    img = img[valid_rows(img.shape[0])].astype(np.float32)
    lo, hi = np.percentile(img, [1, 99])
    return np.clip((img - lo) / max(float(hi - lo), 1e-6), 0, 1)


def tiles(img: np.ndarray, scale: int = SCALE, tile: int = TILE) -> np.ndarray:
    """Non-overlapping tiles of the block-averaged image; one reflect-padded tile if it is too small."""
    h, w = img.shape[0] // scale * scale, img.shape[1] // scale * scale
    small = img[:h, :w].reshape(h // scale, scale, w // scale, scale).mean((1, 3))
    out = [small[i:i + tile, j:j + tile] for i in range(0, small.shape[0] - tile + 1, tile) for j in range(0, small.shape[1] - tile + 1, tile)]
    if not out:
        ph, pw = max(0, tile - small.shape[0]), max(0, tile - small.shape[1])
        out = [np.pad(small, ((0, ph), (0, pw)), mode="reflect")[:tile, :tile]]
    return np.stack(out).astype(np.float32)


class Dinov2:
    """Lazy CPU DINOv2: tile batch -> CLS token concatenated with the mean patch token."""

    def __init__(self, model_id: str = MODEL_ID, revision: str = MODEL_REVISION):
        self.model_id, self.revision, self._model = model_id, revision, None

    def __call__(self, x: np.ndarray) -> np.ndarray:
        import torch

        if self._model is None:
            from transformers import AutoModel

            self._model = AutoModel.from_pretrained(self.model_id, revision=self.revision).eval()
        rgb = (x[..., None].repeat(3, -1) - IMAGENET_MEAN) / IMAGENET_STD
        out = []
        with torch.no_grad():
            for i in range(0, len(rgb), BATCH):
                t = torch.from_numpy(np.ascontiguousarray(rgb[i:i + BATCH].transpose(0, 3, 1, 2)))
                h = self._model(pixel_values=t).last_hidden_state
                out.append(torch.cat([h[:, 0], h[:, 1:].mean(1)], 1).numpy())
        return np.concatenate(out)


_default: Dinov2 | None = None


def default_embed() -> Dinov2:
    global _default
    _default = _default or Dinov2()
    return _default


def deep_features(field: Field, embed: Embed | None = None, channels=CHANNELS, scale: int = SCALE, tile: int = TILE) -> dict:
    """META_COLUMNS plus pooled tile embeddings for one field."""
    embed = embed or default_embed()
    row: dict = {"batch": field.batch, "image_id": field.image_id, "strip_id": field.strip_id}
    for ch in channels:
        emb = np.asarray(embed(tiles(stretch(field.channels[ch]), scale, tile)), float)
        name = f"deep_{ch.lower()}_s{scale}"
        row |= {f"{name}_mean_{k:03d}": v for k, v in enumerate(emb.mean(0))}
        row |= {f"{name}_sd_{k:03d}": v for k, v in enumerate(emb.std(0))}
    assert_no_leakage(row)
    return row


def build_deep(batch_dirs, progress=None, embed: Embed | None = None) -> pd.DataFrame:
    from qc.io import field_paths, load_field

    jobs = [(d.name, image_id, paths) for d in batch_dirs for image_id, paths in field_paths(d).items()]
    rows = []
    for i, (batch, image_id, paths) in enumerate(jobs):
        rows.append(deep_features(load_field(batch, image_id, paths), embed))
        if progress:
            progress(i + 1, len(jobs), f"{batch}/{image_id}")
    return pd.DataFrame(rows)


def merge_deep(feats: pd.DataFrame, deep: pd.DataFrame) -> pd.DataFrame:
    """`feats` with its deep_ columns replaced, for the (batch, image_id) rows in `deep`."""
    keys = ["batch", "image_id"]
    old = feats[keys + [c for c in feats.columns if c.startswith("deep_")]]
    new = deep.drop(columns=[c for c in META_COLUMNS if c not in keys])
    old = old[~old.set_index(keys).index.isin(new.set_index(keys).index)]
    merged = pd.concat([old, new], ignore_index=True)
    out = feats.drop(columns=old.columns.difference(keys)).merge(merged, on=keys, how="left")
    assert_no_leakage(out.columns)
    return out


if __name__ == "__main__":
    import sys

    from qc.schema import load_config

    data_dir = Path(load_config()["data_dir"])
    batch_dirs = [Path(p) for p in sys.argv[1:]] or sorted(p for p in data_dir.iterdir() if p.is_dir())
    if not FEATURE_TABLE.exists():
        raise SystemExit(f"no {FEATURE_TABLE}: run `uv run python -m qc.features` first")
    deep = build_deep(batch_dirs, lambda done, total, s: print(f"[{done}/{total}] {s}", flush=True))
    out = merge_deep(load_features(), deep)
    out.to_csv(FEATURE_TABLE, index=False)
    print(f"wrote {FEATURE_TABLE}: {len(deep)} images, {deep.shape[1] - len(META_COLUMNS)} deep features")
