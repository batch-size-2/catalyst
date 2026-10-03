"""HTTP API for the web UI in web/. A thin wrapper over qc.run; no QC logic lives here.

Usage: uv run uvicorn qc.api:app --reload
"""

import json
import queue
import shutil
import threading
from collections.abc import Callable
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

from qc.run import Progress, attribute, attribution_predict, run
from qc.schema import (
    ATTRIBUTION_DIR, EVIDENCE_DIR, OUT_DIR, Attribution, Evidence, Verdict, attribution_path, evidence_path,
    load_config,
)

app = FastAPI(title="Catalyst QC")
(OUT_DIR / "masks").mkdir(parents=True, exist_ok=True)
app.mount("/api/masks", StaticFiles(directory=OUT_DIR / "masks"), name="masks")
ATTRIBUTION_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/api/attribution-files", StaticFiles(directory=ATTRIBUTION_DIR), name="attribution-files")


class BatchSummary(BaseModel):
    name: str
    has_images: bool
    verdict: Verdict | None


def batch_dir(batch: str) -> Path:
    if Path(batch).name != batch or batch.startswith("."):
        raise HTTPException(400, f"invalid batch name {batch!r}")
    return Path(load_config()["data_dir"]) / batch


@app.get("/api/config")
def config() -> dict:
    return load_config()


@app.get("/api/batches")
def batches() -> list[BatchSummary]:
    data_dir = Path(load_config()["data_dir"])
    folders = {p.name for p in data_dir.iterdir() if p.is_dir()} if data_dir.is_dir() else set()
    verdicts = {}
    for p in EVIDENCE_DIR.glob("*.json"):
        try:  # tolerate stale V1 files: they are valid JSON with a top-level verdict
            verdicts[p.stem] = json.loads(p.read_text()).get("verdict")
        except json.JSONDecodeError:
            continue
    return [BatchSummary(name=name, has_images=name in folders, verdict=verdicts.get(name))
            for name in sorted(folders | verdicts.keys())]


@app.get("/api/evidence/{batch}")
def evidence(batch: str) -> Evidence:
    path = evidence_path(batch)
    if not path.exists():
        raise HTTPException(404, f"no evidence for {batch!r}")
    try:
        return Evidence.model_validate_json(path.read_text())
    except ValidationError:
        raise HTTPException(409, "evidence in an old format; re-run the batch")


@app.get("/api/attribution")
def attributions() -> list[str]:
    return sorted(path.stem for path in ATTRIBUTION_DIR.glob("*.json")) if ATTRIBUTION_DIR.is_dir() else []


@app.get("/api/attribution/{name}")
def attribution_result(name: str) -> Attribution:
    batch_dir(name)
    path = attribution_path(name)
    if not path.exists():
        raise HTTPException(404, f"no attribution for {name!r}")
    try:
        return Attribution.model_validate_json(path.read_text())
    except ValidationError:
        raise HTTPException(409, "attribution in an old format; re-run the batch")


@app.post("/api/batches/{batch}/files")
def upload(batch: str, files: list[UploadFile]) -> dict:
    target = batch_dir(batch)
    target.mkdir(parents=True, exist_ok=True)
    for file in files:
        with open(target / Path(file.filename or "upload.tif").name, "wb") as out:
            shutil.copyfileobj(file.file, out)
    return {"saved": len(files)}


def ndjson_stream(work: Callable[[Progress], dict]) -> StreamingResponse:
    events: queue.Queue[dict | None] = queue.Queue()

    def progress(done: int, total: int, tile: str) -> None:
        events.put({"type": "progress", "done": done, "total": total, "tile": tile})

    def worker() -> None:
        try:
            events.put(work(progress))
        except Exception as error:
            events.put({"type": "error", "message": str(error)})
        finally:
            events.put(None)

    threading.Thread(target=worker, daemon=True).start()
    return StreamingResponse((json.dumps(event) + "\n" for event in iter(events.get, None)),
                             media_type="application/x-ndjson")


@app.post("/api/runs/{batch}")
def start_run(batch: str) -> StreamingResponse:
    """Streams NDJSON events: progress (one per measured tile), then done (with evidence) or error."""
    target, cfg = batch_dir(batch), load_config()
    return ndjson_stream(lambda progress: {
        "type": "done", "evidence": run([target], cfg, progress)[0].model_dump(mode="json")})


@app.post("/api/attribution/{name}")
def start_attribution(name: str) -> StreamingResponse:
    target = batch_dir(name)
    if attribution_predict() is None:
        raise HTTPException(501, "batch attribution is not available yet (qc/attribute.py)")
    return ndjson_stream(lambda progress: {
        "type": "done", "attribution": attribute([target], progress).model_dump(mode="json")})
