# Tickets after the freeze (written 3 Oct 2026, ~23:00)

> Historical: written for the night before submission. The model has since been refitted (MODEL.md §8); the frozen model below is the 3 Oct one.

## Status (4 Oct 2026, ~03:00)

**PR stack.** #21 and #36 (T14) were closed on 4 Oct: their commits went in through #44, which also adopted T14. The other ticket PRs are report-only; each one's record (`experiments/T*.md`) is on its branch, not on `main`.

```
main
└─ #21 pat/experiments-base (this file, scaffold)
   ├─ #29 T1 invariance audit ── #38 T8 train-time augmentation
   ├─ #25 T2 dark-graphite share ── #28 T9 imaging erasure ─┬─ #30 T10 texture at material scale
   │                                                        └─ #31 T4 reason wording (text only)
   ├─ #22 T3 shared-strip pair test
   ├─ #32 T5 What's different (variance ratio, silicon %, statements; touches Patrik's files)
   ├─ #34 T6 drop runbook (rehearsed)
   ├─ #26 T13 report-only materials descriptors
   ├─ #35 T11 familiarity distances ── #37 T12 tile-type pooling
   └─ #36 T14 confidence methods
```

Expected conflicts: #29 and #25 both extend `_fit_parts` (per-stage `C` vs `residualize`). #25 and #26 both append to `qc/measure.py` and `tests/test_ml.py`.

| Ticket | Result in one line | Doc |
|---|---|---|
| T1 | σ = 5 noise flips "Batch_3 or not" for 12 of 17 Batch_3 images; adding dark-graphite zones moves all 7 Batch_1 images to Batch_3 | `experiments/T1.md` |
| T2 | The dark-graphite share is a reproducible descriptor; removing it costs the deep stage only 0.02 (still above the null); pc03 and pc04 track it | `experiments/T2.md` |
| T3 | Inside a strip, Batch_1 and Batch_2 images are no more different than same-batch images; the positive control fails too (blunt test) | `experiments/T3.md` |
| T4 | Reasons now carry `basis: imaging \| material` and caveats; the reworded results match the frozen numbers exactly | PR #31 |
| T5 | Batch_1 silicon SD 3.3× the baseline's; silicon % shown; fixed batch statements | PR #32 |
| T6 | Last-minute path rehearsed: about 12 s per sample from the CLI, offline; `matches_frozen: true` | `RUNBOOK_DROP.md` |
| T7 | **Not done:** its gate (stable calls in T1) failed | – |
| T8 | Training with imaging and dark-graphite copies keeps staged accuracy (0.675) and cuts noise flips 11→2 and dark-graphite flips 7→0. **v2 candidate** | `experiments/T8.md` |
| T9 | **Erasing the measured imaging takes every attribution signal to chance**; a shuffled-covariate control shows this is imaging-specific | `experiments/T9.md` |
| T10 | Material-scale texture is less noise-sensitive but still collapses under erasure | `experiments/T10.md` |
| T11 | No familiarity distance flags more Batch_1/Batch_2 images, because Batch_3's strips are themselves widely spread; tile heatmaps added | `experiments/T11.md` |
| T12 | Tile quantiles 0.65 (one image above flat deep); the gallery shows Batch_3's distinctive tiles are the dark-graphite contrast | `experiments/T12.md` |
| T13 | The rule-based "dim, ragged" Si class is exactly strip 2316; Batch_1's difference is spread, not mean | `experiments/T13.md` |
| T14 | Venn–Abers and leave-one-out conformal are worth adopting; held-out temperature scaling adds nothing | `experiments/T14.md` |
| T15 | **Not done:** DINOv3 weights are gated and MicroNet needs new dependencies; after T9 a new backbone is low value | – |

**Follow-ups this opened:**

1. Run T9's erasure on the T8 arm-(b) model: does robustness to simulated changes also remove the acquisition signal?
2. Score any v2 candidate against a best-of-all-entries null (9 entries so far), or on new labelled images.
3. Download the 2.8 GB NMC811 set for T11's foreign test.
4. Break T12's Batch_1 tile type 6 down per strip.

