# Attribution model: literature review and what to do next

Written 3 Oct 2026, late evening, for Pat. It answers one question: can a different or better model (for example a Gaussian one) improve batch attribution, and if not, what can?

> Historical: "tonight", "before the freeze" and the submission times refer to 3–4 Oct. What was adopted and what was ruled out since is in [MODEL.md](MODEL.md) and [TICKETS.md](TICKETS.md).

- No code was changed and no model was fitted or evaluated for this document. Every model result quoted is from [PLAN.md](PLAN.md) §12–12.2. New numbers are simple arithmetic, shown where used; image counts per strip read from the file headers; and, in section 8, read-only checks on the 31 known images and on the tables in `out/`, made with throwaway scripts after looking at the images. The unseen images were not touched.
- It does not replace PLAN. Where it suggests changing §4 step 2, that is a proposal for the two owners.
- References are `[L1]`…`[L55]`, listed in section 9. Most were read at abstract or search-summary level today. The ones marked * are cited from prior knowledge and were not reopened.

## 1. In short

**The position to check:** the bottleneck is the signal, not the classifier. Keep logistic regression, freeze the staged model, and spend the remaining time on the shared-strip comparison and the normalisation check.

**Verdict: agreed, with three changes to how the two checks are run.**

| # | Finding | Consequence |
|---|---|---|
| 1 | No classifier swap can be shown to help at this sample size. With 14 images, a model that is truly right 75% of the time on Batch_1 vs Batch_2 clears the fair null only 28% of the time, and every extra model we try raises the bar (section 2) | Keep logistic regression. Do not add classifiers to the list before the freeze |
| 2 | A Gaussian model with a linear boundary (LDA) is the same family as logistic regression. The non-linear Gaussian models (QDA, mixtures per class, a Gaussian process with a curved kernel) cannot be estimated from 7 images per class and are not allowed by Rule 2 (section 3) | "Gaussian" does not buy accuracy. It can buy a better *familiarity* distance, after the freeze |
| 3 | **The normalisation check as written in §4 step 2(b) cannot fail.** The `tex_` features are already unaffected by a p1–p99 stretch: LBP only compares each pixel with its neighbours, and the GLCM code already rescales between the black level and the 99.5th percentile (section 5.1) | Replace it with a noise and sharpness check. The existing negative controls already provide the images |
| 4 | **"Same direction in all three shared strips" is not evidence by itself.** There are exactly 3 Batch_1/Batch_2 pairs, one image each. A feature with no signal agrees in all three 25% of the time, so about 45 of the 180 material features will pass by chance (section 5.2) | Compare the 3 cross-batch pairs against the 18 same-batch pairs from the same strips. That test has real power (best possible p ≈ 0.001 to 0.008) |
| 5 | The staged model is the right one to freeze, on one condition: its first stage uses the texture features, so it depends on finding 3 (section 6) | Run the noise check first, then freeze. If the texture signal turns out to be noise, fall back to flat `deep` |
| 6 | **Looking at the micrographs explains what the deep model reads.** In InLens, graphite is either grey or black, in zones. Batch_1 has almost none in all 7 images. Best judgement: an electrical imaging contrast, not material. The first deep component correlates −0.75 with it (section 8.2) | Keep it in the call, take it out of the material claims. Batch_1's real material difference is the silicon of strip 2316. **The ordered next steps are in section 8.5** |

What would change this verdict: the pair test of section 5.2 showing that Batch_1 and Batch_2 images of one strip differ clearly more than two same-batch images of one strip. Then there is a signal to chase, and section 5.2 says how to turn it into at most three named features.

## 2. Why the classifier is not the bottleneck

### 2.1 The arithmetic

Batch_1 vs Batch_2 is 14 images. Under shuffled labels the number right is roughly binomial(14, 0.5). That reproduces the nulls measured in PLAN §12.2:

| Bar | Needed | Chance under the null | Matches |
|---|---|---|---|
| One method, fixed in advance | 11 of 14 (0.79) | 2.9% | Measured null p95 0.71 = 10 of 14; ETD scored exactly 11 of 14 |
| Best of 7 methods | 12 of 14 (0.86) | 0.6% each | Measured best-of-seven null p95 0.86 |
| Best of 12 methods | 13 of 14 (0.93) | 0.09% each | – |

Chance that a model clears the bar, by its **true** accuracy:

| True accuracy | One fixed method (≥ 11) | Best of 7 (≥ 12) | Best of 12 (≥ 13) |
|---|---|---|---|
| 0.65 | 22% | 8% | – |
| 0.75 | 52% | 28% | 10% |
| 0.85 | 85% | 65% | 36% |

- Even a good model (0.75) would be recognised only about half the time if it were the only thing we tried, and about a quarter of the time after the seven tries already made.
- The images are not independent (14 images from 9 strips), so the real power is lower than this table.
- Each new classifier added to the search moves us one column to the right. **Trying more models makes it less likely that anything can be established.**

### 2.2 What the literature says

| Point | Source | What it says for us |
|---|---|---|
| Error bars of cross-validation at small n are large | [L1] | About ±10% at n = 100; the spread across folds understates it. At n = 14 a difference between two models of 0.1–0.2 is noise. The rehearsals show the same: 0.44 to 0.89 for one model across draws |
| Picking the best of several models biases the reported score | [L2] | Selection needs its own null. This is the best-of-list null already in PLAN §3.17 |
| Permutation tests are the right check for "is there any class structure" | [L3], [L4] | Already done, with strips kept together. Nothing to add |
| Leakage through grouped data | PLAN [R4], [R5] | Already handled by holding out strips |
| Linear model on frozen pretrained features is the standard few-shot recipe | [L5], [L6], PLAN [R34] | The current design is the mainstream one. Nearest-centroid on the same features is the usual alternative and performs about the same; plain nearest-neighbour is worse [L7] |
| Gaussian discriminant vs logistic regression | [L8]*, [L9]* | Same linear boundary. When the Gaussian assumption holds, LDA gets there with fewer samples (logistic regression is about half to two-thirds as efficient); when it does not, logistic regression is safer. Neither can find a signal the other cannot |

Reading: the choice among linear classifiers moves the result by less than the noise of our evaluation. A non-linear classifier has more freedom than 7 images per class can constrain.

## 3. Alternative models, one by one

Rule 2 allows only a linear or nearest-centroid model on named features or on principal components of frozen features, with readable reasons. That rule alone removes most of this table; the last column says whether the option would be worth it without the rule.

