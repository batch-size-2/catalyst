# Track 4 · Batch QC for electrode microstructure: Plan

Team Batch Size 2. ML: Pat. Software: Patrik. Glossary in §11, evidence for each decision in §12, references in §13.

## In short

A tool that answers one question for a battery manufacturer: **is this incoming batch of anode material the same as the reference batch, and if not, what changed, in terms a materials scientist would accept?**

- **Input:** a folder of FIB-SEM cross-section images for the incoming batch (three detector images per spot), plus the reference batch (Batch_3).
- **Output:** a batch comparison: the batch's microstructure fingerprint, what differs from the reference and by how much, how sure we are, a verdict (accept / investigate / reject) with a next action, the same result written for four audiences, what each difference means for the cell as an indicative range, and a provenance record of exactly which images, code and settings produced it.
- **Model:** nothing is trained on batch labels.
  - Measurements: brightness thresholds split each image into pore, graphite and silicon; we measure phases and every silicon particle.
  - Particle types: clustering on particle measurements, fitted once and frozen.
  - Comparison: **the batch is the unit.** We test whether the difference between batches is bigger than the strip-to-strip variation inside a batch, by shuffling strips between the two batches.
  - Explanation: templates filled from the numbers. No language model measures, decides or writes the report.
  - Optional review: after the output is written, Claude Opus may read the finished evidence and list observations worth a second look, shown apart from the report (§3.10).

## 1. Ground truth from the task designer

| Fact | Consequence for us |
|---|---|
| Anode. Bright white = silicon, darker grey = graphite, black = pore | Phase codes unchanged |
| Si:graphite ratio, particle size distribution and the pore network drive battery performance | These are the key descriptors (§3.2). The silicon key quantity is `si_graphite_ratio` |
| Particles about 30 µm across | Most likely the graphite. Si particles are a few µm. Sanity check for `graphite_chord_um`; **not** a check for Si sizes |
| ~20 images ≈ £50k; deliberately tiny; realistic for a manufacturer | Statistics must be honest at n ≈ 2–8 strips per batch. Use the ~4,000 particles, but resample by strip |
| FIB-SEM: Ga-ion beam cross-section; expect artefacts such as curtaining | `imaging()` checks for curtaining (§3.3) |
| The batch is the unit; images within a batch will differ | Per-image verdicts are gone; image groups are only descriptive |
| Core question: within-batch vs across-batch variance; would you reject batch B and can you say why | §3.5 |
| Baseline is "batch three", said with some hesitation | `baseline: Batch_3`. Confirm once more (§10 Q1) |
| Explainability above almost everything; engineers must explain it to their boss | Every verdict names its drivers in units, with example crops |
| An LLM gave good image descriptions but could not group batches or carry explanations over | No LLM classifies, decides or explains. The optional review (§3.10) only comments on a finished result |

### 1.1 Data audit (all 93 files)

| Check | Result | Consequence |
|---|---|---|
| Completeness, alignment | All 31 fields have BSE, ETD (or `SE`) and InLens; the three images of a field have identical sizes; all 8-bit | Nothing to repair |
| Coloured stitch columns | 13 fields have 1–4 px of coloured columns at the left or right edge, in all three detectors | The 8 px crop in `qc/io.py` removes all of them |
| Black level | 0 everywhere except the four P2060 images in Batch_3: 22–23 in BSE, 19 in ETD, 13–17 in InLens | Per-channel black level at load (§3.1). P2060 is an imaging outlier inside the reference (§3.3) |
| InLens saturation | 26 of 31 fields have more than 1% of pixels at 255, up to 6.8% | No brightness descriptor from raw InLens; saturated pixels count as unknown |
| Top-to-bottom shading | InLens top/bottom brightness ratio median 1.22, up to 1.92. BSE 0.79–1.22 | InLens only as a local ratio (§3.2). BSE is not flattened: its gradient may be real structure through the thickness |
| Padding, info bars | None | Nothing to crop |
| Overlap between neighbouring tiles | None (best edge match r ≤ 0.28) | No area is counted twice. Tiles of one strip are still not independent |
| Pixel size | 0.025 µm everywhere; tag differences about 0.002% | No resampling |
| Normalising between images | Not done | It would erase real differences; black-level subtraction covers the legitimate part |

### 1.2 Where the variation lives (first measurement)

With the two descriptors the code has today (`si_area_frac`, `porosity_apparent`, threshold stub) on all 31 images:

| Grouped by | `si_area_frac` | `porosity_apparent` |
|---|---|---|
| Batch folder | Barely different: one-way ANOVA p = 0.05, rank test p = 0.35 | p = 0.05 |
| Strip | Strongly different: p < 0.0001 | p = 0.005 |

Most of the variation sits between strips, not between folders. The exception is strip P2316 in Batch_1. With Batch_3 as reference, a per-image check flags only its two images (`4ih2ggld`, `5n1q8atc`): silicon fraction 0.19–0.20 against a reference range of 0.03–0.11. Batch_2 shows no difference.

Shared strips with Batch_3 as reference: P2080 (Batch_1, Batch_2, Batch_3), P2068 and P2272 (Batch_2, Batch_3). That is 1 of Batch_1's 6 strips and 3 of Batch_2's 6.

These numbers are from a stub segmentation; the variance split (§3.5) recomputes them with the real descriptors at Sync 1.

## 2. Rules

1. No Polaron models or tools.
2. No classifier trained on batch folders.
3. The report is built from measurements and templates. No language model measures, decides or explains. The only language-model step is the optional review (§3.10): it runs after the output is written, reads only the finished evidence, and its comments are shown apart from the report and labelled. It cannot change a number, a status or the verdict.
4. The frozen verdict path runs on a laptop with no network. The optional review is not part of it.
5. Images stay on our machines until Polaron says otherwise.
6. `config/decision.yaml` and `config/particle_types.json` are not edited after the `rules-frozen` tag.
7. "Different" is not "bad". We report differences; a customer tolerance decides what matters. Report wording says "differs from the reference", never "defective".
8. Particles and images are never treated as independent samples. The resampling unit is the strip segment (§3.5).
9. Every evidence file records the SHA-256 of each input image, the git commit and a hash of the config (§3.11). The same inputs give the same evidence file, apart from its timestamp.

