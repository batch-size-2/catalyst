"""The Compare page's block order, exercised on the four real comparison shapes."""

import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _node() -> str:
    for candidate in (os.environ.get("NODE_BIN"), shutil.which("node"), "/opt/homebrew/opt/node@22/bin/node"):
        if not candidate or not Path(candidate).exists():
            continue
        probe = subprocess.run([candidate, "-e", "process.exit(0)"], capture_output=True, text=True)
        if probe.returncode == 0:
            return candidate
    raise RuntimeError("need a working Node to run web/pageBlocks.test.ts")


def test_page_blocks_orders_the_four_comparisons():
    node = _node()
    subprocess.run(
        [node, "--experimental-strip-types", "--test", "web/pageBlocks.test.ts"],
        cwd=ROOT, check=True,
    )
