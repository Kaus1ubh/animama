"""Private uploads staged before they become an owner's content.

Avatar VRM files and Pocket voice catalogs share one upload record: its bytes stay
in the composition's private storage until a finalize step validates and publishes
them, or an abort or cleanup removes them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

StagedUploadStatus = Literal["pending", "finalized", "aborted", "expired", "cleanup_pending"]

STATUS_PENDING: StagedUploadStatus = "pending"
STATUS_FINALIZED: StagedUploadStatus = "finalized"
STATUS_ABORTED: StagedUploadStatus = "aborted"
STATUS_EXPIRED: StagedUploadStatus = "expired"
STATUS_CLEANUP_PENDING: StagedUploadStatus = "cleanup_pending"


@dataclass(frozen=True, slots=True)
class VoiceCatalogUpload:
    """One owner's staged Pocket voice catalog (``.bin``) upload."""

    id: str
    user_id: str
    storage_locator: str
    original_filename: str
    declared_content_type: str | None
    declared_size_bytes: int
    status: str
    expires_at: datetime


__all__ = [
    "STATUS_ABORTED",
    "STATUS_CLEANUP_PENDING",
    "STATUS_EXPIRED",
    "STATUS_FINALIZED",
    "STATUS_PENDING",
    "StagedUploadStatus",
    "VoiceCatalogUpload",
]
