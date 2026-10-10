"""Remove and restore non-portable references in exported descriptors.

A portable Idle Style may pool non-portable Gestures. Export removes those
references (and any pool they empty) and records where they were used; import
restores them when the receiving installation has the same non-portable item.
Pool names are ``default`` or ``<emotion>.<intensity>``.

A built-in effect's optional accompanying sound may be non-portable. Export
removes that edge and the ``soundAlias`` naming it without a reference: Local
content never carries a licensed sound, so an imported copy of the effect plays
without it (ADR 0019).
"""

from __future__ import annotations

import copy
from collections.abc import Collection, Mapping
from typing import Any

from animama.domain.content_documents import IdleStyleDocumentV2

DEFAULT_POOL = "default"


def idle_pools_using(document: IdleStyleDocumentV2, ref: str) -> list[str]:
    """Name every pool of a v2 Idle Style that contains ``ref``."""

    pools = [DEFAULT_POOL] if ref in document.default_pool else []
    for emotion, levels in sorted(document.cells.items()):
        for intensity, cell in sorted(levels.items()):
            if ref in cell.gestures:
                pools.append(f"{emotion}.{intensity}")
    return pools


def strip_idle_refs(projection: Mapping[str, Any], refs: Collection[str]) -> dict[str, Any]:
    """Drop ``refs`` from pools and dependencies; an emptied cell inherits Default."""

    result = copy.deepcopy(dict(projection))
    result["default_pool"] = [ref for ref in result.get("default_pool", []) if ref not in refs]
    cells: dict[str, dict[str, Any]] = {}
    for emotion, levels in result.get("cells", {}).items():
        kept: dict[str, Any] = {}
        for intensity, cell in levels.items():
            if cell.get("mode") == "pool":
                gestures = [ref for ref in cell["gestures"] if ref not in refs]
                if not gestures:
                    continue
                cell = {**cell, "gestures": gestures}
            kept[intensity] = cell
        if kept:
            cells[emotion] = kept
    result["cells"] = cells
    dependencies = [edge for edge in result.get("dependencies", []) if edge["ref"] not in refs]
    if dependencies:
        result["dependencies"] = dependencies
    else:
        result.pop("dependencies", None)
    return result


def restore_idle_refs(projection: Mapping[str, Any], restores: Mapping[str, Collection[str]]) -> dict[str, Any]:
    """Add each Gesture ref back to its recorded pools and to the dependencies."""

    result = copy.deepcopy(dict(projection))
    dependencies = list(result.get("dependencies", []))
    for ref, pools in restores.items():
        if not any(edge["ref"] == ref for edge in dependencies):
            dependencies.append({"ref": ref, "content_type": "gesture"})
        for pool in pools:
            if pool == DEFAULT_POOL:
                target = result.setdefault("default_pool", [])
            else:
                emotion, _, intensity = pool.partition(".")
                cell = result.setdefault("cells", {}).setdefault(emotion, {}).get(intensity)
                if cell is None or cell.get("mode") != "pool":
                    # A removed cell (or one the sender set to none) becomes a pool again.
                    cell = {"mode": "pool", "gestures": []}
                    result["cells"][emotion][intensity] = cell
                target = cell["gestures"]
            if ref not in target:
                target.append(ref)
    if dependencies:
        result["dependencies"] = dependencies
    return result


def strip_optional_refs(projection: Mapping[str, Any], refs: Collection[str]) -> dict[str, Any]:
    """Drop optional edges in ``refs`` and the sound alias naming them.

    Kept edges lose their ``optional`` flag: a package entry becomes Local
    content on import, and Local content never declares optional edges.
    """

    result = copy.deepcopy(dict(projection))
    dependencies = []
    removed_aliases = set()
    for edge in result.get("dependencies", []):
        if edge["ref"] in refs:
            removed_aliases.add(edge.get("alias") or edge["ref"])
            continue
        edge.pop("optional", None)
        dependencies.append(edge)
    if dependencies:
        result["dependencies"] = dependencies
    else:
        result.pop("dependencies", None)
    definition = result.get("definition")
    if isinstance(definition, dict) and definition.get("soundAlias") in removed_aliases:
        del definition["soundAlias"]
    return result
