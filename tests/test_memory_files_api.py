from __future__ import annotations

import asyncio
import hashlib
import re
import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, event, select

from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.domain.memory_entry import MEMORY_ENTRY_OPERATION_DELETE, MEMORY_ENTRY_OPERATION_MOVE
from animama.domain.memory_episode import MEMORY_EPISODE_LOG_ENTRY_KIND
from animama.domain.request_principal import RequestPrincipal
from animama.orm import Base, ORMAnima, ORMMemoryEntry, ORMMemoryEntryVersion
from animama.orm.user_file import ORMUserFile
from animama.orm.user_file_chunk import ORMUserFileChunk
from animama.orm.user_file_processing_job import ORMUserFileProcessingJob
from animama.server.app import app
from animama.server.routers import memory_entries as memory_entries_router, router as api_router
from animama.server.schemas.memory_entry import (
    PyMemoryEntryCreateRequest,
    PyMemoryEntryPatchRequest,
    PySearchMemoryFilesDebugRequest,
)


def _user(user_id: str) -> RequestPrincipal:
    return RequestPrincipal(id=user_id)


def _selects_memory_entry_content(statement: str) -> bool:
    normalized = " ".join(statement.lower().split())
    if " from memory_entries" not in normalized:
        return False
    select_clause = normalized.split(" from memory_entries", 1)[0]
    return re.search(r"\bmemory_entries\.content(?:\s|,|$)", select_clause) is not None


async def _store_anima(async_session, *, anima_id: str, user_id: str) -> None:
    async_session.add(ORMAnima(id=anima_id, user_id=user_id))
    await async_session.flush()


@pytest_asyncio.fixture
async def clean_memory_entry_tables(async_session):
    await async_session.execute(delete(ORMUserFileProcessingJob))
    await async_session.execute(delete(ORMUserFileChunk))
    await async_session.execute(delete(ORMUserFile))
    await async_session.execute(delete(ORMMemoryEntryVersion))
    await async_session.execute(delete(ORMMemoryEntry))
    await async_session.commit()
    yield
    await async_session.execute(delete(ORMUserFileProcessingJob))
    await async_session.execute(delete(ORMUserFileChunk))
    await async_session.execute(delete(ORMUserFile))
    await async_session.execute(delete(ORMMemoryEntryVersion))
    await async_session.execute(delete(ORMMemoryEntry))
    await async_session.commit()


@pytest.mark.asyncio
async def test_authenticated_crud_routes_scope_by_current_user(async_session, clean_memory_entry_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    other_id = f"user-{uuid.uuid4()}"

    created = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            type="file",
            name="profile.md",
            content="# Owner",
            kind="user_profile",
            description="  Owner profile  ",
            metadata={"source": {"type": "manual"}},
            expected_version=0,
        ),
        session=async_session,
        user=_user(owner_id),
    )
    assert created.version == 1
    assert created.path == "profile.md"
    assert created.scope == "user"
    assert created.content == "# Owner"
    assert created.kind == "user_profile"
    assert created.description == "Owner profile"
    assert created.metadata == {"source": {"type": "manual"}}

    fetched = await memory_entries_router.get_memory_entry(created.id, session=async_session, user=_user(owner_id))
    assert fetched.id == created.id
    assert fetched.content == "# Owner"

    by_path = await memory_entries_router.get_memory_entry_by_path(
        session=async_session,
        user=_user(owner_id),
        path="PROFILE.md",
    )
    assert by_path.id == created.id

    with pytest.raises(HTTPException) as foreign_get:
        await memory_entries_router.get_memory_entry(created.id, session=async_session, user=_user(other_id))
    assert foreign_get.value.status_code == 404

    owner_list = await memory_entries_router.list_memory_entries(session=async_session, user=_user(owner_id))
    assert [entry.path for entry in owner_list.entries] == ["profile.md"]
    assert "content" not in owner_list.entries[0].model_dump()
    assert owner_list.entries[0].content_sha256 == created.content_sha256
    other_list = await memory_entries_router.list_memory_entries(session=async_session, user=_user(other_id))
    assert other_list.entries == []

    patched = await memory_entries_router.patch_memory_entry(
        created.id,
        PyMemoryEntryPatchRequest(content="# Updated", expected_version=1),
        session=async_session,
        user=_user(owner_id),
    )
    assert patched.version == 2
    assert patched.content == "# Updated"
    assert patched.description == "Owner profile"
    assert patched.metadata == {"source": {"type": "manual"}}

    described = await memory_entries_router.patch_memory_entry(
        created.id,
        PyMemoryEntryPatchRequest(description="Updated owner profile", expected_version=2),
        session=async_session,
        user=_user(owner_id),
    )
    assert described.version == 3
    assert described.description == "Updated owner profile"

    cleared = await memory_entries_router.patch_memory_entry(
        created.id,
        PyMemoryEntryPatchRequest(description=" ", metadata=None, expected_version=3),
        session=async_session,
        user=_user(owner_id),
    )
    assert cleared.version == 4
    assert cleared.description is None
    assert cleared.metadata == {}


