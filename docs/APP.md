# Catalyst app: features and their core challenges

One section per feature, written so that one agent can take one feature and push it as far as it goes. Each section covers:
- **Goal:** what the feature does.
- **Why it matters:** the organisers' words.
- **Core challenge:** what makes it hard, given what we know today.
- **Great looks like:** the quality bar.
- **Builds on:** what already exists.

Read the shared context and rules first.

## Shared context

### The task (hackathon brief, Track 4 by Polaron)

> Can you detect when a supplier's material has changed before it becomes a manufacturing problem? Battery manufacturers need incoming electrode material to be consistent batch to batch, but subtle shifts in formulation or processing can alter microstructure in ways that only surface as defects much later in production. Using electron microscopy images, teams build a trustworthy, interpretable, uncertainty-aware QC system that compares incoming batches against an approved baseline: detecting whether a batch has meaningfully changed, quantifying what's driving the difference, and explaining the verdict (accept / investigate / reject) to a materials expert, not just a black-box score.

**Judged on:** quality of the extracted material KPIs, accuracy on the new batch, interpretability, honest handling of uncertainty, and real-world usability for a QC decision, not just raw accuracy.

### What the organisers told us (3 Oct)

- **Baseline:** Batch_3 is what the supplier "promised". Batch_1 and Batch_2 arrived later. They are not better or worse; they show the kinds of variation we need to pick up.
- **Defects:** the baseline isn't necessarily defect-free, and defects alone don't define the batches: "there's a lot of complex morphology features to examine".
- **How the batches were made:** the data is real but the batches are synthetic. There is "usually some pattern that clusters the samples in a batch together".
- **Strips:** tiles cut from one long image (same `strip_id`) don't matter. Don't build on them. Never use them as features, nor image height or resolution tags, which identify strips. Hold whole strips out when estimating accuracy, because images from one strip are correlated.
- **Tolerance:** a manufacturer would be wary of anything too far outside the baseline's standard deviation, in either direction.
- **The judged test:** identify what is different about the batches, and so categorise held-back samples correctly. If that works, an unknown batch N can be called in or out of distribution. The core feature might be "given a sample image, can you categorise it into one of your batches?"
- **Feature asks:** "a nice comparison UI that allows us to compare 2 batches and see their differences nicely visualised". Extra: "how would this material wear over time and degrade?"

### Data

- **Images:** 31 images: Batch_1 = 7, Batch_2 = 7, Batch_3 = 17. Each has three detector files (BSE, ETD or SE, InLens), 8-bit, 25 nm per pixel. The images cost about £50k to collect; the raw files stay out of git, screenshots are fine (AGENTS.md).
- **Anode:** bright = silicon, grey = graphite (particles about 30 µm, so only a few per image), black = pore. There are about 4,000 silicon particles in total.
- **Imaging quirks** (PLAN_v3 §1.1):
  - the InLens detector saturates (more than 1% of pixels at 255 in 26 of 31 images) and has top-to-bottom shading;
  - four baseline images have a raised black level (22–23 instead of 0 in BSE);
  - coloured stitch columns at the edges are cropped at load.
