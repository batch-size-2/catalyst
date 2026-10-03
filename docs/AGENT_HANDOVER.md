# ML handover (Pat's side)

State on 3 Oct 2026, late evening. For anyone, person or agent, who picks up the ML work or builds on its outputs. It replaces the earlier `ML_HANDOVER.md` and the dated update sections this file used to have.

Where to read what:

| Question | Document |
|---|---|
| What is done, what is next, what must be clarified (plain language) | [PAT_SUMMARY.md](PAT_SUMMARY.md) |
| How each module works, every command, every output file | [README](../README.md) |
| The plan, the next steps and all attribution numbers | [PLAN_v4.md](PLAN_v4.md): §4 for the next steps, §12–12.2 for results. It is the only plan; v0–v3 were deleted and are in git history |
| How to work in the ML code, what consumers can rely on, what was measured | this file |

## 1. Orientation

| Item | Value |
|---|---|
| Repo | `https://github.com/batch-size-2/catalyst`. Work from `main`; the old `pat/ml-v3` branch is fully merged into it and can be ignored |
| Team | Pat = ML. Patrik = backend and UI (`qc/decide.py`, `qc/explain.py`, `qc/provenance.py`, `qc/api.py`, `web/`, `config/decision.yaml`) |
| Pat's files | `qc/measure.py`, `qc/types.py`, `qc/controls.py`, `qc/uncertainty.py`, `qc/features.py`, `qc/deep.py`, `qc/attribute.py`, `tests/test_ml.py`, `tests/test_attribute.py`, `config/particle_types.json`, `config/kpi_dictionary.yaml`, `config/attribution_model.json`, `KPI_UNITS` in `qc/schema.py` |
| Shared | `qc/schema.py` (the contract: additive changes only, tell the other owner), `qc/io.py`, `qc/run.py`, `README.md` |
| Plan | PLAN_v4 is the team plan and is self-contained; both owners have agreed to it |
| Python | `uv sync`, then `uv run pytest -q` (67 tests, about 80 s). Torch and transformers are regular dependencies since the freeze (the frozen model needs the deep features), so a plain `uv run …` works; `--extra deep` is still accepted |
| Data | `data/Batch_1`, `data/Batch_2`, `data/Batch_3`: 31 samples, each three 8-bit files (BSE, ETD or SE, InLens), 2316 × about 7000 px, 0.025 µm/px. Gitignored |
| Unseen images | The first folder arrived on 3 Oct: `Hackathon-Polaron-test`, 9 files = 3 samples (`3e122cbj`, `fn0mhxef`, `xrv9xvzb`). More images come shortly before judging. Kept in their own folder, never inside a batch folder; not opened and not yet linked into `data/`. Unseen until the model is frozen with `git tag rules-frozen`; then scored once and the output committed unchanged (PLAN_v4 §1.3, §4) |

Rules that have held throughout:

- Never commit `data/` or `out/`.
- No Polaron models or tools, including their open-source HR-Dv2, ImageRep and TauFactor, until the mentors say otherwise.
- `strip_id`, image height and width, `px_um` and XResolution are never features: they identify the strip, not the material. `features.assert_no_leakage()` enforces it.
- Accuracy is only ever reported with whole strips held out, next to a permutation null. Never leave-one-image-out.
- Don't edit `config/decision.yaml`, `config/particle_types.json` or `config/attribution_model.json` after the `rules-frozen` tag.

## 2. What the ML side provides

| Module | Provides | Output |
|---|---|---|
| `qc/measure.py` | `segment` (pore, graphite, Si, binder, ignore), `kpis` (15 descriptors), `particles` (one row per Si particle), `imaging` (per-detector acquisition descriptors), `label_si`, `two_point` | `out/kpis.csv`, `out/particles.csv`, `out/imaging.csv`, `out/masks/` |
| `qc/types.py` | `fit_types`, `assign_types`, `type_shares`: Gaussian-mixture particle types, k chosen by leave-one-strip-out stability | `config/particle_types.json`, `out/crops/` |
| `qc/controls.py` | `iter_controls`, `make_controls`, `shared_strip_controls`: synthetic batches with a known answer | `out/controls/summary.csv` |
| `qc/uncertainty.py` | `threshold_variants`, `integral_range`, `area_needed` | `out/uncertainty/*.csv` |
| `qc/features.py` | One row per image in six named families (`reg_`, `edge_`, `tex_`, `par_`, `kpi_`, `img_`); `describe()` gives each feature a plain name | `out/features.csv` |
| `qc/deep.py` | Optional seventh family `deep_`: frozen DINOv2-small embeddings of InLens tiles | merged into `out/features.csv` |
| `qc/attribute.py` | Batch attribution: evaluation, fit, prediction with confidence and reasons, rehearsals | `out/attribution/`, `config/attribution_model.json` |