@pytest.mark.asyncio
async def test_create_route_creates_nested_file_parents(
    async_session,
    clean_memory_entry_tables,
) -> None:
    owner_id = f"user-{uuid.uuid4()}"

    created = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            type="file",
            name="testdir/test.md",
            content="# Test",
            expected_version=0,
            create_parents=True,
        ),
        session=async_session,
        user=_user(owner_id),
    )
    listing = await memory_entries_router.list_memory_entries(
        session=async_session,
        user=_user(owner_id),
        recursive=True,
    )

    assert created.path == "testdir/test.md"
    assert created.content == "# Test"
    assert [entry.path for entry in listing.entries] == [
        "testdir",
        "testdir/test.md",
    ]


@pytest.mark.asyncio
async def test_version_routes_return_content_free_pages_and_adjacent_details(
    async_session,
    clean_memory_entry_tables,
) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    other_id = f"user-{uuid.uuid4()}"
    created = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            type="file",
            name="profile.md",
            content="# Profile\n",
            description="Initial",
            metadata={"private_snapshot": True},
        ),
        session=async_session,
        user=_user(owner_id),
    )
    updated = await memory_entries_router.patch_memory_entry(
        created.id,
        PyMemoryEntryPatchRequest(
            expected_version=created.version,
            content="# Profile\n\nLikes tea.\n",
            description="Durable",
        ),
        session=async_session,
        user=_user(owner_id),
    )

    first_page = await memory_entries_router.list_memory_entry_versions(
        created.id,
        session=async_session,
        user=_user(owner_id),
        limit=1,
    )
    second_page = await memory_entries_router.list_memory_entry_versions(
        created.id,
        session=async_session,
        user=_user(owner_id),
        before_version=first_page.next_before_version,
        limit=1,
    )
    creation = await memory_entries_router.get_memory_entry_version(
        created.id,
        1,
        session=async_session,
        user=_user(owner_id),
    )
    detail = await memory_entries_router.get_memory_entry_version(
        created.id,
        updated.version,
        session=async_session,
        user=_user(owner_id),
    )

    assert [version.version for version in first_page.versions] == [2]
    assert first_page.next_before_version == 2
    assert [version.version for version in second_page.versions] == [1]
    assert second_page.next_before_version is None
    summary_payload = first_page.versions[0].model_dump()
    assert "content" not in summary_payload
    assert "metadata" not in summary_payload
    assert summary_payload["change_metadata"] == {}

    assert creation.previous_version == 0
    assert creation.path_change is not None
    assert creation.path_change.old is None
    assert "--- /dev/null" in creation.unified_diff
    assert detail.previous_version == 1
    assert detail.content == "# Profile\n\nLikes tea.\n"
    assert detail.metadata == {"private_snapshot": True}
    assert detail.description_change is not None
    assert detail.description_change.old == "Initial"
    assert detail.description_change.new == "Durable"
    assert "+Likes tea." in detail.unified_diff

    with pytest.raises(HTTPException) as foreign_history:
        await memory_entries_router.list_memory_entry_versions(
            created.id,
            session=async_session,
            user=_user(other_id),
        )
    assert foreign_history.value.status_code == 404

    await memory_entries_router.delete_memory_entry(
        created.id,
        session=async_session,
        user=_user(owner_id),
        expected_version=updated.version,
    )
    deleted_history = await memory_entries_router.list_memory_entry_versions(
        created.id,
        session=async_session,
        user=_user(owner_id),
    )
    assert deleted_history.versions[0].operation == "delete"
    assert deleted_history.versions[0].deleted_at is not None


def test_version_metadata_and_routes_have_no_memory_entry_revision_compatibility() -> None:
    current_table = Base.metadata.tables["memory_entries"]
    version_table = Base.metadata.tables["memory_entry_versions"]
    route_paths = {route.path for route in app.routes if hasattr(route, "path")}

    assert "revision" not in current_table.c
    assert "version" in current_table.c
    assert "memory_entry_revisions" not in Base.metadata.tables
    assert "version" in version_table.c
    assert "change_metadata" in version_table.c
    assert "deleted_at" in version_table.c
    assert not any("revision" in (constraint.name or "") for constraint in version_table.constraints)
    assert not any("revision" in (index.name or "") for index in version_table.indexes)
    assert "/v1/memory/entries/{entry_id}/versions" in route_paths
    assert "/v1/memory/entries/{entry_id}/versions/{version}" in route_paths
    assert "/v1/memory/entries/{entry_id}/versions:compare" not in route_paths
    assert "expected_version" in PyMemoryEntryCreateRequest.model_fields
    assert "expected_version" in PyMemoryEntryPatchRequest.model_fields
    assert "expected_revision" not in PyMemoryEntryCreateRequest.model_fields
    assert "expected_revision" not in PyMemoryEntryPatchRequest.model_fields


