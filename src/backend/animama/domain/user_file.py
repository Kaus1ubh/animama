from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

STATUS_PENDING_UPLOAD = "pending_upload"
STATUS_UPLOADED = "uploaded"
STATUS_PROCESSING = "processing"
STATUS_READY = "ready"
STATUS_READY_KEYWORD_ONLY = "ready_keyword_only"
STATUS_ABORTED = "aborted"
STATUS_FAILED = "failed"
STATUS_DELETE_PENDING = "delete_pending"
STATUS_DELETED = "deleted"


@dataclass(slots=True)
class UserFile:
    """Account-owned metadata tracked around direct private-file uploads."""

    id: str
    user_id: str
    storage_locator: str
    original_filename: str
    normalized_extension: str
    declared_size_bytes: int
    status: str = STATUS_PENDING_UPLOAD
    declared_content_type: str | None = None
    detected_content_type: str | None = None
    stored_size_bytes: int | None = None
    sha256: str | None = None
    upload_expires_at: datetime | None = None
    processed_at: datetime | None = None
    last_error: str | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


__all__ = [
    "STATUS_ABORTED",
    "STATUS_DELETED",
    "STATUS_DELETE_PENDING",
    "STATUS_FAILED",
    "STATUS_PENDING_UPLOAD",
    "STATUS_PROCESSING",
    "STATUS_READY",
    "STATUS_READY_KEYWORD_ONLY",
    "STATUS_UPLOADED",
    "UserFile",
]
