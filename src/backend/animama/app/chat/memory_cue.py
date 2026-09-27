"""Per-turn memory bookkeeping behind the chat memory cue.

A chat turn can remember in two ways: its `remember` note becomes an episode item,
and the Anima can edit its own `MEMORIES.md`. The final visible assistant message
of the turn stores the `MEMORIES.md` part in `message_data["memory"]`; episode items
point back to that message through `source_message_id`. Both parts combine into one
`memory_cue` object, sent as the `memory.updated` SSE event while streaming and
returned by the chat messages API after reload:

    {"episode": {"text": str} | None,
     "memories": {"entry_id": str, "version": int, "excerpt": str} | None}
"""

from __future__ import annotations

import difflib
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

ANIMA_MEMORIES_EXCERPT_MAX_CHARS = 600
MESSAGE_DATA_MEMORY_KEY = "memory"


@dataclass(slots=True)
class AnimaMemoriesTurn:
    """One chat turn's view of its Anima's `MEMORIES.md`, shared by the tools and the executor.

    `seen_version` is the version whose content the Anima last saw: the one in its
    instructions, a later read or its own write. Whole-file replacement is fenced on
    it, so a rewrite based on stale content never overwrites a newer owner edit.
    Successful writes keep the content before the turn's first write and after its
    last one; the turn's cue excerpt is derived from those two.
    """

    seen_version: int | None = None
    entry_id: str | None = None
    version: int | None = None
    content_before: str | None = None
    content_after: str | None = None

    def saw(self, version: int) -> None:
        """Record that the Anima has read this version's content."""

        self.seen_version = version

    def record_write(
        self,
        *,
        entry_id: str,
        previous_version: int,
        previous_content: str,
        version: int,
        content: str,
    ) -> None:
        """Record one successful write of the file."""

        # Only advance along the Anima's own chain of edits. An owner edit it has
        # not read stays unseen, so a later whole-file replacement still conflicts.
        if self.seen_version == previous_version:
            self.seen_version = version
        if self.content_before is None:
            self.content_before = previous_content
        self.entry_id = entry_id
        self.version = version
        self.content_after = content

    def cue(self) -> dict[str, Any] | None:
        """Return the `memories` cue part, or `None` when the turn left the content unchanged."""

        if self.entry_id is None or self.version is None or self.content_before is None or self.content_after is None:
            return None
        if self.content_after == self.content_before:
            return None
        return {
            "entry_id": self.entry_id,
            "version": self.version,
            "excerpt": anima_memories_excerpt(self.content_before, self.content_after),
        }


def anima_memories_excerpt(before: str, after: str) -> str:
    """Return up to 600 characters of the lines a turn added or changed.

    Lines are compared with `difflib`; inserted and replaced lines of the new
    content are kept in order, trimmed, with blank lines dropped. A change that
    only removes text yields an empty excerpt.
    """

    after_lines = after.splitlines()
    matcher = difflib.SequenceMatcher(a=before.splitlines(), b=after_lines, autojunk=False)
    added = [
        line.strip()
        for tag, _before_start, _before_end, after_start, after_end in matcher.get_opcodes()
        if tag in {"insert", "replace"}
        for line in after_lines[after_start:after_end]
        if line.strip()
    ]
    excerpt = "\n".join(added)
    if len(excerpt) > ANIMA_MEMORIES_EXCERPT_MAX_CHARS:
        excerpt = excerpt[: ANIMA_MEMORIES_EXCERPT_MAX_CHARS - 1].rstrip() + "…"
    return excerpt


def turn_memory_message_data(*, updates_enabled: bool, anima_memories: AnimaMemoriesTurn | None) -> dict[str, Any]:
    """Build the `message_data["memory"]` block stored on a turn's final assistant message.

    `updates_enabled` records whether memory updates were allowed for the turn
    (Reflection skips turns where they were not); `memories` is the cue part for
    this turn's `MEMORIES.md` changes, or `None`.
    """

    return {
        "updates_enabled": updates_enabled,
        "memories": anima_memories.cue() if anima_memories is not None else None,
    }


def stored_memories_cue(message_data: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Read a persisted `MEMORIES.md` cue part back from assistant `message_data`."""

    memory = message_data.get(MESSAGE_DATA_MEMORY_KEY) if isinstance(message_data, Mapping) else None
    memories = memory.get("memories") if isinstance(memory, Mapping) else None
    return _valid_memories_cue(memories)


def memory_cue_payload(*, episode_text: str | None, memories: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Combine the episode note and `MEMORIES.md` change into one cue, or `None` when neither exists."""

    episode = {"text": episode_text} if isinstance(episode_text, str) and episode_text.strip() else None
    memories_cue = _valid_memories_cue(memories)
    if episode is None and memories_cue is None:
        return None
    return {"episode": episode, "memories": memories_cue}


def _valid_memories_cue(value: object) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    entry_id = value.get("entry_id")
    version = value.get("version")
    excerpt = value.get("excerpt")
    if not isinstance(entry_id, str) or not entry_id:
        return None
    if isinstance(version, bool) or not isinstance(version, int) or not isinstance(excerpt, str):
        return None
    return {"entry_id": entry_id, "version": version, "excerpt": excerpt}


__all__ = [
    "ANIMA_MEMORIES_EXCERPT_MAX_CHARS",
    "AnimaMemoriesTurn",
    "MESSAGE_DATA_MEMORY_KEY",
    "anima_memories_excerpt",
    "memory_cue_payload",
    "stored_memories_cue",
    "turn_memory_message_data",
]
