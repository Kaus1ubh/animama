from __future__ import annotations

import hashlib
import json
import struct
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, func, inspect, select, text, update
from sqlalchemy.exc import DBAPIError

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.anima_runtime_service import (
    AnimaRuntimeService,
    RuntimeSnapshotError,
)
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.domain.content_catalog import ContentKind, ContentSource
from animama.domain.runtime_content_descriptor import (
    RuntimeContentDescriptor,
    RuntimeContentEntry,
    RuntimeContentMember,
)
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout, ORMAnimaRuntimeSnapshot
from animama.orm.content_catalog import (
    ORMAnimaContentBinding,
    ORMContentCatalogFile,
    ORMContentCatalogItem,
)
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _vrma(label: str = "runtime") -> bytes:
    document = json.dumps(
        {
            "asset": {"version": "2.0", "generator": label},
            "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
        },
        separators=(",", ":"),
    ).encode()
    document += b" " * (-len(document) % 4)
    return (
        struct.pack("<4sII", b"glTF", 2, 20 + len(document)) + struct.pack("<II", len(document), 0x4E4F534A) + document
    )


def _item_revision(item: ORMContentCatalogItem) -> str:
    assert item.revision_sha256 is not None
    return item.revision_sha256


def _descriptor(
    item: ORMContentCatalogItem,
    files: list[ORMContentCatalogFile],
) -> RuntimeContentDescriptor:
    members = tuple(
        RuntimeContentMember(
            file_ref=file.file_ref,
            item_id=item.id,
            source=ContentSource(item.source),
            relative_path=file.relative_path,
            role=file.role,
            media_type=file.media_type,
            size_bytes=file.size_bytes,
            sha256=file.sha256,
        )
        for file in files
    )
    entry = RuntimeContentEntry(
        item_id=item.id,
        kind=ContentKind(item.kind),
        display_name=item.display_name,
        revision_sha256=_item_revision(item),
        logical_key=item.logical_key,
        member_refs=tuple(file.file_ref for file in files),
    )
    return RuntimeContentDescriptor(
        loadout_revision=1,
        roots=(),
        entries=(entry,),
        members=members,
        diagnostics=(),
        admitted_item_revisions={item.id: _item_revision(item)},
        total_bytes=sum(file.size_bytes for file in files),
        revision=f"rcd2-{_digest(item.id)}",
    )


def _fence(descriptor: RuntimeContentDescriptor) -> dict[str, Any]:
    """The pins and files issuance rechecks for a compiled descriptor."""

    return {"pins": descriptor.admitted_item_revisions, "members": descriptor.members}


async def _add_item(
    session,
    *,
    owner_user_id: str | None,
    file_count: int = 2,
) -> tuple[ORMContentCatalogItem, list[ORMContentCatalogFile]]:
    item_id = str(uuid4())
    revision = _digest(item_id)
    scope = "owner" if owner_user_id is not None else "included"
    source = "local" if owner_user_id is not None else "included"
    item = ORMContentCatalogItem(
        id=item_id,
        source=source,
        scope=scope,
        owner_user_id=owner_user_id,
        kind="gesture",
        relative_locator=f"gestures/{item_id}",
        logical_key=f"test:gesture:{item_id}",
        display_name=f"Gesture {item_id[:8]}",
        status="valid",
        revision_sha256=revision,
        provenance={},
        content_metadata={
            "content_type": "gesture",
            "schema_version": 1,
            "name": "Runtime test gesture",
            "semantic_key": f"test-{item_id[:8]}",
            "implementation": {"kind": "vrma", "file_role": "animation"},
        },
        diagnostics=[],
    )
    session.add(item)
    await session.flush()
    files = [
        ORMContentCatalogFile(
            file_ref=str(uuid4()),
            item_id=item_id,
            relative_path=f"gestures/{item_id}/file-{index}.bin",
            role="animation" if index == 0 else "dependency",
            media_type="application/octet-stream",
            size_bytes=index + 1,
            sha256=_digest(f"{item_id}:{index}"),
            ordinal=index + 1,
        )
        for index in range(file_count)
    ]
    session.add_all(files)
    return item, files


