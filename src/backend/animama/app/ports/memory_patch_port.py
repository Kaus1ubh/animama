"""Provider-neutral port for planning virtual-memory V4A patches."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class MemoryPatchPlanError(ValueError):
    """Raised when a V4A operation cannot produce a safe memory candidate."""


@dataclass(frozen=True, slots=True)
class MemoryPatchCandidate:
    """Resolved before/after state for one create or update operation."""

    operation: str
    path: str
    old_content: str | None
    new_content: str
    old_description: str | None
    new_description: str | None
    target_entry_id: str | None
    expected_version: int
    summary: str


class MemoryPatchPlanner(Protocol):
    """Resolve model-authored V4A operations against current user memory."""

    async def plan_v4a_operation(
        self,
        *,
        user_id: str,
        operation_type: str,
        path: str,
        diff: str | None,
    ) -> MemoryPatchCandidate:
        raise NotImplementedError


__all__ = ["MemoryPatchCandidate", "MemoryPatchPlanError", "MemoryPatchPlanner"]
