"""Desktop staging and the hosted catalog seed ship WebP effect art (#655)."""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from animama.runtime.included_derivatives import convert_included_tree
from animama.runtime.starter_content import starter_inventory
from tests.anima_creation_service_support import copy_tracked_included

REPO = Path(__file__).resolve().parents[1]


def _catalog_seed() -> ModuleType:
    """Load the package-set seed script the way its producer runs it."""

    scripts = str(REPO / "scripts/package-sets")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    spec = importlib.util.spec_from_file_location("catalog_seed", REPO / "scripts/package-sets/catalog_seed.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _assert_ships_derivatives(inventory: dict[str, Any], root: Path) -> None:
    rows = {row["path"]: row for row in inventory["files"]}
    derived = {path: row for path, row in rows.items() if "derived_from" in row}
    assert derived, "effect art should ship as WebP derivatives"
    assert all(path.endswith(".webp") and path.startswith("vfx/") for path in derived)
    assert not {row["derived_from"]["path"] for row in derived.values()} & set(rows)
    for path in rows:
        assert (root / path).is_file(), path
    staged = json.loads((root / "licenses/inventory.json").read_text())
    assert set(staged["derivatives"]) >= set(derived)


def test_desktop_staging_ships_converted_effect_art(tmp_path: Path) -> None:
    staged = subprocess.run(
        [sys.executable, str(REPO / "src/backend/packaging/desktop/stage_content.py"), "--output", str(tmp_path)],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert staged.returncode == 0, staged.stderr

    core = tmp_path / "runtime/content/included-core"
    source_inventory = json.loads((tmp_path / "starter-content-inventory.json").read_text())
    verified = json.loads((core / "inventory.json").read_text())
    _assert_ships_derivatives(verified, core)
    # Licence records are built from the source inventory: it must describe the
    # same shipped files as the staged core.
    core_rows = {row["path"]: row for row in source_inventory["files"] if row["partition"] == "core"}
    assert core_rows == {row["path"]: row for row in verified["files"]}
    # The frozen `content audit` re-resolves the staged core alone.
    assert starter_inventory(core)["id"] == verified["id"]


def _stage_content() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "stage_content", REPO / "src/backend/packaging/desktop/stage_content.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_staging_blocker_names_only_the_missing_input(tmp_path: Path) -> None:
    included = REPO / "content/included"
    tracked_files = subprocess.check_output(["git", "ls-files", "-z", "--", "content/included"], cwd=REPO).decode()
    tracked = {path.removeprefix("content/included/") for path in tracked_files.split("\0") if path}
    converted = tmp_path / "converted"
    derivatives = convert_included_tree(included, converted, tracked)
    renamed = {record["path"]: derived for derived, record in derivatives.items()}
    missing = "avatars/Andrew.vrm"
    (converted / missing).unlink()
    allowed = {renamed.get(path, path) for path in tracked} - {missing}

    with pytest.raises(SystemExit):
        _stage_content().stage(included, tracked - {missing}, converted, allowed, tmp_path / "out")

    blockers = json.loads((tmp_path / "out/content-blockers.json").read_text())
    assert [item["path"] for item in blockers["required_untracked_files"]] == [missing]


def test_the_catalog_seed_ships_converted_effect_art_that_reresolves(tmp_path: Path) -> None:
    source = tmp_path / "source"
    copy_tracked_included(source / "content/included")
    shutil.copytree(REPO / "licenses", source / "licenses")
    shutil.copyfile(REPO / "LICENSE", source / "LICENSE")
    seed = _catalog_seed()

    manifest = seed.prepare_seed(source, tmp_path / "seed", {"commit": "0" * 40, "tree": "1" * 40})

    included = tmp_path / "seed/included"
    _assert_ships_derivatives(manifest["inventory"], included)
    names = {entry["path"] for entry in manifest["files"]}
    assert {"included/" + row["path"] for row in manifest["inventory"]["files"]} | {
        "included/licenses/inventory.json"
    } == {name for name in names if name.startswith("included/")}
    # The repository-boundary consumer resolves the inventory from seed bytes alone.
    allowed = {name.removeprefix("included/") for name in names if name.startswith("included/")}
    assert starter_inventory(included, allowed_paths=allowed) == manifest["inventory"]
