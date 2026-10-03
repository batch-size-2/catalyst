"""T1: imaging-invariance audit of the frozen attribution model (docs/experiments/T1.md).

Applies the ticket's perturbation table to the 31 known images, computes the same features
as qc/attribute's live path (cached in out/experiments/T1/perturbed_features.parquet) and
predicts with two arms: A, the frozen model as is (in-sample, calibrated); B, the frozen
recipe refit on the other strips with the JSON's fixed per-stage C (out of sample,
uncalibrated). Writes the report tables and docs/experiments/T1_robustness.png.

Usage: uv run python -u scripts/experiments/T1_invariance_audit.py [--steps 1,2,3,4]
"""

import argparse
import sys
import time
import zlib
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import numpy as np
import pandas as pd
from scipy.ndimage import gaussian_filter

from qc import attribute as A
from qc import controls, features as F, io, measure
from qc import deep as D
from qc.schema import Field, Phase

BATCHES = ("Batch_1", "Batch_2", "Batch_3")
BASELINE = "Batch_3"
CLASSES = list(BATCHES)
STAGED = (F.MATERIAL_FAMILIES, (F.DEEP_FAMILY,))
STAGE_C = {"baseline": 0.03, "variation": 0.01}  # the C saved in config/attribution_model.json

OUT_DIR = Path("out/experiments/T1")
CACHE_PATH = OUT_DIR / "perturbed_features.parquet"
REPORT_PATH = OUT_DIR / "report_by_arm.csv"
DRIFT_PATH = OUT_DIR / "family_drift.csv"
SHARES_PATH = OUT_DIR / "dark_shares.csv"
PNG_PATH = Path("docs/experiments/T1_robustness.png")

DRIFT_FAMILIES = ("tex", "reg", "par", "kpi", "edge")
REST_PERTURBATIONS = ("gain120", "contrast080", "black20", "gamma125", "curtain", "shade125", "hflip")
CONTRAST_GRID = (0.5, 0.75, 1.0, 1.25, 1.5)
NOISE_GRID = (0.0, 2.0, 5.0, 8.0, 12.0)
CURVE_KPIS = ("si_graphite_ratio", "si_d50_um", "porosity_apparent")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def rng_for(image_id: str, perturbation: str) -> np.random.Generator:
    return np.random.default_rng(zlib.crc32(f"{image_id}:{perturbation}".encode()))


