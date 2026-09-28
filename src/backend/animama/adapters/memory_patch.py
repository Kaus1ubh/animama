"""Agents SDK-backed V4A planner for the virtual user-memory workspace."""

from __future__ import annotations

from dataclasses import dataclass

from agents import apply_diff

from animama.app.ports.memory_patch_port import MemoryPatchCandidate, MemoryPatchPlanError
from animama.app.services.anima_identity_memory import (
    ANIMA_SELF_MEMORIES_ALIAS,
    ANIMA_SELF_MEMORIES_MISSING_MESSAGE,
    AnimaManagerPath,
    ManagerFileAccess,
    get_anima_file_or_none,
    get_anima_memories_or_none,
    is_anima_self_memories_alias,
    parse_anima_manager_path,
)
from animama.app.services.memory_entry_service import (
    MemoryEntryNotFoundError,
    MemoryEntryService,
    MemoryEntryValidationError,
    is_protected_memory_entry,
    is_protected_memory_path,
    is_reserved_user_memory_path,
    normalize_memory_file_path,
)
from animama.app.services.memory_patch_document import (
    MemoryPatchDocumentError,
    parse_memory_patch_document,
    render_memory_patch_document,
)
from animama.domain.anima_definition import ANIMA_MEMORIES_PATH
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE, MemoryEntry
from animama.domain.memory_manager import MEMORY_PATCH_OPERATION_CREATE, MEMORY_PATCH_OPERATION_UPDATE


@dataclass(frozen=True, slots=True)
class MemoryPatchTarget:
    """One resolved patch path: its model-facing spelling, current entry and Anima file, if any.

    ``current`` is ``None`` only for a new user memory file. ``anima_file`` is
    set for Anima files, including the chat ``[self]/MEMORIES.md`` alias.
    """

    path: str
    current: MemoryEntry | None
    anima_file: AnimaManagerPath | None = None

    @property
    def is_identity(self) -> bool:
        return self.anima_file is not None and self.anima_file.is_identity


class AgentsSDKV4AMemoryPatchPlanner:
    """Resolve create/update operations with the Agents SDK V4A parser.

    ``manager_access`` gives Memory Manager runs their file scope: updates to an
    owned Anima's ``animas/<anima_id>/IDENTITY.md`` or ``MEMORIES.md`` when
    allowed, and whether user files may change. Anima files can never be created,
    deleted or (identities) blanked here. Normal chat leaves it unset and instead
    passes ``self_anima_id`` per operation, which lets ``[self]/MEMORIES.md``
    update that Anima's existing ``MEMORIES.md`` (never create or delete it).
    """

    def __init__(
        self,
        *,
        memory_entries: MemoryEntryService,
        manager_access: ManagerFileAccess | None = None,
    ) -> None:
        self._memory_entries = memory_entries
        self._manager_access = manager_access

    async def plan_v4a_operation(
        self,
        *,
        user_id: str,
        operation_type: str,
        path: str,
        diff: str | None,
        self_anima_id: str | None = None,
    ) -> MemoryPatchCandidate:
        if operation_type == "delete_file":
            raise MemoryPatchPlanError("Apply Patch cannot delete memory files")
        if operation_type not in {"create_file", "update_file"}:
            raise MemoryPatchPlanError(f"Unsupported apply_patch operation: {operation_type}")
        if not isinstance(diff, str) or not diff.strip():
            raise MemoryPatchPlanError("Patch operation is missing a diff")

        target = await resolve_patch_target(
            self._memory_entries,
            user_id=user_id,
            path=path,
            manager_access=self._manager_access,
            self_anima_id=self_anima_id,
        )
        clean_path, current = target.path, target.current
        if target.anima_file is not None and operation_type == "create_file":
            raise MemoryPatchPlanError(f"{clean_path} already exists; use update_file to change it")
        try:
            if operation_type == "create_file":
                if current is not None:
                    raise MemoryPatchPlanError("Memory file already exists")
                patched_document = apply_diff("", diff, mode="create")
                parsed = parse_memory_patch_document(patched_document)
                return MemoryPatchCandidate(
                    operation=MEMORY_PATCH_OPERATION_CREATE,
                    path=clean_path,
                    old_content=None,
                    new_content=parsed.content,
                    old_description=None,
                    new_description=parsed.description,
                    target_entry_id=None,
                    expected_version=0,
                    summary=f"Create `{clean_path}`.",
                )

            if current is None:
                raise MemoryPatchPlanError("Memory file does not exist")
            if is_protected_memory_entry(current):
                raise MemoryPatchPlanError("Generated episode logs are read-only")
            old_content = current.content or ""
            old_document = render_memory_patch_document(
                description=current.description,
                content=old_content,
            )
            patched_document = apply_diff(old_document, diff)
            parsed = parse_memory_patch_document(patched_document)
            if parsed.content == old_content and parsed.description == current.description:
                raise MemoryPatchPlanError("Patch does not change memory content or description")
            if target.is_identity and not parsed.content.strip():
                raise MemoryPatchPlanError("Anima identity cannot be blank")
            return MemoryPatchCandidate(
                operation=MEMORY_PATCH_OPERATION_UPDATE,
                path=clean_path,
                old_content=old_content,
                new_content=parsed.content,
                old_description=current.description,
                new_description=parsed.description,
                target_entry_id=current.id,
                expected_version=current.version,
                summary=f"Update `{clean_path}`.",
            )
        except MemoryPatchPlanError:
            raise
        except MemoryPatchDocumentError as exc:
            raise MemoryPatchPlanError(str(exc)) from exc
        except Exception as exc:
            raise MemoryPatchPlanError(f"Patch diff could not be applied: {exc}") from exc