| Model | Allowed by Rule 2 | Can it be estimated at n = 31 (7 / 7 / 17)? | Expected gain | Verdict |
|---|---|---|---|---|
| **LDA with shrinkage** (one shared covariance, Ledoit–Wolf) [L10]*, [L11]* | Yes (linear) | Yes in the 10-component space; the covariance has 55 entries from 28 degrees of freedom, so it needs the shrinkage | Accuracy: none expected [L8], [L9]. Side benefit: the same model gives a class probability **and** a distance to each batch | Not before the freeze. After it: the best fix for the familiarity distance (section 7.1) |
| **Nearest shrunken centroid** [L12]* | Yes | Yes | None expected. It selects features, which reads well, but the selection is unstable at n = 31 | No |
| **Gaussian naive Bayes** | Yes (linear if variances are shared) | Yes | Worse: the 10 components are not independent within a class | No |
| **QDA, or a Gaussian mixture per class** [L13]* | No (curved boundary) | No. A 10 × 10 covariance per class from 7 images is singular | – | No |
| **Gaussian process classifier, linear kernel** [L14]* | Yes: it is Bayesian logistic regression with a Gaussian prior [L15]* | Yes | Same boundary as today. Posterior probabilities are wider at small n, which is honest but does not sort right from wrong calls any better | Not before the freeze. A reasonable later replacement for temperature scaling |
| **Gaussian process classifier, RBF or deep kernel** [L16], [L17] | No | Kernel length-scales are not identifiable from 31 points; the few-shot GP papers learn the kernel on thousands of other tasks first, which we do not have | – | No |
| **Gaussian mixture on tiles** (unsupervised "tile types", then shares per image; Fisher vectors or VLAD) [L18], [L19] | Yes: the classifier on the shares stays linear | Yes: about 1,700 tiles, no labels used | Unknown. It changes the *features*, not the classifier: it lets a rare kind of region count, which the mean over tiles hides | The one Gaussian idea that targets the signal. After the freeze (section 7.2) |
| **TabPFN** (tabular foundation model) [L20], [L21] | No (black box, no coefficients) | It runs on 31 rows × 10 columns | Its benchmarks start well above our size; nothing suggests a gain at 7 per class, and it has no readable reasons | No |
| **SVM, random forest, boosting, small neural net** | No | Overfit at this size | – | No |
| **Attention-based multiple-instance learning on tiles** [L22] | No | The attention weights overfit even at hundreds of slides; we have 14 "bags" for the hard question. Tile-level training with a vote was tried: 0.50–0.64 | – | No |
| **Transductive methods** (use the unlabelled test images, assume balanced classes) [L23], [L24] | – | – | They help only when the class balance of the test set is known and hurt when it is not [L23]. Same conclusion as PLAN §1.3 on `--balanced` | No, unless the split is confirmed |

So: nothing here should be tried before the freeze. Two Gaussian ideas are worth doing afterwards, and both are about the representation and the distance, not about the decision boundary.

## 4. Where the signal could come from: literature on representations

| Topic | Source | Finding | For us |
|---|---|---|---|
| General vision models on electron microscopy | [L25] | DINOv2, DINOv3 and OpenCLIP work well inside one EM dataset, and break down across two EM datasets that look alike to the eye: "a pronounced and persistent domain mismatch" | Frozen DINO features are sensitive to acquisition differences that a person does not see. This is the imaging-confound risk (MODEL.md §11), now with a source |
| DINOv3 | PLAN [R38], [L26] | Better dense (patch-level) features than DINOv2; already used to embed SEM micrographs in real time [L26] | One try after the freeze, as already planned. Patch-level use matters more than the model swap (section 7.2) |
| Models pretrained on micrographs | [L27] | Encoders pretrained on 100,000+ micrographs (MicroNet) generalise better than ImageNet ones to "different imaging and sample conditions" and with very few training images. Weights are public | The most relevant alternative backbone: its stated advantage is exactly our confound. One try after the freeze |
| SEM-specific foundation model | [L28] | A self-supervised transformer trained on multi-instrument SEM images (April 2026). Shown for defocus correction. No released weights found | Not usable today |
| EM foundation model (EM-DINO) | [L29] | DINOv2-style, 5 million images, public weights, **biological tissue only** | Not a fit |
| Polaron's HR-Dv2 | [L30] | Upsampled DINOv2 features for materials segmentation | Rule 1: not used. Listed because the organisers may have clustered images with something like it |
| Texture features from pretrained networks, pooled as "visual words" | [L18], [L19] | For steel micrographs, VLAD or Fisher-vector pooling of local features beat whole-image features, and generalised better between datasets | Supports pooling tiles into "tile types" instead of a mean (section 7.2) |
| Patch-level nearest-neighbour anomaly detection | PLAN [R14], [L31] | A memory bank of normal patches; a test image is scored by how far its most unusual patches are from it. State of the art with 1–16 normal images, no training | A better "is it Batch_3 or not" distance than the mean-feature RMS z, and it gives a heatmap of *where* (section 7.1) |
| Scattering transforms | [L32]*, [L33] | Fixed wavelet features, stable to small deformations, strong for texture with little data | A possible replacement for LBP/GLCM with a built-in scale. Low priority: it does not address noise sensitivity by itself |
| Two-point statistics, particle embeddings | PLAN [R12], [R35] | Tried, negative | – |
| Battery electrodes | [L34], [L35], [L36] | Recent work links FIB-SEM descriptors to process parameters across lab and pilot electrodes, with trained segmentation; open multi-modal battery image libraries now exist. Nothing found on sorting Si–graphite batches from 2D sections | Our problem is not covered by a ready method. The open libraries are a source of truly foreign images for testing *unfamiliar* (section 7.1) |

Two things follow.

- **A bigger or newer backbone is a lottery ticket, not a plan.** Each one is another entry in the best-of-list. The only ones with an argument behind them are MicroNet (robust to imaging conditions) and DINOv3 (patch features).
- **The pooling is a more likely weak point than the backbone.** Today each image is the mean and SD over about 45 to 60 tiles, then 10 principal components fitted on about 29 images. Principal components keep the directions in which images differ most, and PLAN §1.2 says that is the strip (72% of the variance for `si_graphite_ratio`), not the batch. Three adjacent images of strip 2080 sit in three different batches, so whatever the organisers sorted on changes over one image width. A mean over the whole image is the worst summary for that.

## 5. The two checks, sharpened

These are the two items the remaining time should go to. Both are **diagnostics**: they do not add a model to the best-of-list.

### 5.1 The normalisation check: test noise and sharpness, not brightness

What §4 step 2(b) says: stretch each detector image p1–p99, recompute `tex_`, rerun `--evaluate`.

Why that cannot answer the question (from `qc/features.py`):