@pytest.mark.asyncio
async def test_directory_create_move_recursive_list_and_path_lookup(async_session, clean_memory_entry_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    notes = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="directory", name="notes"),
        session=async_session,
        user=_user(owner_id),
    )
    profile = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            parent_id=notes.id,
            type="file",
            name="profile.md",
            content="nested",
        ),
        session=async_session,
        user=_user(owner_id),
    )

    moved = await memory_entries_router.patch_memory_entry(
        notes.id,
        PyMemoryEntryPatchRequest(name="archive", expected_version=1),
        session=async_session,
        user=_user(owner_id),
    )
    recursive = await memory_entries_router.list_memory_entries(
        session=async_session,
        user=_user(owner_id),
        recursive=True,
    )
    by_path = await memory_entries_router.get_memory_entry_by_path(
        session=async_session,
        user=_user(owner_id),
        path="archive/profile.md",
    )
    fetched_child = await memory_entries_router.get_memory_entry(
        profile.id,
        session=async_session,
        user=_user(owner_id),
    )
    child_move_version = await async_session.scalar(
        select(ORMMemoryEntryVersion).where(
            ORMMemoryEntryVersion.entry_id == profile.id,
            ORMMemoryEntryVersion.operation == MEMORY_ENTRY_OPERATION_MOVE,
        )
    )

    assert moved.path == "archive"
    assert [entry.path for entry in recursive.entries] == ["archive", "archive/profile.md"]
    assert by_path.id == profile.id
    assert by_path.version == 2
    assert fetched_child.path == "archive/profile.md"
    assert fetched_child.version == 2
    assert child_move_version is not None
    assert child_move_version.path == "archive/profile.md"
    assert child_move_version.version == 2


@pytest.mark.asyncio
async def test_list_memory_entries_does_not_select_markdown_content(async_session, clean_memory_entry_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            type="file",
            name="profile.md",
            content="Long profile content that should not be selected by list.",
            description="Profile",
        ),
        session=async_session,
        user=_user(owner_id),
    )
    statements: list[str] = []
    engine = async_session.bind.sync_engine

    def capture_sql(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001, ARG001
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture_sql)
    try:
        listed = await memory_entries_router.list_memory_entries(
            session=async_session,
            user=_user(owner_id),
            recursive=True,
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture_sql)

    assert [entry.path for entry in listed.entries] == ["profile.md"]
    memory_selects = [
        statement
        for statement in statements
        if "FROM memory_entries" in statement and statement.lstrip().upper().startswith("SELECT")
    ]
    assert memory_selects
    assert not any(_selects_memory_entry_content(statement) for statement in memory_selects)


@pytest.mark.asyncio
async def test_file_reparent_updates_parent_path_version_and_lookup(
    async_session,
    clean_memory_entry_tables,
) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    notes = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="directory", name="notes"),
        session=async_session,
        user=_user(owner_id),
    )
    archive = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="directory", name="archive"),
        session=async_session,
        user=_user(owner_id),
    )
    file_entry = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            parent_id=notes.id,
            type="file",
            name="todo.md",
            content="todo",
        ),
        session=async_session,
        user=_user(owner_id),
    )

    moved = await memory_entries_router.patch_memory_entry(
        file_entry.id,
        PyMemoryEntryPatchRequest(parent_id=archive.id, expected_version=1),
        session=async_session,
        user=_user(owner_id),
    )
    moved_to_root = await memory_entries_router.patch_memory_entry(
        file_entry.id,
        PyMemoryEntryPatchRequest(parent_id=None, expected_version=2),
        session=async_session,
        user=_user(owner_id),
    )

    row = await async_session.get(ORMMemoryEntry, file_entry.id)
    versions = list(
        (
            await async_session.execute(
                select(ORMMemoryEntryVersion)
                .where(
                    ORMMemoryEntryVersion.entry_id == file_entry.id,
                    ORMMemoryEntryVersion.operation == MEMORY_ENTRY_OPERATION_MOVE,
                )
                .order_by(ORMMemoryEntryVersion.version.asc())
            )
        ).scalars()
    )
    by_path = await memory_entries_router.get_memory_entry_by_path(
        session=async_session,
        user=_user(owner_id),
        path="todo.md",
    )

    assert moved.parent_id == archive.id
    assert moved.path == "archive/todo.md"
    assert moved.version == 2
    assert moved_to_root.parent_id is None
    assert moved_to_root.path == "todo.md"
    assert moved_to_root.version == 3
    assert row is not None
    assert row.parent_id is None
    assert row.path == "todo.md"
    assert row.normalized_path == "todo.md"
    assert [(version.version, version.path) for version in versions] == [
        (2, "archive/todo.md"),
        (3, "todo.md"),
    ]
    assert by_path.id == file_entry.id

    for old_path in ("notes/todo.md", "archive/todo.md"):
        with pytest.raises(HTTPException) as missing:
            await memory_entries_router.get_memory_entry_by_path(
                session=async_session,
                user=_user(owner_id),
                path=old_path,
            )
        assert missing.value.status_code == 404


