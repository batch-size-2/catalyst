"""T18: what the ground truth of the 3 test samples tells us, and whether anything separates Batch_1
from Batch_2 once the strip is taken out of the comparison.

Run after scripts/experiments/T18_tiles.py and after out/experiments/gt/features34.csv exists (the 31
known rows plus the 3 test rows, labelled with their true batch).

  PYTHONPATH=. uv run python scripts/experiments/T18_ground_truth.py

Writes out/experiments/T18/result.json and prints the tables of docs/experiments/T18.md.
"""

import json
from itertools import product
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from qc import attribute as A
from qc.features import MATERIAL_FAMILIES

OUT = Path("out/experiments/T18")
FEATURES34 = Path("out/experiments/gt/features34.csv")
TRUTH = {"3e122cbj": "Batch_2", "fn0mhxef": "Batch_1", "xrv9xvzb": "Batch_3"}
STAGED = (MATERIAL_FAMILIES, ("deep",))
N_NULL = 100
B12 = ("Batch_1", "Batch_2")


def load() -> pd.DataFrame:
    df = pd.read_csv(FEATURES34, low_memory=False).copy()
    df["strip"] = df["strip_id"].map(A.strip_group)
    return df


# ---------------------------------------------------------------- 1. layout: which images touch

def edge_r(left: np.ndarray, right: np.ndarray, maxdy: int = 30) -> float:
    """Best correlation of left's last kept column with right's first kept column over vertical shifts."""
    l, r = left[:, -9].astype(float), right[:, 8].astype(float)
    best = -1.0
    for dy in range(-maxdy, maxdy + 1):
        x, y = l[max(0, dy):len(l) + min(0, dy)], r[max(0, -dy):len(r) + min(0, -dy)]
        best = max(best, float(np.corrcoef(x, y)[0, 1]))
    return best


def layout(df: pd.DataFrame) -> dict:
    folder = {**{i: b for b, i in zip(df["batch"], df["image_id"])}, **{i: "Hackathon-Polaron-test" for i in TRUTH}}
    imgs = {}
    for i in df["image_id"]:
        a = np.asarray(Image.open(next(Path("data", folder[i]).glob(f"img_{i}_BSE.tif"))))
        imgs[i] = a[..., 0] if a.ndim == 3 else a
    links, null = [], []
    for s, rows in df.groupby("strip"):
        ids = rows["image_id"].tolist()
        for a in ids:
            for b in ids:
                if a != b:
                    r = edge_r(imgs[a], imgs[b])
                    (links if r > 0.3 else null).append({"strip": s, "left": a, "right": b, "r": round(r, 2)})
    lab = dict(zip(df["image_id"], df["batch"]))
    chains = {}
    for s in df["strip"].unique():
        nxt = {l["left"]: l["right"] for l in links if l["strip"] == s}
        starts = [a for a in nxt if a not in nxt.values()]
        chains[s] = []
        for a in starts:
            chain = [a]
            while chain[-1] in nxt:
                chain.append(nxt[chain[-1]])
            chains[s].append(" -> ".join(f"{c} ({lab[c][-1]}{'*' if c in TRUTH else ''})" for c in chain))
    return {"links": links, "max_non_adjacent_r": max(l["r"] for l in null), "chains": {s: c for s, c in chains.items() if c}}


# ---------------------------------------------------------------- 2. the frozen recipe on 34

def frozen_recipe(df: pd.DataFrame) -> dict:
    cv = A.loso_cv(df, staged=STAGED, baseline="Batch_3")
    per = cv["per_image"]
    cal = A.calibrate(per, sorted(df["batch"].unique()), "Batch_3")
    v = per[per["batch"].isin(B12)]
    pv = np.where(v["p_Batch_1"] >= v["p_Batch_2"], "Batch_1", "Batch_2")
    return {"classifier_balanced_accuracy": cv["balanced_accuracy"], "calls_balanced_accuracy": cal["balanced_accuracy"],
            "confusion": cal["confusion"], "stages": cal["stages"], "tiers": cal["tiers"],
            "b1_vs_b2_among_true_variations": {"right": int((pv == v["batch"]).sum()), "n": int(len(v))}}