One ticket per agent. Paste **Common context** plus the ticket into each agent. Tickets are self-contained.

## State these tickets start from

- `main` @ `b5d850e`. Tag `rules-frozen` (22:10) is on the commit with `config/attribution_model.json` = staged `material > deep` (LOSO 0.66, C baseline 0.03 / variation 0.01).
- The 3 dropped samples are scored and committed: `results/Hackathon-Polaron-test.json`. `3e122cbj` → Batch_1 (0.50, low), `fn0mhxef` → Batch_2 (0.47, low, unfamiliar), `xrv9xvzb` → Batch_3 (0.99, high).
- `docs/MODEL_LITERATURE_REVIEW.md` was committed at 22:26, **after** the freeze. Its §8.5 steps 1–3 were written as "before the freeze" checks. They can no longer change the model. They are still worth running because they decide **how the calls are explained**, and the explanation is judged.
- Every `PtrkH/*` feature branch is already patch-merged into `main` (`git cherry` shows nothing left). The only unmerged work is `demo-video/explainer` (2 commits, video assets; Patrik).
- The top reason for `3e122cbj` is "BSE texture local contrast at 0.05 um: 5.6 SD above Batch_3". That is the 2-pixel texture the review suspects measures detector noise, which is why T1 comes first.
- Submission is due Sun 4 Oct, 14:45. More unseen images arrive shortly before judging and go through the frozen model unchanged.

## On the augmentation / lighting idea

- **Original idea** (PLAN_v0, Patrik): brightness, contrast, gamma, noise, mild blur and flip augmentation for a segmenter, plus a demo "robustness curve" (KPI drift for a −50…+50% contrast change). It ruled out scaling, elastic warps and strong blur.
- **PLAN_v1 reframed it** as a *test harness*, not training data: "augmenting images to train a batch classifier: no, 13 strips, it would learn strip fingerprints". It became the negative controls in `qc/controls.py` (brightness ±20%, contrast ±20%, black +20, noise σ5, curtaining).
- **Gap:** those controls are only ever pushed through the KPI comparison (A/D). They have **never been run through `features.py` → `deep.py` → the attribution model**, which is the judged part. The robustness curve was never built.
- **The literature review covers it partly:** §5.1(a) runs the model on noise and blur copies. A note in §5.1 suggests train-time augmentation (noise, blur and gain copies with the same label and strip group; [L5] FroFA) or LEACE [L41] if the check fails.
- **The review does not cover:**
  - gamma;
  - InLens top-to-bottom shading, the real "lighting" artefact (ratio up to 1.92, §1.1);
  - InLens saturation;
  - simulating the **dark-graphite electrical contrast** it identifies as the main confound (§8.2 Q2);
  - which flips are legal (horizontal only: vertical is through-thickness, §8.2 Q3);
  - an out-of-sample version of the check. The frozen model was fitted on all 31 images, so perturbing those images and predicting with it is in-sample and understates flips;
  - test-time augmentation as a stability signal.
- **Verdict on what is worth trying:**
  - Augmentation **as a test** of the frozen model: yes, tonight (T1). It is cheap, it decides how honest the reasons are, and it delivers the robustness curve.
  - Augmentation **in training**: worth one pre-registered try after submission (T8). Expect robustness and honesty gains, not accuracy gains: at 14 images the review shows no accuracy gain can be established.
  - Generative augmentation, scaling, rotation or vertical flip: no.

## Common context (paste into every ticket)

