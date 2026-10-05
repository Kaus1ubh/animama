"""Shared HTTP views must not require local admission or application startup."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_retained_product_contracts_render_without_local_imports(tmp_path):
    environment = dict(os.environ)
    environment["ANIMAMA_LOG_TO_FILE"] = "1"
    environment["ANIMAMA_LOG_DIR"] = str(tmp_path / "must-not-be-created")
    result = subprocess.run(
        [sys.executable, "-I", str(ROOT / "scripts/repository-boundary/consumers/contracts.py")],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=True,
    )
    evidence = json.loads(result.stdout)
    assert evidence["modules"] == 14
    assert evidence["schemas"] >= 150
    assert evidence["local_imports"] == 0
    assert not (tmp_path / "must-not-be-created").exists()
