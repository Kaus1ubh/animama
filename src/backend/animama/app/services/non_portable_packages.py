"""Remove non-portable references from exported descriptors and clips.

A built-in effect's optional accompanying sound, or a built-in Gesture or
Reaction's optional ``sfx`` sound, may be non-portable. Export removes that edge
and the ``soundAlias`` or ``sfx`` events naming it without a reference: Local
content never carries a licensed sound, so an imported copy plays without it
(ADR 0022). Non-portable Gestures an Anima uses are omitted by the
Anima capture and recorded as package references instead.
"""

from __future__ import annotations

import copy
from collections.abc import Collection, Mapping
from typing import Any


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


def strip_sound_events(value: Any, aliases: Collection[str]) -> Any:
    """Drop a clip's ``sfx`` events whose cue names one of ``aliases``.

    Any other JSON document is returned unchanged.
    """

    if not aliases or not isinstance(value, Mapping) or not isinstance(value.get("events"), list):
        return value
    result = copy.deepcopy(dict(value))
    events = result["events"]
    result["events"] = [
        event
        for event in events
        if not (isinstance(event, dict) and event.get("kind") == "sfx" and event.get("cueId") in aliases)
    ]
    return result
