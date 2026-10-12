from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services.content_kind_registry import definition_for_kind, descriptor_filename, handler_for_kind
from animama.app.services.idle_playback import derive_idle_playback
from animama.domain.content_catalog import ContentKind, ContentSource, ContentStatus
from animama.domain.content_documents import GestureDocumentV1
from tests.anima_creation_service_support import (
    INCLUDED_POSE_IDS,
    copy_tracked_included,
    write_supplied_animation_fixture,
)

ROOT = Path(__file__).parents[1]


@pytest.fixture(scope="module")
def included(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return copy_tracked_included(tmp_path_factory.mktemp("tracked-included"))


def _scan_included(included: Path) -> list[Any]:
    return FilesystemContentStore(
        included_root=included,
        local_root=included.parent / "local",
        operations_root=included.parent / "operations",
    ).scan(ContentSource.INCLUDED)


def test_readable_included_library_projects_every_supported_entry(included: Path) -> None:
    entries = _scan_included(included)

    # Check actual committed product inputs rather than a count inflated by
    # private examples that are intentionally absent from the public checkout.
    tracked = subprocess.check_output(["git", "ls-files", "-z", "--", "content/included"], cwd=ROOT)
    expected_files = {
        name.removeprefix("content/included/")
        for name in tracked.decode().split("\0")
        if name.endswith(".meta.json") or (name.startswith("content/included/avatars/") and name.endswith(".vrm"))
    }
    assert expected_files
    assert expected_files <= {file.relative_path for entry in entries for file in entry.files}
    assert all(entry.status is ContentStatus.VALID for entry in entries)
    logical_keys = [entry.logical_key for entry in entries if entry.logical_key]
    assert len(logical_keys) == len(set(logical_keys))
    assert {entry.kind for entry in entries} >= {
        ContentKind.POSE,
        ContentKind.AVATAR,
        ContentKind.GESTURE,
        ContentKind.REACTION,
        ContentKind.PARTICLE_EFFECT,
        ContentKind.AVATAR_EFFECT,
        ContentKind.SCENE_EFFECT,
        ContentKind.APPEARANCE,
    }
    assert ContentKind.POSE_CLIP not in {entry.kind for entry in entries}
    assert ContentKind.ANIMA not in {entry.kind for entry in entries}


def test_representative_included_entries_are_human_locatable(included: Path) -> None:
    by_locator = {entry.relative_locator: entry for entry in _scan_included(included)}

    assert "avatars/AvatarSample_A_1_New.vrm" in by_locator
    assert "gestures/have-an-idea" in by_locator
    assert "reactions/admiration-2" in by_locator
    assert "vfx/particle/quark/hearts" in by_locator
    assert by_locator["gestures/have-an-idea"].logical_key == "builtin:gesture:have-an-idea"
    assert by_locator["reactions/admiration-2"].dependencies

    for entry in by_locator.values():
        assert not Path(entry.relative_locator).is_absolute()
        assert entry.revision_sha256 is not None
        assert entry.provenance["redistribution_review"] == "pending"
        assert all(not Path(file.relative_path).is_absolute() for file in entry.files)
        if entry.descriptor_relative_path:
            descriptor = Path(entry.descriptor_relative_path)
            assert descriptor.name == descriptor_filename(
                definition_for_kind(entry.kind),
                descriptor.parent.name,
            )


def test_included_actions_own_their_primary_playback_files(included: Path) -> None:
    """Descriptors own playback within their folder, including user-supplied motion."""

    assert not list((included / "gestures").glob("*.vrma"))
    assert not list((included / "pose-clips").glob("*.json"))

    for family in ("gestures", "reactions"):
        for action_root in sorted(path for path in (included / family).iterdir() if path.is_dir()):
            slug = action_root.name
            assert (action_root / f"{slug}.meta.json").is_file()
            document = json.loads((action_root / f"{slug}.meta.json").read_text())
            for item in document["files"]:
                reference = Path(item["path"])
                assert not reference.is_absolute() and ".." not in reference.parts
                if reference.suffix == ".vrma":
                    assert not (action_root / reference).exists()
                else:
                    assert (action_root / reference).is_file()

    assert not list(included.rglob("*.vrma"))


def test_supplied_original_fixture_actions_have_valid_owned_playback(tmp_path: Path) -> None:
    supplied = write_supplied_animation_fixture(tmp_path / "supplied")
    entries = _scan_included(supplied)
    assert entries and all(entry.status is ContentStatus.VALID for entry in entries)
    for entry in entries:
        for file in entry.files:
            assert (supplied / file.relative_path).is_file()


def test_authoring_resources_are_not_registered_as_typed_products(included: Path) -> None:
    """App-versioned creator palettes stay outside every scannable kind root."""

    entries = _scan_included(included)
    locators = {entry.relative_locator for entry in entries}

    assert not any(locator.startswith("resources/") for locator in locators)
    assert not any(locator.startswith("vfx/avatar/misc/") for locator in locators)
    assert (ROOT / "content/included/resources/scene-vfx/twemoji/2728.svg").is_file()
    assert not (ROOT / "content/included/vfx/avatar/misc").exists()


def test_every_included_sound_dependency_resolves_to_a_shipped_sound(included: Path) -> None:
    """Required sound edges resolve here; optional ones name a sound in the private pack.

    The scan drops optional edges whose sound isn't mounted, so they are checked
    against the tracked pack manifest in the raw descriptors instead.
    """

    manifest = json.loads(
        (ROOT / "src/backend/animama/resources/wow-comedy-sfx-manifest.json").read_text(encoding="utf-8")
    )
    pack_keys = {
        "builtin:sound-effect:" + Path(item["path"]).stem for item in manifest["files"] if item["path"].endswith(".ogg")
    }
    optional = sorted(
        {
            edge["ref"]
            for path in included.rglob("*.json")
            for edge in _raw_dependencies(path)
            if edge.get("optional") is True
        }
    )
    assert set(optional) <= pack_keys, sorted(set(optional) - pack_keys)

    entries = _scan_included(included)
    sound_keys = {
        entry.logical_key
        for entry in entries
        if entry.kind is ContentKind.SOUND_EFFECT
        and entry.status is ContentStatus.VALID
        and entry.logical_key is not None
    }
    unresolved = sorted(
        {
            dependency
            for entry in entries
            for dependency in entry.dependencies
            if dependency.startswith("builtin:sound-effect:") and dependency not in sound_keys
        }
    )

    assert unresolved == []


def test_included_poses_are_registered_self_contained_content(included: Path) -> None:
    expected_ids = INCLUDED_POSE_IDS
    poses = [entry for entry in _scan_included(included) if entry.kind is ContentKind.POSE]
    assert {entry.logical_key for entry in poses} == expected_ids
    for entry in poses:
        assert entry.status is ContentStatus.VALID
        assert entry.dependencies == ()
        assert entry.relative_locator == f"poses/{entry.logical_key}"
        assert len(entry.files) == 1 and entry.files[0].role == "descriptor"
        assert entry.descriptor_relative_path == f"poses/{entry.logical_key}/{entry.logical_key}.json"
        document = json.loads((included / entry.descriptor_relative_path).read_text())
        assert document["content_id"] == document["pose"]["id"] == entry.logical_key
        assert document["name"] == document["pose"]["name"] == entry.display_name
        assert "parent" not in document["pose"]


def test_avatar_effects_require_authored_definitions_and_preserve_support_images(included: Path) -> None:
    """Raw creator artwork is not a playable library effect."""

    effects = [entry for entry in _scan_included(included) if entry.kind is ContentKind.AVATAR_EFFECT]
    descriptors = {
        path.parent.relative_to(included).as_posix()
        for path in (included / "vfx/avatar").rglob("*.json")
        if path.name == f"{path.parent.name}.json"
    }

    assert descriptors
    assert {entry.relative_locator for entry in effects} == descriptors
    assert all(entry.status is ContentStatus.VALID and entry.metadata.get("definition") for entry in effects)
    eye = next(entry for entry in effects if entry.logical_key == "builtin:avatar-effect:eye")
    assert any(file.role == "image" for file in eye.files)


def test_streamer_idle_style_resolves_to_idle_eligible_included_gestures(included: Path) -> None:
    """The Included Idle Style names only Included Gestures that idle playback admits."""

    by_key = {entry.logical_key: entry for entry in _scan_included(included) if entry.logical_key}
    style = by_key["builtin:idle-style:streamer-idle"]
    assert style.kind is ContentKind.IDLE_STYLE
    assert style.status is ContentStatus.VALID
    assert len(style.dependencies) == 12

    gesture_handler = handler_for_kind(ContentKind.GESTURE)
    for ref in style.dependencies:
        gesture = by_key[ref]
        assert gesture.kind is ContentKind.GESTURE and gesture.status is ContentStatus.VALID, ref
        assert gesture.source is ContentSource.INCLUDED, ref
        descriptor = Path(gesture.descriptor_relative_path)
        document = gesture_handler.parse_document(
            json.loads((included / descriptor).read_text(encoding="utf-8")),
            fallback_path=descriptor,
            descriptor_backed=True,
        ).document
        assert isinstance(document, GestureDocumentV1), ref
        [sequence] = [file for file in gesture.files if file.role == "sequence"]
        with (included / sequence.relative_path).open("rb") as clip:
            facts = derive_idle_playback(document, clip)
        assert facts.eligible, (ref, facts.reason)


def _raw_dependencies(path: Path) -> list[dict[str, Any]]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return []
    dependencies = value.get("dependencies") if isinstance(value, dict) else None
    return [edge for edge in dependencies or [] if isinstance(edge, dict)]
