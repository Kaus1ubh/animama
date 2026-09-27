from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PyChatBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=200)
    metadata: dict[str, Any] | None = Field(default_factory=dict)


class PyChatCreate(PyChatBase):
    anima_id: str


class PyChatUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    metadata: dict[str, Any] | None = None


class PyChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str
    anima_id: str | None = None
    title: str | None = None
    api_standard: str | None = None
    last_model_client: str | None = None
    last_model_id: str | None = None
    last_model_provider_id: str | None = None
    metadata: dict[str, Any] | None = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_message_at: datetime | None = None
    usage: PyUsage | None = None
    active_context_tokens: int = 0


class PyUsageInputDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cached_tokens: int | None = 0
    audio_tokens: int | None = 0


class PyUsageOutputDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reasoning_tokens: int | None = 0
    audio_tokens: int | None = 0
    accepted_prediction_tokens: int | None = 0
    rejected_prediction_tokens: int | None = 0


class PyUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requests: int | None = 0
    input_tokens: int | None = 0
    output_tokens: int | None = 0
    total_tokens: int | None = 0
    input_tokens_details: PyUsageInputDetails | None = None
    output_tokens_details: PyUsageOutputDetails | None = None


class PyChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int | None = None
    chat_id: str | None = None
    run_id: str | None = None
    message_type: str | None = None
    role: str | None = None
    content: str | None = None
    model: str | None = None
    model_provider: str | None = None
    data: dict[str, Any] | None = None
    usage: PyUsage | None = None
    turn: int | None = None
    created_at: datetime | None = None
    internal: bool = False


class PyChatMessagesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chat_id: str
    messages: list[PyChatMessage]


class PyChatSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(..., min_length=2, max_length=200)
    limit: int = Field(default=20, ge=1, le=50)
    offset: int = Field(default=0, ge=0)

    @field_validator("query")
    @classmethod
    def trim_query(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 2:
            raise ValueError("query must be at least 2 characters")
        return normalized


class PyChatSearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: int
    chat_id: str
    anima_id: str
    anima_name: str | None = None
    anima_profile_picture_url: str | None = None
    chat_title: str | None = None
    snippet: str
    score: float
    turn: int | None = None
    created_at: datetime | None = None


class PyChatSearchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    limit: int
    offset: int
    has_more: bool
    results: list[PyChatSearchResult]


__all__ = [
    "PyChatCreate",
    "PyChatUpdate",
    "PyChatResponse",
    "PyChatMessage",
    "PyChatMessagesResponse",
    "PyChatSearchRequest",
    "PyChatSearchResult",
    "PyChatSearchResponse",
    "PyUsage",
    "PyUsageInputDetails",
    "PyUsageOutputDetails",
]