| Feature | What the code does | Effect of a p1–p99 stretch |
|---|---|---|
| LBP histograms (the top-ranked features, e.g. `tex_etd_lbp6`) | Each pixel is compared with its 8 neighbours; only "brighter or not" is kept | None. Any brightness or contrast change that keeps the order of grey levels leaves every LBP code unchanged, apart from the 2% of pixels the stretch clips |
| GLCM | Subtracts the black level, divides by the 99.5th percentile, quantises to 32 levels | Almost none. This already is a stretch |

So the check would report "the Batch_3-vs-rest signal holds after normalisation" whatever its cause, and that would be read as "material, not microscope". It is not a test.

What the texture features *are* sensitive to: **noise and sharpness**. They are computed at 0.05 µm (two pixels), on an image that is subsampled by taking every second pixel without averaging, so detector noise passes through in full. This matches what was measured: the leading texture features correlate with `img_bse_noise` (|r| 0.6–0.9), and ETD sharpness differs between Batch_1 and Batch_2 (2,126 against 1,748).

Proposed replacement, cheapest first:

| # | Check | How | Reads as |
|---|---|---|---|
| a | **Run the model on the negative controls** | `qc/controls.py` already makes Batch_3 copies, in all three detectors, with Gaussian noise σ = 5, brightness ±20%, contrast ±20%, black level +20 and curtaining. Add a blurred copy (Gaussian σ ≈ 1 px) for sharpness. Compute features for each copy and predict with the model that is about to be frozen. Nothing is tuned on the outcome | If the noise or blur copy moves a Batch_3 image to "not Batch_3", the first stage reads the microscope. Brightness and contrast copies should not move `tex_` at all (a sanity check of the table above) |
| b | **Equalise, then re-evaluate** | Recompute `tex_` after 2 × 2 block averaging (halves the noise) and at a coarser step (LBP radius and GLCM distance ≥ 0.2 µm). Rerun the Batch_3-vs-rest LOSO | If 0.88 falls towards the null (0.74), or the correlation with `img_bse_noise` stays high, the signal is acquisition |
| c | **Does imaging explain the texture?** | Inside each fold, regress the top texture features on the imaging descriptors and classify on the residuals | Signal left in the residuals is not explained by the measured imaging differences |
| d | Same three for `deep_` | The deep features are stretched and block-averaged already, but DINO features are not invariant to noise or blur [L25] | Same reading |

Notes from the literature:

- The standard cure in image-based cell profiling, where the same problem is called batch effect, is to learn the correction from **controls only** (typical-variation normalisation: whiten using the control wells) [L37]. Our equivalent of "controls" is the baseline, Batch_3. A recent benchmark found simple linear corrections competitive and the best methods only moderately better [L38].
- Corrections that are fitted **using the class labels** in an unbalanced design inflate the apparent group difference [L39]*. Any correction must be label-free and fitted inside the fold. ComBat-style harmonisation [L40]* with the strip as "site" is not usable here: 8 of 13 strips sit in one batch only, so strip and batch cannot be separated.
- If the check fails and there is time, the fix that keeps logistic regression is augmentation: add noise-, blur- and gain-perturbed copies of each training image (same label, same strip group) so the model learns to ignore those directions. Feature-space augmentation helps few-shot linear probes on frozen features [L5]. A closed-form alternative removes the directions that predict the imaging descriptors [L41]. Either is one new entry in the list.
- Whether a microscope signal would *hurt the score* is a separate question. If the unseen images come from the same sessions, it would still sort them. It would make the "why" wrong, and the explanation is judged.

### 5.2 The shared-strip comparison: use the same-batch pairs as the yardstick

The layout, from the image heights:

| Strip | Batch_1 | Batch_2 | Batch_3 |
|---|---|---|---|
| 2080 | `ffwubibz` | `r17byphk` | `cfe5vt7s` |
| 2148 | `f1vzngrs` | `epqdaau9` | – |
| 2156 | `fzrt2k6r` | `b3esycq1` | – |
| 2068 | – | `rxax5ozo` | 3 images |
| 2272 | – | `i9jiqjwl` | `pl8uabbv` |

- Batch_1 vs Batch_2 inside a shared strip: **3 pairs, one image against one image.**
- Pairs of images from the same strip **and the same batch**: 18 (16 in Batch_3 across strips 1612, 1904, 2060, 2068 and 2088; one in Batch_1, strip 2316; one in Batch_2, strip 2048).
- Other cross-batch pairs inside a strip: 5 for Batch_2 vs Batch_3, 1 for Batch_1 vs Batch_3.

Why "list the features that differ in the same direction in all three" is too weak:

- With 3 pairs, a feature with no signal has the same sign in all three with probability 2 × (½)³ = 25%. Of 180 material features, about 45 will pass. A sign test on 3 pairs cannot go below p = 0.25.
- Any two images differ. The question is whether a Batch_1/Batch_2 pair differs **more than two neighbouring images of one batch do**.

Proposed design:

| Step | What | Why |
|---|---|---|
| 1. Distance test | For a representation fixed in advance (the 10 deep components; the standardised material features), compute the distance between the two images of every same-strip pair. Compare the 3 Batch_1/Batch_2 distances with the 18 same-batch distances by rank | If all 3 exceed all 18, the exact p is 1 / C(21, 3) = 1 / 1,330. Conservative version, one value per strip (3 against 7 strips): 1 / 120. Either is far below what the 14-image classifier test can reach |
| 2. Reading a "no" | If the 3 cross-batch pairs sit inside the same-batch range | Inside a strip, the folder label is not visible in that representation. Batch_1 vs Batch_2 then rests on the strips unique to each folder (2316, 1780, 1880 against 2048), which is strip identity. Stop searching and present the lean as a lean |
| 3. Reading a "yes" | Per feature: the three signed differences, each divided by the SD of that feature's same-batch pair differences. Keep features with the same sign in all three **and** each beyond about 2 SD | The same-batch pairs give the scale that the sign rule lacks |
| 4. From features to a model | At most three named features, chosen before any LOSO run, as the `stage_variation` family. One LOSO run, one entry in the best-of-list | Keeps the selection out of the accuracy estimate as far as 3 pairs allow. The three pairs were used to choose the features, so the honest number comes from the strips that were *not* used: say so next to it |
| 5. Extend | Repeat step 1 for Batch_2 vs Batch_3 (5 pairs) | A positive control for the method: Batch_3-or-not is known to be detectable, so these pairs should stand out. If they do not, the pair test is too blunt and a "no" in step 2 means less |

Caveats to state with the result:

