# Track 4 · Batch QC for electrode microstructure: Plan

Team Batch Size 2. ML: Pat. Software: Patrik. Glossary in [§10](#10-glossary).

## In short

A tool that tells a battery manufacturer **how an incoming batch of electrode material differs from the reference batch**, in microstructure terms that factory staff, engineers, materials scientists and managers each understand.

- **Input:** a folder of microscope images for the incoming batch (three detector images per spot), plus the same for the reference batch (Batch_3).
- **Output:** a batch comparison:
  - the batch's microstructure fingerprint: measured properties, and the kinds of particle it contains and in what share;
  - what differs from the reference, by how much, and how sure we are;
  - a verdict (accept / investigate / reject) and a next action;
  - the same result written for four audiences.
- **Model:** nothing is trained.
  - Measurements: brightness thresholds split each image into pore, graphite and silicon; we measure particles and phases from that.
  - Particle types and image groups: clustering on those measurements.
  - Comparison: resampling statistics.
  - Explanation: templates filled from the numbers. No language model writes the report.

From the mentors: the task is telling batches apart, not judging images one by one; images are expensive, so it must work on few images and on situations it has not seen; and the explanation must be in the language of the people who use it.

---

## 1. Rules

1. No Polaron models or tools.
2. No classifier trained on batch folders.
3. The report is built from measurements and templates. No language model measures, decides or explains.
4. The frozen verdict path runs on a laptop with no network.
5. Images stay on our machines until Polaron says otherwise.
6. `config/decision.yaml` is not edited after the `rules-frozen` tag.
7. "Different" is not "bad". We report differences; tolerances from the customer decide what matters.

## 2. Data facts we act on

| Fact | What we do |
|---|---|
| 31 fields: Batch_1 = 7, Batch_2 = 7, Batch_3 = 17. Three aligned images each (BSE, ETD or `SE`, InLens) | BSE is the main channel |
| Batch_3 is "kind of" the baseline (mentor) | `baseline: Batch_3`. Also compare every pair of batches |
| 25 nm per pixel, read from the TIFF tags | All sizes in µm |
| Fields are cuts from 13 longer strips; 5 strips span more than one folder | The strip is the unit for uncertainty. `strip_id` (image height and resolution tag) identifies it. Never a feature |
| About 4,000 silicon particles across the 31 images | Particle-level statistics are where a small image set still has plenty of data |
| Grey levels differ between strips (detector settings) | Subtract the black level before any brightness measure |
| Three kinds of silicon particle by eye: small dense bright (most strips); larger and dimmer (`4ih2ggld`, `5n1q8atc`, Batch_1, strip "P2316"); porous inside (`x7u69zsw`, `tuy3zymq`, `kbdh4tri`, `71vgq3fw`, Batch_3) | Particle types found by clustering (§3.5) |

Quick test of particle clustering (crude features, 3 types): one "dimmer, less compact" type holds 97% of the silicon area in strip P2316 and 58% in Batch_1, against 15% in Batch_2 and 11% in Batch_3. The porous particles of Batch_3 are not separated yet; that needs a better texture feature.

## 3. Pipeline

### 3.1 Contract

`qc/schema.py` on `main` is the contract.

| Stage | Function | Where | Owner | Status |
|---|---|---|---|---|
| Load | `load_field` → `Field` | `qc/io.py` | shared | exists |
| Segment | `segment(channels, px_um)` → mask | `qc/measure.py` | Pat | basic version exists |
| Image descriptors | `kpis(mask, px_um, channels)` → one row per image | `qc/measure.py` | Pat | 2 of 11 exist |
| Particle table | `particles(mask, px_um, channels)` → one row per silicon particle | `qc/measure.py` | Pat | new |
| Particle types | `fit_types(particles)`, `assign_types(particles, model)` | `qc/types.py` | Pat | new |
| Imaging check | `imaging(channels)` → black level, noise, sharpness per channel | `qc/measure.py` | Pat | new |
| Controls | `make_controls(channels, px_um)` → altered copies with a known answer | `qc/controls.py` | Pat | new |
| Run | `run()` calls the above, writes `out/` | `qc/run.py` | shared | exists; new functions to wire in |
| Compare | `compare(baseline, batch, cfg)` → `Evidence` | `qc/decide.py` | Patrik | replaces the per-image `judge` |
| Explain | `explain(evidence)` → four texts | `qc/explain.py` | Patrik | new |
| Show | API and web UI | `qc/api.py`, `web/` | Patrik | exists; new views |

| Output | Rows |
|---|---|
| `out/kpis.csv` | One per image: `batch, image_id, strip_id, px_um`, descriptors |
| `out/particles.csv` | One per silicon particle: `batch, image_id, strip_id, particle_id, d_um, area_um2, contrast_ratio, void_frac, texture, solidity, type` |
| `out/imaging.csv` | One per image and channel |
| `out/masks/<batch>/<image_id>.png` | Overlay |
| `out/evidence/<batch>.json` | The comparison and everything behind it |

A descriptor that cannot be computed, or an image whose segmentation crashes, is written as NaN. The run never stops on one bad image. Shared by both of us: `qc/schema.py`, `tests/test_contract.py`, `tests/fixtures/`.

### 3.2 Segmentation and descriptors

| Code | Phase | Look in BSE |
|---|---|---|
| 0 | `PORE` | black |
| 1 | `GRAPHITE` | dark grey flakes |
| 2 | `SI` | bright particles |
| 3 | `BINDER` | thin films at particle edges |
| 255 | `IGNORE` | excluded pixels |

**Now in the code:** Gaussian blur σ = 2 px on BSE, then 3-class multi-Otsu fitted on a 4× subsample. Known gap: bright binder fringes land in `SI`.

**Target:**

| Step | What |
|---|---|
| Before | Subtract black level (0.5th percentile). Light Gaussian smooth. Work at 2× downsample. Top and bottom 5% of rows → `IGNORE` |
| Threshold | 3-class multi-Otsu per image: pore, graphite, Si |
| After | Small opening on Si. Drop Si objects under 0.25 µm². Fill each Si particle to find internal voids. Split touching particles (watershed). Exclude particles cut by the image border from size statistics. Convert px → µm |

**Image descriptors** (`KPI_UNITS`). Key = used for the verdict; the rest are reported only.

| Group | Name | Definition | Key | Status |
|---|---|---|---|---|
| Silicon | `si_area_frac` | Si pixels / non-ignored pixels | yes | exists |
| Silicon | `si_d50_um` | Area-weighted median equivalent diameter | yes | to write |
| Silicon | `si_d90_um` | 90th percentile of the same | | to write |
| Silicon | `si_internal_void_frac` | Dark pixels inside filled Si particles / filled area | yes | to write |
| Silicon | `si_contrast_ratio` | (Si mode − black level) / (graphite mode − black level) | yes | to write |
| Silicon | `si_fragments_per_1e4um2` | Si objects under 1 µm per 10⁴ µm² | | to write |
| Arrangement | `si_dispersion_cv` | Variation of local Si fraction across 20 µm windows | | to write |
| Graphite | `graphite_chord_um` | Mean horizontal run length of graphite pixels: a particle-size measure that needs no particle splitting | yes | add |
| Graphite | `graphite_anisotropy` | Horizontal / vertical run length: how flat and aligned the flakes lie | | add |
| Pores | `porosity_apparent` | Pore pixels / non-ignored pixels | | exists |
| Pores | `pore_chord_um` | Mean run length of pore pixels: a pore-size measure | | add |

**Particle table.** Per silicon particle: equivalent diameter, area, brightness ratio to graphite (black level removed), internal void fraction, internal texture (brightness variation inside the particle, measured at full resolution), solidity.

### 3.3 Imaging check

`imaging(channels)` returns black level, grey-level percentiles, noise, sharpness and saturated fraction per channel. If a batch's images sit outside the reference's range, the report says "imaging changed", and `si_contrast_ratio` and `porosity_apparent` are reported but not used for the verdict.

### 3.4 Unseen situations

- **New particle type.** A particle far from every known type is "unassigned". If unassigned particles exceed 5% of a batch's silicon area, the report says "contains a particle type not seen before" and shows examples.
- **New image group.** An image far from every image of the known batches in descriptor space is listed as "unlike anything seen".
- **Safety net (optional, evening):** DINOv2-base features on BSE, distance to the reference images. Only used to say "something changed that our descriptors do not capture".

### 3.5 Batch comparison

**Fingerprint of one batch**

| Part | Content |
|---|---|
| Descriptors | Batch value of each descriptor, pooled over its images, with a 90% interval |
| Distributions | Silicon particle size distribution (area-weighted); pore and graphite run lengths |
| Particle types | Types found by clustering particles on size, brightness ratio, voids, texture and shape. Each type gets a plain name from its defining feature ("large, dim", "porous"), its values in units, example crops, and its share of the batch's silicon area with an interval |
| Image groups | Hierarchical clustering of the batch's images on the descriptors: how many groups, how many images in each, which descriptors separate them, and whether a group is just one strip |

Clustering rules: few types (2 to 4), chosen for stability when a strip is left out, not by a score alone. Types that differ only in size are merged.

**Difference from the reference**

| Step | Rule |
|---|---|
| Difference | Per descriptor and per type share: batch value − reference value, with a 90% interval from resampling strips |
| Noise floor | How much two random halves of the reference differ from each other, from repeated splits of its strips |
| Status | DIFFERENT: interval lies beyond the noise floor. SIMILAR: interval lies inside it. UNCLEAR: straddles |
| Drivers | Descriptors ranked by difference / noise floor. The top ones are "what changed" |
| Nearest batch | Which known batch the fingerprint is closest to |

**Verdict**

| Verdict | Condition |
|---|---|
| ACCEPT | Every key descriptor and type share SIMILAR, no new particle type, controls passed |
| REJECT | A key descriptor or a type share is DIFFERENT, or a new particle type is present |
| INVESTIGATE | Anything UNCLEAR, or imaging changed. Next action says how many more images would settle it |

A customer tolerance, when we have one, replaces the noise floor for that descriptor.

**Config** (`config/decision.yaml`): `version`, `data_dir`, `baseline` (`Batch_3`), `reference_exclude`, `ci_level` (0.90), `key_descriptors`, `new_type_share` (0.05), `n_resamples`.

### 3.6 Uncertainty and how many images are enough

- Intervals come from resampling strips, because images cut from one strip are not independent.
- Limit we state: with 6–7 strips per batch there are few distinct ways to split or resample, so intervals are coarse.
- **How many images are enough.** Re-run the comparison on subsets of images and plot interval width against number of images. Output: "N images are enough to tell these batches apart on silicon fraction". This answers the cost of imaging directly.
- Uncertainty sources shown separately: sampling (few images), segmentation (threshold variants), imaging (negative controls).

### 3.7 Controls

Run with every comparison. Made from 3 reference images, judged as if they were a batch.

| Kind | Change | Must come out |
|---|---|---|
| Negative | Brightness ±20%, contrast ±20%, black level +20, added noise | SIMILAR to the reference |
| Positive | Si particles pasted in (+50%, +100% fraction). Voids punched into 30% of Si particles | DIFFERENT, with the right driver named |

### 3.8 Explanation

One result, four texts, all filled from the evidence by templates in `qc/explain.py`.

| Audience | Gets | Example |
|---|---|---|
| Factory operator | Traffic light, one sentence, one action | "Batch differs from the reference. Hold it and call the process engineer." |
| Process engineer | The drivers in units against the reference, possible causes to check, pictures | "Silicon particles cover 16% of the area against 6% in the reference, and their median size is 4.1 µm against 3.2 µm. Check the formulation ratio and the silicon powder lot." |
| Materials scientist | Distributions, particle-type gallery with definitions, image groups, intervals, method and limits | Size distribution overlay; type shares with intervals |
| Manager | Same or different, how sure, what it costs to be surer | "Different from the reference, driven by the silicon additive. No further imaging needed to confirm." |

`config/kpi_dictionary.yaml` holds, per descriptor: plain name, unit, what it means, why it matters for the battery, possible causes when it is higher or lower, what to check. Pat writes it; a mentor reviews the causes. Causes are always worded as "possible causes to check".

### 3.9 Training policy

Nothing is trained. If time allows after the freeze, one trained piece (for example a small classifier for voids from hand-drawn strokes) is kept only if it makes the positive controls easier to detect on strips it never saw.

### 3.10 Infrastructure

Everything runs locally and offline. Three processes:

| Process | Command | Port | Role |
|---|---|---|---|
| Pipeline | `uv run python -m qc.run --batch data/<batch>` | – | Measure → compare → write `out/`. This is what we freeze and run on the unseen batch |
| API | `uv run uvicorn qc.api:app --reload` | 8000 | Thin FastAPI wrapper: reads `out/`, saves uploads to `data/`, calls `run()`. No QC logic |
| Web UI | `cd web && npm install && npm run dev` | 5173 | Vite + React + TypeScript + Tailwind. Talks only to `/api` |

Other commands: `uv run python -m qc.measure` (ML only), `uv run pytest`. Setup: `brew install uv node@22`.

### 3.11 Where the code stands

The code on `main` judges images one by one against per-KPI bands with Batch_1 as baseline (see the README). That logic is replaced by §3.5. Built and reusable: loader, runner, segmentation stub, 2 descriptors, overlays, API, UI shell.

---

## 4. Sync points

| When | What |
|---|---|
| Now | Agree the new functions in §3.1 and the new `Evidence` shape (§6 step 2) |
| Sync 1 | Real `out/kpis.csv` and `out/particles.csv` for all three batches flow through `compare`. Reference against a random half of itself comes out SIMILAR |
| Dry run, 1 h before the drop | Batch_2 as if unseen, one command |
| Freeze, 30 min before the drop | `git tag rules-frozen`, push |
| Drop | One run. Commit the output unchanged |
| Sunday 14:45 | Submission: 2-minute video, repo, description |

## 5. Steps: Pat (ML)

**Before the drop**

1. `git checkout main && git pull`. `brew install uv`, `uv sync`, `uv run pytest`.
2. `uv run python -m qc.measure`. Look at `out/masks/`.
3. `segment(channels, px_um)`: the before / threshold / after steps in §3.2. Check two overlays per strip by eye.
4. `kpis(mask, px_um, channels)`: the key descriptors first (`si_d50_um`, `si_internal_void_frac`, `si_contrast_ratio`, `graphite_chord_um`), then the rest. Add the three new names to `KPI_UNITS` with Patrik.
5. `particles(mask, px_um, channels)`: the particle table in §3.2. Compute texture at full resolution so the porous particles separate.
6. **Sync 1.**
7. `qc/types.py`: cluster particles from all known batches into 2–4 types. Name each from its defining feature. Check the types stay the same when one strip is left out. Add the "unassigned" rule.
8. `imaging(channels)`.
9. `qc/controls.py`: `make_controls(channels, px_um)` for the table in §3.7.
10. `config/kpi_dictionary.yaml`: one entry per descriptor and per particle type. Ask a mentor to check the causes.
11. **Dry run, freeze.**

**At the drop**

12. Look at the new overlays and the particle types found. Change nothing.

**Evening**

13. "How many images are enough" curve (§3.6).
14. Threshold variants for the segmentation part of the uncertainty.
15. DINOv2 safety net with [dinov2-base](https://huggingface.co/facebook/dinov2-base), and a check that its image groups agree with ours.
16. Strip-leak chart: a classifier on folder labels, random split against leave-one-strip-out.

**Day 2**

17. Pitch figures: particle-type gallery, strip seams, size distributions per batch, how-many-images curve.

## 6. Steps: Patrik (software)

**Before the drop**

1. `config/decision.yaml`: `baseline: Batch_3`, plus the new keys in §3.5. Update the README.
2. `qc/schema.py`: new `Evidence`: `fingerprint` (descriptors with intervals, type shares, image groups), `differences[]` (name, unit, reference, batch, difference, interval, noise floor, status), `drivers[]`, `nearest_batch`, `new_type_share`, `imaging_changed`, `controls`, `verdict`, `next_action`, `explanations {operator, engineer, scientist, manager}`. Mirror in `web/src/types.ts`.
3. `qc/run.py`: call `particles`, `assign_types`, `imaging`, `make_controls`. Write `out/particles.csv`, `out/imaging.csv`, and control rows under batch `_controls`.
4. `qc/decide.py`: `compare()` per §3.5.
   - batch values and 90% intervals by resampling strips;
   - noise floor from random half-splits of the reference's strips;
   - status per descriptor and per type share; drivers ranked;
   - image groups by hierarchical clustering;
   - verdict and next action;
   - controls check.
5. `qc/explain.py`: four templates filled from the evidence and `config/kpi_dictionary.yaml`.
6. Tests: reference against half of itself → ACCEPT; a fake batch with one descriptor shifted → REJECT with that driver first; a fake batch with wide intervals → INVESTIGATE; negative controls SIMILAR, positive controls DIFFERENT.
7. **Sync 1.**
8. UI, batch against reference:
   - verdict card with four audience tabs;
   - driver chart: difference against noise floor, one bar per descriptor;
   - distribution overlays;
   - particle-type gallery with shares per batch;
   - image groups; per-image browser with overlay.
9. **Dry run, freeze.**

**At the drop**

10. `uv run python -m qc.run --batch data/<unseen>`. Copy the evidence file to `results/` and commit it (`out/` is gitignored).

**Evening**

11. Compare the unseen batch with every known batch, and every known pair with each other: a batch-by-batch difference table.
12. "How many images are enough" panel.
13. Printable one-page report per audience.
14. Modal for control sweeps, if images may be uploaded.

**Day 2**

15. Deploy, 2-minute video, README and architecture diagram, pitch rehearsal.

**Complete entry if time runs short:** Pat 1–9 and 11–12, Patrik 1–10.

## 7. Tools

| Tool | Use | Who |
|---|---|---|
| Hugging Face | DINOv2 weights for the optional safety net | Pat |
| Modal | Control sweeps and the how-many-images curve, hosting | Both, after permission |
| Devin | Own branch: perturbation functions with tests | Brief now, merge in the evening |
| Antigravity | Build and browser-test the UI | Patrik |
| Claude API | Optional, last: answer questions about a finished report. Not part of the report | Patrik |
| AMASS | 20-minute test for citations in the KPI dictionary; drop if thin | Either |

## 8. Demo

| Time | Shot |
|---|---|
| 0:00–0:15 | £50k of images, 31 fields, and the question: is this batch the same material? |
| 0:15–0:45 | Drop a folder. Verdict, driver chart against the noise floor, "controls passed" |
| 0:45–1:15 | Particle-type gallery: the types, their shares per batch, example crops. Size distributions overlaid |
| 1:15–1:40 | The same result for operator, engineer, scientist, manager |
| 1:40–2:00 | Unseen batch: frozen-tag timestamp, committed result. "N images are enough" curve |

Pitch opener: three kinds of silicon particle, found from the data; batches differ in how much of each they contain.

## 9. Open questions for the mentors

1. Images in different folders are adjacent pieces of one image (`cfe5vt7s` → `r17byphk` → `ffwubibz`). Intended?
2. When does the unseen batch drop, and what do you want back for it?
3. What are the three kinds of bright particle?
4. Which two or three microstructure numbers matter most, and at what tolerance?
5. Same detectors, pixel size and prep for the unseen batch?
6. Can someone review the "possible causes" in our KPI dictionary?
7. May images be uploaded to Modal, Hugging Face and Devin?

---

## 10. Glossary

| Term | Meaning |
|---|---|
| Anode | The negative battery electrode. Ours is mostly graphite |
| Graphite | Main anode material. Large dark-grey flakes in BSE |
| Si, silicon particle | Silicon-based additive. The bright particles in BSE |
| Pore | Empty space between particles. Black in BSE |
| Apparent porosity | Pore share measured from a 2D image. Biased, because the back of open pores is visible |
| Phase | One kind of material in the image (pore, graphite, Si) |
| Microstructure | How particles and pores are sized, shaped and arranged at the micrometre scale |
| Batch | One delivery of material |
| Baseline, reference | The batch others are compared against. Batch_3 |
| SEM | Scanning electron microscope |
| BSE | Backscattered-electron image. Brightness follows composition |
| ETD, SE | Standard secondary-electron detector. Shows surface shape |
| InLens | Secondary-electron detector inside the column. Sensitive to thin surface films |
| Field, image | One imaged region with its three detector images |
| Strip | One long continuous image that was cut into several fields |
| µm, nm, px | Micrometre, nanometre, pixel. One pixel is 25 nm |
| Grey level | Pixel brightness, 0 to 255 |
| Black level | The grey level of "nothing". A detector setting |
| Descriptor, KPI | One measured number describing the microstructure |
| Key descriptor | A descriptor that counts towards the verdict |
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
| Fingerprint | Everything we measure about one batch: descriptors, distributions, particle types, image groups |
| Clustering | Grouping similar items automatically, without labels |
| Particle type | A group of similar silicon particles found by clustering |
| Image group | A group of similar images inside one batch |
| Unassigned | A particle that fits none of the known types |
| Interval | The plausible range of a value given how few images we have |
| Resampling, bootstrap | Recomputing a value many times on random re-draws of the strips to get its interval |
| Noise floor | How much two halves of the same batch differ. A difference must exceed this to count |
| Driver | A descriptor that explains most of the difference between two batches |
| Similar, different, unclear | Difference inside the noise floor, beyond it, or straddling it |
| Negative / positive control | Test images with a known answer: must come out similar / different |
| Tolerance | The difference a customer accepts |
| KPI dictionary | Our file of plain-language meanings, causes and checks for each descriptor |
| Template | Fixed sentence with slots filled from the numbers |
| DINOv2 | Pretrained vision model, used only as an optional safety net |
| Contract, schema | Agreed function signatures, column names and units |
| `evidence.json` | Everything behind one comparison. The UI reads only this |
| Freeze, tag | Locking the settings before the unseen batch, with a timestamped git marker |
| Dry run | Full rehearsal on data we already have |
