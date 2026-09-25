"""Agents SDK-backed V4A planner for the virtual user-memory workspace."""

from __future__ import annotations

from agents import apply_diff

from animama.app.ports.memory_patch_port import MemoryPatchCandidate, MemoryPatchPlanError
from animama.app.services.anima_identity_memory import (
    anima_identity_manager_path,
    get_anima_identity_or_none,
    parse_anima_identity_manager_path,
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
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE, MemoryEntry
from animama.domain.memory_manager import MEMORY_PATCH_OPERATION_CREATE, MEMORY_PATCH_OPERATION_UPDATE


class AgentsSDKV4AMemoryPatchPlanner:
    """Resolve create/update operations with the Agents SDK V4A parser.

    ``allow_anima_identities`` lets general Memory Manager runs update an owned
    Anima's identity at ``animas/<anima_id>/IDENTITY.md``; identities can never be
    created, deleted or blanked here. Normal chat leaves it disabled.
    """

    def __init__(self, *, memory_entries: MemoryEntryService, allow_anima_identities: bool = False) -> None:
        self._memory_entries = memory_entries
        self._allow_anima_identities = allow_anima_identities

    async def plan_v4a_operation(
        self,
        *,
        user_id: str,
        operation_type: str,
        path: str,
        diff: str | None,
    ) -> MemoryPatchCandidate:
        if operation_type == "delete_file":
            raise MemoryPatchPlanError("Apply Patch cannot delete memory files")
        if operation_type not in {"create_file", "update_file"}:
            raise MemoryPatchPlanError(f"Unsupported apply_patch operation: {operation_type}")
        if not isinstance(diff, str) or not diff.strip():
            raise MemoryPatchPlanError("Patch operation is missing a diff")

        clean_path, current, is_identity = await resolve_patch_target(
            self._memory_entries,
            user_id=user_id,
            path=path,
            allow_anima_identities=self._allow_anima_identities,
        )
        if is_identity and operation_type == "create_file":
            raise MemoryPatchPlanError("Anima identities already exist; use update_file to change one")
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
            if is_identity and not parsed.content.strip():
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
    allow_anima_identities: bool,
) -> tuple[str, MemoryEntry | None, bool]:
    """Resolve a model path to its clean path, current entry and identity flag.

    An identity target must already exist; user-memory targets may be new.
    """

    if allow_anima_identities:
        try:
            anima_id = parse_anima_identity_manager_path(path)
        except MemoryEntryValidationError as exc:
            raise MemoryPatchPlanError(exc.detail) from exc
        if anima_id is not None:
            identity = await get_anima_identity_or_none(memory_entries, user_id=user_id, anima_id=anima_id)
            if identity is None:
                raise MemoryPatchPlanError("Anima identity not found")
            return anima_identity_manager_path(anima_id), identity, True
    clean_path = _validate_editable_file_path(path)
    current = await _get_entry_by_path_or_none(memory_entries, user_id=user_id, path=clean_path)
    return clean_path, current, False


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
        raise MemoryPatchPlanError("The animas path is reserved for Anima identities")
    if is_protected_memory_path(clean_path):
        raise MemoryPatchPlanError("Generated episode logs are read-only")
    return clean_path


__all__ = ["AgentsSDKV4AMemoryPatchPlanner", "resolve_patch_target"]