# ---------------------------------------------------------------- 3. Batch_1 vs Batch_2, strip held out

def b12_loso(df: pd.DataFrame, families, n_null: int = N_NULL) -> dict:
    sub = df[df["batch"].isin(B12)].reset_index(drop=True)
    cv = A.loso_cv(sub, families)
    null = A.permutation_null(sub, families, n=n_null) if n_null else None
    return {"balanced_accuracy": round(cv["balanced_accuracy"], 3), "right": int(cv["per_image"]["correct"].sum()), "n": len(sub),
            "null_p95": None if null is None else round(null["p95"], 3)}


def strip_memory(df: pd.DataFrame) -> dict:
    """Leave-one-IMAGE-out B1 vs B2 on deep (the frozen stage 2's input), for images whose strip holds both labels.
    A model that reads the strip predicts the strip's other images' label, so it is wrong exactly when the
    held-out image's label is the strip's minority."""
    sub = df[df["batch"].isin(B12)].reset_index(drop=True)
    feats = A.usable_features(sub, ("deep",))
    y = sub["batch"].to_numpy(str)
    pred = []
    for i in range(len(sub)):
        train = sub.drop(index=i)
        part = A._fit_part(train, y[np.arange(len(y)) != i], train["strip"].to_numpy(str), feats, C=0.01)
        p = A._eval_part(part, sub.iloc[[i]])[0][0]
        pred.append(part["classes"][int(np.argmax(p))])
    sub["pred_looo"] = pred
    rows = []
    for s, g in sub.groupby("strip"):
        if g["batch"].nunique() < 2:
            continue
        for _, r in g.iterrows():
            others = g[g["image_id"] != r["image_id"]]["batch"]
            rows.append({"strip": s, "image_id": r["image_id"], "truth": r["batch"], "pred": r["pred_looo"],
                         "strip_others": "/".join(sorted(others)), "right": r["pred_looo"] == r["batch"]})
    return {"per_image": rows, "right": int(sum(r["right"] for r in rows)), "n": len(rows),
            "all_images_right": int((sub["pred_looo"] == sub["batch"]).sum()), "all_images_n": len(sub)}


# ---------------------------------------------------------------- 4. paired test inside the shared strips

