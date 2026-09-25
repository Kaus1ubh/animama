"""Memory Manager access to Anima identities (spec R3, R4, R2a, R6)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import delete

from animama.adapters.memory_manager import (
    DeterministicMemoryManagerRuntime,
    MemoryManagerPatchRejected,
    MemoryManagerVirtualWorkspace,
)
from animama.adapters.memory_manager.openai_agents_runtime import _allows_anima_identities, _instructions
from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.user_memory_read_tools import UserMemoryReadToolService
from animama.domain.memory_manager import (
    MemoryManagerEpisodeTaskItem,
    MemoryManagerEpisodeTaskState,
    MemoryManagerMessage,
    MemoryManagerRun,
)
from animama.domain.request_principal import RequestPrincipal
from animama.orm import (
    ORMAnima,
    ORMMemoryEntry,
    ORMMemoryEntryVersion,
    ORMMemoryManagerApproval,
    ORMMemoryManagerMessage,
    ORMMemoryManagerRun,
)
from animama.server.routers import (
    anima as anima_router,
    memory_entries as memory_entries_router,
    memory_manager as memory_manager_router,
)
from animama.server.schemas.memory_entry import PyMemoryEntryCreateRequest, PyMemoryEntryPatchRequest
from animama.server.schemas.memory_manager import (
    PyMemoryManagerApprovalDecisionRequest,
    PyMemoryManagerRunCreateRequest,
)


def _user(user_id: str) -> RequestPrincipal:
    return RequestPrincipal(id=user_id)


def _entries(async_session) -> MemoryEntryService:
    return MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
        animas=SQLAlchemyAnimaRepository(async_session),
    )


@pytest.fixture(autouse=True)
def use_fake_memory_manager_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANIMAMA_LLM_SKIP", "1")


@pytest_asyncio.fixture
async def clean_rows(async_session):
    async def _clean() -> None:
        await async_session.execute(delete(ORMMemoryManagerApproval))
        await async_session.execute(delete(ORMMemoryManagerMessage))
        await async_session.execute(delete(ORMMemoryManagerRun))
        await async_session.execute(delete(ORMMemoryEntryVersion))
        await async_session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.parent_id.is_not(None)))
        await async_session.execute(delete(ORMMemoryEntry))
        await async_session.commit()

    await _clean()
    yield
    await _clean()


async def _anima_with_identity(async_session, *, user_id: str, name: str = "Annie") -> tuple[str, str]:
    anima_id = f"anima-{uuid.uuid4().hex}"
    async_session.add(ORMAnima(id=anima_id, user_id=user_id, display_name=name))
    await async_session.flush()
    identity = await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            anima_id=anima_id,
            expected_aggregate_revision=1,
            type="file",
            name="IDENTITY.md",
            content=f"# {name}\n\nCalm and curious.\n",
            description=f"Who {name} is",
        ),
        session=async_session,
        user=_user(user_id),
    )
    return anima_id, identity.id


async def _identity(async_session, *, user_id: str, entry_id: str):
    return await memory_entries_router.get_memory_entry(entry_id, session=async_session, user=_user(user_id))


@pytest.mark.asyncio
async def test_manager_navigation_lists_identities_only_when_enabled(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    anima_id, _identity_id = await _anima_with_identity(async_session, user_id=user_id)
    await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(type="file", name="PROFILE.md", content="# Me", description="Owner profile"),
        session=async_session,
        user=_user(user_id),
    )
    manager_path = f"animas/{anima_id}/IDENTITY.md"

    manager_reads = UserMemoryReadToolService(memory_entries=_entries(async_session), include_anima_identities=True)
    listed = await manager_reads.list_files(user_id=user_id)
    assert listed["files"] == [
        {"path": "PROFILE.md", "description": "Owner profile"},
        {"path": manager_path, "description": "Who Annie is", "anima_name": "Annie"},
    ]
    memory_map = await manager_reads.render_memory_map(user_id=user_id)
    assert f"  - path: {manager_path}\n    description: Who Annie is\n    anima: Annie" in memory_map
    read = await manager_reads.read_files(user_id=user_id, paths=[manager_path])
    assert read["errors"] == []
    assert read["files"][0]["path"] == manager_path
    assert read["files"][0]["content"] == "# Annie\n\nCalm and curious.\n"
    missing = await manager_reads.read_files(user_id=user_id, paths=["animas/anima-missing/IDENTITY.md"])
    assert missing["errors"][0]["code"] == "not_found"

    chat_reads = UserMemoryReadToolService(memory_entries=_entries(async_session))
    assert [file["path"] for file in (await chat_reads.list_files(user_id=user_id))["files"]] == ["PROFILE.md"]
    assert "animas/" not in await chat_reads.render_memory_map(user_id=user_id)
    rejected = await chat_reads.read_files(user_id=user_id, paths=[manager_path])
    assert rejected["files"] == []
    assert rejected["errors"][0]["code"] == "invalid_path"


@pytest.mark.asyncio
async def test_workspace_plans_identity_updates_only_when_enabled(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    anima_id, identity_id = await _anima_with_identity(async_session, user_id=user_id)
    manager_path = f"animas/{anima_id}/IDENTITY.md"
    entries = _entries(async_session)

    workspace = MemoryManagerVirtualWorkspace(user_id=user_id, memory_entries=entries, allow_anima_identities=True)
    planned = await workspace.plan_v4a_operation(
        operation_type="update_file",
        path=manager_path,
        diff=(
            '@@\n ---\n description: "Who Annie is"\n ---\n'
            " # Annie\n \n-Calm and curious.\n+Calm, curious and playful.\n"
        ),
    )
    assert planned.target_path == manager_path
    assert planned.target_entry_id == identity_id
    assert planned.new_content == "# Annie\n\nCalm, curious and playful.\n"

    for operation_type, path, diff in (
        ("create_file", manager_path, "+# New\n"),
        ("update_file", "animas/anima-missing/IDENTITY.md", "+x\n"),
        ("update_file", f"animas/{anima_id}/notes.md", "+x\n"),
        (
            "update_file",
            manager_path,
            '@@\n ---\n description: "Who Annie is"\n ---\n-# Annie\n-\n-Calm and curious.\n',
        ),
    ):
        with pytest.raises(MemoryManagerPatchRejected):
            await workspace.plan_v4a_operation(operation_type=operation_type, path=path, diff=diff)
    with pytest.raises(MemoryManagerPatchRejected):
        await workspace.plan_full_content(path=manager_path, new_content="  \n", new_description="Who Annie is")

    default_workspace = MemoryManagerVirtualWorkspace(user_id=user_id, memory_entries=entries)
    with pytest.raises(MemoryManagerPatchRejected):
        await default_workspace.plan_full_content(path=manager_path, new_content="# Annie", new_description=None)


@pytest.mark.asyncio
async def test_identity_approval_survives_rename_and_supports_undo(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    user = _user(user_id)
    anima_id, identity_id = await _anima_with_identity(async_session, user_id=user_id)
    manager_path = f"animas/{anima_id}/IDENTITY.md"

    run = await memory_manager_router.create_memory_manager_run(
        PyMemoryManagerRunCreateRequest(message=f"Update {manager_path} to mention she loves jazz."),
        session=async_session,
        user=user,
    )
    approval = run.approvals[0]
    assert approval.preview.path == manager_path
    assert approval.target_entry_id == identity_id

    await SQLAlchemyAnimaRepository(async_session).record_definition_revision(
        user_id=user_id, anima_id=anima_id, expected_revision=2, reason="rename", display_name="Anne"
    )
    await async_session.commit()

    approved = await memory_manager_router.decide_memory_manager_approval(
        approval.id,
        PyMemoryManagerApprovalDecisionRequest(decision="approve"),
        session=async_session,
        user=user,
    )
    assert approved.status == "approved"
    assert approved.can_undo is True
    updated = await _identity(async_session, user_id=user_id, entry_id=identity_id)
    assert "jazz" in updated.content
    assert updated.aggregate_revision == 4

    undone = await memory_manager_router.undo_memory_manager_approval(approved.id, session=async_session, user=user)
    assert undone.deleted is False
    restored = await _identity(async_session, user_id=user_id, entry_id=identity_id)
    assert restored.content == "# Annie\n\nCalm and curious.\n"
    assert restored.aggregate_revision == 5


@pytest.mark.asyncio
async def test_identity_auto_approve_applies_the_change(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    anima_id, identity_id = await _anima_with_identity(async_session, user_id=user_id)

    run = await memory_manager_router.create_memory_manager_run(
        PyMemoryManagerRunCreateRequest(
            message=f"Update animas/{anima_id}/IDENTITY.md with a note about rainy days.",
            auto_approve_diffs=True,
        ),
        session=async_session,
        user=_user(user_id),
    )

    assert [approval.status for approval in run.approvals] == ["approved"]
    assert "rainy days" in (await _identity(async_session, user_id=user_id, entry_id=identity_id)).content


@pytest.mark.asyncio
async def test_stale_or_deleted_identity_approvals_conflict_but_can_be_rejected(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    user = _user(user_id)
    anima_id, identity_id = await _anima_with_identity(async_session, user_id=user_id)
    manager_path = f"animas/{anima_id}/IDENTITY.md"

    stale = await memory_manager_router.create_memory_manager_run(
        PyMemoryManagerRunCreateRequest(message=f"Update {manager_path} with a stale note."),
        session=async_session,
        user=user,
    )
    current = await _identity(async_session, user_id=user_id, entry_id=identity_id)
    await memory_entries_router.patch_memory_entry(
        identity_id,
        PyMemoryEntryPatchRequest(
            content="# Annie\n\nEdited elsewhere.\n",
            expected_version=current.version,
            expected_aggregate_revision=current.aggregate_revision,
        ),
        session=async_session,
        user=user,
    )
    with pytest.raises(HTTPException) as stale_error:
        await memory_manager_router.decide_memory_manager_approval(
            stale.approvals[0].id,
            PyMemoryManagerApprovalDecisionRequest(decision="approve"),
            session=async_session,
            user=user,
        )
    assert stale_error.value.status_code == 409
    rejected = await memory_manager_router.decide_memory_manager_approval(
        stale.approvals[0].id,
        PyMemoryManagerApprovalDecisionRequest(decision="reject"),
        session=async_session,
        user=user,
    )
    assert rejected.status == "rejected"

    pending = await memory_manager_router.create_memory_manager_run(
        PyMemoryManagerRunCreateRequest(message=f"Update {manager_path} before deletion."),
        session=async_session,
        user=user,
    )
    await anima_router.delete_anima(anima_id, session=async_session, user=user)
    with pytest.raises(HTTPException) as deleted_error:
        await memory_manager_router.decide_memory_manager_approval(
            pending.approvals[0].id,
            PyMemoryManagerApprovalDecisionRequest(decision="approve"),
            session=async_session,
            user=user,
        )
    assert deleted_error.value.status_code == 409
    assert "no longer exists" in deleted_error.value.detail
    rejected_after_delete = await memory_manager_router.decide_memory_manager_approval(
        pending.approvals[0].id,
        PyMemoryManagerApprovalDecisionRequest(decision="reject"),
        session=async_session,
        user=user,
    )
    assert rejected_after_delete.status == "rejected"


@pytest.mark.asyncio
async def test_episode_processing_runs_cannot_change_identities(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    anima_id, identity_id = await _anima_with_identity(async_session, user_id=user_id)
    identity = await _identity(async_session, user_id=user_id, entry_id=identity_id)
    run_id = f"mmr-{uuid.uuid4()}"
    approval_id = f"mma-{uuid.uuid4()}"
    async_session.add(
        ORMMemoryManagerRun(id=run_id, user_id=user_id, status="waiting_approval", kind="episode_processing")
    )
    await async_session.flush()
    async_session.add(
        ORMMemoryManagerApproval(
            id=approval_id,
            run_id=run_id,
            user_id=user_id,
            status="pending",
            operation="update",
            target_path=f"animas/{anima_id}/IDENTITY.md",
            target_entry_id=identity_id,
            expected_version=identity.version,
            old_content=identity.content,
            new_content="# Annie\n\nInferred from episodes.\n",
            old_description=identity.description,
            new_description=identity.description,
            unified_diff="",
            operation_metadata={},
        )
    )
    await async_session.commit()

    with pytest.raises(HTTPException) as error:
        await memory_manager_router.decide_memory_manager_approval(
            approval_id,
            PyMemoryManagerApprovalDecisionRequest(decision="approve"),
            session=async_session,
            user=_user(user_id),
        )
    assert error.value.status_code == 400
    unchanged = await _identity(async_session, user_id=user_id, entry_id=identity_id)
    assert unchanged.content == "# Annie\n\nCalm and curious.\n"


def test_live_runtime_limits_identity_access_to_general_runs() -> None:
    general = MemoryManagerRun(id="run-general", user_id="user", status="active")
    episode = MemoryManagerRun(id="run-episode", user_id="user", status="active", kind="episode_processing")

    assert _allows_anima_identities(general) is True
    assert _allows_anima_identities(episode) is False
    assert "animas/<anima_id>/IDENTITY.md" in _instructions(memory_map="", anima_identities=True)
    assert "animas/" not in _instructions(memory_map="", anima_identities=False)


@pytest.mark.asyncio
async def test_deterministic_runtime_keeps_processed_episode_runs_out_of_identities(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    anima_id, _identity_id = await _anima_with_identity(async_session, user_id=user_id)
    runtime = DeterministicMemoryManagerRuntime(user_id=user_id, memory_entries=_entries(async_session))
    processed = MemoryManagerEpisodeTaskState(
        status="processed",
        items=(MemoryManagerEpisodeTaskItem(episode_item_id="mei-1", ref="E01"),),
        has_more=False,
        started_at=datetime.now(UTC),
        processed_at=datetime.now(UTC),
    )
    run = MemoryManagerRun(
        id="run-episode",
        user_id=user_id,
        status="active",
        kind="episode_processing",
        task_state=processed.to_dict(),
    )
    message = MemoryManagerMessage(
        id="message",
        run_id=run.id,
        user_id=user_id,
        role="user",
        content=f"Update animas/{anima_id}/IDENTITY.md with a note.",
    )

    result = await runtime.run_user_message(run=run, user_message=message)

    assert not result.approvals
    assert "could not prepare" in (result.assistant_message or "")