- **Still to come:**
  - **9 held-back images** (27 files) from the three known batches, split unknown. Keep them unseen until attribution is frozen with a git tag, score them once, commit the result, then add them to training.
  - **2 images at the presentation**, "which batch do they belong to, and WHY". (The brief also mentions an unseen batch dropping on day one; the organisers' latest messages describe it as the held-back samples above.)
- **What Pat's first real measurements show** (branch `pat/ml-v3`, `docs/AGENT_HANDOVER.md`; first results, 3 Oct):
  - with the current features, three-way attribution is at chance when whole strips are held out;
  - Batch_3 vs the rest does separate on texture and material features, but imaging features alone also separate it, so acquisition differences must be ruled out;
  - Batch_1's higher silicon comes almost entirely from one strip.

### How the features fit together

```text
images ─► Pat's model: segmentation, KPIs, particles, imaging metrics,
          features (qc/features.py), batch attribution (qc/attribute.py)
              │
              ▼
   feature table + attribution output ─► 1 Sort · 2 Compare · 3 Consistency · 4 Verdict
                                              │
                                              ▼
                       5 Explain · 6 Impact · 7 Audit · 8 Cost of certainty
                                              │
                                              ▼
                                9 The app (UI and demo)
```

### Rules for every feature agent

- **Read first:** `AGENTS.md`, `README.md` (what's built), `docs/HANDOFF.md` (status and design notes), `docs/PLAN_v3.md` (the team plan).
- **The model is Pat's,** including batch attribution.
  - She owns segmentation, KPIs, particles, particle types, imaging metrics, controls, uncertainty, the per-image feature table, the attribution model, and the content of `config/kpi_dictionary.yaml`.
  - Her files: `qc/measure.py`, `qc/types.py`, `qc/controls.py`, `qc/uncertainty.py`, `qc/features.py`, `qc/attribute.py`, `config/particle_types.json`, `config/attribution_model.json` and `KPI_UNITS`.
  - Don't edit them. Consume her outputs: `out/kpis.csv`, `out/particles.csv`, `out/imaging.csv`, `out/features.csv`, `out/attribution/<run>.json`.
  - Her plan and status are in `docs/AGENT_HANDOVER.md` and the draft `docs/PLAN_v4.md` on branch `pat/ml-v3`.
- **Feature-agnostic code.** New descriptor columns must flow through without code changes.
- **Testing:**
  - judge model quality only on Pat's features, with whole strips held out;
  - test your own code on synthetic tables (`tests/synth.py`);
  - never train or tune on held-back images.
- **Contract:** `qc/schema.py` changes are additive; mirror them in `web/src/types.ts`. Small PRs, with `uv run pytest` and `cd web && npm run build` green and the README in sync.
- **No language model** measures, decides or explains: the organisers saw an LLM describe images well but fail to group batches.
- **Shared prerequisite:** feeding Pat's particle and imaging outputs into the tables (HANDOFF step 3). Her branch already writes `out/particles.csv` and `out/imaging.csv` from `qc/run.py`, so check it before building any plumbing. Whoever needs it first does the rest as its own small PR.

### One visual language

- **Fixed colours:** Batch_3 (baseline) teal, Batch_1 amber, Batch_2 violet, new samples a white star.
- **Baseline band:** every feature is drawn against the baseline mean ± 1/2/3 SD.
- **Units:** differences in baseline-SD units next to physical units.
- **Names:** friendly feature names from the dictionary, with code names on hover.
- **Every number links to the images** (and later the particles) behind it.

## Core features (what is judged)

### 1. Sort a sample into a batch, and say why

**Goal:** for one or more new images, say which known batch each belongs to, how sure we are, why, and whether it fits none of them.

**Why it matters:** this is the live test ("2 images: which batch, and WHY"), the held-back 9, and "accuracy on the new batch".

**Who does what:**
- **Pat** builds the attribution model in `qc/attribute.py`, on `qc/features.py`. It provides per-image probabilities, the predicted batch, the top reasons, a heatmap, nearest known images, an "unfamiliar" flag, and an optional balanced assignment.
- **This feature (software side)** wraps it and presents it. It builds **no second classifier**:
  - the `Attribution` contract in `qc/schema.py`, agreed with Pat;
  - the API;
  - the Sort view;
  - the held-out run and its record.

**Core challenge:**
- **Honesty while the model is weak.** Pat's first results put three-way attribution at chance. The view must show probabilities, the "unfamiliar" flag, and the expected accuracy from strip-held-out testing next to every call, and must never look more certain than the model is.
- **The "why" must be the model's actual reasons**, not a story added afterwards. Render Pat's reasons as the image's value on each deciding feature against each batch's range, with the heatmap and the nearest known images.
- **A tiny, imbalanced training set** (31 images, 17/7/7). Model choices (few features, nested strip-held-out tuning, class balance) are Pat's. Make their effect visible: confusion matrices, chance level.
- **A reliable live path for the 2 images handed over shortly before we present:** upload, then Pat's `predict`, then a result in seconds, offline.
- **Discipline:** freeze (git tag) before the held-back images arrive; one scored run, committed unchanged. If they turn out to be 3 per batch, show Pat's balanced assignment next to the unconstrained one.

**Great looks like:**
- held-out balanced accuracy far above chance (33%);
- confident when right, unsure when wrong;
- a "why" a materials scientist would write themselves;
- drag-and-drop, offline, seconds.

**Builds on:** Pat's `qc/attribute.py` (output `out/attribution/<run>.json`, CLI `uv run python -m qc.attribute --images data/<drop>`) and the wrapping plan in HANDOFF step 2 (`Attribution` contract, `/api/attribution` endpoints, `tests/fixtures/attribution_example.json`).

### 2. Compare two batches: what's different

**Goal:** pick any two batches (by default a batch vs the Batch_3 baseline) and see what differs, by how much and how sure, side by side and nicely visualised.

**Why it matters:** the organisers asked for exactly this, and the brief judges "quantifying what's driving the difference" and the quality of the KPIs.

**Core challenge:**
- **Find the few drivers.** Many descriptors plus whole distributions (particle sizes, type shares): rank the drivers with effect sizes in baseline-SD units and intervals, without multiple-testing false alarms.
- **Not just averages.** Differences can be in spread or shape: a broader size distribution, a sub-population of particles.
- **Wording:** "differs from the reference", never "defective". The baseline isn't defect-free.
- **Make it visible:** distributions on the baseline band, and typical images of both batches side by side with the relevant phase highlighted.

**Great looks like:** a materials expert agrees with the top three drivers, and a non-expert sees the difference within ten seconds.

**Builds on:** `compare()` in `qc/decide.py` (differences, intervals, drivers), and Pat's feature ranking and two-sided baseline z-scores (`qc/attribute.py`, `out/features.csv`).

### 3. Consistency within a batch

**Goal:** show how alike the samples of one batch are, what pattern they share, and which samples don't fit.

**Why it matters:** "there is usually some pattern that clusters the samples in a batch together"; "given a set of images, would we be able to categorise them into batches?"

**Core challenge:**
- **Sampling noise vs real variation.** One image covers only a few graphite particles, so separate genuine variation from sampling noise. A useful yardstick is the expected spread for one image's area, from the two-point correlation / integral range (PLAN_v3 §3.6).
- **Unsupervised check:** does clustering *without* labels recover the batches?
- **Flag outliers inside a batch, including the baseline.** For example, the four baseline images with a raised black level.

**Great looks like:**
- each batch's shared pattern named in one sentence;
- outliers flagged with a reason;
- a similarity view that shows clean blocks, or honestly shows where batches overlap.

**Builds on:** Pat's per-image feature table (`out/features.csv`) and attribution output, the odd-image check in `compare()`, and her integral-range estimate (`qc/uncertainty.py`).

### 4. Verdict for an unknown batch: accept, investigate or reject

**Goal:** for a set of new images that make up one batch, decide whether it stays inside the baseline's distribution, with the uncertainty stated and a next action.

**Why it matters:** "real-world usability for a QC decision", "honest handling of uncertainty", "accuracy on the new batch".

**Core challenge:**
- **Few images rarely prove sameness.** Keep SIMILAR, DIFFERENT and UNCLEAR apart honestly, two-sided against the baseline's spread.
- **Thresholds are fixed before the data** and checked on known-answer tests: baseline split against itself, controls.
- **Imaging drift** (black level, saturation, brightness) must not look like a material change.
- **The next action must be useful:** hold the batch, check a named image, or image N more fields.

**Great looks like:**
- no false REJECT when the baseline is split against itself;
- a verdict a QC engineer would act on, with its uncertainty in plain sight.

**Builds on:** `compare()` (t-intervals, family-wise permutation p, odd images, verdict precedence, next action), the image as the unit (HANDOFF step 1), the imaging check (HANDOFF step 3).

### 5. Explanations a materials expert accepts

**Goal:** the same result told to an operator, a process engineer, a materials scientist and a manager.

**Why it matters:** "explaining the verdict … to a materials expert, not just a black-box score".

**Core challenge:**
- **Fixed templates**, with every number taken from the evidence.
- **Correct materials vocabulary** in plain language.
- **Causes as "possible causes to check".**
- **Domain content comes from Pat's dictionary:** meanings, why each quantity matters, likely causes, supplier checks. The texts must agree with what the screens show.

**Great looks like:** an engineer can paste it into a report for their boss, and a scientist finds nothing to correct.

**Builds on:** HANDOFF step 4 (`qc/explain.py`, dictionary structure).

## Extra features (for the pitch)

### 6. Battery impact and wear over time

**Goal:** what a measured difference means for the cell, and how the material would wear and degrade (the organisers' extra).

**Core challenge:** there is no electrochemical data, so this can only use textbook relations with their assumptions and ranges printed:
- **Capacity:** silicon share × specific capacity, a range from Si to SiOx.
- **Swelling:** lithiation expansion, about 280% for Si vs about 10% for graphite.
- **Rate:** Bruggeman, effective transport ∝ porosity^1.5.
- **Wear mechanisms:**
  - silicon expansion → particle cracking and SEI growth → capacity fade;
  - larger silicon particles crack more;
  - agglomerates → hot spots;
  - lower porosity → plating risk at fast charge.

2D sections hide 3D connectivity. Nothing may read as a prediction: label it "indicative". Fade curves, if any, are labelled scenarios.

**Great looks like:** a battery scientist calls it sensible and honest, and it makes the stakes tangible. Visual ideas: impact cards with range bars, a wear-risk panel, swelling shown on the real image.

**3D physics view (the demo moment of this feature).** A rotatable 3D slice of anode built from one batch's measured metrics.

- **Stack:** `three` with `@react-three/fiber` (v9, for our React 19) and `@react-three/drei`. Install with `npm install --before=…` (AGENTS.md).
- **The slab:**
  - copper current collector at the bottom, separator on top;
  - graphite as flattened ellipsoids (about 30 µm, lying flat) and silicon as bright spheres, with electrolyte in the pores;
  - silicon amount from `si_graphite_ratio`, silicon sizes from `si_d50_um`/`si_d90_um`, clumping from the dispersion and agglomerate metrics, packing from `porosity_apparent`, hollow particles from `si_internal_void_frac`.
- **The real data on the cut face:** one face shows an actual FIB-SEM overlay of that batch, so the volume reads as "what lies behind the section we imaged".
- **Charge slider:** silicon swells (about 280% by volume, radius × 1.56), graphite about 10%. The slab thickens, the pores shrink, and dense silicon glows with stress.
- **Ion flow:** lithium-ion streaks through the pores, their rate scaled by Bruggeman (porosity^1.5).
- **Cycle slider ("wear over time"):**
  - SEI shells thicken on the silicon, larger particles crack first, and pores clog;
  - next to it, an indicative capacity-retention band, labelled as a scenario.
- **Side by side:** Batch_3 and the chosen batch with the same camera and the same sliders, so differences in swelling, cracking and ion flow are visible at a glance.
- **Honesty:** it is an illustration driven by measured statistics, not a simulation and not a 3D reconstruction (we only have 2D sections). The label says so. The numbers shown beside it come from the relations above, which the backend computes; the UI only renders (AGENTS.md: no QC logic in the UI).
- **Core challenge:**
  - turning a few 2D statistics into a believable 3D packing that hits the target fractions;
  - keeping it fast (instanced meshes, a few thousand particles, smooth on a laptop);
  - changing it visibly *and* truthfully when the metrics change.

**Builds on:** PLAN_v3 §3.8 (indicative consequences).

### 7. Audit trail and traceability

**Goal:** when something goes wrong months later (carmaker → cell maker → supplier), show exactly what was measured, with which rules, and that nothing was tuned afterwards.

**Core challenge:** reproducibility and tamper evidence:
- every input image hashed;
- code and config versioned;
- rules frozen with a tag *before* the data arrives;
- an append-only decision log;
- one-click verify (re-hash the inputs, re-run, identical evidence apart from the timestamp);
- a printable one-page batch passport.

**Great looks like:** re-running a past decision gives the identical result, and the passport is something a QA department would file.

**"GENERATE LAWSUIT" button (for laughs, with a point).** A big red button in the Audit view turns the audit record into a mock court filing after a vehicle recall, e.g. *Fictional Motors v. Fictional Cells Ltd v. Fictional Silicon Co.*

- **The exhibits are real:**
  - Exhibit A: the batch passport (verdict, drivers);
  - Exhibit B: the SHA-256 of every input image;
  - Exhibit C: the rules-frozen tag time ("the rules were fixed before the batch arrived");
  - Exhibit D: the images.
- **The damages line is an obvious joke** built from inputs the presenter can change (vehicles recalled × cost per vehicle). It is labelled as made-up numbers: no real statistics (PLAN_v3: don't quote figures without a source).
- **Fictional parties only:** never real carmakers, cell makers, suppliers or the sponsor. "PARODY. NOT LEGAL ADVICE." on screen and on the printout.
- **Fixed templates, offline.** Optional flourishes: typewriter reveal, gavel sound, "Download PDF".
- **The point underneath:** after a recall, a record like this decides who pays along the liability chain (carmaker → cell maker → supplier), and ours is ready.

**Builds on:** `qc/provenance.py` (every evidence file already carries input hashes, commit, config hash, freeze tag).

### 8. Cost of certainty: how many images are enough

**Goal:** answer the £50k question (about 20 images cost about £50k): how many images does it take to tell batches apart, or to settle a verdict?

**Core challenge:** estimate it honestly from very few images. Use subsampled learning curves with error bars, and the expected spread per imaged area from the two-point correlation. Tie the answer to the verdict's "image N more fields".

**Great looks like:** "N images are enough to tell these batches apart", with the curve behind it.

**Builds on:** PLAN_v3 §3.6, Pat's attribution evaluation (strip-held-out CV, permutation null) and `qc/uncertainty.py` (`integral_range`, `area_needed`), and the verdict's next action.

### 9. The app: one product, and the demo

**Goal:** one fast, offline app that runs the judged test live and tells the story in two minutes.

**Core challenge:**
- **One product:** features 1–8 woven into a few clear views (for example Sort · Compare · Verdict · Impact · Audit) with the shared visual language.
- **A reliable live path for the 2 images** handed over shortly before we present: upload, result in seconds, nothing breaking on stage.
- **Usable for a judge** who sees it for two minutes.

**Great looks like:**
- 0:00: the problem (£50k of images: "is this delivery what the supplier promised?");
- 0:15: drop the 2 images → batch, confidence, why;
- 0:45: what's different and how consistent each batch is;
- 1:10: the held-back result, frozen before the data arrived;
- 1:30: impact (the 3D slab swelling under the charge slider, baseline vs batch) and audit (GENERATE LAWSUIT).

**Builds on:** the existing FastAPI + React app (`qc/api.py`, `web/`), HANDOFF step 5.