- The same-batch pairs share images (strip 2060 gives 6 pairs from 4 images) and 16 of 18 are Batch_3. The rank p is indicative. The per-strip version is the one to quote.
- Difference grows with distance along a strip. The 2080 images join edge to edge, which is the closest possible, so for that strip the test is conservative. Positions inside the other strips are not known.
- Exchangeability holds within a strip, not across strips; this is the restricted-permutation setting of [L42].
- Look at the pairs by eye first, as planned. The measured test is what turns an impression into a number.

A tile-level refinement, only if step 1 is unclear: compare the two sets of tile embeddings of a pair with a kernel two-sample statistic [L43], [L44], [L45], and use the same statistic on the same-batch pairs as its null. Tiles of one image are not independent, so the statistic's own p-value must not be used; only its rank among the same-batch pairs.

## 6. Which model to freeze

| | Flat `deep` | Staged `material > deep` |
|---|---|---|
| LOSO, three-way (null p95) | 0.64 (0.54) | 0.66 (0.51) |
| Rehearsals, mean ± SD | 0.63 ± 0.12 | 0.55 ± 0.16 |
| Right per tier, high / medium / low | 67% / 67% / 60% | 91% / 62% / 40% |

- **Accuracy does not separate them.** A gap of 0.08 between rehearsal means with a per-draw SD of 0.12–0.16 on overlapping draws is inside the noise [L1]; LOSO has them the other way round.
- **The tiers do.** 32 of 35 against 42 of 105 is a real ordering, even allowing for the draws sharing images. The flat model's tiers carry no information.
- Both the call and the confidence are judged, and the confidence is where the two differ. **Freeze the staged model.**
- **Condition:** its first stage is the material families, and their Batch_3 signal comes from texture (0.88 for texture alone, 0.85 for all material features): the same features section 5.1 puts in doubt. Run check 5.1(a) first; it needs no refit. If a noise or blur copy flips Batch_3 images, the staged first stage is reading the microscope, and the fallback is flat `deep` with its tiers described as uninformative.
- Do not build the third option (staged confidence with the deep call). It is a new model with no rehearsal record.

On the tier records of the fitted model (7 of 9, 6 of 12, 8 of 10): the 95% intervals are 40–97%, 21–79% and 44–97%. They overlap almost completely. With about ten calls per tier, no calibration method can show tiers to be honest or dishonest; calibration error itself cannot be estimated reliably from so few points [L46]. Show the record as counts, as now, and say that the ordering is established for the staged model only through the rehearsals.

## 7. After the freeze, or if the true labels of the unseen images arrive

In order of expected value. None of it is needed for the judged test.

### 7.1 A better familiarity distance (known weakness: flags 1 of 14)

Today: RMS of per-feature z-scores against Batch_3's strip segments. Averaging over all features dilutes the few that differ, and ignores that features move together.

| Option | What | Source |
|---|---|---|
| **Shrinkage Mahalanobis in the component space** | One Gaussian per batch with a shared, shrunk covariance in the 10 components; distance to each batch centre. PLAN §13 notes Mahalanobis is not estimable with 170 features and 7 segments; in 10 components with shrinkage it is. This is the LDA model of section 3 used as a distance | [L10]*, [L47]* |
| Relative Mahalanobis | Subtract the distance under one Gaussian fitted to all images. Removes the directions in which every image varies (the strip directions) | [L48] |
| Normalise the feature length first | L2-normalising embeddings before the Mahalanobis distance improved it across 44 models; the best normalisation depends on the feature geometry | [L49], [L50] |
| **Patch-level nearest neighbour** | Memory bank of Batch_3 tile (or patch) embeddings; score an image by the mean distance of its most unusual 1% of patches. Training-free, and the per-patch distances are a "where it differs" heatmap, which is on the cut list today | PLAN [R14], [L31] |
| k-nearest-neighbour distance on image embeddings | No Gaussian assumption | [L51] |
| **A truly foreign test set** | *Unfamiliar* has never fired on a foreign image. Open battery image libraries (NMC cathodes, FIB-SEM) give free positives | [L36] |

The threshold for any of these stays as today: the baseline's own held-out distances. Whitening by the baseline's covariance is the same idea as typical-variation normalisation [L37], with Batch_3 as the controls.

### 7.2 Pooling that lets a local feature count

| Option | What | Source |
|---|---|---|
| Tile types | Fit a small Gaussian mixture or k-means on all tile embeddings without labels (k about 8); describe each image by the share of each tile type and by the share of its rarest types. Linear model on the shares. Each type can be shown as example tiles, which is also the example-based explanation on the open list (MODEL.md §9.4) | [L18], [L19], PLAN [R37] |
| Quantiles instead of mean and SD | p10 / p90 over tiles for each of the 10 components | – |
| Components fitted on tiles, not images | About 1,700 tiles instead of 29 images: more stable components, and not dominated by strip means | – |
| Down-weight the strip directions | Estimate, from Batch_3 alone, the directions in which its strips differ from one another, and remove the top 2–3 before the logistic fit. Uses no Batch_1 or Batch_2 label. Risk: batches here are built from strips, so a strip direction may also be a batch direction | [L37], [L47]* |

### 7.3 Backbones (one try each, against the best-of-list null)

MicroNet-pretrained encoder [L27]; DINOv3 [R38]. ETD and one-model-per-detector stay on the list of PLAN §4 step 2 only if the acquisition check of section 5.1 is passed for ETD.

### 7.4 Confidence

- Venn–Abers calibration for the first stage (Batch_3 or not, 31 out-of-fold points): it returns a probability interval that widens when the calibration set is small, which is the honest statement at this size [L52]*, [L53].
- Cross-conformal instead of split conformal: uses every image for both fitting and calibration [L54], [L55]. The current sets already cover 89% at about two batches per set, so the gain is small.
- Bayesian logistic regression with a weakly informative prior instead of a tuned `C` [L15]*: removes the inner loop that picked `C` = 0.01 and flattened every probability to 0.34 in one dry run.

### 7.5 More labelled images

Still the real limit (PLAN §4 step 10). Seven images per class is below the size at which any method in this review reports results.

## 8. Materials view: what the micrographs show, and the next steps

Added after looking at the images themselves (every strip, all three detectors, quarter scale and full-resolution crops) and after checks on the measured tables in `out/`. Three questions were put to the mentors in an earlier draft; no answer is coming, so section 8.2 gives a best judgement on each with its evidence and a confidence. Sources for this section are `[M1]`…`[M7]` in section 9.

### 8.1 What the electrode is

