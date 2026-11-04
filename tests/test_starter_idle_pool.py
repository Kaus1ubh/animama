from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import replace
from io import BytesIO

import pytest

from animama.app.services import starter_loadout_policy as policy_module
from animama.app.services.starter_loadout_policy import (
    resolve_starter_idle_pool,
    starter_idle_keys,
    starter_idle_pool,
    starter_loadout_policy,
)
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
    VerifiedContentFile,
)
from tests.content_package_helpers import anima_clip

CLIP = json.dumps(anima_clip(clip_id="idle", name="Idle", duration=2)).encode()
STREAMER_DEFAULT = {
    "builtin:gesture:chat-glance",
    "builtin:gesture:offscreen-look",
    "builtin:gesture:bgm-bob",
    "builtin:gesture:hmm-drift",
    "builtin:gesture:hair-tuck-settle",
    "builtin:gesture:bored-wait",
    "builtin:gesture:sleepy-nod-off",
}


def _gesture(key: str, *, config: dict[str, object] | None = None) -> CatalogContentEntry:
    item_id = str(uuid.uuid5(uuid.NAMESPACE_URL, key))
    name = key.rsplit(":", 1)[-1]
    return CatalogContentEntry(
        id=item_id,
        source=ContentSource.INCLUDED,
        scope=ContentScope.INCLUDED,
        owner_user_id=None,
        kind=ContentKind.GESTURE,
        relative_locator=f"gestures/{name}",
        display_name=name,
        status=ContentStatus.VALID,
        revision_sha256=hashlib.sha256(key.encode()).hexdigest(),
        logical_key=key,
        files=(
            CatalogContentFile(
                file_ref=f"{item_id}:clip",
                item_id=item_id,
                source=ContentSource.INCLUDED,
                relative_path=f"gestures/{name}/{name}.json",
                role="sequence",
                media_type="application/json",
                size_bytes=len(CLIP),
                sha256=hashlib.sha256(CLIP).hexdigest(),
            ),
        ),
        metadata={
            "schema_version": 1,
            "content_type": "gesture",
            "name": name,
            "semantic_key": name,
            "implementation": {"kind": "anima_clip", "file_role": "sequence"},
            "config": config or {},
        },
    )


class _Store:
    def open_verified_file(self, **facts):
        return VerifiedContentFile(BytesIO(CLIP), len(CLIP), facts["expected_sha256"], facts["media_type"])


def _seed_keys(*, mixamo: bool) -> set[str]:
    keys = set(starter_idle_keys())
    return {key for key in keys if mixamo or ":mixamo-" not in key}


def _cells(members) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for member in members:
        result.setdefault(member.cell, set()).add(member.source.logical_key)
    return result


@pytest.mark.asyncio
async def test_without_the_mixamo_pack_the_seed_is_exactly_streamer_idle() -> None:
    visible = {item.id: item for item in map(_gesture, sorted(_seed_keys(mixamo=False)))}

    cells = _cells(await resolve_starter_idle_pool(visible=visible, store=_Store()))  # type: ignore[arg-type]

    assert cells.pop("default") == STREAMER_DEFAULT
    # Streamer Idle adds one Moderate cell for each of 22 emotions; Strong inherits it.
    assert len(cells) == 22
    assert cells["joy-2"] == {"builtin:gesture:happy-sway"}
    assert "joy-1" not in cells and "joy-3" not in cells and "respect-2" not in cells
    assert not any(":mixamo-" in key for keys in cells.values() for key in keys)


@pytest.mark.asyncio
async def test_mixamo_idles_join_only_the_cells_emotive_idle_mapped() -> None:
    visible = {item.id: item for item in map(_gesture, sorted(_seed_keys(mixamo=True)))}

    cells = _cells(await resolve_starter_idle_pool(visible=visible, store=_Store()))  # type: ignore[arg-type]

    assert cells.pop("default") == STREAMER_DEFAULT
    # Each Mixamo idle sits in its Mild cell; Moderate and Strong inherit it.
    assert len(cells) == 34
    assert cells["joy-1"] == {"builtin:gesture:mixamo-idle-happy"}
    assert cells["joy-2"] == {"builtin:gesture:happy-sway"}
    assert cells["anger-1"] == {"builtin:gesture:mixamo-idle-angry"}
    assert all(":mixamo-" in key for cell, keys in cells.items() if cell.endswith("-1") for key in keys)
    happy = {cell for cell, keys in cells.items() if "builtin:gesture:mixamo-idle-happy" in keys}
    assert {cell.rpartition("-")[0] for cell in happy} == {"amusement", "excitement", "joy", "optimism"}
    assert cells["disgust-2"] == {"builtin:gesture:simmering-huff"}


@pytest.mark.asyncio
async def test_unavailable_or_ineligible_seed_gestures_are_left_out() -> None:
    entries = [_gesture(key) for key in sorted(_seed_keys(mixamo=False)) if key != "builtin:gesture:bgm-bob"]
    # A looping clip without a finite repetition count cannot idle.
    entries = [
        replace(item, metadata={**item.metadata, "config": {"loop": True}})
        if item.logical_key == "builtin:gesture:happy-sway"
        else item
        for item in entries
    ]
    visible = {item.id: item for item in entries}

    cells = _cells(await resolve_starter_idle_pool(visible=visible, store=_Store()))  # type: ignore[arg-type]

    assert cells.pop("default") == STREAMER_DEFAULT - {"builtin:gesture:bgm-bob"}
    # Cells that only held the ineligible Gesture add nothing to Default.
    assert "joy-2" not in cells
    assert cells["anger-2"] == {"builtin:gesture:simmering-huff"}


def test_the_idle_seed_is_part_of_the_starter_loadout() -> None:
    policy = starter_loadout_policy()
    pools = starter_idle_pool()

    assert policy["schema_version"] == 2
    assert policy["version"] == 1
    assert next(iter(pools)) == "default"
    assert set(pools["default"]) == STREAMER_DEFAULT
    assert pools["joy-1"] == ("builtin:gesture:mixamo-idle-happy",)
    assert pools["disappointment-1"] == ("builtin:gesture:mixamo-idle-bored", "builtin:gesture:mixamo-idle-sad")
    assert set(starter_idle_keys()) == {key for keys in pools.values() for key in keys}


@pytest.mark.parametrize(
    ("cells", "message"),
    [
        ({"joy": {"4": ["builtin:gesture:happy-sway"]}}, "Invalid starter Idle cell"),
        ({"wonder": {"2": ["builtin:gesture:happy-sway"]}}, "Invalid starter Idle cell"),
        ({"joy": {"2": ["builtin:gesture:happy-sway", "builtin:gesture:happy-sway"]}}, "repeats a Gesture"),
    ],
)
def test_a_malformed_idle_seed_fails_clearly(monkeypatch: pytest.MonkeyPatch, cells: object, message: str) -> None:
    policy = {**starter_loadout_policy(), "idle": {"default": [], "cells": cells}}
    monkeypatch.setattr(policy_module, "starter_loadout_policy", lambda version=1: policy)

    with pytest.raises(ValueError, match=message):
        starter_idle_pool()
