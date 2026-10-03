"""HTTP API for the web UI in web/. A thin wrapper over qc.run; no QC logic lives here.

Usage: uv run uvicorn qc.api:app --reload
"""

import json
import queue
import shutil
import threading
from collections.abc import Callable
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

from qc import guide as guide_module
from qc.explain import load_dictionary
from qc.io import DETECTOR_ALIASES, PREVIEW_SIZES, field_paths, preview_png
from qc.provenance import model_status, rules_frozen, verify
from qc.run import (
    Progress, RulesFrozen, attribute, attribution_module, measure_folder, read_json, run, set_baseline,
)
from qc.schema import (
    ATTRIBUTION_DIR, EVIDENCE_DIR, KPI_TABLE, KPI_UNITS, OUT_DIR, Evidence, Verdict,
    attribution_path, evidence_path, load_config, mask_path,
)

app = FastAPI(title="Catalyst QC")
(OUT_DIR / "masks").mkdir(parents=True, exist_ok=True)
app.mount("/api/masks", StaticFiles(directory=OUT_DIR / "masks"), name="masks")


class BatchSummary(BaseModel):
    name: str
    has_images: bool
    verdict: Verdict | None              # against the default baseline


class Decision(BaseModel):
    batch: str
    baseline: str
    verdict: Verdict | None
    created_at: str | None


class BaselineChange(BaseModel):
    baseline: str


def batch_dir(batch: str) -> Path:
    if Path(batch).name != batch or batch.startswith("."):
        raise HTTPException(400, f"invalid batch name {batch!r}")
    return Path(load_config()["data_dir"]) / batch


def clean_name(name: str) -> str:
    if Path(name).name != name or name.startswith("."):
        raise HTTPException(400, f"invalid name {name!r}")
    return name


def baseline_of(baseline: str | None) -> str:
    """A one-off baseline (validated like a batch name), or the default from config/decision.yaml."""
    return batch_dir(baseline).name if baseline else load_config()["baseline"]


def read_evidence(batch: str, baseline: str | None) -> Evidence:
    batch_dir(batch)
    path = evidence_path(batch, baseline_of(baseline))
    if not path.exists():
        raise HTTPException(404, f"no evidence for {batch!r} against {baseline_of(baseline)!r}")
    try:
        return Evidence.model_validate_json(path.read_text())
    except ValidationError:
        raise HTTPException(409, "evidence in an old format; re-run the batch")


def summary_of(path: Path) -> dict:
    """Verdict and timestamp of one evidence file; tolerates files from older formats."""
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}
    return {"verdict": raw.get("verdict"), "created_at": (raw.get("provenance") or {}).get("created_at")}


@app.get("/api/config")
def config() -> dict:
    return load_config()


@app.get("/api/settings")
def settings() -> dict:
    """The default baseline, whether rules are frozen (then it can't change), and the Claude guide's status."""
    frozen, date = rules_frozen()
    unavailable = guide_module.available()
    return {"baseline": load_config()["baseline"], "rules_frozen_commit": frozen, "rules_frozen_date": date,
            "claude": {"available": unavailable is None, "model": guide_module.MODEL, "reason": unavailable}}


@app.put("/api/settings/baseline")
def change_baseline(change: BaselineChange) -> dict:
    """Write the default baseline to config/decision.yaml; 409 once the `rules-frozen` tag exists."""
    batch_dir(change.baseline)
    try:
        return {"baseline": set_baseline(change.baseline)["baseline"]}
    except RulesFrozen as error:
        raise HTTPException(409, str(error))
    except FileNotFoundError as error:
        raise HTTPException(404, str(error))


@app.get("/api/batches")
def batches() -> list[BatchSummary]:
    cfg = load_config()
    data_dir = Path(cfg["data_dir"])
    folders = {p.name for p in data_dir.iterdir() if p.is_dir()} if data_dir.is_dir() else set()
    verdicts = {p.stem: summary_of(p).get("verdict") for p in (EVIDENCE_DIR / cfg["baseline"]).glob("*.json")}
    return [BatchSummary(name=name, has_images=name in folders, verdict=verdicts.get(name))
            for name in sorted(folders | verdicts.keys())]


@app.get("/api/evidence")
def decisions() -> list[Decision]:
    """Every comparison on disk, against any baseline, newest first."""
    out = [Decision(batch=p.stem, baseline=p.parent.name, **summary_of(p)) for p in EVIDENCE_DIR.glob("*/*.json")]
    return sorted(out, key=lambda d: d.created_at or "", reverse=True)


@app.get("/api/evidence/{batch}")
def evidence(batch: str, baseline: str | None = None) -> Evidence:
    return read_evidence(batch, baseline)


@app.get("/api/guide/{batch}")
def guide(batch: str, baseline: str | None = None, source: str = "claude") -> dict:
    """Summary and walkthrough over the evidence: Claude's when configured and within the house rules,
    else the fixed template. Never changes the verdict (qc/guide.py)."""
    if source not in ("claude", "template"):
        raise HTTPException(400, "source must be claude or template")
    return guide_module.guide(read_evidence(batch, baseline), source)


