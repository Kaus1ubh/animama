"""Virtual user-memory workspace used by the memory-manager runtimes."""

from __future__ import annotations

from typing import Any

from animama.adapters.memory_patch import AgentsSDKV4AMemoryPatchPlanner, MemoryPatchTarget, resolve_patch_target
from animama.app.ports.memory_manager_runtime import MemoryManagerRuntimeApprovalRequest
from animama.app.ports.memory_patch_port import MemoryPatchCandidate, MemoryPatchPlanError, MemoryPatchPlanner
from animama.app.services.anima_identity_memory import (
    EPISODE_PROCESSING_MANAGER_FILE_ACCESS,
    ManagerFileAccess,
    parse_anima_manager_path,
)
from animama.app.services.memory_entry_diff import build_memory_unified_diff
from animama.app.services.memory_entry_service import (
    MEMORY_ENTRY_ANIMAS_ROOT_PATH,
    MemoryEntryService,
    MemoryEntryValidationError,
    is_protected_memory_entry,
    normalize_memory_entry_description,
)
from animama.domain.anima_definition import (
    ANIMA_MEMORIES_MAX_BYTES,
    ANIMA_MEMORIES_PATH,
    ANIMA_MEMORIES_SIZE_TARGET,
    ANIMA_MEMORIES_TOO_LARGE,
    AnimaDefinitionError,
    normalize_anima_memories,
)
from animama.domain.memory_entry import MemoryEntry
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
        access: ManagerFileAccess = EPISODE_PROCESSING_MANAGER_FILE_ACCESS,
    ) -> None:
        """``access`` is the run's file scope (see ``manager_file_access_for_run``).

        The default reaches user memory only, like episode processing.
        """

        self._user_id = user_id
        self._memory_entries = memory_entries
        self._access = access
        self._patch_planner = patch_planner or AgentsSDKV4AMemoryPatchPlanner(
            memory_entries=memory_entries,
            manager_access=access,
        )

    async def get_file_or_none(self, *, path: str) -> MemoryEntry | None:
        """Return the current file a model path addresses, or ``None`` if it is new."""

        return (await self.resolve_target(path)).current

    async def resolve_target(self, path: str) -> MemoryPatchTarget:
        """Resolve a model path within the run's file scope, or refuse it with a reason the model can act on.

        Anima files must exist; a user memory path may name a new file.
        """

        try:
            return await resolve_patch_target(
                self._memory_entries,
                user_id=self._user_id,
                path=path,
                manager_access=self._access,
            )
        except MemoryPatchPlanError as exc:
            raise MemoryManagerPatchRejected(str(exc)) from exc

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

        _require_anima_memories_fit(contents)
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

        return self.plan_target_content(
            await self.resolve_target(path),
            new_content=new_content,
            new_description=new_description,
            summary=summary,
            metadata=metadata,
        )

    def plan_target_content(
        self,
        target: MemoryPatchTarget,
        *,
        new_content: str,
        new_description: str | None,
        summary: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> MemoryManagerRuntimeApprovalRequest:
        """Create an approval preview for ``target`` fenced by the version it was resolved at.

        A caller that computed ``new_content`` from ``target.current`` passes the
        same target, so the approval's ``expected_version`` is the version the
        edit was based on.
        """

        clean_path, current = target.path, target.current
        if not isinstance(new_content, str):
            raise MemoryManagerPatchRejected("Memory file content must be a string")
        if target.anima_file is not None and current is None:
            raise MemoryManagerPatchRejected(f"{clean_path} does not exist")
        if target.is_identity and not new_content.strip():
            raise MemoryManagerPatchRejected("Anima identity cannot be blank")
        try:
            normalized_description = normalize_memory_entry_description(new_description)
        except MemoryEntryValidationError as exc:
            raise MemoryManagerPatchRejected(exc.detail) from exc
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
        _require_anima_memories_fit(resolved)
        return _approval_request_from_contents(resolved, metadata=metadata)


def _require_anima_memories_fit(contents: MemoryPatchCandidate) -> None:
    """Refuse an oversized or invalid MEMORIES.md proposal so the model can fix it and retry."""

    in_animas_root = contents.path.startswith(f"{MEMORY_ENTRY_ANIMAS_ROOT_PATH}/")
    anima_file = parse_anima_manager_path(contents.path) if in_animas_root else None
    if anima_file is None or anima_file.filename != ANIMA_MEMORIES_PATH or contents.new_content is None:
        return
    try:
        normalize_anima_memories(contents.new_content)
    except AnimaDefinitionError as exc:
        if exc.code == ANIMA_MEMORIES_TOO_LARGE:
            raise MemoryManagerPatchRejected(
                f"{contents.path} would exceed its {ANIMA_MEMORIES_MAX_BYTES // 1024} KiB limit; condense older "
                f"moments and keep it {ANIMA_MEMORIES_SIZE_TARGET}"
            ) from exc
        raise MemoryManagerPatchRejected(
            f"{contents.path} content is invalid ({exc.code}); remove NUL and unencodable characters"
        ) from exc


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


__all__ = [
    "MemoryManagerPatchRejected",
    "MemoryManagerVirtualWorkspace",
]
