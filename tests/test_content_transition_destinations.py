"""Content transitions must never replace or admit an operator's files by accident."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from sqlalchemy import delete

from animama.domain.content_catalog import ContentConflictError, ContentKind, ContentStatus
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services, vrma


def test_fresh_descriptor_destination_rejects_existing_files(async_session, tmp_path) -> None:
    paths, _, content, _, _ = package_services(async_session, tmp_path)
    original = {
        "schema_version": 1,
        "content_type": "reaction",
        "name": "Existing operator edit",
        "files": [],
        "dependencies": [],
        "placement_hint": {"emotion": "joy", "intensity": 2},
    }
    store = content.mutations.store
    store.save_descriptor_entry(
        kind=ContentKind.REACTION,
        relative_locator="reactions/occupied",
        descriptor=json.dumps(original).encode(),
        companion_files={},
    )
    before = (paths.local_root / "reactions/occupied/occupied.meta.json").read_bytes()
    with pytest.raises(ContentConflictError, match="content_destination_exists"):
        store.save_descriptor_entry(
            kind=ContentKind.REACTION,
            relative_locator="reactions/occupied",
            descriptor=json.dumps({**original, "name": "Attempted overwrite"}).encode(),
            companion_files={},
            require_new=True,
        )
    assert (paths.local_root / "reactions/occupied/occupied.meta.json").read_bytes() == before


async def test_rescan_ignores_a_local_idle_style_folder_left_by_an_older_version(async_session, tmp_path) -> None:
    """Idle Styles are retired: their old folder is neither admitted nor touched."""

    owner = f"leftover-{uuid4().hex}"
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    leftover = paths.local_root / "idle-styles/streamer-idle/streamer-idle.json"
    leftover.parent.mkdir(parents=True, exist_ok=True)
    leftover.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "content_type": "idle_style",
                "content_id": "local:idle-style:streamer-idle",
                "name": "Streamer Idle",
                "default_pool": ["local:gesture:sway"],
                "cells": {},
                "dependencies": [{"ref": "local:gesture:sway", "content_type": "gesture"}],
            }
        ),
        encoding="utf-8",
    )
    leftover_bytes = leftover.read_bytes()
    gesture = paths.local_root / "gestures/sway.vrma"
    gesture.parent.mkdir(parents=True, exist_ok=True)
    gesture.write_bytes(vrma("sway"))
    try:
        result = await content.rescan(user_id=owner)

        locators = {item.relative_locator: item for item in result.items}
        assert locators["gestures/sway.vrma"].status is ContentStatus.VALID
        assert not any(locator.startswith("idle-styles") for locator in locators)
        visible = await catalog.list_visible(user_id=owner)
        assert not any(item.relative_locator.startswith("idle-styles") for item in visible)
        assert leftover.read_bytes() == leftover_bytes
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == owner))
        await async_session.commit()
