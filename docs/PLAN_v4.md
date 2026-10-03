# Track 4 · Batch QC for electrode microstructure: Plan v4

Team Batch Size 2. ML: Pat. Software: Patrik. State: 3 Oct 2026, 21:00.

This is the only plan. It contains everything that still holds from PLAN_v0 to v3 (now deleted; they are in git history), the changes made after the task designer's clarifications of 3 Oct, and what has been built and measured since. Sections 1 to 3 keep the section numbers of v3, so older references such as "§3.5" still point at the right place. **What to do next is in §4.** Results on the real data are in §12, the glossary in §11, the evidence for each decision in §13, references in §14.

Written on Pat's side; Patrik has agreed to it (3 Oct).

## In short

The task designer told us how the entry is judged:

> Treat Batch 3 as the baseline, it's what's been "promised" by the supplier. Batch 1 and 2 arrived subsequently, and we're trying to tell if they are different. They are not explicitly better or worse than the Batch 3 baseline, but they show the types of variation we need your models to pick up on. The judging criteria reflects this; can you identify what's different about the batches, and thus categorise the held back samples correctly. If you can, this implies unknown batch N could be categorised accurately as in or out of distribution — helping manufacturers make critical decisions about when to accept and reject a batch.

The tool answers four questions and shows them apart:

| # | Question | Answer | Where |
|---|---|---|---|
| A | **What is different** about a batch against the Batch_3 baseline? | Per quantity: difference in units, interval, p, two-sided (above or below the baseline), driver ranking | §3.5 |
| B | **Which known batch** does an unseen image look like? | Always a batch, with probabilities, a confidence tier with its record, a prediction set, and reasons in plain language | §3.15 |
| C | **Is it inside the baseline's distribution** at all, or unlike anything we have seen? | Two-sided z-scores against Batch_3, an RMS distance, an *unfamiliar* flag | §3.16 |
| D | **Accept, investigate or reject** this batch? | A verdict from plain statistics and a customer tolerance, with the next action | §3.5 |

- **Input:** a folder of FIB-SEM cross-section images (three detector files per sample), plus the baseline (Batch_3).
- **Measurements:** brightness thresholds split each image into pore, graphite, silicon and binder; we measure the phases and every silicon particle (§3.2).
- **Comparison and verdict (A, D):** plain statistics on the measured tables. Nothing trained decides the verdict.
- **Attribution (B, C):** the only trained piece. A regularised logistic regression on named features or on principal components of frozen DINOv2 image features, scored only on strips it never saw, frozen as readable JSON.
- **Explanation:** templates filled from the numbers, for four audiences (§3.8).
- **Provenance:** every result records which images, code and settings produced it (§3.11).

Where we stand (§12): "Batch_3 or not" is right for 24–26 of 31 held-out images. The three-way call reaches 0.64 against a null of 0.54. Batch_1 against Batch_2 is not separable with anything that survives a fair null. The first unseen images have arrived and are not scored; the model is not frozen (§4).

## 1. Ground truth from the task designer and the mentors

| Fact | Consequence for us |
|---|---|
| Anode. Bright white = silicon, darker grey = graphite, black = pore | Phase codes in §3.2 |
| The bright particles are silicon (confirmed 3 Oct). "The content % is for you to figure out" | Silicon content is reported as a percentage (§3.8). Whether the bright material is Si or SiOx stays our hypothesis (§3.4) |
| Si:graphite ratio, particle size distribution and the pore network drive battery performance | These are the key descriptors (§3.2). The silicon key quantity is `si_graphite_ratio` |
| Particles about 30 µm across | Most likely the graphite. Si particles are a few µm. Sanity check for `graphite_chord_um`; **not** a check for Si sizes |
| ~20 images ≈ £50k; deliberately tiny; realistic for a manufacturer | Statistics must be honest at 7–17 images and 3–7 strips per batch. Use the ~4,000 silicon particles, but never as independent samples (Rule 8) |
| FIB-SEM: Ga-ion beam cross-section; expect artefacts such as curtaining | `imaging()` checks for curtaining (§3.3) |
| Batch_3 is the promised material; Batch_1 and Batch_2 arrived later | `baseline: Batch_3`. Every "different" is relative to Batch_3 and **two-sided** |
| Batch_1 and Batch_2 are "not explicitly better or worse" | Rule 7: no verdict for Batch_1 or Batch_2 is "correct" by design. A, B and C are judged; D is our value-add with a customer tolerance |
| They "show the types of variation we need your models to pick up on" | The variation is designed. Material feature families drive B; imaging descriptors are reported apart and stay out of the default model (§3.15) |
| The baseline is not necessarily defect-free; "there's a lot of complex morphology features to examine" | Wording is "differs from the baseline", never "defective". Many descriptors, not one defect detector |
| **The images are real; the batches are not physical deliveries.** They were sampled from one of the organisers' datasets and "backward engineered" to create the task. There is "usually some pattern that clusters the samples in a batch together" | Strips do not define batches and are never features. Images cut from one strip are still correlated, so accuracy is estimated with whole strips held out (Rule 10). Adjacent tiles in different folders are expected (§1.2) |
| Judged on categorising the held-back samples, with the confidence and the explanation | B is the deliverable that is scored. It gets an honest accuracy estimate (§3.17) and a rehearsal (§4) |
| Every image must always be assigned to a batch. The system may be very unsure, but it takes a bet (3 Oct, 16:46) | Rule 11 |
| "Unknown batch N could be categorised as in or out of distribution" | C: inside the baseline's own spread; a *known variation* (outside it but matching Batch_1 or Batch_2); or *unfamiliar* (§3.16) |
| Important features may sit in different regions of the image | Regional (tiled) descriptors with spread and depth-profile summaries; the ignored top and bottom bands measured separately (§3.14) |
| A manufacturer is wary of anything too far outside the baseline's standard deviation, in either direction | Differences are stated in baseline-SD units next to physical units |
| Explainability above almost everything; engineers must explain it to their boss | Every verdict and every attribution names its drivers in units |
| An LLM gave good image descriptions but could not group batches or carry explanations over | No language model is in the pipeline today. The rule that forbade one was dropped on 3 Oct (§2, Rule 3) |
| Asked for: a comparison UI for two batches; extra: how the material would wear and degrade | `docs/APP.md` features 2 and 6; §3.19 |

### 1.1 Data audit (all 93 files of the three known batches)

| Check | Result | Consequence |
|---|---|---|
| Size of the data | 31 samples: Batch_1 = 7, Batch_2 = 7, Batch_3 = 17. About 4,000 silicon particles | BSE is the main channel for measurements |
| Completeness, alignment | Every sample has BSE, ETD (or `SE`) and InLens; the three images have identical sizes; all 8-bit | Nothing to repair. `SE` is an alias for `ETD` |
| Strips | The samples are tiles cut from 13 longer strips. `strip_id` = `"<height>_<round(XResolution)>"`, e.g. `2316_1015998` | Used for grouping only: held-out evaluation and the gallery. Never a feature |
| Coloured stitch columns | 13 samples have 1–4 px of coloured columns at the left or right edge, in all three detectors | The 8 px crop in `qc/io.py` removes all of them |
| Black level | 0 everywhere except the four P2060 images in Batch_3: 22–23 in BSE, 19 in ETD, 13–17 in InLens | Black level subtracted per channel (0.5th percentile). P2060 is an imaging outlier inside the baseline (§3.3) |
| InLens saturation | 26 of 31 samples have more than 1% of pixels at 255, up to 6.8% | No brightness descriptor from raw InLens; saturated pixels count as unknown |
| Top-to-bottom shading | InLens top/bottom brightness ratio median 1.22, up to 1.92. BSE 0.79–1.22 | InLens only as a local ratio (§3.2). BSE is not flattened: its gradient may be real structure through the thickness |
| Padding, info bars | None | Nothing to crop |
| Overlap between neighbouring tiles | None (best edge match r ≤ 0.28) | No area is counted twice. Tiles of one strip are still not independent |
| Pixel size | 0.025 µm everywhere; tag differences about 0.002% | No resampling. Every size is in µm |
| Three kinds of silicon particle by eye | Small dense bright (most strips); larger and dimmer (`4ih2ggld`, `5n1q8atc`, strip P2316 in Batch_1); porous inside (`x7u69zsw`, `tuy3zymq`, `kbdh4tri`, `71vgq3fw`, strip P2060 in Batch_3) | Particle types (§3.4). The designer confirmed silicon and left the rest to us |
| Normalising between images | The designer (3 Oct): the operator normalised "as best as possible"; "preprocessing is up to you". Today: black-level subtraction for the measurements and named textures; a p1–p99 stretch for the deep features only | Grey levels are roughly comparable, not calibrated. Normalising the named textures the same way is allowed and is tested before the freeze (§4 step 2). Earlier plans ruled normalisation out; that no longer holds |

### 1.2 Where the variation lives (real measurements, 3 Oct)

**Strip layout** (strip = image height):

- In more than one batch: 2080 (Batch_1, 2, 3), 2068 (2, 3), 2272 (2, 3), 2148 (1, 2), 2156 (1, 2).
- In one batch only: Batch_1 has 1780, 1880, 2316; Batch_2 has 2048; Batch_3 has 1612, 1904, 2060, 2088.

| Folder | Images | Strips | Images from strips found only in this folder |
|---|---|---|---|
| Batch_1 | 7 | 6 | 4 of 7 |
| Batch_2 | 7 | 6 | 2 of 7 (P2048). The other 5 are neighbours of images in Batch_1 or Batch_3 |
| Batch_3 | 17 | 7 | 12 of 17 |

Some images in different folders join edge to edge (`cfe5vt7s` in Batch_3 → `r17byphk` in Batch_2 → `ffwubibz` in Batch_1). The designer's answer: the batches were assembled from one dataset on purpose (§1). So the folders are not separate deliveries, and the earlier question of counting shared strips twice is closed.

**Per batch, mean ± SD over images:**

| Quantity | Batch_1 | Batch_2 | Batch_3 (baseline) |
|---|---|---|---|
| Silicon content, area % of the analysed image (`si_area_frac`) | 8.3 ± 3.7 | 5.7 ± 1.2 | 6.2 ± 1.1 |
| `si_graphite_ratio` | 0.105 ± 0.054 | 0.067 ± 0.015 | 0.075 ± 0.014 |
| `si_d50_um` | 4.41 ± 0.70 | 3.97 ± 0.38 | 3.66 ± 0.63 |
| `si_internal_void_frac` | 0.0048 ± 0.0053 | 0.0018 ± 0.0017 | 0.0026 ± 0.0015 |
| `si_contrast_ratio` | 1.91 ± 0.23 | 2.13 ± 0.16 | 2.09 ± 0.14 |
| `porosity_apparent` | 0.088 ± 0.016 | 0.099 ± 0.015 | 0.107 ± 0.018 |

