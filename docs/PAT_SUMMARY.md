# Pat's ML work: what is done, what is next, what to clarify

Written 3 Oct 2026, late evening, after a review of the code, the fitted model and the results. Plain language. All numbers come from [PLAN_v4.md](PLAN_v4.md) §12–12.2. How the ML code works and what other code can rely on is in [AGENT_HANDOVER.md](AGENT_HANDOVER.md).

## 1. How we are judged

The task designer (Steve Kench) said on 3 Oct:

- Every image must **always be assigned to a batch**. The system may say it is very unsure, but it must still take a bet.
- We are judged on the assignment, the **confidence**, and the **explanation**.
- The goal is "different from the baseline, and in what way". Getting the batch right is how "in what way" is measured.

Still to come: the held-back images to sort into the three batches, and 2 images at the presentation ("which batch, and why").

## 2. What we have done

### The measuring side (on `main`)

| Piece | What it does | File |
|---|---|---|
| Segmentation | Splits each image into pore, graphite, silicon and binder | `qc/measure.py` |
| 15 measurements per image | Silicon amount, particle size, porosity, and so on | `qc/measure.py` |
| Particle table | One row per silicon particle: size, brightness, voids, texture, shape | `qc/measure.py` |
| Imaging check | Per detector: black level, noise, sharpness, saturation, curtaining | `qc/measure.py` |
| Particle types | Groups silicon particles into types (first fit, 2 types, not final) | `qc/types.py` |
| Controls | Fake batches with a known answer, to prove the measurements react correctly | `qc/controls.py` |
| Uncertainty | How much the numbers move with the threshold, and how many images are enough | `qc/uncertainty.py` |
| Feature table | About 200 named features per image: by region, texture, particles, image edges | `qc/features.py` |
| Deep features | DINOv2 (a pretrained vision model), run locally on the InLens image | `qc/deep.py` |
| Dictionary | Plain-language meaning, causes and supplier checks per measurement (draft) | `config/kpi_dictionary.yaml` |

One sample is three files (BSE, ETD or SE, InLens). They are loaded together as one sample and get **one** call. Segmentation and the measurements use BSE. Texture and the imaging check use all three. The deep features use InLens only.

### The batch-sorting side (`qc/attribute.py`, added 3 Oct)

| What | In plain words |
|---|---|
| A model the app can use | `config/attribution_model.json`: deep features, right on 0.64 of held-out strips (shuffled labels give 0.54). **Not frozen** |
| Always a bet | Every image gets a batch. Nothing in the output means "no answer" |
| Two stages | Each call says "Batch_3 or not", then "which other batch", each with its own confidence |
| Confidence that is checked | Probabilities are rescaled using strips the model did not see. Each call has a tier (high / medium / low) and a record, e.g. "calls in this tier were right 7 of 9 times" |
| Prediction set | The batches that should contain the right answer 8 times out of 10, e.g. "Batch_2 or Batch_3" |
| Readable reasons | Each reason is a sentence, e.g. "InLens texture pattern regularity at 0.2 um: 2.6 SD below Batch_3" |
| "Unfamiliar" fixed | It now means "outside the batch it was assigned to". The old meaning is kept as `outside_baseline` |
| Staged model (option) | One model for "Batch_3 or not", a second for "which other batch" |
| Many rehearsals | The nine-image rehearsal can be repeated over many draws, to see the spread |
| Tests | 67 pass. The full evaluation reproduces every earlier number |

The PLAN_v4 draft is updated to match (Rule 11 "always a bet", Rule 2 amended, results in §12.2). It still needs Patrik's review.

## 3. What the results say

Chance is 0.33 for three batches. A result only counts if it beats the score with shuffled labels ("null").

| Question | Result | Good enough? |
|---|---|---|
| Is it Batch_3 or not? | Right for 24–26 of 31 held-out images | Yes |
| Which of the three batches? | 0.64 (null 0.54) | Just |
| Batch_1 or Batch_2? | Not separable with anything reliable | **No** |
| Rehearsal, 9 held-out images, repeated 20 times | 0.63 on average, from 4 of 9 to 8 of 9 | One rehearsal means little |
| Same, forcing 3 images per batch | 0.78 on average | Helps, if the test really is 3 per batch |
| Prediction sets on unseen images | Held the right batch 89% of the time, about 2 batches per set | Yes |

