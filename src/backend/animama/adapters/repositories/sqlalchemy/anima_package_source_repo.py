"""Owner-scoped raw Anima export facts; broken selections remain observable."""

from __future__ import annotations

import hashlib
from copy import deepcopy

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.ports.anima_package_source import SavedAnimaBinding, SavedAnimaPackageSource
from animama.domain.anima_definition import ANIMA_IDENTITY_PATH
from animama.domain.content_catalog import ContentConflictError
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.avatar import ORMAvatar
from animama.orm.content_catalog import ORMAnimaContentBinding
from animama.orm.memory_entry import ORMMemoryEntry

from .anima_repo import SQLAlchemyAnimaRepository


class SQLAlchemyAnimaPackageSourceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def read_owned(self, *, user_id: str, anima_id: str) -> SavedAnimaPackageSource:
        """Lock Anima before reading identity/loadout, matching definition writers."""
        anima = await SQLAlchemyAnimaRepository(self._session).lock_definition(user_id=user_id, anima_id=anima_id)
        identity = await self._session.scalar(
            select(ORMMemoryEntry)
            .where(
                ORMMemoryEntry.user_id == user_id,
                ORMMemoryEntry.anima_id == anima_id,
                ORMMemoryEntry.normalized_path == ANIMA_IDENTITY_PATH.casefold(),
                ORMMemoryEntry.type == "file",
                ORMMemoryEntry.deleted_at.is_(None),
            )
            .execution_options(populate_existing=True)
        )
        root = await self._session.scalar(
            select(ORMAnimaLoadout)
            .where(ORMAnimaLoadout.anima_id == anima_id, ORMAnimaLoadout.owner_user_id == user_id)
            .execution_options(populate_existing=True)
        )
        if identity is None or not identity.content or root is None:
            raise ContentConflictError("package_anima_definition_unavailable")
        avatar = (
            await self._session.scalar(
                select(ORMAvatar).where(ORMAvatar.id == anima.avatar.id).execution_options(populate_existing=True)
            )
            if anima.avatar is not None
            else None
        )
        bindings = (
            await self._session.scalars(
                select(ORMAnimaContentBinding)
                .where(ORMAnimaContentBinding.anima_id == anima_id)
                .order_by(ORMAnimaContentBinding.slot_key)
                .execution_options(populate_existing=True)
            )
        ).all()
        return SavedAnimaPackageSource(
            owner_user_id=user_id,
            anima_id=anima_id,
            display_name=anima.display_name,
            aggregate_revision=anima.aggregate_revision,
            identity_entry_id=identity.id,
            identity_version=identity.version,
            identity_sha256=hashlib.sha256(identity.content.encode()).hexdigest(),
            identity_markdown=identity.content,
            avatar_catalog_item_id=avatar.catalog_item_id if avatar else None,
            avatar_relative_locator=avatar.file_path if avatar else None,
            avatar_presentation_revision=avatar.presentation_revision if avatar else None,
            loadout_revision=root.revision,
            starter_catalog_version=root.starter_catalog_version,
            starter_exclusions=tuple(deepcopy(root.starter_exclusions)),
            idle_style_empty=root.idle_style_empty,
            bindings=tuple(
                SavedAnimaBinding(row.slot_key, row.kind, row.catalog_item_id, deepcopy(row.config)) for row in bindings
            ),
        )
