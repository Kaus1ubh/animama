"""Model-facing addressing for Anima identities in Memory Manager.

Memory Manager sees each owned Anima's identity at ``animas/<anima_id>/IDENTITY.md``.
The stable Anima ID keeps a proposal bound to one Anima across renames and
duplicate names; the identity itself stays stored in that Anima's own scope.
Normal Anima chat never uses these paths.
"""

from __future__ import annotations

from animama.domain.anima_definition import ANIMA_IDENTITY_PATH
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE, MemoryEntry

from .memory_entry_service import (
    MEMORY_ENTRY_ANIMAS_ROOT_PATH,
    MemoryEntryNotFoundError,
    MemoryEntryService,
    MemoryEntryValidationError,
    is_reserved_user_memory_path,
    normalize_memory_file_path,
)


def anima_identity_manager_path(anima_id: str) -> str:
    """Return the Memory Manager path for one Anima's identity."""

    return f"{MEMORY_ENTRY_ANIMAS_ROOT_PATH}/{anima_id}/{ANIMA_IDENTITY_PATH}"


def parse_anima_identity_manager_path(path: str) -> str | None:
    """Return the Anima ID addressed by ``path``, or ``None`` for user memory.

    Any other path beneath the reserved ``animas`` root is invalid, because each
    Anima folder contains only its identity.
    """

    clean_path, _normalized_path = normalize_memory_file_path(path)
    if not is_reserved_user_memory_path(clean_path):
        return None
    segments = clean_path.split("/")
    if len(segments) == 3 and segments[2].casefold() == ANIMA_IDENTITY_PATH.casefold():
        return segments[1]
    raise MemoryEntryValidationError(
        f"Anima identities are addressed as {MEMORY_ENTRY_ANIMAS_ROOT_PATH}/<anima_id>/{ANIMA_IDENTITY_PATH}"
    )


async def get_anima_identity_or_none(
    memory_entries: MemoryEntryService,
    *,
    user_id: str,
    anima_id: str,
) -> MemoryEntry | None:
    """Read an owned Anima's live identity, or ``None`` when it or the Anima is gone."""

    try:
        return await memory_entries.get_entry_by_path(
            user_id=user_id,
            anima_id=anima_id,
            path=ANIMA_IDENTITY_PATH,
            type=MEMORY_ENTRY_TYPE_FILE,
        )
    except MemoryEntryNotFoundError:
        return None


__all__ = [
    "anima_identity_manager_path",
    "get_anima_identity_or_none",
    "parse_anima_identity_manager_path",
]
