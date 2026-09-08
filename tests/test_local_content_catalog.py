from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import delete

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.domain.content_catalog import (
    ContentConflictError,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
    ScannedContentEntry,
    ScannedContentFile,
)
from animama.orm.content_catalog import ORMContentCatalogItem, ORMContentPreview

ROOT = Path(__file__).parents[1]


def _entry(locator: str, *, revision: str, file_digest: str, logical_key: str | None = None) -> ScannedContentEntry:
    return ScannedContentEntry(
        source=ContentSource.LOCAL,
        kind=ContentKind.GESTURE,
        relative_locator=locator,
        display_name="Wave",
        status=ContentStatus.VALID,
        revision_sha256=revision,
        logical_key=logical_key,
        files=(
            ScannedContentFile(
                relative_path=locator,
                role="primary",
                media_type="model/gltf-binary",
                size_bytes=16,
                sha256=file_digest,
            ),
        ),
    )


async def test_catalog_preserves_ids_references_and_reconciles_rename_delete(async_session) -> None:  # noqa: ANN001
    token = uuid.uuid4().hex
    first_locator = f"gestures/{token}-wave.vrma"
    renamed_locator = f"gestures/{token}-hello.vrma"
    revision_a = "a" * 64
    digest_a = "b" * 64
    repository = SQLAlchemyContentCatalog(async_session)

    first = await repository.reconcile_source(
        source=ContentSource.LOCAL,
        entries=[_entry(first_locator, revision=revision_a, file_digest=digest_a)],
        new_item_scope=ContentScope.OWNER,
        new_item_owner_user_id="owner-a",
    )
    item = next(entry for entry in first if entry.relative_locator == first_locator)
    item_id = item.id
    file_ref = item.files[0].file_ref

    changed = await repository.reconcile_source(
        source=ContentSource.LOCAL,
        entries=[_entry(first_locator, revision="c" * 64, file_digest="d" * 64)],
        new_item_scope=ContentScope.OWNER,
        new_item_owner_user_id="owner-a",
    )
    changed_item = next(entry for entry in changed if entry.relative_locator == first_locator)
    assert changed_item.id == item_id
    assert changed_item.files[0].file_ref == file_ref
    assert changed_item.files[0].sha256 == "d" * 64

    await repository.mark_scan_required(
        source=ContentSource.LOCAL,
        relative_paths=(first_locator.replace(".vrma", ".meta.json"),),
    )
    invalidated = await repository.list_visible(user_id="owner-a")
    invalidated_item = next(entry for entry in invalidated if entry.id == item_id)
    assert invalidated_item.status is ContentStatus.SCAN_REQUIRED

    renamed = await repository.reconcile_source(
        source=ContentSource.LOCAL,
        entries=[_entry(renamed_locator, revision="c" * 64, file_digest="d" * 64)],
        new_item_scope=ContentScope.OWNER,
        new_item_owner_user_id="owner-a",
    )
    renamed_item = next(entry for entry in renamed if entry.relative_locator == renamed_locator)
    assert renamed_item.id == item_id
    assert renamed_item.files[0].file_ref != file_ref

    missing = await repository.reconcile_source(
        source=ContentSource.LOCAL,
        entries=[],
        new_item_scope=ContentScope.OWNER,
        new_item_owner_user_id="owner-a",
    )
    missing_item = next(entry for entry in missing if entry.id == item_id)
    assert missing_item.status is ContentStatus.MISSING
    assert missing_item.files == ()
    assert missing_item.diagnostics[0].code == "missing_from_filesystem"

    await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id == item_id))
    await async_session.commit()


async def test_missing_included_tombstones_are_not_user_visible(async_session) -> None:  # noqa: ANN001
    token = uuid.uuid4().hex
    locator = f"gestures/{token}-retired.vrma"
    repository = SQLAlchemyContentCatalog(async_session)
    included = replace(
        _entry(locator, revision="a" * 64, file_digest="b" * 64),
        source=ContentSource.INCLUDED,
    )

    created = await repository.reconcile_source(
        source=ContentSource.INCLUDED,
        entries=[included],
        new_item_scope=ContentScope.INCLUDED,
        new_item_owner_user_id=None,
    )
    item_id = next(item.id for item in created if item.relative_locator == locator)
    reconciled = await repository.reconcile_source(
        source=ContentSource.INCLUDED,
        entries=[],
        new_item_scope=ContentScope.INCLUDED,
        new_item_owner_user_id=None,
    )

    assert next(item for item in reconciled if item.id == item_id).status is ContentStatus.MISSING
    assert item_id not in {item.id for item in await repository.list_visible(user_id="owner-a")}

    await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id == item_id))
    await async_session.commit()


