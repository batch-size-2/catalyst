# Runbook: the last-minute images

Rehearsed on 4 Oct 2026, 01:00 (T6), on copies of two known samples, with the frozen model. These predictions are in-sample: this was a plumbing and timing check only.

1. **Put the images in their own folder**, never inside `data/Batch_*`: `data/<drop-name>/img_<id>_{BSE,ETD,Inlens}.tif`. In the app, Identify → upload does the same.
2. **Check the model is the frozen one:** `curl -s localhost:8000/api/attribution-model` must show `"matches_frozen": true` and sha256 `c2baba7d4d86…`. The app sidebar shows the same freeze line.
3. **Run once:** `HF_HUB_OFFLINE=1 uv run python -m qc.attribute --images data/<drop-name>`. Rehearsed time: 24 s for 2 samples, about 12 s each plus model load. No network needed. Through the app (`POST /api/attribution/<drop-name>`): 20 s for 2 samples.
4. **Never** add `--balanced` unless the split per batch is confirmed. Never refit or tune anything.
5. **Commit the output unchanged:** `cp out/attribution/<drop-name>.json results/` then
   `git add results/<drop-name>.json && git commit -m "Score <drop-name> once with the frozen model; output committed unchanged."`
6. **Present each call** as: the bet, the tier with its record ("calls in this tier were right 8 of 13 times"), "Batch_3 or not" and "which variation", the prediction set, and the reasons as sentences.
7. **A low-tier call:** "the model's best guess is Batch_X; it is a low-confidence call, right about 6 times in 10 at this tier; the prediction set says Batch_X or Batch_Y". A low tier never replaces the bet (Rule 11).
8. **Always add the limit:** the signal behind every call is also predicted by how the image was acquired (`docs/experiments/T9.md`). Reasons marked `basis: imaging` (T4) are imaging, not material.
9. **Unfamiliar** means outside every image we have of the assigned batch. Say "unlike any Batch_X image we have", not "defective".
10. **If something breaks:** the CLI in step 3 is the fallback for the app; the committed JSON is the record.