def representations(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Label-free representations, one row per image (index image_id). PCA is fit on all 34 images."""
    out = {}
    idx = df["image_id"]

    def zs(X):
        X = np.asarray(X, float)
        return A.Standardiser(X)(X)

    def pcs(X, k=10):
        Z = zs(X)
        _, _, vt = np.linalg.svd(Z - Z.mean(0), full_matrices=False)
        return zs(Z @ vt[:k].T)

    for name, fams in {"material (180 named)": MATERIAL_FAMILIES, "texture": ("tex",), "imaging descriptors": ("img",)}.items():
        out[name] = pd.DataFrame(zs(A._matrix(df, A.usable_features(df, fams))), index=idx)
    out["DINOv2 InLens, frozen stage-2 input (10 PCs)"] = pd.DataFrame(pcs(A._matrix(df, A.usable_features(df, ("deep",)))), index=idx)
    tiles = OUT / "tiles.npz"
    if tiles.exists():
        z = np.load(tiles)
        for ch in ("BSE", "ETD", "InLens"):
            m = np.stack([np.concatenate([z[f"{i}|{ch}"].mean(0), np.quantile(z[f"{i}|{ch}"], [0.1, 0.9], axis=0).ravel()]) for i in idx])
            out[f"DINOv2 {ch} tiles, mean + p10/p90 (10 PCs)"] = pd.DataFrame(pcs(m), index=idx)
    spec = OUT / "spectrum.npz"
    if spec.exists():
        s = np.load(spec)
        order = {m[1]: k for k, m in enumerate(s["meta"])}
        out["power spectrum, 7 octaves x 3 detectors"] = pd.DataFrame(zs(np.log(s["spec"][[order[i] for i in idx]])), index=idx)
    forensic = Path("out/experiments/gt/forensic.csv")
    if forensic.exists():
        f = pd.read_csv(forensic).pivot_table(index="image_id", columns="det", values=["noise", "snr", "sharp", "hf_ratio", "gap_frac", "n_levels", "p01", "p50", "p99", "row_band", "col_band"])
        out["acquisition forensics (33)"] = pd.DataFrame(zs(f.loc[idx].to_numpy(float)), index=idx)
    return out


def paired(df: pd.DataFrame, R: pd.DataFrame) -> dict:
    """Inside every strip that holds both Batch_1 and Batch_2: d_s = mean(B1 rows) - mean(B2 rows).

    - leave-one-strip-out direction: w = mean of the other strips' d; right if w . d_s > 0. Exact null:
      each strip's orientation is a fair coin, P(k of n right) binomial(n, 1/2).
    - sign consistency: features whose d has the same sign in every strip, against the exact null of all
      2^n orientation flips."""
    strips = [s for s, g in df.groupby("strip") if set(B12) <= set(g["batch"])]
    D = []
    for s in strips:
        g = df[df["strip"] == s]
        D.append(R.loc[g.loc[g["batch"] == "Batch_1", "image_id"]].mean(0).to_numpy() - R.loc[g.loc[g["batch"] == "Batch_2", "image_id"]].mean(0).to_numpy())
    D = np.array(D)
    n = len(strips)
    right = []
    for k in range(n):
        w = np.delete(D, k, axis=0).mean(0)
        right.append(bool(w @ D[k] > 0))
    k_right = int(sum(right))
    p_loso = float(sum(__import__("math").comb(n, j) for j in range(k_right, n + 1)) / 2 ** n)
    consistent = lambda M: int((np.abs(np.sign(M).sum(0)) == n).sum())
    obs = consistent(D)
    null = [consistent(D * np.array(signs)[:, None]) for signs in product((1, -1), repeat=n)]
    return {"strips": strips, "loso_right": k_right, "n": n, "per_strip": dict(zip(strips, right)), "p_one_sided": round(p_loso, 3),
            "features": D.shape[1], "all_same_sign": obs, "null_median": float(np.median(null)), "null_p_ge": round(float(np.mean(np.array(null) >= obs)), 3)}


def neighbour_distances(df: pd.DataFrame, R: pd.DataFrame) -> dict:
    """Distance between two images of one strip: different label (B1 vs B2) against same label."""
    lab = dict(zip(df["image_id"], df["batch"]))
    cross, same = [], []
    for s, g in df.groupby("strip"):
        ids = g["image_id"].tolist()
        for a in range(len(ids)):
            for b in range(a + 1, len(ids)):
                d = float(np.linalg.norm(R.loc[ids[a]] - R.loc[ids[b]]))
                pair = {lab[ids[a]], lab[ids[b]]}
                (cross if pair == set(B12) else same if len(pair) == 1 else []).append(d)
    cross, same = np.array(cross), np.array(same)
    return {"b1_b2_median": round(float(np.median(cross)), 2), "same_label_median": round(float(np.median(same)), 2),
            "n_cross": len(cross), "n_same": len(same), "auc_cross_gt_same": round(float((cross[:, None] > same[None]).mean()), 2)}


def within_strip_classifier(df: pd.DataFrame, R: pd.DataFrame, y: np.ndarray | None = None) -> tuple[float, np.ndarray]:
    """The within-strip direction used as an absolute classifier: strip held out, w = mean B1 - B2 contrast of
    the training strips that hold both, threshold midway between the training B1 and B2 scores."""
    sub = df[df["batch"].isin(B12)].reset_index(drop=True)
    y = sub["batch"].to_numpy(str) if y is None else y
    s, X = sub["strip"].to_numpy(str), R.loc[sub["image_id"]].to_numpy()
    pred = np.empty(len(sub), object)
    for h in np.unique(s):
        tr = s != h
        D = [X[tr & (s == g) & (y == "Batch_1")].mean(0) - X[tr & (s == g) & (y == "Batch_2")].mean(0)
             for g in np.unique(s[tr]) if set(y[tr & (s == g)]) >= set(B12)]
        if not D:
            pred[~tr] = "Batch_1"
            continue
        sc = X @ np.mean(D, 0)
        thr = (sc[tr & (y == "Batch_1")].mean() + sc[tr & (y == "Batch_2")].mean()) / 2
        pred[~tr] = np.where(sc[~tr] > thr, "Batch_1", "Batch_2")
    return A.balanced_accuracy(y, pred.astype(str)), pred


def within_strip_null(df: pd.DataFrame, R: pd.DataFrame) -> dict:
    """Exact null over every relabelling that keeps the design: each mixed strip's labels swapped or not,
    times every arrangement of the single-label strips' labels."""
    from itertools import permutations

    sub = df[df["batch"].isin(B12)].reset_index(drop=True)
    y0, s = sub["batch"].to_numpy(str), sub["strip"].to_numpy(str)
    shared = [g for g in np.unique(s) if set(y0[s == g]) >= set(B12)]
    single = [g for g in np.unique(s) if g not in shared]
    acc, pred = within_strip_classifier(df, R)
    null = []
    for flips in product((0, 1), repeat=len(shared)):
        for perm in set(permutations([y0[s == g][0] for g in single])):
            y = y0.copy()
            for g, f in zip(shared, flips):
                if f:
                    y[s == g] = np.where(y0[s == g] == "Batch_1", "Batch_2", "Batch_1")
            for g, lab in zip(single, perm):
                y[s == g] = lab
            null.append(within_strip_classifier(df, R, y)[0])
    null = np.array(null)
    return {"balanced_accuracy": round(acc, 3), "right": int((pred == y0).sum()), "n": len(y0), "n_null": len(null),
            "null_p95": round(float(np.percentile(null, 95)), 3), "p": round(float(np.mean(null >= acc)), 3),
            "test_images": {i: p for i, p in zip(sub["image_id"], pred) if i in TRUTH}}


def frozen_within_strip(df: pd.DataFrame) -> dict:
    """The frozen stage 2's p(Batch_1) for every Batch_1/Batch_2 image of the mixed strips."""
    part = A.model_parts(A.load_model())["variation"]
    p = A._eval_part(part, df)[0][:, part["classes"].index("Batch_1")]
    out = {}
    for s, g in df.assign(p=p).groupby("strip"):
        if set(B12) <= set(g["batch"]):
            out[s] = {r.image_id: {"batch": r.batch, "p_Batch_1": round(float(r.p), 3)} for r in g.itertuples() if r.batch in B12}
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = load()
    res = {"truth": TRUTH}
    res["layout"] = layout(df)
    print("contiguous chains (* = test image, true label):")
    for s, c in res["layout"]["chains"].items():
        print(f"  {s}: {c}")
    print("  max r between non-adjacent images of a strip:", res["layout"]["max_non_adjacent_r"])

    known = df[~df["image_id"].isin(TRUTH)].reset_index(drop=True)
    res["frozen_recipe"] = {"31 known": frozen_recipe(known), "34 with truth": frozen_recipe(df)}
    print(json.dumps(res["frozen_recipe"], indent=1, default=str))

    res["strip_memory"] = strip_memory(df)
    print("strip memory (leave-one-image-out, deep, shared strips):", res["strip_memory"]["right"], "/", res["strip_memory"]["n"])
    for r in res["strip_memory"]["per_image"]:
        print("  ", r)

    res["b12_loso"] = {}
    for name, fams in {"deep (frozen stage 2)": ("deep",), "material": MATERIAL_FAMILIES, "texture": ("tex",), "imaging (not a model input)": ("img",)}.items():
        res["b12_loso"][name] = b12_loso(df, fams)
        print("B1 vs B2 LOSO", name, res["b12_loso"][name], flush=True)

    res["frozen_stage2_within_strip"] = frozen_within_strip(df)
    print("frozen stage 2 p(Batch_1) inside the mixed strips:", json.dumps(res["frozen_stage2_within_strip"]))

    reps = representations(df)
    res["paired"], res["neighbours"], res["within_strip_classifier"] = {}, {}, {}
    for name, R in reps.items():
        res["paired"][name] = paired(df, R)
        res["neighbours"][name] = neighbour_distances(df, R)
        res["within_strip_classifier"][name] = within_strip_null(df, R)
        p, nb, w = res["paired"][name], res["neighbours"][name], res["within_strip_classifier"][name]
        print(f"{name:48s} paired LOSO {p['loso_right']}/{p['n']} (p={p['p_one_sided']})  same-sign {p['all_same_sign']}/{p['features']} (null median {p['null_median']}, p={p['null_p_ge']})"
              f"  | B1-B2 neighbours {nb['b1_b2_median']} vs same-label {nb['same_label_median']} (AUC {nb['auc_cross_gt_same']})"
              f"  | absolute {w['balanced_accuracy']} ({w['right']}/{w['n']}) null p95 {w['null_p95']} p={w['p']}", flush=True)
    (OUT / "result.json").write_text(json.dumps(res, indent=1, default=A._json_default))
    print(f"wrote {OUT / 'result.json'}")


if __name__ == "__main__":
    main()


def strip_figure(path: Path = Path("docs/experiments/T18_strips.png")) -> None:
    """BSE of the contiguous chains that hold more than one label, stitched left to right, labels on top."""
    from PIL import ImageDraw, ImageFont

    chains = [("2316", ["5n1q8atc", "3e122cbj", "4ih2ggld"]), ("2048", ["fn0mhxef", "3806gxp0"]), ("2080", ["cfe5vt7s", "r17byphk", "ffwubibz"]), ("2148", ["f1vzngrs", "epqdaau9"])]
    df = load()
    lab = dict(zip(df["image_id"], df["batch"]))
    folder = lambda i: "Hackathon-Polaron-test" if i in TRUTH else lab[i]
    colors = {"Batch_1": (232, 163, 61), "Batch_2": (76, 155, 232), "Batch_3": (190, 190, 190)}
    font = ImageFont.load_default(size=15)
    rows = []
    for strip, ids in chains:
        parts = []
        for i in ids:
            a = np.asarray(Image.open(next(Path("data", folder(i)).glob(f"img_{i}_BSE.tif"))))
            parts.append((a[..., 0] if a.ndim == 3 else a)[:, 8:-8][::12, ::12])
        img = Image.fromarray(np.hstack(parts)).convert("RGB")
        canvas = Image.new("RGB", (img.width, img.height + 48), (18, 19, 22))
        canvas.paste(img, (0, 48))
        d = ImageDraw.Draw(canvas)
        d.text((4, 2), f"strip {strip}: one continuous cross-section, images touch edge to edge", fill=(220, 220, 220), font=font)
        x = 0
        for i, p in zip(ids, parts):
            d.line([(x, 48), (x, canvas.height)], fill=(255, 255, 255), width=2)
            d.text((x + 6, 24), f"{i}{' (test)' if i in TRUTH else ''}: {lab[i].replace('_', ' ')}", fill=colors[lab[i]], font=font)
            x += p.shape[1]
        rows.append(canvas)
    width = max(r.width for r in rows)
    out = Image.new("RGB", (width, sum(r.height + 10 for r in rows)), (18, 19, 22))
    y = 0
    for r in rows:
        out.paste(r, (0, y))
        y += r.height + 10
    out.quantize(64).save(path, optimize=True)
    print(f"wrote {path}")
