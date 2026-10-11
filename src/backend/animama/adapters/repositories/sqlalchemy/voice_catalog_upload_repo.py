"""SQLAlchemy records of staged Pocket voice catalog uploads (the ``avatar_upload`` table)."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.staged_upload import STATUS_PENDING, StagedUploadStatus, VoiceCatalogUpload
from animama.orm import ORMAvatarUpload

# The table also holds avatar VRM uploads; this type marks voice catalogs.
UPLOAD_TYPE_POCKET_VOICE_CATALOG = "pocket_voice_catalog"


def _domain(row: ORMAvatarUpload) -> VoiceCatalogUpload:
    return VoiceCatalogUpload(
        id=row.id,
        user_id=row.user_id,
        storage_locator=row.storage_locator,
        original_filename=row.original_filename,
        declared_content_type=row.declared_content_type,
        declared_size_bytes=row.declared_size_bytes,
        status=row.status,
        expires_at=row.expires_at,
    )


class SQLAlchemyVoiceCatalogUploadRepository:
    """Voice catalog uploads of every owner, always filtered by the caller's owner ID."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

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
        row = ORMAvatarUpload(
            id=f"upload-{uuid4().hex}",
            user_id=user_id,
            storage_locator=storage_locator,
            original_filename=original_filename,
            declared_content_type=declared_content_type,
            declared_size_bytes=declared_size_bytes,
            upload_type=UPLOAD_TYPE_POCKET_VOICE_CATALOG,
            status=STATUS_PENDING,
            expires_at=expires_at,
        )
        self._session.add(row)
        await self._session.flush()
        await self._session.refresh(row)
        return _domain(row)

    async def _owned_row(self, *, upload_id: str, user_id: str) -> ORMAvatarUpload | None:
        result = await self._session.execute(
            select(ORMAvatarUpload).where(
                ORMAvatarUpload.id == upload_id,
                ORMAvatarUpload.user_id == user_id,
                ORMAvatarUpload.upload_type == UPLOAD_TYPE_POCKET_VOICE_CATALOG,
            )
        )
        return result.scalar_one_or_none()

    async def get_owned(self, *, upload_id: str, user_id: str) -> VoiceCatalogUpload | None:
        row = await self._owned_row(upload_id=upload_id, user_id=user_id)
        return _domain(row) if row is not None else None

    async def set_status(
        self, *, upload_id: str, user_id: str, status: StagedUploadStatus, last_error: str | None = None
    ) -> None:
        row = await self._owned_row(upload_id=upload_id, user_id=user_id)
        if row is None:
            raise LookupError(f"Voice catalog upload {upload_id} is not owned by the caller")
        row.status = status
        row.last_error = last_error


__all__ = ["SQLAlchemyVoiceCatalogUploadRepository"]
