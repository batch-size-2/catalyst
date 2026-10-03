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
  - **9 held-back images** (27 files: BSE, ETD/SE, InLens, same format as now) from the 3 known batches. The split is unknown. They are our only honest test: keep them unseen until attribution is frozen.
  - **Tomorrow, at the presentation: 2 images, "which batch do they belong to, and WHY".** Batch attribution and its explanation are the centrepiece.

## Done (step 1, branch `PtrkH/image-unit`)

- The image unit drives the verdict; the strip view is reported in `other_unit`, with DIFFERENT-vs-SIMILAR as the contradiction rule.
- Shared-strip machinery was removed.
- `nearest_batch`, `image_groups` and `variance_split` were removed; `extra_needed`, `odd_sd`, `Odd` and `odd_images` were added.
- The UI, evidence fixture (strict round-trip test) and README were updated.

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

Done, see Done.

### 2. Wrap Pat's batch attribution (decided 3 Oct: Pat owns it)

Pat builds the attribution model in `qc/attribute.py`, on features from `qc/features.py` (`out/features.csv`); see `docs/AGENT_HANDOVER.md` on branch `pat/ml-v3`. The software side builds no classifier. It:
- proposes the output contract in `qc/schema.py`: `Attribution`, written to `out/attribution/<run>.json`, mirrored in `web/src/types.ts`, with `tests/fixtures/attribution_example.json`. Pat confirms or changes it;
- adds the API: `GET /api/attribution`, `GET /api/attribution/{run}`, `POST /api/attribution/{run}` (NDJSON progress; calls Pat's `predict` when `qc.attribute` exists, else 501);
- builds the views in step 5 against the fixture.

**Held-out protocol** (put it in the README):
1. Put the new images in their own folders under `data/`, never inside the known batch folders.
2. Freeze the model, then `git tag rules-frozen`.
3. Predict once.
4. Commit the output unchanged.

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

**The screens, the visual language, the extra backend data and the build order are specified in [`docs/APP.md`](APP.md). Follow its build order (core first).** The bullets below are the minimum.

- **"Sort images" view (demo centrepiece):** upload 1–N images, then use the per-image `Attribution` fields to show the predicted batch with probability bars, `why` sentences, decisive features against each batch's mean ± SD band, outside-baseline and unlike badges, and the mask overlay.
- **"What's different" view:** use the `Attribution` feature ranking (z vs baseline per batch), confusion matrices (leave-one-image-out, leave-one-strip-out, held-out) and clustering ARI.
- **Batch view:** the four audience tabs, attribution calls for the batch folder on the gallery cards, `other_unit` next to the differences, odd images.
- **Fixtures:** build against `tests/fixtures/evidence_example.json` plus a new `tests/fixtures/attribution_example.json`.

### 6. When Pat's features land (with the user)

1. Run `uv run python -m qc.measure`, then Pat's attribution fit.
2. Read the ranking and the nested evaluations; set `margins` per key quantity.
3. Freeze, then score the held-out images as in step 2's protocol.
4. Before the presentation, rehearse `predict` on 2 images.

## Open with Pat (not for the agent to do)

Listed in PR #4, section "For Pat":
- **Black level:** `Field.black_level` is filled, but `segment()` and `imaging()` don't receive the `Field`. Either she computes it inside, or `run.py` passes it in.
- **Column names:** confirm the proposed `PARTICLE_COLUMNS` / `IMAGING_COLUMNS`.
- **KPI_UNITS:** add `si_graphite_ratio` and the other descriptors, then regenerate the fixture with `uv run python -m tests.synth`.
- **Attribution contract:** confirm the proposed `Attribution` schema (step 2).
- **Her other pieces:** the dictionary content, image pre-processing, particle types, controls.
- **Plan change:** rule 2 is replaced by Pat-owned batch attribution; the software side wraps her output.
