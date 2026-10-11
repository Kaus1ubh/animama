"""Cleanup queries over staged private uploads (the ``avatar_upload`` table).

The shared voice-catalog routes keep their records through
``SQLAlchemyVoiceCatalogUploadRepository``; the cleanup worker uses these helpers to
remove expired or abandoned staged bytes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import asc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.staged_upload import (
    STATUS_ABORTED,
    STATUS_CLEANUP_PENDING,
    STATUS_EXPIRED,
    STATUS_FINALIZED,
    STATUS_PENDING,
    StagedUploadStatus,
)
from animama.orm import ORMAvatarUpload

AvatarUploadStatus = StagedUploadStatus
AvatarUploadType = Literal["avatar_vrm", "pocket_voice_catalog"]

UPLOAD_TYPE_AVATAR_VRM: AvatarUploadType = "avatar_vrm"
UPLOAD_TYPE_POCKET_VOICE_CATALOG: AvatarUploadType = "pocket_voice_catalog"


def utcnow() -> datetime:
    return datetime.now(UTC)


async def list_uploads_for_cleanup(
    session: AsyncSession,
    *,
    now: datetime | None = None,
    limit: int = 50,
) -> list[ORMAvatarUpload]:
    effective_now = now or utcnow()
    result = await session.execute(
        select(ORMAvatarUpload)
        .where(
            or_(
                ORMAvatarUpload.status == STATUS_CLEANUP_PENDING,
                (ORMAvatarUpload.status == STATUS_PENDING) & (ORMAvatarUpload.expires_at <= effective_now),
            )
        )
        .order_by(asc(ORMAvatarUpload.expires_at), asc(ORMAvatarUpload.created_at))
        .limit(limit)
    )
    return list(result.scalars())


def set_upload_status(
    upload: ORMAvatarUpload,
    *,
    status: AvatarUploadStatus,
    last_error: str | None = None,
    avatar_id: str | None = None,
    anima_id: str | None = None,
) -> ORMAvatarUpload:
    upload.status = status
    upload.last_error = last_error
    if avatar_id is not None:
        upload.avatar_id = avatar_id
    if anima_id is not None:
        upload.anima_id = anima_id
    return upload


__all__ = [
    "UPLOAD_TYPE_AVATAR_VRM",
    "UPLOAD_TYPE_POCKET_VOICE_CATALOG",
    "AvatarUploadStatus",
    "STATUS_ABORTED",
    "STATUS_CLEANUP_PENDING",
    "STATUS_EXPIRED",
    "STATUS_FINALIZED",
    "STATUS_PENDING",
    "list_uploads_for_cleanup",
    "set_upload_status",
    "AvatarUploadType",
    "utcnow",
]
