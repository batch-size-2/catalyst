# Pat's ML work: what is done, what is next, what to clarify

> **Status, 4 Oct 2026 (after the refit and the ground truth).** This file is a dated record; its plans for the freeze are done. Since it was written: the model was refitted (v4.2, Venn–Abers on "Batch_3 or not", no temperature; [MODEL.md](MODEL.md) §8); the three test samples were scored, then their true batches came back (1 of 3 exact, 3 of 3 "Batch_3 or not", 3 of 3 in the prediction set); "which variation" calls are now marked not established ([experiments/T18.md](experiments/T18.md)). The `rules-frozen` tag still holds the 3 Oct model. Current state: [MODEL.md](MODEL.md) and the README.

Written 3 Oct 2026, late evening, after a review of the code, the fitted model and the results; updated at 21:00 with the task designer's replies to our five questions. Plain language. All numbers come from [PLAN_v4.md](PLAN_v4.md) §12–12.2. The order of work for both of us is in PLAN_v4 §4. How the ML code works and what other code can rely on is in [AGENT_HANDOVER.md](AGENT_HANDOVER.md).

## 1. How we are judged

The task designer (Steve Kench) said on 3 Oct:

- Every image must **always be assigned to a batch**. The system may say it is very unsure, but it must still take a bet.
- We are judged on the assignment, the **confidence**, and the **explanation**.
- The goal is "different from the baseline, and in what way". Getting the batch right is how "in what way" is measured.

The unseen images:

- **Arrived on 3 Oct:** the folder `Hackathon-Polaron-test` with 9 files, which is **3 samples** (3 detectors each): `3e122cbj`, `fn0mhxef`, `xrv9xvzb`. We had expected nine images, three per batch. They were scored once after the freeze (`results/Hackathon-Polaron-test.json`); true batches: `3e122cbj` Batch_2, `fn0mhxef` Batch_1, `xrv9xvzb` Batch_3.
- **Still to come:** "further images coming just before the judging" (Steve, 3 Oct evening). Earlier we were told 2 images at the presentation ("which batch, and why"). How many come, and from which batches, is not known.

Steve's replies of 3 Oct evening, and what each changes (PLAN_v4 §1.4):

| Reply | New? | What it changes |
|---|---|---|
| Batch_3 is the baseline | No | Nothing |
| The images are real; the batches were sampled from one dataset and "backward engineered" | No | Nothing. It makes a designed microscope difference between batches unlikely (our reading) |
| The unseen set has "dropped, with further images coming just before the judging" | **Yes** | The freeze is now urgent. The 3-per-batch assumption is gone. The last images leave no time to refit |
| The bright particles are silicon; "the content % is for you to figure out" | Partly | Show silicon content as a percentage. It does not sort the batches: 8.3 / 5.7 / 6.2 area %, and Batch_1 is 6.3 without strip 2316 |
| Same detectors; "normalised as best as possible by the user; preprocessing is up to you" | **Yes** | We may normalise between images. Test it on the named textures before the freeze |

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
| A model the app can use | `config/attribution_model.json`: deep features, right on 0.64 of held-out strips (shuffled labels give 0.54). Frozen 3 Oct (`rules-frozen`), refitted 4 Oct (v4.2) |
| Always a bet | Every image gets a batch. Nothing in the output means "no answer" |
| Two stages | Each call says "Batch_3 or not", then "which other batch", each with its own confidence |
| Confidence that is checked | Probabilities are rescaled using strips the model did not see. Each call has a tier (high / medium / low) and a record, e.g. "calls in this tier were right 7 of 9 times" |
| Prediction set | The batches that should contain the right answer 8 times out of 10, e.g. "Batch_2 or Batch_3" |
| Readable reasons | Each reason is a sentence, e.g. "InLens texture pattern regularity at 0.2 um: 2.6 SD below Batch_3" |
| "Unfamiliar" fixed | It now means "outside the batch it was assigned to". The old meaning is kept as `outside_baseline` |
| Staged model (option) | One model for "Batch_3 or not", a second for "which other batch" |
| Many rehearsals | The nine-image rehearsal can be repeated over many draws, to see the spread |
| Tests | 67 passed on 3 Oct (144 on `main` now). The full evaluation reproduces every earlier number |

PLAN_v4 is now the only plan and is self-contained (v0–v3 were deleted; they are in git history). It carries Rule 11 "always a bet", the amended Rule 2 and the results in §12.2. Patrik has agreed to it.

## 3. What the results say

Chance is 0.33 for three batches. A result only counts if it beats the score with shuffled labels ("null").

| Question | Result | Good enough? |
|---|---|---|
| Is it Batch_3 or not? | Right for 24–26 of 31 held-out images | Yes |
| Which of the three batches? | 0.64 (null 0.54) | Just |
| Batch_1 or Batch_2? | Not separable with anything reliable | **No** |
| Rehearsal, 9 held-out images, repeated 20 times | 0.63 on average, from 4 of 9 to 8 of 9 | One rehearsal means little |
| Same, forcing 3 images per batch | 0.78 on average | Helps only if the test is 3 per batch. The drop has 3 samples and an unknown split, so do not count on it |
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
9. **Two earlier rules are dropped (3 Oct).** "No language model measures, decides or explains" and "images stay on our machines" no longer apply (PLAN_v4 §2, Rules 3 and 5); `AGENTS.md` and `docs/APP.md` no longer carry them. Nothing in the code has changed because of it: everything still runs locally and the texts still come from templates.

