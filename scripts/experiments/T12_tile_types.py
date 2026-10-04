"""T12: tile-type pooling (docs/experiments/T12.md). Reuses T11's InLens tile embeddings.

Usage: PYTHONPATH=. uv run python scripts/experiments/T12_tile_types.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from skimage.io import imsave
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA

from qc import attribute as A
from qc import deep as D
from qc.features import load_features
from qc.io import iter_fields

OUT = Path("out/experiments/T12")
TILES = Path("out/experiments/T11/tiles.npz")
K, N_PCS, N_PERM = 8, 10, 200
KNOWN = [Path("data/Batch_1"), Path("data/Batch_2"), Path("data/Batch_3")]


def shares(emb: dict, ids, km: KMeans) -> np.ndarray:
    return np.array([np.bincount(km.predict(emb[i]), minlength=K) / len(emb[i]) for i in ids])


def quantiles(emb: dict, ids, pca: PCA) -> np.ndarray:
    return np.array([np.concatenate([np.percentile(z := pca.transform(emb[i]), 10, axis=0), np.percentile(z, 90, axis=0)]) for i in ids])


def featurise(kind: str, emb: dict, train_ids, ids) -> np.ndarray:
    bank = np.vstack([emb[i] for i in train_ids])
    if kind == "shares":
        return shares(emb, ids, KMeans(K, n_init=10, random_state=0).fit(bank))
    return quantiles(emb, ids, PCA(N_PCS, random_state=0).fit(bank))


def loso(df: pd.DataFrame, emb: dict, kind: str, nested: bool = True) -> float:
    y, groups = df["batch"].to_numpy(str), df["strip_id"].map(A.strip_group).to_numpy()
    pred = np.empty(len(y), dtype=object)
    for g in np.unique(groups):
        te = groups == g
        tr_ids = df.image_id[~te].tolist()
        Xtr = featurise(kind, emb, tr_ids, tr_ids)
        Xte = featurise(kind, emb, tr_ids, df.image_id[te].tolist())
        std = A.Standardiser(Xtr)
        Ztr, Zte = std(Xtr), std(Xte)
        C = A._choose_c(Ztr, y[~te], groups[~te]) if nested else A.C_GRID[2]
        pred[te] = A._fit_lr(Ztr, y[~te], C).predict(Zte)
    return A.balanced_accuracy(y, pred.astype(str))


def gallery(df: pd.DataFrame, emb: dict) -> dict:
    """k=8 on all tiles (label-free); 6 tiles nearest each centre, and the type shares per batch."""
    ids = df.image_id.tolist()
    km = KMeans(K, n_init=10, random_state=0).fit(np.vstack([emb[i] for i in ids]))
    owners = [(i, j) for i in ids for j in range(len(emb[i]))]
    allv = np.vstack([emb[i] for i in ids])
    d = np.linalg.norm(allv - km.cluster_centers_[km.labels_], axis=1)
    fields = {f.image_id: f for p in KNOWN for f in iter_fields(p)}
    tile_px = {}
    rows = []
    for t in range(K):
        idx = np.where(km.labels_ == t)[0]
        pick = idx[np.argsort(d[idx])[:6]]
        row = []
        for p in pick:
            i, j = owners[p]
            if i not in tile_px:
                tile_px[i] = D.tiles(D.stretch(fields[i].channels["InLens"]))
            row.append(np.pad(tile_px[i][j], 4, constant_values=1.0))
        while len(row) < 6:
            row.append(np.ones_like(row[0]))
        rows.append(np.hstack(row))
    imsave("docs/experiments/T12_tile_types.png", (np.vstack(rows)[::2, ::2] * 255).astype(np.uint8), check_contrast=False)
    sh = pd.DataFrame(shares(emb, ids, km), columns=[f"type{t}" for t in range(K)])
    sh["batch"] = df.batch.to_numpy()
    return json.loads(sh.groupby("batch").mean().round(3).to_json())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = load_features()[["batch", "image_id", "strip_id"]].reset_index(drop=True)
    assert set(df.batch) == {"Batch_1", "Batch_2", "Batch_3"} and len(df) == 31
    emb = np.load(TILES, allow_pickle=True)["emb"].item()
    res = {k: {"loso": loso(df, emb, k)} for k in ("shares", "quantiles")}
    print(res, flush=True)
    rng = np.random.default_rng(0)
    seg = A.segments_of(df)
    seg_batch = df.groupby(seg)["batch"].first()
    scores = {k: [] for k in res}
    for s in range(N_PERM):
        fake = df.copy()
        fake["batch"] = seg.map(pd.Series(rng.permutation(seg_batch.to_numpy()), index=seg_batch.index)).to_numpy()
        if fake.batch.nunique() < 3:
            continue
        for k in res:
            scores[k].append(loso(fake, emb, k, nested=False))
        if (s + 1) % 25 == 0:
            print(f"null {s + 1}/{N_PERM}", flush=True)
    S = pd.DataFrame(scores)
    for k in res:
        res[k]["null_p95"] = float(np.percentile(S[k], 95))
    res["best_of_2_null_p95"] = float(np.percentile(S.max(axis=1), 95))
    res["type_shares_by_batch"] = gallery(df, emb)
    (OUT / "result.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
