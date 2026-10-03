"""Particle types: cluster Si particles on their features, fit once and freeze (PLAN_v3 §3.4).

Usage: uv run python -m qc.types [--exclude Batch_2 ...] [--porous-rule]
Reads out/particles.csv, writes config/particle_types.json, the type column and out/crops/.
"""

import argparse
import itertools
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import adjusted_rand_score
from sklearn.mixture import GaussianMixture

from qc.schema import PARTICLE_TABLE, PARTICLE_TYPES_PATH, crop_path, load_config

FEATURES = ["log_d", "contrast_ratio", "inlens_ratio", "void_frac", "texture", "solidity"]
COV_REG = 1e-6
MERGE_Z = 0.5
MIN_D_UM = 1.0
VERSION = 1


def _border_mask(particles: pd.DataFrame) -> pd.Series:
    """border as bool, whether it comes from a DataFrame (bool) or a CSV round-trip (str)."""
    border = particles["border"]
    if border.dtype == bool:
        return border
    return border.astype(str).str.lower().isin(("true", "1"))


def _feature_matrix(particles: pd.DataFrame) -> np.ndarray:
    """Raw (unstandardised) feature matrix; log_d = log(d_um). Non-finite where not measurable."""
    d = particles["d_um"].to_numpy(float)
    return np.column_stack(
        [np.log(np.where(d > 0, d, np.nan))]
        + [particles[c].to_numpy(float) for c in FEATURES[1:]]
    )


def _mahal(z: np.ndarray, centre: np.ndarray, icov: np.ndarray) -> np.ndarray:
    diff = z - centre
    return np.sqrt(np.maximum(np.einsum("ni,ij,nj->n", diff, icov, diff), 0))


def _icov(cov: np.ndarray) -> np.ndarray:
    return np.linalg.pinv(np.asarray(cov, dtype=float) + COV_REG * np.eye(len(FEATURES)))


def _member_cov(z: np.ndarray) -> np.ndarray:
    if len(z) < 2:
        return COV_REG * np.eye(len(FEATURES))
    return np.cov(z.T) + COV_REG * np.eye(len(FEATURES))


def _type_name(sub: pd.DataFrame, med_d: float, med_cr: float) -> str:
    d50, cr = np.median(sub["d_um"]), np.median(sub["contrast_ratio"])
    size = "large" if d50 > 1.2 * med_d else "small" if d50 < 0.8 * med_d else "mid"
    bright = "bright" if cr > 1.2 * med_cr else "dim" if cr < 0.8 * med_cr else "grey"
    name = f"{size}, {bright}: {cr:.1f}x graphite brightness, D50 {d50:.1f} um"
    if np.median(sub["void_frac"]) > 0.1:
        name += ", porous"
    return name