```
Repo: batch-size-2/catalyst. Branch from main (b5d850e or later) as pat/<ticket-id>-<slug>; open a PR, don't push to main.
Read first: AGENTS.md; docs/PLAN_v4.md §1, §2 (Rules), §3.14–3.17, §12–12.3; docs/MODEL_LITERATURE_REVIEW.md §5 and §8.
Setup: uv sync. Data must exist locally at data/Batch_1, data/Batch_2, data/Batch_3 (gitignored; 31 samples x 3 detectors).
  If it is missing, STOP and ask for it; never download or invent data.
  out/features.csv may be missing: build it once with `uv run python -m qc.features` then `uv run python -m qc.deep`
  (DINOv2 on CPU, ~5 min; weights download once from Hugging Face, then HF_HUB_OFFLINE=1).
Hard rules:
  - Do NOT edit config/attribution_model.json, config/decision.yaml or config/particle_types.json (frozen by tag rules-frozen).
  - Do NOT modify results/Hackathon-Polaron-test.json.
  - Never use data/Hackathon-Polaron-test or data/drop_* (unseen samples and app uploads of them) in any fit, PCA, threshold,
    feature selection or "best of" choice. Experiments use the 31 known images only, unless the ticket says otherwise.
  - Accuracy is always leave-one-strip-out (strip = qc.attribute.strip_group), never leave-one-image-out (Rule 10).
  - Pre-register: before running anything, commit docs/experiments/<ticket-id>.md with the hypothesis, the exact metric,
    and the reading/stop rules copied from the ticket. Then run and append the results. Don't change the rules after seeing numbers.
  - Experiment code goes in scripts/experiments/<ticket-id>_<slug>.py. Outputs go in out/experiments/<ticket-id>/ (gitignored).
    Commit only code, tests, and the docs/experiments md (with result tables and small PNGs if useful).
  - Changes to qc/*.py must not change any default output: add a test that the default path gives identical numbers.
  - uv run pytest must pass. Touching web/: cd web && npm run build must pass (npm install --before=<date one week ago>).
  - Keep README in sync per AGENTS.md (e.g. add scripts/experiments/ and docs/experiments/ under Infrastructure once).
  - Hand back: the paths of the result md, the output files and the exact commands run.
```

---

## Tonight: before the submission. None of these change the frozen model

### T1 · Imaging-invariance audit of the frozen model ("lighting augmentation as a test") — P0

**Why:** Stage 1 of the frozen model (Batch_3 or not) runs on texture features computed at 2 px (0.05 µm). The review (§5.1) argues these follow detector noise and sharpness, not material. Stage 2 (Batch_1 vs Batch_2) runs on InLens DINOv2 components that track the dark-graphite contrast (§8.2). This ticket measures how far each call moves when only the imaging changes.

**Perturbations.** Apply each one to the uint8 channels of a `Field`, then clip to 0–255:

| id | Channels | Transform | Expected |
|---|---|---|---|
| gain120 | all | `(img−black)·1.2+black` (reuse `controls._neg_brightness`) | tex_ ≈ unchanged (sanity) |
| contrast080 | all | reuse `controls._neg_contrast(0.8)` | tex_ ≈ unchanged (sanity) |
| black20 | all | `controls._neg_black(20)` | small |
| gamma125 | all | `black + (255−black)·((img−black)/(255−black))^1.25` | ? |
| noise5 | all | `controls._neg_noise(5)`, seed = hash(image_id) | **key test** |
| blur1 | all | Gaussian σ = 1.0 px (`scipy.ndimage.gaussian_filter`) | **key test** |
| curtain | all | `controls._neg_curtaining` | small |
| shade125 | InLens | multiply rows by a linear ramp so top/bottom mean ratio = 1.25 (black-corrected) | ? |
| hflip | all | `img[:, ::-1]` | ≈ invariant (sanity; never vertical flip: vertical is through-thickness) |
| dg_add | InLens | graphite pixels (`segment()` mask == `Phase.GRAPHITE`) in the top 40% of valid rows: `black + 0.30·(v−black)` | tests the §8.2 Q2 confound |
| dg_remove | InLens | graphite pixels with `v−black < 55`: `black + (v−black)/0.30` | tests the §8.2 Q2 confound |

**Two prediction arms. Report both; arm B is the headline:**