async def _add_snapshot(
    session,
    *,
    owner_user_id: str,
    anima_id: str,
    pins: dict[str, str],
    effective_revision: str | None = None,
    expires_at: datetime | None = None,
) -> ORMAnimaRuntimeSnapshot:
    revision = effective_revision or f"tr4-{_digest(str(uuid4()))}"
    snapshot = ORMAnimaRuntimeSnapshot(
        id=str(uuid4()),
        owner_user_id=owner_user_id,
        anima_id=anima_id,
        loadout_revision=1,
        effective_revision=revision,
        catalog_digest=_digest(revision),
        admitted_item_revisions=dict(sorted(pins.items())),
        catalog={"catalog_version": 4, "gestures": []},
        expires_at=expires_at or datetime.now(UTC) + timedelta(hours=1),
    )
    session.add(snapshot)
    return snapshot


async def test_runtime_file_authorization_uses_one_read_only_item_pin_projection(async_session) -> None:
    owner = f"runtime-owner-{uuid4().hex}"
    anima = ORMAnima(id=f"runtime-anima-{uuid4().hex}", user_id=owner)
    async_session.add(anima)
    item, files = await _add_item(async_session, owner_user_id=owner)
    unpinned, unpinned_files = await _add_item(async_session, owner_user_id=owner, file_count=1)
    snapshot = await _add_snapshot(
        async_session,
        owner_user_id=owner,
        anima_id=anima.id,
        pins={item.id: _item_revision(item)},
    )
    await async_session.commit()

    service = AnimaRuntimeService(async_session)
    await service._recheck_admission(  # Exact issue-time fence
        user_id=owner,
        **_fence(_descriptor(item, files)),
    )
    with pytest.raises(RuntimeSnapshotError, match="runtime_remount_required"):
        await service._recheck_admission(  # Whole-item invariant regression
            user_id=owner,
            **_fence(_descriptor(item, files[:1])),
        )

    statements: list[str] = []

    def record_statement(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    engine = async_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        authorized = await AnimaRuntimeService(async_session).authorize_file(
            user_id=owner,
            anima_id=anima.id,
            revision=snapshot.effective_revision,
            file_ref=files[1].file_ref,
        )
        batch = await service.authorize_files(
            user_id=owner,
            anima_id=anima.id,
            revision=snapshot.effective_revision,
            file_refs=[file.file_ref for file in files] + [unpinned_files[0].file_ref, "missing"],
        )
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)

    assert authorized.item_id == item.id
    assert authorized.sha256 == files[1].sha256
    assert len(statements) == 2  # One query per call, independent of member count.
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
    for file in files:
        authorization = batch[file.file_ref]
        assert not isinstance(authorization, RuntimeSnapshotError)
        assert authorization.sha256 == file.sha256
    assert isinstance(batch[unpinned_files[0].file_ref], RuntimeSnapshotError)
    assert isinstance(batch["missing"], RuntimeSnapshotError)

    for hidden_ref in (str(uuid4()), unpinned_files[0].file_ref):
        with pytest.raises(RuntimeSnapshotError, match="runtime_file_not_found"):
            await service.authorize_file(
                user_id=owner,
                anima_id=anima.id,
                revision=snapshot.effective_revision,
                file_ref=hidden_ref,
            )
    with pytest.raises(RuntimeSnapshotError, match="runtime_file_not_found"):
        await service.authorize_file(
            user_id="another-owner",
            anima_id=anima.id,
            revision=snapshot.effective_revision,
            file_ref=files[0].file_ref,
        )

    item.revision_sha256 = _digest("edited")
    await async_session.commit()
    with pytest.raises(RuntimeSnapshotError, match="runtime_file_changed_remount_required"):
        await service.authorize_file(
            user_id=owner,
            anima_id=anima.id,
            revision=snapshot.effective_revision,
            file_ref=files[0].file_ref,
        )

    await async_session.execute(delete(ORMAnima).where(ORMAnima.id == anima.id))
    await async_session.execute(
        delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([item.id, unpinned.id]))
    )
    await async_session.commit()