@pytest.mark.asyncio
async def test_nested_directory_move_updates_descendants_and_move_versions(
    async_session,
    clean_memory_entry_tables,
) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    archive = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="directory", name="archive"),
        session=async_session,
        user=_user(owner_id),
    )
    root = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="directory", name="notes_box"),
        session=async_session,
        user=_user(owner_id),
    )
    project = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(parent_id=root.id, type="directory", name="projects"),
        session=async_session,
        user=_user(owner_id),
    )
    child = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(parent_id=root.id, type="file", name="prefs.md", content="prefs"),
        session=async_session,
        user=_user(owner_id),
    )
    nested = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(parent_id=project.id, type="file", name="roadmap.md", content="roadmap"),
        session=async_session,
        user=_user(owner_id),
    )
    wildcard_sibling = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="directory", name="notesXbox"),
        session=async_session,
        user=_user(owner_id),
    )
    wildcard_child = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            parent_id=wildcard_sibling.id,
            type="file",
            name="untouched.md",
            content="untouched",
        ),
        session=async_session,
        user=_user(owner_id),
    )

    moved = await memory_entries_router.patch_memory_entry(
        root.id,
        PyMemoryEntryPatchRequest(parent_id=archive.id, expected_version=1),
        session=async_session,
        user=_user(owner_id),
    )

    rows = {
        row.id: row
        for row in (
            await async_session.execute(
                select(ORMMemoryEntry).where(
                    ORMMemoryEntry.id.in_(
                        [root.id, project.id, child.id, nested.id, wildcard_sibling.id, wildcard_child.id]
                    )
                )
            )
        ).scalars()
    }
    expected_paths = {
        root.id: "archive/notes_box",
        project.id: "archive/notes_box/projects",
        child.id: "archive/notes_box/prefs.md",
        nested.id: "archive/notes_box/projects/roadmap.md",
    }
    assert moved.parent_id == archive.id
    for entry_id, path in expected_paths.items():
        assert rows[entry_id].path == path
        assert rows[entry_id].normalized_path == path.casefold()
        assert rows[entry_id].version == 2
    assert rows[wildcard_sibling.id].path == "notesXbox"
    assert rows[wildcard_sibling.id].normalized_path == "notesxbox"
    assert rows[wildcard_sibling.id].version == 1
    assert rows[wildcard_child.id].path == "notesXbox/untouched.md"
    assert rows[wildcard_child.id].normalized_path == "notesxbox/untouched.md"
    assert rows[wildcard_child.id].version == 1

    move_versions = list(
        (
            await async_session.execute(
                select(ORMMemoryEntryVersion).where(
                    ORMMemoryEntryVersion.entry_id.in_([root.id, project.id, child.id, nested.id]),
                    ORMMemoryEntryVersion.operation == MEMORY_ENTRY_OPERATION_MOVE,
                )
            )
        ).scalars()
    )
    assert {version.entry_id for version in move_versions} == {root.id, project.id, child.id, nested.id}
    assert {version.version for version in move_versions} == {2}
    assert {version.path for version in move_versions} == {
        "archive/notes_box",
        "archive/notes_box/projects",
        "archive/notes_box/prefs.md",
        "archive/notes_box/projects/roadmap.md",
    }

    by_new_path = await memory_entries_router.get_memory_entry_by_path(
        session=async_session,
        user=_user(owner_id),
        path="archive/notes_box/projects/roadmap.md",
    )
    assert by_new_path.id == nested.id
    with pytest.raises(HTTPException) as old_path:
        await memory_entries_router.get_memory_entry_by_path(
            session=async_session,
            user=_user(owner_id),
            path="notes_box/projects/roadmap.md",
        )
    assert old_path.value.status_code == 404


