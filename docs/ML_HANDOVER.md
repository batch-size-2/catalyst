# ML side: handover to Patrik (branch `pat/ml-v3`)

What Pat's side of PLAN_v3 now delivers, how to call it from `run()` / `compare()` / the UI, and what is still open.
Plan references are to `docs/PLAN_v3.md`. The README is updated for the same change.

## 1. What was built

| PLAN_v3 step (Pat) | Status | Where |
|---|---|---|
| 2. `segment()` per §3.2, full-res, optional `thresholds` | done | `qc/measure.py` |
| 3. `kpis()`: all 15 descriptors | done | `qc/measure.py`, `schema.KPI_UNITS` |
| 4. `particles()` incl. `inlens_ratio`, full-res texture, crops | done | `qc/measure.py`, `qc/types.py::save_type_crops` |
| 6. `qc/types.py`: fit, LOSO stability, naming, unassigned, persist, porous fallback | done (first fit run, **not frozen**) | `qc/types.py` |
| 7. `imaging()` incl. curtaining index | done | `qc/measure.py` |
| 8. `qc/controls.py`: §3.7 table and §3.13 shared-strip controls, with synthetic tests | done | `qc/controls.py` |
| 9. Threshold variants ±5 and integral range | done | `qc/uncertainty.py` |
| 10. `config/kpi_dictionary.yaml` | draft, needs mentor review of causes | `config/kpi_dictionary.yaml` |
| Measurement wiring in `run.py` (shared glue) | done: three tables, types assigned if a model exists | `qc/run.py` |

Not touched (yours): `compare()`, `explain()`, provenance, `Evidence`, `config/decision.yaml`, `qc/api.py`, `web/`. `judge()` still runs unchanged on `tables.kpis`, so the API and UI work as before.

Tests: `uv run pytest -q`, 15 passed (6 contract + 9 new in `tests/test_ml.py`, synthetic images only, about 10 s).

## 2. How to run it

```bash
uv sync                                                   # scikit-learn was added
uv run python -m qc.measure                               # all of data/ -> out/kpis.csv, particles.csv, imaging.csv, masks/  (~8 s per image)
uv run python -m qc.types [--exclude Batch_2] [--porous-rule]   # fit types on out/particles.csv -> config/particle_types.json, type column, out/crops/
uv run python -m qc.controls --baseline data/Batch_3      # build + measure every control -> out/controls/summary.csv
uv run python -m qc.uncertainty --batch data/Batch_3      # out/uncertainty/threshold_variants.csv, integral_range.csv
uv run python -m qc.run --batch data/Batch_2              # unchanged entry point; now writes all three tables
```

## 3. The contract you build on

### 3.1 Tables (`qc/schema.py`)

`measure(batch_dirs, progress) -> Tables(kpis, particles, imaging)` and `save_tables(tables)`. Each CSV keeps the rows of batches it didn't just measure.

| File | One row per | Columns |
|---|---|---|
| `out/kpis.csv` | image | `KPI_TABLE_COLUMNS` = `batch, image_id, strip_id, px_um` + 15 KPIs (7 new ones appended at the end) |
| `out/particles.csv` | Si particle | `PARTICLE_COLUMNS` = `batch, image_id, strip_id, particle_id, d_um, area_um2, contrast_ratio, inlens_ratio, void_frac, texture, solidity, border, type, y_px, x_px` |
| `out/imaging.csv` | image × channel | `IMAGING_COLUMNS` = `batch, image_id, strip_id, channel, black_level, p1, p50, p99, noise, sharpness, saturated_frac, curtaining_index` |

- `Tables` for `compare(ref, batch, cfg)`: filter all three frames by `batch` (and drop `reference_exclude` images) yourself, as §3.1 says.
- `border` is bool in memory and `"True"/"False"` after a CSV round trip. `qc.types._border_mask(df)` normalises it.
- `type` is `T1..Tk`, `"unassigned"`, `"porous"` (only with the porous rule), or NaN when no `config/particle_types.json` exists.
- A failed descriptor is NaN, a failed image gets an all-NaN row, and the run never stops (§3.1).

### 3.2 KPIs (`schema.KPI_UNITS`; definitions in README, "KPIs")

Key descriptors per §3.2: `si_graphite_ratio`, `si_d50_um`, `si_internal_void_frac`, `si_contrast_ratio` (drop if imaging changed), `porosity_apparent` (drop if imaging changed), plus type shares. `config/kpi_dictionary.yaml` has `key: true/false` per descriptor if you want to read the list from there rather than hard-code it.

