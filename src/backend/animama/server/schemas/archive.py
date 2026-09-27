from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PyArchive(BaseModel):
    """Archive metadata DTO."""

    model_config = ConfigDict(extra="allow")

    id: str = Field(..., description="Archive id")
    name: str = Field(..., description="Human-friendly archive name")
    description: str | None = Field(default=None, description="Optional archive description")
    organization_id: str | None = Field(default=None, description="Organization this archive belongs to, if any.")
    metadata: dict[str, Any] | None = Field(default=None, description="Additional archive metadata")
    created_at: datetime | None = Field(default=None)
    updated_at: datetime | None = Field(default=None)


class PyArchivePassageBase(BaseModel):
    """Shared fields for archive passage DTOs."""

    text: str = Field(..., description="Passage text content")
    tags: list[str] | None = Field(default=None, description="Optional tags associated with this passage")
    metadata: dict[str, Any] | None = Field(default=None, description="Additional metadata for the passage")
    source_id: str | None = Field(default=None, description="Optional logical source identifier")
    file_id: str | None = Field(default=None, description="Optional file identifier this passage was derived from")


class PyArchivePassageCreate(PyArchivePassageBase):
    """Request payload for creating a passage."""

    model_config = ConfigDict(extra="forbid")


class PyArchivePassageUpdate(BaseModel):
    """Patch payload for updating a passage."""

    model_config = ConfigDict(extra="forbid")

    text: str | None = Field(default=None, description="Updated passage text")
    tags: list[str] | None = Field(default=None, description="Updated tags")
    metadata: dict[str, Any] | None = Field(default=None, description="Updated metadata")
    source_id: str | None = Field(default=None, description="Updated source id")
    file_id: str | None = Field(default=None, description="Updated file id")


class PyArchivePassageResponse(PyArchivePassageBase):
    """Response shape for archive passages."""

    model_config = ConfigDict(extra="allow")

    id: int = Field(..., description="Passage id")
    archive_id: str = Field(..., description="Owning archive id")
    created_at: datetime | None = Field(default=None)
    updated_at: datetime | None = Field(default=None)


class PyArchivePassageSearchRequest(BaseModel):
    """Search request for archive passages."""

    query: str = Field(..., description="Natural language query text")
    limit: int = Field(default=5, ge=1, le=50)
    threshold: float = Field(
        default=0.1,
        ge=0.0,
        le=1.0,
        description="Minimum vector similarity; not applied when search falls back to full text",
    )


class PyArchivePassageSearchResult(PyArchivePassageResponse):
    """Search result including similarity score."""

    score: float = Field(..., description="Similarity score between 0.0 and 1.0")


__all__ = [
    "PyArchive",
    "PyArchivePassageBase",
    "PyArchivePassageCreate",
    "PyArchivePassageUpdate",
    "PyArchivePassageResponse",
    "PyArchivePassageSearchRequest",
    "PyArchivePassageSearchResult",
]