async def resolve_patch_target(
    memory_entries: MemoryEntryService,
    *,
    user_id: str,
    path: str,
    manager_access: ManagerFileAccess | None = None,
    self_anima_id: str | None = None,
) -> MemoryPatchTarget:
    """Resolve a model path to the file a proposal would change.

    Anima-file and ``[self]/MEMORIES.md`` targets must already exist; user-memory
    targets may be new. The alias resolves only when ``self_anima_id`` is given;
    ``animas/<anima_id>/...`` paths only within ``manager_access``.
    """

    if self_anima_id is not None:
        try:
            is_self_memories = is_anima_self_memories_alias(path)
        except MemoryEntryValidationError as exc:
            raise MemoryPatchPlanError(exc.detail) from exc
        if is_self_memories:
            memories = await get_anima_memories_or_none(memory_entries, user_id=user_id, anima_id=self_anima_id)
            if memories is None:
                raise MemoryPatchPlanError(ANIMA_SELF_MEMORIES_MISSING_MESSAGE)
            return MemoryPatchTarget(
                path=ANIMA_SELF_MEMORIES_ALIAS,
                current=memories,
                anima_file=AnimaManagerPath(anima_id=self_anima_id, filename=ANIMA_MEMORIES_PATH),
            )
    if manager_access is not None and manager_access.anima_files:
        try:
            anima_file = parse_anima_manager_path(path)
        except MemoryEntryValidationError as exc:
            raise MemoryPatchPlanError(exc.detail) from exc
        if anima_file is not None:
            if not manager_access.allows(anima_file):
                raise MemoryPatchPlanError(manager_access.denied_message(anima_file.path))
            current = await get_anima_file_or_none(memory_entries, user_id=user_id, target=anima_file)
            if current is None:
                raise MemoryPatchPlanError(f"Anima {anima_file.filename} not found at {anima_file.path}")
            return MemoryPatchTarget(path=anima_file.path, current=current, anima_file=anima_file)
    clean_path = _validate_editable_file_path(path)
    if manager_access is not None and not manager_access.user_files_writable:
        raise MemoryPatchPlanError(manager_access.denied_message(clean_path))
    current = await _get_entry_by_path_or_none(memory_entries, user_id=user_id, path=clean_path)
    return MemoryPatchTarget(path=clean_path, current=current)


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


def _validate_editable_file_path(path: str) -> str:
    try:
        clean_path, normalized_path = normalize_memory_file_path(path)
    except MemoryEntryValidationError as exc:
        raise MemoryPatchPlanError(exc.detail) from exc
    if is_reserved_user_memory_path(clean_path):
        raise MemoryPatchPlanError("The animas path is reserved for Anima files")
    if is_protected_memory_path(clean_path):
        raise MemoryPatchPlanError("Generated episode logs are read-only")
    return clean_path


__all__ = ["AgentsSDKV4AMemoryPatchPlanner", "MemoryPatchTarget", "resolve_patch_target"]
