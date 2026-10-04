# Handoff: software side (Patrik's part)

Written 3 Oct 2026 at the end of a session. This is a working note for the next agent: delete this file and the pointer in `AGENTS.md` once the list below is done.

## Read first

1. `AGENTS.md` (rules and commands), `README.md` (what is built), `docs/PLAN_v4.md` (the team plan, self-contained; **what to do next is its §4**. How the code got there from the v3 design is in README → Decision algorithm → "Changes from the v3 design").
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
- **Unseen data (updated 3 Oct, evening; PLAN_v4 §1.3):**
  - **Arrived:** folder `Hackathon-Polaron-test`, 9 files = **3 samples** (BSE, ETD, InLens each), not the nine images we expected. The split is unknown. Not opened and not scored: keep them unseen until attribution is frozen.
  - **Still to come:** "further images coming just before the judging" (task designer). Earlier we were told 2 images at the presentation, "which batch do they belong to, and WHY". Batch attribution and its explanation are the centrepiece, and the path for those images must be one command on a frozen model.

## Done (step 1, branch `PtrkH/image-unit`)

- The image unit drives the verdict; the strip view is reported in `other_unit`, with DIFFERENT-vs-SIMILAR as the contradiction rule.
- Shared-strip machinery was removed.
- `nearest_batch`, `image_groups` and `variance_split` were removed; `extra_needed`, `odd_sd`, `Odd` and `odd_images` were added.
- The UI, evidence fixture (strict round-trip test) and README were updated.

## Done (step 2, branch `PtrkH/attribution-contract`)

- Reworked the wrapper to read Pat's actual `attribute_images` and `--evaluate` files (`pat/ml-v3` @ `4557035`), not a software-owned output schema.
- Added NaN-safe JSON loading and pass-through API endpoints, including 501 while Pat's module is unavailable.
- Replaced the fixtures and updated the README to mirror Pat's formats and drop protocol.

## Done (step 3, branch `PtrkH/particles-imaging`)

- Added per-image particle type shares, pooled `new_type_share`, key gating and `fingerprint.type_shares`.
- Added baseline imaging ranges/outliers, imaging-sensitive quantities and optional curtaining blanking.
- Added CLI sidecar loading, synthetic tests and README documentation.

## Done (step 4, branch `PtrkH/explain`)

- Added fixed-template operator, engineer, scientist and manager explanations with dictionary fallbacks and indicative formulas.
- Wired explanations into `run()` and the decision CLI before evidence is written.
- Added synthetic explanation tests and README documentation; no dictionary file was created.

## Done (step 5, branch `PtrkH/ui-views`)

- Updated the UI to read Pat's actual per-run attribution and evaluation outputs (`pat/ml-v3` @ `4557035`).
- Built the Sort images, What's different and Batch verdict views with her probabilities, reasons, familiarity data, evaluation tables and gallery calls.
- Added fixture preview instructions and removed the proposed heatmap-file handling.

## Done (PR #4)

- **Evidence contract**: `qc/schema.py`, mirrored in `web/src/types.ts`; full example in `tests/fixtures/evidence_example.json`.
- **`qc/decide.py`**:
  - `split_tables`, `evaluate`, `compare`;
  - strip segments, t-intervals (`t_stats`), exact or seeded max-|T| permutation p (`permutation_p`), statuses (`analyze`);
  - shared-strip variants, odd-strip check (`odd_strips`), verdict precedence and next action (`verdict_of`, `strips_to_settle`), power arithmetic (`power`, `min_achievable_p`).
- **Glue**: `qc/provenance.py` (input SHA-256, git commit and dirty flag, config hash, `rules-frozen` tag). `qc/run.py` writes `area_um2`. `qc/io.py` fills `Field.black_level`.
- **Tests**: `tests/synth.py` (synthetic KPI tables, fixture generator), `tests/test_contract.py`, `tests/test_compare.py` (24 tests).
- **Minimal UI**: verdict card, differences table, images grouped by strip, provenance panel.

## Done (issue #19, branch `PtrkH/designs-in`)

- Compare, Identify result and Settings follow the v2 boards; one-off baselines with evidence keyed by baseline; the default baseline is locked by `rules-frozen`.
- Identify progress from Pat's stage events (`attribute_images(progress=)`), region peek and pin, cleanup (§7).
- The Claude summary and walkthrough (`qc/guide.py`), off without `ANTHROPIC_API_KEY`; not yet checked against real Claude output.

## Next, in this order (one PR-sized piece each)

### 1. Simplify and make the image the unit

Done, see Done.

### 2. Wrap Pat's batch attribution (decided 3 Oct: Pat owns it)

Done, see Done.

### 3. Plumbing for Pat's outputs (no edits to her files)

Done, see Done. When `pat/ml-v3` lands: `run()` must pass `split_tables(tables.kpis, tables.particles, tables.imaging)` (her `measure()` returns `Tables`).

### 4. Explanations: `qc/explain.py`

Done, see Done. The dictionary file comes with `pat/ml-v3` (her format: name, unit, key, meaning, why_it_matters, if_higher, if_lower, supplier_check, particle_types); no structure-only file was created to avoid a conflict.

### 5. UI and API

Done, see Done.

### 6. Freeze, score, rehearse (with the user)

Pat's features have landed. The order of work for both sides is now in **PLAN_v4 §4**. The software side's part:

1. Show the judged answer in the app (PLAN_v4 §4 step 6, §6): the bet, the tier with its record, the two stages, the prediction set and the reasons as sentences.
2. After Pat freezes the model (`rules-frozen`), the 3 dropped samples are scored once and the output committed unchanged.
3. Rehearse the path for the last-minute images through the app, timed, on known images. Nothing is refit on the day.
4. Set `margins` per key quantity only before the freeze, from the ranking and the nested evaluations.

## Open with Pat (not for the agent to do)

Listed in PR #4, section "For Pat":
- **Black level:** `Field.black_level` is filled, but `segment()` and `imaging()` don't receive the `Field`. Either she computes it inside, or `run.py` passes it in.
- **Column names:** confirm the proposed `PARTICLE_COLUMNS` / `IMAGING_COLUMNS`.
- **When `pat/ml-v3` lands:** `run()` must pass `split_tables(tables.kpis, tables.particles, tables.imaging)` (her `measure()` returns `Tables`).
- **KPI_UNITS:** add `si_graphite_ratio` and the other descriptors, then regenerate the fixture with `uv run python -m tests.synth`.
- **Attribution JSON layout:** if Pat changes her output, `web/src/types.ts` and both attribution fixtures must follow it.
- **PLAN_v4 §6 items for Patrik:** show the new attribution fields (reason sentences, confidence tier with its record, the two stages, the prediction set), make the "Unlike any known batch" badge print `predicted_distance` and `predicted_threshold`, mirror the fields in `web/src/types.ts` and both fixtures, one template sentence each on attribution and familiarity, silicon content %, and the controls into `run()`. The attribution block is not part of `Evidence`.
- **Her other pieces:** the dictionary content, image pre-processing, particle types, controls.
- **Plan change:** rule 2 is replaced by Pat-owned batch attribution; the software side wraps her output.
