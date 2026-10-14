"""Readers of stored replies see their words, not the audio tags the model wrote (#479, T6)."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from animama.adapters.repositories.sqlalchemy.chat_message_repo import _reflection_text, _search_row_to_domain
from animama.orm.chat_messages import ORMChatMessage

SPEECH = "Oh my gosh, [laughs] that is so funny! <sigh> Anyway."


def _assistant(speech: str, display: str | None = None) -> ORMChatMessage:
    return ORMChatMessage(
        role="assistant",
        content='{"speech": "raw"}',
        message_data={"structured": {"speech": speech, "display": display}},
    )


def test_reflection_reads_speech_without_its_tags() -> None:
    assert _reflection_text(_assistant(SPEECH)) == "Oh my gosh, that is so funny! Anyway."


def test_reflection_reads_display_as_written() -> None:
    assert _reflection_text(_assistant(SPEECH, display="See [the guide](https://example.com).")) == (
        "See [the guide](https://example.com)."
    )


def test_a_tag_only_reply_has_no_reflection_text() -> None:
    assert _reflection_text(_assistant("[laughs]")) is None


def _snippet(content: str, speech: str | None = None, display: str | None = None) -> str:
    row = SimpleNamespace(
        _mapping={
            "message_id": 1,
            "chat_id": "chat-1",
            "anima_id": "anima-1",
            "anima_name": "Mira",
            "anima_profile_picture_url": None,
            "chat_title": "Jokes",
            "content": content,
            "structured_speech": speech,
            "structured_display": display,
            "score": 1.0,
            "turn": 1,
            "created_at": datetime(2026, 10, 14, tzinfo=UTC),
        }
    )
    return _search_row_to_domain(row, "funny").snippet


def test_search_snippets_hide_tags_in_speech_only() -> None:
    display = "Plan: [Step one] pack."
    assert _snippet(f"{SPEECH} {display}", speech=SPEECH, display=display) == (
        "Oh my gosh, that is so funny! Anyway. Plan: [Step one] pack."
    )


def test_search_snippets_keep_the_owners_own_brackets() -> None:
    assert _snippet("[TODO] call mom about <Alice> tomorrow") == "[TODO] call mom about <Alice> tomorrow"
