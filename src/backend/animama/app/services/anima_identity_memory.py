"""Model-facing addressing for Anima-scoped memory files.

Memory Manager sees each owned Anima's identity at ``animas/<anima_id>/IDENTITY.md``.
The stable Anima ID keeps a proposal bound to one Anima across renames and
duplicate names; the identity itself stays stored in that Anima's own scope.

Normal Anima chat never uses these paths. A chat turn reaches only its own
Anima's ``MEMORIES.md``, through the reserved alias ``[self]/MEMORIES.md`` that the
chat tools resolve to the turn's Anima. Bracketed names are never valid stored
names, so the alias cannot collide with a user file.
"""

from __future__ import annotations

from animama.domain.anima_definition import ANIMA_IDENTITY_PATH, ANIMA_MEMORIES_PATH
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE, MemoryEntry

from .memory_entry_service import (
    MEMORY_ENTRY_ANIMAS_ROOT_PATH,
    MemoryEntryNotFoundError,
    MemoryEntryService,
    MemoryEntryValidationError,
    is_reserved_user_memory_path,
    normalize_memory_file_path,
)

ANIMA_SELF_MEMORIES_ALIAS = f"[self]/{ANIMA_MEMORIES_PATH}"
# Model-facing explanation when the Anima's MEMORIES.md does not exist.
ANIMA_SELF_MEMORIES_MISSING_MESSAGE = (
    f"{ANIMA_SELF_MEMORIES_ALIAS} is missing; the owner can repair it from the Memories page"
)


def is_anima_self_memories_alias(path: object) -> bool:
    """Return whether a chat tool path names the turn's own ``MEMORIES.md``.

    Any other bracketed path, such as ``[self]/IDENTITY.md`` or
    ``[other]/MEMORIES.md``, is rejected here with an explanation, so identities
    and other Animas' files stay unreachable. Unbracketed paths return ``False``
    and follow the ordinary user-memory rules.
    """

    if not isinstance(path, str) or not path.strip().startswith("["):
        return False
    if path.strip().casefold() == ANIMA_SELF_MEMORIES_ALIAS.casefold():
        return True
    raise MemoryEntryValidationError(
        f"Only your own {ANIMA_SELF_MEMORIES_ALIAS} can be addressed with brackets; "
        "identities and other Animas' files are not accessible"
    )


async def get_anima_memories_or_none(
    memory_entries: MemoryEntryService,
    *,
    user_id: str,
    anima_id: str,
) -> MemoryEntry | None:
    """Read an owned Anima's live ``MEMORIES.md``, or ``None`` when it or the Anima is gone."""

    try:
        return await memory_entries.get_entry_by_path(
            user_id=user_id,
            anima_id=anima_id,
            path=ANIMA_MEMORIES_PATH,
            type=MEMORY_ENTRY_TYPE_FILE,
        )
    except MemoryEntryNotFoundError:
        return None


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
    "ANIMA_SELF_MEMORIES_ALIAS",
    "ANIMA_SELF_MEMORIES_MISSING_MESSAGE",
    "anima_identity_manager_path",
    "get_anima_identity_or_none",
    "get_anima_memories_or_none",
    "is_anima_self_memories_alias",
    "parse_anima_identity_manager_path",
]
