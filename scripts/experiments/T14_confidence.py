"""T14: confidence methods on the frozen recipe's out-of-fold probabilities (docs/experiments/T14.md).

Usage: PYTHONPATH=. uv run python scripts/experiments/T14_confidence.py
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from qc import attribute as A
from qc.features import MATERIAL_FAMILIES, load_features

OUT = Path("out/experiments/T14")
BASELINE = "Batch_3"
CLASSES = ["Batch_1", "Batch_2", "Batch_3"]
ALPHA = 0.2
MAP_C = 2.5**2
TEMPERATURES = np.geomspace(0.02, 20, 121)   # the grid qc.attribute used until the model dropped its temperature (T14 adoption)


def temper(probs: np.ndarray, t: float) -> np.ndarray:
    """Temperature scaling of probabilities: p ** (1 / T), renormalised."""
    logp = np.log(np.clip(probs, 1e-12, None)) / t
    out = np.exp(logp - logp.max(axis=1, keepdims=True))
    return out / out.sum(axis=1, keepdims=True)


def oof(df: pd.DataFrame, feats, C: float | None) -> np.ndarray:
    """Out-of-fold three-way probabilities: nested C (C=None) or a fixed C in both stages."""
    if C is None:
        cv = A.loso_cv(df, features=feats, staged=(MATERIAL_FAMILIES, ("deep",)), baseline=BASELINE)
        return cv["per_image"][[f"p_{c}" for c in CLASSES]].to_numpy(float)
    groups = df["strip_id"].map(A.strip_group).to_numpy()
    P = np.zeros((len(df), 3))
    for g in np.unique(groups):
        te = groups == g
        parts = A._fit_parts(df[~te], feats, BASELINE, nested=False, C=C)
        P[te] = A._parts_proba(parts, df[te], CLASSES, BASELINE)
    return P


def temperature(P, truth) -> float:
    losses = [-np.log(np.clip(temper(P, t)[np.arange(len(truth)), truth], 1e-12, None)).mean() for t in TEMPERATURES]
    return float(TEMPERATURES[int(np.argmin(losses))])


def loo_temper(P, truth) -> np.ndarray:
    out = np.zeros_like(P)
    for i in range(len(P)):
        m = np.arange(len(P)) != i
        out[i] = temper(P[i:i + 1], temperature(P[m], truth[m]))[0]
    return out


def three_way_metrics(P, truth) -> dict:
    y = np.eye(3)[truth]
    pred, conf = P.argmax(1), P.max(1)
    tiers = {}
    for name, lo, hi in (("high", 0.75, 2), ("medium", 0.5, 0.75), ("low", 0, 0.5)):
        sel = (conf >= lo) & (conf < hi)
        tiers[name] = {"right": int((pred[sel] == truth[sel]).sum()), "n": int(sel.sum())}
    return {"balanced_accuracy": A.balanced_accuracy(np.array(CLASSES)[truth], np.array(CLASSES)[pred]),
            "brier": float(((P - y) ** 2).sum(1).mean()), "log_loss": float(-np.log(np.clip(P[np.arange(len(P)), truth], 1e-12, None)).mean()),
            "tiers": tiers}


def binary_metrics(p, yb) -> dict:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return {"brier": float(((p - yb) ** 2).mean()), "log_loss": float(-(yb * np.log(p) + (1 - yb) * np.log(1 - p)).mean())}


def venn_abers(scores, yb) -> tuple[np.ndarray, np.ndarray]:
    p0, p1 = np.zeros(len(scores)), np.zeros(len(scores))
    for i in range(len(scores)):
        m = np.arange(len(scores)) != i
        for lab, store in ((0, p0), (1, p1)):
            iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(np.append(scores[m], scores[i]), np.append(yb[m], lab))
            store[i] = iso.predict([scores[i]])[0]
    return p0, p1


def conformal(Pt, truth, loo: bool) -> dict:
    n = len(truth)
    nc = 1 - Pt[np.arange(n), truth]
    covered, sizes = [], []
    for i in range(n):
        cal = nc[np.arange(n) != i] if loo else nc
        m = len(cal)
        q = np.quantile(cal, min(1.0, np.ceil((m + 1) * (1 - ALPHA)) / m), method="higher")
        s = 1 - Pt[i] <= q
        s[Pt[i].argmax()] = True  # the bet is always in the set, as in predict()
        covered.append(bool(s[truth[i]]))
        sizes.append(int(s.sum()))
    return {"coverage": float(np.mean(covered)), "mean_size": float(np.mean(sizes))}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = load_features().reset_index(drop=True)
    assert set(df.batch) == set(CLASSES) and len(df) == 31
    feats = (A.usable_features(df, MATERIAL_FAMILIES), A.usable_features(df, ("deep",)))
    truth = np.array([CLASSES.index(b) for b in df.batch])
    yb = (truth == 2).astype(float)
    P = oof(df, feats, None)
    Pt = loo_temper(P, truth)
    res = {"1 temperature (LOO)": three_way_metrics(Pt, truth)}
    p0, p1 = venn_abers(Pt[:, 2], yb)
    pva = p1 / (1 - p0 + p1)
    res["2 stage 1"] = {"temperature": binary_metrics(Pt[:, 2], yb), "venn_abers": binary_metrics(pva, yb) | {"mean_width": float((p1 - p0).mean())}}
    Pin = temper(P, temperature(P, truth))
    res["3 sets"] = {"today_split_in_sample": conformal(Pin, truth, loo=False), "loo_cross_conformal": conformal(Pt, truth, loo=True)}
    Pm = oof(df, feats, MAP_C)
    res["4 MAP prior C=6.25 (raw)"] = three_way_metrics(Pm, truth)
    res["4 nested C (raw)"] = three_way_metrics(P, truth)
    res["4 MAP prior C=6.25 (LOO temperature)"] = three_way_metrics(loo_temper(Pm, truth), truth)
    (OUT / "result.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
