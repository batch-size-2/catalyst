"""Run Pat's known-answer controls and remember whether they passed.

Usage: uv run python -m qc.control_check

Writes out/controls.json. qc.run.load_controls reads it back and hands it to evaluate()
only when the baseline and the decision-config hash still match. Shared-strip controls
are not run: that machinery is no longer part of the verdict.

The internals of qc/controls.py are Pat's. This module only calls iter_controls and compare.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from pydantic import ValidationError

from qc.controls import iter_controls
from qc.decide import compare
from qc.io import iter_fields
from qc.provenance import sha256
from qc.schema import (
    CONTROLS_JSON, IMAGING_COLUMNS, KPI_TABLE_COLUMNS, PARTICLE_COLUMNS, Control, ControlResult, Controls,
    Evidence, Field, Tables, load_config,
)


def decision_hash(cfg: dict) -> str:
    """Same canonical hash provenance stores under config_sha256['decision']."""
    return sha256(json.dumps(cfg, sort_keys=True))


def tables_of(fields: list[Field]) -> Tables:
    """Measure fields the same way a batch is measured, including particles and imaging."""
    from qc.run import measure_field

    kpi_rows, particle_frames, imaging_rows = [], [], []
    for field in fields:
        kpi_row, particle_rows, img_rows = measure_field(field)
        kpi_rows.append(kpi_row)
        particle_frames.append(particle_rows)
        imaging_rows.extend(img_rows)
    particles = pd.concat(particle_frames, ignore_index=True) if particle_frames else pd.DataFrame()
    return Tables(
        kpis=pd.DataFrame(kpi_rows, columns=KPI_TABLE_COLUMNS),
        particles=particles.reindex(columns=PARTICLE_COLUMNS),
        imaging=pd.DataFrame(imaging_rows, columns=IMAGING_COLUMNS),
    )


def reference_for(baseline: Tables, control: Control) -> Tables:
    """Baseline tables without the control's source strips, plus any image kept in the reference."""
    source = set(control.source_strips)
    kept = set(control.kept_in_reference)

    def keep(frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty or "strip_id" not in frame.columns:
            return frame
        strip = frame["strip_id"].astype(str)
        image = frame["image_id"].astype(str) if "image_id" in frame.columns else pd.Series("", index=frame.index)
        return frame.loc[~strip.isin(source) | image.isin(kept)].reset_index(drop=True)

    return Tables(kpis=keep(baseline.kpis), particles=keep(baseline.particles), imaging=keep(baseline.imaging))


def judge_control(control: Control, evidence: Evidence) -> ControlResult:
    """Negative: no used key is DIFFERENT. Positive: one is, and the top DIFFERENT driver matches."""
    used = [d for d in evidence.differences if d.used]
    statuses = {d.name: d.status for d in used}
    different = {d.name for d in used if d.status == "DIFFERENT"}
    top_driver = next((name for name in evidence.drivers if name in different), None)
    if control.kind == "negative":
        passed = not different
    else:
        passed = bool(different) and top_driver == control.expected_driver
    return ControlResult(
        name=control.name, kind=control.kind, expected_driver=control.expected_driver,
        statuses=statuses, top_driver=top_driver, passed=passed,
    )


def run_controls(cfg: dict) -> Controls:
    """One control at a time, so only one transformed batch is in memory."""
    baseline_dir = Path(cfg["data_dir"]) / cfg["baseline"]
    if not baseline_dir.is_dir():
        raise FileNotFoundError(f"baseline folder {baseline_dir} not found")
    fields = list(iter_fields(baseline_dir))
    if not fields:
        raise FileNotFoundError(f"no images in {baseline_dir}")
    print(f"measuring baseline {cfg['baseline']} ({len(fields)} tiles)", flush=True)
    baseline = tables_of(fields)
    results = []
    for control in iter_controls(fields, fields[0].px_um):
        print(f"  {control.name} ({control.kind}, {len(control.fields)} tiles, driver={control.expected_driver})", flush=True)
        evidence = compare(reference_for(baseline, control), tables_of(control.fields), cfg)
        result = judge_control(control, evidence)
        results.append(result)
        print(f"    {'pass' if result.passed else 'FAIL'}  top={result.top_driver}", flush=True)
    return Controls(ran=True, passed=bool(results) and all(r.passed for r in results), results=results)


def load_controls(cfg: dict, path=CONTROLS_JSON) -> Controls:
    """The saved controls, or not-run when the file is missing, broken, or for another config."""
    if not path.is_file():
        return Controls()
    try:
        data = json.loads(path.read_text())
        if data.get("baseline") != cfg.get("baseline") or data.get("config_sha256") != decision_hash(cfg):
            return Controls()
        controls = Controls.model_validate(data)
    except (OSError, ValueError, ValidationError):
        return Controls()
    return controls if controls.ran else Controls()


def write_controls(cfg: dict, controls: Controls, path=CONTROLS_JSON) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = controls.model_dump() | {
        "baseline": cfg["baseline"],
        "config_sha256": decision_hash(cfg),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    path.write_text(json.dumps(payload, indent=2))


def _print_table(controls: Controls) -> None:
    print(f"{'control':22} {'kind':9} {'expected':22} {'top':22} {'pass'}")
    for result in controls.results:
        print(f"{result.name:22} {result.kind:9} {str(result.expected_driver):22} "
              f"{str(result.top_driver):22} {'pass' if result.passed else 'FAIL'}")
        print(f"    statuses: {result.statuses}")
    print(f"passed: {controls.passed}  ({sum(r.passed for r in controls.results)} of {len(controls.results)})")


if __name__ == "__main__":
    config = load_config()
    done = run_controls(config)
    write_controls(config, done)
    _print_table(done)
    print(f"wrote {CONTROLS_JSON}")
