"""Virtual user-memory workspace used by the memory-manager runtimes."""

from __future__ import annotations

from typing import Any

from animama.adapters.memory_patch import AgentsSDKV4AMemoryPatchPlanner
from animama.app.ports.memory_manager_runtime import MemoryManagerRuntimeApprovalRequest
from animama.app.ports.memory_patch_port import MemoryPatchCandidate, MemoryPatchPlanError, MemoryPatchPlanner
from animama.app.services.memory_entry_diff import build_memory_unified_diff
from animama.app.services.memory_entry_service import (
    MemoryEntryNotFoundError,
    MemoryEntryService,
    MemoryEntryValidationError,
    is_protected_memory_entry,
    is_protected_memory_path,
    normalize_memory_entry_description,
    normalize_memory_file_path,
)
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE, MemoryEntry
from animama.domain.memory_manager import (
    MEMORY_PATCH_OPERATION_CREATE,
    MEMORY_PATCH_OPERATION_UPDATE,
)


class MemoryManagerPatchRejected(Exception):
    """Raised when an agent-proposed patch cannot become an approval."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class MemoryManagerVirtualWorkspace:
    """Expose user memory as a constrained virtual markdown workspace."""

    def __init__(
        self,
        *,
        user_id: str,
        memory_entries: MemoryEntryService,
        patch_planner: MemoryPatchPlanner | None = None,
    ) -> None:
        self._user_id = user_id
        self._memory_entries = memory_entries
        self._patch_planner = patch_planner or AgentsSDKV4AMemoryPatchPlanner(memory_entries=memory_entries)

    async def plan_v4a_operation(
        self,
        *,
        operation_type: str,
        path: str,
        diff: str | None,
        metadata: dict[str, Any] | None = None,
    ) -> MemoryManagerRuntimeApprovalRequest:
        """Convert one SDK apply-patch operation into an Animama approval preview."""

        try:
            contents = await self._patch_planner.plan_v4a_operation(
                user_id=self._user_id,
                operation_type=operation_type,
                path=path,
                diff=diff,
            )
        except MemoryPatchPlanError as exc:
            raise MemoryManagerPatchRejected(str(exc)) from exc

        return _approval_request_from_contents(contents, metadata=metadata)

    async def plan_full_content(
        self,
        *,
        path: str,
        new_content: str,
        new_description: str | None,
        summary: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> MemoryManagerRuntimeApprovalRequest:
        """Create an approval preview from already-resolved full file content."""

        clean_path, _normalized_path = _validate_editable_file_path(path)
        if not isinstance(new_content, str):
            raise MemoryManagerPatchRejected("Memory file content must be a string")
        try:
            normalized_description = normalize_memory_entry_description(new_description)
        except MemoryEntryValidationError as exc:
            raise MemoryManagerPatchRejected(exc.detail) from exc
        current = await _get_entry_by_path_or_none(
            self._memory_entries,
            user_id=self._user_id,
            path=clean_path,
        )
        if current is not None and is_protected_memory_entry(current):
            raise MemoryManagerPatchRejected("Generated episode logs are read-only")
        if (
            current is not None
            and new_content == (current.content or "")
            and normalized_description == current.description
        ):
            raise MemoryManagerPatchRejected("Patch does not change memory content or description")

        operation = MEMORY_PATCH_OPERATION_UPDATE if current is not None else MEMORY_PATCH_OPERATION_CREATE
        resolved = MemoryPatchCandidate(
            operation=operation,
            path=clean_path,
            old_content=current.content if current is not None else None,
            new_content=new_content,
            old_description=current.description if current is not None else None,
            new_description=normalized_description,
            target_entry_id=current.id if current is not None else None,
            expected_version=current.version if current is not None else 0,
            summary=summary
            or (
                f"Create `{clean_path}` from this memory-manager request."
                if operation == MEMORY_PATCH_OPERATION_CREATE
                else f"Update `{clean_path}` from this memory-manager request."
            ),
        )
        return _approval_request_from_contents(resolved, metadata=metadata)


async def _get_entry_by_path_or_none(
    memory_entries: MemoryEntryService,
    *,
    user_id: str,
    path: str,
) -> MemoryEntry | None:
    try:
        return await memory_entries.get_entry_by_path(
            user_id=user_id,
            anima_id=None,
            path=path,
            type=MEMORY_ENTRY_TYPE_FILE,
        )
    except MemoryEntryNotFoundError:
        return None


def _approval_request_from_contents(
    contents: MemoryPatchCandidate,
    *,
    metadata: dict[str, Any] | None,
) -> MemoryManagerRuntimeApprovalRequest:
    return MemoryManagerRuntimeApprovalRequest(
        operation=contents.operation,
        target_path=contents.path,
        target_entry_id=contents.target_entry_id,
        expected_version=contents.expected_version,
        summary=contents.summary,
        old_content=contents.old_content,
        new_content=contents.new_content,
        old_description=contents.old_description,
        new_description=contents.new_description,
        unified_diff=build_memory_unified_diff(
            old_path=contents.path,
            new_path=contents.path,
            old_content=contents.old_content,
            new_content=contents.new_content,
        ),
        operation_metadata=dict(metadata or {}),
    )


def _validate_readable_file_path(path: str) -> tuple[str, str]:
    clean_path, normalized_path = _normalize_manager_file_path(path)
    if normalized_path == "animas" or normalized_path.startswith("animas/"):
        raise MemoryManagerPatchRejected("Anima-scoped identity files are not readable here")
    return clean_path, normalized_path


def _validate_editable_file_path(path: str) -> tuple[str, str]:
    clean_path, normalized_path = _validate_readable_file_path(path)
    if is_protected_memory_path(clean_path):
        raise MemoryManagerPatchRejected("Generated episode logs are read-only")
    return clean_path, normalized_path


def _normalize_manager_file_path(path: str) -> tuple[str, str]:
    try:
        return normalize_memory_file_path(path)
    except MemoryEntryValidationError as exc:
        raise MemoryManagerPatchRejected(exc.detail) from exc


__all__ = [
    "MemoryManagerPatchRejected",
    "MemoryManagerVirtualWorkspace",
]