- **A. Frozen as is:** `attribute.load_model()` + `attribute.predict()`. This is what the live path does. It is in-sample, because the model was trained on these 31 images.
- **B. Out of sample:** for each strip, refit the frozen recipe on the other strips with `fit_model(..., staged=(("reg","edge","tex","par","kpi"),("deep",)), baseline="Batch_3")`. Use **fixed** `C` from the frozen JSON (baseline 0.03, variation 0.01) and no nested search. Then predict the original and the perturbed images of the held-out strip.

**Feature computation:** the same path as `attribute_images`: `features.image_features(field)` and `deep.deep_features(field)`, merged like `merge_deep`. Do not write `out/features.csv`. Cache perturbed rows to `out/experiments/T1/perturbed_features.parquet` with key `(image_id, perturbation)`. T8 reuses this file.

**Order (time box: about 2 h of CPU):**

1. noise5 and blur1 on the 17 Batch_3 images. This answers review §8.5 step 1.
2. dg_add on the 7 Batch_1 images, and dg_remove on the Batch_2 and Batch_3 images whose dark share is > 0.1 (use T2's definition; compute it inline if T2 has not landed).
3. The rest of the table on all 31.
4. Robustness curve on 3 Batch_3 images from different strips:
   - contrast factors {0.5, 0.75, 1, 1.25, 1.5} and noise σ {0, 2, 5, 8, 12};
   - plot `p_Batch_3` (arm B) and the drift of `si_graphite_ratio`, `si_d50_um` and `porosity_apparent` (from `measure.kpis`) against strength;
   - save `docs/experiments/T1_robustness.png`. This is the demo asset from the original idea.

**Report** per perturbation × true batch, for each arm:

- the number of `predicted` calls that change;
- the number of `stage_baseline.call` changes;
- the number of `stage_variation.call` changes;
- the median |Δ `p_Batch_3`|;
- per family (`tex, reg, par, kpi, edge, deep PCs`): the median |Δfeature| / (SD of that feature over the Batch_3 images).

**Reading rules (pre-registered):**

- If gain120 or contrast080 moves tex_ by more than 0.2 SD, the table in review §5.1 is wrong. Say so.
- If noise5 or blur1 flips `stage_baseline` for ≥ 3 of 17 Batch_3 images in arm B, the first stage reads the microscope. Consequence: wording (T4) and the pitch's limits. The model stays frozen.
- If dg_add moves ≥ 4 of 7 Batch_1 images off Batch_1 in `stage_variation` (arm B), the Batch_1/Batch_2 lean rests on the electrical contrast.

**Done when:** `docs/experiments/T1.md` has both arms' tables, the three readings and the PNG, and the parquet cache exists.

### T2 · Dark-graphite share: a named imaging descriptor, and how much the deep stage leans on it — P0

**Why:** Review §8.2 Q2 and §8.5 step 2 judge the dark InLens graphite to be electrical contrast, not material (about 75% confidence). They report that PC1 of the deep features correlates −0.75 with it, from a quarter-scale throwaway script. This ticket makes the number reproducible with the real mask and measures the dependence.

1. **Descriptor:** add `dark_graphite_share(mask, channels, px_um) -> dict` to `qc/measure.py`.
   - Graphite = `segment()` mask == `Phase.GRAPHITE`, valid rows only.
   - InLens is black-subtracted (`black_level`) and Gaussian-smoothed with σ = 1 px.
   - A pixel is dark if its value is < 55. InLens pixels at 255 are excluded.
   - Returns `{"dark_graphite_share": ..., "dark_graphite_share_top": ...}`, where top = the top third of valid rows.
   - **Do not** add it to `imaging()` or to anything `qc/decide.py` reads: the verdict path is frozen. Add a unit test on a synthetic mask.
2. **Table** for the 31 known images, by batch and strip. Compare it with review §8.2 (Batch_1 0.01–0.05; Batch_2 0.00–0.28; Batch_3 0.00–0.80). If it disagrees materially, say so.
3. **Correlations:**
   - Transform the 31 images' deep columns with the **frozen** model's variation-stage reducer (from `model_parts(model)`) into its 10 PCs.
   - Compute Pearson and Spearman r of each PC with both shares, and with each `img_` descriptor.
4. **Diagnostic LOSO (not a new model):**
   - For flat `deep` and for staged `material > deep`, regress the deep PCs on `dark_graphite_share` inside each training fold (OLS fit on the training rows, applied to the held-out rows) and classify on the residuals. Use nested `C` as usual.
   - Null: 200 segment shuffles through the same pipeline.
   - Add this as an optional `residualize: list[str] | None = None` argument to the relevant `qc/attribute.py` functions. The default `None` must reproduce today's numbers exactly; add a test for that.
5. Only after 1–4 are committed: compute the two shares for the 3 unseen samples, **report only**. T4 needs them for the wording. Nothing is fitted on them.

**Reading rules:**

- If the residualised `deep` LOSO falls to or below its null p95, write: "the Batch_1/Batch_2 lean rests on an imaging contrast and is expected to hold only for images from the same sessions".
- PCs with |r| ≥ 0.5 against either share are listed for T4.

**Done when:** `docs/experiments/T2.md` has the table, the correlations, LOSO with and without residualisation against its null, and the list of PCs; the function is tested.

### T3 · Shared-strip pair test: is there any Batch_1 vs Batch_2 signal inside a strip? — P0

**Why:** Review §5.2. A per-feature sign rule on 3 pairs passes about 45 of 180 features by chance. Comparing pair distances with same-strip, same-batch pairs is the test with real power.

1. **Pairs:** from `out/features.csv`, enumerate every pair of images with the same `strip_group`. Classify each pair as B1–B2, B2–B3, B1–B3 or same-batch.
   - Expected: 3 B1–B2 pairs (strips 2080, 2148, 2156), 5 B2–B3, 1 B1–B3, 18 same-batch.
   - If the counts differ, **stop and report** the actual layout before going on.
2. **Representations, fixed now:**
   - (a) 10 deep PCs from a PCA fitted on all 31 images (label-free), standardised;
   - (b) the material features (`reg, edge, tex, par, kpi`), each z-scored over the 31 images, with NaN columns dropped (`usable_features`).
   - Euclidean distance in each.
3. **Test:** rank-sum of the 3 B1–B2 distances among the 21 distances (3 cross + 18 same-batch), exact over all C(21,3) = 1,330 subsets.
   - Report p and whether all 3 exceed all 18.
   - Conservative version: one value per strip. Take each strip's mean same-batch distance (one value per strip with a same-batch pair) and compare the 3 cross values against those, exactly.
4. **Positive control:** the same test for the 5 B2–B3 pairs against the 18 same-batch pairs.
5. **Only if step 3 gives p < 0.05 at the strip level:** per feature, take the 3 signed differences divided by the SD of that feature's same-batch pair differences. List features with the same sign in all three and each beyond 2 SD, at most 3. Do **not** fit anything with them; they go into T4 and the pitch as observations.
6. Optional, only if step 3 is unclear: a kernel MMD between the two tile-embedding sets of each pair, ranked against the same-batch pairs. Needs tile-level embeddings: reuse `qc.deep.tiles` and `Dinov2` without pooling.

**Reading rules:**

- If the 3 cross pairs sit inside the same-batch range, write: "inside a strip, the folder label is not visible; Batch_1 vs Batch_2 is a lean". Then stop the Batch_1/Batch_2 search.
- If the positive control also fails, the test is too blunt and the "no" is weak. Say so.

**Done when:** `docs/experiments/T3.md` has the pair table, both p-values for each representation, and the positive control.

### T4 · Honest reason wording (text only) and stated assumptions — P0, after T1 and T2

**Why:** review §8.5 steps 5–7. The live reasons read as material properties when, by the evidence so far, some are imaging. Explanation text may change after the freeze; numbers may not.

**Coordination (Pat, 3 Oct):** `config/reason_wording.yaml` is approved. Patrik is separately using Claude to make the reasons read more naturally. This ticket supplies the **facts and caveats** that rewording must keep:

- Add a structured `basis: "imaging" | "material"` and an optional `caveat` string to each reason, next to `text`, so the Claude layer can carry them without guessing.
- Before starting, check `git branch -r` for Patrik's Claude branch and do not edit his files. If his branch exists, add a test or fixture that his layer can read `basis` and `caveat` from.

1. Add `config/reason_wording.yaml`. It is a new file, not covered by the tag; document it in the README. Two maps:
   - `deep_pc` → override text. Applies to the PCs T2 lists. Text: "InLens image {shows / does not show} dark-graphite zones (share {x:.2f}); an electrical imaging contrast, not a composition difference". `{x}` = `dark_graphite_share` of the image.
   - `feature_prefix` → suffix. Applies to `tex_*` at the 0.05 µm scale, only if T1 found noise or blur sensitivity: "(fine texture at the detector-noise scale; may reflect imaging)".
2. Apply it in `qc/attribute._reasons` as a text-only layer. Compute the dark share in `attribute_images` (T2's function) so it is available per image.
3. **Test:** run `predict` on the known feature table with and without the wording file. Every field other than `reasons[].text` must be identical: probabilities, `predicted`, tiers, sets, distances, reason order, z and contributions.
4. **README "Limits and assumptions":** the three judgements of review §8.2, each with its confidence:
   - electrodes pristine except strip 2316 (85%);
   - InLens dark graphite is imaging (75%);
   - top is the surface, bottom the foil (95%).
   Add one line each from T1, T2 and T3's readings.
5. Do not rewrite `results/Hackathon-Polaron-test.json`. Write `results/Hackathon-Polaron-test.reworded.json`, regenerated from the same frozen model, and check its numbers match the committed file exactly. Note in PLAN_v4 §12.3 that only the text differs.

**Done when:** tests pass, the reworded results file matches on every number, and the README limits section exists.

### T5 · "What's different": variance ratio, silicon content %, batch statements — P1 tonight or morning (Patrik's area: `qc/decide.py`, `web/`)

**Why:** review §8.3. Batch_1 differs in **spread** and particle population (strip 2316), not in the mean. Its silicon SD is 3.4× the baseline's. The tests in `decide.py` compare means only.

1. In `compare()`, add a report-only `variance_ratio` (batch SD / baseline SD over image values) for each key quantity and for `si_area_frac`, with a 90% interval:
   - F-distribution interval on image values, plus the strip view next to it like the existing `other_unit`;
   - add the field to `qc/schema.py` `Evidence`, `web/src/types.ts` and the fixtures (adding a field is allowed by AGENTS.md);
   - it does **not** enter the verdict and needs **no** `decision.yaml` key (that file is frozen).
2. Silicon content %: check whether PLAN_v4 §3.8 is already built (commit `478102d` touched the label). If not, show `si_area_frac` and Si / (Si + graphite + binder) per batch with an interval in the Compare view, plus the sentence "area fraction ≈ volume fraction; does not sort the batches".
3. Fixed batch statements in the "What's different" view, with numbers from the evidence:
   - Batch_1: a different silicon population (strip 2316) and the most variable batch;
   - Batch_2: not materially different from the baseline in anything we measure;
   - imaging differences shown apart.
   Use a strip 2080 InLens image and a strip 2316 BSE image as the two pictures.

**Done when:** pytest and `npm run build` pass, and a screenshot of the Compare view shows the variance ratio and the silicon %.

### T6 · Rehearse the last-minute path and write the runbook — P0, morning (both owners)

1. Copy 2 known samples (one Batch_3, one Batch_1) into `data/rehearsal_<HHMM>/`. Run the exact judged command:
   `HF_HUB_OFFLINE=1 uv run python -m qc.attribute --images data/rehearsal_<HHMM>`
   Then do the same through the app's Identify screen. Time each step.
   - The predictions are in-sample: this is a plumbing and timing check only.
2. Check:
   - `GET /api/health` is all true before the upload (model file, deep import, DINOv2 weights cached). The Identify screen refuses the drop until it is. See `docs/RUNBOOK_DROP.md`;
   - the provenance in the output shows `rules-frozen` and the model sha;
   - the run works with the network off;
   - the app shows the bet, the tier and record, the two stages, the prediction set, the reasons as sentences, `predicted_distance` and `predicted_threshold`.
3. Write `docs/RUNBOOK_DROP.md` as 10 lines: commands, where outputs go, the commit message template ("output committed unchanged"), what to say about a low-tier call.
4. Delete `data/rehearsal_*` afterwards (they are copies the agent made).

**Done when:** the runbook exists with the measured seconds per sample, and the app screenshot is attached to the PR.

### T7 · Optional: test-time stability line beside each live call — P2, only if T1 shows stable calls, and only with Pat's go-ahead

For each live image, run the T1 nuisance set {noise5, blur1, gain120, shade125, hflip} through the frozen model. Report `stability: {"same_call": k, "of": 5}` beside the call. **It never changes `predicted`.** It adds about 5 × 14 s per image, so time it in T6 first. It turns "low confidence" into a checkable statement ("call unchanged under 5 of 5 imaging perturbations").

---

## After the submission: research for a v2 model

These produce candidates only. **Decided (Pat, 3 Oct): the model stays frozen.** Pat will un-freeze only once a clearly better alternative exists, and that decision will be disclosed. Each ticket is one pre-registered entry in a best-of-list. Report each against the **best-of-list null** of all entries tried so far (PLAN_v4 §3.17), not only its own null.

### T8 · Train-time augmentation (the original idea, done properly) — P1, needs T1's cache

- Inside each LOSO training fold, add the T1 perturbed copies of the **training** images only. Copies keep the image's label and strip group. Never augment or predict on augmented copies of held-out images.
- PCA on the original training images only. Logistic fit on originals plus copies, with sample weight `1/(K+1)` so each image counts once. `C` from the nested inner LOSO as usual.
- **Arms** (pre-register all three; 3 list entries):
  - (a) nuisance set {noise, blur, gain, gamma, shading, curtaining, hflip};
  - (b) (a) + `dg_add`/`dg_remove`, making the model invariant to the dark-graphite contrast;
  - (c) feature-space jitter only, FroFA-style [L5]: Gaussian noise on standardised features with σ = the T1 median per-family drift.
- Models: staged `material > deep` and flat `deep`.
- **Null:** 200 segment shuffles. Copies inherit the shuffled label.
- **Metrics:**
  - LOSO balanced accuracy;
  - right per tier, from `--dry-run --repeats 20` with augmentation applied in each refit;
  - the T1 arm-B flip table for the augmented model. **This is the main expected gain.**
- **Reading:** arm (b) is expected to lower Batch_1/Batch_2 accuracy. If it does, that is evidence the lean was imaging, and it is the honest model to describe in the pitch's "what we'd do next".

### T9 · Remove what the imaging explains (LEACE / residuals) — P1

Review §5.1(c, d) and [L41]:

- Inside each fold, fit LEACE (or OLS residualisation as the simple version) to remove from the material features and the deep PCs the linear directions that predict the `img_` descriptors plus `dark_graphite_share` (T2).
- Rerun the two-way Batch_3-vs-rest LOSO (texture, material) and the three-way LOSO (staged, flat deep), each against its null.
- **Reading:** signal left after erasure is not explained by measured imaging. One list entry per model.
- Re-use the T2 `residualize` hook if it fits; LEACE needs a small closed-form implementation (no new dependency).

### T10 · Texture at the material scale — P1

Review §5.1(b) and §8.4 item 5:

- New family `tex2_`: the same LBP and GLCM as `features.texture_features`, but after 2×2 block averaging, with LBP radius and GLCM distance at 0.2 µm and 0.5 µm.
- Rerun Batch_3-vs-rest (two-way) and three-way LOSO, staged `tex2 > deep`, against the null.
- Report |r| with `img_bse_noise` and `img_*_sharpness` against the current `tex_`.
- Run the T1 noise5 and blur1 flips on the new stage 1.
- **Reading:** if accuracy holds near 0.85–0.88 and the noise correlation drops, `tex2_` is the better first stage for v2.

### T11 · Better familiarity distance and a "where it differs" heatmap — P1

Review §7.1. Today the baseline distance flags 1 of 14 Batch_1/Batch_2 images, and *unfamiliar* has never been tested on a foreign image.

- **Candidates** (fixed list):
  - (a) shrinkage (Ledoit–Wolf) Mahalanobis in the 10 deep PCs, per batch with a shared covariance;
  - (b) relative Mahalanobis [L48];
  - (c) PatchCore-style [L31]: a memory bank of Batch_3 tile embeddings; the image score is the mean distance of its top 1% most distant patches.
- **Threshold:** as today, the max over Batch_3 held-out strips.
- **Metrics:**
  - flags among the 14 Batch_1/Batch_2 images, strip-held-out;
  - false flags on Batch_3 held-out strips;
  - flags on a **foreign** set: the public Zenodo "Battery Imaging Library" NMC811 FIB-SEM [L36]. Download it, take 2D slices, and resample to 25 nm/px if needed. Expected: all flagged.
- Deliverable: per-tile distance heatmaps from (c) for 3 Batch_1 images. A candidate visual for "what's different".

### T12 · Tile-type pooling: let a local feature count — P2

Review §7.2:

- Inside each fold, fit k-means (k = 8, label-free) on all tile embeddings of the training images (about 1,700 tiles).
- Per image: the tile-type shares, plus p10/p90 per deep PC instead of mean and SD.
- Logistic on the shares (one list entry) and on the quantiles (one entry).
- Deliverable either way: 6 example tiles per type. These are the example-based reasons ("looks like these") on PLAN_v4 §5's open list.

### T13 · Report-only materials descriptors for question A — P1 (can start tonight if an agent is free; touches only new functions)

Review §8.4 items 2–4. Add these to `qc/measure.py` as new functions. **Not** in `kpis()`, `particles()`' columns, `features.csv` or `decide.py` until a v2 freeze.

1. Rule-based Si classes from the particle table:
   - dense shard;
   - speckled/porous (`void_frac > 0.1` or `texture` above the p90 of Batch_3);
   - dim and ragged (`contrast_ratio < 1.75` and `solidity < 0.85`).
   Report the area share of each per image and per batch.
2. Binder/carbon "lace" area share and its through-thickness slope.
3. Long thin horizontal pores (aspect ratio > 5, length > 5 µm) per 10⁴ µm², for cracks and layer separation.

**Deliverable:** a per-batch table with intervals in `docs/experiments/T13.md`. Check: strip 2316 should dominate "dim and ragged". Feed the table into the T5 batch statements.

### T14 · Confidence methods — P2

Review §7.4:

- Venn–Abers for stage 1 on the 31 out-of-fold probabilities;
- cross-conformal sets;
- Bayesian logistic regression with a weakly informative prior instead of the `C` grid.

Compare each on the rehearsal tier record and the set coverage/size. Report only; no list entry for accuracy.

### T15 · Backbones, one try each — P3

MicroNet-pretrained encoder [L27] and DINOv3 [R38] in place of DINOv2-small in `qc/deep.py` (new family prefix). Flat and staged LOSO against the best-of-list null. Run only after T1 and T10, so the noise question is settled first.

---

## Suggested assignment

| Agent | Tonight | After submission |
|---|---|---|
| 1 | T1 | T8 |
| 2 | T2 → T4 | T9 |
| 3 | T3 | T11 |
| 4 (Patrik's side) | T5, then T6 with both owners | — |
| 5 (if available) | T13 | T10 → T12 |

T14, T15 and T7 only if time is left. T1, T2, T3 and T13 touch different files, so they can run in parallel. T4 waits for T1 and T2. T8 waits for T1's cache.