@pytest.mark.asyncio
async def test_anima_scoped_identity_is_separate_from_user_scope(async_session, clean_memory_entry_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    await _store_anima(async_session, anima_id=anima_id, user_id=owner_id)

    user_profile = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="file", name="identity.md", content="RequestPrincipal identity-ish"),
        session=async_session,
        user=_user(owner_id),
    )
    anima_identity = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            anima_id=anima_id,
            expected_aggregate_revision=1,
            type="file",
            name="identity.md",
            content="Anima identity",
            kind="anima_identity",
        ),
        session=async_session,
        user=_user(owner_id),
    )

    user_lookup = await memory_entries_router.get_memory_entry_by_path(
        session=async_session,
        user=_user(owner_id),
        path="identity.md",
    )
    anima_lookup = await memory_entries_router.get_memory_entry_by_path(
        session=async_session,
        user=_user(owner_id),
        anima_id=anima_id,
        path="identity.md",
    )

    assert user_lookup.id == user_profile.id
    assert anima_lookup.id == anima_identity.id
    assert anima_lookup.scope == "anima"
    assert anima_lookup.anima_id == anima_id


@pytest.mark.asyncio
async def test_anima_scoped_routes_reject_missing_or_foreign_anima(async_session, clean_memory_entry_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    foreign_user_id = f"user-{uuid.uuid4()}"
    foreign_anima_id = f"anima-{uuid.uuid4()}"
    missing_anima_id = f"anima-{uuid.uuid4()}"
    await _store_anima(async_session, anima_id=foreign_anima_id, user_id=foreign_user_id)

    for anima_id in (missing_anima_id, foreign_anima_id):
        with pytest.raises(HTTPException) as create_error:
            await memory_entries_router.create_memory_entry(
                PyMemoryEntryCreateRequest(
                    anima_id=anima_id,
                    type="file",
                    name="identity.md",
                    content="Anima identity",
                ),
                session=async_session,
                user=_user(owner_id),
            )
        assert create_error.value.status_code == 404

        with pytest.raises(HTTPException) as list_error:
            await memory_entries_router.list_memory_entries(
                session=async_session,
                user=_user(owner_id),
                anima_id=anima_id,
            )
        assert list_error.value.status_code == 404

    foreign_scoped_entry = ORMMemoryEntry(
        id=f"mem-{uuid.uuid4()}",
        user_id=owner_id,
        anima_id=foreign_anima_id,
        parent_id=None,
        type="file",
        name="identity.md",
        normalized_name="identity.md",
        path="identity.md",
        normalized_path="identity.md",
        content="Foreign identity",
        content_sha256=hashlib.sha256(b"Foreign identity").hexdigest(),
        size_bytes=len(b"Foreign identity"),
        version=1,
        kind="anima_identity",
        description=None,
        metadata_={},
    )
    async_session.add(foreign_scoped_entry)
    await async_session.flush()

    with pytest.raises(HTTPException) as get_error:
        await memory_entries_router.get_memory_entry(
            foreign_scoped_entry.id,
            session=async_session,
            user=_user(owner_id),
        )
    assert get_error.value.status_code == 404

    with pytest.raises(HTTPException) as patch_error:
        await memory_entries_router.patch_memory_entry(
            foreign_scoped_entry.id,
            PyMemoryEntryPatchRequest(expected_version=1, description="Updated"),
            session=async_session,
            user=_user(owner_id),
        )
    assert patch_error.value.status_code == 404

    with pytest.raises(HTTPException) as delete_error:
        await memory_entries_router.delete_memory_entry(
            foreign_scoped_entry.id,
            session=async_session,
            user=_user(owner_id),
            expected_version=1,
        )
    assert delete_error.value.status_code == 404


def test_debug_search_memory_files_request_trims_and_rejects_blank_queries() -> None:
    req = PySearchMemoryFilesDebugRequest(query="  Atlas dossier  ")
    assert req.query == "Atlas dossier"

    with pytest.raises(ValidationError):
        PySearchMemoryFilesDebugRequest(query="   ")

    with pytest.raises(ValidationError):
        PySearchMemoryFilesDebugRequest(query="x" * 2049)


@pytest.mark.asyncio
async def test_debug_search_memory_files_returns_tool_shape_without_private_fields(
    async_session,
    clean_memory_entry_tables,
) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    empty_user_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    await _store_anima(async_session, anima_id=anima_id, user_id=owner_id)
    await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            type="file",
            name="profile.md",
            content="Project Atlas lives in user markdown memory.",
            description="Owner profile",
        ),
        session=async_session,
        user=_user(owner_id),
    )
    await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            anima_id=anima_id,
            type="file",
            name="identity.md",
            content="Atlas in anima identity should not be searched.",
            expected_aggregate_revision=1,
        ),
        session=async_session,
        user=_user(owner_id),
    )

    response = await memory_entries_router.debug_search_memory_files(
        PySearchMemoryFilesDebugRequest(query=" Atlas "),
        session=async_session,
        user=_user(owner_id),
    )
    payload = response.model_dump()

    assert payload["query"] == "Atlas"
    assert set(payload) == {
        "query",
        "memory_results",
    }
    assert payload["memory_results"] == [
        {
            "path": "profile.md",
            "description": "Owner profile",
            "snippet": "profile.md Owner profile Project Atlas lives in user markdown memory.",
        }
    ]

    serialized = str(payload)
    for forbidden in (
        "ok",
        "storage_locator",
        "secret-object-key",
        "user_id",
        "embedding",
        "metadata",
        "version",
        "content_sha256",
        "created_at",
        "updated_at",
        "score",
        "match_type",
        "identity.md",
    ):
        assert forbidden not in serialized

    foreign_response = await memory_entries_router.debug_search_memory_files(
        PySearchMemoryFilesDebugRequest(query="Atlas"),
        session=async_session,
        user=_user(empty_user_id),
    )
    assert foreign_response.memory_results == []


