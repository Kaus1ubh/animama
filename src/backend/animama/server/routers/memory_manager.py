"""Authenticated episodic-memory and memory-manager workflow routes."""

from __future__ import annotations

import os
from typing import Annotated, Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.memory_manager import DeterministicMemoryManagerRuntime, OpenAIAgentsMemoryManagerRuntime
from animama.adapters.repositories.sqlalchemy.anima_memory_reflection_repo import (
    SQLAlchemyAnimaMemoryReflectionRepository,
)
from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.memory_episode_repo import SQLAlchemyMemoryEpisodeRepository
from animama.adapters.repositories.sqlalchemy.memory_manager_repo import SQLAlchemyMemoryManagerRepository
from animama.adapters.repositories.sqlalchemy.settings_repo import SQLAlchemyUserSettingsRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.memory_episode_service import (
    MemoryEpisodeError,
    MemoryEpisodeNotFoundError,
    MemoryEpisodeService,
    MemoryEpisodeValidationError,
)
from animama.app.services.memory_manager_service import (
    MemoryManagerConflictError,
    MemoryManagerError,
    MemoryManagerNotFoundError,
    MemoryManagerService,
    MemoryManagerValidationError,
)
from animama.app.services.model_role_resolver import ROLE_MEMORY_MANAGER
from animama.domain.memory_episode import MemoryEpisodeItem
from animama.domain.memory_manager import (
    MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING,
    MEMORY_MANAGER_RUN_KIND_REFLECTION,
    MemoryManagerApproval,
    MemoryManagerApprovalUndoResult,
    MemoryManagerEpisodeTaskState,
    MemoryManagerMessage,
    MemoryManagerReflectionTaskState,
    MemoryManagerRun,
    MemoryManagerRunSnapshot,
    MemoryPatchPreview,
)
from animama.domain.request_principal import RequestPrincipal
from animama.domain.settings import preferred_time_zone
from animama.server.config import settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.model_clients import build_model_credential_resolver, openai_base_url
from animama.server.model_roles import ModelRoleSettings, get_model_role_settings
from animama.server.schemas.memory_manager import (
    PyMemoryEpisodeItem,
    PyMemoryEpisodeListResponse,
    PyMemoryManagerApproval,
    PyMemoryManagerApprovalDecisionRequest,
    PyMemoryManagerApprovalUndoResponse,
    PyMemoryManagerEpisodeProcessingRunCreateRequest,
    PyMemoryManagerMessage,
    PyMemoryManagerMessageCreateRequest,
    PyMemoryManagerReflectionRunCreateRequest,
    PyMemoryManagerReflectionSummary,
    PyMemoryManagerRun,
    PyMemoryManagerRunCreateRequest,
    PyMemoryManagerRunResponse,
    PyMemoryManagerTaskSummary,
    PyMemoryPatchPreview,
)

router = APIRouter()
SessionDep = Annotated[AsyncSession, Depends(get_async_session)]
UserDep = Annotated[RequestPrincipal, Depends(get_current_principal)]
RolesDep = Annotated[ModelRoleSettings, Depends(get_model_role_settings)]


def _memory_entry_service(session: AsyncSession, *, commit_on_write: bool = True) -> MemoryEntryService:
    return MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        animas=SQLAlchemyAnimaRepository(session),
        max_file_bytes=settings.anima_memory_file_max_bytes,
        commit_on_write=commit_on_write,
    )


def _episode_service(session: AsyncSession) -> MemoryEpisodeService:
    return MemoryEpisodeService(
        memory_episodes=SQLAlchemyMemoryEpisodeRepository(session),
        memory_entries=_memory_entry_service(session),
        uow=SQLAlchemyUnitOfWork(session),
    )


async def _owner_timezone(session: AsyncSession, user_id: str) -> str:
    """Return the owner's valid IANA time zone preference, or UTC."""

    user_settings = await SQLAlchemyUserSettingsRepository(session).get(user_id)
    _zone, name = preferred_time_zone(user_settings.preferences if user_settings is not None else None)
    return name