async def test_issue_recheck_holds_catalog_rows_stable_until_snapshot_insert(
    async_session_factory,
) -> None:
    """A concurrent Save/Rescan cannot advance a pin between recheck and insert."""

    async with async_session_factory() as setup:
        item, files = await _add_item(setup, owner_user_id=None, file_count=1)
        await setup.commit()
        descriptor = _descriptor(item, files)

    async with async_session_factory() as issuer, async_session_factory() as editor:
        await AnimaRuntimeService(issuer)._recheck_admission(
            user_id="lock-test-owner",
            **_fence(descriptor),
        )
        await editor.execute(text("SET LOCAL lock_timeout = '100ms'"))
        with pytest.raises(DBAPIError):
            await editor.execute(
                update(ORMContentCatalogItem)
                .where(ORMContentCatalogItem.id == item.id)
                .values(revision_sha256=_digest("concurrent-edit"))
            )
        await editor.rollback()

        await issuer.rollback()
        await editor.execute(
            update(ORMContentCatalogItem)
            .where(ORMContentCatalogItem.id == item.id)
            .values(revision_sha256=_digest("after-issue"))
        )
        await editor.commit()

    async with async_session_factory() as cleanup:
        await cleanup.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id == item.id))
        await cleanup.commit()


async def test_issue_persists_immutable_body_reuses_winner_and_fences_later_edit(
    async_session,
    tmp_path: Path,
) -> None:
    owner = f"runtime-issue-owner-{uuid4().hex}"
    anima = ORMAnima(id=f"runtime-issue-anima-{uuid4().hex}", user_id=owner)
    configured = Settings(
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
    )
    paths = initialize_local_runtime(configured)
    clip = paths.local_root / "gestures/issue-wave.vrma"
    clip.parent.mkdir(parents=True, exist_ok=True)
    clip.write_bytes(_vrma())
    store = FilesystemContentStore(
        included_root=paths.included_root,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )
    catalog_repository = SQLAlchemyContentCatalog(async_session)
    scanned = await ContentCatalogService(
        store=store,
        catalog=catalog_repository,
    ).rescan(user_id=owner, include_included=False)
    gesture = next(item for item in scanned.items if item.relative_locator.endswith("issue-wave.vrma"))

    async_session.add(anima)
    await async_session.flush()
    async_session.add(
        ORMAnimaLoadout(
            anima_id=anima.id,
            owner_user_id=owner,
            revision=1,
            starter_catalog_version=1,
        )
    )
    await async_session.flush()
    async_session.add(
        ORMAnimaContentBinding(
            id=str(uuid4()),
            anima_id=anima.id,
            slot_key="gesture:issue-wave",
            catalog_item_id=gesture.id,
            kind="gesture",
            config={},
        )
    )
    await async_session.commit()

    service = AnimaRuntimeService(async_session, store=store)
    first = await service.issue(user_id=owner, anima_id=anima.id)
    second = await service.issue(user_id=owner, anima_id=anima.id)
    assert first["effective_revision"] == second["effective_revision"]
    assert first["content_descriptor"]["admitted_item_revisions"] == {gesture.id: gesture.revision_sha256}
    assert first["content_descriptor"]["members"][0]["file_ref"] == gesture.files[0].file_ref
    assert first["content_descriptor"]["members"][0]["url"].endswith(f"/files/{gesture.files[0].file_ref}")

    snapshots = list(
        (
            await async_session.execute(
                select(ORMAnimaRuntimeSnapshot).where(ORMAnimaRuntimeSnapshot.anima_id == anima.id)
            )
        ).scalars()
    )
    assert len(snapshots) == 1
    persisted = snapshots[0]
    assert persisted.admitted_item_revisions == {gesture.id: gesture.revision_sha256}
    assert "effective_revision" not in persisted.catalog
    assert "lease_expires_at" not in persisted.catalog
    assert '"url"' not in json.dumps(persisted.catalog)

    clip.write_bytes(_vrma("edited-runtime"))
    rescanned = await ContentCatalogService(
        store=store,
        catalog=catalog_repository,
    ).rescan(user_id=owner, include_included=False)
    edited = next(item for item in rescanned.items if item.id == gesture.id)
    assert edited.revision_sha256 != gesture.revision_sha256
    with pytest.raises(RuntimeSnapshotError, match="runtime_file_changed_remount_required"):
        await service.authorize_file(
            user_id=owner,
            anima_id=anima.id,
            revision=first["effective_revision"],
            file_ref=gesture.files[0].file_ref,
        )
    remounted = await service.issue(user_id=owner, anima_id=anima.id)
    assert remounted["effective_revision"] != first["effective_revision"]
    assert persisted.catalog["gestures"][0]["semantic_key"] == "issue-wave"

    await async_session.execute(delete(ORMAnima).where(ORMAnima.id == anima.id))
    await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id == gesture.id))
    await async_session.commit()


