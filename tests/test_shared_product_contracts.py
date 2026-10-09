"""Shared HTTP views must not require local admission or application startup."""

from __future__ import annotations

import importlib
import json
import os
import pkgutil
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


def test_every_server_schema_module_supports_star_import():
    """Compatibility modules re-export the shared ``__all__``; each listed name must resolve."""

    import animama.server.schemas as schemas

    modules = sorted(module.name for module in pkgutil.iter_modules(schemas.__path__))
    assert {"anima_loadout", "runtime_content", "typed_content"} <= set(modules)
    for name in modules:
        namespace: dict[str, object] = {}
        # A name listed in __all__ but not bound in the module raises AttributeError.
        exec(f"from animama.server.schemas.{name} import *", namespace)
        exported = getattr(importlib.import_module(f"animama.server.schemas.{name}"), "__all__", None)
        assert exported is None or set(exported) <= set(namespace), name
