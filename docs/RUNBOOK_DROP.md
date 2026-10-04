# Drop runbook

Before a live Identify drop the API has to be ready with the network off. `GET /api/health` is the check: `model_present`, `deep_importable`, and `dinov2_cached` all true. The Identify screen shows a banner and will not upload while any of them is false.

1. `uv sync` (torch and transformers are regular dependencies; the `deep` extra is the same packages).
2. The attribution model is `config/attribution_model.json`. If health says it is missing, it has not been fitted.
3. Download the pinned DINOv2 weights once, while the network is on:

```bash
uv run python -c "from transformers import AutoModel; from qc.deep import MODEL_ID, MODEL_REVISION; AutoModel.from_pretrained(MODEL_ID, revision=MODEL_REVISION)"
```

4. Start the API offline and confirm health:

```bash
HF_HUB_OFFLINE=1 uv run uvicorn qc.api:app --port 8000
curl -s localhost:8000/api/health
```

5. Identify a tile in the app (`cd web && npm run dev`). A failed upload means this check was skipped; read the banner.

Timings for a rehearsal drop are not in this file yet (T6). Do not point the drop at `data/Hackathon-Polaron-test` or `data/drop_*` except to look.