def _u8(x: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(x), 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- perturbations
# Each takes a Field and an rng and returns a new channels dict (uint8, same shapes).

def gain120(field: Field, rng: np.random.Generator) -> dict:
    return controls._neg_brightness(1.2)(field, rng)


def contrast080(field: Field, rng: np.random.Generator) -> dict:
    return controls._neg_contrast(0.8)(field, rng)


def black20(field: Field, rng: np.random.Generator) -> dict:
    return controls._neg_black(20)(field, rng)


def gamma125(field: Field, rng: np.random.Generator, gamma: float = 1.25) -> dict:
    out = {}
    for k, img in field.channels.items():
        b = measure.black_level(img)
        u = np.clip(img.astype(np.float32) - b, 0, None) / max(255.0 - b, 1e-6)
        out[k] = _u8(b + (255.0 - b) * u**gamma)
    return out


def noise5(field: Field, rng: np.random.Generator) -> dict:
    return controls._neg_noise(5)(field, rng)


def blur1(field: Field, rng: np.random.Generator) -> dict:
    return {k: _u8(gaussian_filter(img.astype(np.float32), 1.0)) for k, img in field.channels.items()}


def curtain(field: Field, rng: np.random.Generator) -> dict:
    return controls._neg_curtaining(field, rng)


def hflip(field: Field, rng: np.random.Generator) -> dict:
    return {k: img[:, ::-1].copy() for k, img in field.channels.items()}


def shade125(field: Field, rng: np.random.Generator, ratio: float = 1.25) -> dict:
    """InLens rows x a linear ramp, mean 1, top/bottom ratio `ratio`, applied black-corrected."""
    chans = dict(field.channels)
    img = chans["InLens"].astype(np.float32)
    b = measure.black_level(chans["InLens"])
    top, bottom = 2 * ratio / (1 + ratio), 2 / (1 + ratio)
    ramp = np.linspace(top, bottom, img.shape[0])[:, None]
    chans["InLens"] = _u8(b + (img - b) * ramp)
    return chans


def _graphite_mask(field: Field) -> tuple[np.ndarray, slice]:
    """Phase.GRAPHITE at full resolution on the ORIGINAL field, valid rows only."""
    mask = measure.segment(field.channels, field.px_um)
    rows = measure.valid_rows(mask.shape[0])
    g = np.zeros(mask.shape, bool)
    g[rows] = mask[rows] == Phase.GRAPHITE
    return g, rows


def dg_add(field: Field, rng: np.random.Generator, top_frac: float = 0.40, factor: float = 0.30) -> dict:
    """Darken the InLens of graphite pixels in the top `top_frac` of valid rows (electrical contrast)."""
    chans = dict(field.channels)
    g, rows = _graphite_mask(field)
    top = np.zeros(g.shape, bool)
    top[rows.start : rows.start + round(top_frac * (rows.stop - rows.start))] = True
    img = chans["InLens"].astype(np.float32)
    b = measure.black_level(chans["InLens"])
    out = img.copy()
    sel = g & top
    out[sel] = b + factor * (img[sel] - b)
    chans["InLens"] = _u8(out)
    return chans


def dg_remove(field: Field, rng: np.random.Generator, limit: float = 55.0, factor: float = 0.30) -> dict:
    """Undo the dark-graphite InLens contrast: graphite pixels with v - black < `limit` get /`factor`."""
    chans = dict(field.channels)
    g, _ = _graphite_mask(field)
    img = chans["InLens"].astype(np.float32)
    b = measure.black_level(chans["InLens"])
    out = img.copy()
    sel = g & (img - b < limit)
    out[sel] = b + (img[sel] - b) / factor
    chans["InLens"] = _u8(out)
    return chans


PERTURBATIONS = {
    "gain120": gain120,
    "contrast080": contrast080,
    "black20": black20,
    "gamma125": gamma125,
    "noise5": noise5,
    "blur1": blur1,
    "curtain": curtain,
    "shade125": shade125,
    "hflip": hflip,
    "dg_add": dg_add,
    "dg_remove": dg_remove,
}


def dark_graphite_share(field: Field) -> float:
    """Graphite pixels (valid rows) that are dark in InLens: black-subtracted, Gaussian sigma 1,
    dark if < 55, saturated (255) pixels excluded; share = dark / graphite (the T2 definition)."""
    g, _ = _graphite_mask(field)
    img = field.channels["InLens"]
    u = gaussian_filter(img.astype(np.float32) - measure.black_level(img), 1.0)
    pool = g & (img != 255)
    return float((pool & (u < 55.0)).sum() / pool.sum()) if pool.any() else np.nan


# ---------------------------------------------------------------- fields and feature rows

def load_fields() -> dict[str, Field]:
    fields = {}
    for batch in BATCHES:
        for field in io.iter_fields(Path("data") / batch):
            fields[field.image_id] = field
    return fields


def feature_row(field: Field, embed) -> dict:
    """The same per-image features as attribute_images: image_features + deep_features."""
    row = F.image_features(field)
    row.update(D.deep_features(field, embed))
    return row


def read_cache() -> pd.DataFrame:
    if CACHE_PATH.exists():
        return pd.read_parquet(CACHE_PATH)
    return pd.DataFrame(columns=["batch", "image_id", "strip_id", "perturbation"])


def write_cache(df: pd.DataFrame) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(CACHE_PATH, index=False)


def build_jobs(fields: dict[str, Field], shares: dict[str, float]) -> list[tuple[str, str]]:
    """(image_id, perturbation) jobs in the ticket's run order."""
    by_batch = {b: sorted((f for f in fields.values() if f.batch == b), key=lambda f: f.image_id) for b in BATCHES}
    jobs = [(f.image_id, p) for f in by_batch["Batch_3"] for p in ("noise5", "blur1")]
    jobs += [(f.image_id, "dg_add") for f in by_batch["Batch_1"]]
    jobs += [
        (f.image_id, "dg_remove")
        for f in by_batch["Batch_2"] + by_batch["Batch_3"]
        if shares.get(f.image_id, 0.0) > 0.1
    ]
    jobs += [(f.image_id, p) for f in fields.values() for p in REST_PERTURBATIONS]
    return jobs


def run_perturbations(fields: dict[str, Field], originals: pd.DataFrame, shares: dict[str, float]) -> pd.DataFrame:
    """Fill the parquet cache: originals under 'none' plus every job's feature row. Restartable."""
    cache = read_cache()
    if not (cache["perturbation"] == "none").any():
        none = originals.copy()
        none["perturbation"] = "none"
        cache = pd.concat([cache, none], ignore_index=True)
        write_cache(cache)
        log(f"cached {len(none)} originals as perturbation=none")
    done = set(zip(cache["image_id"], cache["perturbation"]))
    embed = D.default_embed()
    t0 = time.time()
    n_done = 0
    pending = [j for j in build_jobs(fields, shares) if j not in done]
    log(f"{len(pending)} perturbed feature rows to compute ({len(done)} cached)")
    last_image, field = None, None
    for i, (image_id, perturbation) in enumerate(pending):
        if image_id != last_image:
            field = fields[image_id]
            last_image = image_id
        channels = PERTURBATIONS[perturbation](field, rng_for(image_id, perturbation))
        row = feature_row(replace(field, channels=channels), embed)
        row["perturbation"] = perturbation
        cache = pd.concat([cache, pd.DataFrame([row])], ignore_index=True)
        n_done += 1
        if n_done % 10 == 0 or i == len(pending) - 1:
            write_cache(cache)
            per = (time.time() - t0) / n_done
            log(f"  {n_done}/{len(pending)} rows ({per:.1f} s/image), last {image_id}:{perturbation}")
    log(f"perturbed features done: {n_done} rows in {(time.time() - t0) / 60:.1f} min")
    return cache


# ---------------------------------------------------------------- arms

def _stage_call(stage: dict | None) -> str | None:
    return stage["call"] if isinstance(stage, dict) else None


def arm_a(model: dict, df: pd.DataFrame) -> pd.DataFrame:
    """Frozen model as is (in-sample, temperature-scaled like the live path)."""
    pred = A.predict(model, df)
    out = df[["image_id", "perturbation"]].reset_index(drop=True)
    out["predicted"] = pred["predicted"].to_numpy()
    out["stage_baseline"] = [_stage_call(s) for s in pred["stage_baseline"]]
    out["stage_variation"] = [_stage_call(s) for s in pred["stage_variation"]]
    out["p_Batch_3"] = pred["p_Batch_3"].to_numpy()
    return out


def arm_b(df: pd.DataFrame, originals: pd.DataFrame) -> pd.DataFrame:
    """The frozen recipe refit per held-out strip, fixed per-stage C, uncalibrated (temperature 1)."""
    groups = originals["strip_id"].map(A.strip_group)
    rows = []
    for g in sorted(groups.unique()):
        train = originals[groups != g]
        features = A._stage_features(train, F.MATERIAL_FAMILIES, STAGED)
        parts = A._fit_parts(train, features, BASELINE, seed=0, nested=False, C=STAGE_C)
        test = df[df["strip_id"].map(A.strip_group) == g]
        probs = np.nan_to_num(A._parts_proba(parts, test, CLASSES, BASELINE), nan=0.0)
        for i, (_, r) in enumerate(test.iterrows()):
            calls = A._stage_calls(probs[i], CLASSES, BASELINE)
            rows.append(
                {
                    "image_id": r["image_id"],
                    "strip_group": g,
                    "perturbation": r["perturbation"],
                    "predicted": CLASSES[int(np.argmax(probs[i]))],
                    "stage_baseline": _stage_call(calls["stage_baseline"]),
                    "stage_variation": _stage_call(calls["stage_variation"]),
                    "p_Batch_3": float(probs[i, CLASSES.index(BASELINE)]),
                }
            )
        log(f"arm B fold {g}: fitted on {len(train)} images, predicted {len(test)} rows")
    return pd.DataFrame(rows)


def report(df: pd.DataFrame, arm: pd.DataFrame, arm_name: str) -> pd.DataFrame:
    """Per perturbation x true batch: flip counts and median |dp_Batch_3| vs the same arm's
    call on the original."""
    key = ["image_id", "perturbation"]
    merged = df.merge(arm, on=key, suffixes=("", "_arm"))
    orig = merged[merged["perturbation"] == "none"].set_index("image_id")
    rows = []
    for (pert, batch), sub in merged[merged["perturbation"] != "none"].groupby(["perturbation", "batch"]):
        ref = orig.loc[sub["image_id"]]
        rows.append(
            {
                "arm": arm_name,
                "perturbation": pert,
                "batch": batch,
                "n": int(len(sub)),
                "predicted_changed": int((sub["predicted"].to_numpy() != ref["predicted"].to_numpy()).sum()),
                "stage_baseline_changed": int(
                    (sub["stage_baseline"].fillna("<none>").to_numpy() != ref["stage_baseline"].fillna("<none>").to_numpy()).sum()
                ),
                "stage_variation_changed": int(
                    (sub["stage_variation"].fillna("<none>").to_numpy() != ref["stage_variation"].fillna("<none>").to_numpy()).sum()
                ),
                "median_abs_dp_Batch_3": float(np.median(np.abs(sub["p_Batch_3"].to_numpy() - ref["p_Batch_3"].to_numpy()))),
            }
        )
    return pd.DataFrame(rows)


def deep_pcs(model: dict, df: pd.DataFrame) -> pd.DataFrame:
    """The frozen model's variation-stage reducer applied to the deep_ columns: the 10 PCs."""
    part = A.model_parts(model)["variation"]
    red = A.Reducer.from_json(part["features"], part["reducer"])
    X = df.reindex(columns=part["features"]).apply(pd.to_numeric, errors="coerce").to_numpy(float)
    return pd.DataFrame(red(X), columns=red.names, index=df.index)


def family_drift(df: pd.DataFrame, model: dict) -> pd.DataFrame:
    """Median |dfeature| / (SD of the feature over the Batch_3 originals), per perturbation x family."""
    none = df[df["perturbation"] == "none"]
    b3_idx = none.index[none["batch"] == BASELINE]
    views = {fam: df[F.feature_columns(df, (fam,))].apply(pd.to_numeric, errors="coerce") for fam in DRIFT_FAMILIES}
    views["deep PCs"] = deep_pcs(model, df)
    rows = []
    for pert, sub in df[df["perturbation"] != "none"].groupby("perturbation"):
        out = {"perturbation": pert, "n": int(len(sub))}
        for fam, view in views.items():
            sd = view.loc[b3_idx].std(ddof=1).replace(0, np.nan).to_numpy(float)
            v_none = view.loc[none.index].to_numpy(float)
            lookup = {iid: v_none[k] for k, iid in enumerate(none["image_id"])}
            orig = np.stack([lookup[i] for i in sub["image_id"]])
            delta = np.abs(view.loc[sub.index].to_numpy(float) - orig) / sd
            out[fam] = float(np.nanmedian(delta))
        rows.append(out)
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- robustness curve

def curve_fields(fields: dict[str, Field], originals: pd.DataFrame, n: int = 3) -> list[Field]:
    """`n` Batch_3 images, each from a different strip, deterministic."""
    b3 = originals[originals["batch"] == BASELINE].assign(strip_group=lambda d: d["strip_id"].map(A.strip_group))
    picks = b3.sort_values("image_id").drop_duplicates("strip_group")["image_id"].head(n).tolist()
    return [fields[i] for i in sorted(picks)]


def robustness_curve(fields: dict[str, Field], originals: pd.DataFrame) -> pd.DataFrame:
    """p_Batch_3 (arm B) and KPI drift against contrast and noise strength, for `curve_fields`."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    groups = originals["strip_id"].map(A.strip_group)
    parts_by_strip = {}
    rows = []
    log("robustness curve: computing")
    for field in curve_fields(fields, originals):
        g = A.strip_group(field.strip_id)
        if g not in parts_by_strip:
            train = originals[groups != g]
            features = A._stage_features(train, F.MATERIAL_FAMILIES, STAGED)
            parts_by_strip[g] = A._fit_parts(train, features, BASELINE, seed=0, nested=False, C=STAGE_C)
        part = parts_by_strip[g]["baseline"]
        ref_kpis = measure.kpis(measure.segment(field.channels, field.px_um), field.px_um, field.channels)

        def probe(name, chans):
            feats = pd.DataFrame([F.image_features(replace(field, channels=chans))])
            p = A._eval_part(part, feats)[0]
            p_b3 = float(p[0, list(part["classes"]).index(BASELINE)])
            vals = measure.kpis(measure.segment(chans, field.px_um), field.px_um, chans)
            rows.append(
                {
                    "image_id": field.image_id,
                    "kind": name.split("=")[0],
                    "strength": float(name.split("=")[1]),
                    "p_Batch_3": p_b3,
                    **{k: vals.get(k, np.nan) for k in CURVE_KPIS},
                    **{f"ref_{k}": ref_kpis.get(k, np.nan) for k in CURVE_KPIS},
                }
            )
            log(f"  curve {field.image_id} {name}: p_B3={p_b3:.3f}")

        for factor in CONTRAST_GRID:
            probe(f"contrast={factor}", controls._neg_contrast(factor)(field, rng_for(field.image_id, f"contrast{factor}")))
        for sigma in NOISE_GRID:
            probe(f"noise={sigma}", controls._neg_noise(sigma)(field, rng_for(field.image_id, f"noise{sigma}")))

    curve = pd.DataFrame(rows)
    fig, axes = plt.subplots(2, 2, figsize=(11, 7), sharex="col")
    for j, (kind, label) in enumerate((("contrast", "contrast factor"), ("noise", "noise sigma"))):
        sub = curve[curve["kind"] == kind]
        ax = axes[0, j]
        for image_id, s in sub.groupby("image_id"):
            ax.plot(s["strength"], s["p_Batch_3"], "o-", label=image_id)
        ax.axhline(0.5, color="grey", lw=0.8, ls="--")
        ax.set_ylabel("p_Batch_3 (arm B, uncalibrated)")
        ax.set_xlabel(label)
        ax.legend(fontsize=7, title="Batch_3 image", title_fontsize=7)
        ax = axes[1, j]
        for k in CURVE_KPIS:
            drift = (sub[k] - sub[f"ref_{k}"]) / sub[f"ref_{k}"].abs().clip(lower=1e-9)
            ax.plot(sub["strength"], drift, "o-", label=k)
        ax.axhline(0.0, color="grey", lw=0.8, ls="--")
        ax.set_ylabel("relative KPI drift")
        ax.set_xlabel(label)
        ax.legend(fontsize=7)
    fig.suptitle("T1 robustness curve: imaging strength vs call and KPIs (3 Batch_3 strips)")
    fig.tight_layout()
    PNG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(PNG_PATH, dpi=140)
    log(f"wrote {PNG_PATH}")
    return curve


# ---------------------------------------------------------------- main

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", default="1,2,3,4", help="comma list of ticket steps to run")
    args = parser.parse_args()
    steps = {int(s) for s in args.steps.split(",")}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    originals = F.load_features()
    assert set(originals["batch"]) == set(BATCHES), originals["batch"].unique()
    log(f"features.csv: {len(originals)} images")

    log("loading fields and computing dark-graphite shares")
    fields = load_fields()
    shares = {f.image_id: dark_graphite_share(f) for f in fields.values()}
    pd.DataFrame(
        [{"image_id": f.image_id, "batch": f.batch, "strip_id": f.strip_id, "dark_graphite_share": shares[f.image_id]} for f in fields.values()]
    ).to_csv(SHARES_PATH, index=False)
    log(f"dark shares: {sum(v > 0.1 for v in shares.values())} of {len(shares)} images above 0.1 -> {SHARES_PATH}")

    if steps & {1, 2, 3}:
        cache = run_perturbations(fields, originals, shares)
    else:
        cache = read_cache()
    log(f"cache: {len(cache)} rows -> {CACHE_PATH}")

    model = A.load_model()
    assert model is not None
    df = cache  # batch / image_id / strip_id / perturbation + the feature columns

    log("arm A: frozen model as is")
    rep_a = report(df, arm_a(model, df), "A")
    log("arm B: per-strip refit of the frozen recipe, fixed C, uncalibrated")
    rep_b = report(df, arm_b(df, originals), "B")
    rep = pd.concat([rep_a, rep_b], ignore_index=True)
    rep.to_csv(REPORT_PATH, index=False)
    log(f"wrote {REPORT_PATH}")
    with pd.option_context("display.width", 200, "display.max_rows", 200):
        log("\n" + rep.to_string(index=False))

    drift = family_drift(df, model)
    drift.to_csv(DRIFT_PATH, index=False)
    log(f"wrote {DRIFT_PATH}")
    log("\n" + drift.to_string(index=False))

    if 4 in steps:
        curve = robustness_curve(fields, originals)
        curve.to_csv(OUT_DIR / "robustness_curve.csv", index=False)

    log(f"all done in {(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
