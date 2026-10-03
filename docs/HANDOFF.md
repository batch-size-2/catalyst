# Handoff: software side (Patrik's part)

Written 3 Oct 2026 at the end of a session. This is a working note for the next agent: delete this file and the pointer in `AGENTS.md` once the list below is done.

## Read first

1. `AGENTS.md` (rules and commands), `README.md` (what is built), `docs/PLAN_v3.md` (the team plan; code deviations are listed in README → Decision algorithm → "Deviations from PLAN_v3").
2. Starting point: PR #4, branch `PtrkH/compare-v3`, commits `5a56b18` (contract) and `8469686` (statistics). If PR #4 has been merged, branch from `main`; otherwise continue on `PtrkH/compare-v3` or branch from it. Nothing else is in flight: an earlier attempt at step 2 below was interrupted before writing any files.

## Ground rules from the user

- **Don't touch Pat's work.** Pat (ML) owns:
  - `qc/measure.py` (`segment`, `kpis`, `particles`, `imaging`, including the image pre-processing inside `segment`);
  - `qc/types.py`, `qc/controls.py`, `config/particle_types.json`;
  - the `KPI_UNITS` dict in `qc/schema.py`;
  - the *content* of `config/kpi_dictionary.yaml`.

  Build everything around her model, not the model itself. If something of hers is needed, call it if it exists (feature-detect) and list the question for her.