def fit_types(
    particles: pd.DataFrame, ks: tuple = (2, 3, 4), seed: int = 0, porous_rule: bool = False
) -> dict:
    """Fit a Gaussian-mixture type model; k chosen by leave-one-strip-out stability (PLAN_v3 §3.4)."""
    train = particles[(~_border_mask(particles)) & (particles["d_um"] >= MIN_D_UM)]
    X = _feature_matrix(train)
    finite = np.isfinite(X).all(axis=1)
    train, X = train[finite].reset_index(drop=True), X[finite]
    if not len(train):
        raise ValueError("no particles with all features finite to fit types on")
    mean, sd = X.mean(axis=0), X.std(axis=0)
    sd[sd == 0] = 1.0
    Z = (X - mean) / sd

    strips = train["strip_id"].to_numpy() if "strip_id" in train else np.zeros(len(train))
    k_selection, fits = {}, {}
    for k in ks:
        gmm = GaussianMixture(k, covariance_type="full", n_init=5, random_state=seed).fit(Z)
        full = gmm.predict(Z)
        aris = []
        for strip in np.unique(strips):
            keep = strips != strip
            if keep.sum() < k:
                continue
            sub = GaussianMixture(k, covariance_type="full", n_init=5, random_state=seed).fit(Z[keep])
            aris.append(adjusted_rand_score(full, sub.predict(Z)))
        k_selection[k] = {"loso_ari": float(np.mean(aris)), "bic": float(gmm.bic(Z))}
        fits[k] = gmm
    best_ari = max(v["loso_ari"] for v in k_selection.values())
    chosen_k = min(k for k in ks if k_selection[k]["loso_ari"] >= best_ari - 0.02)

    labels = fits[chosen_k].predict(Z)
    groups = {c: np.nonzero(labels == c)[0] for c in np.unique(labels)}
    centres = {c: Z[idx].mean(axis=0) for c, idx in groups.items()}
    # Merge types that differ only in size (all features except log_d within 0.5 z).
    parent = {c: c for c in groups}

    def find(c):
        while parent[c] != c:
            parent[c] = parent[parent[c]]
            c = parent[c]
        return c

    for a, b in itertools.combinations(groups, 2):
        if np.all(np.abs(centres[find(a)] - centres[find(b)])[1:] < MERGE_Z):
            parent[find(a)] = find(b)
    merged: dict[int, list] = {}
    for c, idx in groups.items():
        merged.setdefault(find(c), []).append(idx)
    members = [np.concatenate(v) for v in merged.values()]

    med_d, med_cr = np.median(train["d_um"]), np.median(train["contrast_ratio"])
    total_area = train["area_um2"].sum()
    order = np.argsort([np.median(train["d_um"].to_numpy()[idx]) for idx in members])
    types, names = [], set()
    for i, mi in enumerate(order):
        idx = members[mi]
        sub = train.iloc[idx]
        name = _type_name(sub, med_d, med_cr)
        if name in names:
            name = f"{name} ({len(names) + 1})"
        names.add(name)
        types.append(
            {
                "id": f"T{i + 1}",
                "name": name,
                "centre": Z[idx].mean(axis=0).tolist(),
                "cov": _member_cov(Z[idx]).tolist(),
                "n": int(len(idx)),
                "area_share": float(sub["area_um2"].sum() / total_area),
                "summary": {
                    "d50_um": float(np.median(sub["d_um"])),
                    "contrast_ratio": float(np.median(sub["contrast_ratio"])),
                    "inlens_ratio": float(np.median(sub["inlens_ratio"])),
                    "void_frac": float(np.median(sub["void_frac"])),
                    "texture": float(np.median(sub["texture"])),
                    "solidity": float(np.median(sub["solidity"])),
                },
            }
        )
    own = np.zeros(len(members), dtype=int)
    for t, mi in enumerate(order):
        own[mi] = t
    dists = np.concatenate(
        [_mahal(Z[members[mi]], np.array(types[own[mi]]["centre"]), _icov(types[own[mi]]["cov"])) for mi in range(len(members))]
    )
    return {
        "version": VERSION,
        "features": FEATURES,
        "mean": mean.tolist(),
        "sd": sd.tolist(),
        "types": types,
        "unassigned_threshold": float(np.percentile(dists, 99)),
        "k_selection": {str(k): v for k, v in k_selection.items()},
        "chosen_k": int(chosen_k),
        "fit_batches": sorted(particles["batch"].dropna().unique().tolist()) if "batch" in particles else [],
        "n_particles": int(len(train)),
        "porous_rule": bool(porous_rule),
        "seed": int(seed),
    }


def assign_types(particles: pd.DataFrame, model: dict) -> pd.DataFrame:
    """Copy of `particles` with a `type` column: T1..Tk, "unassigned", or "porous"."""
    out = particles.copy()
    labels = np.full(len(out), "unassigned", dtype=object)
    if len(out) and model and model.get("types"):
        Z = (_feature_matrix(out) - np.asarray(model["mean"])) / np.asarray(model["sd"])
        Z[~np.isfinite(Z)] = 0.0
        dists = np.stack(
            [_mahal(Z, np.asarray(t["centre"]), _icov(t["cov"])) for t in model["types"]]
        )
        nearest, dmin = dists.argmin(axis=0), dists.min(axis=0)
        ids = np.array([t["id"] for t in model["types"]], dtype=object)
        labels = np.where(dmin <= model["unassigned_threshold"], ids[nearest], "unassigned")
        if model.get("porous_rule"):
            labels[out["void_frac"].to_numpy() > 0.1] = "porous"
    out["type"] = labels
    return out