The README describes each of these in detail under "Data pipeline". Commands are in its Quickstart.

## 3. What consumers can rely on

### 3.1 Tables (`qc/schema.py`)

`run.measure(batch_dirs, progress) -> Tables(kpis, particles, imaging)` and `run.save_tables(tables)`. Each CSV keeps the rows of batches it did not just measure.

| File | One row per | Columns |
|---|---|---|
| `out/kpis.csv` | image | `KPI_TABLE_COLUMNS`: `batch, image_id, strip_id, px_um, area_um2` + the 15 KPIs |
| `out/particles.csv` | Si particle | `PARTICLE_COLUMNS`: `batch, image_id, strip_id, particle_id, d_um, area_um2, contrast_ratio, inlens_ratio, void_frac, texture, solidity, border, type, y_px, x_px` |
| `out/imaging.csv` | image × detector | `IMAGING_COLUMNS`: `batch, image_id, strip_id, channel, black_level, p1, p50, p99, noise, sharpness, saturated_frac, curtaining_index` |

- A failed descriptor is NaN, a failed image gets an all-NaN row, and the run never stops.
- `border` is bool in memory and `"True"`/`"False"` after a CSV round trip; `qc.types._border_mask(df)` normalises it.
- `type` is `T1..Tk`, `"unassigned"`, `"porous"` (only with the porous rule), or NaN when no `config/particle_types.json` exists.

### 3.2 Particle types

```python
from qc.types import load_types, assign_types, type_shares
model = load_types()                         # dict or None
parts = assign_types(parts, model)           # adds or overwrites `type`
shares = type_shares(parts, by=("batch", "strip_id"))   # Si-area share per type, rows sum to 1
```

`model["types"][i]` has `id, name, n, area_share, summary{…}`; example crops are `out/crops/<type_id>/<n>.png`. `run()` only ever assigns; fitting happens before the freeze.

### 3.3 Controls

```python
from qc.controls import iter_controls, shared_strip_controls
for control in iter_controls(ref_fields, px_um, seed=cfg["seed"]):   # one control in memory at a time
    ...
```

`Control(name, kind, expected_driver, source_strips, fields, kept_in_reference)`. The reference for a control is every reference image whose strip is not in `source_strips`, plus the images whose `image_id` is in `kept_in_reference` (image ids, not strip ids). Control images keep their strip and get `image_id` `<original>~<control name>`. The controls are built and measured, but `run()` does not yet feed them into the verdict.

### 3.4 Attribution output (`out/attribution/<run>.json`)

Written by `attribute_images(image_dir, model, balanced=None)`; the API serves it as written. Per image:

| Field | Meaning |
|---|---|
| `predicted`, `p_<batch>`, `confidence` | The call (never empty), the rescaled probabilities, and the probability of the call. `confidence_raw` is the value before rescaling |
| `confidence_tier`, `confidence_record` | high (≥ 0.75), medium (≥ 0.5) or low; and how often calls in that tier were right on held-out strips (`right`, `n`) |
| `stage_baseline`, `stage_variation` | "Batch_3 or not" and "which other batch", each with `call` and `confidence`. `stage_variation` is null when the call is the baseline |
| `prediction_set` | Batches that should contain the truth for about 8 in 10 images |
| `reasons` | Up to five: `feature`, `z`, `contribution`, `stage`, and a plain-language `text` with `label`; deep components also list `related` named features |
| `baseline_distance`, `baseline_threshold`, `outside_baseline`, `n_deviating`, `deviations` | Distance from Batch_3's strip segments, in SD |
| `predicted_distance`, `predicted_threshold`, `unfamiliar` | The same against the batch the image was assigned to. `unfamiliar` means outside that batch's own range |
| `assigned` | Only with `--balanced k`: the assignment with exactly k images per batch |

`model` in the same file carries `fitted_at`, `classes`, `baseline`, `loso_balanced_accuracy`, `kind` (flat or staged), `families` and the `calibration` record. `evaluation.json` and `feature_ranking.csv` come from `--evaluate`.

## 4. What was measured on the real data

31 images, 13 physical strips, no failures.

**Strip layout** (strip = image height):

- In more than one batch: 2080 (Batch_1, 2, 3), 2068 (2, 3), 2272 (2, 3), 2148 (1, 2), 2156 (1, 2).
- In one batch only: Batch_1 has 1780, 1880, 2316; Batch_2 has 2048; Batch_3 has 1612, 1904, 2060, 2088.

