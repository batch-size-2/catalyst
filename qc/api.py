"""HTTP API for the web UI in web/. A thin wrapper over qc.run; no QC logic lives here.

Usage: uv run uvicorn qc.api:app --reload
"""

import json
import queue
import re
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
from qc.io import DETECTOR_ALIASES, LAYER_RGB, PREVIEW_SIZES, field_paths, layer_png, preview_png
from qc.provenance import frozen_config, model_status, rules_frozen, verify
from qc.run import (
    Progress, RulesFrozen, attribute, attribution_module, identify_ready, load_evidence, measure_folder, read_json,
    run, set_baseline, tile_particles,
)
from qc.schema import (
    ATTRIBUTION_DIR, EVIDENCE_DIR, KPI_TABLE, KPI_UNITS, OUT_DIR, Evidence, Verdict,
    attribution_path, evidence_path, legacy_evidence_path, load_config, mask_path, phases_path,
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
    verdict: Verdict | None = None
    created_at: str | None = None


class BaselineChange(BaseModel):
    baseline: str


NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}")  # folder, image and detector names: no paths, spaces or newlines


def clean_name(name: str) -> str:
    if not NAME.fullmatch(name):
        raise HTTPException(400, f"invalid name {name!r}")
    return name


def batch_dir(batch: str) -> Path:
    return Path(load_config()["data_dir"]) / clean_name(batch)


def baseline_of(baseline: str | None) -> str:
    """A one-off baseline (validated like a batch name), or the default from config/decision.yaml."""
    return batch_dir(baseline).name if baseline else load_config()["baseline"]


def find_evidence(batch: str, baseline: str) -> Path | None:
    """out/evidence/<baseline>/<batch>.json, or a file from before evidence was keyed by baseline."""
    path, legacy = evidence_path(batch, baseline), legacy_evidence_path(batch)
    if path.exists():
        return path
    return legacy if legacy.exists() and summary_of(legacy).get("baseline") == baseline else None


def read_evidence(batch: str, baseline: str | None) -> Evidence:
    batch_dir(batch)
    path = find_evidence(batch, baseline_of(baseline))
    if path is None:
        raise HTTPException(404, f"no evidence for {batch!r} against {baseline_of(baseline)!r}")
    try:
        return load_evidence(path)
    except (ValidationError, ValueError):
        raise HTTPException(409, "evidence in an old format; re-run the batch")


def summary_of(path: Path) -> dict:
    """Baseline, verdict and timestamp of one evidence file; tolerates broken files and older formats."""
    try:
        raw = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    verdict = raw.get("verdict") if raw.get("verdict") in ("ACCEPT", "INVESTIGATE", "REJECT") else None
    created = (raw.get("provenance") or {}).get("created_at") if isinstance(raw.get("provenance"), dict) else None
    baseline = raw.get("baseline") if isinstance(raw.get("baseline"), str) else None
    return {"baseline": baseline, "verdict": verdict, "created_at": created if isinstance(created, str) else None}


@app.get("/api/health")
def health() -> dict:
    """Model file, deep stack, and cached DINOv2 weights. The Identify screen reads this before an upload."""
    return identify_ready()


@app.get("/api/config")
def config() -> dict:
    return load_config()


