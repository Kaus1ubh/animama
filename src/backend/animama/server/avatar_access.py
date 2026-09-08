from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.avatar_repo import SQLAlchemyAvatarRepository
from animama.domain.request_principal import RequestPrincipal


def _normalize_avatar_id(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


async def validate_avatar_access(
    avatar_id: str | None,
    *,
    session: AsyncSession,
    user: RequestPrincipal,
) -> None:
    normalized_avatar_id = _normalize_avatar_id(avatar_id)
    if normalized_avatar_id is None:
        return

    repo = SQLAlchemyAvatarRepository(session)
    avatar = await repo.get(normalized_avatar_id)
    if avatar is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Avatar not found: {normalized_avatar_id}",
        )

    if avatar.private and avatar.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )


__all__ = ["validate_avatar_access"]
