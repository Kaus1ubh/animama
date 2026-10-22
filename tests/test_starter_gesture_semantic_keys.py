"""Starter Gestures bind under their declared semantic keys, while exclusions keep the starter id (#555).

A starter's id is the last segment of its content id (``wave-hello``); its
Gesture document may declare a different semantic key (``wave_hello``).
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import delete, select

from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.app.services.anima_runtime_service import AnimaRuntimeService
from animama.domain.content_catalog import ContentKind
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.typed_loadout_support import (
    LoadoutFixture,
    add_typed_item,
    catalog_source,
    cleanup_loadout_fixture,
    create_loadout_fixture,
)

GESTURE_IMPLEMENTATION = {"implementation": {"kind": "anima_clip", "file_role": "sequence"}}


async def _included_gesture(session, starter_id: str) -> ORMContentCatalogItem:  # noqa: ANN001
    """An Included starter Gesture whose declared semantic key differs from its id."""

    content_id = f"builtin:gesture:{starter_id}"
    item_id = f"gesture-{uuid4().hex}"
    item = ORMContentCatalogItem(
        id=item_id,
        source="included",
        scope="included",
        owner_user_id=None,
        kind="gesture",
        relative_locator=f"gestures/{item_id}",
        descriptor_relative_path=f"gestures/{item_id}/{item_id}.meta.json",
        logical_key=content_id,
        display_name=starter_id,
        status="valid",
        revision_sha256=uuid4().hex * 2,
        content_metadata={
            "schema_version": 1,
            "content_type": "gesture",
            "content_id": content_id,
            "name": starter_id,
            "semantic_key": starter_id.replace("-", "_"),
            **GESTURE_IMPLEMENTATION,
        },
        diagnostics=[],
        provenance={},
    )
    session.add(item)
    await session.commit()
    return item


async def _change(service: AnimaLoadoutService, fixture: LoadoutFixture, intent: dict[str, Any]) -> str:
    root = await service._root(user_id=fixture.user_id, anima_id=fixture.anima_id)
    plan = await service.plan(
        user_id=fixture.user_id,
        anima_id=fixture.anima_id,
        family="gesture",
        expected_revision=root.revision,
        intent=intent,
    )
    result = await service.commit(
        user_id=fixture.user_id,
        anima_id=fixture.anima_id,
        family="gesture",
        expected_revision=root.revision,
        intent=intent,
        plan_digest=plan.digest,
        idempotency_key=uuid4().hex,
    )
    return result.action


async def _exclusions(session, fixture: LoadoutFixture) -> list[dict[str, str]]:  # noqa: ANN001
    root = await session.scalar(
        select(ORMAnimaLoadout)
        .where(ORMAnimaLoadout.anima_id == fixture.anima_id)
        .execution_options(populate_existing=True)
    )
    assert root is not None
    return list(root.starter_exclusions)


@pytest.mark.asyncio
async def test_starter_gestures_use_declared_keys_and_id_form_exclusions(async_session, monkeypatch) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    wave_id, nod_id = f"wave-{fixture.suffix[:8]}", f"nod-{fixture.suffix[:8]}"
    wave_key, nod_key = wave_id.replace("-", "_"), nod_id.replace("-", "_")
    starters = [await _included_gesture(async_session, wave_id), await _included_gesture(async_session, nod_id)]
    policy = {"gestures": [{"content_id": starter.logical_key, "version": 1} for starter in starters]}
    monkeypatch.setattr("animama.app.services.anima_loadout_service.starter_loadout_policy", lambda version: policy)
    service = AnimaLoadoutService(async_session)
    try:
        loadout = await service.read_model(user_id=fixture.user_id, anima_id=fixture.anima_id)
        assert {(row.semantic_key, row.origin) for row in loadout.gestures} == {
            (wave_key, "starter"),
            (nod_key, "starter"),
        }

        # Clients disable a starter by the key its binding shows; the exclusion keeps the id form.
        assert await _change(service, fixture, {"operation": "disable_starter", "starter_id": wave_key}) == (
            "leave_empty"
        )
        assert await _exclusions(async_session, fixture) == [{"slot": "gesture", "runtime_id": wave_id}]
        loadout = await service.read_model(user_id=fixture.user_id, anima_id=fixture.anima_id)
        assert loadout.disabled_starter_gestures == (wave_id,)
        assert [row.semantic_key for row in loadout.gestures] == [nod_key]

        # Restore names the starter by the id the disabled list reports.
        assert await _change(service, fixture, {"operation": "restore_starter", "starter_id": wave_id}) == "revert"
        assert await _exclusions(async_session, fixture) == []

        # A Local Gesture declaring a starter's key replaces that starter and clears its exclusion.
        await _change(service, fixture, {"operation": "disable_starter", "starter_id": nod_id})
        local = await add_typed_item(
            async_session,
            fixture,
            kind="gesture",
            name="My Nod",
            metadata={"semantic_key": nod_key, **GESTURE_IMPLEMENTATION},
        )
        assert await _change(service, fixture, {"operation": "add", "source": catalog_source(local)}) == "add"
        assert await _exclusions(async_session, fixture) == []
        loadout = await service.read_model(user_id=fixture.user_id, anima_id=fixture.anima_id)
        assert sorted((row.semantic_key, row.origin) for row in loadout.gestures) == [
            (nod_key, "custom"),
            (wave_key, "starter"),
        ]
        assert loadout.warnings == ()

        # The runtime mount selects the same Gestures: the Local one occupies the starter's slot.
        root = await service._root(user_id=fixture.user_id, anima_id=fixture.anima_id)
        monkeypatch.setattr("animama.app.services.anima_runtime_service.starter_loadout_policy", lambda version: policy)
        runtime = AnimaRuntimeService(async_session)
        plan = await runtime._selections(
            anima_id=fixture.anima_id,
            loadout=root,
            visible=await runtime.catalog.list_visible(user_id=fixture.user_id),
        )
        gestures = {
            selection.slot_key: selection.catalog_item_id
            for selection in plan.roots
            if selection.kind is ContentKind.GESTURE
        }
        assert gestures == {f"gesture:{nod_key}": local.id, f"gesture:{wave_key}": starters[0].id}
    finally:
        await cleanup_loadout_fixture(async_session, fixture)
        await async_session.execute(
            delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([starter.id for starter in starters]))
        )
        await async_session.commit()
