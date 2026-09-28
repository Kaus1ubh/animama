"""Converted motions install as optional Local items without overwriting edits."""

from __future__ import annotations

import json
import runpy
from pathlib import Path

import pytest

from animama.adapters.content_store import FilesystemContentStore
from animama.domain.content_catalog import ContentKind, ContentSource, ContentStatus
from tests.anima_creation_service_support import glb

ROOT = Path(__file__).resolve().parents[1]
INSTALL = runpy.run_path(str(ROOT / "scripts/acquire-mixamo.py"))["install"]


@pytest.fixture
def converted(tmp_path):
    manifest = json.loads((ROOT / "scripts/mixamo-assets.json").read_text())
    source = tmp_path / "converted"
    for asset in manifest["assets"]:
        if not asset["starter_target"]:
            continue
        path = source / Path(asset["target_path"]).relative_to("content/included")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(
            glb(
                {
                    "asset": {"version": "2.0"},
                    "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
                    "animations": [{"channels": [], "samplers": []}],
                }
            )
        )
    return manifest, source, tmp_path / "local"


def test_install_and_retry_admit_regular_local_items_without_included_dependencies(converted, tmp_path):
    manifest, source, local = converted
    first = INSTALL(manifest, source, local)
    assert first["animation_files"] == 29
    assert len(first["items"]) == 30
    assert {item["outcome"] for item in first["items"]} == {"installed"}
    again = INSTALL(manifest, source, local)
    assert {item["outcome"] for item in again["items"]} == {"existing"}
    entries = FilesystemContentStore(
        included_root=tmp_path / "empty-included", local_root=local, operations_root=tmp_path / "operations"
    ).scan(ContentSource.LOCAL)
    assert len(entries) == 30
    assert all(item.status is ContentStatus.VALID for item in entries), [
        (item.logical_key, item.diagnostics) for item in entries if item.status is not ContentStatus.VALID
    ]
    assert all(item.logical_key is not None and item.logical_key.startswith("local:") for item in entries)
    assert sum(item.kind is ContentKind.GESTURE for item in entries) == 29
    idle = next(item for item in entries if item.kind is ContentKind.IDLE_STYLE)
    assert not any(file.role == "animation" for file in idle.files)
    assert idle.metadata["schema_version"] == 2
    assert idle.metadata["default_pool"] == ["local:gesture:mixamo-idle-sway"]
    assert idle.metadata["cells"]["joy"] == {
        str(level): {"mode": "pool", "gestures": ["local:gesture:mixamo-idle-happy", "local:gesture:mixamo-idle-sway"]}
        for level in (1, 2, 3)
    }
    assert len(idle.dependencies) == 6
    sway = next(item for item in entries if item.logical_key == "local:gesture:mixamo-idle-sway")
    assert sway.metadata["config"] == {
        "loop_type": "pingpong",
        "duration_seconds": 9.92,
        "time_scale": 0.6,
        "loop_count": 1,
        "base_pose": "relaxedRest",
        "blend_mode": "override",
    }
    assert sway.metadata["name"] == "Idle Sway"
    assert sway.metadata["description"] == "Gentle swaying idle for relaxed or chill contexts."
    assert sum(file.role == "animation" for file in sway.files) == 1


def test_install_preserves_owner_edits(converted):
    manifest, source, local = converted
    INSTALL(manifest, source, local)
    edited = local / "gestures/mixamo-wave/mixamo-wave.meta.json"
    document = json.loads(edited.read_text())
    document["name"] = "My edited wave"
    edited.write_text(json.dumps(document))
    with pytest.raises(ValueError, match="Existing Local content differs"):
        INSTALL(manifest, source, local)
    assert json.loads(edited.read_text())["name"] == "My edited wave"


@pytest.mark.parametrize("invalid", ["missing", "fbx", "truncated", "symlink"])
def test_invalid_converted_input_installs_nothing(converted, invalid):
    manifest, source, local = converted
    path = source / "gestures/wave/wave.vrma"
    if invalid == "missing":
        path.unlink()
    elif invalid == "fbx":
        path.write_bytes(b"Kaydara FBX Binary  " * 10)
    elif invalid == "truncated":
        path.write_bytes(path.read_bytes()[:-1])
    else:
        payload = path.with_suffix(".backup")
        path.rename(payload)
        path.symlink_to(payload)
    with pytest.raises((OSError, ValueError)):
        INSTALL(manifest, source, local)
    assert not local.exists()


def test_symlinked_destination_cannot_escape_local_root(converted, tmp_path):
    manifest, source, local = converted
    local.mkdir()
    other = tmp_path / "other"
    other.mkdir()
    (local / "gestures").symlink_to(other, target_is_directory=True)
    with pytest.raises(ValueError, match="Symlink"):
        INSTALL(manifest, source, local)
    assert not list(other.iterdir())