**Segment value** (§3.5), which you compute in `compare()`:
- fractions: pool pixels, area-weighted over the segment's images. The KPI table has per-image values only, so weight by valid area (all images of a strip have the same size, so a plain mean is the same thing).
- D50 and type shares: pool the segment's particles from `particles.csv` (non-border for D50) rather than averaging image D50s.

### 3.3 Particle types (`qc/types.py`)

```python
from qc.types import load_types, assign_types, type_shares
model = load_types()                         # dict or None; config/particle_types.json
parts = assign_types(parts, model)           # adds/overwrites `type`
shares = type_shares(parts, by=("batch", "strip_id"))   # Si-area share per type, rows sum to 1
```
- New-type rule (§3.4): `unassigned` share of a batch's Si area > `new_type_share` (0.05) means REJECT. Compute it from `type_shares(parts, by=("batch",))["unassigned"]`.
- Model fields for the UI gallery: `model["types"][i]` has `id, name, n, area_share, summary{d50_um, contrast_ratio, inlens_ratio, void_frac, texture, solidity}`. Crops are in `out/crops/<type_id>/<n>.png` (`schema.crop_path`), 8 per type, most typical first.
- `run()` only ever calls `assign_types`. `fit_types` runs before the freeze only. Dry run: `uv run python -m qc.types --exclude Batch_2`, then refit without the exclude afterwards (§4).

### 3.4 Controls (`qc/controls.py`)

```python
from qc.controls import iter_controls, shared_strip_controls
for control in iter_controls(ref_fields, px_um, seed=cfg["seed"]):     # one control in memory at a time (~8 fields)
    ...  # measure control.fields as batch control.name ("_controls/<name>") and compare against the reduced reference
for control in shared_strip_controls(ref_fields, px_um, seed=cfg["seed"]):
    ...
```
`Control(name, kind, expected_driver, source_strips, fields, kept_in_reference)`:
- **Reference for a control** = reference images whose `strip_id` is not in `source_strips`, **plus the images whose `image_id` is in `kept_in_reference`**. These are image ids, not strip ids (deviation 3 below).
- Control fields keep the original `strip_id`, so your shared-strip detection finds the split strips automatically. `image_id` is `<original>~<control name>`.
- `controls.passed`: every negative SIMILAR; every positive DIFFERENT with `expected_driver` as the top driver.
- §3.7 controls use 3 source strips (35 arrangements against the 4 remaining Batch_3 strips). The shared controls use 2 split strips and 2 whole strips.

Measured shift on Batch_3 (control vs the same images untransformed, `si_graphite_ratio` unless noted):

| Control | Shift | Expected |
|---|---|---|
| 7 negatives (brightness ±20%, contrast ±20%, black +20, noise σ5, curtaining) | ≤ 0.6% | SIMILAR |
| `pos_si_plus50` / `pos_si_plus100` | +49% / +101% | DIFFERENT, `si_graphite_ratio` |
| `pos_voids` | `si_internal_void_frac` 0.0026 → 0.073 | DIFFERENT, `si_internal_void_frac` |
| `pos_si_scale150` | `si_d50_um` +59%, ratio −7% | DIFFERENT, `si_d50_um` |
| `shared_unchanged` / `shared_diluted` / `unshared_change` | 0% / +33% / +50% | SIMILAR / DIFFERENT / DIFFERENT |

Side effect: the `si_plus` controls also lower `si_d50_um` (3.9 → 2.9 µm), because the pasted donors are 1–10 µm. If `|Δd50|/δ` beats `|Δratio|/δ`, the top driver would come out wrong. Check this when you rank drivers. If it bites, tell Pat and the donor sizes will be matched to the target.

### 3.5 Imaging check (`out/imaging.csv`)

All §3.3 quantities per channel. You own the range rule (reference min–max over ordinary strips, widened 10%, P2060 out as an imaging outlier). The curtaining "run-length descriptors NaN" rule is not applied in `kpis()` (deviation 5). Look at the `curtaining_index` distribution first, then pick a threshold and apply it to `graphite_chord_um`, `pore_chord_um` and `graphite_anisotropy` in `compare()`.

### 3.6 Uncertainty (`qc/uncertainty.py`)

- `threshold_variants(channels, px_um)` gives `{-5: kpis, 0: kpis, 5: kpis}`. The batch CSV is `out/uncertainty/threshold_variants.csv`. Mean |shift| on Batch_3: `si_graphite_ratio` 0.0057, `si_d50_um` 0.21 µm, `porosity_apparent` 0.021, `si_contrast_ratio` 0.017. The §3.6 rule ("say so if larger than δ") is a comparison you make in `compare()`/`explain()`.
- `integral_range(mask, px_um, Phase.SI)` returns `phi, a_int_um2, valid_area_um2, predicted_sd`. `area_needed(phi, a_int_um2, target_sd)` gives the "how many images" area.