@app.get("/api/settings")
def settings() -> dict:
    """The default baseline, whether rules are frozen (then it can't change), and the Claude guide's status."""
    frozen, date = rules_frozen()
    unavailable = guide_module.available()
    return {"baseline": load_config()["baseline"], "rules_frozen_commit": frozen, "rules_frozen_date": date,
            "rules_frozen_config": frozen_config() if frozen else {},
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
    except ValueError as error:
        raise HTTPException(400, str(error))


@app.get("/api/batches")
def batches() -> list[BatchSummary]:
    cfg = load_config()
    data_dir = Path(cfg["data_dir"])
    folders = {p.name for p in data_dir.iterdir() if p.is_dir() and NAME.fullmatch(p.name)} if data_dir.is_dir() else set()
    verdicts = {d.batch: d.verdict for d in decisions() if d.baseline == cfg["baseline"]}
    return [BatchSummary(name=name, has_images=name in folders, verdict=verdicts.get(name))
            for name in sorted(folders | verdicts.keys())]


@app.get("/api/evidence")
def decisions() -> list[Decision]:
    """Every comparison on disk, against any baseline, newest first (files from before the baseline key included)."""
    out = {(p.parent.name, p.stem): Decision(batch=p.stem, **(summary_of(p) | {"baseline": p.parent.name}))
           for p in EVIDENCE_DIR.glob("*/*.json")}
    for p in EVIDENCE_DIR.glob("*.json"):
        if (s := summary_of(p)).get("baseline") and (s["baseline"], p.stem) not in out:
            out[(s["baseline"], p.stem)] = Decision(batch=p.stem, **s)
    return sorted(out.values(), key=lambda d: d.created_at or "", reverse=True)


@app.get("/api/evidence/{batch}")
def evidence(batch: str, baseline: str | None = None) -> Evidence:
    return read_evidence(batch, baseline)


@app.get("/api/guide/{batch}")
def guide(batch: str, baseline: str | None = None, source: str = "template") -> dict:
    """Summary, walkthrough and four audience readings (qc/guide.py). Free: the fixed template, or with
    source=claude Claude's cached version (else the template with a fallback_reason)."""
    if source not in ("claude", "template"):
        raise HTTPException(400, "source must be claude or template")
    return guide_module.guide(read_evidence(batch, baseline), source)


@app.post("/api/guide/{batch}")
def ask_claude(batch: str, baseline: str | None = None) -> dict:
    """Ask Claude for the summary, walkthrough and audience readings (one paid call, cached per evidence). Never changes the verdict."""
    return guide_module.guide(read_evidence(batch, baseline), "claude", ask=True)


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
                "has_layers": phases_path(folder.name, image_id).exists(),
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


@app.get("/api/slab/{batch}")
def slab(batch: str, image: str | None = None) -> dict:
    """Indicative 3D slab for the anode lab (qc/slab.py). An illustration, never part of a verdict."""
    from qc.slab import build

    batch_dir(batch)
    try:
        return build(batch, None if image is None else clean_name(image))
    except (KeyError, FileNotFoundError) as error:
        raise HTTPException(404, str(error).strip("'\""))


@app.get("/api/layers/{batch}/{image_id}/{layer}")
def phase_layer(batch: str, image_id: str, layer: str) -> FileResponse:
    """One segmentation phase (silicon, pore or binder) as a transparent PNG to lay over any detector."""
    batch_dir(batch)
    if layer not in LAYER_RGB:
        raise HTTPException(400, f"layer must be one of {sorted(LAYER_RGB)}")
    phases = phases_path(batch, clean_name(image_id))
    if not phases.exists():
        raise HTTPException(404, f"no phase layers for {batch}/{image_id}: measure it first")
    return FileResponse(layer_png(phases, layer))


@app.get("/api/particles/{batch}/{image_id}")
def particles(batch: str, image_id: str, top: int = 8) -> dict:
    """The tile's size and its largest silicon particles (qc.run.tile_particles), for the region peek."""
    try:
        return tile_particles(batch_dir(batch), clean_name(image_id), top)
    except FileNotFoundError as error:
        raise HTTPException(404, str(error))


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
    bad = [f.filename for f in files if not NAME.fullmatch(Path(f.filename or "").name)]
    if bad:
        raise HTTPException(400, f"invalid file names (letters, digits, _ . - only): {', '.join(map(str, bad[:5]))}")
    target.mkdir(parents=True, exist_ok=True)
    for file in files:
        with open(target / Path(file.filename or "upload.tif").name, "wb") as out:
            shutil.copyfileobj(file.file, out)
    return {"saved": len(files)}


def ndjson_stream(work: Callable[[Progress], dict]) -> StreamingResponse:
    events: queue.Queue[dict | None] = queue.Queue()

    def progress(done: int, total: int, tile: str, stage: str | None = None) -> None:
        events.put({"type": "progress", "done": done, "total": total, "tile": tile} | ({"stage": stage} if stage else {}))

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
        "type": "done", "attribution": attribute(target, balanced, lambda stage, d, t, s: progress(d, t, s, stage))})


@app.get("/api/impact/{batch}")
def battery_impact(batch: str, baseline: str | None = None) -> dict:
    """Indicative battery impact against the baseline (qc/impact.py, experimental). Never part of the verdict."""
    from qc.impact import NotMeasured, impact_report, read_tables

    baseline = clean_name(baseline or load_config()["baseline"])
    if not KPI_TABLE.exists():
        raise HTTPException(404, "no KPI table: run `uv run python -m qc.measure` first")
    try:
        return impact_report(*read_tables(KPI_TABLE), clean_name(batch), baseline).model_dump(mode="json")
    except NotMeasured as error:
        raise HTTPException(404, str(error))
    except (KeyError, ValueError) as error:
        raise HTTPException(422, f"KPI table not usable for impact: {error}")