## 3. Pipeline

### 3.1 Contract

| Stage | Function | Where | Owner | Status |
|---|---|---|---|---|
| Load | `load_field` → `Field` | `qc/io.py` | shared | exists; add `black_level` per channel (0.5th percentile) |
| Segment | `segment(channels, px_um)` → full-resolution mask | `qc/measure.py` | Pat | basic version exists |
| Image descriptors | `kpis(mask, px_um, channels)` → dict | `qc/measure.py` | Pat | 2 of 11 exist |
| Particle table | `particles(mask, px_um, channels)` → DataFrame, one row per Si particle | `qc/measure.py` | Pat | new |
| Particle types | `fit_types(particles) -> TypeModel`, `assign_types(particles, model) -> particles + type` | `qc/types.py` | Pat | new |
| Imaging check | `imaging(channels)` → dict per channel | `qc/measure.py` | Pat | new |
| Controls | `make_controls(fields, px_um, seed=0)` → `list[Control]` | `qc/controls.py` | Pat | new |
| Run | `run()` calls the above, writes `out/` | `qc/run.py` | shared | exists; new functions to wire in |
| Compare | `compare(ref: Tables, batch: Tables, cfg)` → `Evidence` | `qc/decide.py` | Patrik | replaces `judge` |
| Explain | `explain(evidence, dictionary)` → four texts | `qc/explain.py` | Patrik | new |
| Provenance | input hashes, git commit, config hash into `Evidence` | `qc/run.py` | Patrik | new (§3.11) |
| Show | API and web UI | `qc/api.py`, `web/` | Patrik | exists; new views |
| Review | `review(evidence)` → observations. Optional, after the output is written | `qc/review.py` | Patrik | new (§3.10) |

Interface decisions (settled here so nobody waits):

- `Tables` = `NamedTuple(kpis, particles, imaging)` of DataFrames filtered to one batch.
- `TypeModel` is a plain dict (feature means/SDs, cluster centres, covariances, names, unassigned threshold), saved as `config/particle_types.json`. `fit_types` runs only before the freeze; `run()` only calls `assign_types`.
- `Control` = `dataclass(name, kind: "negative" | "positive", expected_driver: str | None, source_strips: list[str], fields: list[Field])`. `run()` measures them as batch `_controls/<name>`.
- `segment()` returns a full-resolution `uint8` mask even if it works at 2× downsample internally. The thresholds are an optional argument (`thresholds=None`) so the segmentation uncertainty can rerun it with offsets.

| Output | Rows |
|---|---|
| `out/kpis.csv` | One per image: `batch, image_id, strip_id, px_um`, descriptors |
| `out/particles.csv` | One per Si particle: `batch, image_id, strip_id, particle_id, d_um, area_um2, contrast_ratio, inlens_ratio, void_frac, texture, solidity, border, type` |
| `out/imaging.csv` | One per image and channel |
| `out/masks/<batch>/<image_id>.png` | Overlay |
| `out/crops/<type>/<n>.png` | Example particle crops per type (for the gallery) |
| `out/evidence/<batch>.json` | The comparison and everything behind it, including provenance. Deterministic apart from its timestamp |
| `out/review/<batch>.json` | Observations from the optional review. A separate file, so the evidence never depends on a language model |

A descriptor that cannot be computed, or an image whose segmentation crashes, is NaN. The run never stops on one bad image.

### 3.2 Segmentation and descriptors

Phase codes unchanged: `PORE` 0, `GRAPHITE` 1, `SI` 2, `BINDER` 3, `IGNORE` 255.

| Step | What |
|---|---|
| Before | Subtract `Field.black_level` (0.5th percentile, per channel, computed at load). Gaussian σ = 1 px. Work at 2× downsample. Top and bottom 5% of rows → `IGNORE`. InLens pixels at 255 → unknown |
| Threshold | 3-class multi-Otsu per image (pore / graphite / Si) |
| After | Opening on Si. Si objects under 0.25 µm² → graphite. Thin bright rims along graphite edges (width < 0.15 µm) → `BINDER`. Fill each Si particle to find internal voids. Watershed to split touching Si. Particles touching the image border flagged `border` and left out of size statistics. Upsample the mask to full resolution |

Acceptance: two overlays per strip checked by eye; a 1-page overlay sheet goes in the pitch appendix.

**Image descriptors.** Key = counts towards the verdict. Keep the key set small: every key descriptor costs test power.

| Group | Name | Definition | Key |
|---|---|---|---|
| Silicon | `si_graphite_ratio` | Si px / graphite px: the recipe ratio the designer named. Does not move when porosity changes | **yes** |
| Silicon | `si_area_frac` | Si px / non-ignored px | (report; moves with porosity, so `si_graphite_ratio` is the key) |
| Silicon | `si_d50_um` | Area-weighted median equivalent diameter, non-border particles | **yes** |
| Silicon | `si_d90_um` | 90th percentile of the same | |
| Silicon | `si_internal_void_frac` | Dark px inside filled Si particles / filled area | **yes** |
| Silicon | `si_contrast_ratio` | (Si mode − black) / (graphite mode − black) | **yes** (dropped if imaging changed) |
| Silicon | `si_fragments_per_1e4um2` | Si objects under 1 µm per 10⁴ µm² | |
| Arrangement | `si_dispersion_cv` | CV of local Si fraction over 20 µm windows (window clipped to image) | |
| Arrangement | `si_agglomerate_frac` | Share of Si area in Si-rich domains larger than 5 µm (Si mask closed by 0.5 µm, then labelled) | (report; promote if it separates batches) |
| Arrangement | `si_corr_length_um` | Distance at which the Si two-point correlation falls to 1/e of its excess: typical Si cluster size | |
| Graphite | `graphite_chord_um` | Mean horizontal run length of graphite, runs touching the border excluded | |
| Graphite | `graphite_anisotropy` | Horizontal / vertical run length | (report only; curtaining-sensitive) |
| Pores | `porosity_apparent` | Pore px / non-ignored px | **yes** (dropped if imaging changed) |
| Pores | `pore_chord_um` | Mean run length of pore px | |
| Pores | `pore_connectivity` | Share of pore area in the largest connected pore cluster. 2D and apparent: pores can connect out of plane | (report) |