async def test_catalog_resolves_declared_logical_dependencies(async_session) -> None:  # noqa: ANN001
    token = uuid.uuid4().hex
    target = _entry(
        f"gestures/{token}-target.vrma",
        revision="1" * 64,
        file_digest="2" * 64,
        logical_key=f"local:gesture:{token}",
    )
    root = ScannedContentEntry(
        source=ContentSource.LOCAL,
        kind=ContentKind.REACTION,
        relative_locator=f"reactions/{token}",
        display_name="Reaction",
        status=ContentStatus.VALID,
        revision_sha256="3" * 64,
        dependencies=(f"local:gesture:{token}",),
    )
    repository = SQLAlchemyContentCatalog(async_session)

    items = await repository.reconcile_source(
        source=ContentSource.LOCAL,
        entries=[target, root],
        new_item_scope=ContentScope.OWNER,
        new_item_owner_user_id="owner-a",
    )

    reaction = next(item for item in items if item.kind is ContentKind.REACTION)
    gesture = next(item for item in items if item.relative_locator == target.relative_locator)
    assert reaction.status is ContentStatus.VALID
    assert reaction.dependencies == (f"local:gesture:{token}",)
    await repository.mark_scan_required(
        source=ContentSource.LOCAL,
        relative_paths=(target.relative_locator,),
    )
    invalidated = await repository.list_visible(user_id="owner-a")
    assert next(item for item in invalidated if item.id == gesture.id).status is ContentStatus.SCAN_REQUIRED
    assert next(item for item in invalidated if item.id == reaction.id).status is ContentStatus.SCAN_REQUIRED
    await async_session.execute(
        delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([item.id for item in items]))
    )
    await async_session.commit()


async def test_catalog_invalidates_dependents_of_invalid_entries(async_session) -> None:  # noqa: ANN001
    token = uuid.uuid4().hex
    invalid_target = ScannedContentEntry(
        source=ContentSource.LOCAL,
        kind=ContentKind.GESTURE,
        relative_locator=f"gestures/{token}-invalid.vrma",
        display_name="Invalid gesture",
        status=ContentStatus.INVALID,
        revision_sha256="4" * 64,
        logical_key=f"local:gesture:{token}",
    )
    dependent = ScannedContentEntry(
        source=ContentSource.LOCAL,
        kind=ContentKind.REACTION,
        relative_locator=f"reactions/{token}",
        display_name="Dependent reaction",
        status=ContentStatus.VALID,
        revision_sha256="5" * 64,
        dependencies=(f"local:gesture:{token}",),
    )
    repository = SQLAlchemyContentCatalog(async_session)

    items = await repository.reconcile_source(
        source=ContentSource.LOCAL,
        entries=[invalid_target, dependent],
        new_item_scope=ContentScope.OWNER,
        new_item_owner_user_id="owner-a",
    )

    reaction = next(item for item in items if item.kind is ContentKind.REACTION)
    assert reaction.status is ContentStatus.INVALID
    assert any(diagnostic.code == "unresolved_dependency" for diagnostic in reaction.diagnostics)
    await async_session.execute(
        delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([item.id for item in items]))
    )
    await async_session.commit()


async def test_included_projection_persists_with_resolved_dependencies(async_session) -> None:  # noqa: ANN001
    scanned = FilesystemContentStore(
        included_root=ROOT / "content/included",
        local_root=ROOT / "content/local",
        operations_root=ROOT / "data/internal/operations",
    ).scan(ContentSource.INCLUDED)
    repository = SQLAlchemyContentCatalog(async_session)

    items = await repository.reconcile_source(
        source=ContentSource.INCLUDED,
        entries=scanned,
        new_item_scope=ContentScope.INCLUDED,
        new_item_owner_user_id=None,
    )

    invalid = [item for item in items if item.status is ContentStatus.INVALID]
    assert invalid == []
    assert len(items) == len(scanned)
    assert all(item.scope is ContentScope.INCLUDED for item in items)
    assert all(item.owner_user_id is None for item in items)
    assert all(file.file_ref for item in items for file in item.files)
    await async_session.execute(
        delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([item.id for item in items]))
    )
    await async_session.commit()


