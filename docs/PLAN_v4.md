# Track 4 · Batch QC for electrode microstructure: Plan v4 (draft)

Team Batch Size 2. ML: Pat. Software: Patrik. **Delta on [PLAN_v3](PLAN_v3.md)**: sections not mentioned here stand as written there (§14 lists them). Drafted by Pat's agent after the task designer's clarification; for both owners to review before it replaces v3 as the plan.

## In short

The task designer has told us how the entry is judged:

> Treat Batch 3 as the baseline, it's what's been "promised" by the supplier. Batch 1 and 2 arrived subsequently, and we're trying to tell if they are different. They are not explicitly better or worse than the Batch 3 baseline, but they show the types of variation we need your models to pick up on. The judging criteria reflects this; can you identify what's different about the batches, and thus categorise the held back samples correctly. If you can, this implies unknown batch N could be categorised accurately as in or out of distribution — helping manufacturers make critical decisions about when to accept and reject a batch.

Plus (from the mentors): nine held-back images, three per batch, on which we must say which batch each belongs to; the important features may sit in different regions of the image.

The tool therefore answers **four** questions instead of one, in this order, and shows them apart:

| # | Question | Answer | Where |
|---|---|---|---|
| A | **What is different** about Batch_1 and Batch_2 against the Batch_3 baseline? | Per quantity: difference in units, interval, p, two-sided (above or below the baseline), driver ranking | v3 §3.5, unchanged |
| B | **Which known batch** does an unseen image look like? | Probabilities for Batch_1/2/3, the features that drove it, the regions that drove it | **new §3.15** |
| C | **Is it inside the baseline's distribution** at all, or unlike anything we have seen? | Two-sided z-scores against Batch_3, an RMS distance, an *unfamiliar* flag; the same for every known batch | **new §3.16** |
| D | **Accept, investigate or reject** this batch? | v3 §3.5 verdict, fed by A, with B and C in the explanation and the next action | v3 §3.5, wording in §3.18 |

Rule 2 of v3 ("no classifier trained on batch folders") is narrowed, not dropped: a classifier is allowed for **B only**, under the evaluation protocol of §3.17, and is never the verdict (§2).

Status of the real data on 2026-10-03: the 15 whole-image descriptors do **not** separate the three batches under leave-one-strip-out (balanced accuracy 0.49 vs a permutation 95th percentile of 0.48 on leave-one-image-out, 0.35 strip-held-out; AGENT_HANDOVER §2.3). The designed variation is somewhere the whole-image averages do not look. §3.14 is where we go looking.

## 1. Ground truth, updated

| New fact (task designer / mentors) | Consequence |
|---|---|
| Batch_3 is the promised material; Batch_1 and Batch_2 arrived later | `baseline: Batch_3` (v3 §10 Q1 answered). Every "different" is relative to Batch_3 and **two-sided** |
| Batch_1 and Batch_2 are "not explicitly better or worse" | Rule 7 stands and gets teeth: no verdict for Batch_1/Batch_2 is "correct" by design. A, B and C are judged; D is our value-add with a customer tolerance |
| They "show the types of variation we need your models to pick up on" | The variation is designed and material, not acquisition. Material feature families drive B; imaging descriptors are reported but excluded from the model by default (§3.15) |
| Judged on categorising the held-back samples | B is the deliverable that is scored. It gets an honest accuracy estimate before the drop (§3.17) and a rehearsal (§4) |
| Nine images, three per batch | B predicts per image; a *balanced assignment* (exactly three per batch) is reported next to the unconstrained prediction (§3.15) |
| "Unknown batch N could be categorised as in or out of distribution" | C: in-distribution means inside the baseline's own strip-to-strip spread; a *known variation* means outside it but matching Batch_1 or Batch_2; *unfamiliar* means unlike any known batch (§3.16) |
| Important features may sit in different regions | Regional (tiled) descriptors with spread and depth-profile summaries; the ignored top/bottom bands measured separately (§3.14) |
| 5 of Batch_2's 7 images share physical strips with other folders (v3 §10 Q2) | B must get shared-strip images right from the material, not the strip: §3.17's shared-strip check. `strip_id`, image size, pixel size and XResolution are never features |