What was tried for Batch_1 vs Batch_2, all on held-out strips:

| Idea | Batch_1 vs Batch_2 (0.5 is chance) |
|---|---|
| DINOv2 on InLens (current) | 0.64 |
| DINOv2 on BSE | 0.36 |
| DINOv2 on ETD | 0.79 |
| DINOv2 on all three detectors | 0.64 |
| DINOv2 on single silicon particles | 0.36 |
| Two-point correlation curves | 0.36–0.50 |
| Training on tiles, voting per image | 0.50–0.64 |
| Named texture / material features | 0.36 / 0.50 |

ETD looks good, but it is the best of seven tries: about 1 in 5 label shuffles do as well. ETD sharpness also differs between the two batches (2,126 against 1,748), so part of it may be the microscope. It is a lead, not a result.

## 4. What the review found

These are weak points in what exists today.

1. **The deep model's confidence tiers are not honest yet.** On unseen strips, "high" calls were right 67% of the time, "medium" 67%, "low" 60%: no real difference. The staged model's tiers work (91% / 62% / 40%) but it is right less often (0.55 against 0.63).
2. **The model fits its training images much better than new ones** (0.87 against 0.64). Expect fewer "high" calls on new images than on the known ones.
3. **Four of the ten deep components have no readable translation.** Their reason reads "no named feature moves with it". The other six read well.
4. **The "outside the baseline" distance almost never fires.** Only 1 of the 14 Batch_1 and Batch_2 images is flagged. "Different from the baseline" therefore rests on the classifier's first stage, not on the distance.
5. **"Unfamiliar" has never been tested on a truly foreign image.** It did not fire on any known image, as intended, but there is no positive example.
6. **Batch_1 is the weak class everywhere** (about 3 of 7 right). Strip 2316 looks like nothing else and reads as Batch_3 when held out.
7. **A possible confound for Batch_3 too.** Batch_3 was imaged with a different InLens black level. The deep features stretch the contrast first, which reduces this, but it is not ruled out.
8. **The app does not show the new fields yet.** It still prints code names, and its "Unlike any known batch" badge prints the baseline distance.
9. **Two shared files changed and it was not us.** `AGENTS.md` and `docs/APP.md` have uncommitted edits that remove the "don't upload the images" rule and the "no language model" rule. Check who made them before committing.

## 5. What to do next to improve the model

In order. Steps 1–3 are cheap and should come before any new modelling.

1. **Look at the shared strips side by side.** Strips 2080, 2148 and 2156 have images in both Batch_1 and Batch_2. These pairs are the cleanest comparison there is: same strip, different batch. Look at them by eye, and list the features that differ in the same direction in all three strips. An earlier hint: silicon patchiness (`si_dispersion_cv`) was higher in Batch_2 in 4 of 5 shared strips.
2. **Decide which model to freeze** (see section 6), or combine them: use the staged model's first stage for confidence and the deep model for the call.
3. **Get the answers from Steve** (section 6). Two of them change the model directly.
4. **Try the ETD detector properly.** Do not concatenate it with InLens (that gave 0.64). Fit one model per detector and average their probabilities. Test it with the "best of all tries" null. Only keep it if Steve says microscope differences count, or it survives that null.
5. **Try other tile sizes.** Tiles are about 11 µm now. The Batch_1 / Batch_2 difference may live at a finer scale (about 5 µm) or a coarser one (about 22 µm). Also try DINOv2-base or DINOv3 once.
6. **Remove the microscope from the named textures.** Stretch each detector image the same way the deep features do, then recompute the texture features and test again.
7. **Measure what the eye sees in step 1.** Likely candidates (AGENT_HANDOVER §6): cracks inside particles, binder amount, porosity split into "between particles" and "inside particles", porous silicon.
8. **Add example-based reasons.** For each call, show the nearest known tiles ("looks like these"). This also covers the four deep components with no translation.
9. **After the held-back images are scored, add them to training.** More images per batch is the real limit: Batch_1 and Batch_2 have 7 images each, from 6 strips.

