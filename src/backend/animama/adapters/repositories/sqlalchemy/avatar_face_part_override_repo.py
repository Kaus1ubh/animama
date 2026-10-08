"""SQLAlchemy storage for owner-scoped Avatar face-part overrides."""

from __future__ import annotations

from collections.abc import Collection
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.ports.avatar_face_parts import AvatarFacePartOverride
from animama.orm.avatar_face_part_override import ORMAvatarFacePartOverride


class SQLAlchemyAvatarFacePartOverrideRepository:
    """Always filters by the owner; the caller owns the transaction."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_items(
        self, *, owner_user_id: str, avatar_item_ids: Collection[str]
    ) -> dict[str, AvatarFacePartOverride]:
        if not avatar_item_ids:
            return {}
        rows = await self._session.scalars(
            select(ORMAvatarFacePartOverride).where(
                ORMAvatarFacePartOverride.owner_user_id == owner_user_id,
                ORMAvatarFacePartOverride.avatar_item_id.in_(list(avatar_item_ids)),
            )
        )
        return {
            row.avatar_item_id: AvatarFacePartOverride(
                avatar_item_id=row.avatar_item_id,
                avatar_revision_sha256=row.avatar_revision_sha256,
                parts=dict(row.parts),
            )
            for row in rows
        }

    async def upsert(
        self, *, owner_user_id: str, avatar_item_id: str, avatar_revision_sha256: str, parts: dict[str, Any]
    ) -> None:
        statement = insert(ORMAvatarFacePartOverride).values(
            owner_user_id=owner_user_id,
            avatar_item_id=avatar_item_id,
            avatar_revision_sha256=avatar_revision_sha256,
            parts=parts,
        )
        await self._session.execute(
            statement.on_conflict_do_update(
                index_elements=[ORMAvatarFacePartOverride.owner_user_id, ORMAvatarFacePartOverride.avatar_item_id],
                set_={
                    "avatar_revision_sha256": statement.excluded.avatar_revision_sha256,
                    "parts": statement.excluded.parts,
                    "updated_at": func.now(),
                },
            )
        )

    async def delete(self, *, owner_user_id: str, avatar_item_id: str) -> None:
        await self._session.execute(
            delete(ORMAvatarFacePartOverride).where(
                ORMAvatarFacePartOverride.owner_user_id == owner_user_id,
                ORMAvatarFacePartOverride.avatar_item_id == avatar_item_id,
            )
        )


__all__ = ["SQLAlchemyAvatarFacePartOverrideRepository"]