## 2. Rules, updated

Rules 1, 3, 4, 5, 6, 8, 9 of v3 stand. Rule 6 additionally freezes `config/attribution_model.json`.

**Rule 2 (was: no classifier trained on batch folders).** A classifier on batch labels is allowed only for attribution (B). It must be: linear or nearest-centroid on named, unit-bearing features; evaluated leave-one-strip-out with a permutation null before it is trusted; frozen as readable JSON; and reported with the features and regions that drove each prediction. It never produces the verdict, never touches a KPI value, and never uses `strip_id`, image dimensions, `px_um` or XResolution (§3.14 enforces this in code).

**Rule 7, sharpened.** "Different" is not "bad", and *attributed to Batch_1* is not "bad" either. Report wording: "looks like Batch_1 (p = 0.8), because …", "outside the baseline's range on …", never "defective". The verdict for an incoming batch still needs the customer tolerance `δ` (v3 §3.5).

**Rule 10 (new).** The attribution model is scored on strips it never saw. Leave-one-image-out numbers are not reported anywhere.

## 3. Pipeline additions

The v3 pipeline `Field → segment → mask → kpis / particles / imaging → tables → compare → evidence` stands. Two modules are added beside it, both Pat-owned:

```
Field ─ segment ─ mask ─┬─ kpis(), particles(), imaging()  ──► out/kpis.csv, particles.csv, imaging.csv ─► compare() ─► evidence (A, D)
                        └─ features.py: regional, edge, texture, particle aggregates, kpi, imaging ─► out/features.csv
                                                                        │
                                   attribute.py: LOSO evaluation ───────┤──► out/attribution/evaluation.json, feature_ranking.csv
                                                fit ────────────────────┤──► config/attribution_model.json (frozen)
                                                predict on a folder ────┴──► out/attribution/<drop>.json  (B, C)
```

### 3.14 Feature discovery: `qc/features.py`

One row per image, `batch, image_id, strip_id` plus features in six families, each with a prefix so a family can be switched on and off:

| Family | Prefix | Content | Why |
|---|---|---|---|
| Regional | `reg_` | Per ~15 µm tile of the valid band: Si, pore, graphite, binder fractions, Si/graphite, graphite and pore chord. Summaries over tiles: mean, SD, CV, p10/p50/p90; a normalised top-to-bottom slope and a top/bottom ratio | "Features in different regions": spread and depth profile, not just the mean |
| Edge | `edge_` | Si and pore fraction and relative brightness in the top and bottom 5% rows that `segment()` ignores | Measured separately because they are artefact-prone, but a designed difference could live there |
| Texture | `tex_` | Uniform LBP histograms (P=8, R=1 at 0.05 µm/px) per channel, and BSE LBP inside graphite and inside Si; GLCM contrast, homogeneity, energy, correlation at 0.1 and 0.4 µm per channel, with a 0°/90° anisotropy | Cracks, porous Si, grain texture, surface roughness: things the phase fractions miss |
| Particles | `par_` | From `particles()`: count density, area-weighted D10/D50/D90, log-size SD, coarse share, medians and IQRs of contrast, InLens ratio, texture, solidity; area-weighted void fraction, porous and low-solidity shares; type shares if `config/particle_types.json` exists | The v3 particle work, aggregated per image |
| KPIs | `kpi_` | The 15 descriptors of `kpis()` | The v3 whole-image view, kept as its own family so its (lack of) separation stays visible |
| Imaging | `img_` | `imaging()` per channel | Acquisition, not material. In the table, out of the default model |

Rules: no `strip_id`, height, width, `px_um` or XResolution in any feature; `assert_no_leakage()` runs on every table written. Tile size is in µm so nothing depends on image size. Positions are normalised 0–1. Deep features (`qc/deep.py`, the seventh family `deep_`, optional extra): the public `facebook/dinov2-small` checkpoint at a pinned revision, used as is (no fine-tuning), run locally on CPU; no image leaves the machine and no hosted inference is used (v3 §10 Q8 untouched). Not Polaron's HR-Dv2. Per image: InLens only, valid rows, p1–p99 stretch (removes the black-level difference), 2×2 binning, 224 px tiles (~11 µm), CLS + mean patch token per tile, mean and SD over tiles: 1,536 columns. `qc/attribute.py` reduces them to 10 principal components fit inside each training fold before the logistic fit, so reasons read `deep_pc01…10`. The deep family explains *that* images differ, not *how* in µm; the material families and the statistical comparison stay the explanation.

