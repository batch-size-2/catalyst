# AGENTS.md

Instructions for any AI coding agent working in this repo (Devin, Claude, Cursor, Antigravity, ...).

## Keep the README current

`README.md` is the shared map of the system. Keep these sections in sync with the code **in the same PR**:

- **Architecture** (mermaid diagram)
- **Infrastructure** (processes, folders, HTTP API)
- **Data pipeline** (steps, phases, KPIs and their status)
- **Decision algorithm** (formulas, rules, config keys)
- **Who owns what**

Update them if your change adds, removes, renames or rewires any of the following:

- a module in `qc/` or a top-level part of `web/`
- a contract function (`segment`, `kpis`, `judge`, `run`, `load_field`) or an `/api` endpoint
- a KPI, phase label, config key, or a file or folder under `data/`, `out/` or `config/`
- the data flow between them, or a decision rule

Check the diagram still matches the code before you open a PR. If you're unsure, update it.

## Commands

```bash
uv sync                                                    # setup
uv run pytest                                              # must pass before every PR
uv run python -m qc.measure [data/<batch> ...]             # ML only: images -> out/kpis.csv + out/masks/
uv run python -m qc.run --batch data/<batch>               # images -> kpis.csv -> evidence
uv run python -m qc.decide tests/fixtures/kpis_fake.csv --baseline fake_baseline   # backend only
uv run uvicorn qc.api:app --reload                         # API on :8000
cd web && npm install && npm run dev                       # UI on :5173 (Node >= 20.19)
cd web && npm run build                                    # typecheck + build, must pass before every PR touching web/
```

## Rules

- Software-side status and next steps: `docs/HANDOFF.md`. Read it first; delete it and this line once its list is done.

- The highest-numbered `docs/PLAN_vN.md` (currently `docs/PLAN_v4.md`, the only one; older versions are in git history) is the plan and is owned by the team; don't rewrite it from a code PR. What to do next is in its §4. If the code has to deviate from it, say so in the README and the PR.
- `qc/schema.py` is the ML ↔ backend contract (PLAN_v4 §3.1). Adding a field or KPI is fine. Renaming, removing or changing a unit needs both owners. Update `tests/fixtures/kpis_fake.csv`, `tests/test_contract.py` and `web/src/types.ts` along with it.
- `qc/api.py` stays a thin wrapper: no QC logic in the API or the UI.
- Never commit `data/`, `out/` or `EXAMPLE BATCHES FOR LOCAL REFERENCE/` (1.6 GB of raw TIFFs). The dataset has been shared with every hackathon participant, so screenshots of the app on real images are fine in PRs and docs.
- Don't edit `config/decision.yaml` after the `rules-frozen` git tag.
- Install npm packages with `npm install --before=<date one week ago>` to avoid brand-new releases.

## UI conventions (web/)

- Desktop only (1280–1920 wide). Don't add mobile layouts.
- Every page: `PAGE` column + `PageHeader` (40 px title, at most one short sentence) from `components/bits.tsx`. No eyebrow labels over titles, no "EXPERIMENTAL"/"TEMPLATE" chips: the breadcrumb and the sidebar heading already say it.
- Reuse the shared pieces: `BatchSelect` (`components/Pickers.tsx`) for any batch/baseline picker, `Note` for neutral notices, `ErrorPanel` (with `details` for raw backend text), `Folds`, `Seg`, `SigmaBand`, `LAYERS`, `batchLabel()` for any folder name.
- `design/tokens.css` sits in Tailwind's components layer, so utilities on an element override token classes (`p-0` on a `.panel`, `min-h-9` on a `.btn`); no `!` or inline-style overrides needed.
- No noise: one caveat where it's needed, not on every card; no code names (snake_case, feature codes, folder paths, git words) in visible text; no developer instructions in the UI.
