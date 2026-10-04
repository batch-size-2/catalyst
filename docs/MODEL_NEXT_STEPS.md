# Attribution model: next steps to improve performance

Written 4 Oct 2026, after reading the external review "SEM electrode deviation model — plan for agent" against the code. It does not replace `docs/PLAN_v4.md`; it is the ML side's working list for the model after the first freeze.

## 1. In short

- The plan is five model candidates, fixed now, each scored the same way against the current model, then one refreeze.
- The target is Batch_1 vs Batch_2, which is at chance today. "Batch_3 or not" already works at about 26 of 31 held-out images.
- The current model (staged `material > deep`, leave-one-strip-out 0.66) stays as the incumbent until a candidate beats it. Its classifier is the one frozen on 3 Oct; its confidence was replaced on 4 Oct (T14 adoption, [MODEL.md](MODEL.md)).
- We assume no hand labels. Segmentation is checked for consistency, not accuracy.

## 2. Where we are

| Piece | Today | Weak point |
|---|---|---|
| Segmentation (`qc/measure.py`) | Multi-Otsu on BSE into pore, graphite, silicon, binder; watershed for silicon particles | Never validated against labels |
| DINOv2 (`qc/deep.py`) | Frozen `dinov2-small` on InLens tiles; CLS + mean patch token, mean and SD over tiles, 10 principal components | Pooling hides local differences; no per-pixel output |
| Attribution (`qc/attribute.py`) | Staged logistic regression: named features decide "Batch_3 or not", deep components decide which variation | Batch_1 about 3 of 7 right; Batch_1 vs Batch_2 not separable |
| Baseline distance (`qc/attribute.py`) | Root-mean-square of per-feature z-scores against Batch_3 | Flags only 1 of the 14 Batch_1 and Batch_2 images |
| Distributions | Particle sizes reduced to d10 / d50 / d90 | A change in shape with the same median is invisible |

## 3. What we took from the external review

The review was written from two files and did not know the repo. Its data checks are right; its core proposal (rebuild segmentation with DINOv2 heads, SAM, U-Net) is not the next thing to do, because segmentation-derived features are at chance on the hard question.

| Review point | Our code today | Action |
|---|---|---|
| Assert RGB channels are identical | `load_image` takes `img[..., 0]` without checking | Setup step 3 |
| Fail loudly on a missing detector | `field_paths` accepts partial sets | Setup step 3 |
| Detector co-registration | Not checked | Setup step 3 |
| Curtaining, including diagonal | `curtaining_index` compares column to row variance; `curtaining_max` unset | Candidate 2 (destriping) |
| Dark band and electrode boundaries | Fixed 5% top and bottom crop | Check that the band falls inside the crop |
| Patch-level anomaly score with heatmap | Not built | Candidate 5 |
| Compare full distributions | Not built | Candidate 3 |
| Validation labels for segmentation | Not available | Label-free checks, section 6 |
| Saturation, border particles, leakage, thickness profile | Already covered | None |

## 4. Setup (first, about half a day)

1. **Link the data in.** `data/` and `out/` must exist in the workspace; nothing below runs without the batches.
2. **Reproduce the incumbent.** Rerun `uv run python -m qc.attribute --evaluate` and confirm 0.66 three-way leave-one-strip-out for the staged model, with its null.
3. **Harden the loader** (`qc/io.py`): assert identical RGB channels, require all three detectors, check detector alignment by phase cross-correlation on tiles.
4. **Lock the scoring rule.** Every candidate is scored by leave-one-strip-out, three-way and Batch_1 vs Batch_2, against the best-of-five null (the best of the five candidates per label shuffle). The 3 test samples in `Hackathon-Polaron-test` are not used for selection.

## 5. The five candidates, in order of expected gain

The list is fixed. With 7 images each in Batch_1 and Batch_2, every extra try raises the bar a winner has to clear.