Command: `uv run python -m qc.features` → `out/features.csv`.

### 3.15 Attribution: `qc/attribute.py`

| Step | Rule |
|---|---|
| Model | Standardised, L2-regularised, class-balanced multinomial logistic regression on the material families (`reg, edge, tex, par, kpi`). Features with under 80% finite values or zero variance are dropped |
| Regularisation `C` | Chosen by an inner leave-one-strip-out over {0.01, 0.03, 0.1, 0.3, 1}; ties go to the strongest regularisation |
| Output per image | `p_Batch_1, p_Batch_2, p_Batch_3`, `predicted`, `confidence`, five `reasons` (feature, its z-score against the training mean, its contribution `coef × z` to the predicted class), plus §3.16's distance block |
| Balanced assignment | When the drop is known to be *k* per batch (the nine-image test: *k* = 3), also report the joint assignment with exactly *k* per class that maximises the summed log-probability (Hungarian). Both are shown; the unconstrained one is what an incoming single batch would get |
| Regions | For the top regional driver, a tile heatmap of that quantity on the image (Pat, after the numbers are in) |
| Frozen artefact | `config/attribution_model.json`: features, means, SDs, coefficients, intercepts, `C`, the image ids it was trained on, its own LOSO estimate, and the baseline statistics of §3.16. Readable; no pickles |
| Not allowed | Imaging features in the default model (they can be switched on for an experiment, which is reported as such). Any use of `strip_id` beyond grouping |

Commands: `--evaluate` (§3.17), `--fit`, `--dry-run` (§4), `--images data/<drop> [--balanced 3]` → `out/attribution/<drop>.json`.

### 3.16 Familiarity: in or out of distribution

Attribution forces every image into one of three classes; an unknown batch N must not be forced. So, independently of the classifier:

| Quantity | Rule |
|---|---|
| Baseline statistics | Mean and SD of each model feature over the **strip segments** of Batch_3 (v3 §3.5 unit) |
| z per feature | `(value − mean) / SD`, two-sided. Features with \|z\| ≥ 2 are listed with their direction |
| Distance | RMS of z over the model's features |
| Threshold | For each Batch_3 strip, standardise by the other Batch_3 strips and take the RMS z of its images: the baseline's own held-out distances. The threshold is their maximum. Batch_3 images by construction sit at or under it |
| `unfamiliar` | distance > threshold |

Reading, for an incoming image or batch:

| Attribution | Familiarity | Meaning | Feeds |
|---|---|---|---|
| Batch_3 | not unfamiliar | Inside the promised material's own variation | ACCEPT path (if A agrees) |
| Batch_1 or Batch_2, confident | unfamiliar to Batch_3 | A **known** variation: we have seen this before and can name it | Explanation names the batch and the drivers; verdict from A and δ |
| any | unfamiliar, low confidence or disagreement with the balanced assignment | **Out of distribution**: unlike every known batch | At least INVESTIGATE; the next action is "get more strips" or "ask the supplier about …" |

The same distance against Batch_1 and Batch_2 is a cheap extension (same code, other reference) and gives "nearest known batch by distance" as a cross-check on the classifier.

### 3.17 Evaluation protocol (before anything is trusted or frozen)

All numbers come from `uv run python -m qc.attribute --evaluate` → `out/attribution/evaluation.json`, `feature_ranking.csv`.

