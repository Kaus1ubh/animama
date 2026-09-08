from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class PyUserFileUploadInitRequest(BaseModel):
    filename: str = Field(
        ...,
        min_length=1,
        description="Original filename selected by the user. Stored only as display metadata.",
    )
    content_type: str | None = Field(
        default=None,
        description="Content type sent with the browser upload request.",
    )
    size_bytes: int = Field(..., gt=0, description="Size of the file in bytes.")


class PyUserFileUploadInitResponse(BaseModel):
    file_id: str
    upload_url: str
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)
    expires_at: datetime


class PyUserFileFinalizeRequest(BaseModel):
    pass


class PyUserFileProcessingJobResponse(BaseModel):
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


class PyUserFileResponse(BaseModel):
    file_id: str
    original_filename: str
    normalized_extension: str
    status: str
    declared_content_type: str | None = None
    detected_content_type: str | None = None
    declared_size_bytes: int
    stored_size_bytes: int | None = None
    sha256: str | None = None
    upload_expires_at: datetime | None = None
    processed_at: datetime | None = None
    last_error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    chunk_count: int = 0
    latest_processing_job: PyUserFileProcessingJobResponse | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PyUserFileListResponse(BaseModel):
    files: list[PyUserFileResponse]


class PyUserFileProcessRequest(BaseModel):
    force: bool = False


class PyUserFileProcessResponse(BaseModel):
    file_id: str
    job_id: str | None = None
    file_status: str
    job_status: str | None = None
    reused_existing_job: bool


class PyUserFileSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2048)
    limit: int = Field(default=10, ge=1, le=50)
    file_ids: list[str] | None = None
    mode: Literal["keyword", "semantic", "hybrid"] = "hybrid"


class PyUserFileSearchResult(BaseModel):
    chunk_id: str
    file_id: str
    chunk_index: int
    original_filename: str
    normalized_extension: str
    score: float
    match_type: str
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class PyUserFileSearchResponse(BaseModel):
    query: str
    mode: Literal["keyword", "semantic", "hybrid"]
    results: list[PyUserFileSearchResult]
    warnings: list[str] = Field(default_factory=list)


__all__ = [
    "PyUserFileFinalizeRequest",
    "PyUserFileListResponse",
    "PyUserFileProcessRequest",
    "PyUserFileProcessResponse",
    "PyUserFileProcessingJobResponse",
    "PyUserFileResponse",
    "PyUserFileSearchRequest",
    "PyUserFileSearchResponse",
    "PyUserFileSearchResult",
    "PyUserFileUploadInitRequest",
    "PyUserFileUploadInitResponse",
]
