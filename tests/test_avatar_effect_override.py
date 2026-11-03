"""Per-use overrides that an ``avatar_vfx`` clip event applies to its Avatar Effect.

An override part replaces the effect's part whole, keeps the effect's
attachment kind and must leave a valid ``animama/avatar-effect/2`` definition.
"""

from __future__ import annotations

from typing import Any

import pytest

from animama.app.contracts.avatar_effect import AvatarEffectDefinitionV2
from animama.app.services.avatar_effect_overrides import (
    apply_avatar_effect_override,
    parse_avatar_effect_override,
)
from animama.domain.content_documents import ContentDocumentError

CODE = "action_effect_override_invalid"

BODY_EFFECT: dict[str, Any] = {
    "schema": "animama/avatar-effect/2",
    "region": "body",
    "attachment": {"kind": "body", "bone": "head", "offset": {"x": 0.1, "y": 0.2}, "size": 0.1},
    "art": {"image": "star.png"},
    "appearance": {"opacity": 0.8},
    "motion": {"pulse": {"scaleMin": 0.9, "scaleMax": 1.1, "cyclesPerSecond": 2}},
    "soundAlias": "on-apply",
}

EYE_EFFECT: dict[str, Any] = {
    "schema": "animama/avatar-effect/2",
    "region": "eyes",
    "attachment": {"kind": "face_landmark", "landmark": "eyes", "side": "right", "mirror": True},
    "art": {"image": "eye.png"},
    "faceOptions": {"forceBlink": True},
}


def _apply(definition: dict[str, Any], override: dict[str, Any]) -> AvatarEffectDefinitionV2:
    return apply_avatar_effect_override(
        AvatarEffectDefinitionV2.model_validate(definition),
        parse_avatar_effect_override(override, code=CODE, field="override"),
        code=CODE,
        field="override",
    )


def test_each_part_present_replaces_the_effects_part_whole() -> None:
    merged = _apply(
        BODY_EFFECT,
        {"attachment": {"kind": "body", "bone": "leftHand", "size": 0.08}, "motion": {}},
    )

    assert merged.attachment.model_dump(exclude_unset=True) == {"kind": "body", "bone": "leftHand", "size": 0.08}
    assert merged.motion.pulse is None
    # Parts the override leaves out keep the effect's values.
    assert merged.appearance.opacity == 0.8
    assert merged.art.image == "star.png"
    assert merged.soundAlias == "on-apply"


def test_an_override_can_pick_another_declared_sound() -> None:
    assert _apply(BODY_EFFECT, {"soundAlias": "tehe"}).soundAlias == "tehe"


def test_a_different_attachment_kind_is_refused() -> None:
    with pytest.raises(ContentDocumentError) as error:
        _apply(BODY_EFFECT, {"attachment": {"kind": "sticker"}})
    assert error.value.code == CODE
    assert error.value.field == "override.attachment.kind"


def test_a_merged_definition_that_breaks_a_cross_field_rule_names_the_field() -> None:
    # Eye face options do not apply once the plane moves to the mouth.
    with pytest.raises(ContentDocumentError) as error:
        _apply(EYE_EFFECT, {"attachment": {"kind": "face_landmark", "landmark": "mouth"}})
    assert error.value.field == "override.faceOptions.forceBlink"


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ("sparkle", "override"),
        ({}, "override"),
        ({"art": {"image": "other.png"}}, "override.art"),
        ({"appearance": None}, "override.appearance"),
        ({"appearance": {"opacity": 2}}, "override.appearance.opacity"),
        ({"attachment": {"kind": "body", "bone": "tail"}}, "override.attachment.bone"),
        ({"attachment": {"kind": "body", "bone": "head", "glow": 1}}, "override.attachment.glow"),
        ({"soundAlias": ""}, "override.soundAlias"),
    ],
)
def test_invalid_override_shapes_are_refused_naming_the_field(override: Any, field: str) -> None:
    with pytest.raises(ContentDocumentError) as error:
        parse_avatar_effect_override(override, code=CODE, field="override")
    assert error.value.code == CODE
    assert error.value.field == field
