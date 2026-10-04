"""T14 adoption check: which confidence method and call rule go into the model (docs/experiments/T14.md, "Adoption").

Two views of the same staged `material > deep` classifier, each with every variant:

  A. the 31 known images: strip-held-out probabilities, calibrated with the other strips' points only;
  B. the rehearsal: 30 draws of 9 unseen images (3 per batch), classifier and calibration refitted on the other 22.

Usage: PYTHONPATH=. uv run python scripts/experiments/T14_adoption.py   # about 5 minutes
"""

import json
from pathlib import Path

import numpy as np
from sklearn.isotonic import IsotonicRegression

from qc import attribute as A
from qc.features import MATERIAL_FAMILIES, load_features

OUT = Path("out/experiments/T14")
BASELINE = "Batch_3"
CLASSES = ["Batch_1", "Batch_2", "Batch_3"]
B = CLASSES.index(BASELINE)
STAGED = (MATERIAL_FAMILIES, ("deep",))
TEMPERATURES = np.geomspace(0.02, 20, 121)
DRAWS = 30


def temper(P, t):
    logp = np.log(np.clip(P, 1e-12, None)) / t
    out = np.exp(logp - logp.max(axis=1, keepdims=True))
    return out / out.sum(axis=1, keepdims=True)


def temperature(P, truth) -> float:
    losses = [-np.log(np.clip(temper(P, t)[np.arange(len(truth)), truth], 1e-12, None)).mean() for t in TEMPERATURES]
    return float(TEMPERATURES[int(np.argmin(losses))])


def plain_venn_abers(P, cal_P, cal_truth):
    """Venn-Abers as recorded in T14: every calibration point weighs the same (the model's version is class-balanced)."""
    scores, labels = cal_P[:, B], (cal_truth == B).astype(float)
    pb = []
    for x in P[:, B]:
        p0, p1 = (IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(np.append(scores, x), np.append(labels, lab)).predict([x])[0] for lab in (0, 1))
        pb.append(p1 / (1 - p0 + p1))
    pb = np.array(pb)
    rest = np.delete(P, B, axis=1)
    return np.insert((1 - pb)[:, None] * rest / rest.sum(axis=1, keepdims=True), B, pb, axis=1)


def balanced_venn_abers(P, cal_P, cal_truth):
    return A._calibrated(P, CLASSES, BASELINE, {"scores": cal_P[:, B], "labels": (cal_truth == B).astype(float)})[0]


argmax = lambda Q: Q.argmax(axis=1)
staged_call = lambda Q: np.array([A._call(q, CLASSES, BASELINE) for q in Q])

VARIANTS = {
    "0 temperature, argmax (frozen 3 Oct)": (lambda P, cP, cy: temper(P, temperature(cP, cy)), argmax),
    "1 no calibration, argmax": (lambda P, cP, cy: P, argmax),
    "2 no calibration, staged call": (lambda P, cP, cy: P, staged_call),
    "3 Venn-Abers as in T14, argmax": (plain_venn_abers, argmax),
    "4 Venn-Abers as in T14, staged call": (plain_venn_abers, staged_call),
    "5 balanced Venn-Abers, staged call (adopted)": (balanced_venn_abers, staged_call),
}


def metrics(Q, truth, pred) -> dict:
    n = len(truth)
    conf, right = Q[np.arange(n), pred], pred == truth
    tiers = {name: {"right": int(right[sel].sum()), "n": int(sel.sum())}
             for name, sel in (("high", conf >= 0.75), ("medium", (conf >= 0.5) & (conf < 0.75)), ("low", conf < 0.5))}
    pb, yb = np.clip(Q[:, B], 1e-6, 1 - 1e-6), (truth == B).astype(float)
    return {"right": int(right.sum()), "n": n, "balanced_accuracy": A.balanced_accuracy(truth, pred), "tiers": tiers,
            "log_loss": float(-np.log(np.clip(Q[np.arange(n), truth], 1e-12, None)).mean()),
            "stage1_log_loss": float(-(yb * np.log(pb) + (1 - yb) * np.log(1 - pb)).mean())}


def out_of_fold(df, seed=0):
    per = A.loso_cv(df, staged=STAGED, baseline=BASELINE, seed=seed)["per_image"]
    return per[[f"p_{c}" for c in CLASSES]].to_numpy(float), np.array([CLASSES.index(b) for b in per["batch"]]), per["strip"].to_numpy(str)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    df = load_features().reset_index(drop=True)
    assert set(df["batch"]) == set(CLASSES) and len(df) == 31
    P, truth, strips = out_of_fold(df)
    draws = []
    for r in range(DRAWS):
        held = A._hold_out(df, 3, np.random.default_rng(r))
        test, train = df.loc[held], df.drop(index=held)
        parts = A._fit_parts(train, A._stage_features(train, MATERIAL_FAMILIES, STAGED), BASELINE, r)
        draws.append((*out_of_fold(train, r)[:2], A._parts_proba(parts, test, CLASSES, BASELINE), np.array([CLASSES.index(b) for b in test["batch"]])))
    result = {"known_31": {}, "rehearsal": {}}
    for name, (calibrated, call) in VARIANTS.items():
        Q = np.zeros_like(P)
        for s in np.unique(strips):
            Q[strips == s] = calibrated(P[strips == s], P[strips != s], truth[strips != s])
        result["known_31"][name] = metrics(Q, truth, call(Q))
        Qs = [calibrated(raw, cal_P, cal_truth) for cal_P, cal_truth, raw, _ in draws]
        result["rehearsal"][name] = metrics(np.vstack(Qs), np.concatenate([d[3] for d in draws]), np.concatenate([call(Q) for Q in Qs]))
    (OUT / "adoption.json").write_text(json.dumps(result, indent=2))
    for view, rows in result.items():
        print(view)
        for name, m in rows.items():
            tiers = " ".join(f"{t['right']}/{t['n']}" for t in m["tiers"].values())
            print(f"  {name:46s} {m['right']:3d}/{m['n']:<3d} balanced {m['balanced_accuracy']:.2f}  tiers {tiers:22s} log loss {m['log_loss']:.2f}  stage 1 {m['stage1_log_loss']:.2f}")


if __name__ == "__main__":
    main()