async def test_runtime_renew_preserves_pins_and_body_and_cleanup_is_bounded(async_session) -> None:
    owner = f"runtime-renew-owner-{uuid4().hex}"
    anima = ORMAnima(id=f"runtime-renew-anima-{uuid4().hex}", user_id=owner)
    async_session.add(anima)
    item, _files = await _add_item(async_session, owner_user_id=owner, file_count=1)
    snapshot = await _add_snapshot(
        async_session,
        owner_user_id=owner,
        anima_id=anima.id,
        pins={item.id: _item_revision(item)},
    )
    original_pins = dict(snapshot.admitted_item_revisions)
    original_body = dict(snapshot.catalog)
    original_expiry = snapshot.expires_at
    await async_session.commit()

    renewed = await AnimaRuntimeService(async_session).renew(
        user_id=owner,
        anima_id=anima.id,
        revision=snapshot.effective_revision,
    )
    await async_session.refresh(snapshot)
    assert renewed > original_expiry
    assert snapshot.admitted_item_revisions == original_pins
    assert snapshot.catalog == original_body

    expired_ids: list[str] = []
    for index in range(3):
        expired = await _add_snapshot(
            async_session,
            owner_user_id=owner,
            anima_id=anima.id,
            pins={},
            effective_revision=f"tr4-expired-{index}-{uuid4().hex}",
            expires_at=datetime.now(UTC) - timedelta(minutes=index + 1),
        )
        expired_ids.append(expired.id)
    await async_session.commit()

    service = AnimaRuntimeService(async_session)
    assert await service.cleanup_expired(batch_size=2) == 2
    await async_session.commit()
    remaining = await async_session.scalar(
        select(func.count()).select_from(ORMAnimaRuntimeSnapshot).where(ORMAnimaRuntimeSnapshot.id.in_(expired_ids))
    )
    assert remaining == 1
    assert await service.cleanup_expired(batch_size=2) == 1
    await async_session.commit()

    await async_session.execute(delete(ORMAnima).where(ORMAnima.id == anima.id))
    await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id == item.id))
    await async_session.commit()


async def test_scale_fixture_persists_one_snapshot_for_200_items_and_600_files(async_session) -> None:
    owner = f"runtime-scale-owner-{uuid4().hex}"
    anima = ORMAnima(id=f"runtime-scale-anima-{uuid4().hex}", user_id=owner)
    async_session.add(anima)
    items: list[ORMContentCatalogItem] = []
    all_files: list[ORMContentCatalogFile] = []
    for _index in range(200):
        item, files = await _add_item(async_session, owner_user_id=None, file_count=3)
        items.append(item)
        all_files.extend(files)
    pins = {item.id: _item_revision(item) for item in items}
    snapshot = await _add_snapshot(
        async_session,
        owner_user_id=owner,
        anima_id=anima.id,
        pins=pins,
    )
    await async_session.commit()

    snapshot_count = await async_session.scalar(
        select(func.count()).select_from(ORMAnimaRuntimeSnapshot).where(ORMAnimaRuntimeSnapshot.id == snapshot.id)
    )
    file_count = await async_session.scalar(
        select(func.count())
        .select_from(ORMContentCatalogFile)
        .where(ORMContentCatalogFile.item_id.in_([item.id for item in items]))
    )
    connection = await async_session.connection()

    def table_names(sync_connection):
        return set(inspect(sync_connection).get_table_names())

    tables = await connection.run_sync(table_names)
    assert snapshot_count == 1
    assert file_count == 600
    assert len(snapshot.admitted_item_revisions) == 200
    assert "anima_runtime_file_memberships" not in tables

    authorization = await AnimaRuntimeService(async_session).authorize_file(
        user_id=owner,
        anima_id=anima.id,
        revision=snapshot.effective_revision,
        file_ref=all_files[-1].file_ref,
    )
    assert authorization.item_id == items[-1].id

    await async_session.execute(delete(ORMAnima).where(ORMAnima.id == anima.id))
    await async_session.execute(
        delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([item.id for item in items]))
    )
    await async_session.commit()
