# Catalyst

**Team:** [Batch Size 2](https://github.com/batch-size-2) (ML: Pat · Software: Patrik)  
**Hackathon track:** [Polaron — Track 4](https://www.polaron.ai/) — batch QC for electrode microstructure

## What we're building

A decision layer on top of SEM microstructure analysis. Drop in a folder of microscope images for an incoming batch and get **accept / investigate / reject** against an approved baseline. The verdict comes with its evidence:
- which images look off;
- which measured property moved, and by how much;
- how sure we are;
- what to do next.

No model is trained. Measurements come from classic image processing, and the verdict from plain statistics.

## Plan

[docs/PLAN_v1.md](docs/PLAN_v1.md) is the source of truth for **what to build** (supersedes [PLAN_v0](docs/PLAN_v0.md)). This README documents **what is built**. Where the code is still a stub, the sections below say so and point to the plan section that describes the target.

## Quickstart

```bash
brew install uv node@22  # once; the web UI needs Node >= 20.19
uv sync
uv run pytest            # contract tests, keep green

# put the batches in data/ (gitignored), e.g.
for b in Batch_1 Batch_2 Batch_3; do ln -s "../EXAMPLE BATCHES FOR LOCAL REFERENCE/$b" data/$b; done

uv run python -m qc.measure                                               # ML: all of data/ -> out/kpis.csv + out/masks/
uv run python -m qc.run --batch data/Batch_2 data/Batch_3                 # end to end -> out/evidence/<batch>.json
uv run python -m qc.decide tests/fixtures/kpis_fake.csv --baseline fake_baseline   # backend only, no images

# UI: two terminals
uv run uvicorn qc.api:app --reload     # API on :8000
cd web && npm install && npm run dev   # UI on :5173, proxies /api to :8000
```

## Architecture

> Keep this diagram in sync with the code. Any PR that adds, removes, renames or rewires a module, contract function, output file, endpoint or data flow updates it in the same PR (see [AGENTS.md](AGENTS.md)).

```mermaid
flowchart LR
  subgraph IN["Inputs"]
    D["data/{batch}/img_{id}_{detector}.tif<br/>BSE · ETD/SE · InLens, 0.025 µm/px"]
    CFG["config/decision.yaml<br/>baseline · reference_exclude · band_coverage<br/>ci_level · reject_lower_bound"]
  end

  subgraph GLUE["Shared glue"]
    IO["qc/io.py<br/>load_field → Field<br/>alias detectors · crop edges · px_um · strip_id"]
    RUN["qc/run.py · run()<br/>measure baseline + batch → judge → write outputs"]
  end

  subgraph ML["ML · qc/measure.py"]
    SEG["segment(channels, px_um) → mask<br/>pore · graphite · Si · binder · ignore"]
    KPI["kpis(mask, px_um, channels) → dict<br/>names + units in schema.KPI_UNITS"]
  end

  subgraph BE["Backend · qc/decide.py"]
    J["judge(baseline_df, batch_df, cfg) → Evidence<br/>tile vs tolerance band → binomial on non-conforming"]
  end

  subgraph OUT["out/ (gitignored)"]
    T["kpis.csv<br/>one row per tile"]
    E["evidence/{batch}.json"]
    P["masks/{batch}/{id}.png"]
  end

  API["qc/api.py · FastAPI :8000<br/>GET batches · evidence · masks<br/>POST upload · run (NDJSON progress)"]
  WEB["web/ · Vite + React :5173<br/>ingest · verdict · KPI bands · tile gallery"]
  CLI["python -m qc.run / qc.measure"]

  D --> IO --> RUN
  RUN --> SEG --> KPI --> RUN
  RUN --> T --> J
  CFG --> J
  RUN --> P
  J --> E
  E --> API
  P --> API
  API -- "/api via Vite proxy" --> WEB
  WEB -- "upload + run" --> API
  API -- "run()" --> RUN
  CLI --> RUN
```

`qc/schema.py` is the contract every Python box imports: `Field`, the `Phase` labels, `KPI_UNITS`, `KPI_TABLE_COLUMNS`, the `Evidence` model and the `out/` paths. `web/src/types.ts` mirrors `Evidence` for the UI.

## Infrastructure

Everything runs **locally and offline**: no cloud, no database, no network calls in the verdict path (PLAN_v1 §1, rule 4). There are three processes.

| Process | Command | Port | Role |
|---|---|---|---|
| Pipeline (CLI) | `uv run python -m qc.run --batch …` | – | Measure → judge → write `out/`. This is what we freeze and run on the unseen batch |
| API | `uv run uvicorn qc.api:app --reload` | 8000 | Thin FastAPI wrapper: reads `out/`, saves uploads to `data/`, calls `run()`. No QC logic |
| Web UI | `cd web && npm run dev` | 5173 | Vite + React + TypeScript + Tailwind. Talks only to `/api` (proxied to :8000 by `web/vite.config.ts`) |

**Folders**

| Path | In git? | Contents |
|---|---|---|
| `data/<batch>/` | no | Input TIFFs (or symlinks to them). One folder per batch; the folder name is the batch name |
| `EXAMPLE BATCHES FOR LOCAL REFERENCE/` | no | The 1.6 GB of Polaron images. Don't upload anywhere without Polaron's OK (PLAN_v1 §1, rule 5) |
| `config/decision.yaml` | yes | Decision settings. Frozen with `git tag rules-frozen` before the unseen batch |
| `out/kpis.csv` | no | KPI table, one row per tile, all batches measured so far |
| `out/masks/<batch>/<image_id>.png` | no | BSE with phase overlay (4× downsampled), for eyeballing and the UI |
| `out/evidence/<batch>.json` | no | The verdict and everything behind it. The UI reads only this and the masks |
| `tests/fixtures/kpis_fake.csv` | yes | Hand-made KPI table, so the backend and UI can be built with no images |

**HTTP API** (`qc/api.py`, called from `web/src/api.ts`)

| Endpoint | Returns |
|---|---|
| `GET /api/config` | `config/decision.yaml` as JSON |
| `GET /api/batches` | `[{name, has_images, verdict}]`: folders in `data/` plus evidence in `out/` |
| `GET /api/evidence/{batch}` | `Evidence` |
| `GET /api/masks/{batch}/{image_id}.png` | Mask overlay |
| `POST /api/batches/{batch}/files` | Multipart upload of a folder's TIFFs into `data/{batch}/` |
| `POST /api/runs/{batch}` | NDJSON stream: one `{"type":"progress","done","total","tile"}` per measured tile, then `{"type":"done","evidence"}` or `{"type":"error","message"}` |

**Dependencies.**
- Python: `pyproject.toml` + `uv.lock`, Python 3.11.
- Web: `web/package.json` + `package-lock.json`.
- Supply-chain guard: `[tool.uv] exclude-newer` blocks Python packages published in the last week. For npm, install with `npm install --before=<date a week ago>`.

## Data pipeline

One command, `qc.run`, does steps 1–6 for the baseline plus each requested batch. `qc.measure` does steps 1–5 only.

| # | Step | Code | Output |
|---|---|---|---|
| 1 | **Find fields.** Group `img_<image_id>_<detector>.tif` by ID | `io.field_paths` | `{image_id: {detector: path}}` |
| 2 | **Load.** Take one channel of the RGB TIFF, crop 8 px off left and right (stitch borders), read pixel size and strip ID | `io.load_field` | `Field(batch, image_id, strip_id, channels, px_um)` |
| 3 | **Segment** | `measure.segment(channels, px_um)` | `uint8` mask with `Phase` codes |
| 4 | **Measure KPIs** | `measure.kpis(mask, px_um, channels)` | `{kpi: value}` |
| 5 | **Write.** One row per tile into the KPI table, plus a mask overlay | `run.measure_field`, `run.save_overlay` | `out/kpis.csv`, `out/masks/` |
| 6 | **Judge** each batch against the baseline | `decide.judge` | `out/evidence/<batch>.json` |

**Input details (step 2, from PLAN_v1 §2)**
- **Detectors** are normalised to `BSE` / `ETD` / `InLens`; `SE` is an alias for `ETD`. The `img_` prefix is dropped from IDs.
- **`px_um`** comes from the TIFF `XResolution` / `ResolutionUnit` tags (0.025 µm/px), or NaN if missing.
- **`strip_id`** is `"<height>_<round(XResolution)>"`, e.g. `2316_1015998`. It groups tiles cut from the same continuous strip. It is **provenance only, never a feature**, because 5 strips cross batch folders.

**Phase labels (`schema.Phase`)**

| Code | Phase | Look in BSE |
|---|---|---|
| 0 | `PORE` | black |
| 1 | `GRAPHITE` | dark grey flakes |
| 2 | `SI` | bright particles |
| 3 | `BINDER` | thin films at particle edges |
| 255 | `IGNORE` | excluded pixels (e.g. top and bottom margins) |

**Segmentation (step 3).**
- **Now (stub):** Gaussian blur σ = 2 px on BSE, then 3-class multi-Otsu (thresholds fitted on a 4× subsample). The classes are pore / graphite / Si.
- **Known gap:** bright binder fringes currently land in `SI`.
- **Target (PLAN_v1 §5, Pat step 3):** black-level subtraction, Si mask clean-up (opening, ≥ 0.25 µm²), top and bottom 5% marked `IGNORE`, and optionally a scribble-trained random forest for cracks.

**KPIs (step 4, definitions in PLAN_v1 §3.2)**

| KPI | Unit | Status |
|---|---|---|
| `si_area_frac` | fraction | **implemented**: Si px / non-ignored px |
| `porosity_apparent` | fraction | **implemented**: pore px / non-ignored px. Biased: open pores show their back wall |
| `si_d50_um`, `si_d90_um` | µm | planned: area-weighted equivalent diameter |
| `si_internal_void_frac` | fraction | planned: dark px inside filled Si particles |
| `si_contrast_ratio` | ratio | planned: (Si mode − black level) / (graphite mode − black level). Valid only after the imaging check |
| `si_fragments_per_1e4um2` | count | planned: Si objects < 1 µm per 10⁴ µm² |
| `si_dispersion_cv` | ratio | planned: CV of local Si fraction over 20 µm windows |

A KPI that isn't computed, or a tile whose segmentation crashes, is written as **NaN**: the run never stops on one bad tile. Columns of `out/kpis.csv` are `batch, image_id, strip_id, px_um, <8 KPIs>`.

## Decision algorithm (`qc/decide.py`)

Pure statistics on KPI tables; it never sees an image. It follows PLAN_v1 §3.5.

**1. Reference set.** Baseline = every tile in the `baseline` folder, minus `reference_exclude`. A KPI is used only if at least 2 baseline tiles have a value for it.

**2. Tolerance band per KPI.** A prediction interval for one new tile drawn from the baseline:

```
band = mean ± t(1 − α/2, n − 1) · sd · √(1 + 1/n),   α = (1 − band_coverage) / K
```

Here `n` is the number of baseline tiles and `K` the number of KPIs in use. `K` spreads the false-alarm budget over all KPIs (Bonferroni), so a clean tile is flagged at most ~5% of the time across all KPIs together. With `n = 7`, the band is ±2.6 sd for `K = 1`, ±3.2 sd for `K = 2` (the current stub) and ±4.4 sd for all 8.

**3. Tile status**

| Status | Rule now | Planned (PLAN_v1 §3.5) |
|---|---|---|
| `NON_CONFORMING` | any KPI outside its band | …and the imaging check passed, with the KPI's own uncertainty entirely outside the band |
| `SUSPECT` | any KPI is NaN | …or a KPI's uncertainty straddles the band edge, the anomaly map fires alone, or the imaging check fails |
| `CONFORMING` | otherwise | |

**4. Batch verdict.**
- `x` = non-conforming tiles, `n` = tiles in the batch.
- Exact Clopper–Pearson interval at `ci_level` (90%, i.e. 95% one-sided at each end):

| Verdict | Rule |
|---|---|
| **REJECT** | lower bound > `reject_lower_bound` (5%) |
| **ACCEPT** | `x = 0` and no `SUSPECT` tiles. Always printed with the rate it cannot rule out |
| **INVESTIGATE** | everything else |

What that means at our sample sizes:

| Observed | Interval | Verdict |
|---|---|---|
| 0 / 7 | 0 – 34.8% | ACCEPT, "7 clean tiles cannot rule out a non-conforming rate up to 35%" |
| 1 / 7 | 0.7 – 52.1% | INVESTIGATE |
| 2 / 7 | 5.3 – 65.9% | REJECT |
| 0 / 17 | 0 – 16.2% | ACCEPT |
| 2 / 17 | 2.1 – 32.6% | INVESTIGATE |

PLAN_v1 §3.5 uses the same convention and the same numbers.

**5. Next action**, computed rather than templated:
- **REJECT:** "Quarantine the lot…".
- **ACCEPT:** "Release…" with the bound.
- **INVESTIGATE:**
  - "Image ~N more fields…", where N is the smallest number of extra fields at the observed rate that would push the lower bound past the reject threshold;
  - or "Review N SUSPECT tile(s)" when nothing is non-conforming.

**Config (`config/decision.yaml`)**

| Key | Default | Meaning |
|---|---|---|
| `version` | `v1-draft` | Written into every evidence file |
| `data_dir` | `data` | Where batch folders live |
| `baseline` | `Batch_1` | Baseline folder. **Unconfirmed**: ask the mentors (PLAN_v1 §9) |
| `reference_exclude` | `[]` | Baseline `image_id`s to drop from the reference (e.g. the P2316 strip if it isn't "approved") |
| `band_coverage` | `0.95` | Coverage of the tolerance band, across all KPIs together |
| `ci_level` | `0.90` | Confidence level of the interval on the non-conforming rate |
| `reject_lower_bound` | `0.05` | REJECT when the interval's lower bound exceeds this |

**Not built yet** (all additive to `Evidence`):
- imaging check (§3.3)
- anomaly map (§3.4)
- per-KPI uncertainty by source (§3.6)
- strip instead of tile as the counting unit
- baseline audit, i.e. leave-one-strip-out on the baseline
- controls (§3.7)

**First run on the real data** (stub segmentation, baseline `Batch_1`):

| Batch | Verdict | Non-conforming | Flagged tiles |
|---|---|---|---|
| Batch_1 | ACCEPT | 0/7 | – |
| Batch_2 | ACCEPT | 0/7 | – |
| Batch_3 | INVESTIGATE | 2/17 | `0grcilhi`, `hzumfsms`: apparent porosity 0.145 and 0.154, above the band (0.038–0.136) |

**Caveat: the Si band is useless with this baseline.** The `si_area_frac` band comes out as −0.10 to 0.30, because Batch_1's two P2316 tiles have Si fractions around 0.19–0.20 while the rest sit near 0.06. That is the bimodal-baseline problem in PLAN_v1 §2. If the mentors confirm P2316 isn't "approved", list its tiles (`4ih2ggld`, `5n1q8atc`) in `reference_exclude`.

### Evidence JSON (`schema.Evidence`)

```json
{
  "batch": "Batch_3", "baseline": "Batch_1", "verdict": "INVESTIGATE",
  "next_action": "Image ~22 more fields to resolve 2/17 non-conforming tiles.",
  "nonconforming": {"x": 2, "n": 17, "ci": [0.021, 0.326], "unit": "tile"},
  "kpis": [{"name": "porosity_apparent", "unit": "fraction", "band": [0.0378, 0.1358],
            "baseline_mean": 0.0868, "batch_mean": 0.1071, "n_outside": 2}],
  "tiles": [{"image_id": "0grcilhi", "strip_id": "1904_1015978", "status": "NON_CONFORMING",
             "kpis": {"si_area_frac": 0.0675, "porosity_apparent": 0.1447},
             "reasons": ["porosity_apparent = 0.145 outside [0.0378, 0.136]"]}],
  "n_images": {"baseline": 7, "batch": 17},
  "config_version": "v1-draft"
}
```

## Who owns what

| File | Owner |
|---|---|
| `qc/schema.py`, `tests/test_contract.py`, `tests/fixtures/kpis_fake.csv` | **Both.** The contract: changes need both of us |
| `qc/measure.py` (`segment`, `kpis`) | ML (Pat) |
| `qc/decide.py` (`judge`), `config/decision.yaml` | Software (Patrik) |
| `qc/api.py`, `web/` | Software (Patrik) |
| `qc/io.py`, `qc/run.py` | Shared glue |