- **Most variation sits between strips, not between batches.** For `si_graphite_ratio`: 21% between batches (6% without strip 2316), 72% between strips, 7% between images of a strip.
- **Batch_1's higher silicon is almost all strip 2316** (12–15 area % against 4–9% everywhere else). Without it Batch_1 sits at 6.3%, the same as the others. Its silicon is also dimmer and coarser.
- **Silicon content does not sort the batches.** The 15 whole-image descriptors score 0.35 with strips held out (null 0.51, §12).

### 1.3 The unseen images (state on 3 Oct, 21:00)

| What | State |
|---|---|
| What we were told earlier | Nine held-back images, three per batch, to sort into the known batches. Then, at the presentation, 2 images: "which batch do they belong to, and WHY" |
| What arrived (3 Oct, 16:39) | Folder `Hackathon-Polaron-test`: 9 files, which is **3 samples** (`3e122cbj`, `fn0mhxef`, `xrv9xvzb`), each with BSE, ETD and InLens |
| The designer's reply (3 Oct, evening) | The unseen set has "dropped, with further images coming just before the judging" |
| Our reading | The 3 samples are the drop; "nine" most likely counted files. More images come shortly before judging. How many, and how they split across batches, is not known |
| Same detectors and format | Confirmed: "all the same detectors". Pixel size was not mentioned; every feature is in µm and reads the pixel size from the file |
| Status | Not opened: only the file names have been listed. Not yet linked into `data/`. Not scored. They stay unseen until the model is frozen (§4) |

Consequences:

- The balanced assignment (§3.15) was worth about +0.15 in rehearsals with three per batch. With 3 samples and an unknown split it cannot be relied on. The unconstrained call is the answer.
- The images that come just before judging leave no time to refit or tune. The path must be one command on a frozen model, rehearsed for speed (§4 step 7).

### 1.4 Our five questions and the replies (3 Oct, evening)

| We asked | Reply | New? | Consequence |
|---|---|---|---|
| Is Batch_1 the baseline? Is there ground truth for the other two? | "Batch 3 confirmed" | No | None. There is no acceptable/defective label (§1) |
| Adjacent tiles sit in different folders. Intended? One physical batch per folder? | The batches are sampled from one dataset; the images are real, the samples "backward engineered" | No | As §1. One dataset also makes a designed *microscope* difference between batches unlikely (our inference, §10 Q15) |
| When does the unseen batch drop, and how is it scored? Does "investigate" count? | "Dropped, with further images coming just before the judging" | **Yes** | §1.3. The scoring questions were not answered; Rule 11 covers them |
| Is the material graphite with a silicon additive? What is the nominal Si material? | "Yes — that's si, but the content % is for you to figure out" | Partly | Report silicon content as a percentage (§3.8). The three particle kinds stay ours to work out |
| Same detectors, pixel size and prep? Are grey levels uncalibrated? | "All the same detectors, everything's normalised as best as possible by the user; preprocessing is up to you" | **Yes** | Normalisation between images is allowed (§1.1); test it before the freeze (§4 step 2) |

## 2. Rules

1. No Polaron models or tools, including their open-source HR-Dv2, ImageRep and TauFactor, until the mentors say otherwise (§10 Q10).
2. **A classifier on batch labels is allowed only for attribution (B).** It must be: linear or nearest-centroid on named, unit-bearing features, or on principal components of frozen pretrained image features (`deep_`) provided every reason is translated into the named features it moves with (§3.15); evaluated leave-one-strip-out with a permutation null before it is trusted; frozen as readable JSON; and reported with the features that drove each prediction. It never produces the verdict, never touches a KPI value, and never uses `strip_id`, image dimensions, `px_um` or XResolution (§3.14 enforces this in code). *Before 3 Oct this rule was "no classifier trained on batch folders".*
3. **Dropped (3 Oct).** It read: the report is built from measurements and templates; no language model measures, decides or explains. A language model may now be used. As built today, `qc/explain.py` fills its texts from templates and no language model is in the pipeline.
4. The frozen verdict path runs on a laptop with no network.
5. **Dropped (3 Oct).** It read: images stay on our machines until Polaron says otherwise. Images may now be sent to external tools. As built today, everything runs locally, including the deep features.
6. `config/decision.yaml`, `config/particle_types.json` and `config/attribution_model.json` are not edited after the `rules-frozen` tag.
7. **"Different" is not "bad",** and *attributed to Batch_1* is not "bad" either. Wording: "looks like Batch_1 (p = 0.8), because …", "outside the baseline's range on …", "differs from the baseline", never "defective". A customer tolerance decides what matters.
8. Particles and images are never treated as independent samples. For accuracy estimates the unit is the strip. For the verdict the image is the unit and the strip view is computed beside it (§3.5).
9. Every evidence file records the SHA-256 of each input image, the git commit and a hash of the config (§3.11). The same inputs give the same evidence file, apart from its timestamp.
10. The attribution model is scored on strips it never saw. Leave-one-image-out numbers are not reported anywhere.
11. **Every image is always assigned to a batch,** with a confidence and an explanation (task designer, 3 Oct 16:46). No output of B is "not enough evidence": *unfamiliar*, a low tier and a wide prediction set say how weak a call is, and none of them replaces it.

## 3. Pipeline

```
Field ─ segment ─ mask ─┬─ kpis(), particles(), imaging()  ──► out/kpis.csv, particles.csv, imaging.csv ─► compare() ─► evidence (A, D)
                        └─ features.py (+ deep.py): regional, edge, texture, particles, kpi, imaging, deep ─► out/features.csv
                                                                        │
                                   attribute.py: LOSO evaluation ───────┤──► out/attribution/evaluation.json, feature_ranking.csv
                                                fit ────────────────────┤──► config/attribution_model.json (frozen)
                                                predict on a folder ────┴──► out/attribution/<drop>.json  (B, C)
```

How each module works, every command and every output file: [README](../README.md). What consumers of the ML outputs can rely on: [AGENT_HANDOVER.md](AGENT_HANDOVER.md).

### 3.1 Contract

`qc/schema.py` is the contract between the ML side and the software side. Adding a field or KPI is fine; renaming, removing or changing a unit needs both owners.

| Stage | Function | Where | Owner | Status |
|---|---|---|---|---|
| Load | `load_field` → `Field` | `qc/io.py` | shared | built |
| Segment | `segment(channels, px_um)` → full-resolution mask | `qc/measure.py` | Pat | built |
| Image descriptors | `kpis(mask, px_um, channels)` → dict | `qc/measure.py` | Pat | built, all 15 |
| Particle table | `particles(mask, px_um, channels)` → one row per Si particle | `qc/measure.py` | Pat | built |
| Particle types | `fit_types`, `assign_types`, `type_shares` | `qc/types.py` | Pat | built; the fit is provisional |
| Imaging check | `imaging(channels)` → dict per channel | `qc/measure.py` | Pat | built |
| Controls | `make_controls`, `iter_controls`, `shared_strip_controls` | `qc/controls.py` | Pat | built; not yet fed into the verdict |
| Uncertainty | `threshold_variants`, `integral_range`, `area_needed` | `qc/uncertainty.py` | Pat | built |
| Features | one row per image in named families | `qc/features.py`, `qc/deep.py` | Pat | built |
| Attribution | evaluate, fit, predict, rehearse | `qc/attribute.py` | Pat | built; model not frozen |
| Run | `run()` calls the above, writes `out/` | `qc/run.py` | shared | built |
| Compare | `compare(ref: Tables, batch: Tables, cfg)` → `Evidence` | `qc/decide.py` | Patrik | built |
| Explain | `explain(evidence, dictionary)` → four texts | `qc/explain.py` | Patrik | built |
| Provenance | input hashes, git commit, config hash | `qc/provenance.py` | Patrik | built |
| Show | API and web UI | `qc/api.py`, `web/` | Patrik | built; new attribution fields not shown yet (§6) |
| Review | `review(evidence)` → observations (§3.10) | `qc/review.py` | Patrik | not built; first on the cut list |

Interface decisions:

- `Tables` = `NamedTuple(kpis, particles, imaging)` of DataFrames filtered to one batch.
- `TypeModel` is a plain dict (feature means and SDs, cluster centres, covariances, names, unassigned threshold), saved as `config/particle_types.json`. `fit_types` runs only before the freeze; `run()` only calls `assign_types`.
- `Control` = `dataclass(name, kind, expected_driver, source_strips, fields, kept_in_reference)`. `kept_in_reference` holds image ids.
- `segment()` returns a full-resolution `uint8` mask of pure phase codes. Hole filling and watershed splitting happen in `label_si()` at measure time, so area fractions are not altered by split lines. Thresholds are an optional argument so the segmentation uncertainty can rerun it with offsets.
- The attribution JSON is not part of `Evidence`. The API serves Pat's files as written.

| Output | Rows |
|---|---|
| `out/kpis.csv` | One per image: `batch, image_id, strip_id, px_um, area_um2`, the 15 descriptors |
| `out/particles.csv` | One per Si particle: `batch, image_id, strip_id, particle_id, d_um, area_um2, contrast_ratio, inlens_ratio, void_frac, texture, solidity, border, type, y_px, x_px` |
| `out/imaging.csv` | One per image and channel |
| `out/features.csv` | One per image: about 200 named features, plus the `deep_` columns when the extra is installed |
| `out/masks/<batch>/<image_id>.png` | Overlay |
| `out/crops/<type>/<n>.png` | Example particle crops per type |
| `out/evidence/<batch>.json` | The comparison and everything behind it, including provenance |
| `out/attribution/<drop>.json`, `evaluation.json`, `feature_ranking.csv` | Attribution per run; the evaluation; the feature ranking |

A descriptor that cannot be computed, or an image whose segmentation crashes, is NaN. The run never stops on one bad image.

### 3.2 Segmentation and descriptors

Phase codes: `PORE` 0, `GRAPHITE` 1, `SI` 2, `BINDER` 3, `IGNORE` 255.

| Step | What |
|---|---|
| Before | Subtract the black level (0.5th percentile, per channel). Gaussian σ = 1 px. Work at 2× downsample. Top and bottom 5% of rows → `IGNORE`. InLens pixels at 255 → unknown |
| Threshold | 3-class multi-Otsu per image (pore / graphite / Si) |
| After | Opening on Si. Si objects under 0.25 µm² → graphite. Thin bright rims along graphite edges (width < 0.15 µm) → `BINDER`. Si objects with median BSE below 1.5× the graphite mode → `BINDER` (`SI_MIN_CONTRAST`; added after the P2316 overlays showed binder and surfaces seen through pores labelled as Si). Particles touching the image border are flagged `border` and left out of size statistics. The mask is upsampled to full resolution |

Acceptance: two overlays per strip checked by eye. There is no hand-labelled check yet (§5).

**Image descriptors.** Key = counts towards the verdict. The key set is small because every key descriptor costs test power.

