"""Merged Included Avatar Effects: rewriting Actions from a removed effect to its family (ADR 0025).

Included Avatar Effects that shared one image became one family effect each.
``resources/avatar-effect-merges.json`` maps every removed effect to its family
and to the per-use override, sound and silence that reproduce it. The one-time
repository conversion of Included Gestures and Reactions and the Local content
transition both rewrite Actions with ``rewrite_action_effect_merges``.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from functools import cache
from importlib.resources import files
from typing import Any

_RESOURCE = "avatar-effect-merges.json"
_BUILTIN_EFFECT_PREFIX = "builtin:avatar-effect:"


@dataclass(frozen=True, slots=True)
class AvatarEffectMerge:
    """How an Action that named a removed effect plays its family effect instead."""

    ref: str
    #: Override parts (each replacing the family's part whole) that reproduce the removed effect.
    override: Mapping[str, Any] = field(default_factory=dict)
    #: The family's sound the removed effect played, when it is not the family's own.
    sound_alias: str | None = None
    #: The removed effect played no sound.
    silent: bool = False


@cache
def load_avatar_effect_merges() -> Mapping[str, AvatarEffectMerge]:
    """Read the tracked merge map, keyed by the removed effect's content ID."""
    raw = json.loads(files("animama.resources").joinpath(_RESOURCE).read_text(encoding="utf-8"))
    return {
        removed: AvatarEffectMerge(
            ref=merge["ref"],
            override=merge.get("override", {}),
            sound_alias=merge.get("soundAlias"),
            silent=merge.get("silent", False),
        )
        for removed, merge in raw["merges"].items()
    }


def rewrite_action_effect_merges(
    descriptor: Mapping[str, Any], clip: Mapping[str, Any], merges: Mapping[str, AvatarEffectMerge]
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Return a Gesture's or Reaction's descriptor and clip rewritten to family effects.

    Each removed effect's dependency becomes one dependency on its family
    (twins share it), and every ``avatar_vfx`` event that named the removed
    effect names the family with the merge's override; an event's own override
    parts win. Returns ``None`` when the Action names no removed effect. The
    inputs are not modified.
    """
    dependencies = descriptor.get("dependencies")
    if not isinstance(dependencies, list) or not any(_merged(dependency, merges) for dependency in dependencies):
        return None
    family_refs = {merge.ref for merge in merges.values()}
    aliases: dict[str, str] = {}
    for dependency in dependencies:
        if _is_effect(dependency) and dependency.get("ref") in family_refs:
            aliases.setdefault(dependency["ref"], _selector(dependency))
    taken = {_selector(dependency) for dependency in dependencies if not _merged(dependency, merges)}

    renamed: dict[str, tuple[str, AvatarEffectMerge]] = {}
    rewritten: list[Any] = []
    for dependency in dependencies:
        merge = _merged(dependency, merges)
        if merge is None:
            rewritten.append(dependency)
            continue
        alias = aliases.get(merge.ref)
        if alias is None:
            alias = _free_alias(merge.ref.removeprefix(_BUILTIN_EFFECT_PREFIX), taken)
            aliases[merge.ref] = alias
            taken.add(alias)
            rewritten.append({"ref": merge.ref, "alias": alias, "content_type": "avatar_effect", "config": {}})
        for selector in (dependency.get("alias"), dependency.get("ref")):
            if isinstance(selector, str):
                renamed[selector] = (alias, merge)

    new_descriptor = copy.deepcopy(dict(descriptor))
    new_descriptor["dependencies"] = copy.deepcopy(rewritten)
    new_clip = copy.deepcopy(dict(clip))
    events = new_clip.get("events")
    for event in events if isinstance(events, list) else []:
        if not isinstance(event, dict) or event.get("kind") != "avatar_vfx" or event.get("effectId") not in renamed:
            continue
        alias, merge = renamed[event["effectId"]]
        event["effectId"] = alias
        own = event.get("override") if isinstance(event.get("override"), dict) else {}
        override = {**copy.deepcopy(dict(merge.override)), **own}
        # A removed effect declared one sound, as "on-apply": an event that
        # named it explicitly still means that sound, now the family's alias.
        if merge.sound_alias and own.get("soundAlias", "on-apply") == "on-apply":
            override["soundAlias"] = merge.sound_alias
        if override:
            event["override"] = override
        if merge.silent:
            event["playAccompanyingSound"] = False
    return new_descriptor, new_clip


def _is_effect(dependency: Any) -> bool:  # noqa: ANN401
    return isinstance(dependency, dict) and dependency.get("content_type") == "avatar_effect"


def _merged(dependency: Any, merges: Mapping[str, AvatarEffectMerge]) -> AvatarEffectMerge | None:  # noqa: ANN401
    return merges.get(dependency["ref"]) if _is_effect(dependency) and isinstance(dependency.get("ref"), str) else None


def _selector(dependency: Any) -> str:  # noqa: ANN401
    """The name clip events use for a dependency: its alias, else its ref."""
    if isinstance(dependency, dict):
        return str(dependency.get("alias") or dependency.get("ref") or "")
    return ""


def _free_alias(stem: str, taken: set[str]) -> str:
    alias, suffix = stem, 2
    while alias in taken:
        alias, suffix = f"{stem}-{suffix}", suffix + 1
    return alias


__all__ = ["AvatarEffectMerge", "load_avatar_effect_merges", "rewrite_action_effect_merges"]
