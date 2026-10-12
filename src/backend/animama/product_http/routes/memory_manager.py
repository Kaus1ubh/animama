"""Memory Manager run, message and approval routes, shared by every composition (ADR 0021).

Each handler asks the composition's ports for the owner's Memory Manager service,
which decides the model runtime; the routes own the request and response mapping,
the error mapping and the owner's time zone for Reflection.
"""

from __future__ import annotations

from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException, status

from animama.app.contracts.memory_manager import (
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
from animama.app.services.memory_episode_service import (
    MemoryEpisodeError,
    MemoryEpisodeNotFoundError,
    MemoryEpisodeValidationError,
)
from animama.app.services.memory_manager_service import (
    MemoryManagerConflictError,
    MemoryManagerError,
    MemoryManagerNotFoundError,
    MemoryManagerValidationError,
)
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
from animama.product_http.ports import (
    Ports,
    ProductRefusal,
    ProductRepositories,
    ReadSession,
    WriteSession,
    refusal_error,
)
from animama.product_http.principal import get_current_principal

router = APIRouter()
UserDep = Annotated[RequestPrincipal, Depends(get_current_principal)]


async def _owner_timezone(repositories: ProductRepositories, user_id: str) -> str:
    """Return the owner's valid IANA time zone preference, or UTC."""

    user_settings = await repositories.user_settings.get(user_id)
    _zone, name = preferred_time_zone(user_settings.preferences if user_settings is not None else None)
    return name


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
    if isinstance(exc, ProductRefusal):
        raise refusal_error(exc) from exc
    if isinstance(exc, MemoryManagerValidationError | MemoryEpisodeValidationError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.detail) from exc
    if isinstance(exc, MemoryManagerNotFoundError | MemoryEpisodeNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.detail) from exc
    if isinstance(exc, MemoryManagerConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.detail) from exc
    if isinstance(exc, MemoryManagerError | MemoryEpisodeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.detail) from exc
    raise exc


@router.post(
    "/v1/memory/manager/runs",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_memory_manager_run(
    req: PyMemoryManagerRunCreateRequest,
    session: WriteSession,
    user: UserDep,
    ports: Ports,
) -> PyMemoryManagerRunResponse:
    """Create a manual memory-manager chat run."""

    try:
        service = await ports.memory_manager(session, user)
        snapshot = await service.create_run(
            user_id=user.id,
            initial_message=req.message,
            auto_approve_diffs=req.auto_approve_diffs,
            metadata=req.metadata,
        )
    except (MemoryManagerError, ProductRefusal) as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot)


@router.post(
    "/v1/memory/manager/runs:process-episodes",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_episode_processing_memory_manager_run(
    req: PyMemoryManagerEpisodeProcessingRunCreateRequest,
    session: WriteSession,
    user: UserDep,
    ports: Ports,
) -> PyMemoryManagerRunResponse:
    """Create a specialized fixed-batch episodic-memory review run."""

    try:
        service = await ports.memory_manager(session, user)
        snapshot = await service.create_episode_processing_run(
            user_id=user.id,
            auto_approve_diffs=req.auto_approve_diffs,
        )
    except (MemoryManagerError, ProductRefusal) as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot)


@router.post(
    "/v1/memory/manager/runs:reflect",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_reflection_memory_manager_run(
    req: PyMemoryManagerReflectionRunCreateRequest,
    session: WriteSession,
    user: UserDep,
    ports: Ports,
) -> PyMemoryManagerRunResponse:
    """Start a Reflection over one owned Anima's uncovered chat turns.

    Returns 404 for a missing or foreign Anima and 409 while an approval is
    pending, when the Anima's MEMORIES.md needs repair, or when no turn is
    uncovered; a 409 creates no run.
    """

    try:
        service = await ports.memory_manager(session, user)
        snapshot = await service.create_reflection_run(
            user_id=user.id,
            anima_id=req.anima_id,
            auto_approve_diffs=req.auto_approve_diffs,
            timezone=await _owner_timezone(ports.repositories(session), user.id),
        )
    except (MemoryManagerError, ProductRefusal) as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot)


@router.get(
    "/v1/memory/manager/runs/current",
    response_model=PyMemoryManagerRunResponse | None,
    status_code=status.HTTP_200_OK,
)
async def get_current_memory_manager_run(
    session: ReadSession,
    user: UserDep,
    ports: Ports,
) -> PyMemoryManagerRunResponse | None:
    """Read the current user's one open memory-manager run, if present."""

    try:
        service = await ports.memory_manager(session, user)
        snapshot = await service.get_current_run_snapshot(user_id=user.id)
    except (MemoryManagerError, ProductRefusal) as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot) if snapshot is not None else None


