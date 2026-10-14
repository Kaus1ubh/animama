"""The tracked merge map reproduces every merged Included Avatar Effect (ADR 0025).

``tests/fixtures/avatar-effect-merge-variants.json`` keeps the definitions and
sounds of the effects the merge removed; each must equal its family's
definition with the map's override, and the sound the map picks.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from animama.app.contracts.avatar_effect import (
    AvatarEffectDefinitionV2,
    AvatarEffectEventOverride,
    merge_avatar_effect_override,
)
from animama.app.services.avatar_effect_merges import load_avatar_effect_merges

REPOSITORY = Path(__file__).parents[1]
INCLUDED = REPOSITORY / "content/included"
VARIANTS: dict[str, dict[str, Any]] = json.loads(
    (Path(__file__).parent / "fixtures/avatar-effect-merge-variants.json").read_text()
)
MERGES = load_avatar_effect_merges()
EFFECT_PREFIX = "builtin:avatar-effect:"
SOUND_PREFIX = "builtin:sound-effect:"


def _effect(ref: str) -> dict[str, Any]:
    stem = ref.removeprefix(EFFECT_PREFIX)
    effect: dict[str, Any] = json.loads((INCLUDED / "vfx/avatar" / stem / f"{stem}.json").read_text())
    return effect


def test_the_map_covers_exactly_the_removed_effects() -> None:
    assert set(MERGES) == set(VARIANTS)


@pytest.mark.parametrize("removed", sorted(VARIANTS))
def test_the_family_with_its_override_plays_as_the_removed_effect(removed: str) -> None:
    merge = MERGES[removed]
    family = _effect(merge.ref)
    definition = AvatarEffectDefinitionV2.model_validate(family["definition"])
    if merge.override:
        definition = merge_avatar_effect_override(
            definition, AvatarEffectEventOverride.model_validate(dict(merge.override))
        )
    expected = AvatarEffectDefinitionV2.model_validate(VARIANTS[removed]["definition"])
    for part in ("region", "attachment", "appearance", "motion", "faceOptions"):
        assert getattr(definition, part) == getattr(expected, part), part

    sounds = {
        dependency["alias"]: dependency["ref"].removeprefix(SOUND_PREFIX)
        for dependency in family.get("dependencies", [])
        if dependency["content_type"] == "sound_effect"
    }
    alias = merge.sound_alias or family["definition"].get("soundAlias")
    played = None if merge.silent else sounds.get(alias) if alias else None
    assert played == VARIANTS[removed]["sound"]


def test_no_included_action_names_a_merged_effect() -> None:
    for meta in [*INCLUDED.glob("gestures/*/*.meta.json"), *INCLUDED.glob("reactions/*/*.meta.json")]:
        refs = {dependency["ref"] for dependency in json.loads(meta.read_text()).get("dependencies", [])}
        assert not refs & set(MERGES), meta.relative_to(INCLUDED)
