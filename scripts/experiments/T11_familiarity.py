"""T11: compare familiarity distances against Batch_3 (docs/experiments/T11.md).

Usage: PYTHONPATH=. uv run python scripts/experiments/T11_familiarity.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from skimage.io import imsave
from skimage.transform import resize
from sklearn.covariance import LedoitWolf
from sklearn.metrics import roc_auc_score

from qc import attribute as A
from qc import deep as D
from qc.features import MATERIAL_FAMILIES, load_features
from qc.io import iter_fields

OUT = Path("out/experiments/T11")
KNOWN = [Path("data/Batch_1"), Path("data/Batch_2"), Path("data/Batch_3")]
BASELINE = "Batch_3"
TOP_FRAC = 0.10
HEATMAP_IDS = ("4ih2ggld", "5n1q8atc", "ffwubibz")


# ---------------------------------------------------------------- tile embeddings

def tile_bank() -> tuple[dict, dict, dict]:
    cache = OUT / "tiles.npz"
    fields = {f.image_id: f for d in KNOWN for f in iter_fields(d)}
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        emb, grid = z["emb"].item(), z["grid"].item()
    else:
        embed = D.default_embed()
        emb, grid = {}, {}
        for i, f in fields.items():
            img = D.stretch(f.channels["InLens"])
            t = D.tiles(img)
            e = np.asarray(embed(t), float)
            emb[i] = e / np.linalg.norm(e, axis=1, keepdims=True)
            h, w = img.shape[0] // D.SCALE, img.shape[1] // D.SCALE
            grid[i] = (max(1, h // D.TILE), max(1, w // D.TILE))
            print(f"tiles {i}: {len(e)}", flush=True)
        np.savez(cache, emb=np.array(emb, dtype=object), grid=np.array(grid, dtype=object))
    return emb, grid, fields


def tile_scores(test: np.ndarray, bank: np.ndarray) -> np.ndarray:
    d2 = (test**2).sum(1)[:, None] + (bank**2).sum(1)[None] - 2 * test @ bank.T
    return np.sqrt(np.clip(d2, 0, None)).min(1)


def top_mean(v: np.ndarray) -> float:
    k = max(1, int(np.ceil(TOP_FRAC * len(v))))
    return float(np.sort(v)[-k:].mean())


# ---------------------------------------------------------------- methods: (reference rows, all rows, scored row) -> score

def m0_rms_z(ref: pd.DataFrame, x: pd.Series, feats: list[str]) -> float:
    seg = ref["strip_id"].map(A.strip_group)
    sm = ref[feats].apply(pd.to_numeric, errors="coerce").groupby(seg).mean()
    m, s = sm.mean().to_numpy(float), sm.std(ddof=1).to_numpy(float)
    s = np.where(np.isfinite(s) & (s > 0), s, np.nan)
    return A._rms_z((pd.to_numeric(x[feats], errors="coerce").to_numpy(float) - m) / s)


def _pcs(fit_rows: pd.DataFrame, deep: list[str]) -> A.Reducer:
    return A.Reducer(A._matrix(fit_rows, deep), deep)


def _maha(fit: np.ndarray, x: np.ndarray) -> float:
    lw = LedoitWolf().fit(fit)
    d = x - lw.location_
    return float(np.sqrt(d @ lw.precision_ @ d))


def m_a(ref, background, x, deep):
    red = _pcs(ref, deep)
    return _maha(red(A._matrix(ref, deep)), red(A._matrix(x.to_frame().T, deep))[0])


def m_b(ref, background, x, deep):
    red = _pcs(ref, deep)
    xr = red(A._matrix(x.to_frame().T, deep))[0]
    return _maha(red(A._matrix(ref, deep)), xr) - _maha(red(A._matrix(background, deep)), xr)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = load_features().reset_index(drop=True)
    assert set(df.batch) == {"Batch_1", "Batch_2", "Batch_3"} and len(df) == 31
    df["strip"] = df["strip_id"].map(A.strip_group)
    mat = A.usable_features(df, MATERIAL_FAMILIES)
    deep = A.usable_features(df, ("deep",))
    emb, grid, fields = tile_bank()
    b3 = df[df.batch == BASELINE]
    strips = sorted(b3.strip.unique())

    def score_all(ref, x):
        background = df[df.strip != x["strip"]]
        bank = np.vstack([emb[i] for i in ref.image_id])
        return {"0 rms_z": m0_rms_z(ref, x, mat), "a shrunk_maha": m_a(ref, background, x, deep),
                "b relative_maha": m_b(ref, background, x, deep), "c tile_nn": top_mean(tile_scores(emb[x.image_id], bank))}

    rows = []
    for _, x in df.iterrows():
        if x.batch == BASELINE:
            s = score_all(b3[b3.strip != x.strip], x)
        else:
            per = [score_all(b3[b3.strip != h], x) for h in strips]
            s = {k: float(np.median([p[k] for p in per])) for k in per[0]}
        rows.append({"batch": x.batch, "image_id": x.image_id, "strip": x.strip, **s})
        print(x.image_id, {k: round(v, 3) for k, v in s.items()}, flush=True)
    scores = pd.DataFrame(rows)
    scores.to_csv(OUT / "scores.csv", index=False)
    methods = [c for c in scores.columns if c[0] in "0abc" and " " in c]
    res = {}
    is_out = (scores.batch != BASELINE).to_numpy()
    for m in methods:
        thr = scores.loc[~is_out, m].max()
        res[m] = {"auc": float(roc_auc_score(is_out, scores[m])), "threshold": float(thr),
                  "flags_of_14": int((scores.loc[is_out, m] > thr).sum()),
                  "flagged": scores.loc[is_out & (scores[m] > thr), "image_id"].tolist()}
    base_auc = res["0 rms_z"]["auc"]
    for m in methods:
        res[m]["better"] = bool(m != "0 rms_z" and res[m]["auc"] >= base_auc + 0.15 and res[m]["flags_of_14"] >= 4)
    (OUT / "result.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))
    heatmaps(emb, grid, fields, b3)


def heatmaps(emb, grid, fields, b3) -> None:
    """Per-tile NN distance to the full Batch_3 bank, red overlay on the InLens image, 3 panels side by side."""
    bank = np.vstack([emb[i] for i in b3.image_id])
    panels = []
    for i in HEATMAP_IDS:
        img = D.stretch(fields[i].channels["InLens"])
        gh, gw = grid[i]
        d = tile_scores(emb[i], bank)[: gh * gw].reshape(gh, gw)
        h, w = gh * D.TILE * D.SCALE, gw * D.TILE * D.SCALE
        base = resize(img[:h, :w], (h // 8, w // 8), anti_aliasing=True)
        heat = resize((d - d.min()) / max(d.max() - d.min(), 1e-6), base.shape, order=0)  # per-image min-max
        g = base * (1 - 0.5 * heat)
        rgb = np.stack([np.clip(g + 0.5 * heat, 0, 1), g, g], -1)
        panels.append(rgb)
    hmax = max(p.shape[0] for p in panels)
    panels = [np.pad(p, ((0, hmax - p.shape[0]), (0, 8), (0, 0)), constant_values=1) for p in panels]
    imsave("docs/experiments/T11_heatmaps.png", (np.hstack(panels) * 255).astype(np.uint8), check_contrast=False)


if __name__ == "__main__":
    main()
