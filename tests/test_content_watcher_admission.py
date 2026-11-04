"""Delayed host events must not undo a committed save's catalog admission."""

from __future__ import annotations

import asyncio
import json
import shutil
import wave
from collections.abc import AsyncIterator
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest

from animama.app.services.typed_content_service import TypedContentService
from animama.domain.content_catalog import ContentKind, ContentNotFoundError, ContentScope, ContentSource, ContentStatus
from animama.local.database import LocalDatabase
from animama.server.config import Settings
from tests.content_package_helpers import package_services, save_wave, vrma
from tests.migration_database_helpers import (
    migrated_database as migrated_database,
    migration_postgres as migration_postgres,
)

OWNER = "package-owner"


@pytest.fixture
async def database(migrated_database: str) -> AsyncIterator[LocalDatabase]:  # noqa: F811
    """Create application resources over the freshly migrated owned database."""
    owned = LocalDatabase(Settings(animama_database_url=migrated_database))
    try:
        yield owned
    finally:
        await owned.close()


@pytest.fixture
async def services(database: LocalDatabase, tmp_path: Path) -> AsyncIterator[tuple[Any, ...]]:
    """Use only temporary Local files and an application-owned session."""
    async with database.session_factory()() as session:
        yield package_services(session, tmp_path)


def _scene_document(color: str = "#123456") -> dict[str, Any]:
    return {
        "schema_version": 1,
        "content_type": "scene_effect",
        "id": "local:scene-effect:scene",
        "name": "Scene",
        # A complete definition: Save validates Scene definitions.
        "definition": {
            "schema": "animama/scene-effect/1",
            "kind": "background_layers",
            "solid": {"enabled": True, "color": color},
            "pattern": {
                "enabled": False,
                "pattern": "none",
                "color": "#ffffff",
                "size": 16,
                "spacing": 16,
                "opacity": 0.5,
            },
            "marquee": {
                "enabled": False,
                "items": [],
                "itemSize": 64,
                "gap": 16,
                "rowGap": 16,
                "direction": "static",
                "itemRotationMode": "upright",
                "itemRotationOffsetDeg": 0,
                "speedPxPerSec": 0,
                "opacity": 1,
            },
        },
        "files": [],
    }


async def _save_scene(saves, *, previous=None):
    return await saves.save_descriptor(
        user_id=OWNER,
        kind=ContentKind.SCENE_EFFECT,
        entry_name="Scene",
        descriptor=json.dumps(_scene_document("#654321" if previous else "#123456")).encode(),
        companion_files={},
        operation_id="scene-update" if previous else "scene-create",
        catalog_item_id=previous.id if previous else None,
        expected_revision=previous.revision_sha256 if previous else None,
    )


@pytest.mark.parametrize("kind", ["scene", "standalone"])
async def test_delayed_own_file_and_ancestor_events_preserve_created_and_updated_reads(services, kind: str) -> None:
    paths, catalog, content, saves, _ = services
    saved = await _save_scene(saves) if kind == "scene" else await save_wave(saves)
    typed = TypedContentService(catalog=catalog, content=content)
    for version in range(2):
        if version:
            previous = saved.item
            if kind == "scene":
                saved = await _save_scene(saves, previous=previous)
            else:
                saved = await saves.save_standalone(
                    user_id=OWNER,
                    kind=ContentKind.GESTURE,
                    entry_name="Friendly Wave",
                    filename="wave.vrma",
                    payload=vrma("updated"),
                    metadata_sidecar=json.dumps({"id": previous.logical_key, "name": "Friendly Wave"}).encode(),
                    operation_id="wave-update",
                    catalog_item_id=previous.id,
                    expected_revision=previous.revision_sha256,
                )
        # The host callback may be delayed until both publication commits and
        # journal finalization have completed. Ancestors must not fence siblings.
        notifications = (
            saved.item.files[0].relative_path,
            saved.item.relative_locator,
            saved.item.relative_locator.split("/")[0],
        )
        await content.invalidate_watched_changes(source=ContentSource.LOCAL, relative_paths=notifications)
        read = await typed.get(user_id=OWNER, kind=saved.item.kind, item_id=saved.item.id)
        assert read.item.status is ContentStatus.VALID
        assert read.item.revision_sha256 == saved.item.revision_sha256
        assert (
            await typed.preview(user_id=OWNER, kind=saved.item.kind, item_id=saved.item.id)
        ).item.item.id == saved.item.id
        assert not list(paths.operations_root.glob("mutation-*.json"))