| Observation | Reading |
|---|---|
| Flat, plate-like graphite particles 10–35 µm long, lying mostly horizontal, dense inside with a few slit cracks along the layers | Flake-type graphite in a calendered coating. Agrees with "particles about 30 µm" (PLAN §1) |
| Bright particles in BSE are angular shards, uniform inside | Milled micro-silicon material. The glassy, sharp-edged fracture shape is typical of milled SiOx, but Si cannot be excluded without EDS (PLAN §10 Q9) |
| A minority of bright particles are speckled or pitted inside, some with a grey rim | Present in all three batches |
| Fine "lace" between particles: nanoporous grey material with bright edges | Carbon-additive and binder domain. Today it is split between pore and graphite; `BINDER` only means thin bright rims |
| At full resolution (25 nm) the BSE image is grainy | Shot noise. Texture at 2 pixels measures the detector, not the material. Material texture starts at about 0.2–0.5 µm. Supports section 5.1 |
| Smooth grey shapes inside pores | The back wall of open pores seen through the cut. Known FIB-SEM artefact; why porosity is "apparent" |

Between Batch_1 and Batch_2 inside strips 2148 and 2156, **I see no material difference in any detector**. Those two pairs look like neighbouring pieces of one coating, which is what they are.

### 8.2 Best judgement on the three open questions

#### Q1. Are the electrodes pristine or cycled?

**Judgement: pristine (made, calendered, never cycled) for 12 of the 13 strips. Confidence about 85%. Strip 2316 is the exception and is either cycled or made with a different silicon material; the data cannot tell which.**

| Evidence | What it shows |
|---|---|
| Silicon particles are dense, sharp-edged and crack-free. Median internal void fraction is 0.0000 in every strip but 2316 | Silicon that has been lithiated even once swells and cracks, and the cracks remain: SiOx particles above a few µm crack during the first lithiation [M1], and repeated cycling leaves porous, SEI-covered particles [M2] |
| Silicon size is the same in every strip (number-median 2.3–2.7 µm) and its BSE brightness sits at 1.8–2.2 × graphite | No swelling and no loss of brightness. Lithium lowers the average atomic number, so lithiated silicon is much dimmer |
| Pores are open and empty: no salt residue, no film bridging particles, no plated lithium | A cell-harvested electrode shows electrolyte residue and SEI unless washed, and washing does not undo silicon damage |
| Strip 2316: **every** silicon particle, at every size, is dimmer (1.6 × graphite against 2.0–2.1), grainier (texture 0.18–0.21 against 0.14–0.16) and more ragged (solidity 0.74–0.83 against 0.87–0.91). Silicon area is 2.2 times the others, the pores hold much more lace, and the graphite shows layer lines | The whole silicon population differs, not an added second population. One cause that explains all five signs is cycling (swollen, porous silicon; SEI in the pores; expanded graphite). A different product (porous silicon–carbon composite at a higher loading, with more carbon additive) explains them too, but needs several changes at once. Lean: cycled or aged, about 60 / 40 |

Consequence: the "indicative consequences" of PLAN §3.8 (capacity, swelling) apply as written to the 12 pristine strips. For strip 2316 say "a different silicon population", never "more silicon": if it is swollen, the *amount* of silicon is not higher. Batch_1's high silicon content (8.3 area %, 6.3 without 2316) should therefore not be explained as a recipe difference.

#### Q2. What is black versus grey graphite in InLens, and does it count as a batch difference?

In InLens, each graphite particle is either mid-grey or almost black. Three patterns occur: all grey (strips 2148, 2156, 2088, 2272, 1780, 1880, 2316), a band of black particles under the top surface (2080, 2048, 2068), and nearly all black (2060, 1612; darker overall in 1904).

A quick measurement on all 31 images (quarter scale; graphite = BSE near the graphite peak; "dark" = InLens under 55 grey levels after black subtraction; throwaway script, not in the repo):

| | Share of graphite that is dark in InLens, per image |
|---|---|
| **Batch_1** (7) | 0.01, 0.01, 0.02, 0.03, 0.04, 0.05, 0.05 |
| **Batch_2** (7) | 0.00, 0.01, 0.01, 0.14, 0.15, 0.15, 0.28 |
| **Batch_3** (17) | 0.00 to 0.80; six images above 0.6 |

Inside strip 2080 it is the one visible difference between the three adjacent images: 0.04 (Batch_1), 0.15 (Batch_2), 0.13 (Batch_3). Inside strips 2148 and 2156 both batches are at 0.01–0.02.

**Judgement: it is electrical (surface-potential) contrast, an imaging effect of how well each region of graphite is grounded under the beam. It is not state of charge and not composition. Confidence about 75%. It should not count as a material batch difference: treat it as an imaging-sensitive quantity.**

| Evidence | What it rules in or out |
|---|---|
| Silicon is the same in dark and grey regions and strips: same size, texture, voids (section Q1) | **Rules out state of charge.** Silicon takes up lithium at a higher potential than graphite, so any electrode with lithiated graphite has heavily lithiated, swollen, dim silicon. A lithiation front would look just like this band (it starts at the separator side [M3]), which is why the silicon check matters |
| In InLens only the graphite turns dark; silicon in the same zone does not (0.30 × for graphite, 1.0–1.8 × for silicon) | A property of the conducting phase, as expected for a potential difference. InLens detectors image work-function and surface-potential differences [M4]; regions with a different connection to ground appear darker or brighter, the basis of voltage-contrast imaging [M5], [M6] |
| In the dark zones BSE is also lower, by about 15% for graphite **and** about 25% for silicon | **Rules out composition.** A change in the graphite would not dim the silicon next to it. A zone-wide loss of signal is an imaging effect (charging or shading) |
| Whole strips are in one state, and the share correlates with the acquisition descriptors: r = 0.81 with the InLens black level, 0.82 with the BSE black level, −0.84 with InLens median brightness | Across strips it follows the imaging session. Strip 2060 is the known imaging outlier (PLAN §1.1). Low-voltage secondary-electron contrast depends strongly on voltage and charging [M7] |
| Inside one image it forms a band under the top surface that fades sideways (strip 2080) | Within an image it follows the sample: which part of the coating has a good path to ground. That part may reflect the electrode's conduction network, or simply how the sample was mounted. It cannot be separated with these images |

What is left unexplained: a few particles show a diffuse gradient inside one particle, which a pure "one particle, one potential" picture does not give. Fields from neighbouring charged binder can do this; it does not change the judgement.

What it means for the model:

