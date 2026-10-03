"""T10: texture at the material scale (docs/experiments/T10.md).

Columns are named tex_m_* and always passed explicitly as `features=`, so they never mix with tex_.

Usage: PYTHONPATH=.:scripts/experiments uv run python scripts/experiments/T10_texture_scale.py
"""

import json
import zlib
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.ndimage import gaussian_filter
from skimage.feature import graycomatrix, graycoprops, local_binary_pattern

from qc import attribute as A
from qc.features import GLCM_LEVELS, GLCM_PROPS, LBP_BINS, LBP_P, load_features, texture_features
from qc.io import iter_fields
from qc.measure import black_level, segment, valid_rows
from qc.schema import Phase

from T9_imaging_erasure import BASELINE, DARK, EXCLUDE, two_way  # noqa: E402

OUT = Path("out/experiments/T10")
KNOWN = [Path("data/Batch_1"), Path("data/Batch_2"), Path("data/Batch_3")]
BLOCK = 4                    # 4x4 block mean: 0.1 um/px
RADII = (2, 5)               # 0.2 and 0.5 um
N_PERM = 200
IMG_CHECK = ["img_bse_noise", "img_bse_sharpness", "img_etd_sharpness", "img_inlens_sharpness"]


def _block(img: np.ndarray) -> np.ndarray:
    sub = np.clip(img.astype(np.float32) - black_level(img), 0, None)[valid_rows(img.shape[0])]
    h, w = sub.shape[0] // BLOCK * BLOCK, sub.shape[1] // BLOCK * BLOCK
    return sub[:h, :w].reshape(h // BLOCK, BLOCK, w // BLOCK, BLOCK).mean((1, 3))


def _lbp(work: np.ndarray, r: int, where: np.ndarray | None = None) -> np.ndarray:
    codes = local_binary_pattern(work, LBP_P, r, method="uniform")
    sel = codes if where is None else codes[where]
    if sel.size < 50:
        return np.full(LBP_BINS, np.nan)
    hist = np.bincount(sel.astype(int).ravel(), minlength=LBP_BINS)[:LBP_BINS]
    return hist / hist.sum()


def tex_m(channels: dict[str, np.ndarray], mask: np.ndarray) -> dict[str, float]:
    out = {}
    for ch in ("BSE", "ETD", "InLens"):
        work = _block(channels[ch])
        for r in RADII:
            for k, v in enumerate(_lbp(work, r)):
                out[f"tex_m_{ch.lower()}_lbp_r{r}_{k}"] = float(v)
        hi = np.percentile(work, 99.5) or 1.0
        q = np.clip(work / hi * (GLCM_LEVELS - 1), 0, GLCM_LEVELS - 1).astype(np.uint8)
        glcm = graycomatrix(q, distances=list(RADII), angles=[0, np.pi / 2], levels=GLCM_LEVELS, symmetric=True, normed=True)
        for prop in GLCM_PROPS:
            vals = graycoprops(glcm, prop)
            for d, dist in enumerate(RADII):
                out[f"tex_m_{ch.lower()}_glcm_{prop}_d{dist}"] = float(vals[d].mean())
    work = _block(channels["BSE"])
    msub = mask[valid_rows(mask.shape[0])][BLOCK // 2 :: BLOCK, BLOCK // 2 :: BLOCK][: work.shape[0], : work.shape[1]]
    work = work[: msub.shape[0], : msub.shape[1]]
    for phase in (Phase.GRAPHITE, Phase.SI):
        for k, v in enumerate(_lbp(work, RADII[0], msub == phase)):
            out[f"tex_m_bse_{phase.name.lower()}_lbp_r{RADII[0]}_{k}"] = float(v)
    return out


def perturb(channels: dict[str, np.ndarray], kind: str, image_id: str) -> dict[str, np.ndarray]:
    if kind == "noise5":
        rng = np.random.default_rng(zlib.crc32(f"{image_id}:noise5".encode()))
        return {k: np.clip(np.rint(v.astype(np.float32) + rng.normal(0, 5, v.shape)), 0, 255).astype(np.uint8) for k, v in channels.items()}
    return {k: np.clip(np.rint(gaussian_filter(v.astype(np.float32), 1.0)), 0, 255).astype(np.uint8) for k, v in channels.items()}


def compute() -> pd.DataFrame:
    rows = []
    for d in KNOWN:
        for f in iter_fields(d):
            kinds = ["none"] + (["noise5", "blur1"] if f.batch == BASELINE else [])
            for kind in kinds:
                ch = f.channels if kind == "none" else perturb(f.channels, kind, f.image_id)
                mask = segment(ch, f.px_um)
                rows.append({"image_id": f.image_id, "perturbation": kind, **tex_m(ch, mask),
                             **({} if kind == "none" else texture_features(ch, mask))})
            print(f"{f.batch}/{f.image_id} {kinds}", flush=True)
    return pd.DataFrame(rows)


def flips(df2: pd.DataFrame, pert: pd.DataFrame, feats: list[str]) -> dict:
    """Batch_3 vs rest: per Batch_3 strip, fit on the other strips; calls on original vs perturbed images."""
    groups = df2["strip_id"].map(A.strip_group)
    out = {"noise5": 0, "blur1": 0, "n": 0}
    for g in sorted(groups[df2.batch == BASELINE].unique()):
        part = A._fit_parts(df2[groups != g], feats, None)["all"]
        test = df2[(groups == g) & (df2.batch == BASELINE)]
        base_call = np.argmax(A._eval_part(part, test)[0], axis=1)
        out["n"] += len(test)
        for kind in ("noise5", "blur1"):
            p = pert[pert.perturbation == kind].set_index("image_id").loc[test.image_id].reset_index()
            out[kind] += int((np.argmax(A._eval_part(part, p)[0], axis=1) != base_call).sum())
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cache = OUT / "tex_m.csv"
    tm = pd.read_csv(cache) if cache.exists() else compute()
    tm.to_csv(cache, index=False)
    df = load_features()
    assert set(df.batch) == {"Batch_1", "Batch_2", "Batch_3"} and len(df) == 31
    dark = pd.read_csv("out/experiments/T2/dark_share.csv").set_index("image_id")["dark_graphite_share"]
    df[DARK] = dark.loc[df["image_id"]].to_numpy()
    orig = tm[tm.perturbation == "none"].set_index("image_id")
    mcols = [c for c in tm.columns if c.startswith("tex_m_")]
    df = pd.concat([df.reset_index(drop=True), orig.loc[df.image_id, mcols].reset_index(drop=True)], axis=1)
    tex2 = [c for c in A.usable_features(df, ("tex",)) if c.startswith("tex_m_")]
    tex = [c for c in A.usable_features(df, ("tex",)) if not c.startswith("tex_m_")]
    deep = A.usable_features(df, ("deep",))
    covs = [c for c in df.columns if c.startswith("img_") and c not in EXCLUDE and c != DARK] + [DARK]
    erase = {"columns": covs, "scope": "all", "k": 3}
    d2 = two_way(df)
    res = {"n_tex_m": len(tex2), "n_tex": len(tex)}

    cv = A.loso_cv(d2, features=tex2)["balanced_accuracy"]
    res["1 B3-vs-rest tex_m"] = {"loso": cv, "null": A.permutation_null(d2, features=tex2, n=N_PERM)}
    print(res["1 B3-vs-rest tex_m"], flush=True)

    def corr(cols):
        r = np.abs([[np.corrcoef(df[c], df[i])[0, 1] for i in IMG_CHECK] for c in cols])
        return {"median_abs_r": float(np.nanmedian(r)), "max_abs_r": float(np.nanmax(r)), "per_img_median": dict(zip(IMG_CHECK, np.nanmedian(r, axis=0).round(3).tolist()))}
    res["2 correlation with imaging"] = {"tex_m": corr(tex2), "tex": corr(tex)}
    print(res["2 correlation with imaging"], flush=True)

    res["3 B3-vs-rest tex_m erased"] = {"loso": A.loso_cv(d2, features=tex2, residualize=erase)["balanced_accuracy"],
                                        "null": A.permutation_null(d2, features=tex2, n=N_PERM, residualize=erase)}
    print(res["3 B3-vs-rest tex_m erased"], flush=True)

    kw = {"features": (tex2, deep), "staged": (("tex",), ("deep",)), "baseline": BASELINE}
    res["4 staged tex_m>deep"] = {"loso": A.loso_cv(df, **kw)["balanced_accuracy"], "null": A.permutation_null(df, n=N_PERM, **kw),
                                  "erased_loso": A.loso_cv(df, residualize=erase, **kw)["balanced_accuracy"],
                                  "erased_null": A.permutation_null(df, n=N_PERM, residualize=erase, **kw)}
    print(res["4 staged tex_m>deep"], flush=True)

    pert = tm[tm.perturbation != "none"]
    res["5 flips"] = {"tex_m": flips(d2, pert, tex2), "tex": flips(d2, pert, tex)}
    print(res["5 flips"], flush=True)
    (OUT / "result.json").write_text(json.dumps(res, indent=2, default=float))


if __name__ == "__main__":
    main()
