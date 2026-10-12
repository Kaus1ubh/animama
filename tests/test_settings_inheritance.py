"""App Settings defaults and per-Anima overrides for memory/emotion behaviour."""

from __future__ import annotations

import pytest

from animama.app.chat.options import merge_chat_request_options
from animama.app.services.settings_service import default_anima_preferences


def test_new_anima_preferences_inherit_memory_and_emotion() -> None:
    preferences = default_anima_preferences()
    assert "memory" not in preferences and "emotion" not in preferences


@pytest.mark.parametrize(
    ("request_opts", "anima", "owner", "expected"),
    [
        # Owner default applies when the Anima inherits.
        (None, {}, {"memory": {"disable_influence": True}}, True),
        # An explicit Anima value overrides the owner default either way.
        (None, {"memory": {"disable_influence": False}}, {"memory": {"disable_influence": True}}, False),
        (None, {"memory": {"disable_influence": True}}, {"memory": {"disable_influence": False}}, True),
        # A per-request value still takes precedence over both.
        ({"disable_memory_influence": False}, {"memory": {"disable_influence": True}}, {}, False),
        # Nothing set anywhere keeps the system default (enabled).
        (None, {}, {}, False),
    ],
)
def test_memory_influence_resolution_order(request_opts, anima, owner, expected) -> None:
    options = merge_chat_request_options(request_opts=request_opts, user_prefs=owner, anima_prefs=anima)
    assert options.disable_memory_influence is expected


def test_each_flag_inherits_independently() -> None:
    options = merge_chat_request_options(
        request_opts=None,
        user_prefs={"memory": {"disable_updates": True}, "emotion": {"disable_updates": True}},
        anima_prefs={"emotion": {"disable_updates": False}},
    )
    assert options.disable_memory_updates is True
    assert options.disable_emotion_updates is False
    assert options.disable_memory_influence is False


def test_memory_updates_stop_when_memory_is_off_at_another_level() -> None:
    """App memory off with an explicit Anima updates-on still writes nothing."""

    options = merge_chat_request_options(
        request_opts=None,
        user_prefs={"memory": {"disable_influence": True, "disable_updates": True}},
        anima_prefs={"memory": {"disable_updates": False}},
    )
    assert options.disable_memory_influence is True
    assert options.disable_memory_updates is True


def test_local_chat_options_reuses_the_neutral_merger() -> None:
    """Local HTTP composition and installed consumers share one resolution policy."""

    from animama.product_http.chat.options import merge_chat_request_options as local_merge

    assert local_merge is merge_chat_request_options


def test_neutral_merger_preserves_request_normalization_and_inherited_flags() -> None:
    options = merge_chat_request_options(
        request_opts={
            "disable_memory_updates": False,
            "disable_emotion_updates": "false",
            "incognito": True,
            "native_tools": [" search ", "search", None],
            "tts": {"provider": "elevenlabs", "model_id": "unlisted", "enabled": True},
        },
        user_prefs={"memory": {"disable_updates": True}, "emotion": {"disable_updates": True}},
        anima_prefs={},
    )
    assert options.disable_memory_updates is False
    assert options.disable_emotion_updates is True
    assert options.incognito is True
    assert options.native_tools == ("search",)
    assert options.tts is not None
    assert options.tts.enabled is True
    assert options.tts.model_id is None
