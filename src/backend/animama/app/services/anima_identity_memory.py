"""Model-facing addressing for Anima-scoped memory files.

Memory Manager sees an owned Anima's files at ``animas/<anima_id>/IDENTITY.md``
and ``animas/<anima_id>/MEMORIES.md``. The stable Anima ID keeps a proposal bound
to one Anima across renames and duplicate names; the files themselves stay
stored in that Anima's own scope. Which of them a run may reach depends on its
kind (see ``manager_file_access_for_run``).

Normal Anima chat never uses these paths. A chat turn reaches only its own
Anima's ``MEMORIES.md``, through the reserved alias ``[self]/MEMORIES.md`` that the
chat tools resolve to the turn's Anima. Bracketed names are never valid stored
names, so the alias cannot collide with a user file.
"""

from __future__ import annotations

from dataclasses import dataclass

from animama.domain.anima_definition import ANIMA_IDENTITY_PATH, ANIMA_MEMORIES_PATH
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE, MemoryEntry
from animama.domain.memory_manager import (
    MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING,
    MEMORY_MANAGER_RUN_KIND_REFLECTION,
    MemoryManagerReflectionTaskState,
    MemoryManagerRun,
)

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


_ANIMA_MANAGER_FILES = {name.casefold(): name for name in (ANIMA_IDENTITY_PATH, ANIMA_MEMORIES_PATH)}


@dataclass(frozen=True, slots=True)
class AnimaManagerPath:
    """One Anima file as Memory Manager addresses it: ``animas/<anima_id>/<filename>``."""

    anima_id: str
    # The canonical ``IDENTITY.md`` or ``MEMORIES.md``.
    filename: str

    @property
    def path(self) -> str:
        return f"{MEMORY_ENTRY_ANIMAS_ROOT_PATH}/{self.anima_id}/{self.filename}"

    @property
    def is_identity(self) -> bool:
        return self.filename == ANIMA_IDENTITY_PATH


def anima_memories_manager_path(anima_id: str) -> str:
    """Return the Memory Manager path for one Anima's ``MEMORIES.md``."""

    return AnimaManagerPath(anima_id, ANIMA_MEMORIES_PATH).path


def parse_anima_manager_path(path: str) -> AnimaManagerPath | None:
    """Return the Anima file addressed by ``path``, or ``None`` for user memory.

    Any other path beneath the reserved ``animas`` root is invalid, because each
    Anima folder contains only its ``IDENTITY.md`` and ``MEMORIES.md``.
    """

    clean_path, _normalized_path = normalize_memory_file_path(path)
    if not is_reserved_user_memory_path(clean_path):
        return None
    segments = clean_path.split("/")
    filename = _ANIMA_MANAGER_FILES.get(segments[2].casefold()) if len(segments) == 3 else None
    if filename is not None:
        return AnimaManagerPath(anima_id=segments[1], filename=filename)
    root = f"{MEMORY_ENTRY_ANIMAS_ROOT_PATH}/<anima_id>"
    raise MemoryEntryValidationError(
        f"Anima files are addressed as {root}/{ANIMA_IDENTITY_PATH} or {root}/{ANIMA_MEMORIES_PATH}"
    )


@dataclass(frozen=True, slots=True)
class ManagerFileAccess:
    """Which files one Memory Manager run may read and propose changes to.

    User memory files are always readable; ``user_files_writable`` decides
    whether they can be changed. Anima files are reached through
    ``animas/<anima_id>/...`` paths: identities and ``MEMORIES.md`` separately,
    and only for ``anima_id`` when it is set.
    """

    user_files_writable: bool = True
    anima_identities: bool = False
    anima_memories: bool = False
    anima_id: str | None = None

    @property
    def anima_files(self) -> bool:
        """Return whether any Anima file is reachable."""

        return self.anima_identities or self.anima_memories

    def allows(self, target: AnimaManagerPath) -> bool:
        """Return whether this run may read and propose updates to ``target``."""

        if self.anima_id is not None and target.anima_id != self.anima_id:
            return False
        return self.anima_identities if target.is_identity else self.anima_memories

    def denied_message(self, path: str) -> str:
        """Explain why ``path`` is refused, in words the model can act on.

        An Anima file outside the scope is refused for reading and changing; a
        user file only for changing, because every run may read user memory.
        """

        if self.anima_id is None:
            return f"{path} is not available in this Memory Manager conversation"
        own_memories = anima_memories_manager_path(self.anima_id)
        if is_reserved_user_memory_path(path):
            return f"Of the Anima files, this Reflection can read and change only {own_memories}, not {path}"
        return f"This Reflection can change only {own_memories}; {path} is read-only here"


# General conversations may update any owned Anima's identity or MEMORIES.md when the owner asks.
GENERAL_MANAGER_FILE_ACCESS = ManagerFileAccess(anima_identities=True, anima_memories=True)
# Episode processing curates shared user memory only; Anima files stay out of reach.
EPISODE_PROCESSING_MANAGER_FILE_ACCESS = ManagerFileAccess()
# A run that cannot establish its scope reaches nothing but readable user memory.
_NO_WRITE_MANAGER_FILE_ACCESS = ManagerFileAccess(user_files_writable=False)


def reflection_manager_file_access(anima_id: str) -> ManagerFileAccess:
    """A Reflection reads shared memory and may change only its own Anima's ``MEMORIES.md``."""

    return ManagerFileAccess(user_files_writable=False, anima_memories=True, anima_id=anima_id)


def manager_file_access_for_run(run: MemoryManagerRun) -> ManagerFileAccess:
    """Return the file scope of one Memory Manager run, failing closed on invalid task state."""

    if run.kind == MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING:
        return EPISODE_PROCESSING_MANAGER_FILE_ACCESS
    if run.kind == MEMORY_MANAGER_RUN_KIND_REFLECTION:
        try:
            task = MemoryManagerReflectionTaskState.from_dict(run.task_state)
        except ValueError:
            return _NO_WRITE_MANAGER_FILE_ACCESS
        return reflection_manager_file_access(task.anima_id)
    return GENERAL_MANAGER_FILE_ACCESS


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


async def get_anima_file_or_none(
    memory_entries: MemoryEntryService,
    *,
    user_id: str,
    target: AnimaManagerPath,
) -> MemoryEntry | None:
    """Read an owned Anima's live identity or ``MEMORIES.md``, or ``None`` when it or the Anima is gone."""

    if target.is_identity:
        return await get_anima_identity_or_none(memory_entries, user_id=user_id, anima_id=target.anima_id)
    return await get_anima_memories_or_none(memory_entries, user_id=user_id, anima_id=target.anima_id)


__all__ = [
    "ANIMA_SELF_MEMORIES_ALIAS",
    "ANIMA_SELF_MEMORIES_MISSING_MESSAGE",
    "EPISODE_PROCESSING_MANAGER_FILE_ACCESS",
    "GENERAL_MANAGER_FILE_ACCESS",
    "AnimaManagerPath",
    "ManagerFileAccess",
    "anima_memories_manager_path",
    "get_anima_file_or_none",
    "get_anima_identity_or_none",
    "get_anima_memories_or_none",
    "is_anima_self_memories_alias",
    "manager_file_access_for_run",
    "parse_anima_manager_path",
    "reflection_manager_file_access",
]
