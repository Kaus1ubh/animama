"""An Anima's Gestures are exactly its binding rows; the starter policy is only a creation template (#648).

A starter Gesture's id is the last segment of its content id (``wave-1a2b``);
its Gesture document may declare a different semantic key (``wave_1a2b``),
which is the key its row, the runtime root and the package use.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from unittest.mock import Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, select, update

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.contracts.anima_loadout import PyGestureIntent
from animama.app.services import anima_loadout_service
from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.app.services.anima_runtime_service import AnimaRuntimeService
from animama.domain.anima_creation import ResolvedGestureSelection
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMAnimaContentBinding, ORMContentCatalogItem
from tests.test_portable_anima import saved_anima, source_service  # noqa: F401
from tests.typed_loadout_support import LoadoutFixture, add_typed_item

IMPLEMENTATION = {"implementation": {"kind": "anima_clip", "file_role": "sequence"}}


async def _included_gesture(session, user_id: str, name: str) -> ORMContentCatalogItem:  # noqa: ANN001
    """An Included starter Gesture whose declared semantic key differs from its id."""

    starter_id = f"{name}-{uuid4().hex[:8]}"
    row = await add_typed_item(
        session,
        LoadoutFixture(user_id, "", "", ""),
        kind="gesture",
        name=name,
        metadata={
            "content_id": f"builtin:gesture:{starter_id}",
            "semantic_key": starter_id.replace("-", "_"),
            **IMPLEMENTATION,
        },
    )
    await session.execute(
        update(ORMContentCatalogItem)
        .where(ORMContentCatalogItem.id == row.id)
        .values(source="included", scope="included", owner_user_id=None)
    )
    await session.commit()
    return row


async def _cleanup(session, user_id: str, item_ids: list[str]) -> None:  # noqa: ANN001
    """Delete the owner's Animas first: their rows still reference the Included Gestures."""

    await session.rollback()
    await session.execute(delete(ORMAnima).where(ORMAnima.user_id == user_id))
    await session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_(item_ids)))
    await session.commit()


def _key(item: ORMContentCatalogItem) -> str:
    return str(item.content_metadata["semantic_key"])


async def _starter_loadout(session, monkeypatch, user_id: str, anima_id: str, content_ids: list[str]):  # noqa: ANN001, ANN202
    """Replace the Anima's loadout with the starter loadout of ``content_ids``, committed."""

    monkeypatch.setattr(anima_loadout_service, "starter_gestures", lambda version: tuple(content_ids))

    async def no_idle(**_: object) -> tuple[()]:
        return ()

    monkeypatch.setattr(anima_loadout_service, "resolve_starter_idle_pool", no_idle)
    await session.execute(delete(ORMAnimaLoadout).where(ORMAnimaLoadout.anima_id == anima_id))
    await session.commit()
    diagnostics = await AnimaLoadoutService(session).create_starter_loadout(
        user_id=user_id, anima_id=anima_id, store=Mock()
    )
    await session.commit()
    return diagnostics


async def _gesture_rows(session, anima_id: str) -> dict[str, tuple[str, dict[str, Any]]]:  # noqa: ANN001
    rows = await session.execute(
        select(ORMAnimaContentBinding).where(
            ORMAnimaContentBinding.anima_id == anima_id, ORMAnimaContentBinding.slot_key.startswith("gesture:")
        )
    )
    return {row.slot_key: (row.catalog_item_id, dict(row.config)) for row in rows.scalars()}


async def _readers(session, user_id: str, anima_id: str) -> dict[str, dict[str, str]]:  # noqa: ANN001
    """Every AI-callable Gesture the read model, runtime mount and package export each list, by semantic key.

    Nothing is filtered, so an implied Gesture (even an unresolved one) would show.
    """

    loadout = await AnimaLoadoutService(session).read_model(user_id=user_id, anima_id=anima_id)
    runtime = AnimaRuntimeService(session)
    plan = await runtime._selections(anima_id=anima_id, visible=await runtime.catalog.list_visible(user_id=user_id))
    projection = await source_service(session).capture(user_id=user_id, anima_id=anima_id)
    return {
        "read_model": {row.semantic_key: row.source.catalog_item_id for row in loadout.gestures},
        # Idle members are Gesture roots too, under ``idle:`` slots; only ``gesture:`` roots are AI-callable.
        "runtime": {
            selection.slot_key.removeprefix("gesture:"): selection.catalog_item_id
            for selection in plan.roots
            if selection.slot_key.startswith("gesture:")
        },
        "export": {selection.semantic_key: selection.entry_id for selection in projection.definition.gestures},
    }


