from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .chat import ChatHistoryPosition

MEMORY_MANAGER_RUN_KIND_GENERAL = "general"
MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING = "episode_processing"
# An owner-started curation of one Anima's MEMORIES.md from its uncovered chat turns.
MEMORY_MANAGER_RUN_KIND_REFLECTION = "reflection"
MEMORY_MANAGER_RUN_KINDS = frozenset(
    {
        MEMORY_MANAGER_RUN_KIND_GENERAL,
        MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING,
        MEMORY_MANAGER_RUN_KIND_REFLECTION,
    }
)
MEMORY_MANAGER_REFLECTION_TASK_VERSION = 1
# Each side of a chat turn a Reflection reads is shortened past this many characters.
REFLECTION_TURN_TEXT_MAX_CHARS = 2000

MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING = "processing"
MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSED = "processed"
MEMORY_MANAGER_EPISODE_TASK_STATUSES = frozenset(
    {
        MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING,
        MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSED,
    }
)
MEMORY_MANAGER_EPISODE_TASK_VERSION = 1

MEMORY_MANAGER_RUN_STATUS_ACTIVE = "active"
MEMORY_MANAGER_RUN_STATUS_WAITING_APPROVAL = "waiting_approval"
MEMORY_MANAGER_RUN_STATUS_COMPLETED = "completed"
MEMORY_MANAGER_RUN_STATUS_FAILED = "failed"
MEMORY_MANAGER_RUN_STATUSES = frozenset(
    {
        MEMORY_MANAGER_RUN_STATUS_ACTIVE,
        MEMORY_MANAGER_RUN_STATUS_WAITING_APPROVAL,
        MEMORY_MANAGER_RUN_STATUS_COMPLETED,
        MEMORY_MANAGER_RUN_STATUS_FAILED,
    }
)

# Who started a run, kept in ``metadata["origin"]``: absent for the owner, or "automatic" for
# a backend-started episode-processing run (spec #775, R7). The open-run unique indexes are
# keyed on it, so one owner run and one automatic run may be open at the same time.
MEMORY_MANAGER_RUN_ORIGIN_KEY = "origin"
MEMORY_MANAGER_RUN_ORIGIN_AUTOMATIC = "automatic"
# The value the owner-run index assumes when the key is absent.
MEMORY_MANAGER_RUN_ORIGIN_OWNER = "owner"


def memory_manager_run_is_automatic(run: MemoryManagerRun) -> bool:
    """Whether the backend started ``run`` rather than the owner."""

    return dict(run.metadata or {}).get(MEMORY_MANAGER_RUN_ORIGIN_KEY) == MEMORY_MANAGER_RUN_ORIGIN_AUTOMATIC


MEMORY_MANAGER_MESSAGE_ROLE_USER = "user"
MEMORY_MANAGER_MESSAGE_ROLE_ASSISTANT = "assistant"
MEMORY_MANAGER_MESSAGE_ROLE_SYSTEM = "system"
MEMORY_MANAGER_MESSAGE_ROLES = frozenset(
    {
        MEMORY_MANAGER_MESSAGE_ROLE_USER,
        MEMORY_MANAGER_MESSAGE_ROLE_ASSISTANT,
        MEMORY_MANAGER_MESSAGE_ROLE_SYSTEM,
    }
)

MEMORY_MANAGER_APPROVAL_STATUS_PENDING = "pending"
MEMORY_MANAGER_APPROVAL_STATUS_APPROVED = "approved"
MEMORY_MANAGER_APPROVAL_STATUS_REJECTED = "rejected"
MEMORY_MANAGER_APPROVAL_STATUSES = frozenset(
    {
        MEMORY_MANAGER_APPROVAL_STATUS_PENDING,
        MEMORY_MANAGER_APPROVAL_STATUS_APPROVED,
        MEMORY_MANAGER_APPROVAL_STATUS_REJECTED,
    }
)

