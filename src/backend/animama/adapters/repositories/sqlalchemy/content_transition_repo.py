"""Retire Music equipment in the content mutation transaction."""

from __future__ import annotations

from copy import deepcopy
from itertools import groupby

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.app.ports.content_transition import MusicTransitionAnima, MusicTransitionBinding
from animama.domain.content_catalog import ContentConflictError
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMAnimaContentBinding


class SQLAlchemyContentTransitionBindings:
    """Share the caller's session; never commit a partial binding conversion."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._animas = SQLAlchemyAnimaRepository(session)

    @staticmethod
    def _music_snapshot(
        root: ORMAnimaLoadout, aggregate_revision: int, bindings: list[ORMAnimaContentBinding]
    ) -> MusicTransitionAnima:
        """Detach every original field before a transaction or JSONB edit can mutate it."""
        return MusicTransitionAnima(
            anima_id=root.anima_id,
            loadout_revision=root.revision,
            aggregate_revision=aggregate_revision,
            starter_catalog_version=root.starter_catalog_version,
            bindings=tuple(
                MusicTransitionBinding(
                    binding_id=binding.id,
                    slot_key=binding.slot_key,
                    catalog_item_id=binding.catalog_item_id,
                    kind=binding.kind,
                    config=deepcopy(binding.config),
                    created_at=binding.created_at.isoformat(),
                    updated_at=binding.updated_at.isoformat(),
                )
                for binding in bindings
            ),
        )

    async def music_consumers(self, *, user_id: str) -> tuple[MusicTransitionAnima, ...]:
        """Read owned Music equipment even if its source is missing or no longer admitted."""
        rows = (
            await self._session.execute(
                select(ORMAnimaLoadout, ORMAnima.aggregate_revision, ORMAnimaContentBinding)
                .join(ORMAnima, ORMAnima.id == ORMAnimaLoadout.anima_id)
                .join(ORMAnimaContentBinding, ORMAnimaContentBinding.anima_id == ORMAnimaLoadout.anima_id)
                .where(
                    ORMAnima.user_id == user_id,
                    ORMAnimaLoadout.owner_user_id == user_id,
                    ORMAnimaContentBinding.kind == "music_track",
                )
                .order_by(ORMAnimaLoadout.anima_id, ORMAnimaContentBinding.slot_key, ORMAnimaContentBinding.id)
                .execution_options(populate_existing=True)
            )
        ).all()
        result = []
        for _, group in groupby(rows, key=lambda row: row[0].anima_id):
            members = list(group)
            root, revision, _ = members[0]
            result.append(self._music_snapshot(root, revision, [row[2] for row in members]))
        return tuple(result)

    async def remove_music(self, *, user_id: str, before: MusicTransitionAnima) -> None:
        """Remove an exact Music set with one loadout and aggregate revision change."""
        if not before.bindings:
            return
        anima = await self._animas.lock_definition(
            user_id=user_id, anima_id=before.anima_id, expected_revision=before.aggregate_revision
        )
        root = await self._session.scalar(
            select(ORMAnimaLoadout)
            .where(ORMAnimaLoadout.anima_id == before.anima_id, ORMAnimaLoadout.owner_user_id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        bindings = list(
            (
                await self._session.scalars(
                    select(ORMAnimaContentBinding)
                    .where(
                        ORMAnimaContentBinding.anima_id == before.anima_id,
                        ORMAnimaContentBinding.kind == "music_track",
                    )
                    .order_by(ORMAnimaContentBinding.slot_key, ORMAnimaContentBinding.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).all()
        )
        if root is None or self._music_snapshot(root, anima.aggregate_revision, bindings) != before:
            raise ContentConflictError("content_transition_loadout_changed")
        for binding in bindings:
            await self._session.delete(binding)
        root.revision += 1
        await self._session.flush()
        await self._animas.record_definition_revision(
            user_id=user_id,
            anima_id=before.anima_id,
            expected_revision=before.aggregate_revision,
            reason="content_music_retirement",
        )