@pytest.mark.asyncio
async def test_stale_writes_and_deletes_return_409(async_session, clean_memory_entry_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"

    created = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="file", name="conflict.md", content="one", expected_version=0),
        session=async_session,
        user=_user(owner_id),
    )

    with pytest.raises(HTTPException) as stale_patch:
        await memory_entries_router.patch_memory_entry(
            created.id,
            PyMemoryEntryPatchRequest(content="two", expected_version=0),
            session=async_session,
            user=_user(owner_id),
        )
    assert stale_patch.value.status_code == 409

    with pytest.raises(HTTPException) as stale_delete:
        await memory_entries_router.delete_memory_entry(
            created.id,
            session=async_session,
            user=_user(owner_id),
            expected_version=0,
        )
    assert stale_delete.value.status_code == 409


@pytest.mark.asyncio
async def test_public_routes_reject_episode_log_mutations(async_session, clean_memory_entry_tables) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    service = MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
    )
    episode = await service.put_file_by_path(
        user_id=owner_id,
        path="episodes/2026/07/2026-07-07.md",
        content="# Episodes",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        expected_version=0,
        create_parents=True,
        allow_system_managed=True,
    )
    episodes_root = await service.get_entry_by_path(
        user_id=owner_id,
        path="episodes",
        type="directory",
    )

    with pytest.raises(HTTPException) as create_kind_error:
        await memory_entries_router.create_memory_entry(
            PyMemoryEntryCreateRequest(
                type="file",
                name="manual.md",
                content="# Manual",
                kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
                expected_version=0,
            ),
            session=async_session,
            user=_user(owner_id),
        )
    with pytest.raises(HTTPException) as create_path_error:
        await memory_entries_router.create_memory_entry(
            PyMemoryEntryCreateRequest(
                parent_id=episodes_root.id,
                type="file",
                name="manual.md",
                content="# Manual",
                expected_version=0,
            ),
            session=async_session,
            user=_user(owner_id),
        )
    with pytest.raises(HTTPException) as patch_file_error:
        await memory_entries_router.patch_memory_entry(
            episode.id,
            PyMemoryEntryPatchRequest(content="# Edited", expected_version=episode.version),
            session=async_session,
            user=_user(owner_id),
        )
    with pytest.raises(HTTPException) as patch_dir_error:
        await memory_entries_router.patch_memory_entry(
            episodes_root.id,
            PyMemoryEntryPatchRequest(name="memories", expected_version=episodes_root.version),
            session=async_session,
            user=_user(owner_id),
        )
    with pytest.raises(HTTPException) as delete_file_error:
        await memory_entries_router.delete_memory_entry(
            episode.id,
            session=async_session,
            user=_user(owner_id),
            expected_version=episode.version,
        )
    with pytest.raises(HTTPException) as delete_dir_error:
        await memory_entries_router.delete_memory_entry(
            episodes_root.id,
            session=async_session,
            user=_user(owner_id),
            expected_version=episodes_root.version,
            recursive=True,
        )

    errors = [
        create_kind_error,
        create_path_error,
        patch_file_error,
        patch_dir_error,
        delete_file_error,
        delete_dir_error,
    ]
    assert [error.value.status_code for error in errors] == [403, 403, 403, 403, 403, 403]
    current = await memory_entries_router.get_memory_entry(
        episode.id,
        session=async_session,
        user=_user(owner_id),
    )
    assert current.content == "# Episodes"


