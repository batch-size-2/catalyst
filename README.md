# Catalyst

**Team:** [Batch Size 2](https://github.com/batch-size-2)  
**Hackathon track:** [Polaron — Track 4](https://www.polaron.ai/) — batch QC for electrode microstructure

## What we're building

A decision layer on top of SEM microstructure analysis: compare incoming batches to an approved baseline, quantify differences with uncertainty, and output interpretable **accept / investigate / reject** verdicts for materials QC.

## Plan

Day 1 working plan and technical design: [docs/PLAN_v0.md](docs/PLAN_v0.md).

## Quickstart

```bash
brew install uv          # once
uv sync
uv run pytest            # contract tests, keep green
uv run python -m qc.measure                               # data/<batch>/*.tif -> out/kpis.csv
uv run python -m qc.decide tests/fixtures/kpis_fake.csv   # kpis.csv -> out/evidence/<batch>.json
uv run streamlit run app.py
```

Stack: Python 3.11 + uv · numpy / pandas / scipy / scikit-image / tifffile · pydantic · Streamlit.

## Who owns what

| File | Owner |
|---|---|
| `qc/schema.py` | **Both.** The contract: phase labels, KPI names + units, Evidence JSON |
| `qc/measure.py` (`segment`, `kpis`) | ML |
| `qc/decide.py` (`compare`, `verdict`), `app.py`, `config/decision.yaml` | Backend |
| `qc/io.py` | Shared helper |

The handoff is `out/kpis.csv`: one row per field of view, columns `batch, image_id, px_um, <KPIs>`. Backend can build against `tests/fixtures/kpis_fake.csv` without touching images.

Data layout: `data/<batch>/<image_id>_<detector>.tif`. There are 3 detectors per field (`BSE`, `ETD`, `Inlens`). Pixel size is read from the TIFF resolution tags (examples: 0.025 µm/px).
