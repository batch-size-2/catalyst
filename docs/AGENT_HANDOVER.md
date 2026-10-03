# Agent handover: ML side (Pat), state as of 2026-10-03

For the next agent picking up Pat's ML work. It covers what exists, what was measured, what the task designer said since PLAN_v3 was written, the gaps that opens, and the next steps in order.
Read this first, then `docs/PLAN_v3.md` (the team plan), `docs/ML_HANDOVER.md` (contract for Patrik) and `AGENTS.md` (repo rules).

---

## 0. Orientation

| Item | Value |
|---|---|
| Repo | `https://github.com/batch-size-2/catalyst`, local `/Users/pat/conductor/workspaces/batch-size-2/catalyst` |
| Branch | `pat/ml-v3`, off `main` at `98a2b19`. ML commit `6e140ed`, plus this handover doc. **Not pushed** |
| Team | Pat = ML (the user). Patrik = backend/UI: `qc/decide.py`, `qc/api.py`, `web/`, `config/decision.yaml` |
| Plan | `docs/PLAN_v3.md` is team-owned: don't rewrite it from a code PR, never edit older versions. Changes go into a new `PLAN_v4.md` that both owners review |
| Python env | `uv` is at `~/.local/bin/uv` (`export PATH="$HOME/.local/bin:$PATH"`). Then `uv sync` and `uv run pytest -q` (15 pass, about 10 s) |
| Data | `data/Batch_1`, `data/Batch_2`, `data/Batch_3` are symlinks to `/Users/pat/conductor/workspaces/catalyst/data/Batch_*`. 31 fields × 3 detectors (BSE, ETD, Inlens), 8-bit, 2316×~7000 px, 0.025 µm/px. Gitignored |
| Hard rules | Images never leave the machine (no upload to any external service, LLM or cloud without Polaron's OK). Never commit `data/` or `out/`. No Polaron models or tools (PLAN rule 1; their open-source code such as ImageRep, TauFactor or HR-Dv2 is also off-limits until mentor question §10 Q10 is answered). No LLM measures, decides or explains. Don't edit `config/decision.yaml` or `config/particle_types.json` after the `rules-frozen` tag |
| Provisional config | `config/particle_types.json` is committed but is only the first type fit (k=2, all batches), **not frozen**. Refit before `rules-frozen` (§5 step 6) |
| Local artefacts | `out/kpis.csv`, `out/particles.csv`, `out/imaging.csv`, `out/masks/`, `out/crops/T1,T2/`, `out/controls/summary.csv`, `out/uncertainty/*.csv`. Review images in `/tmp/qc_review/` (`v2_*.png` overlays, `types_sheet.png`, `kpis_before.csv`) |

---

## 1. What was implemented (branch `pat/ml-v3`)

All of Pat's PLAN_v3 steps 2–4 and 6–10 have code. Details for consumers are in `docs/ML_HANDOVER.md`; the README is in sync (AGENTS.md rule).

| Module | Functions | Notes |
|---|---|---|
| `qc/measure.py` | `black_level`, `preprocess`, `default_thresholds`, `segment(channels, px_um, thresholds=None)`, `label_si`, `two_point`, `kpis`, `particles`, `imaging` | `segment()`: BSE minus black level, 2× block-mean, Gaussian σ=1, 3-class multi-Otsu → pore/graphite/Si; thin bright rims → BINDER; Si < 0.25 µm² → graphite; **dim-object rule**: Si components with median < 1.5× graphite mode → BINDER (`SI_MIN_CONTRAST`); top/bottom 5% rows → IGNORE; full-res output. `kpis()`: 15 descriptors (see `schema.KPI_UNITS`). `particles()`: one row per Si particle (size, contrast, inlens_ratio, void_frac, texture, solidity, border, centroid). `imaging()`: per channel black level, percentiles, noise, sharpness, saturation, curtaining index |
| `qc/types.py` | `fit_types`, `assign_types`, `type_shares`, `save_types`, `load_types`, `save_type_crops`, CLI | Gaussian mixture on 6 standardised particle features; k picked by leave-one-strip-out ARI; Mahalanobis assignment with an `unassigned` threshold; optional `porous_rule` |
| `qc/controls.py` | `iter_controls`, `make_controls`, `shared_strip_controls`, CLI | 7 negatives (brightness/contrast ±20%, black +20, noise σ5, curtaining), 4 positives (Si +50%/+100% by pasting donor particles, voids, Si scaled 1.5× and thinned), 3 shared-strip controls (PLAN §3.13). `kept_in_reference` holds **image_ids** |
| `qc/uncertainty.py` | `threshold_variants`, `integral_range`, `area_needed`, CLI | Thresholds ±5 grey levels; integral range from the radial two-point correlation (classical estimator, not ImageRep) |
| `qc/run.py` (shared glue) | `measure() → Tables`, `measure_field`, `save_tables` | Writes the 3 CSVs; assigns types if `config/particle_types.json` exists; `judge()`/API/UI unchanged |
| `qc/schema.py` (contract, additive) | `PARTICLE_COLUMNS`, `IMAGING_COLUMNS`, `Tables`, `Control`, `PARTICLE_TABLE`, `IMAGING_TABLE`, `PARTICLE_TYPES_PATH`, `crop_path`; 7 KPIs appended | Fixture `tests/fixtures/kpis_fake.csv` has the new columns empty |
| `config/kpi_dictionary.yaml` | draft | Causes need mentor review |
| `tests/test_ml.py` | 9 tests on synthetic anodes | segment/kpis/particles/imaging/types/controls/uncertainty/dim-object rule |

Deviations from PLAN_v3 are listed in README "Deviations from PLAN_v3" (8 items). The main one is the dim-object → BINDER rule, added after P2316 overlays showed carbon-binder "fluff" and surfaces seen through pores being labelled Si.

Commands:
```bash
uv run python -m qc.measure                          # ~8 s/image -> out/*.csv, out/masks/
uv run python -m qc.types [--exclude Batch_2] [--porous-rule]
uv run python -m qc.controls --baseline data/Batch_3
uv run python -m qc.uncertainty --batch data/Batch_3
```

---

## 2. What was measured (real data, 31 images, 0 failures)

- **Batch means** (mean ± SD over images): `si_graphite_ratio` B1 0.105±0.054, B2 0.067±0.015, B3 0.075±0.014. Batch_1's elevation is almost entirely strip P2316 (0.181; every other strip is 0.055–0.094). P2316's Si is also dimmer and coarser (contrast 1.62 against 1.84–2.27).
- **Variance split** (nested sums of squares, descriptive): most variation sits between strips. `si_graphite_ratio`: 21% between batches (6% without P2316), 72% between strips, 7% between images.
- **Controls on Batch_3:** negatives move `si_graphite_ratio` ≤ 0.6%. Si +50/+100% → +49%/+101%. Voids: void fraction 0.003 → 0.073. Scale: D50 +59%. Shared-strip controls: 0% / +33% / +50%. Side effect: the Si-paste controls also lower D50 (3.9 → 2.9 µm).
- **Threshold ±5 sensitivity on Batch_3:** `si_graphite_ratio` 0.0057, `si_d50_um` 0.21 µm, `porosity_apparent` 0.021.
- **Particle types (first fit, not frozen):** k=2. T1 bright/dense (2.1× graphite, D50 1.9 µm, 65% of Si area); T2 dim/grainy (1.7×, D50 2.2 µm, 35%). P2316 is 99% T2. Porous particles (P2060) did **not** get their own type, and `void_frac > 0.1` covers only 0.1% of P2060's Si area. Auto-names both came out "mid, grey"; rename before freezing.
- **Batch separability with the current descriptors: none.** Regularised logistic regression on the 15 KPIs:
  - leave-one-image-out: balanced accuracy 0.49;
  - **leave-one-strip-out: 0.35** (chance 0.33; the 95th percentile with shuffled labels is 0.48).
  
  The designed batch signal is not captured by the current whole-image features.
- **One lead:** in strips shared between folders, Batch_2 has higher `si_dispersion_cv` (local Si patchiness) than the other folder in 4 of 5 strips (e.g. strip 2080: B2 0.92 against B1 0.63 / B3 0.70). Small n; a hypothesis only.

Strip structure (strip = first number of `strip_id`, i.e. image height):
- Shared between folders: 2080 (B1, B2, B3), 2068 (B2, B3), 2272 (B2, B3), 2148 (B1, B2), 2156 (B1, B2).
- Folder-only: B1 has 1780, 1880, 2316; B2 has 2048; B3 has 1612, 1904, 2060, 2088.

---

## 3. New information since PLAN_v3 (from Pat and the task designer)

1. **Batch_3 is the baseline** (it has the most images). Confirmed.
2. **The baseline is not necessarily defect-free.** Batches are not defined by whether defects are present; many complex morphology features matter.
3. **Polaron context** (the company behind the task, polaron.ai), from their public material:
   - their Quality page promises "objective acceptance criteria from feature distributions, batch-to-batch drift, traceable evidence";
   - their August 2026 trust blog uses Si-anode SEM data, measures segmentation accuracy against expert brush labels, and says eyeballing overlays is not enough;
   - their proprietary "coherence" score flags unfamiliar images;
   - they quantify cracks (inside particles, separate from the pores between particles) and binder.
4. **Designer, latest:**
   1. Many features are to be discovered in **different regions** of the image.
   2. Even though one strip image was split across batches, the batches were **designed to be separable by a model** on high-level features.
   3. Batch_3 is the baseline; a manufacturer is wary of anything too far outside the baseline SD **in either direction**.
   4. **Test:** he will drop **9 new images, 3 per batch**; we must say **which batch each belongs to**. This is how our model is judged.
   5. Extra feature: **how the material would wear and degrade over time.**

---

## 4. Gaps (what the new information breaks or leaves open)

| # | Gap | Severity | Why |
|---|---|---|---|
| G1 | No batch-attribution capability | **Critical** | The test is batch attribution. Current descriptors score chance under strip-held-out testing (§2). PLAN_v3 rule 2 ("no classifier trained on batch folders") and "per-image verdicts are gone" contradict the designer's test |
| G2 | Features are whole-image averages over BSE only | **Critical** | The designer says features live in different regions. ETD and InLens are barely used. The top/bottom 5% rows are discarded unexamined. No texture or deep features |
| G3 | No estimate of attribution accuracy | High | We must say how good the model is before the drop, from strip-held-out testing and the shared-strip check, never from leave-one-image-out (leaks via strip) |
| G4 | Leakage risk | High | `strip_id`, image height, XResolution and `px_um` identify strips, and some strips are folder-specific. They must never be features. Imaging artefacts (e.g. P2060 black level 22) can also identify batches without being material differences; report them separately |
| G5 | Two-sided "distance from baseline" view missing | Medium | PLAN_v3's comparison is two-sided (margin 1.5 × reference segment SD), but there is no simple per-feature "how many SDs from Batch_3" plus "unlike anything in the baseline" view. `compare()` is Patrik's and not built yet |
| G6 | Baseline defects barely measured | Medium | Porous Si (P2060) isn't captured: void_frac only counts enclosed holes. No crack descriptor, no binder fraction, no split of porosity into between-particle and inside-particle |
| G7 | Segmentation accepted only by eye | Medium | Polaron (the judges) explicitly argue against this. No labelled-patch benchmark |
| G8 | No degradation/wear outlook | Medium (extra feature) | Only PLAN §3.8 "indicative consequences" (capacity, swelling, Bruggeman) exist, as text, not built |
| G9 | Particle types not final | Low | Porous gap, generic names, fit includes all batches (dry run must refit without the held-out batch) |
| G10 | Plan out of date | Medium | PLAN_v4 needed (team-owned): attribution track, rule 2 change, regional features, two-sided view, degradation, Polaron-informed changes |
| G11 | Patrik-side stale items | Low | `config/decision.yaml` has `baseline: Batch_1`; README "First run on the real data" and the `reference_exclude` advice describe the old Batch_1 baseline |

Open questions for the designer/mentors (ask Pat to relay):
- Q-A: Will the 9 test images arrive mixed, or in three unlabelled groups of 3?
- Q-B: Are they from strips we've already seen, or new strips?
- Q-C: Is the image top/bottom (rows we discard) meaningful? Which direction runs through the electrode thickness?
- Q-D: Are "high-level features" meant as deep-network features, or higher-level morphology?

---

## 5. Plan next, in priority order

Keep everything offline. Images never leave the machine; downloading model weights (e.g. DINOv2 from Hugging Face) is allowed by PLAN §7.

### Step 1: Feature discovery for batch separation (G1, G2, G4). Do first.
New module `qc/features.py` (Pat-owned) that builds a per-image feature table `out/features.csv` (one row per image, plus `batch, image_id, strip_id`). Feature families:

1. **Regional descriptors.**
   - Tile each image (e.g. ~15 µm ≈ 600 px tiles, also tried at ~30 µm).
   - Compute a cheap subset of `kpis()` per tile: phase fractions, Si/graphite, chords, local Si fraction.
   - Summarise across tiles: mean, SD, CV, 10/50/90th percentiles, and a top-to-bottom profile slope (row-band means).
   - Also compute descriptors on the discarded top/bottom 5% bands separately, flagged as such.
2. **Texture on all three channels:** e.g. local binary pattern histograms and grey-level co-occurrence statistics on black-subtracted images, with and without phase masks. Check `uv.lock` before adding any package; `scikit-image` already has LBP and GLCM.
3. **Deep features:**
   - DINOv2 (small/base) patch embeddings on tiles of the BSE (and optionally ETD/InLens), pooled per image (mean plus a few quantiles or PCA components).
   - Needs `torch` and `transformers` (or `timm`). Add via `uv add`, respecting `exclude-newer`, and cache the weights locally.
   - Must be **plain DINOv2**, not tldr-group/Polaron HR-Dv2 or "coherence".
4. **Existing descriptors** from `out/kpis.csv`, the `out/particles.csv` aggregates (size quantiles, type shares, solidity, texture), and `out/imaging.csv`. Keep imaging in a separate family so material and acquisition signals can be told apart.

**Never include:** `strip_id`, image height or width, `px_um`, XResolution, or anything derived from them.

Evaluation (`qc/features.py` CLI or a notebook-free script; the agent authors and checks the numbers itself):
- **Leave-one-strip-out** grouped CV. Group = strip number, so all images of a strip across all folders are held out together. Report balanced accuracy and the confusion matrix per feature family and for the combination.
- **Permutation null:** shuffle batch labels (≥ 200 times), same CV, report the 95th percentile.
- **Shared-strip test:** within strips 2080, 2068, 2272, 2148 and 2156, does the model assign the images to their folders? This is the cleanest evidence of a designed batch signal.
- Rank individual features by univariate separation under the same grouped CV. Start by checking the `si_dispersion_cv` lead.

Done when there is a table of feature family → strip-held-out balanced accuracy vs null, plus the top-10 separating features with effect sizes and example tiles. Share the numbers with Pat before building the model.

### Step 2: Attribution model and frozen 9-image command (G1, G3)
- New module `qc/attribute.py`.
- Model: a simple, regularised, explainable classifier on the features chosen in step 1: logistic regression or nearest shrunken centroid. Hyperparameters chosen by nested strip-held-out CV. Class-balanced (B3 has 17 images vs 7/7).
- Explanation per image:
  - top feature contributions in units;
  - a **region heatmap** (per-tile contribution or class probability) so the designer sees *where* in the image the evidence is;
  - the nearest known images.
- Output `out/attribution/<run>.json`: per image, probabilities for B1/B2/B3, predicted batch, top reasons, heatmap path, and an "unlike anything seen" flag.
- If the drop is 3 per batch and unlabelled (Q-A): add a balanced-assignment option (Hungarian on log-probabilities, 3 per class) alongside the unconstrained prediction. Show both.
- If test images come from known strips (Q-B), the evaluation must say so; otherwise strip identity could be mistaken for material signal. Report the expected accuracy from step 1's strip-held-out score.
- Freeze: save the model and feature config under `config/` (e.g. `config/attribution_model.json` or `.joblib`; prefer a JSON of coefficients and scaler for auditability) and include them in the `rules-frozen` tag together with `config/particle_types.json`.
- CLI: `uv run python -m qc.attribute --images data/<drop>` (works on a flat folder of mixed images).
- Dry run: hold out 3 images per batch from the known data (whole strips where possible), refit, predict, and report.
- Tests in `tests/test_ml.py` (synthetic): deterministic output, schema of the JSON, balanced assignment gives 3 per class.

### Step 3: Two-sided baseline-distance view (G5). Coordinate with Patrik
- Per descriptor and per batch: z = (batch value − Batch_3 mean) / Batch_3 SD, using strip-segment values, with both directions flagged. Plus a multivariate "unlike anything in the baseline" distance (nearest-neighbour or Mahalanobis on standardised descriptors).
- Pat provides the numbers (a function in `qc/attribute.py` or `qc/features.py`); Patrik renders them and folds them into `compare()`/Evidence. Agree the field names with Patrik (`qc/schema.py` contract rule).

### Step 4: Degradation and wear outlook (G8). Extra feature, never part of the verdict
New module `qc/degrade.py`. Indicative ranges relative to Batch_3, every assumption printed:
- **Swelling:** Si share of solid × ~280% lithiation expansion (graphite ~10%). Si-vs-SiOx range until confirmed.
- **Can the pores absorb it:** available `porosity_apparent` vs required expansion volume.
- **Virtual lithiation (demo):** dilate each Si particle to its full-lithiation size (~2.4× area in 2D), measure the share of pore space consumed and the overlap with graphite, and render a before/after overlay.
- **Fracture risk:** share of Si area in coarse particles (D90 tail) and agglomerates; already-present cracks and fragments.
- **Contact loss risk:** share of Si perimeter touching graphite vs pore/binder.
- **Transport:** Bruggeman porosity^1.5.
- **Buffering:** internal voids / porous Si.
- Output `out/degradation/<batch>.json` plus a short templated text. Wording: "indicative, possible", never a prediction of lifetime.

### Step 5: Measurement quality (G6, G7)
- **Labelled-patch segmentation benchmark:** Pat brush-labels a few 300×300 px patches per Batch_3 strip plus P2316 (pore/graphite/Si/binder). Script to report per-phase accuracy and IoU, and the phase-fraction error of `segment()`. It's a benchmark, not training. It also validates `SI_MIN_CONTRAST`.
- **New descriptors** (append to `KPI_UNITS`, update the fixture, README and KPI dictionary):
  - `crack_frac` (thin pores inside filled graphite or Si particles);
  - `binder_frac`;
  - porosity split into between-particle and inside-particle;
  - an open-pore porous-Si measure (texture- or opening-based), so P2060's porous particles are captured. Then refit types and decide on `--porous-rule`.

### Step 6: Housekeeping
- Draft `docs/PLAN_v4.md` for Pat and Patrik to review (don't merge it unilaterally). Content:
  - the attribution track replaces rule 2 for attribution only; the QC verdict stays statistical;
  - regional features;
  - the two-sided view;
  - degradation;
  - Polaron-informed changes: segmentation benchmark, explainable unfamiliar-image flag, crack/binder descriptors, swappable segmentation (masks from a folder);
  - updated cut list.
- Tell Patrik (via Pat): `baseline: Batch_3` in `config/decision.yaml`; stale README baseline sections.
- Before the freeze: rename the particle types, decide the porous rule, refit types without the dry-run batch for the dry run, then restore.
- Pushing `pat/ml-v3` and opening a PR needs Pat's OK.

### Suggested cut order if time runs short
Optional LLM review → DINOv2 nearest-neighbour safety net → strip-leak chart (step 1 already covers it) → integral-range extras → threshold variants → image groups → curtaining → types beyond a rule-based fallback.

Never cut: steps 1–2 (attribution), the frozen tag, provenance, controls, templated explanations.

---

## 6. Verification expectations
- `uv run pytest -q` green before every commit; README in sync per `AGENTS.md`.
- Any number shown to Pat or the designer (accuracies, effect sizes, z-scores) must come from a script the agent wrote and checked itself, with strip-grouped evaluation and a permutation null. Never report leave-one-image-out accuracy as the model's accuracy.
- Eyeball overlays and heatmaps on real images (save them to `/tmp/qc_review/`) before claiming a feature is real rather than an artefact.