@pytest.mark.asyncio
async def test_concurrent_same_path_creates_return_one_success_and_one_409(
    async_session_factory,
    clean_memory_entry_tables,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    arrived = 0
    release = asyncio.Event()
    original_get_for_update = SQLAlchemyMemoryEntryRepository.get_entry_by_path_for_update

    async def delayed_missing_lookup(
        self: SQLAlchemyMemoryEntryRepository,
        *,
        user_id: str,
        anima_id: str | None,
        normalized_path: str,
        type: str | None = None,
    ):
        nonlocal arrived
        result = await original_get_for_update(
            self,
            user_id=user_id,
            anima_id=anima_id,
            normalized_path=normalized_path,
            type=type,
        )
        if normalized_path == "race.md" and result is None:
            arrived += 1
            if arrived == 2:
                release.set()
            await asyncio.wait_for(release.wait(), timeout=5)
        return result

    monkeypatch.setattr(SQLAlchemyMemoryEntryRepository, "get_entry_by_path_for_update", delayed_missing_lookup)

    async def create_one():
        async with async_session_factory() as session:
            try:
                return await memory_entries_router.create_memory_entry(
                    PyMemoryEntryCreateRequest(
                        type="file",
                        name="race.md",
                        content="racing",
                        expected_version=0,
                    ),
                    session=session,
                    user=_user(owner_id),
                )
            except Exception as exc:  # noqa: BLE001
                return exc

    results = await asyncio.gather(create_one(), create_one())
    successes = [result for result in results if not isinstance(result, Exception)]
    conflicts = [result for result in results if isinstance(result, HTTPException)]
    unexpected = [
        result for result in results if isinstance(result, Exception) and not isinstance(result, HTTPException)
    ]

    assert unexpected == []
    assert len(successes) == 1
    assert len(conflicts) == 1
    assert conflicts[0].status_code == 409
    assert conflicts[0].detail == "Memory entry already exists"

    async with async_session_factory() as session:
        entries = list(
            (
                await session.execute(
                    select(ORMMemoryEntry).where(
                        ORMMemoryEntry.user_id == owner_id,
                        ORMMemoryEntry.anima_id.is_(None),
                        ORMMemoryEntry.normalized_path == "race.md",
                        ORMMemoryEntry.deleted_at.is_(None),
                    )
                )
            ).scalars()
        )
    assert len(entries) == 1


@pytest.mark.asyncio
async def test_delete_hides_entry_from_read_and_list_but_keeps_version_rows(
    async_session,
    clean_memory_entry_tables,
) -> None:
    owner_id = f"user-{uuid.uuid4()}"

    created = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            type="file",
            name="profile.md",
            content="About me",
            description="Initial profile",
            expected_version=0,
        ),
        session=async_session,
        user=_user(owner_id),
    )
    await memory_entries_router.delete_memory_entry(
        created.id,
        session=async_session,
        user=_user(owner_id),
        expected_version=1,
    )

    with pytest.raises(HTTPException) as deleted_get:
        await memory_entries_router.get_memory_entry(created.id, session=async_session, user=_user(owner_id))
    assert deleted_get.value.status_code == 404

    listing = await memory_entries_router.list_memory_entries(
        session=async_session,
        user=_user(owner_id),
        recursive=True,
    )
    assert listing.entries == []

    current_row = await async_session.scalar(select(ORMMemoryEntry).where(ORMMemoryEntry.id == created.id))
    assert current_row is not None
    assert current_row.deleted_at is not None

    versions = list(
        (
            await async_session.execute(
                select(ORMMemoryEntryVersion)
                .where(ORMMemoryEntryVersion.entry_id == created.id)
                .order_by(ORMMemoryEntryVersion.version.asc())
            )
        ).scalars()
    )
    assert [version.operation for version in versions] == ["create", "delete"]
    assert [version.version for version in versions] == [1, 2]
    assert [version.description for version in versions] == ["Initial profile", "Initial profile"]
    assert versions[-1].content == "About me"


@pytest.mark.asyncio
async def test_non_recursive_directory_delete_conflicts_and_recursive_delete_succeeds(
    async_session,
    clean_memory_entry_tables,
) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    directory = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="directory", name="notes"),
        session=async_session,
        user=_user(owner_id),
    )
    await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(parent_id=directory.id, type="file", name="todo.md", content="todo"),
        session=async_session,
        user=_user(owner_id),
    )

    with pytest.raises(HTTPException) as conflict:
        await memory_entries_router.delete_memory_entry(
            directory.id,
            session=async_session,
            user=_user(owner_id),
            expected_version=1,
            recursive=False,
        )
    assert conflict.value.status_code == 409

    await memory_entries_router.delete_memory_entry(
        directory.id,
        session=async_session,
        user=_user(owner_id),
        expected_version=1,
        recursive=True,
    )
    listing = await memory_entries_router.list_memory_entries(
        session=async_session,
        user=_user(owner_id),
        recursive=True,
    )
    assert listing.entries == []