- **Don't evaluate model quality on the stub segmentation.** The stub only measures `si_area_frac` and `porosity_apparent`, so its numbers say nothing about the real pipeline. Test our code with the synthetic tables in `tests/synth.py`, plus plumbing smoke runs on the real folders (each command completes and its JSON validates). Real model testing starts when Pat's features land.
- **Simplify; delete dead code.**
- Verify with `uv run pytest` and `cd web && npm run build`. On this Mac the default `node` is broken: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`. No new dependencies without need; npm installs use `--before` (AGENTS.md).
- Keep the README sections in sync (AGENTS.md); note plan deviations in the README and the PR. Commit messages are one sentence ending with a period. Ask the user before merging or pushing to `main`.

## What the mentors said (3 Oct). This drives everything below

- **The data is real, the batches are synthetic.** Images were assigned to batches by some morphology pattern. Strips (tiles cut from one long image, `strip_id`) don't matter.
- **Batch_3 is the baseline**: what the supplier "promised". Batch_1 and Batch_2 show the kinds of variation to detect; they aren't better or worse. A manufacturer is wary of anything too far outside the baseline's SD, in either direction.
- **Judging:** can we say what is different about the batches and sort held-back images into the right batch? Then an unknown batch N can be called in or out of distribution.
- **Data still to come:**
  - **9 held-back images** (27 files: BSE, ETD/SE, InLens, same format as now) from the 3 known batches. The split is unknown. They are our only honest test: keep them unseen until the sorter is frozen.
  - **Tomorrow, at the presentation: 2 images, "which batch do they belong to, and WHY".** The image sorter and its explanation are the centrepiece.

## Done (PR #4)

- **Evidence contract**: `qc/schema.py`, mirrored in `web/src/types.ts`; full example in `tests/fixtures/evidence_example.json`.
- **`qc/decide.py`**:
  - `split_tables`, `evaluate`, `compare`;
  - strip segments, t-intervals (`t_stats`), exact or seeded max-|T| permutation p (`permutation_p`), statuses (`analyze`);
  - shared-strip variants, odd-strip check (`odd_strips`), verdict precedence and next action (`verdict_of`, `strips_to_settle`), power arithmetic (`power`, `min_achievable_p`).
- **Glue**: `qc/provenance.py` (input SHA-256, git commit and dirty flag, config hash, `rules-frozen` tag). `qc/run.py` writes `area_um2`. `qc/io.py` fills `Field.black_level`.
- **Tests**: `tests/synth.py` (synthetic KPI tables, fixture generator), `tests/test_contract.py`, `tests/test_compare.py` (24 tests).
- **Minimal UI**: verdict card, differences table, images grouped by strip, provenance panel.

## Next, in this order (one PR-sized piece each)

### 1. Simplify and make the image the unit

- **Remove the shared-strip machinery** (strips don't matter):
  - config `shared_strips` and `shared_disagreement`;
  - schema `SharedStrips`, `Variant`, `Evidence.shared_strips`, `Segment.shared`;
  - the include/exclude paths in `compare`, and the shared-strip contradiction reason and next action;
  - the UI bits: the VerdictCard "Shared strips" stat, the TileGallery "shared" badge, and the variant wording in the Differences header;
  - their tests, the README text and the example JSON.
- **Remove the slots the sorter replaces**: `ImageGroup` / `Fingerprint.image_groups`, `VarianceShare` / `Fingerprint.variance_split`, `Evidence.nearest_batch`. Rename `Power.extra_strips_needed` → `extra_needed`.
- **Run both units; the image drives the verdict.**
  - Config: `unit: image` (image | strip).
  - `compare` runs `analyze` at both units: image segments are one per image; strip segments are every strip, nothing dropped.
  - New fields: `Evidence.unit`, and `Evidence.other_unit = UnitView(unit, power, statuses, contradictions)`.
  - A key quantity DIFFERENT at one unit and SIMILAR at the other → INVESTIGATE: "q is X per image but Y per strip: the result depends on treating neighbouring images as independent".
  - `contradictions()` keeps only the DIFFERENT-vs-SIMILAR rule.
- **Margin:** δ = `margins[q]`, else `similar_margin` × SD of the baseline's *image* values. The same δ for both units.
- **Odd check at both units:**
  - new `odd_images`: an image outside the baseline mean ± `odd_sd` × the baseline image SD;
  - `odd_strips` as now;
  - rename `odd_strip_sd` → `odd_sd`;
  - only the driving unit's list triggers.
- **Wording** follows the unit ("images"/"strips"); rename `strips_to_settle` → `units_to_settle`. `fingerprint.segments` stays at strip level (the UI groups images by strip).

### 2. Image sorter: `qc/classify.py` (the judged feature)

**Config:** `known_batches: [Batch_1, Batch_2, Batch_3]`, `sorter_features: auto` (or an explicit list), `sorter_max_features: 4`, `sorter_unlike_quantile: 0.99`.

**Schema** (additive, mirrored in `types.ts`):

| Model | Fields |
|---|---|
| `FeatureRank` | name, unit, `eta2` (share of image-level variance between known batches), `p` (Kruskal–Wallis), `z_vs_baseline` {batch: (batch mean − baseline mean) / baseline SD} |
| `FeatureCall` | name, unit, value, `z` {batch: (value − batch mean) / pooled within-batch SD}, `baseline_z` |
| `ImageCall` | image_id, strip_id, folder, predicted, probabilities, distance2, features (most decisive first), outside_baseline, unlike_any_batch, `why: list[str]` |
| `Evaluation` | scheme ("leave-one-image-out" \| "leave-one-strip-out" \| "held-out"), n, accuracy, balanced_accuracy, confusion {true: {predicted: count}} |
| `BatchModel` | batches, baseline, features, means, pooled_sd, baseline_mean, baseline_sd, unlike_quantile, trained_on. Frozen in `config/batch_model.json`; add it to `CONFIG_FILES` in `qc/provenance.py` |
| `Sorting` | model, ranking, evaluations, clustering_ari, calls, provenance. Written to `out/sorting/<name>.json` |

`Evidence` also gains `image_calls: list[ImageCall]`.

**Method** (numpy/scipy only, deterministic):
- **Candidates:** every numeric descriptor column with ≥ 2 values in every known batch and a pooled SD > 0, so Pat's new columns are picked up automatically.
- **Fit:** rank by eta2. With `auto`, pick k ≤ `sorter_max_features` by inner leave-one-image-out *balanced* accuracy (ties → smaller k).
- **Model:** the batch means, plus the pooled within-batch SD per feature (n − K degrees of freedom).
- **Predict:**
  - distance² to each batch mean in pooled-SD units, summed over the image's non-NaN features;
  - probabilities = softmax(−d²/2) with **equal priors** (17/7/7 must not favour Batch_3);
  - features ordered by z_runner-up² − z_predicted²;
  - `outside_baseline` = |baseline_z| > `odd_sd`;
  - `unlike_any_batch` = min d² > χ²(`unlike_quantile`, df = number of features used).
- **`why` sentences** (templates, no language model):
  - "Closest to P (x%); next is R (y%)."
  - Up to 3 lines of the form "name = v unit: zP SD from P's mean, zR SD from R's (baseline zB SD)."
  - The outside-baseline and unlike-any-batch sentences when they apply.
  - Use the friendly names from `config/kpi_dictionary.yaml` when present.
- **Evaluation:**
  - **Nested** (every fold refits, including the feature choice): leave-one-image-out, and leave-one-strip-out (hold out every image of a strip, in whichever batch it sits).
  - Unsupervised check: Ward clustering of the z-scored features into K clusters, adjusted Rand index against the labels.
- **CLI:**
  - `python -m qc.classify fit`: reads the `known_batches` rows of `out/kpis.csv` (never anything else), writes `config/batch_model.json` and `out/sorting/known.json`.
  - `python -m qc.classify predict DIR [DIR ...] [--truth BATCH ...]`: measures the folders, applies the frozen model; with `--truth` it adds a "held-out" Evaluation.
- **Batch pipeline:** `evaluate(..., model=None)` fills `image_calls`; `run()` loads the model file if it exists.

**Held-out protocol** (put it in the README):
1. Put the new images in their own folders under `data/`, never inside the known batch folders.
2. `fit`, then `git tag rules-frozen-sorter`.
3. Run `predict ... --truth ...` once.
4. Commit the output unchanged.

After scoring, add the 9 to training, refit and re-freeze before the 2 judged images.

### 3. Plumbing for Pat's outputs (no edits to her files)

- **`run.py`:**
  - call `qc.measure.particles(mask, px_um, channels)` and `qc.measure.imaging(channels)` if they exist (`getattr`);
  - call `qc.types.assign_types(particles, model)` if `qc/types.py` and `config/particle_types.json` exist;
  - failures give empty frames or NaN and never stop the run;
  - write `out/particles.csv` (`PARTICLE_COLUMNS`) and `out/imaging.csv` (`IMAGING_COLUMNS`), replacing the rows of re-measured batches, and pass them through `split_tables`.
- **Per-image features from particles:**
  - `type_share:<type>` (Si area share of each type) and `unassigned_share`, merged onto the image table. They then become sorter candidates and comparison quantities (key when `key_type_shares`);
  - batch `new_type_share` = unassigned Si area / all Si area, which feeds the existing new-type trigger;
  - fill `fingerprint.type_shares`.
- **Imaging check (PLAN_v3 §3.3), per image:**
  - reference outliers = baseline images whose black level in any channel is more than 10 grey levels from the baseline median (P2060's four images today);
  - the range per (channel, metric) = min–max over the other baseline images, widened by 10% of the width;
  - any batch image outside the range → `changed_metrics` / `changed`, and the `imaging_sensitive` quantities become used=False with a note;
  - `curtained_images` comes from a config threshold `curtaining_max: null` (off until Pat calibrates it).

### 4. Explanations: `qc/explain.py`

- **The dictionary file:** create `config/kpi_dictionary.yaml` with the **structure only**. Per descriptor and per particle type: name, unit, meaning, why_it_matters, causes_higher, causes_lower, supplier_check. Fill name and unit; leave the rest empty for Pat. Don't write domain content.
- **The texts:** `explain(evidence, dictionary) -> Explanations` produces the four templates of PLAN_v3 §3.8 (operator, engineer, scientist, manager).
  - Every number comes from the evidence.
  - Causes are worded "possible causes to check"; never "defective".
  - Missing dictionary fields are left out.
  - Indicative consequences follow §3.8: a capacity range spanning Si to SiOx, swelling, and Bruggeman for porosity.
- **Wiring:** `run()` fills `evidence.explanations`.

### 5. UI and API

- **API:** `POST /api/sort/{name}` (NDJSON progress, like runs), `GET /api/sorting/{name}`, `GET /api/sorting/known`. `qc/api.py` stays thin.
- **"Sort images" view (demo centrepiece):** upload 1–N images, then per image show:
  - the predicted batch with probability bars;
  - the `why` sentences;
  - the decisive features against each batch's mean ± SD band;
  - the outside-baseline and unlike badges;
  - the mask overlay.
- **"What's different" view:** the FeatureRank table (eta2, z vs baseline per batch), confusion matrices (leave-one-image-out, leave-one-strip-out, held-out) and the clustering ARI.
- **Batch view:** the four audience tabs, image calls on the gallery cards, `other_unit` next to the differences, odd images.
- **Fixtures:** build against `tests/fixtures/evidence_example.json` plus a new `tests/fixtures/sorting_example.json`.

### 6. When Pat's features land (with the user)

1. Run `uv run python -m qc.measure`, then `python -m qc.classify fit`.
2. Read the ranking and the nested evaluations; set `margins` per key quantity.
3. Freeze, then score the held-out images as in step 2's protocol.
4. Before the presentation, rehearse `predict` on 2 images.

## Open with Pat (not for the agent to do)

Listed in PR #4, section "For Pat":
- **Black level:** `Field.black_level` is filled, but `segment()` and `imaging()` don't receive the `Field`. Either she computes it inside, or `run.py` passes it in.
- **Column names:** confirm the proposed `PARTICLE_COLUMNS` / `IMAGING_COLUMNS`.
- **KPI_UNITS:** add `si_graphite_ratio` and the other descriptors, then regenerate the fixture with `uv run python -m tests.synth`.
- **Her other pieces:** the dictionary content, image pre-processing, particle types, controls.
- **Plan change:** rule 2 is replaced by the explainable image sorter (the user agreed; Pat's OK is pending).
