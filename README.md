# Catalyst

**Team:** [Batch Size 2](https://github.com/batch-size-2) (ML: Pat · Software: Patrik)  
**Hackathon track:** [Polaron — Track 4](https://www.polaron.ai/) — batch QC for electrode microstructure

## What we're building

A decision layer on top of SEM microstructure analysis. Batch_3 is the material the supplier promised; Batch_1 and Batch_2 arrived later and show the kinds of variation the tool must pick up (they are *different*, not *worse*). Drop in a folder of microscope images and get, apart from each other:

- **what is different** from the Batch_3 baseline: which measured property moved, by how much, in which direction, how sure we are;
- **which known batch it looks like** (attribution: Batch_1 / Batch_2 / Batch_3 with probabilities and the features that drove it);
- **whether it is inside the baseline's distribution at all** (a two-sided z view and an *unfamiliar* flag for an unknown batch N);
- **accept / investigate / reject**, from plain statistics and a customer tolerance, with the next action.

Measurements come from classic image processing; the verdict from plain statistics on strip segments. The only trained piece is the attribution model (PLAN_v4 §3.15): a regularised logistic regression on named features or on principal components of frozen DINOv2 image features, evaluated leave-one-strip-out, saved as readable JSON, and never the verdict. It always assigns a batch, with a checked confidence and reasons in plain language. Input, preprocessing, architecture, output and results are written up in [docs/MODEL.md](docs/MODEL.md).

## Plan

[docs/PLAN_v4.md](docs/PLAN_v4.md) is the plan and the source of truth for **what to build and what to do next** (its §4). It is self-contained: it holds everything that still stands from the earlier plans (v0–v3, deleted; see git history), the task designer's clarifications (Batch_3 baseline, attribute the unseen images, in or out of distribution), the results on the real data (§12) and the evidence behind each decision (§13). Sections 1–3 keep the v3 section numbers. This README documents **what is built**.

Status and next steps of the ML side, in plain language: [docs/PAT_SUMMARY.md](docs/PAT_SUMMARY.md). How to work in the ML code and what its outputs guarantee: [docs/AGENT_HANDOVER.md](docs/AGENT_HANDOVER.md). Software side: [docs/HANDOFF.md](docs/HANDOFF.md) and [docs/APP.md](docs/APP.md).

## Quickstart

```bash
brew install uv node@22  # once; the web UI needs Node >= 20.19
uv sync
uv run pytest            # contract tests, keep green

# put the batches in data/ (gitignored), e.g.
for b in Batch_1 Batch_2 Batch_3; do ln -s "../EXAMPLE BATCHES FOR LOCAL REFERENCE/$b" data/$b; done

uv run python -m qc.measure                                               # ML: all of data/ -> out/{kpis,particles,imaging}.csv + out/masks/
uv run python -m qc.run --batch data/Batch_2 data/Batch_3                 # end to end -> out/evidence/<baseline>/<batch>.json
uv run python -m qc.decide tests/fixtures/kpis_fake.csv --baseline fake_baseline   # backend only, no images
uv run python -m qc.types [--exclude Batch_2] [--porous-rule]             # fit particle types on out/particles.csv
uv run python -m qc.controls --baseline data/Batch_3                      # controls -> out/controls/summary.csv (KPI shifts only)
uv run python -m qc.control_check                                        # run controls through compare() -> out/controls.json
uv run python -m qc.uncertainty --batch data/Batch_3                      # -> out/uncertainty/*.csv
uv run python -m qc.features                                              # per-image feature table -> out/features.csv
uv run python -m qc.deep                                                  # DINOv2 deep_ columns merged into out/features.csv (CPU, local)
uv run python -m qc.attribute --evaluate                                  # leave-one-strip-out + null per family -> out/attribution/evaluation.json
uv run python -m qc.attribute --dry-run [--repeats 30]                    # hold out 3 images per batch (whole strips), refit, predict; repeats give the spread
uv run python -m qc.attribute --fit [--families deep | --staged tex:deep] # fit the model -> config/attribution_model.json (refitted 4 Oct, see docs/MODEL.md; the `rules-frozen` tag still points at the 3 Oct file)
uv run python -m qc.attribute --images data/<drop> [--balanced k]         # attribute unseen images -> out/attribution/<drop>.json

# Preview the UI with fixtures
mkdir -p out/evidence/example_reference out/attribution
cp tests/fixtures/evidence_example.json out/evidence/example_reference/example_batch.json   # shows in the Audit log
cp tests/fixtures/attribution_example.json out/attribution/example_drop.json
cp tests/fixtures/attribution_evaluation_example.json out/attribution/evaluation.json

# UI: two terminals
uv run uvicorn qc.api:app --reload     # API on :8000; export ANTHROPIC_API_KEY first for Claude's summary (optional)
cd web && npm install && npm run dev   # UI on :5173, proxies /api to :8000 (CATALYST_API=http://localhost:<port> to change)
```

## Architecture

> Keep this diagram in sync with the code. Any PR that adds, removes, renames or rewires a module, contract function, output file, endpoint or data flow updates it in the same PR (see [AGENTS.md](AGENTS.md)).

```mermaid
flowchart LR
  subgraph IN["Inputs"]
    D["data/{batch}/img_{id}_{detector}.tif<br/>BSE · ETD/SE · InLens, 0.025 µm/px"]
    CFG["config/decision.yaml<br/>baseline · key_descriptors · margins · unit<br/>alpha · ci_level"]
    DICT["config/kpi_dictionary.yaml<br/>Pat's audience dictionary, when present"]
  end

  subgraph GLUE["Shared glue"]
    IO["qc/io.py<br/>load_field → Field<br/>alias detectors · crop edges · px_um · strip_id · black_level"]
    RUN["qc/run.py · run() / attribute()<br/>measure + evaluate · explain before writing"]
    PROV["qc/provenance.py<br/>input + config hashes · git state · rules-frozen tag"]
  end

  subgraph ML["ML · qc/measure.py"]
    SEG["segment(channels, px_um, thresholds) → mask<br/>pore · graphite · Si · binder · ignore"]
    LBL["label_si(mask, px_um) → labels + filled<br/>hole fill + watershed at measure time"]
    KPI["kpis(mask, px_um, channels) → dict<br/>15 descriptors, names + units in schema.KPI_UNITS"]
    PAR["particles(mask, px_um, channels) → per-particle table<br/>d · contrast · inlens_ratio · voids · texture · solidity"]
    IMG["imaging(channels) → per-channel dict<br/>black · percentiles · noise · sharpness · saturation · curtaining"]
  end

  subgraph TYPES["ML · qc/types.py · controls.py · uncertainty.py"]
    TYP["fit_types / assign_types → particle types<br/>GMM + leave-one-strip-out k selection · frozen in config/particle_types.json"]
    CTL["make_controls / shared_strip_controls → Control fields<br/>negative + positive batches with a known answer"]
    CHK["qc/control_check.py · run_controls<br/>iter_controls, one at a time → Controls"]
    UNC["threshold_variants · integral_range<br/>segmentation + sampling uncertainty"]
  end

  subgraph ATTR["ML · qc/features.py · qc/attribute.py (PLAN_v4)"]
    FEAT["image_features(field, mask) → one row per image<br/>reg_ regional tiles · edge_ · tex_ LBP/GLCM · par_ · kpi_ · img_<br/>assert_no_leakage: no strip_id / size / px_um"]
    EVAL["loso_cv · permutation_null · shared_strip_check · rank_features<br/>leave-one-strip-out, segment-shuffled null"]
    FIT["fit_model → config/attribution_model.json<br/>standardised L2 logistic regression (flat or staged) · nested C<br/>Venn-Abers calibration · batch_stats · explain tables + importance"]
    PRED["predict(model, features) → always a batch · p_Batch_1/2/3<br/>confidence tier · stages with interval and held-out record (established?) · prediction_set · readable reasons<br/>baseline_distance · unfamiliar · balanced_assignment"]
  end

  subgraph BE["Backend · qc/decide.py"]
    J["evaluate(tables, batch, cfg, controls) → compare → Evidence<br/>image + strip units → differences → verdict"]
    EXPLAIN["qc/explain.py · explain(evidence, dictionary) → Explanations<br/>answer sentence · rules fired · next steps · 4 audiences"]
  end

  subgraph GUIDE["After the output · qc/guide.py (optional)"]
    GD["guide(evidence) → summary + walkthrough + 4 audiences<br/>fixed template, or one Claude call with {slots} Catalyst fills in<br/>house-rule checks · what-if: odd tiles left out"]
  end

  SLAB["qc/slab.py · build(batch) → indicative 3D slab<br/>packing at the measured fractions · textbook charge, plating, wear curves<br/>illustration only, never read by the verdict"]

  subgraph OUT["out/ (gitignored)"]
    T["kpis.csv<br/>one row per image, incl. area_um2"]
    PT["particles.csv<br/>one row per Si particle"]
    IT["imaging.csv<br/>one row per image and channel"]
    E["evidence/{baseline}/{batch}.json"]
    GC["guide/{baseline}/{batch}.json<br/>Claude's checked output, cached"]
    FT["features.csv<br/>one row per image, 6 feature families (+ optional deep_)"]
    AT["attribution/evaluation.json · feature_ranking.csv<br/>attribution/{run}.json"]
    P["masks/{batch}/{id}.png"]
    CR["crops/{type}/{n}.png<br/>example crops per particle type"]
    CJ["controls.json<br/>pass/fail per control, baseline + config hash"]
  end

  API["qc/api.py · FastAPI :8000<br/>GET health · config · settings · batches · evidence · guide · tiles · images · kpis · masks · attribution · attribution-model · attribution-evaluation · slab<br/>GET particles · layers · POST upload · run (?baseline one-off) · measure · attribution · guide · verify (NDJSON progress) · PUT settings/baseline"]
  CLAUDE["Claude API<br/>reads evidence + dictionary, never images"]
  WEB["web/ · Vite + React :5173 · Catalyst design<br/>identify tile (stage progress, region peek, result URLs) · compare batch (focus + walkthrough) · library + viewer (phase layers) · audit log + batch passport + parody lawsuit button · settings<br/>wear & impact · anode lab (Experimental, three.js, lazy-loaded)"]
  CLI["python -m qc.run / qc.control_check / qc.measure / qc.features / qc.attribute"]
  IMPACT["qc/impact.py · impact_report(kpis, particles, batch, baseline)<br/>Experimental: indicative cell impact + worst cases · config/impact.yaml<br/>never feeds the verdict"]

  D --> IO --> RUN
  RUN --> SEG --> LBL --> KPI --> RUN
  LBL --> PAR --> TYP
  TYP -. "config/particle_types.json (frozen)" .-> RUN
  RUN -. "attribute() → attribute_images()" .-> PRED
  RUN --> T --> J
  RUN --> PT --> J
  RUN --> IT --> J
  CTL --> CHK --> CJ --> RUN
  CTL -. "out/controls/summary.csv" .-> RUN
  UNC -. "out/uncertainty/*.csv" .-> RUN
  CFG --> J
  RUN --> EXPLAIN
  J --> EXPLAIN
  DICT --> EXPLAIN
  EXPLAIN --> E
  RUN --> P
  RUN --> PROV --> E
  TYP --> CR
  J --> E
  SEG --> FEAT
  PAR --> FEAT
  KPI --> FEAT
  IMG --> FEAT
  FEAT --> FT --> EVAL --> AT
  FT --> FIT
  FIT -. "config/attribution_model.json (frozen)" .-> PRED
  FT --> PRED --> AT
  T --> SLAB
  PT --> SLAB
  SLAB --> API
  E --> API
  E --> GD
  DICT --> GD
  T -. "what-if recompute" .-> GD
  GD <-. "only with ANTHROPIC_API_KEY" .-> CLAUDE
  GD --> GC
  GD --> API
  API -- "PUT settings/baseline (409 once frozen)" --> CFG
  AT --> API
  P --> API
  API -- "/api via Vite proxy" --> WEB
  WEB -- "upload + run" --> API
  API -- "run()" --> RUN
  API -- "attribute()" --> RUN
  CLI --> RUN
  T --> IMPACT
  PT --> IMPACT
  IMPACT -- "GET /api/impact" --> API
```

`qc/schema.py` is the contract every Python box imports: `Field`, the `Phase` labels, `KPI_UNITS`, `KPI_TABLE_COLUMNS` / `PARTICLE_COLUMNS` / `IMAGING_COLUMNS`, `Control`, the `Tables`/`Segment`/`Evidence` models and the `out/` paths (including `FEATURE_TABLE`, `ATTRIBUTION_DIR`, `ATTRIBUTION_MODEL_PATH`, `attribution_path()`). The attribution JSON is not part of `Evidence`: the API serves Pat's `out/attribution/<run>.json` as written. `web/src/types.ts` mirrors `Evidence` for the UI.

## Infrastructure

Everything runs **locally and offline**: no cloud, no database, no network calls in the verdict path (PLAN_v4 §2, Rule 4). There are three processes. The one optional network call is Claude's summary on Compare (`qc/guide.py`, PLAN_v4 §3.10): it runs only when the API process has `ANTHROPIC_API_KEY`, after the evidence exists, and never feeds the verdict. Without a key the page shows the fixed template.

| Process | Command | Port | Role |
|---|---|---|---|
| Pipeline (CLI) | `uv run python -m qc.run --batch …` | – | Measure → compare → write `out/`. This is what we freeze and run on the unseen batch |
| API | `uv run uvicorn qc.api:app --reload` | 8000 | Thin FastAPI wrapper: reads `out/`, saves uploads to `data/`, calls `run()` / `attribute()`. No QC logic |
| Web UI | `cd web && npm run dev` | 5173 | Vite + React + TypeScript + Tailwind. Talks only to `/api` (proxied to :8000 by `web/vite.config.ts`) |

**Folders**

| Path | In git? | Contents |
|---|---|---|
| `data/<batch>/` | no | Input TIFFs (or symlinks to them). One folder per batch; the folder name is the batch name |
| `EXAMPLE BATCHES FOR LOCAL REFERENCE/` | no | The 1.6 GB of Polaron images. Too big for git; screenshots of them are fine |
| `config/decision.yaml` | yes | Decision settings. Frozen with `git tag rules-frozen` before the unseen batch |
| `config/particle_types.json` | yes | Fitted particle-type model (GMM centres/covs, names, unassigned threshold). Frozen with `rules-frozen` |
| `config/kpi_dictionary.yaml` | yes | Plain-language meaning/causes/checks per descriptor (draft; causes need mentor review); read by `explain()` and hashed into provenance |
| `config/impact.yaml` | yes | Experimental Wear & impact page: textbook constants and ranges (Si/SiOx, graphite, Bruggeman exponent, critical sizes, N/P), wording per property, worst-case failure chains, references. Not part of the verdict and not covered by `rules-frozen` |
| `config/attribution_model.json` | yes, once fitted | Attribution model: feature names, means, SDs, coefficients, `C`, training image ids, the held-out record of its calls (`loso`, `calibration` with the Venn–Abers points), the per-batch statistics for the unfamiliar flag, and `explain` (reason tables and `importance`). Refitted on 4 Oct (v4.2); the `rules-frozen` tag still points at the 3 Oct file, so the app reports "model differs from the frozen one" until the tag is moved. Hashed into provenance when present |
| `out/kpis.csv` | no | KPI table, one row per image (incl. `area_um2`, the analysed area, and the sampling SDs `si_area_frac_sd` / `porosity_apparent_sd`), all batches measured so far |
| `out/particles.csv` | no | One row per Si particle: size, contrast, inlens ratio, voids, texture, solidity, type. Read by `compare()` |
| `out/imaging.csv` | no | One row per image and channel: black level, percentiles, noise, sharpness, saturation, curtaining. Read by `compare()` |
| `out/masks/<batch>/<image_id>.png` | no | BSE with phase overlay (4× downsampled), for eyeballing and the UI |
| `out/masks/<batch>/<image_id>.phases.png` | no | The same mask as `Phase` labels (uint8), plus cached `<image_id>.<silicon\|pore\|binder>.png` transparent layers served by `GET /api/layers` |
| `out/previews/<batch>/<image_id>_<detector>_<size>.png` | no | Cached detector previews (512/2048 px) served by `GET /api/images` |
| `out/impact/<baseline>/<batch>.json` | no | `python -m qc.impact` output (the API computes the same report on request) |
| `out/crops/<type>/<n>.png` | no | Example particle crops per type, for the UI gallery |
| `out/controls/summary.csv` | no | Measured KPI shifts for every control (`python -m qc.controls`) |
| `out/controls.json` | no | Whether each control passed `compare()`, plus the baseline name and the decision-config hash. `run()` passes it to `evaluate()` only when both still match |
| `out/uncertainty/` | no | `threshold_variants.csv` (KPIs at thresholds ±5) and `integral_range.csv` (per image and phase) |
| `out/evidence/<baseline>/<batch>.json` | no | The verdict and everything behind it, one file per batch *and* baseline, so a one-off baseline never overwrites the default comparison (PLAN_v4 still says `out/evidence/<batch>.json`; files at that old path are still read). The UI reads this, attribution output and masks |
| `out/guide/<baseline>/<batch>.json` | no | Claude's checked summary, walkthrough and four audience readings for one comparison, one cache entry, hashed by model, prompt and input |
| `out/features.csv` | no | One row per image: `batch, image_id, strip_id` + `reg_`, `edge_`, `tex_`, `par_`, `kpi_`, `img_` features (`qc/features.py`), plus optional `deep_` columns (`qc/deep.py`). Never strip, size or pixel-size columns |
| `out/attribution/evaluation.json`, `feature_ranking.csv` | no | Leave-one-strip-out balanced accuracy, confusion, permutation null and shared-strip check per feature family; univariate feature ranking on strip-segment means. Exposed by the API |
| `out/attribution/<run>.json` | no | Per image, always a batch: `p_Batch_*`, `predicted`, `confidence` (calibrated; `confidence_raw` is the classifier's own value), `confidence_tier` with `confidence_record`, `stage_baseline` (with the Venn–Abers `interval` of its confidence), `stage_variation`, each with its held-out `record` (right / n, binomial `p_value` against guessing, `established`) and a `note` when not established, `prediction_set` (the bet first; every variation when "which variation" is not established), `reasons` (with plain-language `text`), `baseline_distance`, `outside_baseline`, `deviations`, `predicted_distance`, `unfamiliar` (outside the batch it was assigned to), optional `assigned` (balanced). `model.calibration` holds the held-out record behind the tiers, stages and sets; `model.importance` says what each stage leans on overall. Exposed by the API |
| `tests/fixtures/kpis_fake.csv` | yes | Synthetic KPI table (`tests/synth.py`), so the backend and UI can be built with no images |
| `tests/fixtures/evidence_example.json` | yes | Hand-made, fully populated Evidence. To view it in the UI: `cp tests/fixtures/evidence_example.json out/evidence/example.json` and select `example` |
| `tests/fixtures/attribution_example.json`, `attribution_evaluation_example.json` | yes | Fixtures mirroring Pat's output format |
| `assets/` | yes | Brand assets: Catalyst the cat (`cat/Cat.tsx`, SVGs, `preview.html`) and the logo (the c is a cat head, the y has a tail). See `assets/README.md` |
| `design/` | yes | Design system for the app redesign: `tokens.css` (colours, type, glass), the new logo and cat moods in `logo/`, and the screen designs in `canvas/`. See `design/README.md` |
| `demo_video/` | yes | The 2-minute demo video. `PROMPT.md` is the one-shot brief for building it with Remotion + ElevenLabs |
| `docs/TICKETS.md` | yes | Post-freeze experiment and implementation tickets (T1–T15). Report-only; T14 was adopted into the model on 4 Oct (docs/experiments/T14.md, "Adoption") |
| `docs/MODEL.md` | yes | The attribution model, written up end to end: input, preprocessing, architecture step by step, output, performance, explainability and the most important features |
| `results/` | yes | Scored unseen folders, committed unchanged: `Hackathon-Polaron-test.json` (frozen model, 3 Oct), `Hackathon-Polaron-test.refit.json` (v4.2, 4 Oct; same three bets) and `Hackathon-Polaron-test.stage-records.json` (same numbers, with the stage records). `Hackathon-Polaron-test.ground-truth.json`: the true batches given on 4 Oct and each file scored against them (1 of 3 exact, 3 of 3 Batch_3-or-not; docs/experiments/T18.md) |
| `scripts/experiments/<ticket>_<slug>.py` | yes | One script per experiment ticket. Diagnostics and candidates only; never imported by `qc/`. `T14_adoption.py` is the check behind the 4 Oct calibration; `T18_tiles.py` and `T18_ground_truth.py` are the ground-truth analysis of the test samples (docs/experiments/T18.md) |
| `docs/experiments/<ticket>.md` | yes | Pre-registered hypothesis and reading rules, then the results of each experiment ticket |
| `out/experiments/<ticket>/` | no | Raw outputs of the experiment scripts (tables, caches such as T1's `perturbed_features.parquet`) |

**HTTP API** (`qc/api.py`, called from `web/src/api.ts`)

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ok, model_present, deep_importable, dinov2_cached, message}`: whether Identify can run a drop offline (model file, `qc.deep` import, cached DINOv2 weights). The Identify screen blocks upload while `ok` is false |
| `GET /api/config` | `config/decision.yaml` as JSON |
| `GET /api/settings` | `{baseline, rules_frozen_commit, rules_frozen_date, rules_frozen_config, claude: {available, model, reason}}`; `rules_frozen_config` has each frozen file's sha256 under the tag and now, so a change since the freeze shows in the Audit banner |
| `PUT /api/settings/baseline` | Body `{baseline}`: writes the default `baseline` line of `config/decision.yaml`. 409 once the `rules-frozen` tag exists, 404 for a missing folder |
| `GET /api/batches` | `[{name, has_images, verdict}]`: folders in `data/` plus evidence against the default baseline |
| `GET /api/evidence` | `[{batch, baseline, verdict, created_at}]`: every comparison on disk, newest first (the audit log) |
| `GET /api/evidence/{batch}?baseline=` | `Evidence`; `baseline` omitted = the default. A file from before the plain-word texts gets them written on load from its own numbers (`qc.run.load_evidence`) |
| `GET /api/guide/{batch}?baseline=&source=template\|claude` | Summary, walkthrough and `audiences` (`qc/guide.py`): `{source, model, fallback_reason, summary, steps, audiences, slots, checks}`. `audiences` is `{operator, engineer, scientist, manager}`, each `{source, sentences}`. Free: the template, or Claude's cached version with `source=claude` (else the template with `fallback_reason`) |
| `POST /api/guide/{batch}?baseline=` | Ask Claude once for the summary, the walkthrough and the four audience readings (a paid call, cached per evidence in `out/guide/`). Only the "Ask Claude" button calls it. The verdict does not read this |
| `GET /api/attribution` | Sorted attribution run names |
| `GET /api/attribution/{name}` | `Attribution` |
| `GET /api/attribution-model` | The model `POST /api/attribution` will use: kind, families, fit time, held-out record (`calibration`), `importance` (what each stage leans on), sha256, and `matches_frozen` (the file is the one under `rules-frozen`) |
| `GET /api/attribution-evaluation` | Pat's feature-family evaluation report |
| `GET /api/masks/{batch}/{image_id}.png` | Mask overlay |
| `GET /api/tiles` | `[{batch, image_id, strip_id, detectors, kpis, has_mask, has_layers}]`: every image in `data/` joined with `out/kpis.csv` |
| `GET /api/images/{batch}/{image_id}/{detector}?size=512\|2048` | Percentile-stretched PNG preview, cached in `out/previews/` |
| `GET /api/kpis` | `config/kpi_dictionary.yaml` as JSON, plus a name for each fitted particle type it doesn't describe yet (from `config/particle_types.json`) |
| `GET /api/slab/{batch}?image={id}` | Indicative 3D slab for the anode lab (`qc/slab.py`): particle packing, pore mask, charge / fast-charge / ageing curves, indicators with per-image ranges, assumptions. Batch median, or one image with `image`. Cached in memory |
| `GET /api/layers/{batch}/{image_id}/{silicon\|pore\|binder}` | One segmentation phase as a transparent PNG, to lay over any detector in the peek and inspector; 404 until the tile is measured |
| `GET /api/particles/{batch}/{image_id}?top=8` | `{width, height, px_um, particles: [{x, y, d_um, type}]}` from `qc.run.tile_particles`: the tile's size (cropped, full-res px) and its largest non-edge Si particles from `out/particles.csv`, for the region peek |
| `POST /api/verify/{batch}?baseline=` | Re-hash the evidence's provenance inputs and config files (with its own baseline) → `{ok, files, config_ok}` |
| `POST /api/batches/{batch}/files` | Multipart upload of a folder's TIFFs into `data/{batch}/`. Folder and file names: letters, digits, `_ . -` only (400 otherwise; the UI slugifies folder names) |
| `POST /api/runs/{batch}?baseline=` | NDJSON stream: one `{"type":"progress","done","total","tile"}` per measured tile, then `{"type":"done","evidence"}` or `{"type":"error","message"}`. `baseline` runs a one-off comparison with `cfg \| {baseline}`; the default doesn't move |
| `POST /api/measure/{batch}` | NDJSON stream: measure one folder (e.g. an Identify drop) into `out/kpis.csv` and masks, without comparing it |
| `POST /api/attribution/{name}?balanced={k}` | NDJSON stream: `{"type":"progress","stage":"features"\|"deep"\|"predict","done","total","tile"}` while Pat's `attribute_images` runs (when it takes `progress`), then `{"type":"done","attribution"}`; `balanced` is optional, 501 if `qc.attribute` is unavailable |
| `GET /api/impact/{batch}?baseline=` | Experimental: `qc.impact.Report` from `out/kpis.csv` + `particles.csv` (404 if either batch is unmeasured, 422 if the table is unusable) |

**Dependencies.**
- Python: `pyproject.toml` + `uv.lock`, Python 3.11.
- Web: `web/package.json` + `package-lock.json`.
- Supply-chain guard: `[tool.uv] exclude-newer` blocks Python packages published in the last week. For npm, install with `npm install --before=<date a week ago>`.

## Data pipeline

One command, `qc.run`, does steps 1–9 for the baseline plus each requested batch. `qc.measure` does steps 1–8 only.

| # | Step | Code | Output |
|---|---|---|---|
| 1 | **Find fields.** Group `img_<image_id>_<detector>.tif` by ID | `io.field_paths` | `{image_id: {detector: path}}` |
| 2 | **Load.** Take one channel of the RGB TIFF, crop 8 px off left and right (stitch borders), read pixel size, strip ID and the per-channel black level | `io.load_field` | `Field(batch, image_id, strip_id, channels, px_um, black_level)` |
| 3 | **Segment.** Black level off, 2× downsample, 3-class multi-Otsu, binder rims, small-Si cleanup, dim-object → BINDER rule (`SI_MIN_CONTRAST`), 5% IGNORE margins | `measure.segment(channels, px_um, thresholds)` | `uint8` mask with `Phase` codes |
| 4 | **Measure KPIs.** Includes `label_si` (hole fill + watershed) and the two-point correlation | `measure.kpis(mask, px_um, channels)` | `{kpi: value}` |
| 5 | **Particles.** Per-particle features at full res | `measure.particles(mask, px_um, channels)` | `particles.csv` rows |
| 6 | **Types.** If `config/particle_types.json` exists, assign each particle a type | `types.assign_types` | `type` column |
| 7 | **Imaging check.** Per-channel imaging descriptors | `measure.imaging(channels)` | `imaging.csv` rows |
| 8 | **Write.** One row per image into the KPI table (incl. `area_um2`, the analysed area), the particle and imaging tables, plus a mask overlay | `run.measure_field`, `run.save_tables`, `run.save_overlay` | `out/kpis.csv`, `out/particles.csv`, `out/imaging.csv`, `out/masks/` |
| 9 | **Compare** each batch against the baseline on all three tables and record provenance | `decide.split_tables`, `decide.evaluate`, `provenance.provenance` | `out/evidence/<baseline>/<batch>.json` |

**Input details (step 2, PLAN_v4 §1.1)**
- **Detectors** are normalised to `BSE` / `ETD` / `InLens`; `SE` is an alias for `ETD`. The `img_` prefix is dropped from IDs.
- **`px_um`** comes from the TIFF `XResolution` / `ResolutionUnit` tags (0.025 µm/px), or NaN if missing.
- **`strip_id`** is `"<height>_<round(XResolution)>"`, e.g. `2316_1015998`. It groups images cut from one strip; used for the strip-level view and the gallery. The image is the unit of the verdict.
- **`black_level`** is the 0.5th percentile per channel, read off a 256-bin histogram (cheap on ~12 MP fields). Channels stay raw; subtracting it is `segment()`'s job (§3.2).

**Phase labels (`schema.Phase`)**

| Code | Phase | Look in BSE |
|---|---|---|
| 0 | `PORE` | black |
| 1 | `GRAPHITE` | dark grey flakes |
| 2 | `SI` | bright particles |
| 3 | `BINDER` | thin films at particle edges |
| 255 | `IGNORE` | excluded pixels (e.g. top and bottom margins) |

**Segmentation (step 3).**
- Per-channel black level (0.5th percentile) subtracted from BSE; 2× block-mean downsample; Gaussian σ = 1.
- 3-class multi-Otsu per image on the valid rows → pore / graphite / Si (percentile fallback if Otsu fails, e.g. uniform images). `thresholds` is an optional argument so the uncertainty step can rerun with offsets.
- Thin bright rims along graphite edges (removed by a 0.15 µm opening, adjacent to graphite) → `BINDER`; other opening losses → `GRAPHITE`. Si components < 0.25 µm² → `GRAPHITE`.
- Top and bottom 5% of rows → `IGNORE` (edge rows may carry FIB damage). Mask upsampled to full resolution.
- Hole filling and watershed splitting are **not** baked into the mask — they happen in `label_si` at measure time, so the mask stays pure phase codes and area fractions are unaffected by split lines.

**KPIs (step 4, definitions in PLAN_v4 §3.2)** — all implemented:

| KPI | Unit | Status |
|---|---|---|
| `si_area_frac` | fraction | **implemented**: Si px / non-ignored px |
| `porosity_apparent` | fraction | **implemented**: pore px / non-ignored px. Biased: open pores show their back wall |
| `si_graphite_ratio` | ratio | **implemented**: Si px / graphite px. The key descriptor — follows the recipe, porosity-invariant |
| `si_d50_um`, `si_d90_um` | µm | **implemented**: area-weighted equivalent diameter, non-border particles |
| `si_internal_void_frac` | fraction | **implemented**: non-Si px inside hole-filled Si / filled Si area |
| `si_contrast_ratio` | ratio | **implemented**: smoothed BSE mode of Si / graphite. Dropped for the verdict if imaging changed |
| `si_fragments_per_1e4um2` | count | **implemented**: 8-connected Si objects < 1 µm per 10⁴ µm² |
| `si_dispersion_cv` | ratio | **implemented**: CV of local Si fraction over ~20 µm windows |
| `si_agglomerate_frac` | fraction | **implemented**: share of Si px in domains > 5 µm (Si closed by 0.5 µm) |
| `si_corr_length_um` | µm | **implemented**: first r where the Si two-point correlation ≤ 1/e |
| `graphite_chord_um` | µm | **implemented**: mean horizontal graphite run length (edge runs excluded) |
| `graphite_anisotropy` | ratio | **implemented**: horizontal / vertical graphite chord |
| `pore_chord_um` | µm | **implemented**: mean horizontal pore run length |
| `pore_connectivity` | fraction | **implemented**: largest 4-connected pore component / all pore area |

A KPI that isn't computed, or an image whose segmentation crashes, is written as **NaN**: the run never stops on one bad image. Columns of `out/kpis.csv` are `batch, image_id, strip_id, px_um, area_um2, <15 KPIs>`.

**Particles (step 5).** `particles()` returns one row per watershed-labelled Si particle: `d_um`, `area_um2` (filled), `contrast_ratio` (median black-subtracted BSE over its Si px / image graphite mode), `inlens_ratio` (mean black-subtracted InLens over the particle, saturated px excluded, / same for graphite in a 1–3 µm ring — cancels the InLens shading), `void_frac`, `texture` (std/mean of BSE inside), `solidity`, `border`, `y_px`/`x_px` (full-res centroid). `run` adds `batch`, `image_id`, `strip_id`, `type`.

**Particle types (step 6, `qc/types.py`).** `fit_types` standardises `log_d, contrast_ratio, inlens_ratio, void_frac, texture, solidity`, fits `GaussianMixture` for k = 2, 3, 4 and picks k by leave-one-strip-out stability (ARI against the full fit, preferring smaller k within 0.02), merges types that differ only in size (< 0.5 z on every feature but `log_d`), and names each type from its features in units. `assign_types` assigns the nearest type by Mahalanobis distance; beyond the 99th percentile of training distances → `unassigned`; with `--porous-rule`, `void_frac > 0.1` → `porous`. `uv run python -m qc.types` fits on `out/particles.csv` (optionally excluding batches), writes `config/particle_types.json`, rewrites the `type` column and saves example crops to `out/crops/`.

**Controls (`qc/controls.py`, `qc/control_check.py`, PLAN_v4 §3.7 + §3.13).** `make_controls` builds negative controls (brightness/contrast ±20%, black +20, noise σ5, synthetic curtaining) and positive controls (donor Si pasted to +50%/+100%, voids punched into 30% of particles, non-border Si scaled 1.5× with 1/2.25 thinning to hold Si amount constant) from a random choice of reference strips. `shared_strip_controls` splits reference strips between a test batch and the reference (`kept_in_reference` holds the image_ids that stay). Shared-strip controls are not part of the verdict. `uv run python -m qc.controls` measures every control against its untransformed originals and writes `out/controls/summary.csv`. `uv run python -m qc.control_check` runs `iter_controls` one at a time (not the shared-strip set), measures each with `measure_field`, and compares it with the baseline minus that control's source strips (`kept_in_reference` image ids stay). A negative passes when no used key quantity is DIFFERENT. A positive passes when at least one is, and the first DIFFERENT driver equals `expected_driver`. The result is `out/controls.json` (`Controls` plus `baseline`, `config_sha256` of the decision config, `created_at`). `run()` loads it into `evaluate()` only when the baseline and that hash match; otherwise controls count as not run.

**Features (`qc/features.py`, PLAN_v4 §3.14).** `image_features(field)` returns one row per image: regional descriptors per ~15 µm tile summarised over tiles (mean, SD, CV, p10/p50/p90, normalised depth slope, top/bottom ratio), the ignored top/bottom 5% bands measured separately, uniform-LBP histograms per channel (and BSE inside graphite and inside Si) plus GLCM statistics at 0.05 and 0.2 µm, image-level particle aggregates (incl. type shares if `config/particle_types.json` exists), the 15 KPIs, and the imaging descriptors. `assert_no_leakage()` refuses any column whose name mentions strip, height, width, px_um, xres or shape. `uv run python -m qc.features` writes `out/features.csv`.

**Deep features (`qc/deep.py`, PLAN_v4 §3.14).** CPU torch + transformers are regular dependencies, because the frozen model needs them (CPU wheel index on Linux/Windows, PyPI on macOS); the `deep` extra is kept only so older `--extra deep` commands still work. `deep_features(field)` embeds the InLens channel with the public `facebook/dinov2-small` (pinned revision, no fine-tuning): valid rows, p1–p99 stretch, 2×2 binning, 224 px tiles, CLS + mean patch token per tile, mean and SD over tiles → 1,536 `deep_inlens_s2_*` columns. Weights download once to the Hugging Face cache; set `HF_HUB_OFFLINE=1` afterwards. Images never leave the machine. `python -m qc.deep` merges the columns into `out/features.csv` (re-run it after `qc.features` rewrites a batch). `qc.attribute --images` computes them automatically when the frozen model uses them.

**Attribution and familiarity (`qc/attribute.py`, PLAN_v4 §3.15–3.17).** Material families only by default (`reg, edge, tex, par, kpi`; `img_` is reported apart because it is acquisition, not material). `loso_cv` holds out every image of one physical strip across all folders, standardises inside the fold and picks `C` from {0.01…1} by an inner leave-one-strip-out. `permutation_null` shuffles batch labels across strip segments (≥200×). `shared_strip_check` asks whether images of strips imaged in two folders were attributed to their own folder. `rank_features` scores each feature alone on strip-segment means. `fit_model` saves readable JSON; `predict` gives probabilities, the five largest `coef × z` reasons, the two-sided RMS-z distance to the Batch_3 strip segments with an `unfamiliar` flag (threshold = the baseline's own maximum held-out distance), and, with `--balanced k`, the Hungarian assignment of exactly *k* images per batch. `dry_run` rehearses the nine-image test holding out whole strips. `deep_` columns are replaced by 10 principal components (`Reducer`) fit on the training rows of each fold; the frozen JSON stores the PCA mean, SD and components next to the coefficients, and reasons name `deep_pc01…10`.

**Always a bet, with confidence and reasons (`qc/attribute.py`, PLAN_v4 Rule 11).** Every image gets a batch; nothing in the output is a non-answer. The bet follows the two questions (`_call`): the baseline if it is at least as likely as not, else the leading variation. `calibrate` reads the model's own out-of-fold (strip-held-out) probabilities and stores in the model: the Venn–Abers points for "baseline or not" (each image's out-of-fold p(baseline) and its label), and a held-out record in which every strip is calibrated with the other strips' points only: accuracy and log loss of the calls, how often calls in each confidence tier (high ≥ 0.75, medium ≥ 0.5, low) were right, the right / n of each stage, and the conformal `qhat` behind `prediction_set` (α = 0.2) with its coverage and mean size. `predict` turns a new image's raw p(baseline) into a calibrated one with its interval (`venn_abers`, isotonic regression with the two labels weighted equally, as in the classifier); the other batches share the rest in their raw proportions. There is no temperature. Why this variant: [docs/experiments/T14.md](docs/experiments/T14.md), "Adoption". `stage_baseline` answers "different from the baseline?" and `stage_variation` "in what way?", each with its own confidence and its held-out `record` (`stage_record`): right / n from `calibration.stages`, a one-sided binomial `p_value` against guessing, and `established` if p < `ESTABLISHED_P` (0.05). A stage that is not established still makes its call (Rule 11), carries a `note` saying it is a lean, keeps every option it cannot tell apart in `prediction_set`, is never shown above the low confidence tier, and is explained by the established stage's reasons only. Today "baseline or not" is established (26 of 31) and "which variation" is not (8 of 12, p = 0.19; 0 of 2 on the test samples, [docs/experiments/T18.md](docs/experiments/T18.md)). `unfamiliar` compares the image with the strip segments of the batch it was assigned to (`batch_stats`); `outside_baseline` is the same test against Batch_3. `explain_tables` stores what makes reasons readable: for each `deep_pcNN` the named material features it correlates with on the training rows (|r| ≥ 0.5, at most three), and for each named feature its plain name (`features.describe`, `config/kpi_dictionary.yaml`), its Batch_3 mean and SD over strip segments and each batch's mean; every reason then carries a `text` such as "InLens texture smoothness at 0.05 um: 2.1 SD above Batch_3". `importance` (stored in `explain.importance`) says what each stage leans on over all its training images: per model feature the mean |coefficient × z| as a share of the stage's total, summed per feature family, with the eight largest listed. `--staged a:b` fits a two-stage model (baseline-or-not on families `a`, which variation on families `b`) and multiplies the stages. `dry_runs` (`--dry-run --repeats N`) repeats the rehearsal over held-out draws and reports the spread, the per-tier record and the prediction-set coverage on images the model never saw.

**Uncertainty (`qc/uncertainty.py`, PLAN_v4 §3.6).** `threshold_variants` re-runs segment+kpis at thresholds ±5 grey levels; `integral_range` estimates the phase-fraction SD for a given imaged area (and the area for a target SD) from the two-point correlation — the "how many images are enough" number. CLI writes `out/uncertainty/`. `measure_field` also stores, per image, `si_area_frac_sd`, `porosity_apparent_sd` and the two integral ranges on the KPI table. These are sampling (representativity) uncertainty only: how far the fraction would move on another patch of the same electrode. A 95% band is the value ± 1.96 × SD, clipped to [0, 1]. `integral_range` estimates the fraction on a 4× subsample; when that differs from `kpis()` by more than 0.002, the SD uses the full-mask fraction. Threshold uncertainty is separate and can be larger. The columns are not in `KPI_UNITS`, so they are not features or verdict inputs. `compare` copies them onto `Evidence.image_uncertainty` and `Evidence.sampling_check` (observed image-to-image SD divided by the RMS of the per-image SDs). A ratio near 1 means the spread is what one image's sampling already allows; much larger means the batch is uneven. That sentence is report-only, in the engineer and scientist texts and on Compare's run details. Identify and the Library show `± pp` on the silicon-content and apparent-porosity rows of the open tile.

## Decision algorithm (`qc/decide.py`)

Pure statistics on KPI, particle and imaging tables; it never sees image pixels. It follows PLAN_v4 §3.5; how it got there from the v3 design is listed below.

**1. Tables and units.** `split_tables` groups `out/kpis.csv` into one `Tables` per batch (`kpis`, `particles`, `imaging`). `compare(ref, batch, cfg)` builds both image units (one per image) and strip units (one per `strip_id`, with a value area-weighted over its images; equal weights where area is missing). `unit` selects which view drives the verdict; the other is reported alongside it. An image with a missing `strip_id` uses its `image_id` as the strip id.

**2. Quantities.** `key_descriptors` in config order, then type-share quantities sorted by name, `KPI_UNITS`, then other numeric columns. Type shares count as keys when `key_type_shares` is true. `used` = key and measured on both sides (`note: "not measured"` otherwise).

**3. Particle types and imaging.** Per image, `type_share:<type>` = Si area of that type / all typed Si area (border particles included), and `unassigned_share` likewise; `new_type_share` pools the unassigned share over the batch. Type shares become keys when `key_type_shares` is true, and `fingerprint.type_shares` reports their driving-unit values, intervals and strip values. Strip shares are area-weighted means of the images' shares, not pooled particles. The imaging check flags baseline images whose black level in any channel differs from that channel's median by more than `imaging_black_outlier`, then compares each metric with the non-outlier baseline min–max range widened by `imaging_widen` and at least `imaging_min_pad`. A metric counts as outside only when the batch's median is outside that padded range, or at least two images are. Only acquisition metrics (`black_level`, `p50`, `noise`, per channel) set `imaging.changed` and pause `imaging_sensitive` keys; other metrics that are outside go on `imaging.report_metrics` and do not change the verdict. The next action names at most the three most out-of-range acquisition metrics. When `curtaining_max` is not null, BSE `curtaining_index` above it blanks `curtaining_sensitive` descriptors on both sides; null leaves them untouched.

**4. Units.** `unit` is `image` or `strip` (default `image`). `analyze` runs at both units with nothing dropped; `Evidence.other_unit` holds the other unit's power and used-key statuses. A used key quantity that is DIFFERENT at one unit and SIMILAR at the other is a contradiction: INVESTIGATE, not REJECT, because images from one strip are correlated and an image-level p can be too small.

**5. Difference per quantity.** `reference`/`batch` = unweighted means over the driving-unit values; `difference` = batch − reference. `interval` = `ci_level` t-interval on the difference with pooled SD `sp` and n1 + n2 − 2 degrees of freedom. `margin` δ = `margins[name]` if set, else `similar_margin` × SD (ddof 1) of the baseline's image values; the same δ is used at both units.

**6. Family-wise p, status, drivers.** Labels are shuffled over driving-unit values (the units are values for ≥ 1 used key quantity): all C(n1 + n2, n1) arrangements when ≤ `n_resamples`, else `n_resamples` seeded draws; the observed arrangement always counts. `p` = share of arrangements whose **max-|T| over the used key quantities** reaches the observed |T| (single-step Westfall–Young: the same p protects all key quantities at once). Status for a used key quantity: DIFFERENT when `p < alpha` and |difference| > δ; SIMILAR when the interval lies inside ±δ; else UNCLEAR. Non-key or unused-but-measured quantities get a descriptive status from the interval alone — it never affects the verdict. `drivers` ranks the used key quantities by |difference| / δ.

**7. Power.** `power.n_arrangements` = C(n1 + n2, n1) on the driving unit counts; `min_p` = 2/N for equal counts else 1/N; `limited` when `min_p ≥ alpha`; `extra_needed` = the extra batch units that would lift the limit (≤ 20).

**8. Odd units, verdict, next action.** `odd_units` flags batch images or strips outside the baseline mean ± `odd_sd` × SD of baseline values at that unit (at least 3 baseline values); `odd_images` and `odd_strips` are both reported, but only the driving unit's list triggers the verdict. The reported range is clipped at 0, and at 1 for fractions; the flag itself still uses the raw mean ± k SD. The verdict follows the precedence in the deviations below (new type → DIFFERENT not contradicted by the other unit → imaging → odd units → contradictions → power → UNCLEAR → controls missing or failed → nothing measured), with `reasons` listing every trigger that fired. Failed controls are the same gate as controls that have not run: they block ACCEPT, they are not an earlier trigger, and they do not replace the next action. `next_action` is computed from the first trigger: quarantine/check-supplier on REJECT, more units on power limit, `units_to_settle` (the extra units that push the top UNCLEAR quantity's interval fully inside or outside ±δ) on UNCLEAR, "Release the batch" on ACCEPT.

**9. Fingerprint and provenance.** `fingerprint.segments` stays at strip level for the image gallery; each descriptor's value and t-interval use the driving unit, with `by_strip` values from the strip segments. Type shares are listed separately in `fingerprint.type_shares`; `imaging`, `controls` and `explanations` remain available. Nearest batch, image groups and variance split were dropped: batch attribution (Pat's `qc/attribute.py`) replaces them. `qc/provenance.py` fills `provenance` (§3.11): SHA-256 per input TIFF, git commit + dirty flag, a canonical hash of the config plus hashes of `config/particle_types.json`/`config/kpi_dictionary.yaml` when present, the `rules-frozen` tag if it exists, and a timestamp — the only field that differs between identical runs.

### Changes from the v3 design

Decided by Patrik on 3 Oct after checking the v3 plan's §3.5 against the real strip layout; implemented in `qc/decide.py`. PLAN_v4 now states these as the plan; "the plan" and the section numbers in this list refer to the v3 text it replaced (git history).

> **Mentor update (3 Oct), implemented here.** The image is the unit of the verdict, the strip view is computed alongside, and shared-strip logic is removed. Sorting images into batches is Pat's `qc/attribute.py`; the software side wraps it (see [docs/HANDOFF.md](docs/HANDOFF.md)).

- **SIMILAR uses a t-interval, not the two-level bootstrap (§3.5).** 90% interval on driving-unit values with pooled SD and n1 + n2 − 2 degrees of freedom, as in the FDA tier-1 method the plan cites [R7]. The margin δ is `similar_margin` × the baseline image SD, used at both units, and can be fixed per key quantity in `margins` at Sync 2.
- **Consequence: INVESTIGATE is the normal answer for the strip view.** With 3–7 strips SIMILAR is rare. Per image there are 7–17 units. The next action says how many more units would settle it. The Sync 1 self-split check passes when at most `alpha` of the splits come out DIFFERENT, and each negative control (§3.7) passes when it is not DIFFERENT: no false REJECT. Neither needs SIMILAR.
- **Power limit.** A comparison is power-limited when the smallest achievable p ≥ `alpha`: 2/N for equal unit counts (an arrangement and its mirror give the same |T|), else 1/N, where N is the number of arrangements. The plan's "N < 1/alpha" misses e.g. a 3 vs 3 strip comparison, N = 20, smallest p = 0.10.
- **Imaging range padding.** The 10% widening has a per-metric floor (`imaging_min_pad`), so a metric that is constant in the baseline (BSE black level 0) doesn't flag a 1-grey-level change.
- **Imaging outliers.** Outliers are baseline images, not strips (§3.3 says strips), since the image is the unit.
- **Type shares.** Shares are per image; a strip value is the area-weighted mean of its images' shares, not pooled particles (§3.5).
- **Curtaining.** BSE `curtaining_index` blanks `curtaining_sensitive` on both sides; off (`curtaining_max: null`) until Pat calibrates it.
- **Explanation presentation.** The audience texts carry no pictures yet (§3.8 says pictures go with the words); the UI adds them in step 5. The interval level is not in the texts because `ci_level` is not part of `Evidence`.
- **The image is the unit of the verdict (§3.5 says strip segment).** Mentors (3 Oct): batches are synthetic morphology groupings, so strips don't matter. The strip view is computed alongside; a DIFFERENT-vs-SIMILAR split between units → INVESTIGATE because images of one strip are correlated and an image-level p can be too small.
- **Shared-strip variants removed (§3.5, §3.13).**
- **Nearest batch, image groups and variance split dropped (§3.5):** batch attribution replaces them.
- **Odd check (new), at both units.** A batch image or strip outside baseline mean ± `odd_sd` × the baseline SD at that unit, on a used key quantity, is listed and triggers INVESTIGATE only at the driving unit: the FDA tier-2 quality range from the same framework [R7]. `odd_sd: null` turns it off.
- **Verdict precedence (not specified in the plan).** New particle type → REJECT, or INVESTIGATE if imaging changed (type features are brightness-based). A key quantity DIFFERENT and not contradicted by the other unit → REJECT. Any UNCLEAR, power limit, imaging change, odd unit or unit contradiction → INVESTIGATE. Otherwise ACCEPT, and only when the controls ran and passed. Controls that failed or never ran only block ACCEPT: the verdict and the next action stay what they would be without that gate, and the reason names the failures (`Controls failed (…): ACCEPT needs passed controls.`). `reasons` lists every trigger that fired.
- **Structure.** `compare(ref, batch, cfg)` stays a two-sample comparison; provenance lives in `qc/provenance.py` instead of `qc/run.py`. `kpis.csv` gains `area_um2` (analysed area) so strip values can be area-weighted.

**Config (`config/decision.yaml`)**

| Key | Default | Meaning |
|---|---|---|
| `version` | `v3-draft` | Written into every evidence file |
| `data_dir` | `data` | Where batch folders live |
| `baseline` | `Batch_3` | The approved reference batch: the material the supplier promised (confirmed by the task designer, PLAN_v4 §1) |
| `reference_exclude` | `[]` | Baseline `image_id`s to drop from the reference |
| `unit` | `image` | Unit that drives the verdict: `image` or `strip`; the other is reported in `other_unit` |
| `key_descriptors` | 5 items | Quantities that count towards the verdict |
| `key_type_shares` | `true` | Particle-type shares count as key quantities (§3.4) |
| `imaging_sensitive` | `si_contrast_ratio`, `porosity_apparent` | Reported but unused if imaging changed (§3.3) |
| `imaging_black_outlier` | `10` | Exclude a baseline image from the imaging range if any channel's black level differs from its baseline median by more than this |
| `imaging_widen` | `0.1` | Widen each baseline metric range by this fraction of its width on both sides |
| `imaging_min_pad` | `{black_level: 2, p1: 2, p50: 2, p99: 2, saturated_frac: 0.001}` | Minimum padding on each side of the listed imaging metric ranges |
| `curtaining_max` | `null` | BSE `curtaining_index` above this blanks run-length descriptors; `null` turns it off pending Pat's calibration |
| `curtaining_sensitive` | `[graphite_chord_um, pore_chord_um, graphite_anisotropy]` | Descriptors set to NaN on curtained images |
| `ci_level` | `0.90` | Level of the t-intervals |
| `alpha` | `0.10` | Family-wise threshold for DIFFERENT |
| `similar_margin` | `1.5` | δ = this × baseline image SD (FDA tier-1) |
| `margins` | `{}` | Per-quantity δ overrides, fixed at Sync 2 |
| `new_type_share` | `0.05` | Unassigned Si share that means a new particle type |
| `n_resamples`, `seed` | `5000`, `0` | Resampling budget and seed |
| `odd_sd` | `3.0` | Odd range = baseline mean ± this × baseline SD at each unit; `null` turns it off |

`run()` loads `out/controls.json` when its `baseline` and `config_sha256` match the config in use. Until that file exists, `Evidence.controls.ran` stays false and ACCEPT stays closed. The verdict also reacts to `new_type_share` and to `imaging.changed`.

### Evidence JSON (`schema.Evidence`)

```json
{
  "batch": "fake_shift", "baseline": "fake_baseline", "verdict": "REJECT",
  "reasons": ["si_graphite_ratio differs from the reference: 0.129 vs 0.0889 (difference 0.0401, margin ±0.0121, p = 0.000200).",
              "Image fake_shift_S1_0 (strip S1) is outside the reference range on si_graphite_ratio: 0.142 vs 0.0647–0.113."],
  "next_action": "Hold the batch. Top driver: si_graphite_ratio (0.129 vs 0.0889). Check it at the supplier.",
  "unit": "image",
  "differences": [{"name": "si_graphite_ratio", "unit": "", "key": true, "used": true,
                   "reference": 0.0889, "batch": 0.129, "difference": 0.0401,
                   "interval": [0.0323, 0.0479], "margin": 0.0121, "p": 0.000200,
                   "status": "DIFFERENT", "n_segments": [8, 17]}],
  "drivers": ["si_graphite_ratio", "si_contrast_ratio", "porosity_apparent", "..."],
  "power": {"n_segments": [8, 17], "n_arrangements": 1081575, "min_p": 9.25e-07,
            "limited": false, "extra_needed": 0},
  "other_unit": {"unit": "strip", "power": {"n_segments": [6, 7], "n_arrangements": 1716,
                 "min_p": 0.000583, "limited": false, "extra_needed": 0},
                 "statuses": {"si_graphite_ratio": "DIFFERENT", "si_d50_um": "SIMILAR",
                              "si_internal_void_frac": "SIMILAR", "si_contrast_ratio": "UNCLEAR",
                              "porosity_apparent": "SIMILAR"}, "contradictions": []},
  "odd_images": [{"strip_id": "S1", "image_ids": ["fake_shift_S1_0"], "quantity": "si_graphite_ratio",
                  "value": 0.142, "range": [0.0647, 0.113]}, "..."],
  "odd_strips": [{"strip_id": "S1", "image_ids": ["fake_shift_S1_0", "fake_shift_S1_1"],
                  "quantity": "si_graphite_ratio", "value": 0.140, "range": [0.0652, 0.112]}, "..."],
  "n_images": {"batch": 8, "baseline": 17},
  "config_version": "v3-draft"
}
```

`tests/fixtures/evidence_example.json` is a fully populated example (stats, controls, fingerprint, provenance) for the UI and for reading the contract.

## Explanations (`qc/explain.py`)

`explain(evidence, dictionary)` fills `Evidence.explanations` from fixed templates, with no language model: `summary` (the answer in one plain sentence, no code names), `rules` (the verdict rules that fired, in words), `next_steps` (decide.py's next action in words, then the odd tiles not named yet, then the top driver's supplier check; each tile named once) and four audience texts, each a **list of sentences**. Reference ranges are clipped at 0 (every measured quantity is non-negative). Two complementary particle-type shares count once. Fitted types named in the dictionary use that name (T1 "brighter mid-grey silicon share", T2 "mid-grey silicon share"). Any other type still falls back to "share of T2 particles", with the type's description from `config/particle_types.json` as `meaning`.

| Audience | Gets |
|---|---|
| Operator | Verdict headline and release/hold action |
| Engineer | Top quantities, possible causes to check, supplier checks, odd images/strips, imaging flags and next action |
| Scientist | Unit counts, p-values, intervals, other-unit statuses, unused quantities, imaging and controls |
| Manager | Main driver, decision certainty, dictionary relevance and indicative consequences |

All numbers come from the evidence or the stated formulas. Causes are worded "possible causes to check"; missing dictionary fields are left out. `config/kpi_dictionary.yaml` has one top-level entry per descriptor with `name`, `unit`, `key`, `meaning`, `why_it_matters`, `if_higher`, `if_lower` and `supplier_check`, plus `particle_types` entries keyed by type ID. `explanations` also carries the lists the UI shows, so it doesn't re-derive them: `ranked` (the "What moved" order, at most four rows), `twin` (a particle-type share that mirrors the other with the same status, shown once) and `within_tolerance`.

### Summary and walkthrough (`qc/guide.py`)

On Compare, the verdict card's "Walk me through it" opens `guide(evidence)` (the fixed template, or Claude's cached version when one exists). The same call also writes `audiences`: operator (what to do now), engineer (what moved and what to check), scientist (the measurements, with intervals) and manager (the stakes, the risk and the cost of waiting), 2 or 3 sentences each. The fold "Explain it for an operator, engineer, scientist or manager" shows that reading at the top of the selected audience ("Written by Claude · numbers checked", or "Fixed wording" when that audience fell back) and the fixed `explain()` sentences underneath. The model is `claude-opus-5-5` unless `CATALYST_CLAUDE_MODEL` is set. `output_config.effort` is `high` (Opus 5.5 would otherwise use medium; a live medium-vs-high comparison was not run). `thinking` is left unset. A `stop_reason` of `refusal` is cached as the template, not parsed as JSON. `available()` builds an Anthropic client and reports its error; credentials are `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile. Settings shows that status. `PROMPT_VERSION` is 4, so older cached answers are not reused. The leave-them-out line and whether the odd-tile block sits above "What moved" come from the template what-if only: the block moves up when a summary sentence says the shift comes from those tiles. Catalyst decides; Claude only points and explains (design/README.md, "Claude as a guide"):

- **In:** the evidence in plain fields, the dictionary entries it touches and a list of slots. Never images.
- **Out:** JSON (structured output): `summary` (≤ 3 sentences), `steps` (≤ 4, each targeting `verdict`, `moved`, `tiles` or `next`, ≤ 2 sentences) and `audiences` (2 or 3 sentences per reader).
- **Numbers are slots** (`{diff:q}`, `{shift:q}`, `{interval:q}`, `{tile:id.q}`, `{range:q}`, `{whatif:n}`, `{count:…}`), filled by Catalyst from the evidence and rendered as chips with their source.
- **Checks** (`problem()`), each drops the sentence:
  - an unknown slot, or a digit or number word outside a slot (batch names, property labels and tile ids may be written as they are);
  - a verdict or disposition word anywhere (accept, reject, investigate, release, ship, approve, safe, fine, …), so Claude can't contradict or restate Catalyst's call;
  - a status phrase that doesn't match the property it's about ("within tolerance" on an unsettled one, "differs" when nothing does);
  - a what-if slot without exactly its tiles; a banned word ("significant", "crucial", "notable", "defect…"); more than 28 words.
  Two drops on the summary or the steps, no key or any error → the fixed template (same slots), audiences included. An audience with fewer than 2 sentences left falls back on its own to today's `explain()` text. Operator sentences must quote `next_steps`. An engineer sentence that states a cause must repeat a dictionary `if_higher`, `if_lower` or `supplier_check`. Evidence text is passed as data, never as instructions.
- **What-if:** per property with odd tiles, the batch re-compared without exactly those tiles (`decide.compare` on `out/kpis.csv`), only while the table still holds the evidence's tiles and means.
- **Cost:** reading the page never calls Claude. "Ask Claude" in the audience fold does (`POST /api/guide`), once per evidence, and that one call writes the summary, the walkthrough and all four audiences. The checked answer (or an unusable one's fallback) is cached in `out/guide/`, written atomically, and a broken cache file is a miss. The verdict never reads it.
- **Config:** `ANTHROPIC_API_KEY` (off without it), `CATALYST_CLAUDE_MODEL` (default `claude-opus-5-5`), `output_config.effort` `high`.

Deviation from PLAN_v4 §3.10 ("optional review … not in the demo"): the Claude part is a summary and walkthrough on Compare rather than a separate review command, and it is shown in the app. It stays after the output, off without a key, and can't change the verdict or any number. Not built from the design's what-if menu: "other baseline" (a one-off comparison is a click on Compare instead) and what-ifs Claude picks itself.

For `si_graphite_ratio` r, silicon share is `s = r / (1 + r)`. Theoretical capacity at silicon capacity C is `cap(s, C) = s·C + (1 − s)·372`, reported as a relative change over the SiOx-to-Si range C = 1,500 to 3,600 mAh/g. Silicon-driven swelling is reported as the ratio of the silicon shares (Si expands about 2.8× on full lithiation, graphite about 0.1×). For apparent porosity p, the indicative ion-transport change is `(p_batch / p_reference)^1.5 − 1` (Bruggeman). These are textbook ranges, not predictions.

## Wear & impact (experimental, `qc/impact.py`)

An experimental feature, on by default: the sidebar lists it under **Experimental**. Switch it off with `?flags=-impact` (stored in localStorage; `?flags=` clears it) or build with `VITE_FLAGS=-impact` (`web/src/flags.ts`). The page is `#/impact/<batch>[/<baseline>]`; a batch or baseline in the link that can't be used is replaced, with a notice. It answers "what could this batch mean for the cell?" with textbook relations on the measured KPIs. **Context for people, never an input to the verdict** (PLAN_v4 §3.8, §3.19; docs/APP.md feature 6).

`impact_report(kpis, particles, batch, baseline)` takes per-batch means of the inputs (`si_area_frac`, graphite share `si_area_frac / si_graphite_ratio`, `porosity_apparent`, Sauter `D32 = Σd³/Σd²` of non-edge particles from `particles.csv` (falls back to `si_d50_um`), `si_d90_um`, `si_internal_void_frac`, `si_agglomerate_frac`) and a hierarchical bootstrap (strips, then images in a strip; 2,000 resamples, 90%). Constants that are not known (Si vs SiOx, Bruggeman exponent) are evaluated at each end and the interval is the widest per-constant interval.

| Property | Relation | Higher is |
|---|---|---|
| Capacity | `Q = w·Q_Si + (1 − w)·372`, `w` = Si weight share from area share and densities; Si 3,579 / SiOx 1,500 mAh/g | better |
| Swelling | `ΔV/V = φ_Si·e_Si + φ_C·0.10`, `e_Si` 2.8 (Si) / 1.2 (SiOx); against pore volume; thickness bounds `[max(ΔV − ε, 0), ΔV]` | worse |
| Fast charging | `D_eff/D = ε^α`, α 1.5–2.5 (relative change only) | better |
| Lithium lost to SEI | `S = 6·φ_Si / D32`, geometric lower bound (relative change only) | worse |
| Particle cracking | crack driving force ∝ size: D90, against 150 nm (crystalline) / 870 nm (amorphous) critical sizes | worse |
| Hot spots | `si_agglomerate_frac` directly, direction only | worse |

Effect per property: "about the same" if the whole relative-change interval is within ±5%, "better/worse in these images" if it excludes 0, else "not settled"; every effect is "not settled" below 3 strips. Intervals hold sampling noise only. The wear scenario scales an SEI-limited `1 − k√n` fade by the silicon surface or amount × D90 ratio (a modelling choice, labelled) and is headlined as a fade-rate ratio; a cycle count is shown only against an assumed baseline anchor.

**Worst cases** (`worst_case` in the config): for a property that moves the adverse way ("this batch moves this way") or whose interval can't rule it out ("not ruled out"), a textbook failure chain with a severity (performance < reliability < safety), how likely it is and what rules it out; e.g. less anode capacity → N/P falls (shown for an assumed N/P 1.10) → plating → dendrites → short → thermal runaway. Shown on each card: in full when the batch moves the adverse way, otherwise as one muted "Not ruled out by these images" line that opens to the chain. The note that worst cases aren't forecasts is the last caveat on the page.

`web/src/impact.ts` holds the types and fetch for this endpoint, and `Report` lives in `qc/impact.py`, not `qc/schema.py`: it is not part of the ML ↔ backend contract and stays separate while it is experimental.

## Anode lab (`qc/slab.py`, `web/src/slab/`)

An experimental page (rail: Experimental → Anode lab, `#/anode`, flag `anode` in `web/src/flags.ts`, on by default; `?flags=-anode` hides it) that shows what one batch's measured microstructure means inside a cell: a rotatable 60 × 50 × 30 µm block of anode between a copper collector and a separator, the baseline beside a chosen batch (or alone), with sliders for state of charge, C-rate, cycles and a FIB slice that mills into the block. It is an illustration driven by measured statistics, not a 3D reconstruction and not a cell simulation, labelled as such on the page; nothing in it feeds `decide.py`.

- **Packing.** Silicon sizes are drawn from the batch's measured particles (`out/particles.csv`) with a first-order Wicksell correction (× 4/π, weight 1/d), placed with the measured agglomerated share, and trimmed to the measured silicon share of the solid. Angular graphite flakes are added by random sequential addition with a growing overlap allowance until the pore fraction is reached. The achieved fractions stay within about 0.3 points of the targets (`test_packing_hits_target_fractions`).
- **True porosity.** The 2D apparent porosity (~10%) under-counts pores, so the baseline is anchored at 30% and each batch keeps its measured ratio to the baseline (`true_fractions`). This is the largest assumption and it is listed on the page.
- **Physics (backend only; the page interpolates).** Si and graphite share one potential (textbook lithiation curves), so silicon lithiates first. Si swells 280% (internal voids absorb their share), graphite 10% along c. Half the swelling fills pores, the rest thickens the coating. Bruggeman sets ion transport. The through-thickness gradient scales with L² / (D_eff · t_charge), under CC-CV charging and an N/P ratio of 1.1. Plating is flagged where the local potential minus an overpotential falls below 0 V vs Li. Graphite takes its staging colours flake by flake (lever rule). Si above the 870 nm a-Si fracture size cracks over the cycles, and some fragments lose contact; capacity fade is a scenario band (SEI ~ √N plus lost Si).
- **Faces.** The visible faces are true sections of the packing, rasterised on the CPU; the "SEM image on the cut" toggle puts the batch's most typical BSE image on half of the front face for comparison (labelled SEM | model, loaded only once it's switched on).

PLAN_v4 §3.8 says "no cell simulation". This page has no electrochemical model fitted to data; its fast-charge and wear panels are qualitative relations with stated constants, shown as indicative ranges, as §3.8 allows for consequences. The page and three.js are lazy-loaded, so the main bundle does not grow. URL parameters before the hash set the start state, e.g. `/?soc=0.75&c=5#/anode` (`soc`, `c`, `cycles`, `milled`, `section=1`, `ions=0`).

## Batch attribution (Pat's `qc/attribute.py`)

`GET /api/health` reports whether a live drop can run offline: the attribution model file is present, `qc.deep` imports (torch and transformers), and the pinned DINOv2 weights are already in the Hugging Face cache. The Identify screen shows that as a banner and does not upload while it is false. See [docs/RUNBOOK_DROP.md](docs/RUNBOOK_DROP.md).

The software reads Pat's output as written; it defines no classifier or attribution schema. `load_model()` reads the model, and `attribute_images(image_dir, model, balanced=None)` writes `out/attribution/<folder>.json`. `qc.run.attribute()` calls those functions and sanitizes NaN/Infinity to JSON null.

The per-run file contains the model summary and one record per image; the fields are listed under Folders above and explained in [docs/AGENT_HANDOVER.md](docs/AGENT_HANDOVER.md) §3.4. The Identify result follows the design's focus layout: the answer (the bet, its probability bar, "when it's this sure, it was right n of m times" from `confidence_record`, the range of "baseline or not" from `stage_baseline.interval`, "can't rule out …" from `prediction_set`, "Which variation: not established" when `stage_variation.record.established` is false, familiar or unfamiliar, the model's held-out accuracy next to chance). When `prediction_set` holds more than one batch the headline is those batches ("Batch 1 or 2") and one sentence from the overall probabilities ("Not Batch 3 (99%). Batch 1 vs Batch 2 is close to a coin flip."); the stage ratio is not repeated beside them. Then the tile, with its largest silicon particles marked P1–P6 (dashed rings, their own heading, not the reason numbers). Then "Look here first" (up to three reasons with Pat's `text`, each against the baseline's ±1σ/±2σ band: the strongest for the call, with the strongest against it in third place only when it weighs at least as much; two reasons that are the same texture at two scales share one card, "at 0.05 and 0.2 µm", so the third slot stays free). Then folded rows: all reasons with the named measurements each image pattern moves with, "What the model leans on overall" (`model.importance`: the family shares and the five heaviest inputs of each stage), the tile's KPIs against the baseline (measured in the background with `POST /api/measure`, since attribution doesn't write `out/kpis.csv`), and "Model and run" (the stages, how the confidence was checked, the held-out coverage of the sets, the distance to the baseline labelled as such, and Pat's family evaluation, shown only when it covers every part of the model in use). A result has its own URL, `#/identify/<drop>[/<image_id>]`, so reload, back and links keep it; the browser checks a drop (each tile id needs BSE, ETD or SE, and InLens) before anything is uploaded. "Unfamiliar" means outside the range of the *predicted* batch. While it runs, the scan line follows the stage events (upload, segmentation and features, DINOv2, scoring) and reveals the scanned side behind it; without events it sweeps on a loop. On the result, the tile's largest silicon particles are marked at their real centroids (`GET /api/particles`); hovering or focusing a spot, or any tile thumbnail on Compare, peeks a magnified crop with a scale bar beside it, and a click pins an inspector (detector switch, silicon and pore layers over the chosen detector, ← →, "Open full tile"). Nothing is drawn that the data doesn't back: no texture or patchiness boxes until the model returns heatmaps. Its accuracy panel and the sidebar's "model differs from the frozen one" warning read `GET /api/attribution-model`, so they describe the model file in use. `--evaluate` writes `out/attribution/evaluation.json` with family-set LOSO scores, confusion, permutation nulls, shared-strip checks and the feature ranking.

The API passes Pat's data through: `GET /api/attribution`, `GET /api/attribution/{name}`, `GET /api/attribution-model`, `GET /api/attribution-evaluation`, and `POST /api/attribution/{name}?balanced={k}`.

**Held-out protocol (PLAN_v4 §4)**
1. Put the new images in their own folder under `data/`, never inside the known batch folders.
2. Rehearse with `uv run python -m qc.attribute --dry-run --repeats 30`.
3. Fit the model with `uv run python -m qc.attribute --fit` (add `--families` or `--staged`).
4. Tag `rules-frozen`, covering `decision.yaml`, `particle_types.json` and `attribution_model.json`.
5. Run `uv run python -m qc.attribute --images data/<drop>` once, then copy `out/attribution/<drop>.json` to `results/` and commit it unchanged (`out/` is gitignored). Add `--balanced k` only if the split per batch is confirmed.

**Refit on 4 Oct (v4.2).** The model was unfrozen to adopt the T14 confidence methods. The two logistic regressions are unchanged (identical coefficients); the confidence is now a class-balanced Venn–Abers calibration with a staged call and no temperature. On the 31 known images the held-out calls are the same (22 of 31, balanced 0.66); over 30 rehearsal draws of 9 unseen images the accuracy rose from 0.57 to 0.66. The three test samples were rescored once: same three bets, lower stated confidence ([results/Hackathon-Polaron-test.refit.json](results/Hackathon-Polaron-test.refit.json)). The `rules-frozen` tag has not been moved: it also locks `config/decision.yaml` and the default baseline, so moving it needs both owners. Until then the app says "model differs from the frozen one". This deviates from PLAN_v4 §3.15 (temperature scaling, split conformal, argmax) and §12.3 (frozen model); the plan text is unchanged. Details: [docs/MODEL.md](docs/MODEL.md).

The first model was frozen on 3 Oct at 22:10 (tag `rules-frozen`, staged `material > deep`). The first unseen folder (`Hackathon-Polaron-test`, 3 samples) was scored once with it; the output is [results/Hackathon-Polaron-test.json](results/Hackathon-Polaron-test.json), committed unchanged. Disclosure: the same three samples had been uploaded through the app about 20 minutes before the tag, with the same model file; nothing was refitted or tuned in between and the calls are identical (PLAN_v4 §12.3). More images come shortly before judging: same command, on the model file in `config/`.

**Ground truth, 4 Oct afternoon.** The true batches of the three test samples are `3e122cbj` Batch_2, `fn0mhxef` Batch_1, `xrv9xvzb` Batch_3. The calls were 1 of 3 exact, 3 of 3 on "Batch_3 or not", and 3 of 3 inside the prediction set; both misses were 52:48 and 51:49 "Batch_1 or Batch_2" leans. Both test images sit edge to edge on one continuous cross-section with images of the other label, and no feature we built separates Batch_1 from Batch_2 in a way that holds up ([docs/experiments/T18.md](docs/experiments/T18.md), [docs/MODEL.md](docs/MODEL.md) §12). The classifier is unchanged; every "which variation" call is now marked not established, keeps both variations in its prediction set, and the app says so.

## Who owns what

| File | Owner |
|---|---|
| `qc/schema.py` Evidence models | **Both.** The contract: changes need both of us |
| `tests/test_contract.py`, `tests/fixtures/kpis_fake.csv`, `tests/fixtures/evidence_example.json` | **Both.** Evidence contract and fixture |
| `tests/fixtures/attribution_example.json`, `tests/fixtures/attribution_evaluation_example.json` | Software (Patrik); mirror Pat's format |
| `qc/measure.py` (`segment`, `kpis`, `particles`, `imaging`, `label_si`, `two_point`) | ML (Pat) |
| `qc/types.py`, `qc/controls.py`, `qc/uncertainty.py`, `config/kpi_dictionary.yaml`, `tests/test_ml.py` | ML (Pat) |
| `qc/features.py`, `qc/deep.py`, `qc/attribute.py`, `tests/test_attribute.py` | ML (Pat). `attribute_images` gained an optional `progress` callback (replacing its two prints) for the Identify progress line; no other change |
| `config/attribution_model.json` | ML (Pat). Refitted 4 Oct (v4.2); the `rules-frozen` tag still holds the 3 Oct file |
| `docs/PAT_SUMMARY.md`, `docs/AGENT_HANDOVER.md`, `docs/MODEL.md`, `docs/MODEL_NEXT_STEPS.md`, `docs/DEVIN_HANDOFF.md` (where the 4 Oct session stopped; delete when its list is done), `docs/TICKETS.md`, `docs/experiments/`, `scripts/experiments/` | ML (Pat) |
| `docs/HANDOFF.md`, `docs/APP.md` | Software (Patrik) |
| `docs/PLAN_v4.md` | **Both** |
| `config/particle_types.json` | ML (Pat), **frozen at `rules-frozen`** |
| `qc/explain.py`, `qc/guide.py`, `tests/test_explain.py`, `tests/test_guide.py` | Software (Patrik) |
| `qc/decide.py` (`compare`, `evaluate`, `power`), `qc/control_check.py`, `qc/provenance.py`, `config/decision.yaml`, `tests/synth.py` | Software (Patrik). `control_check` calls Pat's `iter_controls` and does not change `qc/controls.py` |
| `qc/api.py`, `web/` | Software (Patrik) |
| `qc/impact.py`, `config/impact.yaml`, `tests/test_impact.py` (experimental) | Software (Patrik) |
| `qc/slab.py`, `tests/test_slab.py`, `web/src/slab/` | Software (Patrik). Experimental: deleting these, the `/api/slab` route and the `anode` flag, route and nav item removes the anode lab |
| `qc/io.py`, `qc/run.py` | Shared glue |

## Changes from the v3 design (ML side)

PLAN_v4 now states these as the plan; they are kept here as the record of what changed from the v3 text (git history).

0. **A classifier trained on batch labels exists** (`qc/attribute.py`), against the v3 plan's rule 2 and §3.12. It follows the task designer's clarification that the entry is judged on attributing held-back images to their batch; PLAN_v4 §2 narrows rule 2 to this track. The verdict path (`qc/decide.py`) stays statistical and does not use it. `config/decision.yaml` now says `baseline: Batch_3` on this branch too (same change as Patrik's `PtrkH/compare-v3`); `qc.attribute` reads it from the config.

1. **Hole filling and watershed splitting happen in `label_si()` at measure time**, not baked into the mask. The mask stays pure phase codes, so area fractions aren't altered by split lines.
2. **Black level is computed inside `qc/measure.py`** (0.5th percentile per channel, identical to the planned `Field.black_level`), so the ML side doesn't depend on `qc/io.py` changes.
3. **`Control.kept_in_reference` holds image_ids**, not strip ids — with strip ids, a split strip's test images would be re-added to the reference.
4. **`pos_si_scale150` thins scaled particles to 1/2.25** of the eligible set, so it tests *size*, not Si amount (otherwise `si_graphite_ratio` would be the top driver).
5. **The "curtaining high → run-length descriptors NaN" rule is not applied in `kpis()`**: the threshold will be set from the real `curtaining_index` distribution; compare/run can apply it from `imaging.csv`.
6. **`particles.csv` has extra `y_px, x_px` columns** (full-res centroid), used for example crops and the UI.
7. **The integral range is computed as the angular integral** `2π·∫r·C̄(r)dr` of the count-weighted radial C(r) — mathematically identical to the 2D sum but far less noisy — and truncated at the first zero crossing. The literal uniform-weighted 2D sum is badly biased by the large-lag tail (it goes negative even for a random medium).
8. **Si objects with median BSE < 1.5× the graphite mode are relabelled BINDER.** Not in the v3 plan; added after the P2316 overlays showed carbon-binder and through-pore surfaces (1.3–1.5× graphite) labelled as Si. Real Si measured 1.6–2.4×. Knob: `SI_MIN_CONTRAST`.