## 4. Deviations from PLAN_v3 (also in README)

1. Hole filling and watershed happen in `label_si()` at measure time; the mask stays pure phase codes.
2. Black level is computed inside `qc/measure.py` (0.5th percentile, the same value `Field.black_level` would have). You can still add `Field.black_level` in `qc/io.py`; nothing on the ML side needs it.
3. `Control.kept_in_reference` holds **image_ids**, not strip ids.
4. `pos_si_scale150` thins the scaled particles to 1/2.25, so it tests size, not Si amount.
5. The curtaining NaN rule is left to `compare()` (see 3.5).
6. `particles.csv` has extra `y_px, x_px` columns.
7. Integral range uses the radial form 2π∫r·C(r)dr, truncated at the first zero crossing.
8. **New rule, not in the plan:** Si objects with median BSE < 1.5× the graphite mode are relabelled `BINDER` (`SI_MIN_CONTRAST`). Overlays of strip P2316 showed carbon-binder "fluff" and surfaces seen through pores (1.3–1.5× graphite) being labelled Si. Real Si measures 1.6–2.4×. Effect: P2316 `si_graphite_ratio` 0.220 → 0.181 (−18%), four strips move 1–4%, the other 14 don't change. BINDER is now a real phase in the overlays (purple).

## 5. First real-data numbers (Sync 1 input)

31 images, 0 failures. Per batch mean ± SD over images:

| KPI | Batch_1 | Batch_2 | Batch_3 (ref) |
|---|---|---|---|
| `si_graphite_ratio` | 0.105 ± 0.054 | 0.067 ± 0.015 | 0.075 ± 0.014 |
| `si_d50_um` | 4.41 ± 0.70 | 3.97 ± 0.38 | 3.66 ± 0.63 |
| `si_internal_void_frac` | 0.0048 ± 0.0053 | 0.0018 ± 0.0017 | 0.0026 ± 0.0015 |
| `si_contrast_ratio` | 1.91 ± 0.23 | 2.13 ± 0.16 | 2.09 ± 0.14 |
| `porosity_apparent` | 0.088 ± 0.016 | 0.099 ± 0.015 | 0.107 ± 0.018 |

**Variance split** (nested sums of squares over images, 19 strip segments. Descriptive shares only, not degree-of-freedom-corrected variance components; your `compare()` version replaces this):

| KPI | between batches | between strips in a batch | between images in a strip |
|---|---|---|---|
| `si_graphite_ratio` | 21% (6% without P2316) | 72% | 7% |
| `si_d50_um` | 22% | 44% | 35% |
| `si_internal_void_frac` | 14% | 76% | 10% |
| `si_contrast_ratio` | 22% (6% without P2316) | 74% | 4% |
| `porosity_apparent` | 19% | 60% | 21% |

This confirms §1.2: most variation sits between strips. Batch_1's difference is almost all strip P2316: Si/graphite 0.181 against 0.055–0.094 in every other strip, with dimmer, coarser Si (contrast 1.62 against 1.84–2.27).

**Particle types (first fit, all batches, not frozen):** k = 2 was chosen (LOSO ARI 0.995, against 0.992 for k=3 and 0.980 for k=4).
- T1: bright, dense (2.1× graphite, D50 1.9 µm), 65% of Si area.
- T2: dimmer and grainier (1.7×, D50 2.2 µm, solidity 0.80), 35%.
- P2316 is 99% T2 and Batch_2/P2156 is 87% T2; the other strips are mostly T1.
- 148 of 3,713 particles are unassigned.
- Both auto-names came out as "mid, grey". Rename at Sync 2 (e.g. "bright dense" / "dim grainy"; "SiOx" only with EDS, §3.4).
- The porous P2060 particles did not get their own type, which is the known gap in §3.4. Decide at Sync 1 whether to use `--porous-rule`.

## 6. Open items

- **Pat, by eye (§3.2 acceptance):** two overlays per strip. One known limit: a few smooth mid-grey particles (about 1.3–1.5× graphite, possibly the "larger, dimmer" kind) now land in BINDER. If the mentors say those are Si/SiOx, lower `SI_MIN_CONTRAST` and rerun.
- Freeze `config/particle_types.json` at Sync 2. It is deliberately **not committed** yet; your local `run()` will use it if it exists.
- Mentor review of the causes in `config/kpi_dictionary.yaml` (§10 Q7). Fill its `particle_types:` section after the names are fixed.
- `config/decision.yaml` still says `baseline: Batch_1`. Switching to `Batch_3` is on your list (§6 step 1).
- Evening items not started: how-many-images curve, strip-leak chart, two-point-correlation and DINOv2 safety nets. `two_point()` and `integral_range()` are the building blocks.