MEMORY_PATCH_OPERATION_CREATE = "create"
MEMORY_PATCH_OPERATION_UPDATE = "update"
MEMORY_PATCH_OPERATION_DELETE = "delete"
MEMORY_PATCH_OPERATIONS = frozenset(
    {
        MEMORY_PATCH_OPERATION_CREATE,
        MEMORY_PATCH_OPERATION_UPDATE,
        MEMORY_PATCH_OPERATION_DELETE,
    }
)


def new_memory_manager_run_id() -> str:
    """Return a durable ID for one memory-manager chat run."""

    return f"mmr-{uuid.uuid4()}"


def new_memory_manager_message_id() -> str:
    """Return a durable ID for one memory-manager chat message."""

    return f"mmm-{uuid.uuid4()}"


def new_memory_manager_approval_id() -> str:
    """Return a durable ID for one memory-manager approval request."""

    return f"mma-{uuid.uuid4()}"


@dataclass(slots=True)
class MemoryPatchPreview:
    """Frontend-safe proposed mutation against one virtual memory file."""

    operation: str
    path: str
    old_content: str | None
    new_content: str | None
    old_description: str | None
    new_description: str | None
    unified_diff: str
    expected_version: int | None
    summary: str | None = None


@dataclass(slots=True)
class MemoryManagerRun:
    """Durable memory-manager chat run owned by one user."""

    id: str
    user_id: str
    status: str
    kind: str = MEMORY_MANAGER_RUN_KIND_GENERAL
    task_state: dict[str, Any] | None = None
    model_provider: str | None = None
    model_name: str | None = None
    # The model row the run started on; resuming an approval uses this row even
    # after the Memory Manager role changes.
    model_provider_id: str | None = None
    openai_previous_response_id: str | None = None
    serialized_agent_state: str | None = None
    summary: str | None = None
    error: str | None = None
    usage_metadata: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    completed_at: datetime | None = None


@dataclass(slots=True)
class MemoryManagerMessage:
    """One visible message in a memory-manager chat run."""

    id: str
    run_id: str
    user_id: str
    role: str
    content: str
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None


@dataclass(slots=True)
class MemoryManagerApproval:
    """Persisted user decision point for one proposed memory file operation."""

    id: str
    run_id: str
    user_id: str
    status: str
    operation: str
    target_path: str
    target_entry_id: str | None
    expected_version: int | None
    summary: str | None
    old_content: str | None
    new_content: str | None
    old_description: str | None
    new_description: str | None
    unified_diff: str
    operation_metadata: dict[str, Any] | None = None
    decision_feedback: str | None = None
    applied_version: int | None = None
    undone_at: datetime | None = None
    undo_version: int | None = None
    can_undo: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    decided_at: datetime | None = None

    @property
    def preview(self) -> MemoryPatchPreview:
        """Return the public preview payload represented by this approval."""

        return MemoryPatchPreview(
            operation=self.operation,
            path=self.target_path,
            old_content=self.old_content,
            new_content=self.new_content,
            old_description=self.old_description,
            new_description=self.new_description,
            unified_diff=self.unified_diff,
            expected_version=self.expected_version,
            summary=self.summary,
        )


@dataclass(slots=True)
class MemoryManagerRunSnapshot:
    """Current run state assembled for route responses."""

    run: MemoryManagerRun
    messages: list[MemoryManagerMessage]
    approvals: list[MemoryManagerApproval]


@dataclass(frozen=True, slots=True)
class MemoryManagerApprovalUndoResult:
    """Authoritative audit result for an idempotent approval Undo."""

    approval: MemoryManagerApproval
    target_entry_id: str
    undo_version: int
    deleted: bool


@dataclass(frozen=True, slots=True)
class MemoryManagerEpisodeTaskItem:
    """One private run-local alias mapped to a durable episode item."""

    episode_item_id: str
    ref: str