@router.get(
    "/v1/memory/manager/runs/{run_id}",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_200_OK,
)
async def get_memory_manager_run(
    run_id: str,
    session: ReadSession,
    user: UserDep,
    ports: Ports,
) -> PyMemoryManagerRunResponse:
    """Read one current-user memory-manager run."""

    try:
        service = await ports.memory_manager(session, user)
        snapshot = await service.get_run_snapshot(user_id=user.id, run_id=run_id)
    except (MemoryManagerError, ProductRefusal) as exc:
        _raise_http_error(exc)
    return _to_run_response(snapshot)


@router.post(
    "/v1/memory/manager/runs/{run_id}:complete",
    response_model=PyMemoryManagerRunResponse,
    status_code=status.HTTP_200_OK,
)
async def complete_memory_manager_run(
    run_id: str,
    session: WriteSession,
    user: UserDep,
    ports: Ports,
) -> PyMemoryManagerRunResponse:
    """Complete one current-user memory-manager run without pending approvals."""

    try:
        service = await ports.memory_manager(session, user)
        snapshot = await service.complete_run(user_id=user.id, run_id=run_id)
    except (MemoryManagerError, ProductRefusal) as exc:
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
    session: WriteSession,
    user: UserDep,
    ports: Ports,
) -> PyMemoryManagerRunResponse:
    """Append a user memory-maintenance request to a manager run."""

    try:
        service = await ports.memory_manager(session, user)
        snapshot = await service.append_user_message(
            user_id=user.id,
            run_id=run_id,
            content=req.content,
            auto_approve_diffs=req.auto_approve_diffs,
        )
    except (MemoryManagerError, ProductRefusal) as exc:
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
    session: WriteSession,
    user: UserDep,
    ports: Ports,
) -> PyMemoryManagerApproval:
    """Approve or reject one memory-manager approval."""

    try:
        service = await ports.memory_manager(session, user)
        approval = await service.decide_approval(
            user_id=user.id,
            approval_id=approval_id,
            decision=req.decision,
            feedback=req.feedback,
        )
    except (MemoryManagerError, ProductRefusal) as exc:
        _raise_http_error(exc)
    return _to_manager_approval(approval)


@router.post(
    "/v1/memory/manager/approvals/{approval_id}:undo",
    response_model=PyMemoryManagerApprovalUndoResponse,
    status_code=status.HTTP_200_OK,
)
async def undo_memory_manager_approval(
    approval_id: str,
    session: WriteSession,
    user: UserDep,
    ports: Ports,
) -> PyMemoryManagerApprovalUndoResponse:
    """Append the inverse of one still-applicable approved memory patch."""

    try:
        service = await ports.memory_manager(session, user)
        result = await service.undo_approval(
            user_id=user.id,
            approval_id=approval_id,
        )
    except (MemoryManagerError, ProductRefusal) as exc:
        _raise_http_error(exc)
    return _to_approval_undo_response(result)


__all__ = [
    "append_memory_manager_message",
    "complete_memory_manager_run",
    "create_episode_processing_memory_manager_run",
    "create_memory_manager_run",
    "create_reflection_memory_manager_run",
    "decide_memory_manager_approval",
    "get_current_memory_manager_run",
    "get_memory_manager_run",
    "router",
    "undo_memory_manager_approval",
]
