"""Preserve legacy equipment selections in the content mutation transaction."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.app.ports.content_transition import IdleTransitionBinding
from animama.domain.content_catalog import ContentConflictError, ContentKind
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMAnimaContentBinding


class SQLAlchemyContentTransitionBindings:
    """Share the caller's session; never commit a partial binding conversion."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._animas = SQLAlchemyAnimaRepository(session)

    async def idle_consumers(
        self, *, user_id: str, item_id: str, is_starter: bool
    ) -> tuple[IdleTransitionBinding, ...]:
        """Snapshot explicit users and nonempty implicit starter selections."""

        statement = (
            select(ORMAnimaLoadout, ORMAnima.aggregate_revision, ORMAnimaContentBinding)
            .join(ORMAnima, ORMAnima.id == ORMAnimaLoadout.anima_id)
            .outerjoin(
                ORMAnimaContentBinding,
                (ORMAnimaContentBinding.anima_id == ORMAnimaLoadout.anima_id)
                & (ORMAnimaContentBinding.slot_key == "idle-style"),
            )
            .where(ORMAnimaLoadout.owner_user_id == user_id, ORMAnima.user_id == user_id)
            .order_by(ORMAnimaLoadout.anima_id)
            .execution_options(populate_existing=True)
        )
        result = []
        for root, revision, binding in (await self._session.execute(statement)).all():
            if binding is not None:
                if binding.catalog_item_id != item_id:
                    continue
            elif not is_starter or root.idle_style_empty:
                continue
            result.append(
                IdleTransitionBinding(
                    anima_id=root.anima_id,
                    loadout_revision=root.revision,
                    aggregate_revision=revision,
                    binding_id=binding.id if binding is not None else None,
                    config=dict(binding.config) if binding is not None else {},
                )
            )
        return tuple(result)

    async def replace_idle(self, *, user_id: str, before: IdleTransitionBinding, item_id: str) -> None:
        """Recheck the aggregate before preserving its selection without overrides."""

        await self._animas.lock_definition(
            user_id=user_id, anima_id=before.anima_id, expected_revision=before.aggregate_revision
        )
        root = await self._session.scalar(
            select(ORMAnimaLoadout)
            .where(ORMAnimaLoadout.anima_id == before.anima_id, ORMAnimaLoadout.owner_user_id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if root is None or root.revision != before.loadout_revision:
            raise ContentConflictError("content_transition_loadout_changed")
        binding = await self._session.scalar(
            select(ORMAnimaContentBinding)
            .where(
                ORMAnimaContentBinding.anima_id == before.anima_id,
                ORMAnimaContentBinding.slot_key == "idle-style",
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if (binding.id if binding is not None else None) != before.binding_id:
            raise ContentConflictError("content_transition_loadout_changed")
        if binding is not None and binding.config != before.config:
            raise ContentConflictError("content_transition_loadout_changed")
        if binding is None:
            if root.idle_style_empty:
                raise ContentConflictError("content_transition_loadout_changed")
            binding = ORMAnimaContentBinding(
                id=str(uuid4()), anima_id=before.anima_id, slot_key="idle-style", kind=ContentKind.IDLE_STYLE.value
            )
            self._session.add(binding)
        binding.catalog_item_id = item_id
        binding.config = {}
        root.revision += 1
        await self._session.flush()
        await self._animas.record_definition_revision(
            user_id=user_id,
            anima_id=before.anima_id,
            expected_revision=before.aggregate_revision,
            reason="content_idle_style_conversion",
        )