@dataclass(frozen=True, slots=True)
class MemoryManagerEpisodeTaskState:
    """Validated private state for one fixed episodic-memory review batch."""

    status: str
    items: tuple[MemoryManagerEpisodeTaskItem, ...]
    has_more: bool
    started_at: datetime
    processed_at: datetime | None = None
    version: int = MEMORY_MANAGER_EPISODE_TASK_VERSION
    kind: str = MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING

    @property
    def batch_size(self) -> int:
        """Return the immutable fixed-batch size."""

        return len(self.items)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the private task document for JSONB storage."""

        return {
            "version": self.version,
            "kind": self.kind,
            "status": self.status,
            "items": [{"episode_item_id": item.episode_item_id, "ref": item.ref} for item in self.items],
            "batch_size": self.batch_size,
            "has_more": self.has_more,
            "started_at": self.started_at.isoformat(),
            "processed_at": self.processed_at.isoformat() if self.processed_at is not None else None,
        }

    @classmethod
    def from_dict(cls, value: object) -> MemoryManagerEpisodeTaskState:
        """Parse and validate a private task document from persistence."""

        if not isinstance(value, dict):
            raise ValueError("Episode-processing task state is missing")
        version = value.get("version")
        kind = value.get("kind")
        status = value.get("status")
        raw_items = value.get("items")
        has_more = value.get("has_more")
        if version != MEMORY_MANAGER_EPISODE_TASK_VERSION:
            raise ValueError("Episode-processing task state version is unsupported")
        if kind != MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING:
            raise ValueError("Episode-processing task state kind is invalid")
        if status not in MEMORY_MANAGER_EPISODE_TASK_STATUSES:
            raise ValueError("Episode-processing task state status is invalid")
        if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= 50:
            raise ValueError("Episode-processing task state batch is invalid")
        items: list[MemoryManagerEpisodeTaskItem] = []
        seen_ids: set[str] = set()
        for index, raw_item in enumerate(raw_items, start=1):
            if not isinstance(raw_item, dict):
                raise ValueError("Episode-processing task item is invalid")
            item_id = raw_item.get("episode_item_id")
            ref = raw_item.get("ref")
            expected_ref = f"E{index:02d}"
            if not isinstance(item_id, str) or not item_id or item_id in seen_ids:
                raise ValueError("Episode-processing task item id is invalid")
            if ref != expected_ref:
                raise ValueError("Episode-processing task item alias is invalid")
            seen_ids.add(item_id)
            items.append(MemoryManagerEpisodeTaskItem(episode_item_id=item_id, ref=ref))
        if value.get("batch_size") != len(items):
            raise ValueError("Episode-processing task batch size is invalid")
        if not isinstance(has_more, bool):
            raise ValueError("Episode-processing task has_more is invalid")
        started_at = _task_datetime(value.get("started_at"), field_name="started_at")
        raw_processed_at = value.get("processed_at")
        processed_at = None if raw_processed_at is None else _task_datetime(raw_processed_at, field_name="processed_at")
        if status == MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING and processed_at is not None:
            raise ValueError("Processing task cannot have processed_at")
        if status == MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSED and processed_at is None:
            raise ValueError("Processed task requires processed_at")
        return cls(
            status=status,
            items=tuple(items),
            has_more=has_more,
            started_at=started_at,
            processed_at=processed_at,
        )


@dataclass(frozen=True, slots=True)
class MemoryManagerReflectionTaskState:
    """Validated private state for one Reflection over an Anima's uncovered turns.

    The batch is every readable turn after ``covered_after`` (the Anima's
    coverage when the run started, exclusive) through ``covered_through``
    (inclusive). Applying the run's MEMORIES.md change moves the Anima's
    coverage to ``covered_through``; undoing it restores ``covered_after`` and
    ``covered_after_run_id``, the Reflection that had set it. ``timezone`` is
    the owner's IANA time zone for showing turn times.
    """

    anima_id: str
    anima_name: str
    covered_after: ChatHistoryPosition | None
    covered_through: ChatHistoryPosition
    turn_count: int
    uncovered_turn_count: int
    started_at: datetime
    covered_after_run_id: str | None = None
    timezone: str = "UTC"
    version: int = MEMORY_MANAGER_REFLECTION_TASK_VERSION
    kind: str = MEMORY_MANAGER_RUN_KIND_REFLECTION

    @property
    def remaining_turn_count(self) -> int:
        """Return the uncovered turns left for a later Reflection."""

        return self.uncovered_turn_count - self.turn_count

    def to_dict(self) -> dict[str, Any]:
        """Serialize the private task document for JSONB storage."""

        return {
            "version": self.version,
            "kind": self.kind,
            "anima_id": self.anima_id,
            "anima_name": self.anima_name,
            "covered_after": _position_to_dict(self.covered_after),
            "covered_after_run_id": self.covered_after_run_id,
            "covered_through": _position_to_dict(self.covered_through),
            "turn_count": self.turn_count,
            "uncovered_turn_count": self.uncovered_turn_count,
            "started_at": self.started_at.isoformat(),
            "timezone": self.timezone,
        }

    @classmethod
    def from_dict(cls, value: object) -> MemoryManagerReflectionTaskState:
        """Parse and validate a private task document from persistence."""

        if not isinstance(value, dict):
            raise ValueError("Reflection task state is missing")
        if value.get("version") != MEMORY_MANAGER_REFLECTION_TASK_VERSION:
            raise ValueError("Reflection task state version is unsupported")
        if value.get("kind") != MEMORY_MANAGER_RUN_KIND_REFLECTION:
            raise ValueError("Reflection task state kind is invalid")
        anima_id = value.get("anima_id")
        anima_name = value.get("anima_name")
        timezone = value.get("timezone")
        if not isinstance(anima_id, str) or not anima_id:
            raise ValueError("Reflection task anima_id is invalid")
        if not isinstance(anima_name, str):
            raise ValueError("Reflection task anima_name is invalid")
        if not isinstance(timezone, str) or not timezone:
            raise ValueError("Reflection task timezone is invalid")
        turn_count = value.get("turn_count")
        uncovered_turn_count = value.get("uncovered_turn_count")
        if isinstance(turn_count, bool) or not isinstance(turn_count, int) or turn_count < 1:
            raise ValueError("Reflection task turn_count is invalid")
        if (
            isinstance(uncovered_turn_count, bool)
            or not isinstance(uncovered_turn_count, int)
            or uncovered_turn_count < turn_count
        ):
            raise ValueError("Reflection task uncovered_turn_count is invalid")
        raw_after = value.get("covered_after")
        covered_after = None if raw_after is None else _position_from_dict(raw_after)
        covered_through = _position_from_dict(value.get("covered_through"))
        if covered_after is not None and covered_after >= covered_through:
            raise ValueError("Reflection task batch boundary is invalid")
        covered_after_run_id = value.get("covered_after_run_id")
        if (covered_after is None) != (covered_after_run_id is None) or (
            covered_after_run_id is not None and (not isinstance(covered_after_run_id, str) or not covered_after_run_id)
        ):
            raise ValueError("Reflection task covered_after_run_id is invalid")
        started_at = _aware_datetime(value.get("started_at"), label="Reflection task started_at")
        return cls(
            anima_id=anima_id,
            anima_name=anima_name,
            covered_after=covered_after,
            covered_through=covered_through,
            turn_count=turn_count,
            uncovered_turn_count=uncovered_turn_count,
            started_at=started_at,
            covered_after_run_id=covered_after_run_id,
            timezone=timezone,
        )


@dataclass(frozen=True, slots=True)
class AnimaMemoryReflection:
    """One Anima's Reflection coverage: its turns through ``covered_through`` are covered.

    ``run_id`` names the Reflection whose applied change last set the coverage.
    An Anima with no applied Reflection has no coverage row.
    """

    anima_id: str
    user_id: str
    covered_through: ChatHistoryPosition
    run_id: str
    updated_at: datetime | None = None


def shorten_reflection_turn_text(value: str | None) -> str | None:
    """Return one side of a chat turn as a Reflection reads it, shortened past ``REFLECTION_TURN_TEXT_MAX_CHARS``."""

    if value is None or len(value) <= REFLECTION_TURN_TEXT_MAX_CHARS:
        return value
    return f"{value[: REFLECTION_TURN_TEXT_MAX_CHARS - 1].rstrip()}…"


def format_turn_count(count: int) -> str:
    """Return ``"1 turn"`` or ``"<count> turns"`` for Reflection messages and summaries."""

    return f"{count} turn" if count == 1 else f"{count} turns"


def _position_to_dict(position: ChatHistoryPosition | None) -> dict[str, Any] | None:
    if position is None:
        return None
    return {"created_at": position.created_at.isoformat(), "message_id": position.message_id}


def _position_from_dict(value: object) -> ChatHistoryPosition:
    """Parse a stored history position; timestamps stay naive UTC like chat messages."""

    if not isinstance(value, dict):
        raise ValueError("Reflection task position is invalid")
    raw_created_at = value.get("created_at")
    message_id = value.get("message_id")
    if not isinstance(raw_created_at, str):
        raise ValueError("Reflection task position created_at is invalid")
    try:
        created_at = datetime.fromisoformat(raw_created_at)
    except ValueError as exc:
        raise ValueError("Reflection task position created_at is invalid") from exc
    if created_at.tzinfo is not None:
        raise ValueError("Reflection task position created_at must be naive UTC")
    if isinstance(message_id, bool) or not isinstance(message_id, int) or message_id < 1:
        raise ValueError("Reflection task position message_id is invalid")
    return ChatHistoryPosition(created_at=created_at, message_id=message_id)


def _aware_datetime(value: object, *, label: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{label} is invalid")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label} is invalid") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{label} must include timezone information")
    return parsed


def _task_datetime(value: object, *, field_name: str) -> datetime:
    return _aware_datetime(value, label=f"Episode-processing task {field_name}")


__all__ = [
    "AnimaMemoryReflection",
    "MEMORY_MANAGER_RUN_ORIGIN_AUTOMATIC",
    "MEMORY_MANAGER_RUN_ORIGIN_KEY",
    "MEMORY_MANAGER_RUN_ORIGIN_OWNER",
    "memory_manager_run_is_automatic",
    "MEMORY_MANAGER_APPROVAL_STATUS_APPROVED",
    "MEMORY_MANAGER_APPROVAL_STATUS_PENDING",
    "MEMORY_MANAGER_APPROVAL_STATUS_REJECTED",
    "MEMORY_MANAGER_APPROVAL_STATUSES",
    "MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSED",
    "MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING",
    "MEMORY_MANAGER_EPISODE_TASK_STATUSES",
    "MEMORY_MANAGER_EPISODE_TASK_VERSION",
    "MEMORY_MANAGER_MESSAGE_ROLE_ASSISTANT",
    "MEMORY_MANAGER_MESSAGE_ROLE_SYSTEM",
    "MEMORY_MANAGER_MESSAGE_ROLE_USER",
    "MEMORY_MANAGER_MESSAGE_ROLES",
    "MEMORY_MANAGER_REFLECTION_TASK_VERSION",
    "MEMORY_MANAGER_RUN_STATUS_ACTIVE",
    "MEMORY_MANAGER_RUN_STATUS_COMPLETED",
    "MEMORY_MANAGER_RUN_STATUS_FAILED",
    "MEMORY_MANAGER_RUN_STATUS_WAITING_APPROVAL",
    "MEMORY_MANAGER_RUN_STATUSES",
    "MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING",
    "MEMORY_MANAGER_RUN_KIND_GENERAL",
    "MEMORY_MANAGER_RUN_KIND_REFLECTION",
    "MEMORY_MANAGER_RUN_KINDS",
    "MEMORY_PATCH_OPERATION_CREATE",
    "MEMORY_PATCH_OPERATION_DELETE",
    "MEMORY_PATCH_OPERATION_UPDATE",
    "MEMORY_PATCH_OPERATIONS",
    "REFLECTION_TURN_TEXT_MAX_CHARS",
    "MemoryManagerApproval",
    "MemoryManagerApprovalUndoResult",
    "MemoryManagerEpisodeTaskItem",
    "MemoryManagerEpisodeTaskState",
    "MemoryManagerMessage",
    "MemoryManagerReflectionTaskState",
    "MemoryManagerRun",
    "MemoryManagerRunSnapshot",
    "MemoryPatchPreview",
    "format_turn_count",
    "new_memory_manager_approval_id",
    "new_memory_manager_message_id",
    "new_memory_manager_run_id",
    "shorten_reflection_turn_text",
]
