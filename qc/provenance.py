"""Provenance for one evidence file: input hashes, git state, config hash, timestamp (PLAN_v3 §3.11)."""

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from qc.schema import InputFile, Provenance, load_config

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


def provenance(inputs: list[Path], cfg: dict, data_dir: Path) -> Provenance:
    status = git("status", "--porcelain")
    frozen = git("rev-parse", "rules-frozen^{commit}")
    return Provenance(
        inputs=sorted((input_file(p, data_dir) for p in inputs), key=lambda f: f.path),
        git_commit=git("rev-parse", "HEAD"),
        git_dirty=None if status is None else bool(status),
        config_sha256={"decision": sha256(json.dumps(cfg, sort_keys=True))}
                      | {name: sha256(path) for name in CONFIG_FILES
                         if (path := Path("config") / name).exists()},
        rules_frozen_commit=frozen,
        rules_frozen_date=git("for-each-ref", "refs/tags/rules-frozen",
                              "--format=%(creatordate:iso-strict)") if frozen else None,
        created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )


def verify(prov: Provenance, data_dir: Path) -> dict:
    """Re-hash every provenance input and the config files against their stored sha256s.

    "decision" is the canonical JSON of the config used at run time, re-hashed from the current one.
    """
    files = []
    for entry in prov.inputs:
        path = data_dir / entry.path
        files.append({"path": entry.path, "ok": path.is_file() and sha256(path) == entry.sha256})
    checks = [sha256(json.dumps(load_config(), sort_keys=True)) == digest if name == "decision"
              else (path := Path("config") / name).is_file() and sha256(path) == digest
              for name, digest in prov.config_sha256.items()]
    config_ok = all(checks)
    return {"ok": config_ok and all(f["ok"] for f in files), "files": files, "config_ok": config_ok}
