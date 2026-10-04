# Handoff for Devin: attribution model after the 4 Oct refit

Written 4 Oct 2026 by the previous agent (Claude) at the end of its session. Read [MODEL.md](MODEL.md) first: it is the full write-up of the model as it stands. This note only says where the work stopped and what is next. Delete it once the list in §3 is done.

## 1. State

- Branch `akaimody123/catalyst-prs-experiments-summary`, based on `main` at `ef7ff8f`, with `pat/T14-confidence` merged in (so it also carries the commits of PR #21 and PR #36).
- The pull request for this branch targets `main`.
- `uv run pytest` and `cd web && npm run build` pass.
- The pipeline was run end to end from the raw TIFFs on 4 Oct (features, DINOv2, fit, evaluation, rehearsal, the three test samples, the app).

## 2. What was done in this session

| Piece | Where |
|---|---|
| Model unfrozen and refitted (v4.2). Same classifier (identical coefficients); new confidence: class-balanced Venn–Abers on "Batch_3 or not" with its interval, staged call rule, no temperature, held-out records | `qc/attribute.py` (`venn_abers`, `_calibrated`, `_call`, `calibrate`), `config/attribution_model.json` |
| The check that chose this variant, six variants in two views | `scripts/experiments/T14_adoption.py`, `docs/experiments/T14.md` "Adoption" |
| Global explanation: what each stage leans on, with the imaging descriptors each image pattern tracks | `importance()` in `qc/attribute.py`; `explain.importance` in the model file; served by `GET /api/attribution-model` and in each run's `model` block |
| App: range chip for "baseline or not", held-out coverage of the sets, tier records on the Identify landing card, new fold "What the model leans on overall", two rows in "Model and run" | `web/src/components/IdentifyResult.tsx`, `Identify.tsx`, `web/src/types.ts` |
| Three test samples rescored once; same bets | `results/Hackathon-Polaron-test.refit.json` (the 3 Oct file is kept) |
| Docs | `docs/MODEL.md` (new), README, `docs/AGENT_HANDOVER.md` §3.4, `docs/MODEL_NEXT_STEPS.md` |

Numbers to remember: 22 of 31 with strips held out (balanced 0.66, null 0.51); rehearsal 0.66 (was 0.57 with the frozen call rule); tiers 9/9, 7/11, 6/11.

## 3. What is next, in order

1. **Move the `rules-frozen` tag, after Patrik agrees.** It also locks `config/decision.yaml` and the default baseline. Until it moves, the app says "model differs from the frozen one", which is correct. Command: `git tag -f rules-frozen <commit of config/attribution_model.json on main> && git push -f origin rules-frozen`. Do not move it on your own.
2. **Close PR #36 (T14) and PR #21 (experiments base) once this PR is merged**: their commits are in it. The other open ticket PRs (T1–T13) stack on `pat/experiments-base` and will need a rebase onto `main`. None of their scripts uses the removed temperature code; T4 and T8 touch `qc/attribute.py` and `tests/test_attribute.py` and will conflict there.
3. **Last-minute images.** Same single command, nothing is refit: `uv run python -m qc.attribute --images data/<folder>`, then copy the output to `results/` and commit it unchanged. Through the app: Identify tile, drop the three TIFFs; about 17 s per sample.
4. **Explainability, still open** (MODEL.md §9.4):
   - Per-reason imaging caveat on the reason cards. PR #31 (T4) has a text-only wording layer; rebase it on this branch. The overall panel already shows which image patterns track imaging.
   - "Where in the image": no heatmap yet. T11 and T12 have tile-level maps and a tile gallery as report-only experiments.
   - Image pattern 07 (24% of stage 2) has no named translation.
5. **Model candidates** in `docs/MODEL_NEXT_STEPS.md` §5 are untouched. The refreeze rule there still applies to them.

## 4. How to run it here

```bash
uv sync
mkdir -p data && ln -s <path to the batches>/Batch_1 data/Batch_1   # same for Batch_2, Batch_3, Hackathon-Polaron-test
export HF_HUB_OFFLINE=1                                             # DINOv2 weights are in the Hugging Face cache
uv run python -m qc.features data/Batch_1 data/Batch_2 data/Batch_3
uv run python -m qc.deep data/Batch_1 data/Batch_2 data/Batch_3
uv run python -m qc.attribute --fit --staged reg,edge,tex,par,kpi:deep
uv run pytest
export PATH=/opt/homebrew/opt/node@22/bin:$PATH && cd web && npm run build
```

On Pat's Mac the raw batches are in `/Users/pat/conductor/workspaces/catalyst/data`.

## 5. Things that will bite

- **Name the three batch folders** for `qc.features` and `qc.deep`. Without arguments they take every folder in `data/`, and the test folder would become a training batch.
- **A refit changes `fitted_at`**, so every saved run then shows "Made by an earlier model" in the app. After a refit, rescore and regenerate `tests/fixtures/attribution_example.json` (three known images: `0grcilhi`, `3806gxp0`, `4ih2ggld`, scored from a folder named `example_drop`).
- **Do not judge a calibration by holding out one image.** Images of one strip share scores. T14's original comparison did this and looked better than it is; hold out the strip, and check on the rehearsal (`--dry-run --repeats 30`).
- **Do not let the largest of three probabilities decide the call** once stage 1 is calibrated. With the Venn–Abers of T14 it lost 2 of 31 known images and 28 of 270 rehearsal calls against the staged rule.
- **31 images.** A difference of one or two images is noise. The calibration variant was picked among six on the same images it is scored on; MODEL.md §8 says so, keep saying so.
- **`qc/api.py` and `web/` are Patrik's.** This session changed `qc/provenance.py` by one pass-through line and the Identify components; the Compare page was not touched (it is still being redesigned).
- `docs/PLAN_v4.md` was not edited. Its §3.15 and §12.3 still describe the 3 Oct model; the deviation is stated in the README.
