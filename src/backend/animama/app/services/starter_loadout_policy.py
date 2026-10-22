"""Immutable backend starter policy, resolved by the stored version.

``starter-loadout.v<version>.json`` is the one definition of a starter Anima's
assets: its ``gestures``, its ``reactions`` pool members and its ``idle`` pool
seed. Starting a loadout copies all three into binding rows; afterwards stored
loadouts read only the starter Reactions by version, for Reaction ``origin``,
cell ``state`` and the cell's ``restore_starter``. Schema 2 added the ``idle``
section within version 1.
"""

from __future__ import annotations

import hashlib
import json
from importlib.resources import files
from typing import Any, cast

from animama.app.ports.content_store import ContentStore
from animama.app.services.idle_playback import read_gesture_idle_playback
from animama.app.services.typed_content_service import TypedContentAdmissionError, TypedContentService
from animama.domain.anima_creation import ResolvedIdleMember
from animama.domain.anima_loadout import (
    IDLE_DEFAULT_CELL,
    REACTION_POOL_LIMIT,
    AnimaLoadoutError,
    idle_cell_key,
    reaction_cell_key,
)
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentIntegrityError,
    ContentKind,
    ContentPathError,
    ContentSource,
)
from animama.domain.content_documents import ContentDocumentError, GestureDocumentV1

STARTER_LOADOUT_SCHEMA_VERSION = 2


def starter_loadout_policy(version: int = 1) -> dict[str, Any]:
    """Return a fresh parsed policy, never a mutable global default for old Animas."""

    if type(version) is not int or version != 1:
        raise ValueError("Unsupported starter loadout version")
    policy = cast(
        dict[str, Any],
        json.loads(files("animama.resources").joinpath(f"starter-loadout.v{version}.json").read_text(encoding="utf-8")),
    )
    if policy.get("schema_version") != STARTER_LOADOUT_SCHEMA_VERSION:
        raise ValueError(f"Starter loadout v{version} must use schema {STARTER_LOADOUT_SCHEMA_VERSION}")
    return policy


def starter_gestures(version: int = 1) -> tuple[str, ...]:
    """Return the starter Gestures' content IDs in policy order; starting a loadout copies each into a row."""

    return tuple(str(raw["content_id"]) for raw in starter_loadout_policy(version)["gestures"])


def starter_reaction_pools(version: int = 1) -> dict[str, tuple[str, ...]]:
    """Return each cell's starter Reaction content IDs in policy order, keyed ``<emotion>-<intensity>``.

    The policy lists one ``reactions`` entry per pool member; a cell with no
    entry starts empty. Raises ``ValueError`` for an invalid cell, a Reaction
    repeated in one cell, or more than ``REACTION_POOL_LIMIT`` members.
    """

    pools: dict[str, list[str]] = {}
    for raw in starter_loadout_policy(version)["reactions"]:
        try:
            cell = reaction_cell_key(raw.get("emotion"), raw.get("intensity"))
        except AnimaLoadoutError as exc:
            raise ValueError(f"Invalid starter Reaction cell: {raw!r}") from exc
        content_id = str(raw["content_id"])
        members = pools.setdefault(cell, [])
        if content_id in members or len(members) >= REACTION_POOL_LIMIT:
            raise ValueError(f"Starter Reaction pool {cell} repeats a Reaction or exceeds {REACTION_POOL_LIMIT}")
        members.append(content_id)
    return {cell: tuple(members) for cell, members in pools.items()}


def starter_idle_pool(version: int = 1) -> dict[str, tuple[str, ...]]:
    """Return the Idle seed's Gesture logical keys per cell: ``default`` first, then ``<emotion>-<intensity>``.

    The policy's ``idle`` section holds Streamer Idle's Default and cells, plus
    the Mixamo idles in the cells Emotive Idle mapped them to. Each cell lists
    only what it adds: playback always mixes in Default and inherits an
    emotion's lower intensities. Raises ``ValueError`` for an invalid cell or a
    Gesture repeated in one cell.
    """

    seed = starter_loadout_policy(version)["idle"]
    pools = {IDLE_DEFAULT_CELL: [str(key) for key in seed["default"]]}
    for emotion, levels in sorted(seed["cells"].items()):
        for level, keys in sorted(levels.items()):
            try:
                cell = idle_cell_key(emotion, int(level))
            except (AnimaLoadoutError, ValueError) as exc:
                raise ValueError(f"Invalid starter Idle cell: {emotion} {level}") from exc
            pools[cell] = [str(key) for key in keys]
    for cell, keys in pools.items():
        if len(set(keys)) != len(keys):
            raise ValueError(f"Starter Idle pool {cell} repeats a Gesture")
    return {cell: tuple(keys) for cell, keys in pools.items()}


def starter_idle_keys(version: int = 1) -> tuple[str, ...]:
    """Every Gesture logical key the Idle seed names, once, in first-use order."""

    return tuple(dict.fromkeys(key for keys in starter_idle_pool(version).values() for key in keys))


async def _eligible_idle_gesture(
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
    *, visible: dict[str, CatalogContentEntry], store: ContentStore, version: int = 1
) -> tuple[ResolvedIdleMember, ...]:
    """Return the Idle seed members available on this installation.

    Only installed Included Gestures eligible for finite idle playback are kept,
    so an installation without the ``mixamo-motion`` pack receives exactly
    Streamer Idle. Callers seed a new Anima once; later installs never change an
    existing Anima's pool.
    """

    pools = starter_idle_pool(version)
    available: dict[str, CatalogContentEntry] = {}
    for key in dict.fromkeys(key for keys in pools.values() for key in keys):
        item = await _eligible_idle_gesture(key, visible=visible, store=store)
        if item is not None:
            available[key] = item
    return tuple(
        ResolvedIdleMember(available[key], cell) for cell, keys in pools.items() for key in keys if key in available
    )


def starter_pack_identity(version: int = 1) -> dict[str, Any]:
    policy = starter_loadout_policy(version)
    encoded = json.dumps(policy, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return {"id": policy["id"], "version": policy["version"], "revision_sha256": hashlib.sha256(encoded).hexdigest()}