Plus **type shares** (§3.4) as key quantities. `graphite_chord_um` is not key because there are only a few 30 µm graphite particles per image, so it is noisy; promote it if the variance split (§3.5) shows it separates batches.

**Particle table.** Per Si particle: equivalent diameter, area, brightness ratio to graphite (black removed), internal void fraction, **texture** (SD of BSE inside the particle, at full resolution, divided by its mean), solidity, **`inlens_ratio`** (mean InLens inside the particle / mean InLens of the graphite in a 1–3 µm ring around it, black-corrected, pixels at 255 left out), border flag. The local graphite reference cancels the top-to-bottom InLens shading (§1.1), so the ratio describes the particle, not where it sits. `inlens_ratio` goes in the `out/particles.csv` columns.

Resolution limit we state: at 25 nm/px and a 0.25 µm² minimum, Si below about 0.5 µm is not counted as particles. Nano-Si (about 100–200 nm in many anodes [R15, R21]) shows up only in `si_area_frac` and agglomerates.

### 3.3 Imaging check

`imaging(channels)` per channel: black level (from `Field.black_level`), 1/50/99th percentiles, noise (MAD of a high-pass), sharpness (variance of Laplacian), saturated fraction, and **curtaining index** (power of column-mean brightness variation at periods 0.2–5 µm, relative to row-mean variation).

- If a batch's imaging values lie outside the reference's range (min–max over its strips, widened 10%), the report says "imaging changed", and `si_contrast_ratio` and `porosity_apparent` are reported but not used for the verdict.
- The range is built only from reference strips whose own imaging is ordinary. A reference strip far from the others (black level more than 10 grey levels from the reference median) is left out of the range and listed as "imaging outlier in the reference". On the current data that is P2060 (black level 22–23 against 0). Otherwise the range would span 0–23 and hide an imaging change in a new batch.
- If the curtaining index is high in an image, its run-length descriptors are NaN and the report names the image.

### 3.4 Particle types and unseen situations

- **Fit** (before the freeze, on all known batches): standardise `log d_um, contrast_ratio, inlens_ratio, void_frac, texture, solidity`; Gaussian mixture with k = 2, 3, 4. Pick k by **leave-one-strip-out stability** (adjusted Rand index of assignments against the full fit), not by BIC alone. Merge types that differ only in size. Name each from its defining feature in units ("large, dim: 2.1× graphite brightness, D50 4 µm").
- **Assign** (every run): nearest type by Mahalanobis distance. Further than the 99th percentile of training distances → `unassigned`.
- **Type share** per strip segment = Si area of that type / all Si area.
- **New particle type**: unassigned > `new_type_share` (5%) of a batch's Si area → REJECT with "contains a particle type not seen before" and example crops.
- **Image unlike anything seen**: an image whose descriptor vector is further from every known image than any known image is from its nearest neighbour. Listed, not a verdict trigger.
- Known gap from the quick test: the porous particles of Batch_3 do not separate with crude features. Full-resolution texture is the fix; if it still fails by Sync 1, use `void_frac` > 0.1 as a rule-based "porous" type and say so.
- Naming hypothesis to check with a mentor: the "larger, dimmer" type may be SiOx. Commercial anodes use graphite–SiOx blends [R19], and SiOx has a lower mean atomic number than Si, so it is darker in BSE. Never name it SiOx in the report without confirmation (EDS).
- **Safety net, step 1 (before the freeze if time):** distance between a batch's Si two-point correlation curves and the reference's, against the strip-to-strip spread [R12]. Explainable: "silicon is clustered at a different length scale".
- **Safety net, step 2 (evening, optional):** DINOv2 patch features with a nearest-neighbour memory bank of reference patches [R14], replacing the PCA reconstruction idea. Never in the verdict.

### 3.5 Batch comparison

**Unit.** A *strip segment* = the images of one `strip_id` inside one batch folder. Segment value = pooled over its images (area-weighted for fractions; pooled particles for D50 and type shares). Particles and images are never resampled on their own.

**Fingerprint of one batch**

| Part | Content |
|---|---|
| Descriptors | Batch value, pooled over segments, with a 90% bootstrap interval over segments |
| Distributions | Si size distribution (area-weighted), pore and graphite run lengths, one curve per segment |
| Particle types | Share of Si area per type, with interval; example crops |
| Image groups | Hierarchical clustering of the batch's images on standardised descriptors: number of groups, members, separating descriptors, and whether a group is one strip |
| Variance split | Per descriptor: share of variance between images in a strip, between strips in a batch, between batches (nested sums of squares over all known batches) |

**Difference from the reference**