| Group | Name | Definition | Key |
|---|---|---|---|
| Silicon | `si_graphite_ratio` | Si px / graphite px: the recipe ratio the designer named. Does not move when porosity changes | **yes** |
| Silicon | `si_area_frac` | Si px / non-ignored px | (report; shown as the silicon content %, §3.8) |
| Silicon | `si_d50_um` | Area-weighted median equivalent diameter, non-border particles | **yes** |
| Silicon | `si_d90_um` | 90th percentile of the same | |
| Silicon | `si_internal_void_frac` | Dark px inside filled Si particles / filled area | **yes** |
| Silicon | `si_contrast_ratio` | (Si mode − black) / (graphite mode − black) | **yes** (unused if imaging changed) |
| Silicon | `si_fragments_per_1e4um2` | Si objects under 1 µm per 10⁴ µm² | |
| Arrangement | `si_dispersion_cv` | CV of local Si fraction over 20 µm windows | |
| Arrangement | `si_agglomerate_frac` | Share of Si area in Si-rich domains larger than 5 µm | (report) |
| Arrangement | `si_corr_length_um` | Distance at which the Si two-point correlation falls to 1/e of its excess: typical Si cluster size | |
| Graphite | `graphite_chord_um` | Mean horizontal run length of graphite, runs touching the border excluded | |
| Graphite | `graphite_anisotropy` | Horizontal / vertical run length | (report only; curtaining-sensitive) |
| Pores | `porosity_apparent` | Pore px / non-ignored px | **yes** (unused if imaging changed) |
| Pores | `pore_chord_um` | Mean run length of pore px | |
| Pores | `pore_connectivity` | Share of pore area in the largest connected pore cluster. 2D and apparent | (report) |

Plus **type shares** (§3.4) as key quantities (`key_type_shares`).

**Particle table.** Per Si particle: equivalent diameter (`d_um`), area, brightness ratio to graphite with black removed (`contrast_ratio`), internal void fraction (`void_frac`), **texture** (SD of BSE inside the particle at full resolution, divided by its mean), `solidity`, **`inlens_ratio`** (mean InLens inside the particle / mean InLens of the graphite in a 1–3 µm ring around it, black-corrected, pixels at 255 left out), a `border` flag and the centroid. The local graphite reference cancels the top-to-bottom InLens shading (§1.1).

Resolution limit we state: at 25 nm/px and a 0.25 µm² minimum, Si below about 0.5 µm is not counted as particles. Nano-Si (about 100–200 nm in many anodes [R15, R21]) shows up only in `si_area_frac`, `si_graphite_ratio` and agglomerates.

Not measured yet: porous silicon as its own quantity, cracks inside particles, binder amount, and porosity split into "between particles" and "inside particles" (§5).

### 3.3 Imaging check

`imaging(channels)` per channel: black level, 1/50/99th percentiles, noise (MAD of a high-pass), sharpness (variance of Laplacian), saturated fraction, and **curtaining index** (power of column-mean brightness variation at periods 0.2–5 µm, relative to row-mean variation).

- If a batch's imaging values lie outside the baseline's range, the report says "imaging changed", and `si_contrast_ratio` and `porosity_apparent` are reported but not used for the verdict. The range is min–max over the baseline images, widened 10% with a per-metric floor (`imaging_min_pad`), so a metric that is constant in the baseline does not flag a one-grey-level change.
- The range is built only from baseline images whose own imaging is ordinary. An image whose black level in any channel is more than 10 grey levels from the baseline median is left out and listed as "imaging outlier in the reference". On the current data that is the four P2060 images.
- Curtaining: when `curtaining_max` is set, a BSE curtaining index above it blanks the run-length descriptors. It is `null` (off) until the threshold is set from the real distribution.

### 3.4 Particle types and unseen situations

- **Fit** (before the freeze, on all known batches): standardise `log d_um, contrast_ratio, inlens_ratio, void_frac, texture, solidity`; Gaussian mixture with k = 2, 3, 4. Pick k by **leave-one-strip-out stability** (adjusted Rand index of assignments against the full fit), not by BIC alone. Merge types that differ only in size. Name each from its defining feature in units.
- **Assign** (every run): nearest type by Mahalanobis distance. Further than the 99th percentile of training distances → `unassigned`.
- **Type share** per image = Si area of that type / all typed Si area.
- **New particle type**: unassigned > `new_type_share` (5%) of a batch's Si area → REJECT with "contains a particle type not seen before" and example crops (INVESTIGATE if imaging changed, because the type features are brightness-based).
- **Image unlike anything seen**: now §3.16 (*unfamiliar*).
- **State of the fit (not frozen):** k = 2. T1 bright and dense (2.1× graphite, 65% of Si area); T2 dimmer and grainier (1.7×, 35%). Strip 2316 is 99% T2. 148 of 3,713 particles are unassigned. The porous particles of strip 2060 did not get their own type; the fallback is a rule-based "porous" type (`void_frac` > 0.1, `--porous-rule`). Both automatic names came out "mid, grey" and need renaming.
- Naming hypothesis to check with a mentor: the "larger, dimmer" type may be SiOx. Commercial anodes use graphite–SiOx blends [R19], and SiOx is darker in BSE. Never name it SiOx in the report without confirmation (EDS).

### 3.5 Batch comparison and verdict (A, D)

Pure statistics on the KPI, particle and imaging tables in `qc/decide.py`; it never sees pixels. The full algorithm, the verdict precedence and every config key are in the README under "Decision algorithm".

**Unit.** The **image** is the unit that drives the verdict (mentors, 3 Oct: the batches are synthetic groupings, so strips do not define them). The **strip** view (one value per `strip_id`, area-weighted over its images) is computed beside it and reported in `other_unit`. A key quantity that is DIFFERENT at one unit and SIMILAR at the other is a contradiction and gives INVESTIGATE, because images of one strip are correlated and an image-level p can be too small.

**Fingerprint of one batch:** descriptor values with intervals, by-strip values for the gallery, and particle-type shares.

**Difference from the baseline**

| Step | Rule |
|---|---|
| Difference | Batch mean − baseline mean over the unit values, in units, with a 90% t-interval (pooled SD, n1 + n2 − 2 degrees of freedom), as in the FDA tier-1 method [R7] |
| Test | Statistic `T = difference / s`. Shuffle the labels between batch and baseline (exact enumeration if ≤ 5,000 arrangements, else 5,000 seeded draws). Family-wise p per key quantity from the max-\|T\| across all used key quantities [R6] |
| Margin `δ` | Customer tolerance per quantity (`margins`) if given; else `similar_margin` × SD of the baseline's image values. Start at 1.5, the FDA tier-1 convention [R7] |
| Status | DIFFERENT: p < `alpha` and \|difference\| > δ. SIMILAR: the interval lies within ±δ. UNCLEAR: otherwise |
| Drivers | Used key quantities ranked by \|difference\| / δ |
| Odd units | A batch image or strip outside baseline mean ± `odd_sd` × SD on a used key quantity is listed, and triggers INVESTIGATE at the driving unit (the FDA tier-2 quality range [R7]) |
| Power limit | Smallest achievable p ≥ `alpha` (2/N for equal unit counts, else 1/N, N = number of arrangements) → no quantity can be DIFFERENT; the next action says how many more units would allow it |

**Verdict**

| Verdict | Condition |
|---|---|
| REJECT | A key quantity DIFFERENT and not contradicted by the other unit, or a new particle type present |
| INVESTIGATE | Controls failed, anything UNCLEAR, imaging changed, an odd unit, a contradiction between units, or the power limit hit |
| ACCEPT | Every key quantity SIMILAR, nothing above fired |

`reasons` lists every trigger that fired. The next action is computed: REJECT names the top driver and the supplier check from the KPI dictionary; INVESTIGATE says how many more units would settle the top UNCLEAR quantity. With 3–7 strips, INVESTIGATE is the normal answer for the strip view; per image there are 7–17 units.

Removed since v3, with the reason: the two-level bootstrap (replaced by the t-interval); the shared-strip variants (§3.13); nearest batch, image groups and variance split (attribution replaces them).

**Config** (`config/decision.yaml`): `version`, `data_dir`, `baseline` (`Batch_3`), `reference_exclude`, `unit` (`image`), `key_descriptors`, `key_type_shares`, `imaging_sensitive`, `imaging_black_outlier`, `imaging_widen`, `imaging_min_pad`, `curtaining_max`, `curtaining_sensitive`, `ci_level` (0.90), `alpha` (0.10), `similar_margin` (1.5), `margins`, `new_type_share` (0.05), `n_resamples` (5000), `seed`, `odd_sd` (3.0).

### 3.6 Uncertainty and how many images are enough