| Finding | Consequence |
|---|---|
| The first principal component of the deep features (22% of their variance) correlates −0.75 with the dark share | **The `deep_` family reads this to a large extent.** It explains why InLens DINOv2 was the only family above its null, and probably the deep components that had "no named feature moves with it" |
| An earlier status note suspected a confound through the InLens black level | Confirmed, and wider than a black level: it is the graphite's InLens state. The p1–p99 stretch does not remove it |
| "Dark share under 0.1" sorts Batch_1 from Batch_2 for 11 of 14 images, the same as ETD | Not established (one more try, and nothing in strips 2148 and 2156). But it is likely what the deep model's Batch_1/Batch_2 lean rests on |
| Batch_3 spans the whole range | It does not help "Batch_3 or not" |

So: **keep it in the call, take it out of the material claims.** The deep model already uses it and scores above its null with it; if the held-back images were taken in the same sessions, it will go on sorting them. But a reason such as "InLens texture pattern …" must not be presented as a property of the material. The honest sentence is "its InLens image shows no dark-graphite zones, like every Batch_1 image; this is an electrical imaging contrast, not a composition difference".

#### Q3. Is the top the electrode surface and the bottom the copper foil?

**Judgement: yes. Confidence about 95%.**

| Evidence | Images |
|---|---|
| Above the cut face, the free top surface of the coating is seen in perspective (rounded, uncut particle surfaces receding behind the cut) | `cfe5vt7s`, `i9jiqjwl`, partly `x7u69zsw` |
| A flat, saturated-bright band along the bottom edge, brighter than silicon: the copper foil | `epqdaau9` (19% of its bottom rows; no other image shows it) |
| Thick, smooth, bright coatings inside the pores near the bottom: material redeposited during ion milling, which collects at the bottom of a cut | `ufdvpb81`, `hzumfsms` |
| Graphite flakes lie flat | Calendering presses along the vertical |

Consequences:

- Vertical is through-thickness, so the `reg_` slope and top/bottom features are through-thickness gradients, which is what binder migration and calendering produce. This closes PLAN §10 Q11.
- **Most images are cropped inside the coating**: only one shows the foil and two or three the surface. The image height is therefore a crop, not the coating thickness; the coating is at least about 55–58 µm thick. Another reason never to use the height.
- The top and bottom 5% hold surface, foil and redeposited material in several images. Cutting them is right (PLAN §10 Q17).

### 8.3 What this says about the batches

| Batch | What is different, in material terms | Basis |
|---|---|---|
| Batch_3 (baseline) | A wide baseline: silicon 6.2 ± 1.1 area %, pristine | 17 images, 7 strips |
| Batch_1 | Contains a different silicon population (strip 2316, 2 of 7 images: dimmer, grainier, more ragged particles at 12–15 area %, possibly a cycled electrode). The other five images match the baseline's composition. Most variable batch | 7 images, 6 strips |
| Batch_2 | Composition like the baseline (5.7 against 6.2 area %); no material difference found | 7 images, 6 strips |
| Imaging, reported apart | No InLens-dark graphite in any Batch_1 image; present in 4 of 7 Batch_2 images and across the whole range in Batch_3 | section 8.2 Q2 |

- **"What is different" (question A) has a better answer at batch level than any per-image call can give.** Batch_1's difference is in *spread* and in *particle type*, not in the mean. The comparison in `qc/decide.py` tests means; the odd-unit check and the type shares are what catch Batch_1. Say this in the explanation.
- **For an image from a coating that sits in both folders (2148, 2156), Batch_1 against Batch_2 is a coin flip by construction.** The prediction set is the honest output.
- Report a **variance ratio against the baseline** per key quantity next to the mean difference (Batch_1's silicon SD is 3.4 times the baseline's). A manufacturer treats a batch that is on target on average but inconsistent as a different batch.
- **The material evidence for a Batch_1 / Batch_2 difference is thin.** What separates them in our model is mostly an imaging contrast. Present the lean as a lean.

### 8.4 Measurements a materials scientist would add (after the freeze)

1. **Dark-graphite share in InLens** as a named **imaging** descriptor (whole image and top third), next to the black level and noise in `imaging()`. It makes the deep model's reasons readable and lets "imaging changed" fire on it.
2. **Binder and carbon-additive lace as its own phase**: area share, and its through-thickness gradient (the signature of binder migration during drying).
3. **Silicon particle classes by rule, not by mixture fit**: dense shard; speckled or porous; dim and ragged (the 2316 kind, from brightness under 1.75 × graphite and solidity under 0.85). Report the share of each.
4. **Horizontal cracks and layer separation**: long, thin, horizontal pores.
5. **Texture at 0.2–0.5 µm after averaging**, replacing the 2-pixel scale.

### 8.5 Next steps, in order

The submission is due Sunday 4 Oct, 14:45. Steps 1–4 are for tonight, before the freeze. No step waits for a mentor.

| # | Step | Time | Done when |
|---|---|---|---|
| 1 | **Noise check on the model that is about to be frozen** (section 5.1 a): predict on the existing noise control and on a blurred copy of the Batch_3 images. This replaces §4 step 2(b) | 30 min | Number of Batch_3 images that change their call |
| 2 | **Measure how much the model leans on the dark-graphite contrast.** Compute the dark share for the 31 images with the real graphite mask; correlate it with the model's ten deep components; rerun the deep LOSO once with the dark share regressed out of the deep components inside each fold. This is a diagnostic, not a new model. Drop §4 step 2(c) and 2(d): they are blind tries and each one raises the bar (section 2.1) | 45 min | Two numbers: the correlations, and the LOSO accuracy with the contrast removed against its null |
| 3 | **Pair test** on the three Batch_1/Batch_2 pairs against the 18 same-batch pairs (section 5.2), for the deep components. From the images, expect a "yes" for 2080 only, through the dark band | 30 min | One number. Then stop the Batch_1/Batch_2 search |
| 4 | **Freeze.** Staged model if step 1 passes, flat `deep` if not. Do **not** add the dark share as a material feature and do not remove it from the deep features: the call stays as rehearsed. Tag, then score the 3 dropped samples once (PLAN §4 steps 4–5) | 45 min | `rules-frozen` exists; the result is committed |
| 5 | **Fix the wording of the reasons.** Any reason carried by a deep InLens component that correlates with the dark share reads: "InLens image shows / does not show dark-graphite zones; an electrical imaging contrast, not a composition difference". After the freeze this is text only | Morning | No InLens reason is worded as a material property |
| 6 | **Write the batch statements of section 8.3 into the pitch and the "What's different" view**: Batch_1 holds a different silicon population and is the most variable; Batch_2 is not materially different from the baseline in anything we measure; the imaging difference is shown apart. Use the strip 2080 InLens image and a strip 2316 BSE image as the two pictures | Morning | A judge can read what differs without code names |
| 7 | **State the three judgements of section 8.2 as assumptions** in the README and the pitch, each with its confidence: pristine electrodes except strip 2316; InLens dark graphite is imaging; top is the surface, bottom the foil | Morning | Listed under the limits we state |
| 8 | Rehearse the last-minute images, submit (PLAN §4 steps 7–9) | Morning | Submitted before 14:45 |
| 9 | After the submission: section 8.4 in its order, then section 7 | – | – |

