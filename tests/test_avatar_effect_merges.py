"""Rewriting Actions from a merged Included Avatar Effect to its family effect.

Included effects that shared one image were merged into one family effect
each; an Action that named a removed effect names the family with the per-use
override (and sound) that reproduces the removed effect (ADR 0025).
"""

from __future__ import annotations

import copy
from typing import Any

from animama.app.services.avatar_effect_merges import AvatarEffectMerge, rewrite_action_effect_merges

STAR = "builtin:avatar-effect:kira_star"
TEHE = "builtin:avatar-effect:kira_star_tehe"
WISH = "builtin:avatar-effect:kira_star_wish"
WISH_LEFT = "builtin:avatar-effect:kira_star_wish_left"
LAUGH = "builtin:avatar-effect:laugh_sparkle"
HEAD = "builtin:avatar-effect:kira_star_head"

MERGES = {
    HEAD: AvatarEffectMerge(ref=STAR, override={}, sound_alias=None, silent=False),
    TEHE: AvatarEffectMerge(
        ref=STAR,
        override={"attachment": {"kind": "body", "bone": "head", "size": 0.06}},
        sound_alias="squeaky_mouse_03",
        silent=False,
    ),
    WISH: AvatarEffectMerge(
        ref=STAR,
        override={"attachment": {"kind": "body", "bone": "rightHand"}},
        sound_alias="digital_chime_magical_02",
        silent=False,
    ),
    WISH_LEFT: AvatarEffectMerge(
        ref=STAR,
        override={"attachment": {"kind": "body", "bone": "leftHand"}},
        sound_alias="digital_chime_magical_02",
        silent=False,
    ),
    LAUGH: AvatarEffectMerge(
        ref=STAR, override={"motion": {"pulse": {"scaleMin": 0.9}}}, sound_alias=None, silent=True
    ),
}


def _action(dependencies: list[dict[str, Any]], events: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    descriptor = {"content_type": "gesture", "name": "Wish", "dependencies": dependencies}
    clip = {"schema": "animaPoseClip/2.0", "id": "wish", "events": events}
    return descriptor, clip


def _effect(ref: str, alias: str, **extra: Any) -> dict[str, Any]:
    return {"ref": ref, "alias": alias, "content_type": "avatar_effect", "config": {}, **extra}


def _event(event_id: str, alias: str, **extra: Any) -> dict[str, Any]:
    return {"id": event_id, "time": 0.1, "kind": "avatar_vfx", "effectId": alias, **extra}


def test_a_variant_becomes_its_family_with_the_override_and_sound_that_reproduce_it() -> None:
    descriptor, clip = _action(
        [_effect(TEHE, "kira_star_tehe", source={"catalog_item_id": "old", "logical_key": TEHE})],
        [_event("star", "kira_star_tehe")],
    )
    rewritten = rewrite_action_effect_merges(descriptor, clip, MERGES)
    assert rewritten is not None
    new_descriptor, new_clip = rewritten
    # The old item's catalog source no longer applies.
    assert new_descriptor["dependencies"] == [_effect(STAR, "kira_star")]
    assert new_clip["events"] == [
        _event(
            "star",
            "kira_star",
            override={"attachment": {"kind": "body", "bone": "head", "size": 0.06}, "soundAlias": "squeaky_mouse_03"},
        )
    ]


def test_twins_share_one_family_dependency_and_keep_two_events() -> None:
    descriptor, clip = _action(
        [
            _effect(WISH, "wish"),
            _effect(WISH_LEFT, "wish-left"),
            {"ref": "x", "alias": "pop", "content_type": "sound_effect"},
        ],
        [_event("right", "wish"), _event("left", "wish-left", playAccompanyingSound=False)],
    )
    rewritten = rewrite_action_effect_merges(descriptor, clip, MERGES)
    assert rewritten is not None
    new_descriptor, new_clip = rewritten
    assert [dependency["alias"] for dependency in new_descriptor["dependencies"]] == ["kira_star", "pop"]
    assert [event["effectId"] for event in new_clip["events"]] == ["kira_star", "kira_star"]
    assert new_clip["events"][0]["override"]["attachment"]["bone"] == "rightHand"
    assert new_clip["events"][1]["override"]["attachment"]["bone"] == "leftHand"
    assert new_clip["events"][1]["playAccompanyingSound"] is False


def test_the_default_variant_needs_no_override_and_a_silent_one_stays_silent() -> None:
    descriptor, clip = _action(
        [_effect(HEAD, "head"), _effect(LAUGH, "laugh")],
        [_event("head", "head"), _event("laugh", "laugh")],
    )
    rewritten = rewrite_action_effect_merges(descriptor, clip, MERGES)
    assert rewritten is not None
    _, new_clip = rewritten
    head, laugh = new_clip["events"]
    assert "override" not in head and "playAccompanyingSound" not in head
    assert laugh["override"] == {"motion": {"pulse": {"scaleMin": 0.9}}}
    assert laugh["playAccompanyingSound"] is False


def test_an_events_own_override_parts_win_and_an_existing_family_dependency_is_reused() -> None:
    descriptor, clip = _action(
        [_effect(STAR, "star"), _effect(TEHE, "tehe")],
        [_event("tehe", "tehe", override={"attachment": {"kind": "body", "bone": "neck"}, "soundAlias": "mine"})],
    )
    rewritten = rewrite_action_effect_merges(descriptor, clip, MERGES)
    assert rewritten is not None
    new_descriptor, new_clip = rewritten
    assert new_descriptor["dependencies"] == [_effect(STAR, "star")]
    assert new_clip["events"][0] == _event(
        "tehe", "star", override={"attachment": {"kind": "body", "bone": "neck"}, "soundAlias": "mine"}
    )


def test_an_event_that_named_its_effects_own_sound_keeps_that_sound() -> None:
    descriptor, clip = _action([_effect(TEHE, "tehe")], [_event("tehe", "tehe", override={"soundAlias": "on-apply"})])
    rewritten = rewrite_action_effect_merges(descriptor, clip, MERGES)
    assert rewritten is not None
    assert rewritten[1]["events"][0]["override"]["soundAlias"] == "squeaky_mouse_03"


def test_a_family_alias_that_another_dependency_uses_gets_a_suffix() -> None:
    descriptor, clip = _action(
        [_effect("builtin:avatar-effect:other", "kira_star"), _effect(TEHE, "tehe")],
        [_event("other", "kira_star"), _event("tehe", "tehe")],
    )
    rewritten = rewrite_action_effect_merges(descriptor, clip, MERGES)
    assert rewritten is not None
    new_descriptor, new_clip = rewritten
    assert [dependency["alias"] for dependency in new_descriptor["dependencies"]] == ["kira_star", "kira_star-2"]
    assert [event["effectId"] for event in new_clip["events"]] == ["kira_star", "kira_star-2"]


def test_an_action_without_merged_effects_is_left_alone_and_a_rewrite_is_final() -> None:
    descriptor, clip = _action([_effect(STAR, "star")], [_event("star", "star")])
    before = copy.deepcopy((descriptor, clip))
    assert rewrite_action_effect_merges(descriptor, clip, MERGES) is None
    assert (descriptor, clip) == before

    descriptor, clip = _action([_effect(TEHE, "tehe")], [_event("tehe", "tehe")])
    rewritten = rewrite_action_effect_merges(descriptor, clip, MERGES)
    assert rewritten is not None
    assert (descriptor, clip) == _action([_effect(TEHE, "tehe")], [_event("tehe", "tehe")])
    assert rewrite_action_effect_merges(*rewritten, MERGES) is None
