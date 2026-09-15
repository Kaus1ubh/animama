from __future__ import annotations

import subprocess
from pathlib import Path

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services.content_kind_registry import definition_for_kind, descriptor_filename
from animama.domain.content_catalog import ContentKind, ContentSource, ContentStatus

ROOT = Path(__file__).parents[1]


def _scan_included() -> list:
    return FilesystemContentStore(
        included_root=ROOT / "content/included",
        local_root=ROOT / "content/local",
        operations_root=ROOT / "data/internal/operations",
    ).scan(ContentSource.INCLUDED)


def test_readable_included_library_projects_every_supported_entry() -> None:
    entries = _scan_included()

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
        ContentKind.AVATAR,
        ContentKind.GESTURE,
        ContentKind.REACTION,
        ContentKind.PARTICLE_EFFECT,
        ContentKind.AVATAR_EFFECT,
        ContentKind.SCENE_EFFECT,
        ContentKind.IDLE_STYLE,
        ContentKind.APPEARANCE,
    }
    assert ContentKind.POSE_CLIP not in {entry.kind for entry in entries}
    assert ContentKind.ANIMA not in {entry.kind for entry in entries}


def test_representative_included_entries_are_human_locatable() -> None:
    by_locator = {entry.relative_locator: entry for entry in _scan_included()}

    assert "avatars/AvatarSample_A_1_New.vrm" in by_locator
    assert "gestures/wave" in by_locator
    assert "reactions/admiration-2" in by_locator
    assert "vfx/particle/quark/hearts" in by_locator
    assert by_locator["gestures/wave"].logical_key == "builtin:gesture:wave"
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


def test_included_actions_own_their_primary_playback_files() -> None:
    """Shipped Actions use one folder instead of separate Pose Clip products."""

    included = ROOT / "content/included"
    assert not list((included / "gestures").glob("*.vrma"))
    assert not list((included / "pose-clips").glob("*.json"))

    for family in ("gestures", "reactions"):
        for action_root in sorted(path for path in (included / family).iterdir() if path.is_dir()):
            slug = action_root.name
            assert (action_root / f"{slug}.meta.json").is_file()
            assert (action_root / f"{slug}.json").is_file() or (action_root / f"{slug}.vrma").is_file()

    starter = included / "idle-styles/starter"
    assert sorted(path.name for path in (starter / "animations").glob("*.vrma")) == [
        "angry.vrma",
        "anxious_look_around.vrma",
        "bored.vrma",
        "happy.vrma",
        "sad.vrma",
        "sway.vrma",
    ]


def test_authoring_resources_are_not_registered_as_typed_products() -> None:
    """App-versioned creator palettes stay outside every scannable kind root."""

    entries = _scan_included()
    locators = {entry.relative_locator for entry in entries}

    assert not any(locator.startswith("resources/") for locator in locators)
    assert not any(locator.startswith("vfx/avatar/misc/") for locator in locators)
    assert (ROOT / "content/included/resources/scene-vfx/twemoji/2728.svg").is_file()
    assert not (ROOT / "content/included/vfx/avatar/misc").exists()


def test_every_included_sound_dependency_resolves_to_a_shipped_sound() -> None:
    """Effects and Actions cannot depend on an omitted private sound pack."""

    entries = _scan_included()
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