| Check | Rule | Pass |
|---|---|---|
| Leave-one-strip-out (LOSO) | Hold out every image of one physical strip across all folders; standardise and choose `C` inside the fold. Per family and for the material set | Balanced accuracy, confusion matrix |
| Permutation null | Shuffle batch labels across **strip segments** (so the null keeps the strip structure), ≥ 200 times, same pipeline | Real accuracy above the null's 95th percentile |
| Shared strips | For strips imaged in more than one folder: were their held-out images attributed to their own folder? | If yes, the model reads material, not strip. If no, say so: those images are genuinely ambiguous |
| Feature ranking | Per feature, on strip-segment means: largest pairwise effect size and LOSO accuracy of a one-feature nearest-mean rule | The top features are what the explanation (A) should talk about; they go into `config/kpi_dictionary.yaml` if not there |
| Imaging alone | Same LOSO with only `img_` | If imaging alone attributes well, say it in the report: the batches also differ in acquisition, and material claims need the material families to beat it |
| Dry run | §4 | Accuracy on 3 held-out images per batch, whole strips held out |

If no family beats its null, we say so and fall back to A only, with the honest statement that the three batches are not distinguishable on strips we have not seen. That is a legitimate (if disappointing) result and better than a leave-one-image-out number.

### 3.18 Showing A–D together

The evidence/UI gets an **Attribution & familiarity** panel beside the verdict, Patrik-owned, fed from `out/attribution/<drop>.json`:

- per image: predicted batch with the three probabilities, the balanced-assignment column when used, the five reasons in units and z, the unfamiliar flag with its distance and threshold, the deviating features with direction;
- per drop: counts per predicted batch, number unfamiliar, the model's own LOSO accuracy and the `fitted_at` stamp (so nobody mistakes a 0.5-accuracy model for an oracle);
- wording follows Rule 7: "looks like", "outside the baseline's range on", "unlike any known batch".

The four audience templates (v3 §3.8) gain one sentence each on B and C. The verdict (D) logic is unchanged; its *next action* mentions an unfamiliar result.

### 3.19 Degradation outlook (optional, after everything above)

Indicative, non-verdict, per batch, from measured quantities only: Si swelling volume at full lithiation vs available pore volume, fracture-prone Si share (large and low-solidity), Si-graphite contact proxy, pore transport proxy. Each with a formula, its inputs, its assumptions and an interval; labelled *indicative*, never "lifetime". `qc/degrade.py`, Pat, only if time permits after the dry run.

## 4. Sync points, updated

| When | What |
|---|---|
| Now | Both read this draft; object within the hour or it stands. Patrik: `baseline: Batch_3` in `config/decision.yaml` (already on `PtrkH/compare-v3`) |
| Sync 1 | `out/features.csv` for all 31 images; `--evaluate` run; the family table and the top features read together. Decide which families go into the frozen model, and whether deep features are needed |
| Sync 2 | Types refit after the new descriptors (`config/particle_types.json` is still provisional). `--fit`; `config/attribution_model.json` committed. Shared-strip check read; `shared_strips` chosen (v3 §3.13) |
| Dry run, 1 h before the drop | `uv run python -m qc.attribute --dry-run`: holds out 3 images per batch, **whole strips where possible**, refits on the rest, predicts, scores unconstrained and balanced. Then refit on everything (`--fit`) |
| Freeze, 30 min before the drop | `git tag rules-frozen` covering `decision.yaml`, `particle_types.json`, `attribution_model.json` |
| Drop | `uv run python -m qc.attribute --images data/<drop> --balanced 3` once; commit `out/attribution/<drop>.json` unchanged. If the drop is a whole batch, also `qc.run` for A and D |

## 5. Steps: Pat (ML)

Done on `pat/ml-v3`: v3 steps 1–4, 6–9 (segmentation, 15 KPIs, particles, types (provisional), imaging, controls, uncertainty). New:

