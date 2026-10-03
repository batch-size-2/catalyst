# AGENTS.md

Instructions for any AI coding agent working in this repo (Devin, Claude, Cursor, Antigravity, ...).

## Keep the architecture diagram up to date

`README.md` → **Architecture** (mermaid diagram) and **Who owns what** (table) are the shared map of the system.
If your change adds, removes, renames or rewires any of the following, update both in the **same PR**:

- a module in `qc/` or `app.py`
- a function in the ML ↔ backend contract (`segment`, `kpis`, `judge`, `run`, `load_field`)
- a file or folder under `data/`, `out/` or `config/`
- the data flow between them

Check the diagram still matches the code before you open a PR. If you're unsure, update it.

## Commands

```bash
uv sync                                                    # setup
uv run pytest                                              # must pass before every PR
uv run python -m qc.run --batch data/<batch>               # images -> kpis.csv -> evidence
uv run python -m qc.judge tests/fixtures/kpis_fake.csv --baseline fake_baseline   # backend only
uv run streamlit run app.py                                # dashboard
```

## Rules

- `qc/schema.py` is the ML ↔ backend contract. Adding a field or KPI is fine. Renaming, removing or changing a unit needs both owners. Update `tests/fixtures/kpis_fake.csv` and `tests/test_contract.py` along with it.
- Never commit `data/` or `out/`. The images cost £50k to collect: don't upload them to any external service without Polaron's OK (see `docs/PLAN_v1.md` §13).
- Don't edit `config/decision.yaml` after the `rules-frozen` git tag.
- The current plan is `docs/PLAN_v1.md`.