## 5. What to do next

The same order as PLAN_v4 §4, in plain words. The unseen images have started to arrive, so the freeze comes first and everything else is cut to fit before it.

**Before the freeze (tonight, with a time box agreed with Patrik):**

1. **Settle the two decisions still open** (section 6): when to freeze, and which model.
2. **Work through one short list, fixed before looking at any result:**
   - **Shared strips side by side.** Strips 2080, 2148 and 2156 have images in both Batch_1 and Batch_2: same strip, different batch. Look at them by eye and list the features that differ in the same direction in all three. An earlier hint: silicon patchiness (`si_dispersion_cv`) was higher in Batch_2 in 4 of 5 shared strips.
   - **Remove the microscope from the named textures.** Steve said preprocessing is ours. Stretch each detector image the way the deep features already do, recompute the texture features and test again. This is the cheapest check on whether "Batch_3 or not" is material or microscope.
   - **One model per detector.** Do not concatenate ETD with InLens (that gave 0.64). Fit one model per detector and average their probabilities.
   - **Other tile sizes.** About 5 µm and about 22 µm, against the 11 µm of today.

   Compare the best of the list against the best-of-the-list null. With 31 images, trying many things and keeping the winner will fool us. ETD and the imaging features only go into the model if they survive that null: Steve's replies make a designed microscope difference unlikely.
3. **Choose the model to freeze**: flat deep, staged, or the staged first stage for the confidence with the deep model for the call.
4. **Rehearse, fit, freeze.**

**After the freeze:**

5. **Score the 3 dropped samples, once.** Link the folder into `data/` under its own name, run, copy the output to `results/` and commit it unchanged. No `--balanced`. Time the run for one sample.
6. **Rehearse the last-minute images** with Patrik: the same single command on known images, through the app, timed. Nothing is refit on the day.
7. **When the last images arrive:** the same command on their folder; present the call, its confidence and its reasons.

```bash
uv sync --extra deep
uv run --extra deep python -m qc.attribute --dry-run --repeats 30     # rehearsal, with spread
uv run --extra deep python -m qc.attribute --fit --families deep      # or: --fit --staged reg,edge,tex,par,kpi:deep
git add config/attribution_model.json && git commit                   # then:
git tag rules-frozen
uv run --extra deep python -m qc.attribute --images data/Hackathon-Polaron-test   # once
mkdir -p results && cp out/attribution/Hackathon-Polaron-test.json results/        # commit unchanged
```

**Only if time is left** (none of it is needed for the judged test):

- Example-based reasons: for each call, the nearest known tiles ("looks like these"). This also covers the four deep components with no translation.
- Measure what the eye sees in the shared strips (AGENT_HANDOVER §6): cracks inside particles, binder amount, porosity split into "between particles" and "inside particles", porous silicon.
- DINOv2-base or DINOv3, once.
- If the true batches of the unseen images are given, add them to training. More images per batch is the real limit: Batch_1 and Batch_2 have 7 images each, from 6 strips.

## 6. Things to clarify

### With Steve

Answered on 3 Oct evening: Batch_3 is the baseline; the batches were assembled from one dataset; the bright particles are silicon; the unseen images use the same detectors; the first unseen images have dropped and more come just before judging.

Still open:

1. **How many more images come before judging, and from which batches?** The drop has 3 samples, not nine. If the full set is three per batch, the balanced assignment was worth about +0.15 in rehearsals; without a confirmed split we do not use it.
2. **Are the unseen images from strips we already have, or new ones?** We never use the strip as a feature, but it tells us which accuracy estimate applies.
3. **Does a microscope difference count as a batch difference?** Our reading of the replies is no. If yes, the ETD detector and the imaging features can go into the model.
4. **Is each image scored, or the set? Does a low-confidence call that is right count the same?** We always take a bet either way.
5. **Are the top and bottom 5% of each image meaningful?** We cut them from most measurements.

### With Patrik

1. **Which model to freeze**: more accurate (deep only) or more honest about its confidence (staged). Both are judged.
2. **The time box** for the last model work before the freeze (section 5, step 2).
3. **The app**: silicon content as a percentage in the compare view; show `reasons[].text`, `confidence_tier` with `confidence_record`, `stage_baseline`, `stage_variation`, `prediction_set`; make the badge print `predicted_distance` and `predicted_threshold`; update `web/src/types.ts` and the two attribution fixtures. Nothing the app reads today was renamed.

### For Pat to decide

- Decided: the model was committed and frozen on 3 Oct, and refitted on 4 Oct.
- Decided (3 Oct, 21:30): the 3 dropped samples are scored right after the freeze, once. Done.

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
- Example textures instead of heatmaps for SEM: [Palmer et al. 2021](https://arxiv.org/abs/2111.03729). Not built yet (section 5, only if time is left).
- Prediction sets: [conformal predictors](https://proceedings.mlr.press/v105/johansson19a.html). Built.
- DINOv3: [arXiv 2508.10104](https://arxiv.org/html/2508.10104v1). Not tried yet (section 5, only if time is left).