def type_shares(particles: pd.DataFrame, by: tuple = ("batch", "strip_id")) -> pd.DataFrame:
    """Share of Si area per type per group; columns are type ids, rows sum to 1."""
    types = particles["type"] if "type" in particles else pd.Series("unassigned", index=particles.index)
    typed = particles.assign(type=types.fillna("unassigned"))
    shares = (
        typed.groupby(list(by) + ["type"], observed=True)["area_um2"].sum().unstack("type").fillna(0.0)
    )
    return shares.div(shares.sum(axis=1), axis=0)


def save_types(model: dict, path: Path = PARTICLE_TYPES_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(model, indent=2))


def load_types(path: Path = PARTICLE_TYPES_PATH) -> dict | None:
    return json.loads(Path(path).read_text()) if Path(path).exists() else None


def save_type_crops(particles: pd.DataFrame, model: dict, data_dir, n: int = 8) -> None:
    """Per type, the n most typical non-border particles as contrast-stretched BSE crops."""
    from skimage.exposure import rescale_intensity
    from skimage.io import imsave

    from qc.io import field_paths, load_image

    data_dir = Path(data_dir)
    if not len(particles) or not model.get("types"):
        return
    Z = (_feature_matrix(particles) - np.asarray(model["mean"])) / np.asarray(model["sd"])
    Z[~np.isfinite(Z)] = 0.0
    dist = np.stack([_mahal(Z, np.asarray(t["centre"]), _icov(t["cov"])) for t in model["types"]])
    cache: dict = {}
    for t_i, t in enumerate(model["types"]):
        pos = np.flatnonzero(
            ((particles["type"] == t["id"]) & (~_border_mask(particles))).to_numpy()
        )
        pick = particles.iloc[pos[np.argsort(dist[t_i][pos])[:n]]]
        for i, (_, row) in enumerate(pick.iterrows()):
            key = (row["batch"], row["image_id"])
            if key not in cache:
                paths = field_paths(data_dir / row["batch"]).get(row["image_id"], {})
                cache[key] = load_image(paths["BSE"]) if "BSE" in paths else (None, np.nan, np.nan)
            img, px_um, _ = cache[key]
            if img is None:
                continue
            half = max(4 * row["d_um"], 5.0) / px_um / 2
            y, x = row["y_px"], row["x_px"]
            crop = img[
                max(0, int(y - half)) : min(img.shape[0], int(y + half) + 1),
                max(0, int(x - half)) : min(img.shape[1], int(x + half) + 1),
            ]
            lo, hi = np.percentile(crop, (1, 99))
            path = crop_path(t["id"], i)
            path.parent.mkdir(parents=True, exist_ok=True)
            imsave(path, rescale_intensity(crop, in_range=(lo, hi), out_range=(0, 255)).astype(np.uint8))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fit particle types on out/particles.csv.")
    parser.add_argument("--exclude", nargs="*", default=[], help="batches left out of the fit")
    parser.add_argument("--porous-rule", action="store_true", help="label void_frac > 0.1 as 'porous'")
    args = parser.parse_args()
    table = pd.read_csv(PARTICLE_TABLE)
    model = fit_types(table[~table["batch"].isin(args.exclude)], porous_rule=args.porous_rule)
    save_types(model)
    table = assign_types(table, model)
    table.to_csv(PARTICLE_TABLE, index=False)
    save_type_crops(table, model, load_config()["data_dir"])
    print("k selection (leave-one-strip-out ARI, BIC):")
    for k, v in model["k_selection"].items():
        marker = " <-- chosen" if int(k) == model["chosen_k"] else ""
        print(f"  k={k}: ARI {v['loso_ari']:.3f}, BIC {v['bic']:.0f}{marker}")
    print(f"{model['n_particles']} particles, threshold {model['unassigned_threshold']:.2f}")
    for t in model["types"]:
        print(f"  {t['id']} ({t['n']} particles, {t['area_share']:.0%} of Si area): {t['name']}")
