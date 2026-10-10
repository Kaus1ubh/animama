"""SQLAlchemy AvatarRepository adapter."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.content_catalog import CatalogContentEntry, ContentKind, ContentSource, ContentStatus

from ....app.ports.avatar_port import AvatarRepository
from ....domain.avatar import Avatar, AvatarNameConflictError
from ....orm.anima import ORMAnima
from ....orm.avatar import ORMAvatar
from ...mappers.avatar_map import avatar_domain_to_orm, avatar_orm_to_domain
from .content_catalog_repo import SQLAlchemyContentCatalog


class SQLAlchemyAvatarRepository(AvatarRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, avatar_id: str, *, for_update: bool = False) -> Avatar | None:
        if for_update:
            orm = await self._s.get(ORMAvatar, avatar_id, with_for_update=True, populate_existing=True)
        else:
            orm = await self._s.get(ORMAvatar, avatar_id)
        if orm is None:
            return None
        return avatar_orm_to_domain(orm)

    async def get_by_catalog_item(self, catalog_item_id: str) -> Avatar | None:
        orm = (
            await self._s.execute(select(ORMAvatar).where(ORMAvatar.catalog_item_id == catalog_item_id))
        ).scalar_one_or_none()
        return avatar_orm_to_domain(orm) if orm is not None else None

    async def list_readable(self, user_id: str) -> list[Avatar]:
        result = await self._s.execute(
            select(ORMAvatar)
            .where(or_(ORMAvatar.private.is_(False), ORMAvatar.user_id == user_id))
            .order_by(ORMAvatar.name, ORMAvatar.id)
        )
        return [avatar_orm_to_domain(orm) for orm in result.scalars()]

    async def is_in_use(self, avatar_id: str) -> bool:
        used_by = await self._s.execute(select(ORMAnima.id).where(ORMAnima.avatar_id == avatar_id).limit(1))
        return used_by.scalar_one_or_none() is not None

    @asynccontextmanager
    async def _owner_name_unique(self) -> AsyncIterator[None]:
        # The database constraint is authoritative, so concurrent writes cannot race a pre-check.
        try:
            yield
        except IntegrityError as exc:
            if "uq_avatar_owner_name" in str(exc.orig):
                raise AvatarNameConflictError from exc
            raise

    async def create_owned(self, avatar: Avatar) -> Avatar:
        async with self._owner_name_unique():
            return await self.create(avatar)

    async def update_owned(self, avatar: Avatar) -> Avatar:
        async with self._owner_name_unique():
            return await self.update(avatar)

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
        owner_id = user_id if item.scope.value == "owner" else None
        # Avatar names are unique per owner, and ownerless rows share one
        # namespace (uq_avatar_owner_name is NULLS NOT DISTINCT). Live Anima
        # names are owner-defined, so disambiguation never changes them.
        name = item.display_name
        collision = select(ORMAvatar.id).where(
            ORMAvatar.name == name,
            ORMAvatar.user_id.is_not_distinct_from(owner_id),
        )
        if await self._s.scalar(collision) is not None:
            name = f"{name} ({avatar_id})"
        return await self.create(
            Avatar(
                id=avatar_id,
                name=name,
                file_path=item.relative_locator,
                user_id=owner_id,
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
