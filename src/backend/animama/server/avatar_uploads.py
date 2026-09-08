from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from sqlalchemy import asc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.orm import ORMAvatarUpload

AvatarUploadStatus = Literal["pending", "finalized", "aborted", "expired", "cleanup_pending"]
AvatarUploadType = Literal["avatar_vrm", "pocket_voice_catalog"]

STATUS_PENDING: AvatarUploadStatus = "pending"
STATUS_FINALIZED: AvatarUploadStatus = "finalized"
STATUS_ABORTED: AvatarUploadStatus = "aborted"
STATUS_EXPIRED: AvatarUploadStatus = "expired"
STATUS_CLEANUP_PENDING: AvatarUploadStatus = "cleanup_pending"
UPLOAD_TYPE_AVATAR_VRM: AvatarUploadType = "avatar_vrm"
UPLOAD_TYPE_POCKET_VOICE_CATALOG: AvatarUploadType = "pocket_voice_catalog"


def new_avatar_upload_id() -> str:
    return f"upload-{uuid4().hex}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def create_pending_avatar_upload(
    session: AsyncSession,
    *,
    user_id: str,
    storage_locator: str,
    original_filename: str,
    declared_content_type: str | None,
    declared_size_bytes: int,
    expires_at: datetime,
    upload_type: AvatarUploadType = UPLOAD_TYPE_AVATAR_VRM,
) -> ORMAvatarUpload:
    upload = ORMAvatarUpload(
        id=new_avatar_upload_id(),
        user_id=user_id,
        storage_locator=storage_locator,
        original_filename=original_filename,
        declared_content_type=declared_content_type,
        declared_size_bytes=declared_size_bytes,
        upload_type=upload_type,
        status=STATUS_PENDING,
        expires_at=expires_at,
    )
    session.add(upload)
    await session.flush()
    await session.refresh(upload)
    return upload


async def get_user_avatar_upload(
    session: AsyncSession,
    *,
    upload_id: str,
    user_id: str,
    upload_type: AvatarUploadType = UPLOAD_TYPE_AVATAR_VRM,
) -> ORMAvatarUpload | None:
    result = await session.execute(
        select(ORMAvatarUpload).where(
            ORMAvatarUpload.id == upload_id,
            ORMAvatarUpload.user_id == user_id,
            ORMAvatarUpload.upload_type == upload_type,
        )
    )
    return result.scalar_one_or_none()


async def get_user_avatar_upload_for_update(
    session: AsyncSession,
    *,
    upload_id: str,
    user_id: str,
    upload_type: AvatarUploadType = UPLOAD_TYPE_AVATAR_VRM,
) -> ORMAvatarUpload | None:
    result = await session.execute(
        select(ORMAvatarUpload)
        .where(
            ORMAvatarUpload.id == upload_id,
            ORMAvatarUpload.user_id == user_id,
            ORMAvatarUpload.upload_type == upload_type,
        )
        .with_for_update()
    )
    return result.scalar_one_or_none()


async def create_pending_anima_voice_catalog_upload(
    session: AsyncSession,
    *,
    user_id: str,
    storage_locator: str,
    original_filename: str,
    declared_content_type: str | None,
    declared_size_bytes: int,
    expires_at: datetime,
) -> ORMAvatarUpload:
    return await create_pending_avatar_upload(
        session,
        user_id=user_id,
        storage_locator=storage_locator,
        original_filename=original_filename,
        declared_content_type=declared_content_type,
        declared_size_bytes=declared_size_bytes,
        expires_at=expires_at,
        upload_type=UPLOAD_TYPE_POCKET_VOICE_CATALOG,
    )


async def get_user_anima_voice_catalog_upload(
    session: AsyncSession,
    *,
    upload_id: str,
    user_id: str,
) -> ORMAvatarUpload | None:
    return await get_user_avatar_upload(
        session,
        upload_id=upload_id,
        user_id=user_id,
        upload_type=UPLOAD_TYPE_POCKET_VOICE_CATALOG,
    )


async def get_user_anima_voice_catalog_upload_for_update(
    session: AsyncSession,
    *,
    upload_id: str,
    user_id: str,
) -> ORMAvatarUpload | None:
    return await get_user_avatar_upload_for_update(
        session,
        upload_id=upload_id,
        user_id=user_id,
        upload_type=UPLOAD_TYPE_POCKET_VOICE_CATALOG,
    )


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
    "create_pending_avatar_upload",
    "create_pending_anima_voice_catalog_upload",
    "get_user_avatar_upload",
    "get_user_avatar_upload_for_update",
    "get_user_anima_voice_catalog_upload",
    "get_user_anima_voice_catalog_upload_for_update",
    "list_uploads_for_cleanup",
    "set_upload_status",
    "AvatarUploadType",
    "utcnow",
]