Stop rules, fixed now:

- If step 1 shows the first stage reads noise, do not repair the texture features tonight. Fall back to flat `deep`.
- If step 2 shows the deep model falls to its null without the contrast, do not change the model. Say next to every call that the Batch_1/Batch_2 lean rests on an imaging contrast, and expect it to hold only if the held-back images come from the same sessions.
- Nothing found after the freeze changes the model. It can change the explanation text.

## 9. References

Read at abstract or search-summary level on 3 Oct 2026, unless marked *. * = cited from prior knowledge (title, venue or link not reopened today); check before quoting in the submission. `[R…]` numbers refer to PLAN §14.

**Small samples, selection, testing**

- **[L1]** G. Varoquaux, "Cross-validation failure: small sample sizes lead to large error bars," *NeuroImage* (2018). https://arxiv.org/abs/1706.07581
- **[L2]** G. C. Cawley, N. L. C. Talbot, "On over-fitting in model selection and subsequent selection bias in performance evaluation," *JMLR* 11 (2010). https://www.jmlr.org/papers/v11/cawley10a.html
- **[L3]** M. Ojala, G. C. Garriga, "Permutation tests for studying classifier performance," *JMLR* 11 (2010). https://www.jmlr.org/papers/v11/ojala10a.html
- **[L4]** P. Golland, B. Fischl, "Permutation tests for classification: towards statistical significance in image-based studies," *IPMI* (2003). https://nmr.mgh.harvard.edu/~fischl/reprints/golland-fischl-ipmi03.pdf
- **[L42]** A. M. Winkler et al., "Multi-level block permutation," *NeuroImage* 123 (2015). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4644991/

**Classifiers on frozen features**

- **[L5]** A. Bär, N. Houlsby, M. Dehghani, M. Kumar, "Frozen feature augmentation for few-shot image classification," *CVPR* 2024. https://arxiv.org/abs/2403.10519
- **[L6]** M. Oquab et al., "DINOv2: learning robust visual features without supervision" (2023). https://arxiv.org/abs/2304.07193
- **[L7]** "FungiTastic: a multi-modal dataset and benchmark for image categorization" (2024): centroid prototypes on DINOv2 embeddings beat nearest-neighbour in its few-shot baselines. https://arxiv.org/abs/2408.13632
- **[L8]*** B. Efron, "The efficiency of logistic regression compared to normal discriminant analysis," *JASA* 70 (1975).
- **[L9]** A. Y. Ng, M. I. Jordan, "On discriminative vs. generative classifiers: a comparison of logistic regression and naive Bayes," *NeurIPS* 2001. https://papers.nips.cc/paper/2001/hash/7b7a53e239400a13bd6be6c91c4f6c4e-Abstract.html
- **[L10]*** O. Ledoit, M. Wolf, "A well-conditioned estimator for large-dimensional covariance matrices," *J. Multivariate Analysis* 88 (2004).
- **[L11]*** J. H. Friedman, "Regularized discriminant analysis," *JASA* 84 (1989).
- **[L12]*** R. Tibshirani et al., "Diagnosis of multiple cancer types by shrunken centroids of gene expression," *PNAS* 99 (2002).
- **[L13]*** T. Hastie, R. Tibshirani, J. Friedman, *The Elements of Statistical Learning*, 2nd ed., ch. 4 (2009).
- **[L14]*** C. E. Rasmussen, C. K. I. Williams, *Gaussian Processes for Machine Learning*, ch. 3 (2006). https://gaussianprocess.org/gpml/
- **[L15]*** A. Gelman et al., "A weakly informative default prior distribution for logistic and other regression models," *Ann. Appl. Stat.* 2 (2008).
- **[L16]*** M. Patacchiola et al., "Bayesian meta-learning for the few-shot setting via deep kernels," *NeurIPS* 2020. https://arxiv.org/abs/1910.05858
- **[L17]*** J. Snell, R. Zemel, "Bayesian few-shot classification with one-vs-each Pólya-Gamma augmented Gaussian processes," *ICLR* 2021. https://arxiv.org/abs/2007.10417
- **[L20]** N. Hollmann et al., "Accurate predictions on small data with a tabular foundation model," *Nature* (2025). https://pmc.ncbi.nlm.nih.gov/articles/PMC11711098/
- **[L21]** "TabPFN-2.5: advancing the state of the art in tabular foundation models" (2025). https://arxiv.org/abs/2511.08667
- **[L22]** "Attention-challenging multiple instance learning for whole slide image classification" (2023–2024): attention concentrating on few instances is tied to overfitting. https://arxiv.org/abs/2311.07125
- **[L23]** O. Veilleux et al., "Realistic evaluation of transductive few-shot learning," *NeurIPS* 2021. https://arxiv.org/abs/2204.11181
- **[L24]** "UNEM: unrolled generalized EM for transductive few-shot learning" (2024). https://arxiv.org/abs/2412.16739

**Representations for microscopy and microstructure**

