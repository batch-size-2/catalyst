# Catalyst

**Team:** [Batch Size 2](https://github.com/batch-size-2)  
**Hackathon track:** [Polaron — Track 4](https://www.polaron.ai/) — batch QC for electrode microstructure

## What we're building

A decision layer on top of SEM microstructure analysis: compare incoming batches to an approved baseline, quantify differences with uncertainty, and output interpretable **accept / investigate / reject** verdicts for materials QC.

## Plan

Current plan: [docs/PLAN_v1.md](docs/PLAN_v1.md) (supersedes [PLAN_v0](docs/PLAN_v0.md)).

## Quickstart

```bash
brew install uv          # once
uv sync
uv run pytest            # contract tests, keep green
uv run python -m qc.run --batch data/Batch_2 data/Batch_3   # images -> out/kpis.csv -> out/evidence/<batch>.json
uv run python -m qc.judge tests/fixtures/kpis_fake.csv --baseline fake_baseline   # backend only, no images
uv run streamlit run app.py   # dashboard: ingest a batch folder, see verdict, KPIs, tiles
```

Stack: Python 3.11 + uv · numpy / pandas / scipy / scikit-image / tifffile · pydantic · Streamlit + plotly.

## Architecture

> Keep this diagram in sync with the code. Any PR that adds, removes, renames or rewires a module, contract function, output file or data flow updates it in the same PR (see [AGENTS.md](AGENTS.md)).

```mermaid
flowchart LR
  subgraph IN["Inputs"]
    D["data/{batch}/img_{id}_{detector}.tif<br/>BSE · ETD/SE · InLens, 0.025 µm/px"]
    CFG["config/decision.yaml<br/>baseline · band_coverage · ci_level · reject_lower_bound"]
  end

  subgraph GLUE["Shared glue"]
    IO["qc/io.py<br/>load_field → Field<br/>alias detectors · crop edges · px_um · strip_id"]
    RUN["qc/run.py · run()<br/>measure baseline + batch → judge → write outputs"]
  end

  subgraph ML["ML · qc/measure.py"]
    SEG["segment(field) → mask<br/>pore · graphite · Si · binder"]
    KPI["kpis(field, mask) → dict<br/>names + units in schema.KPI_UNITS"]
  end

  subgraph BE["Backend · qc/judge.py"]
    J["judge(baseline_df, batch_df, cfg) → Evidence<br/>tile vs tolerance band → binomial on non-conforming"]
  end

  subgraph OUT["out/ (gitignored)"]
    T["kpis.csv<br/>one row per tile"]
    E["evidence/{batch}.json"]
    P["previews/{batch}/{id}.png"]
  end

  UI["app.py · Streamlit<br/>ingest · verdict · KPI chart · tile gallery"]
  CLI["python -m qc.run --batch ..."]

  D --> IO --> RUN
  RUN --> SEG --> KPI --> RUN
  RUN --> T --> J
  CFG --> J
  RUN --> P
  J --> E
  E --> UI
  P --> UI
  UI -- "Run QC" --> RUN
  CLI --> RUN
```

`qc/schema.py` is the contract every box above imports: `Field`, `Phase` labels, `KPI_UNITS`, `KPI_TABLE_COLUMNS`, the `Evidence` model and the `out/` paths. The dashboard only reads `out/`; it never calls ML or backend code directly, only `run()`.

## Who owns what

| File | Owner |
|---|---|
| `qc/schema.py` | **Both.** The contract: `Field`, phase labels, KPI names + units, Evidence JSON, output paths |
| `qc/measure.py` (`segment`, `kpis`) | ML |
| `qc/judge.py` (`judge`), `app.py`, `config/decision.yaml` | Backend |
| `qc/io.py`, `qc/run.py` | Shared glue |

The handoff is `out/kpis.csv`: one row per tile, columns `batch, image_id, strip_id, px_um, <KPIs>`. Backend can build against `tests/fixtures/kpis_fake.csv` without touching images.

Data layout: `data/<batch>/img_<image_id>_<detector>.tif`, 3 detectors per field (`BSE`, `ETD` or `SE`, `Inlens`). They're normalised to `BSE` / `ETD` / `InLens`. Pixel size is read from the TIFF resolution tags (0.025 µm/px). The baseline folder is set in `config/decision.yaml`.
