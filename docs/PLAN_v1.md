# Track 4 · Batch QC for electrode microstructure: Plan

Team Batch Size 2. ML: Pat. Software: Patrik. Glossary in [§10](#10-glossary).

## In short

A quality-control tool that tells a battery manufacturer whether a new delivery of electrode material still matches the approved one, and shows why.

- **Input:** a folder of microscope images for the incoming batch (three detector images per spot), plus the same for the approved baseline batch.
- **Output:** accept, investigate or reject, with the evidence: which images look off, which measured property changed and by how much, how sure we are, what to do next.
- **Model:** nothing is trained before the freeze.
  - Measurements: brightness thresholds split each image into pore, graphite and silicon; we compute numbers from that.
  - Verdict: plain statistics against the baseline.
  - Safety net: pretrained DINOv2, used as-is, flags regions unlike the baseline.
  - Explanation: Claude, used as-is. It never measures or decides.

---

## 1. Rules

1. No Polaron models or tools.
2. No classifier trained on batch folders.
3. Language models never measure and never decide.
4. The frozen verdict path runs on a laptop with no network.
5. Images stay on our machines until Polaron says otherwise.
6. `config/decision.yaml` is not edited after the `rules-frozen` tag.

## 2. Data facts we act on

| Fact | What we do |
|---|---|
| 31 fields: Batch_1 = 7, Batch_2 = 7, Batch_3 = 17. Three aligned images each (BSE, ETD or `SE`, InLens) | BSE is the main channel |
| 25 nm per pixel, read from the TIFF tags | All sizes in µm |
| Fields are cuts from 13 longer strips; 5 strips span more than one folder | Count by strip. Validate leave-one-strip-out. `strip_id` (image height and resolution tag) identifies the strip |
| Grey levels differ between strips (detector settings) | Subtract the black level; normalise contrast before DINOv2 |
| Three kinds of silicon particle: small dense bright (most strips); larger and dimmer (`4ih2ggld`, `5n1q8atc`, Batch_1); porous inside (`x7u69zsw`, `tuy3zymq`, `kbdh4tri`, `71vgq3fw`, Batch_3) | KPIs for fraction, size, brightness ratio and internal voids |
| Baseline is assumed to be Batch_1, not confirmed | Baseline audit; config can exclude reference images |

## 3. Pipeline

### 3.1 Contract

`qc/schema.py` on `main` is the contract. "Exists" means the function is already in the code on `main`.

| Stage | Function | Where | Owner | Status |
|---|---|---|---|---|
| Load | `load_field` → `Field` (alias `SE` → `ETD`, crop 8 px edges, pixel size, `strip_id`) | `qc/io.py` | shared | exists |
| Segment | `segment(channels, px_um)` → mask of `PORE` / `GRAPHITE` / `SI` / `IGNORE` | `qc/measure.py` | Pat | basic version exists |
| Measure | `kpis(mask, px_um, channels)` → one row per image | `qc/measure.py` | Pat | 2 of 8 KPIs exist |
| Uncertainty | `uncertainty(mask, px_um, channels)` → standard error per KPI | `qc/measure.py` | Pat | new |
| Imaging check | `imaging(channels)` → black level, noise, sharpness per channel | `qc/measure.py` | Pat | new |
| Anomaly | `anomaly(channels, px_um)` → score and heat map | `qc/anomaly.py` | Pat | new |
| Controls | `make_controls(channels, px_um)` → known-good and known-bad copies | `qc/controls.py` | Pat | new |
| Run | `run()` calls the above, writes `out/kpis.csv`, `out/masks/`, `out/evidence/` | `qc/run.py` | shared | exists; new functions to wire in |
| Judge | `judge()` → image status → batch verdict → `Evidence` | `qc/decide.py` | Patrik | exists; extensions in §6 |
| Show | API and web UI | `qc/api.py`, `web/` | Patrik | exists |
| Explain | Verified tags, investigator agent, report | `qc/agent.py` | Patrik | new |

### 3.2 Segmentation and KPIs

| Step | What |
|---|---|
| Before | Subtract black level (0.5th percentile). Light Gaussian smooth. Work at 2× downsample. Top and bottom 5% of rows → `IGNORE` |
| Threshold | 3-class multi-Otsu per image: pore, graphite, Si |
| After | Small opening on Si. Drop Si objects under 0.25 µm². Fill each Si particle to find internal voids. Split touching particles (watershed). Exclude particles cut by the image border from size statistics. Convert px → µm |

| Name in `KPI_UNITS` | Definition | Status |
|---|---|---|
| `si_area_frac` | Si pixels / non-ignored pixels | exists |
| `porosity_apparent` | Pore pixels / non-ignored pixels | exists |
| `si_d50_um` | Area-weighted median equivalent diameter | to write |
| `si_d90_um` | 90th percentile of the same | to write |
| `si_internal_void_frac` | Dark pixels inside filled Si particles / filled area | to write |
| `si_contrast_ratio` | (Si mode − black level) / (graphite mode − black level) | to write |
| `si_fragments_per_1e4um2` | Si objects under 1 µm per 10⁴ µm² | to write |
| `si_dispersion_cv` | Variation of local Si fraction across 20 µm windows | to write |

### 3.3 Imaging check

`imaging(channels)` returns black level, grey-level percentiles, noise, sharpness and saturated fraction per channel. An image outside the baseline's envelope is SUSPECT with the reason "imaging changed", and `si_contrast_ratio` and `porosity_apparent` are not used for it.

### 3.4 Anomaly

- DINOv2-base on BSE: 4× downsample, 448 px crops, contrast normalised per crop, grey copied to three channels.
- Fit on baseline patches. Try PCA reconstruction error and nearest-neighbour distance; keep whichever catches more positive controls.
- Image score = mean of the top 1% of patch scores. Alarm level set leave-one-strip-out on the baseline.
- Cross-check: score each image against the other images of its own batch, with no baseline. Finds odd images in a mixed batch.

### 3.5 Decision

| Level | Rule |
|---|---|
| Band | Per KPI: prediction interval for one new baseline image, widened for the number of KPIs. A mentor tolerance replaces it |
| Image: NON_CONFORMING | Imaging ok, and value ± 2 × standard error lies entirely outside the band |
| Image: SUSPECT | Value ± 2 × standard error straddles the band edge, or anomaly fires with no KPI outside, or imaging is outside the baseline envelope, or a KPI is missing |
| Image: CONFORMING | Otherwise |
| Batch: REJECT | Lower bound on the non-conforming fraction > 5%. Counted by strip |
| Batch: ACCEPT | None non-conforming, none suspect, controls passed. Printed with its upper bound |
| Batch: INVESTIGATE | Everything else, with a next action |

### 3.6 Controls

Run with every batch. Made from 3 baseline images.

| Kind | Change | Must be |
|---|---|---|
| Negative | Brightness ±20%, contrast ±20%, black level +20, added noise | CONFORMING |
| Positive | Si particles pasted in (+50%, +100% fraction). Voids punched into 30% of Si particles | Flagged |

### 3.7 Training policy

- Before the freeze: nothing trained.
- After the freeze, a trained piece is kept only if it catches more positive controls at the same false-alarm rate, tested on strips it never saw.
- Allowed candidates: a small classifier on DINOv2 features from hand-drawn strokes (voids, cracks); a decoder trained on baseline images only; a segmenter trained on our own threshold masks with brightness and contrast changes.
- Not allowed: anything trained on batch labels.

---

## 4. Sync points

| When | What |
|---|---|
| Now | Agree the four new function signatures in §3.1 |
| Sync 1 | Real KPIs for all three batches flow through `qc.run`. Baseline against itself is not rejected |
| Dry run, 1 h before the drop | Batch_2 as if unseen, one command |
| Freeze, 30 min before the drop | `git tag rules-frozen`, push |
| Drop | One run. Commit the output unchanged |
| Sunday 14:45 | Submission: 2-minute video, repo, description |

## 5. Steps: Pat (ML)

**Before the drop**

1. `git checkout main && git pull`. `brew install uv`, `uv sync`, `uv run pytest`.
2. `uv run python -m qc.measure`. Look at `out/masks/`.
3. `segment(channels, px_um)`: the before / threshold / after steps in §3.2. Check two overlays per strip by eye.
4. `kpis(mask, px_um, channels)`: the six "to write" KPIs in §3.2. Order: `si_d50_um`, `si_internal_void_frac`, `si_contrast_ratio`, `si_fragments_per_1e4um2`, `si_d90_um`, `si_dispersion_cv`.
5. **Sync 1.**
6. `uncertainty(mask, px_um, channels)`: rerun KPIs on 1000 px windows and on threshold variants (±5 grey levels, two smoothing widths). Return one standard error per KPI.
7. `imaging(channels)`: black level, 1st/50th/99th percentile, noise, sharpness, saturated fraction, per channel.
8. `qc/controls.py`: `make_controls(channels, px_um)` for the table in §3.6.
9. `qc/anomaly.py`: `anomaly(channels, px_um)` with [dinov2-base](https://huggingface.co/facebook/dinov2-base) (`uv add torch transformers scikit-learn`). Pick PCA or nearest-neighbour on the controls. Leave it out of the frozen config if not solid by the dry run.
10. **Dry run, freeze.**

**At the drop**

11. Look at the new overlays. Change nothing.

**Evening**

12. Strip-leak chart: logistic regression on DINOv2 image features predicting the folder, random split vs leave-one-strip-out.
13. Batch-internal anomaly cross-check.
14. One trained candidate from the training policy, tested on the controls.
15. Power curves from the positive controls. Larger DINOv2 on Modal if images may be uploaded.

**Day 2**

16. Pitch figures: three particle types, strip seams, power curve, strip-leak chart.

## 6. Steps: Patrik (software)

**Before the drop**

1. `qc/schema.py`: `Evidence` gains `controls`, `baseline_audit`, `uncertainty`; `TileResult` gains `anomaly_score`, `imaging_ok`. Mirror in `web/src/types.ts`.
2. `qc/run.py`: call `uncertainty`, `imaging`, `anomaly`, `make_controls`. Write `out/kpi_se.csv`, `out/imaging.csv`, `out/anomaly/<batch>/<id>.png`, and control rows under batch `_controls`.
3. `qc/decide.py`:
   - count non-conforming by strip (`unit="strip"`);
   - use value ± 2 × standard error against the band;
   - imaging envelope from baseline → SUSPECT, and skip the two imaging-sensitive KPIs;
   - anomaly above its alarm level with no KPI outside → SUSPECT;
   - baseline audit, leave-one-strip-out, reported in the evidence;
   - controls check → `controls.passed`.
4. Tests: baseline against itself → ACCEPT; one odd strip of seven → INVESTIGATE; two of seven → REJECT; negative controls pass, positive controls flagged.
5. **Sync 1.**
6. UI: controls badge, baseline-audit view, three-detector viewer with mask and heat-map overlays, uncertainty bars.
7. **Dry run, freeze.**

**At the drop**

8. `uv run python -m qc.run --batch data/<unseen>`. Copy the evidence file to `results/` and commit it (`out/` is gitignored).

**Evening**

9. Verified tags: fixed tag list; Claude sees baseline crop, flagged crop, heat map. A tag shows as confirmed only if its KPI moved. Measure hit rate on blind control pairs.
10. Investigator agent in `qc/agent.py`: tools to re-measure a region, fetch the nearest baseline patch, run the imaging test, look up causes, compute images needed. Output: audit log and drafted supplier query. `claude-sonnet-5-5` while iterating, `claude-opus-5-5` for the final run.
11. Counterfactual line and nearest conforming baseline image.
12. Report from `evidence.json`, every number checked against the JSON.
13. Modal for control sweeps, if images may be uploaded.

**Day 2**

14. Deploy, 2-minute video, README and architecture diagram, pitch rehearsal.

**Complete entry if time runs short:** Pat 1–8 and 10–11, Patrik 1–8.

## 7. Tools

| Tool | Use | Who |
|---|---|---|
| Claude API | Tags, agent, report | Patrik |
| Hugging Face | DINOv2 weights | Pat |
| Modal | Control sweeps, larger DINOv2, hosting | Both, after permission |
| Devin | Own branch: perturbation functions with tests | Brief now, merge in the evening |
| Antigravity | Build and browser-test the UI | Patrik |
| AMASS | 20-minute test for cause-table citations; drop if thin | Either |

## 8. Demo

| Time | Shot |
|---|---|
| 0:00–0:15 | £50k of images, 31 fields, a supplier who may have changed something |
| 0:15–0:45 | Drop a folder: verdict, KPIs against bands, image gallery, "controls passed" |
| 0:45–1:15 | Flagged image: detectors, overlay, KPI deltas, one tag confirmed and one rejected, counterfactual |
| 1:15–1:40 | Agent audit log ending in the supplier query. Uncertainty by source |
| 1:40–2:00 | Unseen batch: frozen-tag timestamp and committed verdict. Strip-leak chart |

Pitch opener: strips crossing folders, three particle types, a detector offset that is not a material change.

## 9. Open questions for the mentors

1. Is Batch_1 the baseline? Is there ground truth for the others, per batch or per image?
2. Images in different folders are adjacent pieces of one image (`cfe5vt7s` → `r17byphk` → `ffwubibz`). Intended?
3. When does the unseen batch drop? Scored per batch or per image? Does "investigate" count?
4. What are the three kinds of bright particle?
5. Same detectors, pixel size and prep for the unseen batch? Are grey levels uncalibrated?
6. Which two or three microstructure numbers matter most, at what tolerance?
7. May images be uploaded to Modal, Hugging Face, Devin and LLM APIs?

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
| Batch | One delivery of material |
| Baseline | The approved reference batch |
| SEM | Scanning electron microscope |
| BSE | Backscattered-electron image. Brightness follows composition |
| ETD, SE | Standard secondary-electron detector. Shows surface shape |
| InLens | Secondary-electron detector inside the column. Sensitive to thin surface films |
| Field, tile | One imaged region with its three detector images |
| Strip | One long continuous image that was cut into several tiles |
| µm, nm, px | Micrometre, nanometre, pixel. One pixel is 25 nm |
| Grey level | Pixel brightness, 0 to 255 |
| Black level | The grey level of "nothing". A detector setting |
| KPI | One measured number per image |
| Segmentation, mask | Labelling every pixel with its phase; the resulting label image |
| Overlay | The mask drawn on the image for checking by eye |
| Threshold, multi-Otsu | A grey-level cut-off; a standard way to pick cut-offs automatically |
| Downsample | Shrink the image to work faster |
| Opening | Clean-up that removes specks |
| Watershed | Standard method to split touching particles |
| Equivalent diameter | Diameter of a circle with the particle's area |
| D50, D90 | Size below which 50% or 90% of particle area falls |
| CV | Standard deviation divided by mean |
| Mode | The most common grey level of a phase |
| Standard error | How much a measured number could be off |
| Tolerance band | The KPI range we accept as normal |
| Prediction interval | Where one new baseline-like image should fall |
| Conforming, non-conforming, suspect | Within tolerance, clearly outside, too close to call |
| Lower / upper bound | Ends of the plausible range for a true share, given x of n observed |
| Leave-one-strip-out | Test on one strip using only the others as reference |
| Negative / positive control | Test image with a known answer: must pass / must be flagged |
| Power curve | How often we catch a change, against its size and the number of images |
| Counterfactual | What would have to differ for the image to pass |
| DINOv2 | Pretrained vision model that turns image patches into feature vectors |
| Patch, feature | A small square of an image; the numbers describing it |
| PCA, reconstruction error | Main directions in which baseline features vary; how badly a patch fits them |
| Anomaly score, heat map | How unlike the baseline an image is; where |
| Alarm level | Score above which the anomaly check fires |
| LLM, agent | Large language model; an LLM that carries out steps by calling tools |
| Audit log | Record of what the agent did and found |
| Contract, schema | Agreed function signatures, column names and units |
| `evidence.json` | Everything behind one verdict. The UI and the agent read only this |
| Freeze, tag | Locking the settings before the unseen batch, with a timestamped git marker |
| Dry run | Full rehearsal on data we already have |
