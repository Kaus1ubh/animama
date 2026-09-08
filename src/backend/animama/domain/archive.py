from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class Archive:
    """Domain model for a anima-scoped archive."""

    id: str
    name: str
    description: str | None = None
    organization_id: str | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True)
class ArchivePassage:
    """Domain model for an archival passage."""

    id: int
    archive_id: str
    text: str
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    source_id: str | None = None
    file_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    # Optional similarity score when returned from search operations
    score: float | None = None
    # Embedding is managed by adapters; domain treats it as opaque.
    embedding: list[float] | None = None


__all__ = ["Archive", "ArchivePassage"]
