"""Behaviour the live Memory Manager runtimes share: the turn budget, blocked results and rejection text."""

from __future__ import annotations

from typing import Any

from animama.app.ports.memory_manager_runtime import (
    MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED,
    MemoryManagerRuntimeResult,
)
from animama.domain.memory_manager import MemoryManagerRun

from .reflection import reflection_page_count, reflection_task_or_none

MAX_MANAGER_TURNS = 8
"""Model requests one step may make: a new message, or each approval resume, gets the full budget (D24)."""


def max_turns_for_run(run: MemoryManagerRun) -> int:
    """Return one step's turn budget; a Reflection gets one extra model turn per page of chat turns."""

    try:
        task = reflection_task_or_none(run)
    except ValueError:
        return MAX_MANAGER_TURNS
    return MAX_MANAGER_TURNS + (reflection_page_count(task) if task is not None else 0)


def rejection_message(path: str, feedback: str | None) -> str:
    """The tool result a rejected proposal resumes with, carrying the owner's feedback."""

    message = f"The user rejected the proposed change to `{path}`."
    return f"{message} User feedback: {feedback}" if feedback else message


def blocked_result(
    message: str,
    *,
    runtime: str,
    serialized_agent_state: str | None = None,
    openai_previous_response_id: str | None = None,
    usage_metadata: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    summary: str | None = None,
) -> MemoryManagerRuntimeResult:
    """Return a typed incomplete result that can never finalize episodes."""

    return MemoryManagerRuntimeResult(
        assistant_message=message,
        serialized_agent_state=serialized_agent_state,
        openai_previous_response_id=openai_previous_response_id,
        usage_metadata=usage_metadata,
        metadata={"runtime": runtime, **dict(metadata or {})},
        summary=summary,
        error=message,
        outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED,
    )


__all__ = ["MAX_MANAGER_TURNS", "blocked_result", "max_turns_for_run", "rejection_message"]
