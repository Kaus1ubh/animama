"""Portable package metadata must describe exactly one closed, supported graph."""

from __future__ import annotations

import copy
import json

import pytest
from pydantic import ValidationError

from animama.app.contracts.content_package import PackageManifest, portable_revision


def package_entry(entry_id: str, kind: str = "sound_effect", dependencies: list[dict] | None = None) -> dict:  # type: ignore[type-arg]
    files = [
        {
            "archive_path": f"entries/{entry_id}/tone.wav",
            "relative_path": "tone.wav",
            "role": "audio",
            "ordinal": 1,
            "media_type": "audio/wav",
            "size_bytes": 40,
            "sha256": "a" * 64,
        }
    ]
    return {
        "package_entry_id": entry_id,
        "kind": kind,
        "logical_key": entry_id,
        "display_name": entry_id,
        "portable_revision_sha256": portable_revision(files),
        "dependencies": dependencies or [],
        "files": files,
    }


def package_manifest() -> dict:  # type: ignore[type-arg]
    return {
        "schema": "animama-content-package/3",
        "kind": "content",
        "root_entry_ids": ["root"],
        "entries": [
            package_entry("root", "gesture", [{"ref": "sound", "content_type": "sound_effect"}]),
            package_entry("sound"),
        ],
        "avatar_portraits": [],
        "capabilities": [],
    }


@pytest.mark.parametrize(
    "case",
    [
        "duplicate-root",
        "missing-root",
        "missing-dependency",
        "wrong-kind",
        "cycle",
        "disconnected",
        "duplicate-entry",
        "association-type",
        "appearance-root",
        "anima-missing",
    ],
)
def test_rejects_graphs_that_do_not_exactly_match_selected_roots(case: str) -> None:
    manifest = package_manifest()
    if case == "duplicate-root":
        manifest["root_entry_ids"] *= 2
    elif case == "missing-root":
        manifest["root_entry_ids"] = ["absent"]
    elif case == "missing-dependency":
        manifest["entries"].pop()
    elif case == "wrong-kind":
        manifest["entries"][1]["kind"] = "pose"
    elif case == "cycle":
        manifest["entries"][1]["dependencies"] = [{"ref": "root", "content_type": "gesture"}]
    elif case == "disconnected":
        manifest["entries"].append(package_entry("orphan"))
    elif case == "duplicate-entry":
        manifest["entries"].append(copy.deepcopy(manifest["entries"][1]))
    elif case == "association-type":
        manifest["avatar_portraits"] = [{"avatar_entry_id": "root", "appearance_entry_id": "sound"}]
    elif case == "appearance-root":
        manifest["entries"][0]["kind"] = "appearance"
        manifest["entries"][0]["dependencies"] = []
        manifest["entries"].pop()
    else:
        manifest["kind"] = "anima"
        manifest["root_entry_ids"] = []
    with pytest.raises(ValidationError):
        PackageManifest.model_validate_json(json.dumps(manifest))


def test_preserves_root_order_and_shared_dependencies_without_duplicate_entries() -> None:
    manifest = package_manifest()
    manifest["root_entry_ids"] = ["sound", "root"]
    parsed = PackageManifest.model_validate_json(json.dumps(manifest))
    assert parsed.root_entry_ids == ["sound", "root"]
    assert [entry.package_entry_id for entry in parsed.entries] == ["root", "sound"]


@pytest.mark.parametrize(
    "field,value", [("source_owner", "private"), ("root_entry_id", "root"), ("schema", "animama-content-package/2")]
)
def test_rejects_private_unknown_and_old_manifest_fields(field: str, value: object) -> None:
    manifest = package_manifest()
    manifest[field] = value
    with pytest.raises(ValidationError):
        PackageManifest.model_validate_json(json.dumps(manifest))
