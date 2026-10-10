"""The shared product HTTP consumer runs without any local composition module (ADR 0021)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from animama.product_http.inventory import ROUTES

ROOT = Path(__file__).resolve().parents[1]


def test_shared_package_serves_a_consumer_with_local_imports_blocked(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            "-W",
            "ignore::DeprecationWarning",
            str(ROOT / "scripts/repository-boundary/consumers/product_http.py"),
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=True,
    )
    evidence = json.loads(result.stdout)
    assert evidence == {"inventory_routes": len(ROUTES), "mounted_shared_routes": 0, "local_imports": 0}