async def _manager_service(session: AsyncSession, user_id: str, roles: ModelRoleSettings) -> MemoryManagerService:
    """Build a request-local manager service with the current user's model."""

    memory_entries = _memory_entry_service(session, commit_on_write=False)
    uow = SQLAlchemyUnitOfWork(session)
    memory_episode_repository = SQLAlchemyMemoryEpisodeRepository(session)
    anima_repository = SQLAlchemyAnimaRepository(session)
    chat_message_repository = SQLAlchemyChatMessageRepository(session)
    memory_episodes = MemoryEpisodeService(
        memory_episodes=memory_episode_repository,
        memory_entries=memory_entries,
        uow=uow,
        commit_on_write=False,
    )
    runtime = (
        DeterministicMemoryManagerRuntime(
            user_id=user_id,
            memory_entries=memory_entries,
            memory_episodes=memory_episode_repository,
            animas=anima_repository,
            chat_messages=chat_message_repository,
        )
        if _truthy_env(os.getenv("ANIMAMA_LLM_SKIP"))
        else OpenAIAgentsMemoryManagerRuntime(
            user_id=user_id,
            memory_entries=memory_entries,
            memory_episodes=memory_episode_repository,
            animas=anima_repository,
            chat_messages=chat_message_repository,
            model_provider=(await roles.resolver(session).resolve(user_id, ROLE_MEMORY_MANAGER)).model_provider,
            credential_resolver=build_model_credential_resolver(),
            openai_base_url=openai_base_url(),
            timeout_seconds=settings.anima_model_client_timeout_seconds,
        )
    )
    return MemoryManagerService(
        memory_manager=SQLAlchemyMemoryManagerRepository(session),
        memory_entries=memory_entries,
        memory_episodes=memory_episodes,
        chat_messages=chat_message_repository,
        anima_reflections=SQLAlchemyAnimaMemoryReflectionRepository(session),
        runtime=runtime,
        uow=uow,
    )


