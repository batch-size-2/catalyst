"""HTTP API for the web UI in web/. A thin wrapper over qc.run; no QC logic lives here.

Usage: uv run uvicorn qc.api:app --reload
"""

import json
import queue
import shutil
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from qc.run import run
from qc.schema import EVIDENCE_DIR, OUT_DIR, Evidence, Verdict, evidence_path, load_config

app = FastAPI(title="Catalyst QC")
(OUT_DIR / "masks").mkdir(parents=True, exist_ok=True)
app.mount("/api/masks", StaticFiles(directory=OUT_DIR / "masks"), name="masks")


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
    verdicts = {p.stem: Evidence.model_validate_json(p.read_text()).verdict for p in EVIDENCE_DIR.glob("*.json")}
    return [BatchSummary(name=name, has_images=name in folders, verdict=verdicts.get(name))
            for name in sorted(folders | verdicts.keys())]


@app.get("/api/evidence/{batch}")
def evidence(batch: str) -> Evidence:
    path = evidence_path(batch)
    if not path.exists():
        raise HTTPException(404, f"no evidence for {batch!r}")
    return Evidence.model_validate_json(path.read_text())


@app.post("/api/batches/{batch}/files")
def upload(batch: str, files: list[UploadFile]) -> dict:
    target = batch_dir(batch)
    target.mkdir(parents=True, exist_ok=True)
    for file in files:
        with open(target / Path(file.filename or "upload.tif").name, "wb") as out:
            shutil.copyfileobj(file.file, out)
    return {"saved": len(files)}


@app.post("/api/runs/{batch}")
def start_run(batch: str) -> StreamingResponse:
    """Streams NDJSON events: progress (one per measured tile), then done (with evidence) or error."""
    target, cfg, events = batch_dir(batch), load_config(), queue.Queue()

    def work() -> None:
        try:
            [result] = run([target], cfg, lambda done, total, tile: events.put(
                {"type": "progress", "done": done, "total": total, "tile": tile}))
            events.put({"type": "done", "evidence": result.model_dump(mode="json")})
        except Exception as error:
            events.put({"type": "error", "message": str(error)})
        events.put(None)

    threading.Thread(target=work, daemon=True).start()
    return StreamingResponse((json.dumps(event) + "\n" for event in iter(events.get, None)),
                             media_type="application/x-ndjson")
