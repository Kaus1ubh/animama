"""Manual memory-manager chat workflow and approval commit orchestration."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from typing import Any, NoReturn

from animama.app.ports.memory_manager_runtime import (
    MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED,
    MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
    MEMORY_MANAGER_RUNTIME_OUTCOME_FAILED,
    MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL,
    MEMORY_MANAGER_RUNTIME_OUTCOMES,
    MemoryManagerRuntime,
    MemoryManagerRuntimeApprovalRequest,
    MemoryManagerRuntimeError,
    MemoryManagerRuntimeResult,
)
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE, MemoryEntry
from animama.domain.memory_manager import (
    MEMORY_MANAGER_APPROVAL_STATUS_APPROVED,
    MEMORY_MANAGER_APPROVAL_STATUS_PENDING,
    MEMORY_MANAGER_APPROVAL_STATUS_REJECTED,
    MEMORY_MANAGER_APPROVAL_STATUSES,
    MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSED,
    MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING,
    MEMORY_MANAGER_MESSAGE_ROLE_ASSISTANT,
    MEMORY_MANAGER_MESSAGE_ROLE_USER,
    MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING,
    MEMORY_MANAGER_RUN_KIND_GENERAL,
    MEMORY_MANAGER_RUN_STATUS_ACTIVE,
    MEMORY_MANAGER_RUN_STATUS_COMPLETED,
    MEMORY_MANAGER_RUN_STATUS_FAILED,
    MEMORY_MANAGER_RUN_STATUS_WAITING_APPROVAL,
    MEMORY_PATCH_OPERATION_CREATE,
    MEMORY_PATCH_OPERATION_UPDATE,
    MemoryManagerApproval,
    MemoryManagerApprovalUndoResult,
    MemoryManagerEpisodeTaskItem,
    MemoryManagerEpisodeTaskState,
    MemoryManagerMessage,
    MemoryManagerRun,
    MemoryManagerRunSnapshot,
    new_memory_manager_approval_id,
    new_memory_manager_message_id,
    new_memory_manager_run_id,
)
from animama.logging import get_logger

from ..ports.memory_manager_port import MemoryManagerRepository, MemoryManagerRepositoryConflictError
from ..ports.uow_port import UnitOfWork
from .anima_identity_memory import anima_identity_manager_path, parse_anima_identity_manager_path
from .memory_entry_service import (
    MemoryEntryConflictError,
    MemoryEntryNotFoundError,
    MemoryEntryProtectedError,
    MemoryEntryService,
    MemoryEntryValidationError,
    is_anima_identity,
    is_protected_memory_entry,
    is_protected_memory_path,
    normalize_memory_file_path,
)
from .memory_episode_service import MemoryEpisodeConflictError, MemoryEpisodeService

_MEMORY_MANAGER_MESSAGE_MAX_CHARS = 4000
_MAX_AUTO_APPROVALS_PER_MESSAGE = 8
_USER_MEMORY_KIND = "user_memory"
_USAGE_COUNTER_KEYS = frozenset({"requests", "input_tokens", "output_tokens", "total_tokens"})
_SUPERSEDED_COMPLETION_REASON = "superseded_by_new_run"
_EPISODE_PROCESSING_BATCH_SIZE = 50
_REJECTION_FEEDBACK_MAX_CHARS = 2000


class MemoryManagerError(Exception):
    """Base class for memory-manager service errors."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class MemoryManagerValidationError(MemoryManagerError):
    """Raised when a manager request is invalid."""


class MemoryManagerNotFoundError(MemoryManagerError):
    """Raised when a run or approval is not visible to the current user."""


class MemoryManagerConflictError(MemoryManagerError):
    """Raised when a manager state transition is not allowed."""