@pytest.mark.parametrize(
    "change", ["same_size_bytes", "deleted", "membership", "symlink", "scan_failure", "recovery_failure"]
)
async def test_external_or_unknown_change_still_fences_saved_scene(
    services, monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    paths, catalog, content, saves, _ = services
    saved = await _save_scene(saves)
    descriptor = paths.local_root / saved.item.files[0].relative_path
    if change == "same_size_bytes":
        descriptor.write_bytes(descriptor.read_bytes().replace(b"#123456", b"#654321"))
    elif change == "deleted":
        descriptor.unlink()
    elif change == "membership":
        (descriptor.parent / "unexpected.txt").write_text("unreviewed companion")
    elif change == "symlink":
        target = paths.local_root.parent / "external.json"
        target.write_bytes(descriptor.read_bytes())
        descriptor.unlink()
        descriptor.symlink_to(target)
    elif change == "scan_failure":

        def failed_scan(_source):
            raise OSError("owned test scan failure")

        monkeypatch.setattr(content.mutations.store, "scan", failed_scan)
    else:

        async def failed_recovery():
            raise RuntimeError("owned test blocked journal")

        monkeypatch.setattr(content.mutations, "_recover", failed_recovery)
    await content.invalidate_watched_changes(source=ContentSource.LOCAL, relative_paths=(saved.item.relative_locator,))
    current = await catalog.get_visible_item(item_id=saved.item.id, user_id=OWNER)
    assert current.status is ContentStatus.SCAN_REQUIRED
    with pytest.raises(ContentNotFoundError):
        await TypedContentService(catalog=catalog, content=content).get(
            user_id=OWNER, kind=ContentKind.SCENE_EFFECT, item_id=saved.item.id
        )


def _wav(frame: bytes) -> bytes:
    audio = BytesIO()
    with wave.open(audio, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(frame * 800)
    return audio.getvalue()


@pytest.mark.parametrize("change", ["changed_target", "duplicate_target"])
async def test_dependency_changes_fence_unchanged_dependents(services, change: str) -> None:
    paths, catalog, content, saves, _ = services
    target = (
        await saves.save_standalone(
            user_id=OWNER,
            kind=ContentKind.SOUND_EFFECT,
            entry_name="Chime",
            filename="chime.wav",
            payload=_wav(b"\x01\x00"),
            metadata_sidecar=json.dumps({"schema_version": 1, "id": "local:sound:chime", "name": "Chime"}).encode(),
            operation_id="chime",
            catalog_item_id=None,
            expected_revision=None,
        )
    ).item
    dependent = (
        await saves.save_descriptor(
            user_id=OWNER,
            kind=ContentKind.GESTURE,
            entry_name="Dependent",
            descriptor=json.dumps(
                {
                    "schema_version": 1,
                    "content_type": "gesture",
                    "content_id": "local:gesture:dependent",
                    "name": "Dependent",
                    "semantic_key": "dependent",
                    "implementation": {"kind": "vrma", "file_role": "animation"},
                    "files": [{"path": "motion.vrma", "role": "animation"}],
                    "dependencies": [{"ref": target.logical_key, "content_type": "sound_effect"}],
                }
            ).encode(),
            companion_files={"motion.vrma": vrma("dependent")},
            operation_id="dependent",
            catalog_item_id=None,
            expected_revision=None,
        )
    ).item
    assert dependent.dependency_item_ids == (target.id,)
    target_path = paths.local_root / target.relative_locator
    if change == "changed_target":
        target_path.write_bytes(_wav(b"\x02\x00"))
        changed_path = target.relative_locator
    else:
        duplicate = target_path.with_name("duplicate.wav")
        shutil.copyfile(target_path, duplicate)
        shutil.copyfile(target_path.with_suffix(".meta.json"), duplicate.with_suffix(".meta.json"))
        changed_path = duplicate.relative_to(paths.local_root).as_posix()
    await content.invalidate_watched_changes(source=ContentSource.LOCAL, relative_paths=(changed_path,))
    for item_id in (target.id, dependent.id):
        assert (await catalog.get_visible_item(item_id=item_id, user_id=OWNER)).status is ContentStatus.SCAN_REQUIRED


async def test_included_license_notification_remains_unconditional(services, monkeypatch: pytest.MonkeyPatch) -> None:
    _, catalog, content, saves, _ = services
    await _save_scene(saves)
    scanned = content.mutations.store.scan(ContentSource.LOCAL)
    included = await catalog.reconcile_source(
        source=ContentSource.INCLUDED,
        entries=[replace(item, source=ContentSource.INCLUDED) for item in scanned],
        new_item_scope=ContentScope.INCLUDED,
        new_item_owner_user_id=None,
    )
    assert len(included) == 1 and included[0].status is ContentStatus.VALID

    def unexpected_scan(_source):
        pytest.fail("Included must not use the Local redundant-event optimization")

    monkeypatch.setattr(content.mutations.store, "scan", unexpected_scan)
    await content.invalidate_watched_changes(source=ContentSource.INCLUDED, relative_paths=("licenses",))
    assert (await catalog.get_visible_item(item_id=included[0].id, user_id=OWNER)).status is ContentStatus.SCAN_REQUIRED


async def test_watcher_waits_for_inflight_save_then_preserves_committed_admission(
    services,
    database: LocalDatabase,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, _, _, saves, _ = services
    staged = asyncio.Event()
    release = asyncio.Event()
    original_finish = saves._finish

    async def pause_before_commit(**kwargs):
        result = await original_finish(**kwargs)
        staged.set()
        await release.wait()
        return result

    monkeypatch.setattr(saves, "_finish", pause_before_commit)
    save_task = asyncio.create_task(_save_scene(saves))
    watch_task = None
    try:
        await asyncio.wait_for(staged.wait(), timeout=5)
        async with database.session_factory()() as other_session:
            _, other_catalog, other_content, _, _ = package_services(other_session, tmp_path)
            watch_task = asyncio.create_task(
                other_content.invalidate_watched_changes(source=ContentSource.LOCAL, relative_paths=("vfx",))
            )
            # Save has written/scanned its files but has not committed. A second
            # real connection must wait for its source fence, not invalidate an
            # incomplete view of the catalog or recover its active journal.
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(watch_task), timeout=0.1)
            release.set()
            saved = await asyncio.wait_for(save_task, timeout=5)
            await asyncio.wait_for(watch_task, timeout=5)
            current = await other_catalog.get_visible_item(item_id=saved.item.id, user_id=OWNER)
            assert current.status is ContentStatus.VALID
            assert current.revision_sha256 == saved.item.revision_sha256
    finally:
        release.set()
        await asyncio.gather(save_task, *([watch_task] if watch_task else []), return_exceptions=True)