A rule for all of this: decide the short list of things to try **before** looking at results, and compare the best one against the best-of-the-list null. With 31 images, trying many things and keeping the winner will fool us.

Then freeze and score:

```bash
uv sync --extra deep
uv run python -m qc.attribute --dry-run --repeats 30     # rehearsal, with spread
uv run python -m qc.attribute --fit --families deep      # or: --fit --staged reg,edge,tex,par,kpi:deep
git tag rules-frozen
uv run python -m qc.attribute --images data/<drop>       # once; commit the output unchanged
```

## 6. Things to clarify

### With Steve

1. **How many held-back images are there?** The folder `Hackathon-Polaron-test` has 9 files, which is **3 samples** (3 detectors each): `3e122cbj`, `fn0mhxef`, `xrv9xvzb`. Earlier we were told 9 images, 3 per batch. Is it 3 samples (one per batch?), or are 6 samples still to come?
2. **Is the split equal across batches?** If yes, we submit the balanced assignment, which was worth about +0.15 in rehearsals.
3. **Does a microscope difference count as a batch difference?** If yes, the ETD detector and the imaging features can go into the model.
4. **Are the held-back images from strips we already have, or new ones?** We never use the strip as a feature, but it tells us which accuracy estimate applies.
5. **Are the top and bottom 5% of each image meaningful?** We cut them from most measurements.

### With Patrik

1. **Which model to freeze**: more accurate (deep only) or more honest about its confidence (staged). Both are judged.
2. **The PLAN_v4 changes**: Rule 11 (always a bet) and the amended Rule 2 (deep features allowed if every reason is translated).
3. **The app**: show `reasons[].text`, `confidence_tier` with `confidence_record`, `stage_baseline`, `stage_variation`, `prediction_set`; make the badge print `predicted_distance` and `predicted_threshold`; update `web/src/types.ts` and the two attribution fixtures. Nothing the app reads today was renamed.
4. **The edits to `AGENTS.md` and `docs/APP.md`** (section 4, point 9).

### For Pat to decide

- Whether to commit the fitted model now (it is not frozen) so the app's Sort view works.
- Whether the held-back samples are scored now as 3, or only once the full set and the answers above are in. They have not been opened; only their file names were listed.

## 7. Later, if time allows

- Refit the particle types and give them real names (the current fit is provisional).
- Have a mentor review the causes in the dictionary.
- Wear and degradation outlook (`qc/degrade.py`, not started).
- A small hand-labelled check of the segmentation.

## 8. Why these methods (literature check, 3 Oct)

A quick search, not a full review. Nothing found is specific to sorting silicon-graphite batches from SEM images.

- The model family stays. Frozen foundation-model features with a small model on top is the current approach for small materials datasets ([Whitman & Latypov 2025](https://arxiv.org/abs/2501.18637)). Reviews of explainable ML in battery production keep favouring interpretable models on named features.
- Supervised defect detectors (CNNs trained on labelled cracks, inclusions and coating faults) do not fit: we have no defect labels, 31 images, and batches that are not defined by defects.
- Particle-level DINOv2 embeddings on SEM ([arXiv 2508.03235](https://arxiv.org/abs/2508.03235)) and two-point statistics with PCA ([arXiv 2405.18396](https://arxiv.org/pdf/2405.18396)): both tried here, neither separated Batch_1 from Batch_2.
- Example textures instead of heatmaps for SEM: [Palmer et al. 2021](https://arxiv.org/abs/2111.03729). Not built yet (step 8).
- Prediction sets: [conformal predictors](https://proceedings.mlr.press/v105/johansson19a.html). Built.
- DINOv3: [arXiv 2508.10104](https://arxiv.org/html/2508.10104v1). Not tried yet (step 5).