async def _remove(session, user_id: str, anima_id: str, item_id: str) -> None:  # noqa: ANN001
    service = AnimaLoadoutService(session)
    loadout = await service.read_model(user_id=user_id, anima_id=anima_id)
    binding = next(row for row in loadout.gestures if row.source.catalog_item_id == item_id)
    intent = {"operation": "remove", "binding_id": binding.binding_id}
    plan = await service.plan(
        user_id=user_id, anima_id=anima_id, family="gesture", expected_revision=loadout.revision, intent=intent
    )
    result = await service.commit(
        user_id=user_id,
        anima_id=anima_id,
        family="gesture",
        expected_revision=loadout.revision,
        intent=intent,
        plan_digest=plan.digest,
        idempotency_key=uuid4().hex,
    )
    assert result.action == "remove"


@pytest.mark.asyncio
async def test_the_starter_loadout_writes_each_available_starter_gesture_as_a_row(
    async_session,
    saved_anima,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture, anima = saved_anima
    wave = await _included_gesture(async_session, fixture.user_id, "wave")
    nod = await _included_gesture(async_session, fixture.user_id, "nod")
    missing = f"builtin:gesture:missing-{uuid4().hex[:8]}"
    try:
        diagnostics = await _starter_loadout(
            async_session,
            monkeypatch,
            fixture.user_id,
            anima.id,
            [str(wave.logical_key), missing, str(nod.logical_key)],
        )
        # Each row uses the key its document declares, not the starter id.
        assert await _gesture_rows(async_session, anima.id) == {
            f"gesture:{_key(wave)}": (wave.id, {}),
            f"gesture:{_key(nod)}": (nod.id, {}),
        }
        # An unavailable starter is left out and reported.
        assert [
            (diagnostic.scope, dict(diagnostic.params))
            for diagnostic in diagnostics
            if diagnostic.code == "starter_gesture_unavailable"
        ] == [("source", {"contentId": missing})]
    finally:
        await _cleanup(async_session, fixture.user_id, [wave.id, nod.id])


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["created", "starter_loadout"])
async def test_readers_list_exactly_the_rows_and_a_removed_gesture_stays_removed(
    async_session,
    saved_anima,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    fixture, anima = saved_anima
    wave = await _included_gesture(async_session, fixture.user_id, "wave")
    nod = await _included_gesture(async_session, fixture.user_id, "nod")
    try:
        if path == "created":
            catalog = SQLAlchemyContentCatalog(async_session)
            sources = [await catalog.get_visible_item(item_id=item.id, user_id=fixture.user_id) for item in (wave, nod)]
            spec = replace(
                fixture.spec,
                display_name="Created",
                gestures=tuple(ResolvedGestureSelection(source) for source in sources if source is not None),
            )
            uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
            anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=spec, uow=uow)
            await uow.commit()
        else:
            await _starter_loadout(
                async_session, monkeypatch, fixture.user_id, anima.id, [str(wave.logical_key), str(nod.logical_key)]
            )
        both = {_key(wave): wave.id, _key(nod): nod.id}
        assert await _readers(async_session, fixture.user_id, anima.id) == {
            "read_model": both,
            "runtime": both,
            "export": both,
        }

        await _remove(async_session, fixture.user_id, anima.id, wave.id)
        remaining = {_key(nod): nod.id}
        assert await _readers(async_session, fixture.user_id, anima.id) == {
            "read_model": remaining,
            "runtime": remaining,
            "export": remaining,
        }
    finally:
        await _cleanup(async_session, fixture.user_id, [wave.id, nod.id])


@pytest.mark.parametrize("operation", ["disable_starter", "restore_starter"])
def test_the_retired_starter_gesture_operations_are_rejected(operation: str) -> None:
    with pytest.raises(ValidationError):
        PyGestureIntent.model_validate({"operation": operation})