def _truthy_env(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _to_episode_item(item: MemoryEpisodeItem) -> PyMemoryEpisodeItem:
    return PyMemoryEpisodeItem(
        id=item.id,
        source_anima_id=item.source_anima_id,
        source_chat_id=item.source_chat_id,
        source_run_id=item.source_run_id,
        source_message_id=item.source_message_id,
        occurred_at=item.occurred_at,
        local_date=item.local_date,
        local_timezone=item.local_timezone,
        episode_path=item.episode_path,
        kind=item.kind,
        text=item.text,
        status=item.status,
        processed_at=item.processed_at,
        processed_by_run_id=item.processed_by_run_id,
        metadata=dict(item.metadata or {}),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _to_patch_preview(preview: MemoryPatchPreview) -> PyMemoryPatchPreview:
    return PyMemoryPatchPreview(
        operation=preview.operation,
        path=preview.path,
        old_content=preview.old_content,
        new_content=preview.new_content,
        old_description=preview.old_description,
        new_description=preview.new_description,
        unified_diff=preview.unified_diff,
        expected_version=preview.expected_version,
        summary=preview.summary,
    )


def _to_manager_run(run: MemoryManagerRun) -> PyMemoryManagerRun:
    task_summary = None
    reflection_summary = None
    if run.task_state is not None and run.kind == MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING:
        task = MemoryManagerEpisodeTaskState.from_dict(run.task_state)
        task_summary = PyMemoryManagerTaskSummary(
            kind=task.kind,
            status=task.status,
            batch_size=task.batch_size,
            has_more=task.has_more,
            started_at=task.started_at,
            processed_at=task.processed_at,
        )
    elif run.task_state is not None and run.kind == MEMORY_MANAGER_RUN_KIND_REFLECTION:
        reflection = MemoryManagerReflectionTaskState.from_dict(run.task_state)
        reflection_summary = PyMemoryManagerReflectionSummary(
            anima_id=reflection.anima_id,
            anima_name=reflection.anima_name,
            turn_count=reflection.turn_count,
            remaining_turn_count=reflection.remaining_turn_count,
            started_at=reflection.started_at,
        )
    return PyMemoryManagerRun(
        id=run.id,
        status=run.status,
        kind=run.kind,
        task=task_summary,
        reflection=reflection_summary,
        model_provider=run.model_provider,
        model_name=run.model_name,
        summary=run.summary,
        error=run.error,
        usage_metadata=dict(run.usage_metadata or {}),
        metadata=dict(run.metadata or {}),
        created_at=run.created_at,
        updated_at=run.updated_at,
        completed_at=run.completed_at,
    )


def _to_manager_message(message: MemoryManagerMessage) -> PyMemoryManagerMessage:
    return PyMemoryManagerMessage(
        id=message.id,
        run_id=message.run_id,
        role=message.role,
        content=message.content,
        metadata=dict(message.metadata or {}),
        created_at=message.created_at,
    )


def _to_manager_approval(approval: MemoryManagerApproval) -> PyMemoryManagerApproval:
    return PyMemoryManagerApproval(
        id=approval.id,
        run_id=approval.run_id,
        status=approval.status,
        target_entry_id=approval.target_entry_id,
        operation_metadata=dict(approval.operation_metadata or {}),
        created_at=approval.created_at,
        updated_at=approval.updated_at,
        decided_at=approval.decided_at,
        decision_feedback=approval.decision_feedback,
        applied_version=approval.applied_version,
        undone_at=approval.undone_at,
        undo_version=approval.undo_version,
        can_undo=approval.can_undo,
        preview=_to_patch_preview(approval.preview),
    )


def _to_approval_undo_response(
    result: MemoryManagerApprovalUndoResult,
) -> PyMemoryManagerApprovalUndoResponse:
    return PyMemoryManagerApprovalUndoResponse(
        approval=_to_manager_approval(result.approval),
        target_entry_id=result.target_entry_id,
        undo_version=result.undo_version,
        deleted=result.deleted,
    )


def _to_run_response(snapshot: MemoryManagerRunSnapshot) -> PyMemoryManagerRunResponse:
    return PyMemoryManagerRunResponse(
        run=_to_manager_run(snapshot.run),
        messages=[_to_manager_message(message) for message in snapshot.messages],
        approvals=[_to_manager_approval(approval) for approval in snapshot.approvals],
    )


def _raise_http_error(exc: Exception) -> NoReturn:
    if isinstance(exc, MemoryManagerValidationError | MemoryEpisodeValidationError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.detail) from exc
    if isinstance(exc, MemoryManagerNotFoundError | MemoryEpisodeNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.detail) from exc
    if isinstance(exc, MemoryManagerConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.detail) from exc
    if isinstance(exc, MemoryManagerError | MemoryEpisodeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.detail) from exc
    raise exc


@router.get(
    "/v1/memory/episodes",
    response_model=PyMemoryEpisodeListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_memory_episodes(
    session: SessionDep,
    user: UserDep,
    status: Annotated[Literal["pending", "processed"] | None, Query()] = "pending",
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
) -> PyMemoryEpisodeListResponse:
    """List current-user episodic-memory items for manual review."""

    try:
        items = await _episode_service(session).list_episode_items(
            user_id=user.id,
            status=status,
            limit=limit,
        )
    except (MemoryEpisodeValidationError, MemoryEpisodeNotFoundError) as exc:
        _raise_http_error(exc)
    return PyMemoryEpisodeListResponse(items=[_to_episode_item(item) for item in items])


@router.post(
    "/v1/memory/manager/runs",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_memory_manager_run(
    req: PyMemoryManagerRunCreateRequest,
    session: SessionDep,
    user: UserDep,
    roles: RolesDep,
) -> PyMemoryManagerRunResponse:
    """Create a manual memory-manager chat run."""

    try:
        service = await _manager_service(session, user.id, roles)
        snapshot = await service.create_run(
            user_id=user.id,
            initial_message=req.message,
            auto_approve_diffs=req.auto_approve_diffs,
            metadata=req.metadata,
        )
    except MemoryManagerError as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot)


@router.post(
    "/v1/memory/manager/runs:process-episodes",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_episode_processing_memory_manager_run(
    req: PyMemoryManagerEpisodeProcessingRunCreateRequest,
    session: SessionDep,
    user: UserDep,
    roles: RolesDep,
) -> PyMemoryManagerRunResponse:
    """Create a specialized fixed-batch episodic-memory review run."""

    try:
        service = await _manager_service(session, user.id, roles)
        snapshot = await service.create_episode_processing_run(
            user_id=user.id,
            auto_approve_diffs=req.auto_approve_diffs,
        )
    except MemoryManagerError as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot)


@router.post(
    "/v1/memory/manager/runs:reflect",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reflection_memory_manager_run(
    req: PyMemoryManagerReflectionRunCreateRequest,
    session: SessionDep,
    user: UserDep,
    roles: RolesDep,
) -> PyMemoryManagerRunResponse:
    """Start a Reflection over one owned Anima's uncovered chat turns.

    Returns 404 for a missing or foreign Anima and 409 while an approval is
    pending, when the Anima's MEMORIES.md needs repair, or when no turn is
    uncovered; a 409 creates no run.
    """

    try:
        service = await _manager_service(session, user.id, roles)
        snapshot = await service.create_reflection_run(
            user_id=user.id,
            anima_id=req.anima_id,
            auto_approve_diffs=req.auto_approve_diffs,
            timezone=await _owner_timezone(session, user.id),
        )
    except MemoryManagerError as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot)


@router.get(
    "/v1/memory/manager/runs/current",
    response_model=PyMemoryManagerRunResponse | None,
    status_code=status.HTTP_200_OK,
)
async def get_current_memory_manager_run(
    session: SessionDep,
    user: UserDep,
    roles: RolesDep,
) -> PyMemoryManagerRunResponse | None:
    """Read the current user's one open memory-manager run, if present."""

    try:
        service = await _manager_service(session, user.id, roles)
        snapshot = await service.get_current_run_snapshot(user_id=user.id)
    except MemoryManagerError as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot) if snapshot is not None else None


@router.get(
    "/v1/memory/manager/runs/{run_id}",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_200_OK,
)
async def get_memory_manager_run(
    run_id: str,
    session: SessionDep,
    user: UserDep,
    roles: RolesDep,
) -> PyMemoryManagerRunResponse:
    """Read one current-user memory-manager run."""

    try:
        service = await _manager_service(session, user.id, roles)
        snapshot = await service.get_run_snapshot(user_id=user.id, run_id=run_id)
    except MemoryManagerError as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot)


@router.post(
    "/v1/memory/manager/runs/{run_id}:complete",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_200_OK,
)
async def complete_memory_manager_run(
    run_id: str,
    session: SessionDep,
    user: UserDep,
    roles: RolesDep,
) -> PyMemoryManagerRunResponse:
    """Complete one current-user memory-manager run without pending approvals."""

    try:
        service = await _manager_service(session, user.id, roles)
        snapshot = await service.complete_run(user_id=user.id, run_id=run_id)
    except MemoryManagerError as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot)