class MemoryManagerService:
    """Use-case service for memory-manager runs, approvals, and commits."""

    def __init__(
        self,
        *,
        memory_manager: MemoryManagerRepository,
        memory_entries: MemoryEntryService,
        memory_episodes: MemoryEpisodeService | None = None,
        runtime: MemoryManagerRuntime,
        uow: UnitOfWork,
        commit_on_write: bool = True,
    ) -> None:
        self._memory_manager = memory_manager
        self._memory_entries = memory_entries
        self._memory_episodes = memory_episodes
        self._runtime = runtime
        self._uow = uow
        self._commit_on_write = commit_on_write
        self._log = get_logger("app.services.memory_manager")

    async def create_run(
        self,
        *,
        user_id: str,
        initial_message: str | None = None,
        auto_approve_diffs: bool = False,
        metadata: dict[str, object] | None = None,
    ) -> MemoryManagerRunSnapshot:
        """Create a manual memory-manager run and optionally submit its first message."""

        try:
            open_runs = await self._memory_manager.list_open_runs_for_update(user_id=user_id)
            if any(run.status == MEMORY_MANAGER_RUN_STATUS_WAITING_APPROVAL for run in open_runs):
                raise MemoryManagerConflictError("Resolve the pending memory approval before starting a new run")

            superseded_at = datetime.utcnow()
            for open_run in open_runs:
                await self._memory_manager.update_run(
                    replace(
                        open_run,
                        status=MEMORY_MANAGER_RUN_STATUS_COMPLETED,
                        completed_at=superseded_at,
                        metadata={
                            **dict(open_run.metadata or {}),
                            "completion_reason": _SUPERSEDED_COMPLETION_REASON,
                        },
                    )
                )

            run = MemoryManagerRun(
                id=new_memory_manager_run_id(),
                user_id=user_id,
                status=MEMORY_MANAGER_RUN_STATUS_ACTIVE,
                kind=MEMORY_MANAGER_RUN_KIND_GENERAL,
                metadata={
                    "runtime": self._runtime.name,
                    **dict(metadata or {}),
                },
            )
            stored = await self._memory_manager.create_run(run)
            await self._commit_if_enabled()
        except MemoryManagerRepositoryConflictError as exc:
            await self._rollback_if_enabled()
            raise MemoryManagerConflictError(
                "Another memory manager run is already open; reload and continue it"
            ) from exc
        except Exception:
            await self._rollback_if_enabled()
            raise
        self._log.info("MemoryManagerService.create_run.created", user_id=user_id, run_id=stored.id)
        if initial_message is not None and initial_message.strip():
            return await self.append_user_message(
                user_id=user_id,
                run_id=stored.id,
                content=initial_message,
                auto_approve_diffs=auto_approve_diffs,
            )
        return await self.get_run_snapshot(user_id=user_id, run_id=stored.id)

    async def create_episode_processing_run(
        self,
        *,
        user_id: str,
        auto_approve_diffs: bool = False,
    ) -> MemoryManagerRunSnapshot:
        """Create and execute one backend-owned fixed episode review batch."""

        if self._memory_episodes is None:
            raise MemoryManagerValidationError("Episode processing is not configured")
        try:
            open_runs = await self._memory_manager.list_open_runs_for_update(user_id=user_id)
            if any(run.status == MEMORY_MANAGER_RUN_STATUS_WAITING_APPROVAL for run in open_runs):
                raise MemoryManagerConflictError("Resolve the pending memory approval before processing episodes")

            candidates = await self._memory_episodes.select_pending_batch_for_update(
                user_id=user_id,
                limit=_EPISODE_PROCESSING_BATCH_SIZE + 1,
            )
            if not candidates:
                raise MemoryManagerConflictError("No pending episodes are available to process")

            selected = candidates[:_EPISODE_PROCESSING_BATCH_SIZE]
            started_at = datetime.now(UTC)
            task = MemoryManagerEpisodeTaskState(
                status=MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING,
                items=tuple(
                    MemoryManagerEpisodeTaskItem(
                        episode_item_id=item.id,
                        ref=f"E{index:02d}",
                    )
                    for index, item in enumerate(selected, start=1)
                ),
                has_more=len(candidates) > _EPISODE_PROCESSING_BATCH_SIZE,
                started_at=started_at,
            )

            superseded_at = datetime.utcnow()
            for open_run in open_runs:
                await self._memory_manager.update_run(
                    replace(
                        open_run,
                        status=MEMORY_MANAGER_RUN_STATUS_COMPLETED,
                        completed_at=superseded_at,
                        metadata={
                            **dict(open_run.metadata or {}),
                            "completion_reason": _SUPERSEDED_COMPLETION_REASON,
                        },
                    )
                )

            run = MemoryManagerRun(
                id=new_memory_manager_run_id(),
                user_id=user_id,
                status=MEMORY_MANAGER_RUN_STATUS_ACTIVE,
                kind=MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING,
                task_state=task.to_dict(),
                metadata={"runtime": self._runtime.name},
            )
            stored = await self._memory_manager.create_run(run)
            await self._commit_if_enabled()
        except MemoryManagerRepositoryConflictError as exc:
            await self._rollback_if_enabled()
            raise MemoryManagerConflictError(
                "Another memory manager run is already open; reload and continue it"
            ) from exc
        except Exception:
            await self._rollback_if_enabled()
            raise

        self._log.info(
            "MemoryManagerService.create_episode_processing_run.created",
            user_id=user_id,
            run_id=stored.id,
            batch_size=task.batch_size,
            has_more=task.has_more,
        )
        return await self.append_user_message(
            user_id=user_id,
            run_id=stored.id,
            content=f"Process {task.batch_size} pending episodes.",
            auto_approve_diffs=auto_approve_diffs,
        )

    async def get_current_run_snapshot(self, *, user_id: str) -> MemoryManagerRunSnapshot | None:
        """Return the user's one open run, or None when no run is active."""

        open_runs = await self._memory_manager.list_open_runs(user_id=user_id)
        if len(open_runs) > 1:
            raise MemoryManagerConflictError(
                "Multiple open memory manager runs were found; reset or repair the local database"
            )
        if not open_runs:
            return None
        return await self.get_run_snapshot(user_id=user_id, run_id=open_runs[0].id)

    async def get_run_snapshot(self, *, user_id: str, run_id: str) -> MemoryManagerRunSnapshot:
        """Return the current run with visible messages and approval rows."""

        run = await self._memory_manager.get_run(user_id=user_id, run_id=run_id)
        if run is None:
            raise MemoryManagerNotFoundError("Memory manager run not found")
        messages = await self._memory_manager.list_messages(user_id=user_id, run_id=run_id)
        approvals = await self._memory_manager.list_approvals(user_id=user_id, run_id=run_id)
        has_pending_approval = any(approval.status == MEMORY_MANAGER_APPROVAL_STATUS_PENDING for approval in approvals)
        projected_approvals = [
            replace(
                approval,
                can_undo=await self._can_undo_approval(
                    user_id=user_id,
                    approval=approval,
                    run_has_pending_approval=has_pending_approval,
                ),
            )
            for approval in approvals
        ]
        return MemoryManagerRunSnapshot(
            run=run,
            messages=messages,
            approvals=projected_approvals,
        )

    async def complete_run(self, *, user_id: str, run_id: str) -> MemoryManagerRunSnapshot:
        """Close an owned run after confirming no approval remains unresolved."""

        try:
            run = await self._memory_manager.get_run_for_update(user_id=user_id, run_id=run_id)
            if run is None:
                raise MemoryManagerNotFoundError("Memory manager run not found")
            if run.status in {MEMORY_MANAGER_RUN_STATUS_COMPLETED, MEMORY_MANAGER_RUN_STATUS_FAILED}:
                await self._commit_if_enabled()
                return await self.get_run_snapshot(user_id=user_id, run_id=run_id)

            approvals = await self._memory_manager.list_approvals(user_id=user_id, run_id=run_id)
            if any(item.status == MEMORY_MANAGER_APPROVAL_STATUS_PENDING for item in approvals):
                raise MemoryManagerConflictError("Resolve pending memory approvals before completing this run")

            await self._memory_manager.update_run(
                replace(
                    run,
                    status=MEMORY_MANAGER_RUN_STATUS_COMPLETED,
                    completed_at=datetime.utcnow(),
                )
            )
            await self._commit_if_enabled()
        except Exception:
            await self._rollback_if_enabled()
            raise
        self._log.info("MemoryManagerService.complete_run.completed", user_id=user_id, run_id=run_id)
        return await self.get_run_snapshot(user_id=user_id, run_id=run_id)

    async def append_user_message(
        self,
        *,
        user_id: str,
        run_id: str,
        content: str,
        auto_approve_diffs: bool = False,
    ) -> MemoryManagerRunSnapshot:
        """Append one user request and run the configured manager runtime."""

        clean_content = self._normalize_message_content(content)
        try:
            run = await self._memory_manager.get_run_for_update(user_id=user_id, run_id=run_id)
            if run is None:
                raise MemoryManagerNotFoundError("Memory manager run not found")
            if run.status in {MEMORY_MANAGER_RUN_STATUS_COMPLETED, MEMORY_MANAGER_RUN_STATUS_FAILED}:
                raise MemoryManagerConflictError("Memory manager run is closed")
            if run.status == MEMORY_MANAGER_RUN_STATUS_WAITING_APPROVAL:
                approvals = await self._memory_manager.list_approvals(user_id=user_id, run_id=run.id)
                if any(item.status == MEMORY_MANAGER_APPROVAL_STATUS_PENDING for item in approvals):
                    raise MemoryManagerConflictError("Resolve pending memory approvals before sending another message")

            user_message = await self._memory_manager.create_message(
                MemoryManagerMessage(
                    id=new_memory_manager_message_id(),
                    run_id=run.id,
                    user_id=user_id,
                    role=MEMORY_MANAGER_MESSAGE_ROLE_USER,
                    content=clean_content,
                    metadata={"runtime": self._runtime.name},
                )
            )
            try:
                runtime_result = await self._runtime.run_user_message(
                    run=run,
                    user_message=user_message,
                )
            except MemoryManagerRuntimeError as exc:
                runtime_result = self._runtime_failure_result(exc)
            await self._persist_runtime_result(
                run=run,
                result=runtime_result,
                source_message_id=user_message.id,
            )
            await self._commit_if_enabled()
        except Exception:
            await self._rollback_if_enabled()
            raise
        if auto_approve_diffs:
            await self._auto_approve_message_diffs(
                user_id=user_id,
                run_id=run_id,
                source_message_id=user_message.id,
            )
        return await self.get_run_snapshot(user_id=user_id, run_id=run_id)

    async def decide_approval(
        self,
        *,
        user_id: str,
        approval_id: str,
        decision: str,
        feedback: str | None = None,
    ) -> MemoryManagerApproval:
        """Approve or reject a pending memory-manager proposal."""

        status = self._status_for_decision(decision)
        clean_feedback = self._normalize_rejection_feedback(feedback)
        if status != MEMORY_MANAGER_APPROVAL_STATUS_REJECTED and clean_feedback is not None:
            raise MemoryManagerValidationError("Feedback is only allowed when rejecting an approval")
        try:
            approval = await self._memory_manager.get_approval_for_update(user_id=user_id, approval_id=approval_id)
            if approval is None:
                raise MemoryManagerNotFoundError("Memory manager approval not found")
            if approval.status != MEMORY_MANAGER_APPROVAL_STATUS_PENDING:
                raise MemoryManagerConflictError("Memory manager approval is already decided")
            run = await self._memory_manager.get_run_for_update(user_id=user_id, run_id=approval.run_id)
            if run is None:
                raise MemoryManagerNotFoundError("Memory manager run not found")
            committed_entry_id = approval.target_entry_id
            applied_version = approval.applied_version
            if status == MEMORY_MANAGER_APPROVAL_STATUS_APPROVED:
                committed = await self._commit_approval_patch(user_id=user_id, approval=approval, run=run)
                committed_entry_id = committed.id
                applied_version = committed.version

            decided = replace(
                approval,
                status=status,
                target_entry_id=committed_entry_id,
                applied_version=applied_version,
                decision_feedback=clean_feedback,
                decided_at=datetime.utcnow(),
            )
            stored = await self._memory_manager.update_approval(decided)
            try:
                runtime_result = await self._runtime.resume_approval_decision(
                    run=run,
                    approval=stored,
                    decision=decision.strip().lower(),
                    feedback=clean_feedback,
                )
            except MemoryManagerRuntimeError as exc:
                runtime_result = self._runtime_failure_result(exc)
            await self._persist_runtime_result(
                run=run,
                result=runtime_result,
                source_message_id=self._approval_source_message_id(approval),
            )
            await self._commit_if_enabled()
        except Exception:
            await self._rollback_if_enabled()
            raise
        self._log.info(
            "MemoryManagerService.decide_approval.updated",
            user_id=user_id,
            approval_id=approval_id,
            status=status,
        )
        snapshot = await self.get_run_snapshot(user_id=user_id, run_id=stored.run_id)
        return next(item for item in snapshot.approvals if item.id == stored.id)

    async def undo_approval(
        self,
        *,
        user_id: str,
        approval_id: str,
    ) -> MemoryManagerApprovalUndoResult:
        """Append the one-level inverse of an eligible approved patch."""

        try:
            approval = await self._memory_manager.get_approval_for_update(
                user_id=user_id,
                approval_id=approval_id,
            )
            if approval is None:
                raise MemoryManagerNotFoundError("Memory manager approval not found")
            if approval.undone_at is not None or approval.undo_version is not None:
                if approval.undone_at is None or approval.undo_version is None or approval.target_entry_id is None:
                    raise MemoryManagerConflictError("Memory approval Undo state is incomplete")
                return self._approval_undo_result(approval)
            if approval.status != MEMORY_MANAGER_APPROVAL_STATUS_APPROVED:
                raise MemoryManagerConflictError("Only approved memory changes can be undone")
            if approval.target_entry_id is None or approval.applied_version is None:
                raise MemoryManagerConflictError("Approved memory change has no application Version")

            run = await self._memory_manager.get_run_for_update(
                user_id=user_id,
                run_id=approval.run_id,
            )
            if run is None:
                raise MemoryManagerNotFoundError("Memory manager run not found")
            run_approvals = await self._memory_manager.list_approvals_for_update(
                user_id=user_id,
                run_id=approval.run_id,
            )
            if any(item.status == MEMORY_MANAGER_APPROVAL_STATUS_PENDING for item in run_approvals):
                raise MemoryManagerConflictError("Resolve pending memory approvals before undoing this change")

            latest = await self._memory_manager.get_latest_approved_approval_for_entry(
                user_id=user_id,
                target_entry_id=approval.target_entry_id,
                for_update=True,
            )
            if latest is None or latest.id != approval.id:
                raise MemoryManagerConflictError("A newer approved change exists for this memory file")

            change_metadata = {
                "source_type": "memory_manager_approval_undo",
                "source_id": approval.id,
                "run_id": approval.run_id,
                "applied_version": approval.applied_version,
            }
            if approval.operation == MEMORY_PATCH_OPERATION_CREATE:
                entry = await self._memory_entries.undo_approved_create(
                    user_id=user_id,
                    entry_id=approval.target_entry_id,
                    expected_version=approval.applied_version,
                    change_metadata=change_metadata,
                )
                deleted = True
            elif approval.operation == MEMORY_PATCH_OPERATION_UPDATE:
                if approval.old_content is None:
                    raise MemoryManagerConflictError("Approved memory update has no prior content")
                # Identity Undo locks the Anima's current revision, like approval.
                entry = await self._memory_entries.undo_approved_update(
                    user_id=user_id,
                    entry_id=approval.target_entry_id,
                    expected_version=approval.applied_version,
                    old_content=approval.old_content,
                    old_description=approval.old_description,
                    change_metadata=change_metadata,
                    use_current_aggregate_revision=True,
                )
                deleted = False
            else:
                raise MemoryManagerConflictError("This memory approval operation cannot be undone")

            stored = await self._memory_manager.update_approval(
                replace(
                    approval,
                    undone_at=datetime.utcnow(),
                    undo_version=entry.version,
                    can_undo=False,
                )
            )
            await self._commit_if_enabled()
        except (MemoryEntryConflictError, MemoryEntryNotFoundError) as exc:
            await self._rollback_if_enabled()
            raise MemoryManagerConflictError(exc.detail) from exc
        except (MemoryEntryProtectedError, MemoryEntryValidationError) as exc:
            await self._rollback_if_enabled()
            raise MemoryManagerValidationError(exc.detail) from exc
        except Exception:
            await self._rollback_if_enabled()
            raise
        self._log.info(
            "MemoryManagerService.undo_approval.completed",
            user_id=user_id,
            approval_id=approval_id,
            undo_version=stored.undo_version,
        )
        return MemoryManagerApprovalUndoResult(
            approval=replace(stored, can_undo=False),
            target_entry_id=stored.target_entry_id or entry.id,
            undo_version=stored.undo_version or entry.version,
            deleted=deleted,
        )

    async def _can_undo_approval(
        self,
        *,
        user_id: str,
        approval: MemoryManagerApproval,
        run_has_pending_approval: bool,
    ) -> bool:
        """Project advisory Undo eligibility without replacing locked checks."""

        if (
            run_has_pending_approval
            or approval.status != MEMORY_MANAGER_APPROVAL_STATUS_APPROVED
            or approval.undone_at is not None
            or approval.undo_version is not None
            or approval.target_entry_id is None
            or approval.applied_version is None
            or approval.operation not in {MEMORY_PATCH_OPERATION_CREATE, MEMORY_PATCH_OPERATION_UPDATE}
        ):
            return False
        latest = await self._memory_manager.get_latest_approved_approval_for_entry(
            user_id=user_id,
            target_entry_id=approval.target_entry_id,
        )
        if latest is None or latest.id != approval.id:
            return False
        try:
            entry = await self._memory_entries.get_entry(
                user_id=user_id,
                entry_id=approval.target_entry_id,
            )
        except (MemoryEntryNotFoundError, MemoryEntryValidationError):
            return False
        return (
            entry.type == MEMORY_ENTRY_TYPE_FILE
            and not is_protected_memory_entry(entry)
            and entry.version == approval.applied_version
        )

    @staticmethod
    def _approval_undo_result(
        approval: MemoryManagerApproval,
    ) -> MemoryManagerApprovalUndoResult:
        """Return the durable result of an already-committed Undo."""

        if approval.target_entry_id is None or approval.undo_version is None:
            raise MemoryManagerConflictError("Memory approval Undo state is incomplete")
        return MemoryManagerApprovalUndoResult(
            approval=replace(approval, can_undo=False),
            target_entry_id=approval.target_entry_id,
            undo_version=approval.undo_version,
            deleted=approval.operation == MEMORY_PATCH_OPERATION_CREATE,
        )

    async def _auto_approve_message_diffs(
        self,
        *,
        user_id: str,
        run_id: str,
        source_message_id: str,
    ) -> None:
        """Approve one submitted message's durable patch chain within a safety bound."""

        approved_count = 0
        while approved_count < _MAX_AUTO_APPROVALS_PER_MESSAGE:
            snapshot = await self.get_run_snapshot(user_id=user_id, run_id=run_id)
            if snapshot.run.status != MEMORY_MANAGER_RUN_STATUS_WAITING_APPROVAL:
                return
            approval = self._next_pending_approval_for_message(
                approvals=snapshot.approvals,
                source_message_id=source_message_id,
            )
            if approval is None:
                return
            try:
                await self.decide_approval(
                    user_id=user_id,
                    approval_id=approval.id,
                    decision="approve",
                )
            except MemoryManagerError as exc:
                self._log.warning(
                    "MemoryManagerService.auto_approve.stopped",
                    user_id=user_id,
                    run_id=run_id,
                    approval_id=approval.id,
                    approved_count=approved_count,
                    error=exc.detail,
                )
                return
            approved_count += 1

        snapshot = await self.get_run_snapshot(user_id=user_id, run_id=run_id)
        if (
            self._next_pending_approval_for_message(
                approvals=snapshot.approvals,
                source_message_id=source_message_id,
            )
            is not None
        ):
            self._log.warning(
                "MemoryManagerService.auto_approve.limit_reached",
                user_id=user_id,
                run_id=run_id,
                source_message_id=source_message_id,
                approved_count=approved_count,
            )

    async def _persist_runtime_result(
        self,
        *,
        run: MemoryManagerRun,
        result: MemoryManagerRuntimeResult,
        source_message_id: str | None,
    ) -> MemoryManagerRun:
        approval_ids: list[str] = []
        existing_approvals = await self._memory_manager.list_approvals(user_id=run.user_id, run_id=run.id)
        existing_sdk_call_ids = self._sdk_call_ids(existing_approvals)
        for request in result.approvals or []:
            request_metadata = dict(request.operation_metadata or {})
            sdk_call_id = request_metadata.get("sdk_call_id")
            if isinstance(sdk_call_id, str) and sdk_call_id in existing_sdk_call_ids:
                continue
            approval = await self._memory_manager.create_approval(
                self._approval_from_runtime_request(
                    run=run,
                    request=request,
                    source_message_id=source_message_id,
                )
            )
            approval_ids.append(approval.id)
            if isinstance(sdk_call_id, str):
                existing_sdk_call_ids.add(sdk_call_id)

        assistant_message = (result.assistant_message or "").strip()
        if assistant_message:
            await self._memory_manager.create_message(
                MemoryManagerMessage(
                    id=new_memory_manager_message_id(),
                    run_id=run.id,
                    user_id=run.user_id,
                    role=MEMORY_MANAGER_MESSAGE_ROLE_ASSISTANT,
                    content=assistant_message,
                    metadata={
                        "runtime": self._runtime.name,
                        "approval_ids": approval_ids,
                        **dict(result.metadata or {}),
                    },
                )
            )

        approvals = await self._memory_manager.list_approvals(user_id=run.user_id, run_id=run.id)
        has_pending = any(item.status == MEMORY_MANAGER_APPROVAL_STATUS_PENDING for item in approvals)
        result_metadata = dict(result.metadata or {})
        result_model = result_metadata.get("model")
        outcome = self._validated_runtime_outcome(result=result, has_pending=has_pending)
        failed = outcome in {MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED, MEMORY_MANAGER_RUNTIME_OUTCOME_FAILED}
        next_status = (
            MEMORY_MANAGER_RUN_STATUS_FAILED
            if failed
            else MEMORY_MANAGER_RUN_STATUS_WAITING_APPROVAL
            if has_pending
            else MEMORY_MANAGER_RUN_STATUS_ACTIVE
        )
        stored_run = await self._memory_manager.update_run(
            replace(
                run,
                status=next_status,
                model_provider="openai" if self._runtime.name == "openai_agents" else run.model_provider,
                model_name=result_model if isinstance(result_model, str) else run.model_name,
                openai_previous_response_id=(
                    self._nonblank_string(result.openai_previous_response_id) or run.openai_previous_response_id
                ),
                serialized_agent_state=result.serialized_agent_state,
                summary=result.summary or run.summary,
                error=result.error or ("Memory manager execution was blocked" if failed else None),
                usage_metadata=self._merged_usage_metadata(run.usage_metadata, result.usage_metadata),
                metadata={
                    **dict(run.metadata or {}),
                    "runtime": self._runtime.name,
                    **result_metadata,
                },
                completed_at=datetime.utcnow() if failed else None,
            )
        )
        if outcome == MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED and not has_pending:
            stored_run = await self._finalize_episode_processing_run(stored_run)
        return stored_run

    def _approval_from_runtime_request(
        self,
        *,
        run: MemoryManagerRun,
        request: MemoryManagerRuntimeApprovalRequest,
        source_message_id: str | None,
    ) -> MemoryManagerApproval:
        operation_metadata = dict(request.operation_metadata or {})
        if source_message_id is not None:
            operation_metadata["source_message_id"] = source_message_id
        operation_metadata.setdefault("runtime", self._runtime.name)
        return MemoryManagerApproval(
            id=new_memory_manager_approval_id(),
            run_id=run.id,
            user_id=run.user_id,
            status=MEMORY_MANAGER_APPROVAL_STATUS_PENDING,
            operation=request.operation,
            target_path=request.target_path,
            target_entry_id=request.target_entry_id,
            expected_version=request.expected_version,
            summary=request.summary,
            old_content=request.old_content,
            new_content=request.new_content,
            old_description=request.old_description,
            new_description=request.new_description,
            unified_diff=request.unified_diff,
            operation_metadata=operation_metadata,
            decision_feedback=None,
        )

    async def _finalize_episode_processing_run(self, run: MemoryManagerRun) -> MemoryManagerRun:
        """Atomically close one fixed episode task after terminal runtime success."""

        if run.kind != MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING:
            return run
        if self._memory_episodes is None:
            raise MemoryManagerValidationError("Episode processing is not configured")
        try:
            task = MemoryManagerEpisodeTaskState.from_dict(run.task_state)
        except ValueError as exc:
            raise MemoryManagerConflictError(str(exc)) from exc
        if task.status == MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSED:
            return run

        approvals = await self._memory_manager.list_approvals(user_id=run.user_id, run_id=run.id)
        if any(item.status == MEMORY_MANAGER_APPROVAL_STATUS_PENDING for item in approvals):
            return run
        try:
            await self._memory_episodes.mark_items_processed(
                user_id=run.user_id,
                item_ids=[item.episode_item_id for item in task.items],
                processed_by_run_id=run.id,
            )
        except MemoryEpisodeConflictError as exc:
            raise MemoryManagerConflictError(exc.detail) from exc

        processed_task = MemoryManagerEpisodeTaskState(
            status=MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSED,
            items=task.items,
            has_more=task.has_more,
            started_at=task.started_at,
            processed_at=datetime.now(UTC),
        )
        return await self._memory_manager.update_run(
            replace(
                run,
                status=MEMORY_MANAGER_RUN_STATUS_ACTIVE,
                task_state=processed_task.to_dict(),
                completed_at=None,
            )
        )

    @staticmethod
    def _sdk_call_ids(approvals: list[MemoryManagerApproval]) -> set[str]:
        call_ids: set[str] = set()
        for approval in approvals:
            sdk_call_id = dict(approval.operation_metadata or {}).get("sdk_call_id")
            if isinstance(sdk_call_id, str):
                call_ids.add(sdk_call_id)
        return call_ids

    @staticmethod
    def _approval_source_message_id(approval: MemoryManagerApproval) -> str | None:
        source_message_id = dict(approval.operation_metadata or {}).get("source_message_id")
        return source_message_id if isinstance(source_message_id, str) and source_message_id else None

    @classmethod
    def _next_pending_approval_for_message(
        cls,
        *,
        approvals: list[MemoryManagerApproval],
        source_message_id: str,
    ) -> MemoryManagerApproval | None:
        return next(
            (
                approval
                for approval in approvals
                if approval.status == MEMORY_MANAGER_APPROVAL_STATUS_PENDING
                and cls._approval_source_message_id(approval) == source_message_id
            ),
            None,
        )

    async def _commit_approval_patch(
        self,
        *,
        user_id: str,
        approval: MemoryManagerApproval,
        run: MemoryManagerRun,
    ) -> MemoryEntry:
        try:
            clean_path, identity_anima_id = self._validate_approval_target_path(approval.target_path)
            change_metadata = self._approval_change_metadata(approval)
            if identity_anima_id is not None:
                return await self._commit_identity_approval(
                    user_id=user_id,
                    approval=approval,
                    run=run,
                    anima_id=identity_anima_id,
                    change_metadata=change_metadata,
                )
            if approval.operation == MEMORY_PATCH_OPERATION_CREATE:
                if approval.new_content is None:
                    raise MemoryEntryValidationError("Approved memory create is missing content")
                return await self._memory_entries.put_file_by_path(
                    user_id=user_id,
                    anima_id=None,
                    path=clean_path,
                    content=approval.new_content,
                    kind=_USER_MEMORY_KIND,
                    description=approval.new_description,
                    change_metadata=change_metadata,
                    expected_version=approval.expected_version,
                    create_parents=True,
                )

            if approval.operation == MEMORY_PATCH_OPERATION_UPDATE:
                if approval.new_content is None:
                    raise MemoryEntryValidationError("Approved memory update is missing content")
                current = await self._entry_for_update_approval(user_id=user_id, approval=approval)
                if current.path != clean_path:
                    raise MemoryEntryConflictError("Memory entry path changed after approval was created")
                return await self._memory_entries.patch_entry(
                    user_id=user_id,
                    entry_id=current.id,
                    expected_version=approval.expected_version,
                    content=approval.new_content,
                    content_set=True,
                    description=approval.new_description,
                    description_set=True,
                    change_metadata=change_metadata,
                )

            raise MemoryEntryValidationError("Memory manager approvals cannot delete memory files")
        except (MemoryEntryConflictError, MemoryEntryNotFoundError) as exc:
            raise MemoryManagerConflictError(exc.detail) from exc
        except MemoryEntryProtectedError as exc:
            raise MemoryManagerValidationError(exc.detail) from exc
        except MemoryEntryValidationError as exc:
            raise MemoryManagerValidationError(exc.detail) from exc

    async def _commit_identity_approval(
        self,
        *,
        user_id: str,
        approval: MemoryManagerApproval,
        run: MemoryManagerRun,
        anima_id: str,
        change_metadata: dict[str, Any],
    ) -> MemoryEntry:
        """Apply one reviewed identity update to the Anima it was proposed for.

        The approval is fenced by the identity's memory version, not the Anima's
        aggregate revision, so a rename between proposal and approval still
        applies while newer identity content conflicts.
        """

        if run.kind == MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING:
            raise MemoryEntryValidationError("Episode processing cannot change Anima identities")
        if approval.operation != MEMORY_PATCH_OPERATION_UPDATE or approval.new_content is None:
            raise MemoryEntryValidationError("Memory Manager can only update existing Anima identities")
        if approval.target_entry_id is None:
            raise MemoryEntryConflictError("Identity approval has no target entry")
        try:
            current = await self._memory_entries.get_entry(user_id=user_id, entry_id=approval.target_entry_id)
        except MemoryEntryNotFoundError as exc:
            raise MemoryEntryConflictError("This Anima no longer exists; reject the proposal") from exc
        if not is_anima_identity(current) or current.anima_id != anima_id:
            raise MemoryEntryConflictError("Identity approval target changed after it was proposed")
        return await self._memory_entries.patch_entry(
            user_id=user_id,
            entry_id=current.id,
            expected_version=approval.expected_version,
            content=approval.new_content,
            content_set=True,
            description=approval.new_description,
            description_set=True,
            change_metadata=change_metadata,
            use_current_aggregate_revision=True,
        )

    @staticmethod
    def _approval_change_metadata(approval: MemoryManagerApproval) -> dict[str, Any]:
        """Return safe provenance for the version produced by one approval."""

        metadata: dict[str, Any] = {
            "source_type": "memory_manager_approval",
            "source_id": approval.id,
            "run_id": approval.run_id,
        }
        operation_metadata = dict(approval.operation_metadata or {})
        for key in ("runtime", "source_message_id"):
            value = operation_metadata.get(key)
            if isinstance(value, str) and value:
                metadata[key] = value
        return metadata

    async def _entry_for_update_approval(self, *, user_id: str, approval: MemoryManagerApproval) -> MemoryEntry:
        if approval.target_entry_id is not None:
            return await self._memory_entries.get_entry(user_id=user_id, entry_id=approval.target_entry_id)
        return await self._memory_entries.get_entry_by_path(
            user_id=user_id,
            anima_id=None,
            path=approval.target_path,
            type=MEMORY_ENTRY_TYPE_FILE,
        )

    def _runtime_failure_result(self, exc: MemoryManagerRuntimeError) -> MemoryManagerRuntimeResult:
        detail = exc.detail
        self._log.warning(
            "MemoryManagerService.runtime.failed",
            runtime=self._runtime.name,
            error=detail,
            exc_info=True,
        )
        return MemoryManagerRuntimeResult(
            assistant_message=f"Memory manager runtime failed: {detail}",
            serialized_agent_state=None,
            metadata={
                "runtime": self._runtime.name,
                "exception_class": exc.__class__.__name__,
                "runtime_error_code": exc.code,
            },
            error=detail,
            outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_FAILED,
        )

    @staticmethod
    def _validated_runtime_outcome(
        *,
        result: MemoryManagerRuntimeResult,
        has_pending: bool,
    ) -> str:
        outcome = result.outcome
        if outcome not in MEMORY_MANAGER_RUNTIME_OUTCOMES:
            return MEMORY_MANAGER_RUNTIME_OUTCOME_FAILED
        if outcome in {
            MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED,
            MEMORY_MANAGER_RUNTIME_OUTCOME_FAILED,
        }:
            return outcome
        if has_pending:
            if not isinstance(result.serialized_agent_state, str) or not result.serialized_agent_state.strip():
                return MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED
            return MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL
        if outcome == MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL:
            return MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED
        if result.error and outcome == MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED:
            return MEMORY_MANAGER_RUNTIME_OUTCOME_FAILED
        return outcome

    @staticmethod
    def _nonblank_string(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized or None

    @staticmethod
    def _normalize_message_content(content: str) -> str:
        if not isinstance(content, str):
            raise MemoryManagerValidationError("Message content must be a string")
        normalized = content.strip()
        if not normalized:
            raise MemoryManagerValidationError("Message content is required")
        if len(normalized) > _MEMORY_MANAGER_MESSAGE_MAX_CHARS:
            raise MemoryManagerValidationError("Message content is too long")
        return normalized

    @staticmethod
    def _normalize_rejection_feedback(feedback: str | None) -> str | None:
        if feedback is None:
            return None
        if not isinstance(feedback, str):
            raise MemoryManagerValidationError("Feedback must be a string")
        normalized = feedback.strip()
        if not normalized:
            return None
        if len(normalized) > _REJECTION_FEEDBACK_MAX_CHARS:
            raise MemoryManagerValidationError("Feedback is too long")
        return normalized

    @staticmethod
    def _validate_approval_target_path(path: str) -> tuple[str, str | None]:
        """Return the clean target path and, for identity targets, the Anima ID."""

        anima_id = parse_anima_identity_manager_path(path)
        if anima_id is not None:
            return anima_identity_manager_path(anima_id), anima_id
        # parse_anima_identity_manager_path already rejects other reserved paths.
        clean_path, _normalized_path = normalize_memory_file_path(path)
        if is_protected_memory_path(clean_path):
            raise MemoryEntryProtectedError("Generated episode logs are read-only")
        return clean_path, None

    @staticmethod
    def _merged_usage_metadata(
        current: dict[str, object] | None,
        delta: dict[str, object] | None,
    ) -> dict[str, object]:
        merged: dict[str, object] = dict(current or {})
        incoming = dict(delta or {})
        for key in _USAGE_COUNTER_KEYS:
            before = merged.get(key, 0)
            after = incoming.pop(key, 0)
            if isinstance(before, int | float) and isinstance(after, int | float):
                merged[key] = int(before) + int(after)
            elif after:
                merged[key] = after
        merged.update(incoming)
        return merged

    @staticmethod
    def _status_for_decision(decision: str) -> str:
        normalized = decision.strip().lower() if isinstance(decision, str) else ""
        if normalized == "approve":
            return MEMORY_MANAGER_APPROVAL_STATUS_APPROVED
        if normalized == "reject":
            return MEMORY_MANAGER_APPROVAL_STATUS_REJECTED
        if normalized in MEMORY_MANAGER_APPROVAL_STATUSES - {MEMORY_MANAGER_APPROVAL_STATUS_PENDING}:
            return normalized
        raise MemoryManagerValidationError("Decision must be approve or reject")

    async def _commit_if_enabled(self) -> None:
        if self._commit_on_write:
            await self._uow.commit()

    async def _rollback_if_enabled(self) -> None:
        if self._commit_on_write:
            await self._uow.rollback()

    async def _raise_not_found(self, detail: str) -> NoReturn:
        await self._rollback_if_enabled()
        raise MemoryManagerNotFoundError(detail)


__all__ = [
    "MemoryManagerConflictError",
    "MemoryManagerError",
    "MemoryManagerNotFoundError",
    "MemoryManagerService",
    "MemoryManagerValidationError",
]