@app.get("/api/attribution")
def attributions() -> list[str]:
    return sorted(path.stem for path in ATTRIBUTION_DIR.glob("*.json")
                  if path.stem != "evaluation") if ATTRIBUTION_DIR.is_dir() else []


@app.get("/api/attribution-evaluation")
def attribution_evaluation() -> dict:
    path = ATTRIBUTION_DIR / "evaluation.json"
    if not path.exists():
        raise HTTPException(404, "no attribution evaluation")
    return read_json(path)


@app.get("/api/attribution-model")
def attribution_model() -> dict:
    """Which model POST /api/attribution will use, and whether it is the frozen one."""
    status = model_status()
    if status is None:
        raise HTTPException(404, "no attribution model: run `uv run python -m qc.attribute --fit`")
    return status


@app.get("/api/attribution/{name}")
def attribution_result(name: str) -> dict:
    batch_dir(name)
    path = attribution_path(name)
    if not path.exists():
        raise HTTPException(404, f"no attribution for {name!r}")
    return read_json(path)


@app.get("/api/kpis")
def kpi_dictionary() -> dict:
    """config/kpi_dictionary.yaml: name, unit and plain-language meaning per descriptor."""
    return load_dictionary()


@app.get("/api/tiles")
def tiles() -> list[dict]:
    """Every image in every data_dir folder, joined with its out/kpis.csv row when present."""
    data_dir = Path(load_config()["data_dir"])
    rows: dict[tuple[str, str], pd.Series] = {}
    if KPI_TABLE.exists():
        table = pd.read_csv(KPI_TABLE)
        rows = {(row.batch, row.image_id): row for row in table.itertuples()}
    result = []
    for folder in sorted(data_dir.iterdir()) if data_dir.is_dir() else []:
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        for image_id, paths in field_paths(folder).items():
            row = rows.get((folder.name, image_id))
            result.append({
                "batch": folder.name,
                "image_id": image_id,
                "strip_id": None if row is None or pd.isna(row.strip_id) else row.strip_id,
                "detectors": sorted(paths),
                "kpis": None if row is None else {
                    k: (None if (v := getattr(row, k, None)) is None or pd.isna(v) else float(v))
                    for k in KPI_UNITS
                },
                "has_mask": mask_path(folder.name, image_id).exists(),
            })
    return result


@app.get("/api/images/{batch}/{image_id}/{detector}")
def image_preview(batch: str, image_id: str, detector: str, size: int = 512) -> FileResponse:
    """A PNG preview of one detector TIFF (percentile-stretched, cached under out/previews/)."""
    folder, image_id = batch_dir(batch), clean_name(image_id)
    detector = DETECTOR_ALIASES.get(clean_name(detector).lower(), detector)
    if size not in PREVIEW_SIZES:
        raise HTTPException(400, f"size must be one of {PREVIEW_SIZES}")
    paths = field_paths(folder).get(image_id) if folder.is_dir() else None
    if not paths or detector not in paths:
        raise HTTPException(404, f"no {detector} image for {batch}/{image_id}")
    return FileResponse(preview_png(paths[detector], size))


@app.post("/api/verify/{batch}")
def verify_batch(batch: str, baseline: str | None = None) -> dict:
    """Re-hash the comparison's provenance inputs and config files against their stored sha256s."""
    found = read_evidence(batch, baseline)
    if found.provenance is None:
        raise HTTPException(404, f"no provenance for {batch!r}")
    return verify(found.provenance, Path(load_config()["data_dir"]), found.baseline)


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
def start_run(batch: str, baseline: str | None = None) -> StreamingResponse:
    """Streams NDJSON events: progress (one per measured tile), then done (with evidence) or error.

    `baseline` runs a one-off comparison against another folder; the default in config stays.
    """
    target, cfg = batch_dir(batch), load_config() | {"baseline": baseline_of(baseline)}
    return ndjson_stream(lambda progress: {
        "type": "done", "evidence": run([target], cfg, progress)[0].model_dump(mode="json")})


@app.post("/api/measure/{batch}")
def start_measure(batch: str) -> StreamingResponse:
    """Measure one folder (e.g. an Identify drop) into out/kpis.csv and masks, without comparing it."""
    target = batch_dir(batch)
    if not target.is_dir():
        raise HTTPException(404, f"no folder {batch!r}")
    return ndjson_stream(lambda progress: {"type": "done", "measured": measure_folder(target, progress)})


@app.post("/api/attribution/{name}")
def start_attribution(name: str, balanced: int | None = None) -> StreamingResponse:
    target = batch_dir(name)
    if attribution_module() is None:
        raise HTTPException(501, "batch attribution is not available yet (qc/attribute.py)")
    return ndjson_stream(lambda progress: {
        "type": "done", "attribution": attribute(target, balanced)})
