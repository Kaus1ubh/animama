"""The Idle pool seeded into every newly created Anima.

``starter-idle-pool.v1.json`` holds the reviewed seed by logical key: Streamer
Idle's Default and cells, plus the Mixamo idles in the cells Emotive Idle mapped
them to. Each cell lists only what it adds: playback always mixes in Default and
inherits an emotion's lower intensities. Seeding keeps only Included Gestures
that are installed and eligible for finite idle playback, so an installation
without the Mixamo pack receives exactly Streamer Idle. Later installs never
change an existing Anima's pool.
"""

from __future__ import annotations

import json
from importlib.resources import files
from typing import Any, cast

from animama.app.ports.content_store import ContentStore
from animama.app.services.idle_playback import read_gesture_idle_playback
from animama.app.services.typed_content_service import TypedContentAdmissionError, TypedContentService
from animama.domain.anima_creation import ResolvedIdleMember
from animama.domain.anima_loadout import IDLE_DEFAULT_CELL, idle_cell_key
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentIntegrityError,
    ContentKind,
    ContentPathError,
    ContentSource,
)
from animama.domain.content_documents import ContentDocumentError, GestureDocumentV1


def starter_idle_pool() -> dict[str, Any]:
    """Return a fresh parsed seed: ``default`` and ``cells[emotion][intensity]`` of logical keys."""

    resource = files("animama.resources").joinpath("starter-idle-pool.v1.json")
    return cast(dict[str, Any], json.loads(resource.read_text(encoding="utf-8")))


def starter_idle_keys(seed: dict[str, Any] | None = None) -> tuple[str, ...]:
    """Every Gesture logical key the seed names, once, in first-use order."""

    seed = seed if seed is not None else starter_idle_pool()
    cell_keys = (key for levels in seed["cells"].values() for keys in levels.values() for key in keys)
    return tuple(dict.fromkeys([*seed["default"], *cell_keys]))


async def _eligible_gesture(
    key: str, *, visible: dict[str, CatalogContentEntry], store: ContentStore
) -> CatalogContentEntry | None:
    """Resolve one Included Gesture whose closure and finite playback are admissible."""

    candidates = [
        item
        for item in visible.values()
        if item.source is ContentSource.INCLUDED and item.kind is ContentKind.GESTURE and item.logical_key == key
    ]
    if len(candidates) != 1:
        return None
    try:
        gesture = TypedContentService.resolve_closure(item_id=candidates[0].id, visible=visible)[-1]
        if not isinstance(gesture.document, GestureDocumentV1):
            return None
        await read_gesture_idle_playback(
            document=gesture.document, item=gesture.item, dependency_items=visible, store=store
        )
    except (TypedContentAdmissionError, ContentDocumentError, ContentIntegrityError, ContentPathError, OSError):
        # An unavailable seed Gesture is left out; the rest of the pool still seeds.
        return None
    return gesture.item


async def resolve_starter_idle_pool(
    *, visible: dict[str, CatalogContentEntry], store: ContentStore
) -> tuple[ResolvedIdleMember, ...]:
    """Return the seed members available on this installation."""

    seed = starter_idle_pool()
    available: dict[str, CatalogContentEntry] = {}
    for key in starter_idle_keys(seed):
        item = await _eligible_gesture(key, visible=visible, store=store)
        if item is not None:
            available[key] = item
    default = [available[key] for key in seed["default"] if key in available]
    members = [ResolvedIdleMember(item, IDLE_DEFAULT_CELL) for item in default]
    for emotion, levels in sorted(seed["cells"].items()):
        for level, cell_keys in sorted(levels.items()):
            # idle_cell_key rejects a mistyped emotion or intensity in the seed.
            cell = idle_cell_key(emotion, int(level))
            members.extend(ResolvedIdleMember(available[key], cell) for key in cell_keys if key in available)
    return tuple(members)


__all__ = ["resolve_starter_idle_pool", "starter_idle_keys", "starter_idle_pool"]
