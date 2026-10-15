"""Preserve legacy equipment selections in the content mutation transaction."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from itertools import groupby
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.app.ports.content_transition import (
    ContentTransitionAnima,
    ContentTransitionBinding,
    ContentTransitionSelection,
    MusicTransitionAnima,
    MusicTransitionBinding,
)
from animama.app.services.starter_loadout_policy import starter_loadout_policy
from animama.domain.content_catalog import ContentConflictError
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMAnimaContentBinding


class SQLAlchemyContentTransitionBindings:
    """Share the caller's session; never commit a partial binding conversion."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._animas = SQLAlchemyAnimaRepository(session)

    async def content_consumers(
        self, *, user_id: str, item_ids: tuple[str, ...], included_by_logical: Mapping[str, str]
    ) -> tuple[ContentTransitionAnima, ...]:
        """Snapshot affected explicit and implicit Action consumers, including Idle members, by Anima."""
        if not item_ids:
            return ()
        affected = set(item_ids)
        rows = (
            await self._session.execute(
                select(ORMAnimaLoadout, ORMAnima.aggregate_revision, ORMAnimaContentBinding)
                .join(ORMAnima, ORMAnima.id == ORMAnimaLoadout.anima_id)
                .outerjoin(ORMAnimaContentBinding, ORMAnimaContentBinding.anima_id == ORMAnimaLoadout.anima_id)
                .where(ORMAnima.user_id == user_id, ORMAnimaLoadout.owner_user_id == user_id)
                .order_by(ORMAnimaLoadout.anima_id, ORMAnimaContentBinding.slot_key, ORMAnimaContentBinding.id)
                .execution_options(populate_existing=True)
            )
        ).all()
        results = []
        for _, group in groupby(rows, key=lambda row: row[0].anima_id):
            members = list(group)
            root, revision, _ = members[0]
            bindings = self._content_bindings([row[2] for row in members if row[2] is not None])
            selections = self._content_selections(root, bindings, affected, included_by_logical)
            if selections:
                results.append(self._content_snapshot(root, revision, bindings, selections))
        return tuple(results)

    @staticmethod
    def _content_bindings(bindings: list[ORMAnimaContentBinding]) -> tuple[ContentTransitionBinding, ...]:
        """Retain every row so occupied slots and unrelated edits remain fenced."""
        return tuple(
            ContentTransitionBinding(
                binding.id,
                binding.slot_key,
                binding.catalog_item_id,
                binding.kind,
                deepcopy(binding.config),
                binding.created_at.isoformat(),
                binding.updated_at.isoformat(),
            )
            for binding in bindings
        )

    @staticmethod
    def _content_snapshot(
        root: ORMAnimaLoadout,
        revision: int,
        bindings: tuple[ContentTransitionBinding, ...],
        selections: tuple[ContentTransitionSelection, ...],
    ) -> ContentTransitionAnima:
        return ContentTransitionAnima(
            root.anima_id,
            root.revision,
            revision,
            root.starter_catalog_version,
            tuple(deepcopy(root.starter_exclusions)),
            bindings,
            selections,
        )

    @staticmethod
    def _content_selections(
        root: ORMAnimaLoadout,
        bindings: tuple[ContentTransitionBinding, ...],
        affected: set[str],
        included_by_logical: Mapping[str, str],
    ) -> tuple[ContentTransitionSelection, ...]:
        selections = [
            ContentTransitionSelection(
                binding.slot_key,
                binding.kind,
                binding.catalog_item_id,
                binding.binding_id,
                deepcopy(binding.config),
            )
            for binding in bindings
            if binding.catalog_item_id in affected and binding.kind in {"gesture", "reaction"}
        ]
        occupied = {binding.slot_key for binding in bindings}
        excluded = {
            (value.get("slot"), value.get("runtime_id")) for value in root.starter_exclusions if isinstance(value, dict)
        }

        def implicit(kind: str, slot: str, content_id: str, version: int | None) -> None:
            item_id = included_by_logical.get(content_id)
            if slot in occupied or item_id not in affected:
                return
            assert item_id is not None
            selections.append(ContentTransitionSelection(slot, kind, item_id, None, {}, content_id, version))

        policy = starter_loadout_policy(root.starter_catalog_version)
        for starter in policy["gestures"]:
            content_id = str(starter["content_id"])
            semantic = content_id.rsplit(":", 1)[-1]
            if ("gesture", semantic) not in excluded:
                implicit("gesture", f"gesture:{semantic}", content_id, int(starter["version"]))
        for starter in policy["reactions"]:
            cell = f"{starter['emotion']}-{starter['intensity']}"
            if ("reaction", cell) not in excluded:
                implicit("reaction", f"reaction:{cell}", str(starter["content_id"]), int(starter["version"]))
        return tuple(sorted(selections, key=lambda selection: selection.slot_key))

    async def replace_content(
        self, *, user_id: str, before: ContentTransitionAnima, replacements: Mapping[str, str]
    ) -> None:
        """Recheck the complete equipment snapshot and replace its affected selections once."""
        if not before.selections:
            return
        if any(selection.catalog_item_id not in replacements for selection in before.selections):
            raise ContentConflictError("content_transition_target_missing")
        anima = await self._animas.lock_definition(
            user_id=user_id, anima_id=before.anima_id, expected_revision=before.aggregate_revision
        )
        root = await self._session.scalar(
            select(ORMAnimaLoadout)
            .where(ORMAnimaLoadout.anima_id == before.anima_id, ORMAnimaLoadout.owner_user_id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        rows = list(
            (
                await self._session.scalars(
                    select(ORMAnimaContentBinding)
                    .where(ORMAnimaContentBinding.anima_id == before.anima_id)
                    .order_by(ORMAnimaContentBinding.slot_key, ORMAnimaContentBinding.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).all()
        )
        if (
            root is None
            or self._content_snapshot(root, anima.aggregate_revision, self._content_bindings(rows), before.selections)
            != before
        ):
            raise ContentConflictError("content_transition_loadout_changed")
        by_id = {row.id: row for row in rows}
        for selection in before.selections:
            replacement = replacements[selection.catalog_item_id]
            if selection.binding_id is None:
                self._session.add(
                    ORMAnimaContentBinding(
                        id=str(uuid4()),
                        anima_id=before.anima_id,
                        slot_key=selection.slot_key,
                        kind=selection.kind,
                        catalog_item_id=replacement,
                        config=deepcopy(selection.config),
                    )
                )
            else:
                by_id[selection.binding_id].catalog_item_id = replacement
        root.revision += 1
        await self._session.flush()
        await self._animas.record_definition_revision(
            user_id=user_id,
            anima_id=before.anima_id,
            expected_revision=before.aggregate_revision,
            reason="content_included_copy_conversion",
        )

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
            starter_exclusions=tuple(deepcopy(root.starter_exclusions)),
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
