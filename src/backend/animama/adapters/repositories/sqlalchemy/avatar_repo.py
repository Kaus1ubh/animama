"""SQLAlchemy AvatarRepository adapter."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.content_catalog import CatalogContentEntry, ContentKind, ContentSource, ContentStatus

from ....app.ports.avatar_port import AvatarRepository
from ....domain.avatar import Avatar
from ....orm.avatar import ORMAvatar
from ...mappers.avatar_map import avatar_domain_to_orm, avatar_orm_to_domain
from .content_catalog_repo import SQLAlchemyContentCatalog


class SQLAlchemyAvatarRepository(AvatarRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, avatar_id: str) -> Avatar | None:
        orm = await self._s.get(ORMAvatar, avatar_id)
        if orm is None:
            return None
        return avatar_orm_to_domain(orm)

    async def resolve_catalog_avatar(self, *, user_id: str, item: CatalogContentEntry) -> Avatar:
        """Serialize mapping/retention against the selected catalog parent row."""

        current = await SQLAlchemyContentCatalog(self._s).get_visible_item(
            item_id=item.id,
            user_id=user_id,
            for_update=True,
        )
        if current is None or current.kind is not ContentKind.AVATAR or current.status is not ContentStatus.VALID:
            raise AnimaDefinitionError("avatar_content_unavailable")
        if current.revision_sha256 != item.revision_sha256:
            raise AnimaDefinitionError("avatar_content_stale")
        existing = (
            await self._s.execute(select(ORMAvatar).where(ORMAvatar.catalog_item_id == item.id))
        ).scalar_one_or_none()
        if existing is None and item.source is ContentSource.INCLUDED:
            candidates = list(
                (
                    await self._s.execute(
                        select(ORMAvatar)
                        .where(
                            ORMAvatar.catalog_item_id.is_(None),
                            ORMAvatar.private.is_(False),
                            ORMAvatar.file_path.in_([item.relative_locator, f"/shared/{item.relative_locator}"]),
                        )
                        .with_for_update()
                    )
                ).scalars()
            )
            if len(candidates) == 1:
                existing = candidates[0]
                existing.catalog_item_id = item.id
        if existing is not None:
            if existing.private and existing.user_id != user_id:
                raise AnimaDefinitionError("avatar_content_unavailable")
            await self._s.flush()
            # Linking a seeded Avatar expires its server-updated timestamp.
            # Resolve it asynchronously before the synchronous domain mapper.
            await self._s.refresh(existing)
            return avatar_orm_to_domain(existing)
        avatar_id = f"avatar-{uuid4().hex}"
        # Avatar names are globally unique; live Anima names are owner-defined.
        # Disambiguation here never changes the requested live display name.
        name = item.display_name
        if await self._s.scalar(select(ORMAvatar.id).where(ORMAvatar.name == name)) is not None:
            name = f"{name} ({avatar_id})"
        return await self.create(
            Avatar(
                id=avatar_id,
                name=name,
                file_path=item.relative_locator,
                user_id=user_id if item.scope.value == "owner" else None,
                private=item.scope.value == "owner",
                catalog_item_id=item.id,
                created_by_id=user_id,
                last_updated_by_id=user_id,
            )
        )

    async def list(self, user_id: str | None = None, include_public: bool = True) -> list[Avatar]:
        stmt = select(ORMAvatar)
        if user_id is not None:
            if include_public:
                # Include public avatars OR avatars owned by this user
                stmt = stmt.where(or_(ORMAvatar.user_id == user_id, ORMAvatar.private == False))  # noqa: E712
            else:
                # Only avatars owned by this user
                stmt = stmt.where(ORMAvatar.user_id == user_id)
        elif include_public:
            # Only public avatars
            stmt = stmt.where(ORMAvatar.private == False)  # noqa: E712
        else:
            # No user_id and not including public - return empty list
            # (can't show private avatars without knowing whose)
            return []

        result = await self._s.execute(stmt)
        return [avatar_orm_to_domain(orm) for orm in result.scalars()]

    async def create(self, avatar: Avatar) -> Avatar:
        orm = avatar_domain_to_orm(avatar)
        self._s.add(orm)
        await self._s.flush()
        await self._s.refresh(orm)
        return avatar_orm_to_domain(orm)

    async def update(self, avatar: Avatar) -> Avatar:
        orm = await self._s.get(ORMAvatar, avatar.id)
        if orm is None:
            return await self.create(avatar)

        orm.name = avatar.name
        orm.file_path = avatar.file_path
        orm.identity = avatar.identity
        orm.user_id = avatar.user_id
        orm.model_type = avatar.model_type
        orm.animation_profile = avatar.animation_profile
        orm.private = avatar.private
        orm.catalog_item_id = avatar.catalog_item_id
        orm.presentation_revision = avatar.presentation_revision
        orm.created_by_id = avatar.created_by_id
        orm.last_updated_by_id = avatar.last_updated_by_id
        await self._s.flush()
        await self._s.refresh(orm)
        return avatar_orm_to_domain(orm)

    async def delete(self, avatar_id: str) -> bool:
        orm = await self._s.get(ORMAvatar, avatar_id)
        if orm is None:
            return False
        await self._s.delete(orm)
        await self._s.flush()
        return True
