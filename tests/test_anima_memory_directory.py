"""Backend contracts behind the Memory workspace's virtual Animas directory."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import delete, func, select

from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.memory_entry_service import (
    MemoryEntryConflictError,
    MemoryEntryProtectedError,
    MemoryEntryService,
    MemoryEntryValidationError,
)
from animama.domain.memory_entry import MEMORY_ENTRY_OPERATION_UNDO
from animama.domain.request_principal import RequestPrincipal
from animama.orm import ORMAnima, ORMMemoryEntry, ORMMemoryEntryVersion
from animama.server.app import app
from animama.server.routers import anima as anima_router, memory_entries as memory_entries_router
from animama.server.schemas.memory_entry import PyMemoryEntryCreateRequest, PyMemoryEntryPatchRequest

_BASE_TIME = datetime(2026, 1, 1, 12, 0, 0)


def _user(user_id: str) -> RequestPrincipal:
    return RequestPrincipal(id=user_id)


def _service(async_session) -> MemoryEntryService:
    return MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
        animas=SQLAlchemyAnimaRepository(async_session),
    )


async def _store_anima(async_session, *, user_id: str, name: str, created_offset: int = 0) -> str:
    anima_id = f"anima-{uuid.uuid4()}"
    async_session.add(
        ORMAnima(
            id=anima_id,
            user_id=user_id,
            display_name=name,
            created_at=_BASE_TIME + timedelta(minutes=created_offset),
        )
    )
    await async_session.flush()
    return anima_id


async def _create_identity(async_session, *, user_id: str, anima_id: str, content: str = "# Identity"):
    return await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            anima_id=anima_id,
            expected_aggregate_revision=1,
            type="file",
            name="IDENTITY.md",
            content=content,
            description="Who this Anima is",
        ),
        session=async_session,
        user=_user(user_id),
    )


@pytest_asyncio.fixture
async def clean_tables(async_session):
    async def _clean() -> None:
        await async_session.execute(delete(ORMMemoryEntryVersion))
        await async_session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.parent_id.is_not(None)))
        await async_session.execute(delete(ORMMemoryEntry))
        await async_session.commit()

    await _clean()
    yield
    await _clean()


@pytest.mark.asyncio
async def test_anima_identity_listing_orders_owned_animas_and_reports_missing_identity(
    async_session, clean_tables
) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    foreign_id = f"user-{uuid.uuid4()}"
    later = await _store_anima(async_session, user_id=owner_id, name="Annie", created_offset=5)
    earlier = await _store_anima(async_session, user_id=owner_id, name="Annie", created_offset=1)
    await _store_anima(async_session, user_id=foreign_id, name="Foreign", created_offset=0)
    identity = await _create_identity(async_session, user_id=owner_id, anima_id=earlier)

    listing = await memory_entries_router.list_anima_identities(session=async_session, user=_user(owner_id))

    assert [item.anima_id for item in listing.identities] == [earlier, later]
    first, second = listing.identities
    assert first.display_name == "Annie"
    assert first.aggregate_revision == identity.aggregate_revision
    assert first.identity_status == "ready"
    assert first.entry is not None
    assert first.entry.id == identity.id
    assert first.entry.scope == "anima"
    assert first.entry.description == "Who this Anima is"
    assert "content" not in first.entry.model_dump()
    assert second.entry is None
    assert second.identity_status == "repair_required"


@pytest.mark.asyncio
async def test_user_scope_rejects_reserved_animas_paths(async_session, clean_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    user = _user(owner_id)
    notes = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="directory", name="notes"),
        session=async_session,
        user=user,
    )

    attempts = [
        PyMemoryEntryCreateRequest(type="directory", name="Animas"),
        PyMemoryEntryCreateRequest(type="file", name="animas/annie.md", content="x", create_parents=True),
    ]
    for request in attempts:
        with pytest.raises(HTTPException) as error:
            await memory_entries_router.create_memory_entry(request, session=async_session, user=user)
        assert error.value.status_code == 403
        assert "reserved" in error.value.detail

    with pytest.raises(HTTPException) as rename_error:
        await memory_entries_router.patch_memory_entry(
            notes.id,
            PyMemoryEntryPatchRequest(name="ANIMAS", expected_version=notes.version),
            session=async_session,
            user=user,
        )
    assert rename_error.value.status_code == 403

    with pytest.raises(MemoryEntryProtectedError):
        await _service(async_session).put_file_by_path(
            user_id=owner_id,
            path="animas/notes.md",
            content="x",
            expected_version=0,
            create_parents=True,
        )


@pytest.mark.asyncio
async def test_existing_reserved_user_entries_can_only_be_moved_renamed_or_deleted(async_session, clean_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    user = _user(owner_id)
    legacy_dir = ORMMemoryEntry(
        id=f"mem-{uuid.uuid4()}",
        user_id=owner_id,
        anima_id=None,
        parent_id=None,
        type="directory",
        name="animas",
        normalized_name="animas",
        path="animas",
        normalized_path="animas",
        version=1,
        metadata_={},
    )
    async_session.add(legacy_dir)
    await async_session.flush()
    legacy_file = ORMMemoryEntry(
        id=f"mem-{uuid.uuid4()}",
        user_id=owner_id,
        anima_id=None,
        parent_id=legacy_dir.id,
        type="file",
        name="old.md",
        normalized_name="old.md",
        path="animas/old.md",
        normalized_path="animas/old.md",
        content="legacy",
        content_sha256="0" * 64,
        size_bytes=6,
        version=1,
        metadata_={},
    )
    async_session.add(legacy_file)
    await async_session.commit()
    dir_id, file_id = legacy_dir.id, legacy_file.id

    listed = await memory_entries_router.list_memory_entries(session=async_session, user=user, recursive=True)
    assert {entry.path for entry in listed.entries} == {"animas", "animas/old.md"}

    with pytest.raises(HTTPException) as edit_error:
        await memory_entries_router.patch_memory_entry(
            file_id,
            PyMemoryEntryPatchRequest(content="edited", expected_version=1),
            session=async_session,
            user=user,
        )
    assert edit_error.value.status_code == 403

    with pytest.raises(HTTPException) as rename_inside_error:
        await memory_entries_router.patch_memory_entry(
            file_id,
            PyMemoryEntryPatchRequest(name="renamed.md", expected_version=1),
            session=async_session,
            user=user,
        )
    assert rename_inside_error.value.status_code == 403

    moved = await memory_entries_router.patch_memory_entry(
        file_id,
        PyMemoryEntryPatchRequest(parent_id=None, expected_version=1),
        session=async_session,
        user=user,
    )
    assert moved.path == "old.md"
    edited = await memory_entries_router.patch_memory_entry(
        file_id,
        PyMemoryEntryPatchRequest(content="edited", expected_version=moved.version),
        session=async_session,
        user=user,
    )
    assert edited.content == "edited"

    with pytest.raises(HTTPException) as move_into_error:
        await memory_entries_router.patch_memory_entry(
            file_id,
            PyMemoryEntryPatchRequest(parent_id=dir_id, expected_version=edited.version),
            session=async_session,
            user=user,
        )
    assert move_into_error.value.status_code == 403

    renamed_dir = await memory_entries_router.patch_memory_entry(
        dir_id,
        PyMemoryEntryPatchRequest(name="old-animas", expected_version=1),
        session=async_session,
        user=user,
    )
    assert renamed_dir.path == "old-animas"


@pytest.mark.asyncio
async def test_existing_reserved_user_file_can_be_deleted_but_not_reverted(async_session, clean_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    user = _user(owner_id)
    service = _service(async_session)
    created = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="file", name="legacy.md", content="v1"),
        session=async_session,
        user=user,
    )
    updated = await memory_entries_router.patch_memory_entry(
        created.id,
        PyMemoryEntryPatchRequest(content="v2", expected_version=created.version),
        session=async_session,
        user=user,
    )
    # Simulate an entry that predates the reservation by renaming it in storage.
    legacy = await async_session.get(ORMMemoryEntry, created.id)
    assert legacy is not None
    legacy.name = legacy.path = "Animas"
    legacy.normalized_name = legacy.normalized_path = "animas"
    entry_id = created.id
    await async_session.commit()

    with pytest.raises(MemoryEntryProtectedError):
        await service.revert_entry(
            user_id=owner_id,
            entry_id=entry_id,
            target_version=1,
            expected_version=updated.version,
        )
    await memory_entries_router.delete_memory_entry(
        entry_id,
        session=async_session,
        user=user,
        expected_version=updated.version,
    )
    with pytest.raises(HTTPException) as missing:
        await memory_entries_router.get_memory_entry(entry_id, session=async_session, user=user)
    assert missing.value.status_code == 404


@pytest.mark.asyncio
async def test_deleting_anima_removes_its_scoped_memory_only(async_session, clean_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    user = _user(owner_id)
    doomed = await _store_anima(async_session, user_id=owner_id, name="Annie")
    kept = await _store_anima(async_session, user_id=owner_id, name="Caitlin", created_offset=1)
    doomed_identity = await _create_identity(async_session, user_id=owner_id, anima_id=doomed)
    await memory_entries_router.patch_memory_entry(
        doomed_identity.id,
        PyMemoryEntryPatchRequest(
            content="# Updated identity",
            expected_version=doomed_identity.version,
            expected_aggregate_revision=doomed_identity.aggregate_revision,
        ),
        session=async_session,
        user=user,
    )
    nested = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            anima_id=doomed, type="file", name="notes/extra.md", content="extra", create_parents=True
        ),
        session=async_session,
        user=user,
    )
    kept_identity = await _create_identity(async_session, user_id=owner_id, anima_id=kept)
    profile = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="file", name="PROFILE.md", content="# Me"),
        session=async_session,
        user=user,
    )

    await anima_router.delete_anima(doomed, session=async_session, user=user)

    remaining_entries = (
        await async_session.execute(select(func.count()).where(ORMMemoryEntry.anima_id == doomed))
    ).scalar_one()
    remaining_versions = (
        await async_session.execute(select(func.count()).where(ORMMemoryEntryVersion.anima_id == doomed))
    ).scalar_one()
    assert remaining_entries == 0
    assert remaining_versions == 0
    for entry_id in (doomed_identity.id, nested.id):
        with pytest.raises(HTTPException) as missing:
            await memory_entries_router.get_memory_entry(entry_id, session=async_session, user=user)
        assert missing.value.status_code == 404

    assert (await memory_entries_router.get_memory_entry(kept_identity.id, session=async_session, user=user)).id
    assert (await memory_entries_router.get_memory_entry(profile.id, session=async_session, user=user)).id
    listing = await memory_entries_router.list_anima_identities(session=async_session, user=user)
    assert [item.anima_id for item in listing.identities] == [kept]

    with pytest.raises(HTTPException) as repeat:
        await anima_router.delete_anima(doomed, session=async_session, user=user)
    assert repeat.value.status_code == 404


@pytest.mark.asyncio
async def test_trusted_identity_writes_lock_the_current_anima_revision(async_session, clean_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = await _store_anima(async_session, user_id=owner_id, name="Annie")
    identity = await _create_identity(async_session, user_id=owner_id, anima_id=anima_id, content="# Before")
    animas = SQLAlchemyAnimaRepository(async_session)
    renamed = await animas.record_definition_revision(
        user_id=owner_id,
        anima_id=anima_id,
        expected_revision=identity.aggregate_revision,
        reason="rename",
        display_name="Annie Two",
    )
    await async_session.commit()
    service = _service(async_session)

    with pytest.raises(MemoryEntryConflictError):
        await service.patch_entry(
            user_id=owner_id,
            entry_id=identity.id,
            expected_version=identity.version,
            content="# After",
            content_set=True,
        )

    updated = await service.patch_entry(
        user_id=owner_id,
        entry_id=identity.id,
        expected_version=identity.version,
        content="# After",
        content_set=True,
        use_current_aggregate_revision=True,
    )
    assert updated.content == "# After"
    assert updated.aggregate_revision == renamed.aggregate_revision + 1

    with pytest.raises(MemoryEntryValidationError):
        await service.patch_entry(
            user_id=owner_id,
            entry_id=identity.id,
            expected_version=updated.version,
            content="   ",
            content_set=True,
            use_current_aggregate_revision=True,
        )
    with pytest.raises(MemoryEntryConflictError):
        await service.patch_entry(
            user_id=owner_id,
            entry_id=identity.id,
            expected_version=identity.version,
            content="# Stale",
            content_set=True,
            use_current_aggregate_revision=True,
        )

    undone = await service.undo_approved_update(
        user_id=owner_id,
        entry_id=identity.id,
        expected_version=updated.version,
        old_content="# Before",
        old_description="Who this Anima is",
        change_metadata={"source_type": "memory_manager_undo"},
        use_current_aggregate_revision=True,
    )
    assert undone.content == "# Before"
    assert undone.aggregate_revision == updated.aggregate_revision + 1
    history = await service.list_versions(user_id=owner_id, entry_id=identity.id)
    assert history.versions[0].operation == MEMORY_ENTRY_OPERATION_UNDO

    with pytest.raises(MemoryEntryValidationError):
        await service.undo_approved_update(
            user_id=owner_id,
            entry_id=identity.id,
            expected_version=undone.version,
            old_content="",
            old_description=None,
            change_metadata={"source_type": "memory_manager_undo"},
            use_current_aggregate_revision=True,
        )
    with pytest.raises(MemoryEntryConflictError):
        await service.undo_approved_update(
            user_id=owner_id,
            entry_id=identity.id,
            expected_version=undone.version,
            old_content="# Without the trusted lock",
            old_description=None,
            change_metadata={"source_type": "memory_manager_undo"},
        )
    with pytest.raises(MemoryEntryProtectedError):
        await service.undo_approved_create(
            user_id=owner_id,
            entry_id=identity.id,
            expected_version=undone.version,
            change_metadata={"source_type": "memory_manager_undo"},
        )


def test_openapi_exposes_anima_identity_listing() -> None:
    app.openapi_schema = None
    openapi = app.openapi()
    assert "get" in openapi["paths"]["/v1/memory/anima-identities"]
    item = openapi["components"]["schemas"]["PyAnimaIdentityItem"]["properties"]
    assert {"anima_id", "display_name", "aggregate_revision", "identity_status", "entry"} <= set(item)