@router.post(
    "/v1/memory/manager/runs/{run_id}/messages",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_200_OK,
)
async def append_memory_manager_message(
    run_id: str,
    req: PyMemoryManagerMessageCreateRequest,
    session: SessionDep,
    user: UserDep,
    roles: RolesDep,
) -> PyMemoryManagerRunResponse:
    """Append a user memory-maintenance request to a manager run."""

    try:
        service = await _manager_service(session, user.id, roles)
        snapshot = await service.append_user_message(
            user_id=user.id,
            run_id=run_id,
            content=req.content,
            auto_approve_diffs=req.auto_approve_diffs,
        )
    except MemoryManagerError as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot)


@router.post(
    "/v1/memory/manager/approvals/{approval_id}:decide",
    response_model=PyMemoryManagerApproval,
    status_code=status.HTTP_200_OK,
)
async def decide_memory_manager_approval(
    approval_id: str,
    req: PyMemoryManagerApprovalDecisionRequest,
    session: SessionDep,
    user: UserDep,
    roles: RolesDep,
) -> PyMemoryManagerApproval:
    """Approve or reject one memory-manager approval."""

    try:
        service = await _manager_service(session, user.id, roles)
        approval = await service.decide_approval(
            user_id=user.id,
            approval_id=approval_id,
            decision=req.decision,
            feedback=req.feedback,
        )
    except MemoryManagerError as exc:
        _raise_http_error(exc)
    return _to_manager_approval(approval)


@router.post(
    "/v1/memory/manager/approvals/{approval_id}:undo",
    response_model=PyMemoryManagerApprovalUndoResponse,
    status_code=status.HTTP_200_OK,
)
async def undo_memory_manager_approval(
    approval_id: str,
    session: SessionDep,
    user: UserDep,
    roles: RolesDep,
) -> PyMemoryManagerApprovalUndoResponse:
    """Append the inverse of one still-applicable approved memory patch."""

    try:
        service = await _manager_service(session, user.id, roles)
        result = await service.undo_approval(
            user_id=user.id,
            approval_id=approval_id,
        )
    except MemoryManagerError as exc:
        _raise_http_error(exc)
    return _to_approval_undo_response(result)


__all__ = [
    "append_memory_manager_message",
    "complete_memory_manager_run",
    "create_memory_manager_run",
    "create_episode_processing_memory_manager_run",
    "create_reflection_memory_manager_run",
    "decide_memory_manager_approval",
    "get_current_memory_manager_run",
    "get_memory_manager_run",
    "list_memory_episodes",
    "router",
    "undo_memory_manager_approval",
]
