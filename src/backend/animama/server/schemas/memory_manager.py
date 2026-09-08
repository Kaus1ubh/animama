from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PyMemoryEpisodeItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    source_anima_id: str | None = None
    source_chat_id: str | None = None
    source_run_id: str | None = None
    source_message_id: str | None = None
    occurred_at: datetime
    local_date: date
    local_timezone: str | None = None
    episode_path: str
    kind: str
    text: str
    status: Literal["pending", "processed"]
    processed_at: datetime | None = None
    processed_by_run_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PyMemoryEpisodeListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[PyMemoryEpisodeItem] = Field(default_factory=list)


class PyMemoryPatchPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: Literal["create", "update", "delete"]
    path: str
    old_content: str | None = None
    new_content: str | None = None
    old_description: str | None = None
    new_description: str | None = None
    unified_diff: str
    expected_version: int | None = Field(default=None, ge=0)
    summary: str | None = None


class PyMemoryManagerTaskSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["episode_processing"]
    status: Literal["processing", "processed"]
    batch_size: int = Field(..., ge=1, le=50)
    has_more: bool
    started_at: datetime
    processed_at: datetime | None = None


class PyMemoryManagerRun(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    status: Literal["active", "waiting_approval", "completed", "failed"]
    kind: Literal["general", "episode_processing"] = "general"
    task: PyMemoryManagerTaskSummary | None = None
    model_provider: str | None = None
    model_name: str | None = None
    summary: str | None = None
    error: str | None = None
    usage_metadata: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    completed_at: datetime | None = None


class PyMemoryManagerMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    run_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class PyMemoryManagerApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    run_id: str
    status: Literal["pending", "approved", "rejected"]
    target_entry_id: str | None = None
    operation_metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    decided_at: datetime | None = None
    decision_feedback: str | None = None
    applied_version: int | None = Field(default=None, ge=1)
    undone_at: datetime | None = None
    undo_version: int | None = Field(default=None, ge=1)
    can_undo: bool = False
    preview: PyMemoryPatchPreview


class PyMemoryManagerApprovalUndoResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approval: PyMemoryManagerApproval
    target_entry_id: str
    undo_version: int = Field(..., ge=1)
    deleted: bool


class PyMemoryManagerRunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run: PyMemoryManagerRun
    messages: list[PyMemoryManagerMessage] = Field(default_factory=list)
    approvals: list[PyMemoryManagerApproval] = Field(default_factory=list)


class PyMemoryManagerRunCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str | None = Field(default=None, max_length=4000)
    auto_approve_diffs: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("message", mode="before")
    @classmethod
    def trim_optional_message(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None


class PyMemoryManagerEpisodeProcessingRunCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auto_approve_diffs: bool = False


class PyMemoryManagerMessageCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(..., min_length=1, max_length=4000)
    auto_approve_diffs: bool = False

    @field_validator("content", mode="before")
    @classmethod
    def trim_content(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("content must not be blank")
        return normalized


class PyMemoryManagerApprovalDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["approve", "reject"]
    feedback: str | None = Field(default=None, max_length=2000)

    @field_validator("feedback", mode="before")
    @classmethod
    def trim_feedback(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None


__all__ = [
    "PyMemoryEpisodeItem",
    "PyMemoryEpisodeListResponse",
    "PyMemoryManagerApproval",
    "PyMemoryManagerApprovalDecisionRequest",
    "PyMemoryManagerApprovalUndoResponse",
    "PyMemoryManagerEpisodeProcessingRunCreateRequest",
    "PyMemoryManagerMessage",
    "PyMemoryManagerMessageCreateRequest",
    "PyMemoryManagerRun",
    "PyMemoryManagerRunCreateRequest",
    "PyMemoryManagerRunResponse",
    "PyMemoryManagerTaskSummary",
    "PyMemoryPatchPreview",
]