@pytest.mark.asyncio
async def test_recursive_delete_hides_larger_subtree_and_writes_descendant_delete_versions(
    async_session,
    clean_memory_entry_tables,
) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    root = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="directory", name="notes"),
        session=async_session,
        user=_user(owner_id),
    )
    entry_ids = [root.id]
    for index in range(5):
        directory = await memory_entries_router.create_memory_entry(
            PyMemoryEntryCreateRequest(parent_id=root.id, type="directory", name=f"dir-{index}"),
            session=async_session,
            user=_user(owner_id),
        )
        entry_ids.append(directory.id)
        for file_index in range(2):
            child = await memory_entries_router.create_memory_entry(
                PyMemoryEntryCreateRequest(
                    parent_id=directory.id,
                    type="file",
                    name=f"file-{file_index}.md",
                    content=f"{index}/{file_index}",
                ),
                session=async_session,
                user=_user(owner_id),
            )
            entry_ids.append(child.id)

    await memory_entries_router.delete_memory_entry(
        root.id,
        session=async_session,
        user=_user(owner_id),
        expected_version=1,
        recursive=True,
    )

    listing = await memory_entries_router.list_memory_entries(
        session=async_session,
        user=_user(owner_id),
        recursive=True,
    )
    assert listing.entries == []

    rows = list((await async_session.execute(select(ORMMemoryEntry).where(ORMMemoryEntry.id.in_(entry_ids)))).scalars())
    assert len(rows) == len(entry_ids)
    assert all(row.deleted_at is not None for row in rows)
    assert {row.version for row in rows} == {2}

    delete_versions = list(
        (
            await async_session.execute(
                select(ORMMemoryEntryVersion).where(
                    ORMMemoryEntryVersion.entry_id.in_(entry_ids),
                    ORMMemoryEntryVersion.operation == MEMORY_ENTRY_OPERATION_DELETE,
                )
            )
        ).scalars()
    )
    assert {version.entry_id for version in delete_versions} == set(entry_ids)
    assert {version.version for version in delete_versions} == {2}


def test_openapi_includes_memory_entry_routes_and_not_retired_file_or_block_routes() -> None:
    paths = {route.path for route in api_router.routes}
    assert "/v1/memory/entries" in paths
    assert "/v1/memory/entries/by-path" in paths
    assert "/v1/memory/entries/{entry_id}" in paths
    assert "/v1/memory/debug/search-memory-files" in paths
    assert "/v1/memory/files" not in paths
    assert "/v1/memory/files/{file_path:path}" not in paths
    assert "/v1/memories" not in paths
    assert "/v1/blocks" not in paths

    app.openapi_schema = None
    openapi = app.openapi()
    openapi_paths = set(openapi["paths"])
    assert "/v1/memory/entries" in openapi_paths
    assert "/v1/memory/entries/by-path" in openapi_paths
    assert "/v1/memory/entries/{entry_id}" in openapi_paths
    assert "/v1/memory/debug/search-memory-files" in openapi_paths
    assert "/v1/memory/debug/search-files" not in openapi_paths
    assert not any(path.startswith("/v1/memory/files") for path in openapi_paths)
    assert not any(path.startswith("/v1/memories") for path in openapi_paths)
    assert not any(path.startswith("/v1/blocks") for path in openapi_paths)

    schemas = set(openapi["components"]["schemas"])
    assert {
        "PyMemoryEntryHeader",
        "PyMemoryEntryResponse",
        "PyMemoryEntryListResponse",
        "PySearchMemoryFileDebugResult",
        "PySearchMemoryFilesDebugRequest",
        "PySearchMemoryFilesDebugResponse",
    } <= schemas
    assert "description" in openapi["components"]["schemas"]["PyMemoryEntryHeader"]["properties"]
    assert "description" in openapi["components"]["schemas"]["PyMemoryEntryCreateRequest"]["properties"]
    assert "description" in openapi["components"]["schemas"]["PyMemoryEntryPatchRequest"]["properties"]
    debug_response = openapi["components"]["schemas"]["PySearchMemoryFilesDebugResponse"]["properties"]
    assert set(debug_response) == {
        "query",
        "memory_results",
    }
    debug_request = openapi["components"]["schemas"]["PySearchMemoryFilesDebugRequest"]["properties"]
    assert set(debug_request) == {"query"}
    assert not any(schema.startswith("PyMemorySearch") for schema in schemas)
    assert "PyMemoryEntrySummary" not in schemas
    assert "PyMemoryFileSummary" not in schemas
    assert not any(schema.startswith("PyBlock") for schema in schemas)
    assert "PyMemoryResponse" not in schemas