- **[L18]*** B. L. DeCost, T. Francis, E. A. Holm, "Exploring the microstructure manifold: image texture representations applied to ultrahigh carbon steel microstructures," *Acta Materialia* (2017). https://arxiv.org/abs/1702.01117
- **[L19]** J. Ling et al., "Building data-driven models with microstructural images: generalization and interpretability," *Materials Discovery* (2017). https://arxiv.org/abs/1711.00404
- **[L25]** C. Fuster-Barceló, V. Uhlmann, "Are vision foundation models foundational for electron microscopy image segmentation?" (Feb 2026). https://arxiv.org/abs/2602.08505
- **[L26]** K. Zhang et al., "AutoRASOR: autonomous rapid scanning electron microscope operator" (Sep 2026). https://arxiv.org/abs/2609.22411
- **[L27]** J. Stuckner et al., "Microstructure segmentation with deep learning encoders pre-trained on a large microscopy dataset," *npj Computational Materials* 8 (2022). https://doaj.org/article/1eb773be5b9248779f3f5771769d1e3a
- **[L28]** S. M. Ahmed et al., "A mixture of experts foundation model for scanning electron microscopy image analysis" (Apr 2026). https://arxiv.org/abs/2604.05960
- **[L29]** L. He et al., "Unifying the electron microscopy multiverse through a large-scale foundation model" (EM-DINO), bioRxiv (2025). https://www.biorxiv.org/content/10.1101/2025.04.13.648639v4.full
- **[L30]** R. Docherty et al., "Upsampling DINOv2 features for unsupervised vision tasks and weakly supervised materials segmentation" (HR-Dv2, 2024). https://arxiv.org/abs/2410.19836
- **[L31]** K. Roth et al., "Towards total recall in industrial anomaly detection" (PatchCore), *CVPR* 2022. https://arxiv.org/abs/2106.08265
- **[L32]*** J. Bruna, S. Mallat, "Invariant scattering convolution networks," *IEEE TPAMI* 35 (2013). https://arxiv.org/abs/1203.1513
- **[L33]*** L. Sifre, S. Mallat, "Rigid-motion scattering for texture classification" (2014). https://arxiv.org/abs/1403.1687
- **[L34]** Beran et al., "Microstructure reconstruction in battery electrodes using machine learning based on low-voltage focused ion beam–scanning electron microscopy tomography images," *Advanced Engineering Materials* (2026). https://advanced.onlinelibrary.wiley.com/doi/10.1002/adem.70925
- **[L35]** S. Kench et al., "Li-ion battery design through microstructural optimization using generative AI," *Matter* (2024). https://www.cell.com/matter/fulltext/S2590-2385(24)00446-6
- **[L36]** "Battery Imaging Library: laboratory 3D FIB-SEM NMC811 electrode (raw data)," Zenodo (2025). https://zenodo.org/records/17073526

**Normalisation and batch effects**

- **[L37]*** D. M. Ando, C. Y. McLean, M. Berndl, "Improving phenotypic measurements in high-content imaging screens," bioRxiv (2017). https://www.biorxiv.org/content/10.1101/161422v1
- **[L38]** J. Arevalo et al., "Evaluating batch correction methods for image-based cell profiling," *Nature Communications* (2024). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11297288/
- **[L39]*** V. Nygaard, E. A. Rødland, E. Hovig, "Methods that remove batch effects while retaining group differences may lead to exaggerated confidence in downstream analyses," *Biostatistics* 17 (2016).
- **[L40]*** W. E. Johnson, C. Li, A. Rabinovic, "Adjusting batch effects in microarray expression data using empirical Bayes methods," *Biostatistics* 8 (2007); for imaging features: https://github.com/Jfortin1/ComBatHarmonization
- **[L41]** N. Belrose et al., "LEACE: perfect linear concept erasure in closed form," *NeurIPS* 2023. https://arxiv.org/abs/2306.03819

**Two-sample tests on sets**

- **[L43]*** A. Gretton et al., "A kernel two-sample test," *JMLR* 13 (2012).
- **[L44]** A. Schrab et al., "MMD aggregated two-sample test," *JMLR* 24 (2023). https://www.jmlr.org/beta/papers/v24/21-1289.html
- **[L45]*** D. Lopez-Paz, M. Oquab, "Revisiting classifier two-sample tests," *ICLR* 2017. https://arxiv.org/abs/1610.06545

**Calibration and out-of-distribution distance**

- **[L46]*** A. Kumar, P. Liang, T. Ma, "Verified uncertainty calibration," *NeurIPS* 2019. https://arxiv.org/abs/1909.10155
- **[L47]*** K. Lee et al., "A simple unified framework for detecting out-of-distribution samples and adversarial attacks," *NeurIPS* 2018. https://arxiv.org/abs/1807.03888
- **[L48]*** J. Ren et al., "A simple fix to Mahalanobis distance for improving near-OOD detection" (2021). https://arxiv.org/abs/2106.09022
- **[L49]** M. Mueller, M. Hein, "Mahalanobis++: improving OOD detection via feature normalization" (2025). https://arxiv.org/abs/2505.18032
- **[L50]** D. Janiak, J. Binkowski, T. Kajdanowicz, "A geometry-based view of Mahalanobis OOD detection" (2025, revised 2026). https://arxiv.org/abs/2510.15202
- **[L51]*** Y. Sun et al., "Out-of-distribution detection with deep nearest neighbors," *ICML* 2022. https://arxiv.org/abs/2204.06507
- **[L52]*** V. Vovk, I. Petej, "Venn–Abers predictors," *UAI* 2014. https://arxiv.org/abs/1211.0025
- **[L53]** L. van der Laan et al., "Generalized Venn and Venn-Abers calibration with applications in conformal prediction," *ICML* 2025. https://arxiv.org/abs/2502.05676
- **[L54]** V. Vovk, "Cross-conformal predictors" (2012). https://arxiv.org/abs/1208.0806
- **[L55]** M. Gasparin et al., "Improving the statistical efficiency of cross-conformal prediction," *ICML* 2025. https://proceedings.mlr.press/v267/gasparin25a.html

**Materials view (section 8)**

- **[M1]** "Real-time observation of morphology changes in SiOx anodes for lithium-ion batteries" (in-situ SEM; larger particles crack on first lithiation and the cracks remain). https://bestar.lbl.gov/2011/01/19/in-situ-sem-seeing-battery-cycling-in-action/
- **[M2]** "In situ scanning electron microscopy of silicon anode reactions in lithium-ion batteries during charge/discharge processes," *Scientific Reports* (2016). https://www.nature.com/articles/srep36153
- **[M3]** "Multiscale dynamics of charging and plating in graphite electrodes coupling operando microscopy and phase-field modelling," *Nature Communications* (2023): lithiation starts near the separator, particle by particle. https://pmc.ncbi.nlm.nih.gov/articles/PMC10449918/
- **[M4]** ETH Zürich, ScopeM, "SE detectors": the in-lens detector images work-function differences. https://www.microscopy.ethz.ch/se-detectors.htm
- **[M5]** Zeiss technical note, "Voltage contrast in microelectronic engineering". https://asset-downloads.zeiss.com/catalogs/download/mic/c8b40160-748e-49a4-a25c-1e266d009f79/EN_wp_SEM_voltage-contrast.pdf
- **[M6]** "Voltage contrast in scanning electron microscopy to distinguish conducting Ag nanowire networks from nonconducting Ag nanowire networks" (connected and isolated networks differ in brightness; which is darker depends on the conditions). https://pmc.ncbi.nlm.nih.gov/articles/PMC7288366/
- **[M7]** Beran et al., *Advanced Engineering Materials* (2026), same as [L34]: secondary-electron contrast in electrodes depends strongly on acceleration voltage and charging.
