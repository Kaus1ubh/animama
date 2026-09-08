from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

JOB_TYPE_PROCESS_FILE = "process_file"

JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCEEDED = "succeeded"
JOB_STATUS_FAILED = "failed"
JOB_STATUS_CANCELED = "canceled"

ACTIVE_PROCESSING_JOB_STATUSES = {
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
}

SEARCH_MODE_KEYWORD = "keyword"
SEARCH_MODE_SEMANTIC = "semantic"
SEARCH_MODE_HYBRID = "hybrid"
SearchMode = Literal["keyword", "semantic", "hybrid"]
UserFileOverviewMethod = Literal["structured", "extractive", "table", "json", "xml", "fallback_excerpt"]


@dataclass(frozen=True, slots=True)
class UserFileOutlineItem:
    """Provider-neutral structural heading extracted from an uploaded document."""

    level: int
    title: str


@dataclass(frozen=True, slots=True)
class UserFileOverview:
    """Versioned, bounded navigation metadata generated for an uploaded document."""

    version: int
    description: str
    outline: tuple[UserFileOutlineItem, ...]
    method: UserFileOverviewMethod
    outline_truncated: bool


@dataclass(slots=True)
class UserFileChunk:
    """Searchable text segment extracted from a user-owned upload."""

    id: str
    file_id: str
    user_id: str
    chunk_index: int
    text: str
    embedding: list[float] | None = None
    char_count: int = 0
    token_estimate: int = 0
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class UserFileReadableChunk:
    """Minimal ordered chunk content exposed by the attachment read port."""

    chunk_index: int
    text: str


@dataclass(frozen=True, slots=True)
class UserFileChunkDraft:
    """Deterministic chunk payload before repository ID assignment."""

    chunk_index: int
    text: str
    char_count: int
    token_estimate: int
    metadata: dict[str, Any]
    embedding_text: str | None = None
    embedding: list[float] | None = None


@dataclass(slots=True)
class UserFileProcessingJob:
    """Durable Postgres-backed processing job for an uploaded file."""

    id: str
    file_id: str
    user_id: str
    job_type: str = JOB_TYPE_PROCESS_FILE
    status: str = JOB_STATUS_QUEUED
    attempts: int = 0
    max_attempts: int = 3
    run_after: datetime | None = None
    locked_by: str | None = None
    locked_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    last_error: str | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class UserFileProcessingJobSummary:
    """Small job snapshot returned with file list/detail responses."""

    job_id: str
    status: str
    attempts: int
    max_attempts: int
    last_error: str | None = None
    run_after: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class UserFileProcessingInfo:
    """Cheap per-file processing summary for response decoration."""

    file_id: str
    chunk_count: int
    latest_job: UserFileProcessingJobSummary | None = None


@dataclass(frozen=True, slots=True)
class ClaimedUserFileProcessingJob:
    """Job lease plus immutable file metadata needed by a worker attempt."""

    job: UserFileProcessingJob
    storage_locator: str
    original_filename: str
    normalized_extension: str
    stored_size_bytes: int | None
    declared_size_bytes: int


@dataclass(frozen=True, slots=True)
class ParsedUserFileDocument:
    """Normalized parser output used by chunking and worker code."""

    text: str
    parser_name: str
    metadata: dict[str, Any]
    tables: list[dict[str, Any]] | None = None
    chunks: list[UserFileChunkDraft] | None = None
    source_outline: tuple[UserFileOutlineItem, ...] = ()
    source_outline_truncated: bool = False


@dataclass(frozen=True, slots=True)
class UserFileSearchResult:
    """Search result over processed user-file chunks."""

    chunk_id: str
    file_id: str
    chunk_index: int
    text: str
    score: float
    metadata: dict[str, Any]
    original_filename: str
    normalized_extension: str
    match_type: str


__all__ = [
    "ACTIVE_PROCESSING_JOB_STATUSES",
    "ClaimedUserFileProcessingJob",
    "JOB_STATUS_CANCELED",
    "JOB_STATUS_FAILED",
    "JOB_STATUS_QUEUED",
    "JOB_STATUS_RUNNING",
    "JOB_STATUS_SUCCEEDED",
    "JOB_TYPE_PROCESS_FILE",
    "ParsedUserFileDocument",
    "SEARCH_MODE_HYBRID",
    "SEARCH_MODE_KEYWORD",
    "SEARCH_MODE_SEMANTIC",
    "SearchMode",
    "UserFileChunk",
    "UserFileChunkDraft",
    "UserFileOutlineItem",
    "UserFileOverview",
    "UserFileOverviewMethod",
    "UserFileReadableChunk",
    "UserFileProcessingInfo",
    "UserFileProcessingJob",
    "UserFileProcessingJobSummary",
    "UserFileSearchResult",
]