1. **`qc/features.py`** per §3.14, with tests on synthetic fields (done in this draft; review).
2. **`qc/attribute.py`** per §3.15–3.16 with LOSO, null, shared-strip check, ranking, dry run, balanced assignment, JSON model (done in this draft; review).
3. **Run `--evaluate` on the 31 real images.** Fill §12 of this plan with the family table and the top ten features. This is Sync 1.
4. If no material family beats its null: add per-phase texture at a second scale and the depth-profile features at 30 µm tiles; then, and only then, deep features.
5. Tile heatmap for the top regional driver per predicted image (§3.15 Regions).
6. Refit particle types with the new particle descriptors; decide whether `par_type_*` shares help attribution.
7. Put the top features into `config/kpi_dictionary.yaml` with causes, so A's explanations talk about what B found.
8. **Dry run, `--fit`, freeze.**
9. At the drop: `--images --balanced 3`, look at the overlays and heatmaps, change nothing.
10. Evening: strip-leak chart now has a purpose: LOSO vs leave-one-image-out accuracy of the same model, showing why the latter would have fooled us.
11. §3.19 if time permits.

## 6. Steps: Patrik (software)

v3 steps 1–7 stand (`compare()`, evidence contract, provenance). New:

1. `config/decision.yaml`: `baseline: Batch_3` (done on your branch); add `attribution: {families: [reg, edge, tex, par, kpi], balanced: null}`.
2. `qc/schema.py`: additive `Attribution` block in `Evidence` (or a sibling file, your call): per-image rows as in §3.18 plus `model.fitted_at`, `model.loso_balanced_accuracy`. Mirror in `web/src/types.ts`; fixture; `tests/test_contract.py`. Paths `FEATURE_TABLE`, `ATTRIBUTION_DIR`, `ATTRIBUTION_MODEL_PATH`, `attribution_path()` are already in `qc/schema.py` on `pat/ml-v3`.
3. `qc/run.py`: after the tables, if `config/attribution_model.json` exists, call `attribute.predict()` on the batch's feature rows and attach the block. `qc/features.build_features` can reuse the masks `qc.run` already computed (pass `mask=`) to avoid segmenting twice.
4. UI: the Attribution & familiarity panel (§3.18).
5. Provenance: hash `attribution_model.json` with the other configs.
6. Templates: one sentence on B and C per audience.

## 7. Cut list, updated

1. Optional review (v3 §3.10). 2. §3.19 degradation outlook. 3. Deep features. 4. Tile heatmaps (keep the reasons list). 5. Strip-leak chart. 6–9 as v3 items 4–9.

Never cut: §3.14 regional + texture features, §3.17 LOSO + null, §3.16 unfamiliar flag, the frozen JSON model, and everything on v3's never-cut list.

## 8. Open questions for the mentors, updated

v3 Q1 is answered (Batch_3). Q2 still matters more than ever: if the nine held-back images come from strips we have seen, `strip_id` would identify them trivially and we refuse to use it; please confirm that is the intended test. New:

14. Are the held-back images whole new strips, or pieces of the strips we have?
15. Is the designed variation between the batches material (loading, size, porosity, texture) or could it include acquisition (detector settings, FIB prep)? We report imaging separately either way.
16. For "batch N in or out of distribution": is a per-image answer wanted, or per batch (several images)? We give both.

## 9–11. Infrastructure, demo, glossary

v3 stands. Demo shot 1:35–2:00 becomes: drop the nine images, show the attribution panel (probabilities, reasons, heatmap), the balanced assignment, and one unfamiliar example from a positive control.

## 12. Results on the real data (2026-10-03, 31 images, 13 strips, local run)

Three-way attribution, leave-one-strip-out, nested `C`, 200 segment-shuffled permutations:

| Family set | Features | LOSO balanced accuracy | Null p95 | Above null |
|---|---|---|---|---|
| regional | 52 | 0.31 | 0.47 | no |
| edge | 6 | 0.55 | 0.54 | marginal |
| texture | 86 | 0.45 | 0.51 | no |
| particles | 21 | 0.23 | 0.55 | no |
| kpis | 15 | 0.35 | 0.51 | no |
| imaging | 24 | 0.49 | 0.55 | no |
| material (all but imaging) | 180 | 0.45 | 0.49 | no |
| all | 204 | 0.42 | 0.51 | no |

Two-way splits, same protocol (one-off script, not yet a CLI option):

| Question | Family set | LOSO balanced accuracy | Null p95 |
|---|---|---|---|
| Batch_3 vs not (familiarity) | texture | 0.88 | 0.74 |
| Batch_3 vs not | material | 0.85 | 0.69 |
| Batch_3 vs not | imaging | 0.79 | 0.71 |
| Batch_1 vs Batch_2 | texture / material | 0.36 / 0.50 | (chance 0.5) |