| Step | Rule |
|---|---|
| Difference | Batch value − reference value, in units, with a 90% interval from a two-level bootstrap in each batch independently: segments first, then images within segments [R4] |
| Within-batch spread | `s` = pooled SD of segment values in both batches |
| Test | Statistic `T = difference / s`. Shuffle segment labels between batch and reference (exact enumeration if ≤ 5,000 arrangements, else 5,000 random). Family-wise p per key quantity from the max-\|T\| across all key quantities |
| Margin `δ` | Customer tolerance if given; else `similar_margin × s_ref` (`s_ref` = SD of the reference's segment values). Start at 1.5, the FDA tier-1 convention [R7]. Before the freeze, raise it only if a negative control comes out not SIMILAR, and record why |
| Status | DIFFERENT: p < `alpha` and \|difference\| > δ. SIMILAR: the interval lies within ±δ. UNCLEAR: otherwise |
| Drivers | Key quantities ranked by \|difference\| / δ |
| Nearest batch | Known batch with the smallest mean \|T\| over the key quantities |
| Shared strips | Segments whose strip also appears in the other batch are the same physical sample. **Main comparison without them; the comparison with them is reported as a sensitivity check**, and if the status differs the report says so (`shared_strips: exclude`; `include` makes the comparison with them the main one). Batch_2 against Batch_3 then compares 3 segments with 4: 35 arrangements, smallest possible p ≈ 0.03, still below `alpha` |
| Power limit | Number of distinct arrangements < 1/`alpha` → no quantity can be DIFFERENT; the next action says how many more strips would allow it |

**Verdict**

| Verdict | Condition |
|---|---|
| REJECT | A key quantity DIFFERENT, or a new particle type present |
| INVESTIGATE | Anything UNCLEAR, imaging changed, power limit hit, or controls failed |
| ACCEPT | Every key quantity SIMILAR, no new type, controls passed |

Next action is computed: REJECT names the top driver and the supplier check from the KPI dictionary; INVESTIGATE says how many more strips the how-many-images curve (§3.6) needs to settle the top UNCLEAR quantity.

**Config** (`config/decision.yaml`): `version`, `data_dir`, `baseline` (`Batch_3`), `reference_exclude`, `key_descriptors`, `ci_level` (0.90), `alpha` (0.10), `similar_margin`, `new_type_share` (0.05), `n_resamples` (5000), `seed`, `shared_strips` (`exclude`).

### 3.6 Uncertainty and how many images are enough

- Sampling: bootstrap and permutation over strip segments (§3.5).
- **Expected sampling spread from one image:** integral range of the Si and pore phases from each image's two-point correlation [R10, R11]. It predicts the phase-fraction SD for a given imaged area.
  - Observed strip-to-strip spread ≈ predicted → the batch is uniform and the spread is just sampling.
  - Observed ≫ predicted → real heterogeneity inside the batch; say so.
  - Also gives the image area needed for a target precision: the £50k question answered from the reference alone.
  - We implement the classical estimator ourselves (rule 1: ImageRep comes from Polaron's founders [R11]).
- Segmentation (**before the freeze**): rerun with thresholds ±5 grey levels on the reference; report the descriptor shift next to the sampling interval. If it is larger than δ for a key quantity, say so in the scientist text.
- Imaging: the negative controls.
- **How many images are enough:** subsample strips (and images within strips) from Batch_1/2/3, rerun the comparison, plot "probability of the correct status" against the number of images. Output: "N images are enough to tell these batches apart on silicon fraction." This answers the cost of imaging directly, which is the £50k point.
- Limit we state: with 2–8 strips per batch the intervals are coarse, and we say so.
- First reading of the variance split (§1.2): on the stub descriptors most variation is between strips, not between folders. The dashboard shows whatever the real descriptors give at Sync 1.

### 3.7 Controls

Built from reference images and compared against the **reference minus the source strips**, so a control is never compared with itself. Each control batch uses images from at least 2 reference strips.

| Kind | Change | Must come out |
|---|---|---|
| Negative | Brightness ±20%, contrast ±20%, black level +20, Gaussian noise σ = 5, synthetic curtaining stripes | SIMILAR |
| Positive | Si particles copied in from other reference images (+50%, +100% Si fraction) | DIFFERENT, driver `si_graphite_ratio` |
| Positive | Voids punched into 30% of Si particles | DIFFERENT, driver `si_internal_void_frac` or porous share |
| Positive | Si particles scaled up 1.5× | DIFFERENT, driver `si_d50_um` |

`controls.passed` = every control has the expected status and, for positives, the expected top driver.

### 3.8 Explanation

One result, four texts, all filled from the evidence and `config/kpi_dictionary.yaml` by templates in `qc/explain.py`. Two rules: every number in a text comes from `evidence.json`, and causes are always worded "possible causes to check".

| Audience | Gets | Example |
|---|---|---|
| Factory operator | Traffic light, one sentence, one action | "Batch differs from the reference. Hold it and call the process engineer." |
| Process engineer | The drivers in units against the reference, possible causes to check, pictures | "Silicon to graphite is 0.27 against 0.09 in the reference, and the median silicon particle size is 4.1 µm against 3.2 µm. Check the formulation ratio and the silicon powder lot." |
| Materials scientist | Distributions, particle-type gallery with definitions, image groups, variance split, intervals, method and limits | Size distribution overlay; type shares with intervals |
| Manager | Same or different, how sure, what it costs to be surer, what it means for the cell | "Different from the reference, driven by the silicon additive: more capacity, but more swelling. No further imaging needed to confirm." |

`config/kpi_dictionary.yaml`, per descriptor and per particle type: plain name, unit, meaning, why it matters for the cell (capacity, swelling, rate, cycle life), possible causes when higher or lower, what to check at the supplier. Pat writes it; a mentor reviews the causes.

**Indicative consequences.** For the drivers, "why it matters" carries a range computed from the measured difference with textbook relations:

| Quantity | Relation | Assumptions shown with it |
|---|---|---|
| Capacity | Silicon share of the solid (area fraction estimates volume fraction) × specific capacity | Graphite about 372 mAh/g; Si about 3,600 mAh/g, SiOx about 1,500–2,000 mAh/g. Range spans Si to SiOx until the particle type is confirmed (§10 Q9) |
| Swelling | Silicon share × lithiation expansion | Si about 280%, graphite about 10% |
| Ion transport (rate) | Bruggeman: effective transport ∝ porosity^1.5 | Apparent porosity; same bias in both batches |

Example with stub numbers: strip P2316 has silicon as about 22% of the solid against about 8% in the reference, i.e. roughly +40% to +70% theoretical capacity and about 3× the silicon-driven swelling, a cycle-life risk. These ranges are context for people and never inputs to the verdict. No cell simulation and no tortuosity (§12, R31): 2D sections hide 3D connectivity, most of what drives cell performance is not in these images, and there is no electrochemical data to check against.

Pictures go with the words: for each driver, the most typical reference image next to the most different batch image, with the relevant phase highlighted.

### 3.9 Infrastructure

Everything runs locally and offline. Three processes:

| Process | Command | Port | Role |
|---|---|---|---|
| Pipeline | `uv run python -m qc.run --batch data/<batch>` | – | Measure → compare → write `out/`. This is what we freeze and run on the unseen batch |
| API | `uv run uvicorn qc.api:app --reload` | 8000 | Thin FastAPI wrapper: reads `out/`, saves uploads to `data/`, calls `run()`. No QC logic |
| Web UI | `cd web && npm install && npm run dev` | 5173 | Vite + React + TypeScript + Tailwind. Talks only to `/api` |

Other commands: `uv run python -m qc.measure` (ML only), `uv run pytest`. Setup: `brew install uv node@22`. The optional review (§3.10) is the only step that uses a network, and it runs after the output is written.

### 3.10 Optional review (after the output)

A second pair of eyes on the finished result, placed at the output end of the pipeline, never near measurement or comparison.

- **When:** after `out/evidence/<batch>.json` and the four texts exist. A separate command (`uv run python -m qc.review --batch <name>`) or a button in the UI. Never inside `qc.run`.
- **Input:** the finished evidence, the KPI dictionary and, only if rule 5 allows images to leave our machines, the overlay crops of the drivers.
- **Model:** Claude Opus (`claude-opus-5-5`).
- **Output:** up to five observations worth a second look, each citing the evidence field it is about, written to `out/review/<batch>.json`. Every number in an observation is checked against the evidence; observations that do not match are dropped.
- **Shown as:** "AI observations, unverified", in its own panel, apart from the report and the verdict.
- **Measured:** run it on the controls (§3.7). Report how often it mentions the injected change of a positive control, and how often it raises something on a negative one.
- **Not in the 2-minute demo**, so the pitch point "why not an LLM" (§8) stays clean. First to cut (§9).

### 3.11 Provenance

Every evidence file records: the SHA-256 of each input image, the git commit, a hash of `config/decision.yaml` and `config/particle_types.json`, the `rules-frozen` tag if present, and a timestamp. Same inputs, code and config → identical evidence apart from the timestamp. In a dispute along the supply chain (§8), this record shows exactly what was measured, with which rules, and that nothing was tuned afterwards.

### 3.12 Training policy

Nothing is trained on batch labels. If time allows after the freeze, one trained piece (for example a small classifier for voids or a segmenter from hand-drawn strokes) is kept only if it makes the positive controls easier to detect on strips it never saw.

## 4. Sync points

| When | What |
|---|---|
| Now | Both read §3.1 interface decisions; object within the hour or they stand |
| Sync 1 | Real `out/kpis.csv` and `out/particles.csv` for all three batches go through `compare`. Reference against itself split by strips → SIMILAR. Variance split computed |
| Sync 2 | Types fitted and frozen to `config/particle_types.json`. Controls pass. `similar_margin` fixed |
| Dry run, 1 h before the drop | Batch_2 as if unseen: refit types without Batch_2 (so the dry run never sees its own particles), then one command. Restore the full fit afterwards |
| Freeze, 30 min before the drop | `git tag rules-frozen`, push |
| Drop | One run. Commit the output unchanged |
| Sunday 14:45 | Submission: 2-minute video, repo, description |

## 5. Steps: Pat (ML)

**Before the drop** (critical path in bold)

1. Setup: `uv sync`, `uv run pytest`, link `data/`, `uv run python -m qc.measure`, look at the overlays.
2. **`segment()`** per §3.2, full-resolution output, optional `thresholds`. Two overlays per strip by eye.
3. **`kpis()`**: the key descriptors first (`si_graphite_ratio` is the silicon key), then the rest. Add `si_graphite_ratio`, `graphite_chord_um`, `graphite_anisotropy`, `pore_chord_um`, `pore_connectivity`, `si_agglomerate_frac`, `si_corr_length_um` to `KPI_UNITS` and the fixture.
4. **`particles()`**: the particle table including `inlens_ratio` (local graphite reference, saturated pixels out, §3.2), texture at full resolution, crops for the gallery.
5. **Sync 1.** Look at the variance split: which descriptors actually separate the three batches?
6. **`qc/types.py`**: fit, LOSO stability, naming, unassigned rule, persist. Porous fallback rule if needed.
7. `imaging()` with the curtaining index, using `Field.black_level`.
8. `qc/controls.py`: the table in §3.7, with tests that each control changes what it should on synthetic images.
9. Threshold variants (±5 grey levels) on the reference, and the integral-range estimate per image (§3.6).
10. **Sync 2.** `config/kpi_dictionary.yaml`; ask a mentor to check the causes.
11. **Dry run, freeze.**

**At the drop**

12. Look at the overlays and type assignments. Change nothing.

**Evening**

13. How-many-images curve (§3.6): empirical subsampling next to the integral-range prediction.
14. Strip-leak chart: classifier on folder labels, random split vs leave-one-strip-out [R5]. Shows why per-image ML would have fooled us.
15. Two-point-correlation safety net; DINOv2 nearest-neighbour safety net if time.

**Day 2**

16. Pitch figures: particle-type gallery, variance split, size distributions per batch, how-many-images curve, strip seams.

## 6. Steps: Patrik (software)

**Before the drop**

1. `config/decision.yaml`: `baseline: Batch_3` and the keys in §3.5, including `shared_strips`. Update the README.
2. `qc/schema.py`: new `Evidence` — `fingerprint` (descriptors with intervals, type shares, image groups, variance split), `differences[]` (name, unit, reference, batch, difference, interval, margin, p, status), `drivers[]`, `nearest_batch`, `shared_strips` (listed segments plus the status with them included), `new_type_share`, `imaging_changed`, `imaging_outliers_in_reference`, `power_limited`, `controls`, `verdict`, `next_action`, `explanations {operator, engineer, scientist, manager}`, `provenance`, `config_version`. Mirror in `web/src/types.ts`; update `tests/fixtures/` and `tests/test_contract.py`.
3. `qc/io.py`: `black_level` per channel on `Field`. `qc/run.py`: call `particles`, `assign_types`, `imaging`, `make_controls`; write the outputs in §3.1; fill `provenance` (§3.11).
4. `qc/decide.py`: `compare()` per §3.5 (bootstrap, permutation with max-statistic, margin, status, drivers, nearest batch, shared strips out of the main comparison and in the sensitivity check, power limit, verdict, next action, controls check). Imaging range without reference outlier strips (§3.3).
5. `qc/explain.py`: four templates, with the indicative consequences (§3.8) under each driver.
6. Tests: reference split by strips → ACCEPT; one key quantity shifted by 3 δ → REJECT with that driver first; 2 strips per batch → INVESTIGATE with power limit; negative controls SIMILAR, positive controls DIFFERENT with the right driver; segments of shared strips left out of the main comparison; the same inputs give the same evidence apart from the timestamp.
7. **Sync 1, Sync 2.**
8. UI: verdict card with four audience tabs; driver chart (difference against ±δ); distribution overlays; particle-type gallery with shares; variance-split bar; typical reference image next to the most different batch image per driver; image groups; per-image browser with overlay; "shared strip" badge; provenance panel.
9. **Dry run, freeze.**

**At the drop**

10. `uv run python -m qc.run --batch data/<unseen>`. Copy the evidence to `results/` and commit it.

**Evening**

11. Batch-by-batch difference table: the unseen batch against every known batch, and every known pair.
12. How-many-images panel. Printable one-page report per audience.
13. Optional review (§3.10): `qc/review.py`, `out/review/`, the "AI observations, unverified" panel, and its hit rate on the controls.

**Day 2**

14. Deploy, 2-minute video, README and architecture diagram, pitch rehearsal.

## 7. Tools

| Tool | Use | Who |
|---|---|---|
| Hugging Face | DINOv2 weights for the optional safety net | Pat |
| Modal | Control sweeps and how-many-images curve, only after permission to upload | Both |
| Devin | Own branch: `qc/controls.py` with synthetic tests | Brief now, merge before Sync 2 |
| Antigravity | Build and browser-test the UI | Patrik |
| AMASS | 20-minute test for citations in the KPI dictionary; drop if thin | Either |
| Claude API | Optional review after the output (§3.10). Not in the frozen path, not in the demo. Image crops only with permission (rule 5) | Patrik |

## 8. Demo and pitch

| Time | Shot |
|---|---|
| 0:00–0:15 | £50k of FIB-SEM images, 31 fields. "Is this delivery the same material we qualified?" |
| 0:15–0:45 | Drop a folder. Verdict, driver chart against the margin, "controls passed" |
| 0:45–1:10 | Particle-type gallery and shares per batch; variance split: where the variation lives, as measured (so far: between strips, with one Batch_1 strip a different material) |
| 1:10–1:35 | Same result for operator, engineer, scientist, manager, with what the drivers mean for the cell |
| 1:35–2:00 | Unseen batch: frozen-tag timestamp, input hashes, committed result. "N images are enough" |

Pitch points from the task designer:

- Three uses of this data: choosing a supplier, batch QC (this tool), root-cause analysis when something goes wrong.
- Liability chain: carmaker sues cell maker, cell maker sues material supplier, driver sues everyone. Our frozen rules, committed evidence, input hashes and named drivers are the audit trail.
- The value is catching it before the cells go into cars: "we qualified you on this microstructure; this batch doesn't match, here is how."
- Why not an LLM: Polaron tested it; it described images but could not group batches reproducibly. Our drivers are measurements a materials scientist can check.
- Do **not** quote the "£2bn" figure unless we find a source.

## 9. Cut list (in this order, if time runs short)

1. Optional review (§3.10).
2. DINOv2 safety net.
3. Strip-leak chart.
4. Two-point-correlation safety net and `si_corr_length_um`.
5. Integral-range estimate (keep the empirical how-many-images curve).
6. Threshold-variant uncertainty (state it as a limit instead).
7. Image groups (keep the variance split).
8. Curtaining index (keep the other imaging checks).
9. Particle types beyond a rule-based fallback (keep "dim/large" and "porous" by thresholds).

Never cut: segmentation with overlays, key descriptors, strip-level comparison, controls, frozen tag, provenance, templates.

**Complete entry:** Pat 1–12, Patrik 1–10.

## 10. Open questions for the mentors

1. Batch_3 is the reference: confirmed?
2. Images in different folders are adjacent pieces of one strip (`cfe5vt7s` → `r17byphk` → `ffwubibz`). Intended, or should shared strips be dropped?
3. When does the unseen batch drop, and what do you want back: a verdict, the differences, or both?
4. The three kinds of bright particle: are they all silicon (e.g. different Si or SiOx products, porous Si)?
5. Which two or three descriptors matter most, and at what tolerance?
6. Same detectors, pixel size and FIB prep for the unseen batch?
7. Can someone review the "possible causes" in our KPI dictionary?
8. May images be uploaded to Modal, Hugging Face, Devin, and Claude (for the optional review, as small crops)?
9. Is the "larger, dimmer" particle type SiOx? Is there EDS for any of these fields?
10. Rule 1 says no Polaron tools. May we cite and reimplement published methods from Polaron's founders (ImageRep, TauFactor), or should we stick to the classical statistics?
11. Which image direction runs through the electrode thickness? (Needed for anisotropy, `pore_connectivity` and any through-thickness profile.)
12. Are 3D FIB-SEM stacks available for these fields, or only single 2D sections?
13. Is the binder visible in these images, and should it be its own phase?

Contact: Martin, a battery scientist (previously battery R&D at JLR), on Discord or Slack. The mentors want questions.

## 11. Glossary

| Term | Meaning |
|---|---|
| Anode | The negative battery electrode. Ours is mostly graphite |
| Graphite | Main anode material. Large dark-grey flakes in BSE |
| Si, silicon particle | Silicon-based additive. The bright particles in BSE |
| SiOx | Silicon suboxide, a common commercial silicon additive. Darker than Si in BSE |
| Pore | Empty space between particles. Black in BSE |
| Apparent porosity | Pore share measured from a 2D image. Biased, because the back of open pores is visible |
| Phase | One kind of material in the image (pore, graphite, Si) |
| Microstructure | How particles and pores are sized, shaped and arranged at the micrometre scale |
| Batch | One delivery of material |
| Baseline, reference | The batch others are compared against. Batch_3 |
| SEM | Scanning electron microscope |
| FIB-SEM | Focused ion beam cuts a cross-section, then the SEM images it |
| Curtaining | Vertical streaks left by uneven FIB milling. An artefact, not material |
| BSE | Backscattered-electron image. Brightness follows composition |
| ETD, SE | Standard secondary-electron detector. Shows surface shape |
| InLens | Secondary-electron detector inside the column. Sensitive to thin surface films |
| Field, image | One imaged region with its three detector images |
| Strip | One long continuous image that was cut into several fields |
| µm, nm, px | Micrometre, nanometre, pixel. One pixel is 25 nm |
| Grey level | Pixel brightness, 0 to 255 |
| Black level | The grey level of "nothing". A detector setting |
| Descriptor, KPI | One measured number describing the microstructure |
| Key descriptor, key quantity | A descriptor or type share that counts towards the verdict |
| Segmentation, mask | Labelling every pixel with its phase; the resulting label image |
| Overlay | The mask drawn on the image for checking by eye |
| Threshold, multi-Otsu | A grey-level cut-off; a standard way to pick cut-offs automatically |
| Opening | Clean-up that removes specks |
| Watershed | Standard method to split touching particles |
| Equivalent diameter | Diameter of a circle with the particle's area |
| D50, D90 | Size below which 50% or 90% of particle area falls |
| Size distribution | How much of the particle area falls in each size range |
| Run length, chord | Length of an unbroken run of one phase along a line. Its average is a size measure |
| Anisotropy | Horizontal run length divided by vertical: how flat and aligned the flakes lie |
| Solidity | Particle area divided by the area of its outline stretched tight. Low means ragged or broken |
| Texture | Brightness variation inside a particle. High means speckled or porous |
| CV | Standard deviation divided by mean |
| Fingerprint | Everything we measure about one batch: descriptors, distributions, particle types, image groups, variance split |
| Clustering | Grouping similar items automatically, without labels |
| Particle type | A group of similar silicon particles found by clustering |
| Image group | A group of similar images inside one batch |
| Unassigned | A particle that fits none of the known types |
| Interval | The plausible range of a value given how few images we have |
| Resampling, bootstrap | Recomputing a value many times on random re-draws of the strip segments to get its interval |
| Driver | A key quantity that explains most of the difference between two batches |
| Similar, different, unclear | Interval within ±δ; significant and beyond δ; anything else |
| Negative / positive control | Test images with a known answer: must come out similar / different |
| Tolerance | The difference a customer accepts |
| KPI dictionary | Our file of plain-language meanings, causes, checks and consequences for each descriptor |
| Template | Fixed sentence with slots filled from the numbers |
| DINOv2 | Pretrained vision model, used only as an optional safety net |
| Contract, schema | Agreed function signatures, column names and units |
| `evidence.json` | Everything behind one comparison. The UI reads only this |
| Freeze, tag | Locking the settings before the unseen batch, with a timestamped git marker |
| Dry run | Full rehearsal on data we already have |
| Strip segment | The images of one strip inside one batch folder. Our unit for statistics |
| Permutation test | Shuffle strip segments between two batches many times; if the real difference is rarely matched, the batches differ |
| Max-statistic | Using the largest shuffled difference across all quantities, so testing many at once does not inflate false alarms |
| Margin δ | The smallest difference we call real: a customer tolerance, or a multiple of the reference's strip-to-strip spread |
| Variance split | How much of a descriptor's variation lies between images, between strips, and between batches |
| Power limit | Too few strips for any difference to be called real |
| Two-point correlation | Probability that two points a distance r apart are both silicon (or both pore). How it decays gives a cluster length scale |
| Integral range | Area over which a phase "repeats itself". Sets how much a phase fraction varies between images of a given size |
| SiOx | Silicon suboxide, a common commercial silicon additive. Darker than Si in BSE |
| Equivalence test | Showing two things are the same within a margin, rather than failing to show they differ |
| Si:graphite ratio | Silicon area divided by graphite area. Follows the recipe; unlike the area fraction, it does not move with porosity |
| Pore connectivity | Share of pore area in the largest connected pore cluster. Apparent in 2D |
| Shared strip | A strip with images in both batches being compared: the same physical sample on both sides |
| Imaging outlier in the reference | A reference strip whose imaging (e.g. black level) is far from the others; left out of the imaging range |
| Indicative consequence | A range for what a difference means for the cell (capacity, swelling, rate), from textbook relations. Never part of the verdict |
| Bruggeman relation | Rule of thumb: ion transport through a porous layer scales with porosity^1.5 |
| Provenance | Hashes of the input images, the git commit and the config hash stored with a result, so it can be reproduced exactly |
| SHA-256, hash | A fingerprint of a file; any change to the file changes it |
| AI observation | A comment from the optional review. Shown apart from the report, unverified |

## 12. Evidence for each decision

Strength: **strong** = direct evidence on our kind of problem; **analogous** = established practice in another field, transferred; **partial** = supports part of it, or only as a caveat. Where the literature cuts against us, it says so.

### Problem framing and explainability

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| Measure interpretable descriptors; no black box plus post-hoc explanation (rule 3, §3.8) | [R1] | strong | For high-stakes decisions, use models that are interpretable by design; post-hoc explanations of black boxes are often unfaithful |
| No LLM classifies, decides or explains (rule 3) | [R2], [R3]; the task designer's own test | strong | Multimodal LLMs fall well short of experts on materials-characterisation images, especially on spatial reasoning and fine visual detail. Newer models are improving but are still below expert level [R33] |
| Explainable ML is the direction in battery production | [R27], [R28], [R29] | analogous | Reviews and production studies favour interpretable models for electrode properties; small datasets and black boxes are named obstacles |
| "Different" is not "bad"; report differences and let tolerances decide (rule 7) | [R9] | analogous | ICH Q5E: comparability means "highly similar", not identical, judged on the quality attributes that matter |
| Uses: supplier choice, batch QC, root cause; teardown comparisons (§8) | [R19], [R20] | strong | Teardown studies compare commercial anodes on Si content and particle size; one measured Si at 2.43% with five cross-validated methods |

### Statistics

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| Strip segment as the unit; never treat particles or images as independent (rule 8, §3.5) | [R4] | strong | Treating nested measurements as independent gave over 45% false positives at a nominal 5% |
| Two-level bootstrap for intervals (§3.5) | [R4] | strong | Resampling each level in turn keeps the error rate and retains more power than averaging to the top level |
| Permutation test with max-statistic across key quantities (§3.5) | [R6] | strong | Westfall–Young maxT controls the family-wise error rate with minimal assumptions |
| Margin 1.5 × reference spread; SIMILAR = 90% interval inside ±δ (§3.5) | [R7] | analogous | FDA tier-1 analytical similarity: 90% CI of the mean difference within ±1.5 σR of the reference lots |
| Reference spread from segment values, not images (§3.5) | [R8] | partial | When reference lots are correlated, their sample SD underestimates the true spread and margins come out too tight. Images cut from one strip are correlated in the same way |
| Tiers: key descriptors tested, the rest reported (§3.2) | [R7] | analogous | FDA ranks attributes by risk: equivalence test for tier 1, quality range for tier 2, visual comparison for tier 3 |
| Leakage check by leave-one-strip-out (§5 step 14) | [R5] | strong | Leakage affected 294 papers in 17 fields; group-aware splits are the standard fix |
| Particle-type count chosen by stability, not a score (§3.4) | [R13] | strong | Stability of cluster assignments on resampled data is a validated way to choose k |

### Microstructure measurement

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| Si fraction is key (§3.2) | [R21], [R20] | strong | Commercial Si–graphite anodes hold only about 2–3 wt% Si; small changes matter for capacity and cycle life |
| Si size (D50, D90) is key (§3.2) | [R15] | strong | Si fracture on lithiation depends strongly on particle size. Caveat: their critical size is about 150 nm, below our resolution, so we can only see shifts in the µm-scale particles |
| Internal voids and a "porous" type (§3.2, §3.4) | [R18] | strong | Commercial µ-Si can have engineered internal porosity that controls swelling and stability |
| Si dispersion and agglomerates (§3.2) | [R16], [R17] | strong | Si agglomerates up to about 10 µm form during processing, are hard to see, and cause hot spots, protrusions and self-discharge |
| Graphite chord and anisotropy (§3.2) | [R16] | partial | Graphite size changes packing, voids and Si distribution; flakes lie mostly parallel to the current collector, which is why anisotropy is informative |
| Particle types by clustering descriptors (§3.4) | [R25], [R26] | analogous | Shape descriptors with k-means or GMM track batch-to-batch variation in particulate products |
| InLens/BSE ratio as a type feature (§3.2) | [R22] | partial | Combining InLens and ETD separated three active materials in a FIB-SEM blend electrode (cathode, conference abstract) |
| "Larger, dimmer" type may be SiOx (§3.4) | [R19] | partial | Commercial anodes use graphite–SiOx. Hypothesis only until EDS or a mentor confirms |
| Threshold segmentation (§3.2) | [R23] | strong | Deterministic global thresholding was stable on FIB-SEM of a Si/C–graphite anode |
| … but trained segmenters can do better | [R30] | **against** | On FIB-SEM cathodes a 3D U-Net beat thresholds and watershed. We keep thresholds (no labels, rule 2, deterministic) and check overlays by eye; a trained segmenter is a post-freeze option (§3.12) |
| "Apparent" porosity; imaging-sensitive (§3.2, §3.3) | [R24] | strong | FIB-SEM shine-through makes pore segmentation biased. The bias is roughly constant if prep and imaging are the same, so differences still mean something; it isn't constant if imaging changed |
| Curtaining check (§3.3) | [R23], [R32] | strong | Vertical curtaining streaks are common in FIB-SEM and need detecting or filtering (Fourier filter) before quantification |
| Two-point correlation as fingerprint and safety net (§3.4) | [R12] | strong | 2-point statistics are the standard rigorous basis for comparing microstructure ensembles |

### Uncertainty and how many images

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| Integral range: expected spread and area needed (§3.6) | [R10] | strong | Defines RVE size by the precision needed and links the variance of phase fractions to the integral range |
| Same from a single image via the two-point correlation (§3.6) | [R11] | strong | Predicts phase-fraction uncertainty and the image size needed from one micrograph. From Polaron's founders: reimplement the classical method, ask before using their code (§10 Q10) |
| Segmentation uncertainty before the freeze (§3.6) | [R11] | partial | ImageRep's own docs warn that segmentation uncertainty may be larger than sampling uncertainty |

### Optional pieces

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| DINOv2 patch nearest-neighbour safety net (§3.4) | [R14] | strong | Training-free DINOv2 patch kNN is state of the art in few-shot industrial anomaly detection. It flags *where*, not *why*, so it stays out of the verdict |
| Tortuosity: not added | [R31] | — | Tortuosity matters for pore transport, but it is a 3D quantity and TauFactor comes from Polaron's founder. Revisit only with mentor approval |
| Optional review after the output (§3.10) | [R2], [R3], [R33]; the designer's own test | partial | The same sources that keep LLMs out of measuring and deciding. So the review only comments on a finished result, its numbers are checked, and its hit rate on the controls is measured and shown |

### Decisions from our own data analysis

| Decision (section) | Support | Strength | What it says / caveat |
|---|---|---|---|
| `si_graphite_ratio` as the silicon key (§3.2) | Designer's own term; [R20], [R21] for why Si content matters | strong | The ratio follows formulation and is independent of porosity. `si_area_frac` stays as a reported number |
| Shared strips out of the main comparison (§3.5) | Our audit (§1.2); [R4] | strong | Half of Batch_2's strips are also in Batch_3. Measurements on one strip are correlated, the same reason as rule 8 |
| `inlens_ratio` against local graphite (§3.2) | Our audit (§1.1) | strong | InLens saturation and top-to-bottom shading would otherwise leak position into a particle feature |
| Imaging range without reference outlier strips (§3.3) | Our audit (§1.1) | strong | P2060's black level alone would widen the range to 0–23 |
| Indicative consequences (§3.8) | Textbook values; [R15], [R18], [R21] | partial | Directions are well established; magnitudes depend on Si vs SiOx and on 3D structure we cannot see, hence ranges |
| Provenance (§3.11) | [R9] | analogous | Comparability decisions in regulated manufacturing rest on traceable, reproducible records |

## 13. References

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
- **[R12]** S. R. Niezgoda, A. K. Kanjarla, S. R. Kalidindi, "Novel microstructure quantification framework for databasing, visualization, and analysis of microstructure data," *Integr. Mater. Manuf. Innov.* 2:3 (2013).
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