- Sampling: t-intervals and the label-shuffle test over images, with the strip view beside them (§3.5).
- **Expected sampling spread from one image:** integral range of the Si and pore phases from each image's two-point correlation [R10, R11]. It predicts the phase-fraction SD for a given imaged area. Built (`integral_range`, `area_needed`), as the angular integral of the radial correlation truncated at the first zero crossing.
  - Observed strip-to-strip spread ≈ predicted → the batch is uniform and the spread is just sampling.
  - Observed ≫ predicted → real heterogeneity inside the batch; say so.
  - Also gives the image area needed for a target precision: the £50k question answered from the baseline alone.
  - We implement the classical estimator ourselves (Rule 1: ImageRep comes from Polaron's founders [R11]).
- Segmentation: rerun with thresholds ±5 grey levels on the baseline (`threshold_variants`). Measured on Batch_3: `si_graphite_ratio` moves 0.0057, `si_d50_um` 0.21 µm, `porosity_apparent` 0.021.
- Imaging: the negative controls (§3.7).
- **How many images are enough:** subsample strips and images, rerun the comparison, plot "probability of the correct status" against the number of images. An app feature (`docs/APP.md` feature 8); not built.
- Limit we state: with 7–17 images from 3–7 strips per batch the intervals are coarse, and we say so.

### 3.7 Controls

Built from baseline images and compared against the **baseline minus the source strips**, so a control is never compared with itself. Each control batch uses images from at least 2 baseline strips.

| Kind | Change | Must come out |
|---|---|---|
| Negative | Brightness ±20%, contrast ±20%, black level +20, Gaussian noise σ = 5, synthetic curtaining stripes | Not DIFFERENT (no false REJECT) |
| Positive | Si particles copied in from other baseline images (+50%, +100% Si fraction) | DIFFERENT, driver `si_graphite_ratio` |
| Positive | Voids punched into 30% of Si particles | DIFFERENT, driver `si_internal_void_frac` or porous share |
| Positive | Si particles scaled up 1.5× (thinned to 1/2.25 of the eligible set, so it tests size, not amount) | DIFFERENT, driver `si_d50_um` |

Measured on Batch_3 (`out/controls/summary.csv`): the seven negative controls move `si_graphite_ratio` by at most 0.6%. Si +50% / +100% give +49% / +101%. Punched voids raise the void fraction from 0.003 to 0.073. Scaled particles raise D50 by 59%. Side effect: the Si-paste controls also lower D50 (3.9 → 2.9 µm), because the pasted donors are small.

Open: the controls are built and measured but do not reach the verdict yet (`controls.passed`); wiring them into `run()` is on Patrik's list (§6).

### 3.8 Explanation

One result, four texts, all filled from the evidence and `config/kpi_dictionary.yaml` by templates in `qc/explain.py`. Two rules: every number in a text comes from the evidence file, and causes are always worded "possible causes to check".

| Audience | Gets | Example |
|---|---|---|
| Factory operator | Traffic light, one sentence, one action | "Batch differs from the baseline. Hold it and call the process engineer." |
| Process engineer | The drivers in units against the baseline, possible causes to check | "Silicon to graphite is 0.27 against 0.09 in the baseline, and the median silicon particle size is 4.1 µm against 3.2 µm. Check the formulation ratio and the silicon powder lot." |
| Materials scientist | Distributions, particle-type gallery with definitions, intervals, method and limits | Size distribution overlay; type shares with intervals |
| Manager | Same or different, how sure, what it costs to be surer, what it means for the cell | "Different from the baseline, driven by the silicon additive: more capacity, but more swelling." |

`config/kpi_dictionary.yaml`, per descriptor and per particle type: plain name, unit, meaning, why it matters for the cell, possible causes when higher or lower, what to check at the supplier. Pat's draft exists; a mentor has not reviewed the causes, and its `particle_types:` section is empty until the types are named.

**Silicon content as a percentage (new, from the designer's reply).** Report per batch, with its interval: silicon as area % of the analysed image (`si_area_frac`) and as a share of the solid (Si / (Si + graphite + binder)). Say what it is: an area fraction, which estimates the volume fraction. Silicon (2.33 g/cm³) and graphite (about 2.26 g/cm³) have nearly the same density, so the share of the solid is also close to a weight %, as an indication only. State next to it that it does not sort the batches (§1.2). Not built.

**Indicative consequences.** For the drivers, "why it matters" carries a range computed from the measured difference with textbook relations:

| Quantity | Relation | Assumptions shown with it |
|---|---|---|
| Capacity | Silicon share of the solid × specific capacity | Graphite about 372 mAh/g; Si about 3,600 mAh/g, SiOx about 1,500–2,000 mAh/g. The range spans Si to SiOx until the particle type is confirmed (§10 Q9) |
| Swelling | Silicon share × lithiation expansion | Si about 280%, graphite about 10% |
| Ion transport (rate) | Bruggeman: effective transport ∝ porosity^1.5 | Apparent porosity; same bias in both batches |

These ranges are context for people and never inputs to the verdict. No cell simulation and no tortuosity ([R31]): 2D sections hide 3D connectivity, most of what drives cell performance is not in these images, and there is no electrochemical data to check against.

Pictures go with the words: for each driver, the most typical baseline image next to the most different batch image, with the relevant phase highlighted. The texts carry no pictures yet; the UI adds them.

Each audience text gains one sentence on attribution (B) and one on familiarity (C). Not built (§6).

### 3.9 Infrastructure

Everything runs locally and offline. Three processes:

| Process | Command | Port | Role |
|---|---|---|---|
| Pipeline | `uv run python -m qc.run --batch data/<batch>` | – | Measure → compare → write `out/` |
| API | `uv run uvicorn qc.api:app --reload` | 8000 | Thin FastAPI wrapper: reads `out/`, saves uploads to `data/`, calls `run()` and Pat's attribution. No QC logic |
| Web UI | `cd web && npm install && npm run dev` | 5173 | Vite + React + TypeScript + Tailwind. Talks only to `/api` |

Attribution: `uv run python -m qc.features`, `uv run --extra deep python -m qc.deep`, then `uv run python -m qc.attribute` with `--evaluate`, `--dry-run [--repeats 30]`, `--fit` or `--images data/<drop>`. Torch and transformers are regular dependencies since the freeze, so a plain `uv run …` works (`--extra deep` is still accepted). Setup: `brew install uv node@22`. Tests: `uv run pytest`.

### 3.10 Optional review (after the output) — not built, first to cut

A second pair of eyes on the finished result, placed at the output end of the pipeline, never near measurement or comparison.

- **When:** after the evidence and the four texts exist. A separate command or a button in the UI. Never inside `qc.run`.
- **Input:** the finished evidence, the KPI dictionary and, the overlay crops of the drivers.
- **Model:** Claude Opus (`claude-opus-5-5`).
- **Output:** up to five observations worth a second look, each citing the evidence field it is about, written to `out/review/<batch>.json`. Every number in an observation is checked against the evidence; observations that do not match are dropped.
- **Shown as:** "AI observations, unverified", in its own panel, apart from the report and the verdict.
- **Measured:** on the controls (§3.7): how often it mentions the injected change of a positive control, and how often it raises something on a negative one.

### 3.11 Provenance

Every evidence file records: the SHA-256 of each input image, the git commit and dirty flag, a hash of `config/decision.yaml` plus hashes of `config/particle_types.json`, `config/kpi_dictionary.yaml` and `config/attribution_model.json` when present, the `rules-frozen` tag if present, and a timestamp. Same inputs, code and config → identical evidence apart from the timestamp. In a dispute along the supply chain (§8), this record shows exactly what was measured, with which rules, and that nothing was tuned afterwards.

### 3.12 Training policy

Replaced by Rule 2: the attribution model is the only thing trained on batch labels.

### 3.13 Shared strips

Removed from the verdict. v3 ran every comparison with and without the strips that appear in two folders and chose between the variants with a test. The mentors then said the batches are synthetic groupings and strips do not matter (§1), so the image became the unit (§3.5). Shared strips still serve two purposes:

- a check on attribution: are the held-out images of a shared strip placed in their own folder (§3.17)?
- the cleanest comparison of Batch_1 with Batch_2: same strip, different batch (§4 step 2).

`shared_strip_controls` remains in `qc/controls.py`.

### 3.14 Feature discovery: `qc/features.py`

One row per image, `batch, image_id, strip_id` plus features in families, each with a prefix so a family can be switched on and off:

| Family | Prefix | Content | Why |
|---|---|---|---|
| Regional | `reg_` | Per ~15 µm tile of the valid band: Si, pore, graphite, binder fractions, Si/graphite, graphite and pore chord. Summaries over tiles: mean, SD, CV, p10/p50/p90; a normalised top-to-bottom slope and a top/bottom ratio | "Features in different regions": spread and depth profile, not just the mean |
| Edge | `edge_` | Si and pore fraction and relative brightness in the top and bottom 5% rows that `segment()` ignores | Measured separately because they are artefact-prone, but a designed difference could live there |
| Texture | `tex_` | Uniform LBP histograms (P=8, R=1 at 0.05 µm/px) per channel, and BSE LBP inside graphite and inside Si; GLCM contrast, homogeneity, energy, correlation at 0.05 and 0.2 µm per channel, with a 0°/90° anisotropy | Cracks, porous Si, grain texture, surface roughness: things the phase fractions miss |
| Particles | `par_` | From `particles()`: count density, area-weighted D10/D50/D90, log-size SD, coarse share, medians and IQRs of contrast, InLens ratio, texture, solidity; area-weighted void fraction, porous and low-solidity shares; type shares if `config/particle_types.json` exists | The particle work, aggregated per image |
| KPIs | `kpi_` | The 15 descriptors of `kpis()` | The whole-image view, kept as its own family so its (lack of) separation stays visible |
| Imaging | `img_` | `imaging()` per channel | Acquisition, not material. In the table, out of the default model |
| Deep | `deep_` | Optional (`qc/deep.py`), see below | The only family above its null (§12.1) |

Rules: no `strip_id`, height, width, `px_um` or XResolution in any feature; `assert_no_leakage()` runs on every table written. Tile size is in µm so nothing depends on image size. Positions are normalised 0–1.

Deep features: the public `facebook/dinov2-small` checkpoint at a pinned revision, used as is (no fine-tuning), run locally on CPU; no image leaves the machine and no hosted inference is used. Not Polaron's HR-Dv2. Per image: InLens only, valid rows, p1–p99 stretch (removes the black-level difference), 2×2 binning, 224 px tiles (~11 µm), CLS + mean patch token per tile, mean and SD over tiles: 1,536 columns. `qc/attribute.py` reduces them to 10 principal components fit inside each training fold before the logistic fit, so reasons read `deep_pc01…10`. The deep family explains *that* images differ, not *how* in µm; the material families and the statistical comparison stay the explanation.

Command: `uv run python -m qc.features` → `out/features.csv`.

### 3.15 Attribution: `qc/attribute.py`

| Step | Rule |
|---|---|
| Model | Standardised, L2-regularised, class-balanced multinomial logistic regression. Default families: the material ones (`reg, edge, tex, par, kpi`). Features with under 80% finite values or zero variance are dropped |
| Regularisation `C` | Chosen by an inner leave-one-strip-out over {0.01, 0.03, 0.1, 0.3, 1}; ties go to the strongest regularisation |
| Output per image | `p_Batch_1, p_Batch_2, p_Batch_3`, `predicted` (never empty, Rule 11), `confidence`, five `reasons`, plus §3.16's distance block |
| Confidence | Probabilities are temperature-scaled on the model's own out-of-fold (strip-held-out) probabilities; `confidence_raw` keeps the unscaled value. `confidence_tier`: high ≥ 0.75, medium ≥ 0.5, low; `confidence_record`: out-of-fold calls in that tier, right / n |
| Stages | `stage_baseline`: Batch_3 or not, with its confidence ("different from the baseline?"). `stage_variation`: which of the other batches, with its confidence given that it is not the baseline ("in what way?"). Both derived from the three probabilities, so they exist for every model |
| Prediction set | `prediction_set`: the batches with p ≥ 1 − q̂, q̂ from split conformal on the out-of-fold probabilities at α = 0.2. Loose at n = 31; shown beside the bet |
| Reasons | Per reason: feature, its z-score against the training mean, its contribution `coef × z`, the `stage` it belongs to, and a plain-language `text`. A named feature is stated against the baseline ("… : 2.1 SD above Batch_3") with the batch it sits closest to. A `deep_pcNN` component lists the named material features it correlates with on the training set (\|r\| ≥ 0.5, at most three), each stated the same way |
| Staged model (option) | `--staged a:b`: one regression for baseline-or-not on families `a`, one for which variation on families `b`, on the non-baseline rows; probabilities multiplied. Same evaluation protocol |
| Balanced assignment | When the drop is known to be *k* per batch, also report the joint assignment with exactly *k* per class that maximises the summed log-probability (Hungarian). Both are shown. The unconstrained call is the primary answer: it is what a single image or an incoming batch would get, and the split of the unseen images is not confirmed (§1.3) |
| Regions | For the top regional driver, a tile heatmap of that quantity on the image. Not built; on the cut list |
| Frozen artefact | `config/attribution_model.json`: features, means, SDs, coefficients, intercepts, `C`, the image ids it was trained on, its own LOSO estimate, the calibration record and the baseline statistics of §3.16. Readable; no pickles |
| Not allowed | Imaging features in the default model (they can be switched on for an experiment, which is reported as such). Any use of `strip_id` beyond grouping |

Commands: `--evaluate` (§3.17), `--fit`, `--dry-run` (§4), `--images data/<drop> [--balanced k]` → `out/attribution/<drop>.json`.

### 3.16 Familiarity: in or out of distribution

Attribution assigns every image to one of three classes (Rule 11). How far the image sits from what we have seen is reported beside the call, independently of the classifier:

| Quantity | Rule |
|---|---|
| Baseline statistics | Mean and SD of each model feature over the **strip segments** of Batch_3 (the images of one strip inside one batch folder) |
| z per feature | `(value − mean) / SD`, two-sided. Features with \|z\| ≥ 2 are listed with their direction |
| Distance | RMS of z over the model's features |
| Threshold | For each Batch_3 strip, standardise by the other Batch_3 strips and take the RMS z of its images: the baseline's own held-out distances. The threshold is their maximum. Batch_3 images by construction sit at or under it |
| `outside_baseline` | distance > threshold |
| `unfamiliar` | The same distance and threshold computed for the batch the image was **assigned to** (`predicted_distance`, `predicted_threshold`): the image is outside the range of every image we have of that batch. A correct Batch_1 call is therefore not flagged just for being far from Batch_3 |

Reading, for an incoming image or batch:

| Attribution | Familiarity | Meaning | Feeds |
|---|---|---|---|
| Batch_3 | inside the baseline | Inside the promised material's own variation | ACCEPT path (if A agrees) |
| Batch_1 or Batch_2 | outside the baseline, not unfamiliar | A **known** variation: we have seen this before and can name it | Explanation names the batch and the drivers; verdict from A and δ |
| any batch (the call still stands) | unfamiliar, low tier or a prediction set of two or three | A **weak call**: the nearest known batch, and how unlike it the image is | At least INVESTIGATE; the next action is "get more images" or "ask the supplier about …" |

Known weaknesses (§12.2, PAT_SUMMARY §4): the baseline distance flags only 1 of the 14 Batch_1 and Batch_2 images, so "different from the baseline" rests on the classifier's first stage; and *unfamiliar* has never been tested on a truly foreign image.

### 3.17 Evaluation protocol (before anything is trusted or frozen)

All numbers come from `uv run python -m qc.attribute --evaluate` → `out/attribution/evaluation.json`, `feature_ranking.csv`.

| Check | Rule | Pass |
|---|---|---|
| Leave-one-strip-out (LOSO) | Hold out every image of one physical strip across all folders; standardise and choose `C` inside the fold. Per family and for the material set | Balanced accuracy, confusion matrix |
| Permutation null | Shuffle batch labels across **strip segments** (so the null keeps the strip structure), ≥ 200 times, same pipeline | Real accuracy above the null's 95th percentile |
| Best-of-list null | When several representations are tried and the best is kept, compare it with the best of the same list under each shuffle | The winner beats that null, not just its own |
| Shared strips | For strips imaged in more than one folder: were their held-out images attributed to their own folder? | If yes, the model reads material, not strip. If no, say so: those images are genuinely ambiguous |
| Feature ranking | Per feature, on strip-segment means: largest pairwise effect size and LOSO accuracy of a one-feature nearest-mean rule | The top features are what the explanation (A) should talk about |
| Imaging alone | Same LOSO with only `img_` | If imaging alone attributes well, say it in the report: material claims need the material families to beat it |
| Dry run | §4 | Accuracy on 3 held-out images per batch, whole strips held out, repeated over many draws |

If no family beats its null, we say so next to every call (the model's strip-held-out accuracy and its null are part of the output) and the confidence tiers will read low. The call is still made (Rule 11).

### 3.18 Showing A–D together

The UI has an **Attribution & familiarity** view (Sort) beside the verdict, Patrik-owned, fed from `out/attribution/<drop>.json`:

- per image: predicted batch with the three probabilities, the confidence tier with its record, the two stages, the prediction set, the reasons as sentences, the unfamiliar flag with its distance and threshold, the deviating features with direction, and the balanced-assignment column when used;
- per drop: counts per predicted batch, number unfamiliar, the model's own LOSO accuracy and the `fitted_at` stamp (so nobody mistakes a 0.64-accuracy model for an oracle);
- wording follows Rule 7: "looks like", "outside the baseline's range on", "unlike any known batch".

What the UI shows today and what is missing: §6.

### 3.19 Degradation outlook (optional, after everything above)

Indicative, non-verdict, per batch, from measured quantities only: Si swelling volume at full lithiation against available pore volume, fracture-prone Si share (large and low-solidity), Si–graphite contact proxy, pore transport proxy. Each with a formula, its inputs, its assumptions and an interval; labelled *indicative*, never "lifetime". `qc/degrade.py`, not started.

## 4. Next steps (from 3 Oct, 21:00)

Deadlines: the submission (2-minute video, repo, description) is due **Sunday 4 Oct, 14:45**. More unseen images arrive shortly before judging (§1.3).

In this order. Steps 1 to 5 are the critical path for the judged test.

| # | Step | Who | Done when |
|---|---|---|---|
| 1 | **Settle the two decisions still open** in the table below: when to freeze, and which model | Pat, Patrik | Both have an answer |
| 2 | **Last model work before the freeze, from a list fixed in advance.** (a) Look at Batch_1 and Batch_2 side by side inside the strips they share (2080, 2148, 2156) and list the features that differ in the same direction in all three. (b) Normalise each detector image with the p1–p99 stretch the deep features already use, recompute the `tex_` family and rerun `--evaluate`: does Batch_3-vs-rest hold, and does its correlation with the `img_` descriptors fall? (c) One model per detector (InLens, ETD), probabilities averaged. (d) Tiles of about 5 µm and about 22 µm. Score the best of the list against the best-of-list null (§3.17). Stop at the time box agreed in step 1 | Pat | A table like §12.2 for the list, and a yes or no on each item |
| 3 | **Choose the model to freeze:** flat `deep`, staged `material > deep`, or the staged first stage for the confidence with the deep model for the call | Pat, Patrik | One line in §12 naming the model and why |
| 4 | **Rehearse, fit, freeze.** `uv run --extra deep python -m qc.attribute --dry-run --repeats 30`, then `--fit` with the chosen families, commit `config/attribution_model.json`, `git tag rules-frozen`, push | Pat | The tag exists and covers `decision.yaml`, `particle_types.json` and `attribution_model.json` |
| 5 | **Score the 3 dropped samples, once.** Link the folder into `data/` under its own name (never inside a batch folder). `uv run --extra deep python -m qc.attribute --images data/Hackathon-Polaron-test`. No `--balanced`. Copy `out/attribution/Hackathon-Polaron-test.json` to `results/` and commit it unchanged (`out/` is gitignored). Time the run for one sample | Pat | The result is committed after the tag; the seconds per sample are known |
| 6 | **The app shows the judged answer.** Per image: the bet, the tier with its record, "Batch_3 or not" and "which variation", the prediction set, the reasons as sentences; the badge prints `predicted_distance` and `predicted_threshold`. Silicon content % in the compare view (§3.8) | Patrik (numbers from Pat) | The Sort view shows a call a judge can read without code names |
| 7 | **Rehearse the last-minute images.** Same single command on a folder of known images, model untouched: upload or copy, result, explanation. Nothing is refit or tuned on the day | Both | One timed rehearsal, start to finish, through the app |
| 8 | **Submission:** video, repo, description; README in sync | Both | Submitted before Sunday 14:45 |
| 9 | **When the last images arrive:** run step 5's command on their folder, commit the output unchanged, present the call with its confidence and reasons | Both | – |
| 10 | Only if the true batches of the unseen images are given: add them to training (more images per batch is the real limit) | Pat | – |

**Decided (Pat, 3 Oct, 21:30):**

- **The 3 dropped samples are scored right after the freeze,** not held until the later images arrive. It proves the frozen path and gives a timed run. They are still scored once, after the tag.
- **ETD and the imaging features go into the model only if they survive the best-of-list null.** The designer's replies make a designed microscope difference unlikely (§1.4).
- **Rules 3 and 5 are dropped** (§2).

**Still to decide** (step 1):

| Decision | Options | Note |
|---|---|---|
| When to freeze | Tonight after a time-boxed step 2, or now | Step 2 is the only work that can still improve the scored result; it must not run into the morning |
| Which model | Flat `deep` (0.63 in rehearsals; tiers 67% / 67% / 60%, so not informative) or staged `material > deep` (0.55; tiers 91% / 62% / 40%) | Both the call and the confidence are judged (§12.2) |

**Drop protocol** (unchanged; README "Held-out protocol"):

1. New images go in their own folder under `data/`, never inside the known batch folders.
2. Nothing is fitted or tuned after `rules-frozen`.
3. One run per folder; the output is committed unchanged.
4. `--balanced k` only if the split per batch is confirmed.
5. If a drop is a whole batch, also `uv run python -m qc.run --batch data/<drop>` for A and D.

## 5. Steps: Pat (ML)

**Done:** segmentation; the 15 descriptors; the particle table; a first particle-type fit; the imaging check; controls; threshold variants and the integral range; `qc/features.py`; `qc/deep.py`; `qc/attribute.py` with confidence, stages, prediction sets and readable reasons; `--evaluate` and the repeated rehearsals on the real data (§12–12.2); the KPI dictionary draft.

**Open, critical path:** §4 steps 2 to 5.

**Open, after the freeze or if time allows:**

1. Example-based reasons: for each call, the nearest known tiles ("looks like these"). This also covers the four deep components with no readable translation.
2. Measure what the eye sees in the shared strips: cracks inside particles, binder amount, porosity split into between and inside particles, porous silicon.
3. Refit and name the particle types; decide the porous rule. Must happen before `rules-frozen` if the types are to change, otherwise the provisional fit is what gets frozen.
4. Set `curtaining_max` from the real `curtaining_index` distribution.
5. Have a mentor review the causes in the dictionary.
6. A small hand-labelled check of the segmentation.
7. Try DINOv2-base or DINOv3 once [R38].
8. §3.19 degradation outlook.

## 6. Steps: Patrik (software)

**Done:** the evidence contract; `compare()` with the image unit and the strip view; particle and imaging plumbing; the four explanation templates; provenance; the API pass-through for attribution; the Sort, What's different and Batch verdict views; `baseline: Batch_3`.

**Open, critical path:** §4 steps 6 and 7.

**Open:**

1. Show the fields added in §3.15: `reasons[].text`, `confidence_tier` with `confidence_record`, `stage_baseline`, `stage_variation`, `prediction_set`. Nothing the UI reads today was renamed.
2. The "Unlike any known batch" badge follows `unfamiliar`, which refers to the assigned batch: print `predicted_distance` and `predicted_threshold`.
3. Mirror the new fields in `web/src/types.ts` and both attribution fixtures.
4. Templates (§3.8): one sentence on B and C per audience; silicon content %.
5. Feed the controls into `run()` so they reach the verdict (§3.7).
6. The app features in `docs/APP.md`, in its order.

## 7. Tools

| Tool | Use | Who |
|---|---|---|
| Hugging Face | DINOv2 weights for the deep features, downloaded once at a pinned revision. Images are not uploaded | Pat |
| Modal | Control sweeps and the how-many-images curve | Both |
| Devin, Antigravity | Coding agents on their own branches; the UI build and browser tests | Both |
| AMASS | Citations for the KPI dictionary; drop if thin | Either |
| Claude API | Optional review after the output (§3.10). Not in the frozen path, not in the demo | Patrik |

## 8. Demo and pitch

The two-minute script is in `docs/APP.md` feature 9. Its order: the problem (£50k of images: "is this delivery what the supplier promised?"); drop the 2 images → batch, confidence, why; what is different and how consistent each batch is; the held-back result, frozen before the data arrived; impact and audit.

Pitch points from the task designer:

- Three uses of this data: choosing a supplier, batch QC (this tool), root-cause analysis when something goes wrong.
- Liability chain: carmaker sues cell maker, cell maker sues material supplier, driver sues everyone. Our frozen rules, committed evidence, input hashes and named drivers are the audit trail.
- The value is catching it before the cells go into cars: "we qualified you on this microstructure; this batch doesn't match, here is how."
- Why not an LLM: Polaron tested it; it described images but could not group batches reproducibly. Our drivers are measurements a materials scientist can check.
- What we say about our own limits: "Batch_3 or not" is solid; Batch_1 against Batch_2 is a weak, labelled lean; every call carries the record of how often calls of that confidence were right.
- Do **not** quote the "£2bn" figure unless we find a source.

## 9. Cut list (in this order, if time runs short)

1. Optional review (§3.10).
2. Degradation outlook (§3.19).
3. Tile heatmaps (keep the reasons list).
4. Strip-leak chart (leave-one-image-out against leave-one-strip-out).
5. Integral-range estimate in the app (keep the numbers in `out/uncertainty/`).
6. Threshold-variant uncertainty in the app (state it as a limit instead).
7. Curtaining index (keep the other imaging checks).
8. Particle types beyond the provisional fit and the rule-based porous fallback.

Never cut: segmentation with overlays; the key descriptors; the comparison with its controls; the deep features (the only family above its null); regional and texture features; LOSO with a null; the unfamiliar flag; the confidence tier and readable reasons; the frozen JSON model and the `rules-frozen` tag; provenance; templates.

## 10. Open questions for the mentors

Contact: Steve Kench (task designer); Martin, a battery scientist (previously battery R&D at JLR), on Discord or Slack.

**Answered**

| # | Question | Answer |
|---|---|---|
| 1 | Is Batch_3 the baseline? | Yes (§1) |
| 2 | Adjacent tiles in different folders: intended? | Yes. Batches were assembled from one dataset; strips do not matter (§1) |
| 3 | When does the unseen set drop? | Dropped on 3 Oct; more images just before judging (§1.3) |
| 4 | Are the bright particles silicon? | Yes. The content % and the particle kinds are ours to work out (§1.4) |
| 6 | Same detectors for the unseen images? | Yes. Pixel size and FIB prep were not mentioned |

**Open, and they change what we do**

| # | Question | Why it matters |
|---|---|---|
| 14 | How many more images come before judging, from which batches, and are they from strips we already have? | Which accuracy estimate applies, and whether the balanced assignment can be used |
| 15 | Does a microscope difference count as a batch difference? | Our reading of the replies is no (§1.4). If yes, ETD and the imaging features can go into the model |
| 16 | Is each image scored, or the set? Is a per-image answer wanted for "batch N in or out of distribution", or per batch? | We give both |
| 17 | Are the top and bottom 5% of each image meaningful? | We cut them from most measurements |

**Open, nice to know**

| # | Question |
|---|---|
| 5 | Which two or three descriptors matter most, and at what tolerance? |
| 7 | Can someone review the "possible causes" in our KPI dictionary? |
| 9 | Is the "larger, dimmer" particle type SiOx? Is there EDS for any of these samples? |
| 10 | Rule 1 says no Polaron tools. May we cite and reimplement published methods from Polaron's founders (ImageRep, TauFactor)? |
| 11 | Which image direction runs through the electrode thickness? |
| 12 | Are 3D FIB-SEM stacks available for these samples, or only single 2D sections? |
| 13 | Is the binder visible in these images, and should it be its own phase? |

## 11. Glossary

| Term | Meaning |
|---|---|
| Anode | The negative battery electrode. Ours is mostly graphite |
| Graphite | Main anode material. Large dark-grey flakes in BSE |
| Si, silicon particle | Silicon-based additive. The bright particles in BSE |
| SiOx | Silicon suboxide, a common commercial silicon additive. Darker than Si in BSE |
| Pore | Empty space between particles. Black in BSE |
| Apparent porosity | Pore share measured from a 2D image. Biased, because the back of open pores is visible |
| Phase | One kind of material in the image (pore, graphite, Si, binder) |
| Microstructure | How particles and pores are sized, shaped and arranged at the micrometre scale |
| Batch | One delivery of material. Here: a folder of images grouped by the organisers |
| Baseline, reference | The batch others are compared against. Batch_3 |
| SEM | Scanning electron microscope |
| FIB-SEM | Focused ion beam cuts a cross-section, then the SEM images it |
| Curtaining | Vertical streaks left by uneven FIB milling. An artefact, not material |
| BSE | Backscattered-electron image. Brightness follows composition |
| ETD, SE | Standard secondary-electron detector. Shows surface shape |
| InLens | Secondary-electron detector inside the column. Sensitive to thin surface films |
| Sample, field, image | One imaged region with its three detector files. It gets one call |
| Strip | One long continuous image that was cut into several samples |
| Strip segment | The images of one strip inside one batch folder |
| Shared strip | A strip with images in more than one batch folder |
| µm, nm, px | Micrometre, nanometre, pixel. One pixel is 25 nm |
| Grey level | Pixel brightness, 0 to 255 |
| Black level | The grey level of "nothing". A detector setting |
| Descriptor, KPI | One measured number describing the microstructure |
| Key descriptor, key quantity | A descriptor or type share that counts towards the verdict |
| Feature, family | A number per image used for attribution; a named group of features (`reg_`, `tex_`, `deep_`, …) |
| Segmentation, mask | Labelling every pixel with its phase; the resulting label image |
| Overlay | The mask drawn on the image for checking by eye |
| Threshold, multi-Otsu | A grey-level cut-off; a standard way to pick cut-offs automatically |
| Opening | Clean-up that removes specks |
| Watershed | Standard method to split touching particles |
| Equivalent diameter | Diameter of a circle with the particle's area |
| D50, D90 | Size below which 50% or 90% of particle area falls |
| Run length, chord | Length of an unbroken run of one phase along a line. Its average is a size measure |
| Anisotropy | Horizontal run length divided by vertical: how flat and aligned the flakes lie |
| Solidity | Particle area divided by the area of its outline stretched tight. Low means ragged or broken |
| Texture | Brightness variation inside a particle or region. High means speckled or porous |
| LBP, GLCM | Two standard ways to describe image texture as numbers |
| CV | Standard deviation divided by mean |
| Si:graphite ratio | Silicon area divided by graphite area. Follows the recipe; unlike the area fraction, it does not move with porosity |
| Silicon content % | Silicon as a share of the image area, or of the solid. An area fraction, which estimates the volume fraction |
| Pore connectivity | Share of pore area in the largest connected pore cluster. Apparent in 2D |
| Fingerprint | What we measure about one batch: descriptors with intervals and particle-type shares |
| Clustering | Grouping similar items automatically, without labels |
| Particle type | A group of similar silicon particles found by clustering |
| Unassigned | A particle that fits none of the known types |
| Interval | The plausible range of a value given how few images we have |
| Permutation test | Shuffle the labels between two batches many times; if the real difference is rarely matched, the batches differ |
| Max-statistic | Using the largest shuffled difference across all quantities, so testing many at once does not inflate false alarms |
| Margin δ, tolerance | The smallest difference we call real: a customer tolerance, or a multiple of the baseline's spread |
| Similar, different, unclear | Interval within ±δ; significant and beyond δ; anything else |
| Equivalence test | Showing two things are the same within a margin, rather than failing to show they differ |
| Driver | A key quantity that explains most of the difference between two batches |
| Power limit | Too few images or strips for any difference to be called real |
| Negative / positive control | Test images with a known answer: must not come out different / must come out different |
| Imaging outlier in the reference | A baseline image whose imaging (e.g. black level) is far from the others; left out of the imaging range |
| Attribution | Saying which known batch an image looks like |
| Leave-one-strip-out (LOSO) | Testing the model on every image of a strip it was not trained on |
| Null, permutation null | The score the same method gets on shuffled labels. A result counts only if it beats this |
| Best-of-list null | The null for a method chosen as the best of several tries: the best of the same tries on shuffled labels |
| Confidence tier, record | High, medium or low, with how often held-out calls in that tier were right |
| Prediction set | The batches that should contain the right answer 8 times out of 10 |
| Stage | "Batch_3 or not", then "which other batch" |
| Balanced assignment | The best assignment with exactly k images per batch. Only valid if the split is known |
| Familiarity, unfamiliar | How far an image is from the batch it was assigned to; outside the range of every image we have of that batch |
| Held-back, unseen images | Images the organisers kept back to test us. Not opened before the freeze |
| Dry run, rehearsal | Hold out known images, refit, predict, score. Repeated over many draws |
| DINOv2 | Pretrained vision model. Used frozen, on InLens tiles, as the `deep_` features |
| Two-point correlation | Probability that two points a distance r apart are both silicon (or both pore). How it decays gives a cluster length scale |
| Integral range | Area over which a phase "repeats itself". Sets how much a phase fraction varies between images of a given size |
| KPI dictionary | Our file of plain-language meanings, causes, checks and consequences for each descriptor |
| Template | Fixed sentence with slots filled from the numbers |
| Indicative consequence | A range for what a difference means for the cell (capacity, swelling, rate), from textbook relations. Never part of the verdict |
| Bruggeman relation | Rule of thumb: ion transport through a porous layer scales with porosity^1.5 |
| Contract, schema | Agreed function signatures, column names and units |
| Evidence file | Everything behind one comparison (`out/evidence/<batch>.json`). The UI reads only this for A and D |
| Freeze, tag | Locking the settings and the model before the unseen images are scored, with a timestamped git marker |
| Provenance | Hashes of the input images, the git commit and the config hash stored with a result, so it can be reproduced exactly |
| SHA-256, hash | A fingerprint of a file; any change to the file changes it |
| AI observation | A comment from the optional review. Shown apart from the report, unverified |

## 12. Results on the real data (3 Oct 2026, 31 images, 13 strips, local run)

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
- **Confound:** the leading texture features correlate with imaging descriptors (|r| 0.6–0.9 with `img_bse_noise` and `img_bse_p1`). Batch_3 was also imaged with a different InLens black level (7.0 against 0–0.7). Part of the Batch_3-vs-rest signal may be acquisition rather than material. §4 step 2(b) tests this.
- **Shared strips:** no family set consistently places the images of a shared strip into their own folders.
- **Why strips must be held out:** the same model on the 15 KPIs scores 0.49 leaving one image out and 0.35 leaving one strip out. The first number is strip leakage.

Reading: the named features can say "looks like the promised Batch_3, or not", at about 0.85 against a null of about 0.70, with the acquisition caveat above. They cannot tell Batch_1 from Batch_2.

### 12.1 Deep features (`qc/deep.py`, InLens DINOv2-small, 10 PCs per fold)

| Check | Result |
|---|---|
| Three-way LOSO, nested `C` (`loso_cv(df, ("deep",))`) | 0.64; Batch_1 3/7, Batch_2 5/7, Batch_3 13/17 |
| Same, fixed `C` = 0.1 (exploration) | 0.68 |
| Selection-aware null: best of 6 deep settings per shuffle, 100 segment shuffles | p95 0.60, p99 0.67 |
| Batch_1 vs Batch_2 alone (exploration) | 0.57 against a null p95 of 0.71: not separable |
| Dry run `--families deep` (same 9 images as §12) | 6/9 unconstrained, 3/9 balanced; every probability about 0.34 because the inner CV picks `C` = 0.01 |

Reading: the deep family is the first one above its null for the three-way question, and Batch_2 has a fine-scale InLens look of its own. Batch_1 is still confused with the other two (strip 2316 reads as Batch_3), and the near-uniform probabilities mean any single call is weak. In the full `--evaluate` run: `deep` 0.64 against a per-set null p95 of 0.54; `deep+material` (1,716 features) 0.46 against 0.50, so adding the material families to the deep ones dilutes them.

### 12.2 Confidence, stages, rehearsals and the Batch_1 vs Batch_2 search (3 Oct, evening)

Same 31 images, features rebuilt locally; `--evaluate` reproduces every row of §12 and §12.1.

**Staged models** (baseline-or-not families > which-variation families), three-way LOSO, nested `C`, 200 segment shuffles:

| Set | LOSO balanced accuracy | Null p95 | Batch_1 / Batch_2 / Batch_3 right |
|---|---|---|---|
| deep (flat, for reference) | 0.64 | 0.54 | 3/7, 5/7, 13/17 |
| material > deep | 0.66 | 0.51 | 3/7, 5/7, 14/17 |
| texture > deep | 0.63 | 0.49 | 3/7, 4/7, 15/17 |
| texture > material | 0.53 | 0.50 | 1/7, 4/7, 15/17 |

Staging does not help accuracy: Batch_1 against Batch_2 is the bottleneck in every set.

**Repeated dry runs** (`--dry-run --repeats 20`: 3 held out per batch, whole strips where possible, refit each time; 18 distinct draws):

| Model | Unconstrained, mean ± SD (range) | Balanced 3/3/3 | Right per batch (B1 / B2 / B3) | Right per tier: high / medium / low | Prediction set: coverage, mean size |
|---|---|---|---|---|---|
| deep | 0.63 ± 0.12 (0.44–0.89) | 0.78 ± 0.22 | 0.35 / 0.65 / 0.88 | 24/36, 28/42, 61/102 | 0.89, 2.1 |
| material > deep | 0.55 ± 0.16 (0.33–0.89) | 0.72 ± 0.20 | 0.35 / 0.38 / 0.92 | 32/35, 25/40, 42/105 | 0.89, 1.9 |

- One draw of nine can land anywhere between 4/9 and 8/9 with the same model: the single dry runs of §12 and §12.1 (3/9, 6/9) were noise. With only 3 samples in the drop (§1.3) a single result says even less.
- The balanced assignment is worth about +0.15 **if** the unseen images are three per batch. That is not confirmed (§1.3), and it does not apply to the two live images.
- The flat deep model's tiers do not separate right from wrong calls on unseen strips (67%, 67%, 60%). The staged model's do (91%, 62%, 40%), at a lower overall accuracy. Which one to freeze is open (§4).
- Prediction sets held the true batch for 89% of unseen images (target 80%), at about two batches per set.

**Batch_1 vs Batch_2 search** (LOSO, nested `C`; DINOv2-small tile or particle embeddings pooled per image unless noted; one-off scripts, not in the CLI):

| Representation | Three-way | Batch_1 vs Batch_2 (14 images) |
|---|---|---|
| InLens tiles (the `deep_` family) | 0.64 | 0.64 |
| BSE tiles | 0.54 | 0.36 |
| **ETD tiles** | 0.68 | **0.79** |
| All three channels | 0.64 | 0.64 |
| Si particle crops (BSE, up to 150 per image) | 0.39 | 0.36 |
| Two-point correlation curves (Si, pore, graphite; 16 radii) | 0.26 | 0.36 |
| Same, 10 PCs per fold | 0.27 | 0.50 |
| Tile-level training with a per-image vote (InLens / BSE / ETD / particles) | 0.53 / 0.53 / 0.59 / 0.39 | 0.50 / 0.64 / 0.64 / 0.64 |

- ETD is the only lead. Against its own null it stands out (p95 0.71, 1 of 150 shuffles as good). Against the fair null, the best of the seven pooled candidates per shuffle, it does not (p95 0.86; 19% of shuffles as good). **Not established.**
- Acquisition check: the eight ETD imaging descriptors alone reach 0.64 on Batch_1 vs Batch_2, and ETD sharpness differs (2,126 against 1,748). Part of the ETD signal may be the microscope (§10 Q15).
- Particle embeddings, two-point curves and tile-level training do not separate the two batches. Named texture and material families stay at chance (0.36, 0.50).

Reading: nothing tried closes the Batch_1 / Batch_2 gap. The honest product is a confident "Batch_3 or not" (24–26 of 31 out-of-fold) and a weak, labelled lean between Batch_1 and Batch_2.

**Frozen model** (`config/attribution_model.json`, tag `rules-frozen`, 3 Oct 22:10): staged `material > deep`, fitted on all 31 samples; LOSO 0.66; temperature 1.42; out-of-fold right per tier 9/9, 5/9, 8/13; stage record 26/31 (baseline or not) and 8/12 (which variation). Chosen over flat `deep` because its confidence tiers separate right from wrong calls (rehearsals: 32/35, 25/40, 42/105 against 24/36, 28/42, 61/102) and its first stage reads in named features; the accuracy gap (0.55 against 0.63 in rehearsals, 0.66 against 0.64 LOSO) is inside the rehearsal spread. The pre-freeze list of §4 step 2 was not run.

**Earlier draft, superseded:** flat `deep`, `C` = 0.3, LOSO 0.64; temperature 0.45; out-of-fold right per tier 7/9, 6/12, 8/10; stage record 24/31 (baseline or not) and 8/11 (which variation). It fits its training images much better than new ones (0.87 against 0.64), so expect fewer "high" calls on unseen images.

## 13. Evidence for each decision

Strength: **strong** = direct evidence on our kind of problem; **analogous** = established practice in another field, transferred; **partial** = supports part of it, or only as a caveat. Where the literature cuts against us, it says so.

### Problem framing and explainability

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| Measure interpretable descriptors; explanations from the numbers (§3.8) | [R1] | strong | For high-stakes decisions, use models that are interpretable by design; post-hoc explanations of black boxes are often unfaithful |
| No language model in the pipeline (as built; no longer a rule, §2) | [R2], [R3]; the task designer's own test | strong | Multimodal LLMs fall well short of experts on materials-characterisation images, especially on spatial reasoning and fine visual detail. Newer models are improving but are still below expert level [R33] |
| Explainable ML is the direction in battery production | [R27], [R28], [R29] | analogous | Reviews and production studies favour interpretable models for electrode properties; small datasets and black boxes are named obstacles |
| "Different" is not "bad"; report differences and let tolerances decide (Rule 7) | [R9] | analogous | ICH Q5E: comparability means "highly similar", not identical, judged on the quality attributes that matter |
| Uses: supplier choice, batch QC, root cause; teardown comparisons (§8) | [R19], [R20] | strong | Teardown studies compare commercial anodes on Si content and particle size; one measured Si at 2.43% with five cross-validated methods |

### Statistics

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| Never treat particles or images as independent; hold out whole strips (Rules 8, 10) | [R4], [R5] | strong | Treating nested measurements as independent gave over 45% false positives at a nominal 5%. Leakage affected 294 papers in 17 fields; group-aware splits are the standard fix. Our own numbers: 0.49 leaving one image out, 0.35 leaving one strip out |
| Permutation test with max-statistic across key quantities (§3.5) | [R6] | strong | Westfall–Young maxT controls the family-wise error rate with minimal assumptions |
| Permutation null over strip segments for attribution (§3.17) | same logic | strong | The null must keep the dependence structure of the data |
| Margin 1.5 × baseline spread; SIMILAR = 90% interval inside ±δ; t-interval (§3.5) | [R7] | analogous | FDA tier-1 analytical similarity: 90% CI of the mean difference within ±1.5 σR of the reference lots |
| Odd-unit check (§3.5) | [R7] | analogous | FDA tier-2 quality range from the same framework |
| Baseline spread is probably underestimated | [R8] | partial | When reference lots are correlated, their sample SD underestimates the true spread and margins come out too tight. Images cut from one strip are correlated in the same way; hence the strip view beside the image view |
| Tiers: key descriptors tested, the rest reported (§3.2) | [R7] | analogous | FDA ranks attributes by risk: equivalence test for tier 1, quality range for tier 2, visual comparison for tier 3 |
| Particle-type count chosen by stability, not a score (§3.4) | [R13] | strong | Stability of cluster assignments on resampled data is a validated way to choose k |
| Prediction sets (§3.15) | [R36] | strong | Conformal predictors give sets with a stated coverage under minimal assumptions. Loose at n = 31 |

### Attribution

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| Regularised linear model over trees or deep classifiers at n = 31 (§3.15) | [R1] | strong | Coefficients are the explanation; nothing to tune but `C`; the result is a readable JSON |
| Frozen pretrained features with a small model on top (§3.14) | [R34] | strong | The current approach for small materials datasets |
| Supervised defect detectors: not used | — | — | No defect labels, 31 images, and batches that are not defined by defects |
| Particle-level DINOv2 embeddings; two-point statistics with PCA | [R35], [R12] | **tried, negative** | Neither separated Batch_1 from Batch_2 (§12.2) |
| Familiarity as a two-sided RMS z against the baseline's segments with a self-calibrated threshold (§3.16) | — | — | The simplest "unlike anything in the baseline" rule. Mahalanobis is not estimable with 7 segments and 170 features |
| Balanced assignment shown beside the unconstrained call (§3.15) | — | — | A stated prior is legitimate; a hidden one is not |
| Example textures instead of heatmaps for SEM (§5) | [R37] | partial | Not built |

### Microstructure measurement

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| Si fraction is key (§3.2) | [R21], [R20] | strong | Commercial Si–graphite anodes hold only about 2–3 wt% Si; small changes matter for capacity and cycle life |
| `si_graphite_ratio` as the silicon key (§3.2) | Designer's own term; [R20], [R21] | strong | The ratio follows formulation and is independent of porosity. `si_area_frac` stays as a reported number |
| Si size (D50, D90) is key (§3.2) | [R15] | strong | Si fracture on lithiation depends strongly on particle size. Caveat: their critical size is about 150 nm, below our resolution, so we can only see shifts in the µm-scale particles |
| Internal voids and a "porous" type (§3.2, §3.4) | [R18] | strong | Commercial µ-Si can have engineered internal porosity that controls swelling and stability |
| Si dispersion and agglomerates (§3.2) | [R16], [R17] | strong | Si agglomerates up to about 10 µm form during processing, are hard to see, and cause hot spots, protrusions and self-discharge |
| Graphite chord and anisotropy (§3.2) | [R16] | partial | Graphite size changes packing, voids and Si distribution; flakes lie mostly parallel to the current collector, which is why anisotropy is informative |
| Particle types by clustering descriptors (§3.4) | [R25], [R26] | analogous | Shape descriptors with k-means or GMM track batch-to-batch variation in particulate products |
| InLens/BSE ratio as a type feature, against local graphite (§3.2) | [R22]; our audit (§1.1) | partial | Combining InLens and ETD separated three active materials in a FIB-SEM blend electrode. The local reference keeps InLens shading out of a particle feature |
| "Larger, dimmer" type may be SiOx (§3.4) | [R19] | partial | Commercial anodes use graphite–SiOx. Hypothesis only until EDS or a mentor confirms |
| Threshold segmentation (§3.2) | [R23] | strong | Deterministic global thresholding was stable on FIB-SEM of a Si/C–graphite anode |
| … but trained segmenters can do better | [R30] | **against** | On FIB-SEM cathodes a 3D U-Net beat thresholds and watershed. We keep thresholds (no labels, deterministic) and check overlays by eye |
| "Apparent" porosity; imaging-sensitive (§3.2, §3.3) | [R24] | strong | FIB-SEM shine-through makes pore segmentation biased. The bias is roughly constant if prep and imaging are the same; it isn't if imaging changed |
| Curtaining check (§3.3) | [R23], [R32] | strong | Vertical curtaining streaks are common in FIB-SEM and need detecting or filtering before quantification |
| Imaging range without baseline outliers (§3.3) | Our audit (§1.1) | strong | P2060's black level alone would widen the range to 0–23 |

### Uncertainty, consequences, provenance

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| Integral range: expected spread and area needed (§3.6) | [R10] | strong | Defines RVE size by the precision needed and links the variance of phase fractions to the integral range |
| Same from a single image via the two-point correlation (§3.6) | [R11] | strong | Predicts phase-fraction uncertainty and the image size needed from one micrograph. From Polaron's founders: reimplement the classical method, ask before using their code (§10 Q10) |
| Segmentation uncertainty (§3.6) | [R11] | partial | ImageRep's own docs warn that segmentation uncertainty may be larger than sampling uncertainty |
| Indicative consequences (§3.8) | Textbook values; [R15], [R18], [R21] | partial | Directions are well established; magnitudes depend on Si vs SiOx and on 3D structure we cannot see, hence ranges |
| Tortuosity: not added | [R31] | — | A 3D quantity, and TauFactor comes from Polaron's founder. Revisit only with mentor approval |
| Provenance (§3.11) | [R9] | analogous | Comparability decisions in regulated manufacturing rest on traceable, reproducible records |
| Optional review after the output (§3.10) | [R2], [R3], [R33] | partial | The same sources that keep LLMs out of measuring and deciding. So the review only comments on a finished result, and its hit rate on the controls is measured |

## 14. References

Read at abstract or summary level unless noted.

- **[R1]** C. Rudin, "Stop explaining black box machine learning models for high stakes decisions and use interpretable models instead," *Nature Machine Intelligence* 1, 206–215 (2019). https://www.nature.com/articles/s42256-019-0048-x
- **[R2]** "Can Multimodal LLMs See Materials Clearly? A Multimodal Benchmark on Materials Characterization" (MatCha), *Findings of EMNLP* 2025. https://aclanthology.org/2025.findings-emnlp.235/
- **[R3]** "Probing the limitations of multimodal language models for chemistry and materials research" (MaCBench), *Nature Computational Science* (2025). https://www.nature.com/articles/s43588-025-00836-3
- **[R4]** V. Saravanan, G. J. Berman, S. J. Sober, "Application of the hierarchical bootstrap to multi-level data in neuroscience," *NBDT* 3(5), 1–25 (2020). https://arxiv.org/abs/2007.07797
- **[R5]** S. Kapoor, A. Narayanan, "Leakage and the reproducibility crisis in machine-learning-based science," *Patterns* 4, 100804 (2023). https://doi.org/10.1016/j.patter.2023.100804
- **[R6]** P. H. Westfall, S. S. Young, *Resampling-Based Multiple Testing*, Wiley (1993).
- **[R7]** FDA CDER statistical review, tier-1 equivalence testing with margin ±1.5 σR and 90% CI. https://www.fda.gov/media/115402/download
- **[R8]** "On FDA's Approach to Demonstration of Analytical Similarity," *PDA J. Pharm. Sci. Technol.* (2016). https://journal.pda.org/content/early/2016/06/18/pdajpst.2016.006551
- **[R9]** ICH Q5E, "Comparability of Biotechnological/Biological Products Subject to Changes in Their Manufacturing Process." https://database.ich.org/sites/default/files/Q5E%20Guideline.pdf
- **[R10]** T. Kanit, S. Forest, I. Galliet, V. Mounoury, D. Jeulin, "Determination of the size of the representative volume element for random composites: statistical and numerical approach," *Int. J. Solids Struct.* 40 (2003). https://www.sciencedirect.com/science/article/abs/pii/S0020768303001434
- **[R11]** A. Dahari, R. Docherty, S. Kench, S. J. Cooper, "Prediction of microstructural representativity from a single image," *Advanced Science* (2025). https://arxiv.org/abs/2410.19568 · code: https://github.com/tldr-group/ImageRep
- **[R12]** S. R. Niezgoda, A. K. Kanjarla, S. R. Kalidindi, "Novel microstructure quantification framework for databasing, visualization, and analysis of microstructure data," *Integr. Mater. Manuf. Innov.* 2:3 (2013). See also two-point statistics with PCA: https://arxiv.org/pdf/2405.18396
- **[R13]** T. Lange, V. Roth, M. L. Braun, J. M. Buhmann, "Stability-based validation of clustering solutions," *Neural Computation* 16(6), 1299–1323 (2004). https://doi.org/10.1162/089976604773717621
- **[R14]** S. Damm et al., "AnomalyDINO: Boosting patch-based few-shot anomaly detection with DINOv2," *WACV* 2025. https://arxiv.org/abs/2405.14529
- **[R15]** X. H. Liu et al., "Size-dependent fracture of silicon nanoparticles during lithiation," *ACS Nano* 6(2), 1522–1531 (2012). https://doi.org/10.1021/nn204476h
- **[R16]** "Graphite particle-size induced morphological and performance changes of graphite–silicon electrodes," *J. Electrochem. Soc.* (2020). https://iopscience.iop.org/article/10.1149/1945-7111/ab9b9a
- **[R17]** "Understanding and enhancing silicon nanoparticle distribution during electrode processing," *J. Electrochem. Soc.* (2024). https://iopscience.iop.org/article/10.1149/1945-7111/ad4919
- **[R18]** "Unravelling electro-chemo-mechanical processes in graphite/silicon composites for designing nanoporous and microstructured battery electrodes," *Nature Nanotechnology* (2025). https://www.nature.com/articles/s41565-025-02027-7
- **[R19]** C.-H. Chen et al., "Development of experimental techniques for parameterization of multi-scale lithium-ion battery models," *J. Electrochem. Soc.* 167, 080534 (2020). https://doi.org/10.1149/1945-7111/ab9050
- **[R20]** "Is silicon replaceable? A physical, chemical, and electrochemical analysis of different commercial lithium-ion battery cells," *J. Electrochem. Soc.* (2025). https://iopscience.iop.org/article/10.1149/1945-7111/add112
- **[R21]** "Interplay between electrochemical reactions and mechanical responses in silicon–graphite anodes and its impact on degradation," *Nature Communications* (2021). https://www.nature.com/articles/s41467-021-22662-7
- **[R22]** "Microstructure characteristics of blend cathodes assessed by 3D-tomography methods," *ECS Meeting Abstracts* MA2016-02 (2016). https://iopscience.iop.org/article/10.1149/MA2016-02/2/205
- **[R23]** "Image segmentation for FIB-SEM serial sectioning of a Si/C–graphite composite anode microstructure based on preprocessing and global thresholding," *Microscopy and Microanalysis* (2019).
- **[R24]** T. Prill et al., "Morphological segmentation of FIB-SEM data of highly porous media," *J. Microsc.* 250, 77–87 (2013); M. Salzer et al., "On the importance of FIB-SEM specific segmentation algorithms for porous media," *Mater. Charact.* 95, 36–43 (2014).
- **[R25]** "Particle shape characterisation and classification using automated microscopy and shape descriptors in batch manufacture of particulate solids," *Particuology*. https://eprints.whiterose.ac.uk/id/eprint/82622/
- **[R26]** "High-throughput unsupervised profiling of the morphology of 316L powder particles for use in additive manufacturing," arXiv:2512.06012 (2025).
- **[R27]** "A review of the applications of explainable machine learning for lithium–ion batteries: from production to state and performance estimation," *Energies* 16(17), 6360 (2023). https://www.mdpi.com/1996-1073/16/17/6360
- **[R28]** "Explainable neural network for sensitivity analysis of lithium-ion battery smart production," *IEEE/CAA J. Autom. Sinica* (2024). https://www.ieee-jas.net/article/doi/10.1109/JAS.2024.124539
- **[R29]** "Machine learning in lithium-ion battery: applications, challenges, and future trends," *SN Computer Science* (2024). https://link.springer.com/article/10.1007/s42979-024-03046-2
- **[R30]** A. Grießer et al. (Math2Market, Zeiss), "Image segmentation methods for FIB-SEM images of cathodes," *Microscopy & Microanalysis* 2022. https://www.math2market.com/showroom/conference-presentations/presentation/image-segmentation-methods-for-fib-sem-images-of-cathodes.html
- **[R31]** S. J. Cooper et al., "TauFactor: an open-source application for calculating tortuosity factors from tomographic data," *SoftwareX* 5, 203–210 (2016). https://doi.org/10.1016/j.softx.2016.09.002
- **[R32]** "Enhanced imaging of lithium ion battery electrode materials," *J. Electrochem. Soc.* (2017). https://iopscience.iop.org/article/10.1149/2.0061701jes
- **[R33]** "Vision language models for scientific image analysis: an evaluation highlighting opportunities and challenges," *npj Computational Materials* (2026). https://www.nature.com/articles/s41524-026-02069-y
- **[R34]** Whitman & Latypov (2025), frozen foundation-model features for small materials datasets. https://arxiv.org/abs/2501.18637
- **[R35]** Particle-level DINOv2 embeddings on SEM images. https://arxiv.org/abs/2508.03235
- **[R36]** Conformal predictors. https://proceedings.mlr.press/v105/johansson19a.html
- **[R37]** Palmer et al. (2021), example textures for explaining SEM classifications. https://arxiv.org/abs/2111.03729
- **[R38]** DINOv3. https://arxiv.org/html/2508.10104v1