async def test_included_mount_versions_keep_identity_and_unmounted_packs_withdraw_atomically(async_session) -> None:  # noqa: ANN001
    token = uuid.uuid4().hex
    core = replace(
        _entry(f"gestures/{token}-core.vrma", revision="a" * 64, file_digest="b" * 64),
        source=ContentSource.INCLUDED,
        source_mount_id="core@v1",
    )
    pack = replace(
        _entry(f"gestures/{token}-pack.vrma", revision="c" * 64, file_digest="d" * 64),
        source=ContentSource.INCLUDED,
        source_mount_id="expanded@v1",
    )
    repository = SQLAlchemyContentCatalog(async_session)

    async def reconcile(entries: list[ScannedContentEntry], mounts: tuple[str, ...]):
        await repository.lock_source(source=ContentSource.INCLUDED)
        return await repository.reconcile_source(
            source=ContentSource.INCLUDED,
            entries=entries,
            active_included_mount_ids=mounts,
            new_item_scope=ContentScope.INCLUDED,
            new_item_owner_user_id=None,
        )

    items = await reconcile([core, pack], ("core@v1", "expanded@v1"))
    core_item = next(item for item in items if item.relative_locator == core.relative_locator)
    pack_item = next(item for item in items if item.relative_locator == pack.relative_locator)
    assert core_item.files[0].source_mount_id == "core@v1"
    preview = await repository.create_preview(
        item=pack_item, user_id="mount-owner", expires_at=datetime.now(timezone.utc) + timedelta(minutes=5)
    )
    assert preview.files[0].source_mount_id == "expanded@v1"
    with pytest.raises(ContentConflictError, match="included_source_in_use"):
        await reconcile([core], ("core@v1",))
    await async_session.rollback()
    assert await async_session.get(ORMContentCatalogItem, pack_item.id) is not None
    await async_session.execute(delete(ORMContentPreview).where(ORMContentPreview.id == preview.id))
    await async_session.commit()
    updated = await reconcile([replace(core, source_mount_id="core@v2")], ("core@v2",))
    assert await async_session.get(ORMContentCatalogItem, pack_item.id) is None
    kept = next(item for item in updated if item.id == core_item.id)
    assert kept.status is ContentStatus.VALID
    assert kept.files[0].file_ref == core_item.files[0].file_ref
    assert kept.files[0].source_mount_id == "core@v2"
    assert not any(item.status is ContentStatus.MISSING for item in updated)
    await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id == core_item.id))
    await async_session.commit()


async def test_same_bytes_cannot_transfer_catalog_identity_between_included_sources(async_session) -> None:  # noqa: ANN001
    token = uuid.uuid4().hex
    core = replace(
        _entry(f"gestures/{token}-old.vrma", revision="a" * 64, file_digest="b" * 64),
        source=ContentSource.INCLUDED,
        source_mount_id="core@v1",
    )
    repository = SQLAlchemyContentCatalog(async_session)
    original = await repository.reconcile_source(
        source=ContentSource.INCLUDED,
        entries=[core],
        active_included_mount_ids=("core@v1",),
        new_item_scope=ContentScope.INCLUDED,
        new_item_owner_user_id=None,
    )
    old = next(item for item in original if item.relative_locator == core.relative_locator)
    renamed = replace(
        core,
        relative_locator=f"gestures/{token}-new.vrma",
        source_mount_id="expanded@v1",
        files=tuple(replace(file, relative_path=f"gestures/{token}-new.vrma") for file in core.files),
    )
    updated = await repository.reconcile_source(
        source=ContentSource.INCLUDED,
        entries=[renamed],
        active_included_mount_ids=("core@v1", "expanded@v1"),
        new_item_scope=ContentScope.INCLUDED,
        new_item_owner_user_id=None,
    )
    new = next(item for item in updated if item.relative_locator == renamed.relative_locator)
    assert new.id != old.id
    assert next(item for item in updated if item.id == old.id).status is ContentStatus.MISSING
    await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([old.id, new.id])))
    await async_session.commit()
