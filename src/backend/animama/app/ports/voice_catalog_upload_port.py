"""Owner-scoped records of staged Pocket voice catalog uploads."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from animama.domain.staged_upload import StagedUploadStatus, VoiceCatalogUpload


class VoiceCatalogUploadRepository(Protocol):
    """Upload records; changes become durable through the session's unit of work."""

    async def create_pending(
        self,
        *,
        user_id: str,
        storage_locator: str,
        original_filename: str,
        declared_content_type: str | None,
        declared_size_bytes: int,
        expires_at: datetime,
    ) -> VoiceCatalogUpload:
        """Record a new pending upload."""
        ...

    async def get_owned(self, *, upload_id: str, user_id: str) -> VoiceCatalogUpload | None:
        """Return the upload when ``user_id`` owns it, or ``None``."""
        ...

    async def set_status(
        self, *, upload_id: str, user_id: str, status: StagedUploadStatus, last_error: str | None = None
    ) -> None:
        """Move an owned upload to ``status``, replacing its last error."""
        ...


__all__ = ["VoiceCatalogUploadRepository"]
