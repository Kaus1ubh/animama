"""Benchmark-only ways a chat turn saves episodic memory.

Chat saves what happened in a turn two ways: the structured reply's
``remember`` field, logged to the shared episode log, and small edits of the
Anima's own ``MEMORIES.md`` through the memory write tools. The model
benchmark compares them by turning one off at a time (its spec R6, issue
#470). Production never chooses an arm: ``DirectChatTurnExecutor`` defaults to
``DEFAULT_EPISODIC_MEMORY_ARM``, today's behavior, and no request option can
reach the arm.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["DEFAULT_EPISODIC_MEMORY_ARM", "EpisodicMemoryArm"]


@dataclass(frozen=True, slots=True)
class EpisodicMemoryArm:
    """Which episodic-memory channels a turn offers; the defaults are chat's own."""

    remember: bool = True
    """Whether the reply schema, its prompt guidance and the memory guidance include ``remember``."""
    anima_memories_writes: bool = True
    """Whether the turn may edit ``[self]/MEMORIES.md``; reading it stays available either way."""
    anima_memories_write_guidance: str | None = None
    """Text that replaces the ``MEMORIES.md`` write guidance where chat shows it; ``None`` keeps chat's own."""

    def __post_init__(self) -> None:
        if not self.remember and not self.anima_memories_writes:
            raise ValueError("An episodic-memory arm needs `remember` or MEMORIES.md writes")
        if self.anima_memories_write_guidance is not None:
            if not self.anima_memories_write_guidance.strip():
                raise ValueError("Replacement MEMORIES.md write guidance must not be empty")
            if not self.anima_memories_writes:
                raise ValueError("Replacement MEMORIES.md write guidance needs MEMORIES.md writes")


DEFAULT_EPISODIC_MEMORY_ARM = EpisodicMemoryArm()
