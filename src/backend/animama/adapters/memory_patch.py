"""Agents SDK-backed V4A planner for the virtual user-memory workspace."""

from __future__ import annotations

from agents import apply_diff

from animama.app.ports.memory_patch_port import MemoryPatchCandidate, MemoryPatchPlanError
from animama.app.services.memory_entry_service import (
    MemoryEntryNotFoundError,
    MemoryEntryService,
    MemoryEntryValidationError,
    is_protected_memory_entry,
    is_protected_memory_path,
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
    """Resolve create/update operations with the Agents SDK V4A parser."""

    def __init__(self, *, memory_entries: MemoryEntryService) -> None:
        self._memory_entries = memory_entries

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

        clean_path = _validate_editable_file_path(path)
        current = await _get_entry_by_path_or_none(
            self._memory_entries,
            user_id=user_id,
            path=clean_path,
        )
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
    if normalized_path == "animas" or normalized_path.startswith("animas/"):
        raise MemoryPatchPlanError("Anima-scoped identity files are not editable here")
    if is_protected_memory_path(clean_path):
        raise MemoryPatchPlanError("Generated episode logs are read-only")
    return clean_path


__all__ = ["AgentsSDKV4AMemoryPatchPlanner"]
