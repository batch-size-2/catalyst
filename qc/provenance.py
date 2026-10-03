"""Provenance for one evidence file: input hashes, git state, config hash, timestamp (PLAN_v4 §3.11)."""

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from qc.schema import ATTRIBUTION_MODEL_PATH, InputFile, Provenance, load_config

CONFIG_FILES = ("particle_types.json", "kpi_dictionary.yaml", "attribution_model.json")


def sha256(data: bytes | str | Path) -> str:
    if isinstance(data, Path):
        with data.open("rb") as file:
            return hashlib.file_digest(file, "sha256").hexdigest()
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def git(*args: str) -> str | None:
    """Stdout of a git call in the current directory; None on any failure (not a repo, missing tag)."""
    try:
        out = subprocess.run(["git", *args], check=False, capture_output=True, text=True)
    except OSError:
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def input_file(path: Path, data_dir: Path) -> InputFile:
    try:
        rel = str(path.relative_to(data_dir))  # no resolve(): data/<batch> may be a symlink
    except ValueError:
        rel = str(Path(path.parent.name) / path.name)
    return InputFile(path=rel, sha256=sha256(path))


def rules_frozen() -> tuple[str | None, str | None]:
    """Commit and date of the `rules-frozen` tag, or (None, None) when it doesn't exist."""
    frozen = git("rev-parse", "rules-frozen^{commit}")
    date = git("for-each-ref", "refs/tags/rules-frozen", "--format=%(creatordate:iso-strict)") if frozen else None
    return frozen, date


def provenance(inputs: list[Path], cfg: dict, data_dir: Path) -> Provenance:
    status = git("status", "--porcelain")
    frozen, frozen_date = rules_frozen()
    return Provenance(
        inputs=sorted((input_file(p, data_dir) for p in inputs), key=lambda f: f.path),
        git_commit=git("rev-parse", "HEAD"),
        git_dirty=None if status is None else bool(status),
        config_sha256={"decision": sha256(json.dumps(cfg, sort_keys=True))}
                      | {name: sha256(path) for name in CONFIG_FILES
                         if (path := Path("config") / name).exists()},
        rules_frozen_commit=frozen,
        rules_frozen_date=frozen_date,
        created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )


def verify(prov: Provenance, data_dir: Path, baseline: str | None = None) -> dict:
    """Re-hash every provenance input and the config files against their stored sha256s.

    "decision" is the canonical JSON of the config used at run time, re-hashed from the current one
    with the comparison's own baseline (a one-off run overrides it).
    """
    files = []
    for entry in prov.inputs:
        path = data_dir / entry.path
        files.append({"path": entry.path, "ok": path.is_file() and sha256(path) == entry.sha256})
    cfg = load_config() | ({"baseline": baseline} if baseline else {})
    checks = [sha256(json.dumps(cfg, sort_keys=True)) == digest if name == "decision"
              else (path := Path("config") / name).is_file() and sha256(path) == digest
              for name, digest in prov.config_sha256.items()]
    config_ok = all(checks)
    return {"ok": config_ok and all(f["ok"] for f in files), "files": files, "config_ok": config_ok}


def model_status(path: Path = ATTRIBUTION_MODEL_PATH) -> dict | None:
    """The attribution model the next run will use, and whether it is the file under `rules-frozen`."""
    if not path.exists():
        return None
    model = json.loads(path.read_text())
    frozen = git("rev-parse", "rules-frozen^{commit}")
    tagged, current = git("rev-parse", f"rules-frozen:{path.as_posix()}"), git("hash-object", str(path))
    return {
        "kind": model.get("kind", "flat"), "families": model.get("families"), "staged": model.get("staged"),
        "fitted_at": model.get("fitted_at"), "classes": model.get("classes"), "baseline": model.get("baseline"),
        "n_trained_on": {batch: len(ids) for batch, ids in (model.get("trained_on") or {}).items()},
        "loso_balanced_accuracy": (model.get("loso") or {}).get("balanced_accuracy"),
        "calibration": model.get("calibration"),
        "sha256": sha256(path),
        "rules_frozen_commit": frozen,
        "matches_frozen": None if tagged is None or current is None else tagged == current,
    }