| # | Candidate | What changes | Why it might help |
|---|---|---|---|
| 1 | **Tile types** | Cluster all DINOv2 tile embeddings without labels (about 8 types); each image becomes its share of each type | Mean pooling hides a rare kind of region; this lets it count. Each type can be shown as example tiles |
| 2 | **Microscope-cleaned, one model per detector** | Normalise each detector to the graphite peak instead of the p1–p99 stretch, destripe ETD and InLens, fit one model per detector and average the probabilities | ETD scored 0.79 on Batch_1 vs Batch_2 but may be acquisition; this settles it |
| 3 | **Distribution features** | Wasserstein distance from each image's particle size, contrast and void-fraction distributions to the Batch_3 pool | d10 / d50 / d90 miss a change in distribution shape. Wasserstein rather than KL: KL needs binning and blows up on empty bins at these sample sizes |
| 4 | **Shrinkage Gaussian in 10 components** | One Gaussian per batch with a shared, shrunk covariance, replacing the RMS z-score distance | Gives a distance to each batch and a batch probability from one model; fixes the distance that flags 1 of 14 |
| 5 | **Patch-level nearest neighbour** | Bank of Batch_3 patch embeddings; score an image by the distance of its most unusual patches | Better "outside baseline" score, plus a heatmap of where it differs |

Candidates 1–3 change the features and are the ones that could move Batch_1 vs Batch_2. Candidates 4–5 mainly improve "is it the baseline" and the explanation.

Candidates 1 and 5 reuse `qc.deep.tiles` and `Dinov2` without pooling.

## 6. Segmentation, without hand labels

We report deviation from the baseline, not absolute values, so a bias that is the same in every batch cancels out. The masks are therefore checked for consistency:

- **Synthetic controls** (`qc/controls.py`, built): extra silicon pasted in, voids punched, particles scaled by known amounts. The masks should recover those changes.
- **Shared strips as test-retest**: strips 2080, 2148 and 2156 appear in two batch folders. The spread between the two measurements of one strip is the measurement error.
- **Threshold sensitivity** (`threshold_variants`, built): on Batch_3, ±5 grey levels moves porosity by 0.021 and silicon d50 by 0.21 µm. A batch difference smaller than that is not trusted.
- **Cross-detector agreement** (new): cluster InLens and ETD intensities independently and measure agreement with the BSE phases.
- **Cross-method agreement** (new): a Gaussian mixture on the three detectors plus DINOv2 patch features, compared with multi-Otsu per phase.
- **Known recipe**: the nominal silicon content from the mentors, against the measured silicon fraction.

Try the unsupervised clustering segmenter as a replacement only if these checks fail. It is judged downstream: control recovery, shared-strip repeatability and leave-one-strip-out attribution.

Limits: consistency checks cannot catch a consistent error, such as binder always counted as pore. The cancelling argument only holds if imaging is the same across batches, and Batch_3 was imaged with a different InLens black level, which is one more reason for candidate 2.

## 7. Refreeze

Replace the model only if a candidate:

- beats 0.66 three-way leave-one-strip-out,
- beats the best-of-five null, and
- keeps confidence tiers that separate right from wrong calls.

Then move the `rules-frozen` tag (it also locks `config/decision.yaml` and the default baseline in the app, so this needs Patrik's agreement), rescore the 3 test samples once, and keep the old `results/Hackathon-Polaron-test.json` for the record.

## 8. Not doing

- **SAM and micro-SAM**: DINOv2 on single silicon particle crops scored 0.36, so better instances are unlikely to help.
- **U-Net, random forest or DINOv2 head for segmentation**: all need labels.
- **Full Mahalanobis across all features**: not estimable on about 170 features from 7 strip segments; candidate 4 is the estimable version.
- **KL divergence**: replaced by Wasserstein in candidate 3.

## 9. Open

- **More labelled images would help more than any candidate.** Ask the mentors for the true batches of the 3 test samples and for any further images.
- **Batch_1 vs Batch_2 may not be separable.** The batches are synthetic groupings, and nothing measured so far separates Batch_2 from the baseline materially. If all five candidates fail the null, that is the answer and the search stops.