**Per batch, mean ± SD over images:**

| KPI | Batch_1 | Batch_2 | Batch_3 (baseline) |
|---|---|---|---|
| `si_graphite_ratio` | 0.105 ± 0.054 | 0.067 ± 0.015 | 0.075 ± 0.014 |
| `si_d50_um` | 4.41 ± 0.70 | 3.97 ± 0.38 | 3.66 ± 0.63 |
| `si_internal_void_frac` | 0.0048 ± 0.0053 | 0.0018 ± 0.0017 | 0.0026 ± 0.0015 |
| `si_contrast_ratio` | 1.91 ± 0.23 | 2.13 ± 0.16 | 2.09 ± 0.14 |
| `porosity_apparent` | 0.088 ± 0.016 | 0.099 ± 0.015 | 0.107 ± 0.018 |

- **Most variation sits between strips, not between batches.** For `si_graphite_ratio`: 21% between batches (6% without strip 2316), 72% between strips, 7% between images of a strip. These are descriptive shares of sums of squares.
- **Batch_1's higher silicon is almost all strip 2316** (ratio 0.181 against 0.055–0.094 everywhere else), whose silicon is also dimmer and coarser.
- **Controls on Batch_3:** the seven negative controls move `si_graphite_ratio` by at most 0.6%. Si +50% / +100% give +49% / +101%. Punched voids raise the void fraction from 0.003 to 0.073. Scaled particles raise D50 by 59%. Side effect: the Si-paste controls also lower D50 (3.9 → 2.9 µm), because the pasted donors are small.
- **Threshold ±5 grey levels on Batch_3:** `si_graphite_ratio` moves 0.0057, `si_d50_um` 0.21 µm, `porosity_apparent` 0.021.
- **Particle types (first fit, all batches, not frozen):** k = 2. T1 bright and dense (2.1× graphite, 65% of Si area); T2 dimmer and grainier (1.7×, 35%). Strip 2316 is 99% T2. 148 of 3,713 particles are unassigned. Porous particles (strip 2060) did not get their own type. Both automatic names came out "mid, grey" and need renaming.
- **Why strips must be held out:** the same model on the 15 KPIs scores 0.49 leaving one image out and 0.35 leaving one strip out (chance 0.33, null p95 0.48). The first number is strip leakage.
- **Batch attribution:** PLAN_v4 §12–12.2. In short, Batch_3 against the rest works; Batch_1 against Batch_2 does not yet.

## 5. Changes from the v3 design on the ML side

Listed in the README under "Changes from the v3 design (ML side)" (items 0–8); PLAN_v4 now states them as the plan. The two that matter most to a reader of the numbers:

- **Dim-object rule.** Si objects with median BSE below 1.5× the graphite mode are relabelled `BINDER` (`SI_MIN_CONTRAST`). Added after overlays of strip 2316 showed binder and surfaces seen through pores labelled as Si. A few smooth mid-grey particles now land in BINDER; if the mentors say those are Si or SiOx, lower the constant and rerun.
- **A classifier trained on batch labels exists** (`qc/attribute.py`), for attribution only. The accept / investigate / reject verdict stays statistical.

## 6. Open on the measurement side

Modelling next steps and the questions for Steve and Patrik are in PAT_SUMMARY §5–6 and are not repeated here.

| Item | Why it matters |
|---|---|
| Particle types are provisional | Refit, rename, and decide the porous rule before `rules-frozen` |
| Porous silicon, cracks, binder amount and a split of porosity are not measured | The task designer said the baseline is not defect-free and many morphology features matter |
| Segmentation is accepted by eye only | A few hand-labelled patches per strip would give a real accuracy number |
| `curtaining_max` is unset | Needs a threshold from the real `curtaining_index` distribution; until then run-length descriptors are never blanked |
| Dictionary causes are a draft | `config/kpi_dictionary.yaml` needs a mentor's review; its `particle_types:` section is empty until the types are named |
| Controls do not reach the verdict | They are built and measured; wiring them into `run()` is Patrik's side |
| Degradation outlook (`qc/degrade.py`) | Not started; an extra feature, never part of the verdict |

## 7. How to check your own work

- `uv run pytest -q` green before every commit, and the README in sync (AGENTS.md).
- Any accuracy, effect size or z-score you report comes from a script you ran, with strip-grouped evaluation and a permutation null.
- When several representations are tried and the best is kept, compare it against the best-of-all-tries null, not its own.
- Look at overlays on real images before claiming a feature is material and not an artefact.