- **Dry run** (3 held out per batch, refit): 3/9 correct, both unconstrained and balanced. All 3 Batch_3 held-out images were right, at ≥ 0.99 confidence. Both P2316 images (Batch_1) were flagged `unfamiliar`.
- **Top single features** (`feature_ranking.csv`): ETD/BSE/InLens LBP bins and GLCM energy/homogeneity. Batch_3 has smoother, more homogeneous texture; Batch_1 and Batch_2 sit together. Best single feature: `tex_etd_lbp6`, nearest-mean LOSO 0.79. That number is optimistic because it is the best of 204.
- **Confound:** the leading texture features correlate with imaging descriptors (|r| 0.6–0.9 with `img_bse_noise` and `img_bse_p1`). Batch_3 was also imaged with a different InLens black level (7.0 against 0–0.7). Part of the Batch_3-vs-rest signal may be acquisition rather than material.
- **Shared strips:** no family set consistently places the images of a shared strip into their own folders.

Reading: the current features can say "looks like the promised Batch_3, or not", at about 0.85 against a null of about 0.70, with the acquisition caveat above. They cannot yet tell Batch_1 from Batch_2. The nine-image test needs that, so the designed B1/B2 signal is still missing from the feature set.

### 12.1 Deep features (`qc/deep.py`, InLens DINOv2-small, 10 PCs per fold)

| Check | Result |
|---|---|
| Three-way LOSO, nested `C` (`loso_cv(df, ("deep",))`) | 0.64; Batch_1 3/7, Batch_2 5/7, Batch_3 13/17 |
| Same, fixed `C` = 0.1 (exploration) | 0.68 |
| Selection-aware null: best of 6 deep settings per shuffle, 100 segment shuffles | p95 0.60, p99 0.67 |
| Batch_1 vs Batch_2 alone (exploration) | 0.57 against a null p95 of 0.71: not separable |
| Dry run `--families deep` (same 9 images as §12) | 6/9 unconstrained, 3/9 balanced; every probability about 0.34 because the inner CV picks `C` = 0.01 |

Reading: the deep family is the first one above its null for the three-way question, and Batch_2 has a fine-scale InLens look of its own. Batch_1 is still confused with the other two (strip 2316 reads as Batch_3), and the near-uniform probabilities mean any single call is weak. In the full `--evaluate` run (nested `C`, 200 segment shuffles per set; the other eight sets are unchanged from §12): `deep` 0.64 against a per-set null p95 of 0.54; `deep+material` (1,716 features) 0.46 against 0.50, so adding the material families to the deep ones dilutes them.

## 13. Evidence for the new decisions

- Leave-one-strip-out, not leave-one-image-out: v3 [R5] and the 0.49 → 0.35 drop recorded in AGENT_HANDOVER §2.3.
- Permutation null over segments: same logic as v3 §3.5's segment-label shuffle; the null must keep the dependence structure of the data.
- Regularised linear model over trees or deep classifiers at n = 31: coefficients are the explanation; nothing to tune but `C`; the result is a readable JSON.
- Familiarity as a two-sided RMS z against the baseline's segments with a self-calibrated threshold: the simplest "unlike anything in the baseline" rule that uses the same unit (strip segment) as the comparison. Mahalanobis is not estimable with 7 segments and 170 features.
- Balanced assignment: the nine-image test states its prior (three per batch); using it is legitimate, hiding it is not, so both are reported.

## 14. What stands from v3 unchanged

§1.1 data audit, §1.2, §3.1 contract, §3.2 segmentation and descriptors, §3.3 imaging check, §3.4 particle types, §3.5 batch comparison and verdict, §3.6 uncertainty, §3.7 controls, §3.8 explanation, §3.9 infrastructure, §3.10 optional review, §3.11 provenance, §3.13 shared strips, §7 tools, §8 demo (except the last shot), §11 glossary, §12–13 evidence and references. §3.12 training policy is replaced by Rule 2 above.
