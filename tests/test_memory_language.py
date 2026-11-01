"""Memory text follows the conversation's language and reaches models as written (ADR 0024, #793)."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from animama.adapters.memory_manager.anthropic_runtime import manager_instructions
from animama.adapters.memory_manager.episode_processing import (
    EpisodeProcessingBatchItem,
    render_episode_processing_instructions,
)
from animama.adapters.memory_manager.openai_agents_runtime import _instructions as openai_manager_instructions
from animama.app.chat.conversation_language import MEMORY_LANGUAGE_RULE
from animama.app.chat.memory_context import memory_system_guidance
from animama.app.chat.memory_tools import _tool_error
from animama.app.services.anima_identity_memory import GENERAL_MANAGER_FILE_ACCESS
from animama.domain.memory_episode import MemoryEpisodeItem


@pytest.mark.parametrize("remember", [True, False])
def test_chat_memory_guidance_states_the_language_rule(remember: bool) -> None:
    assert MEMORY_LANGUAGE_RULE in memory_system_guidance(remember=remember)


def test_memory_manager_runtimes_state_the_language_rule() -> None:
    # Reflection and episode-processing runs build on these general instructions, so they state it too.
    assert MEMORY_LANGUAGE_RULE in manager_instructions(memory_map="", access=GENERAL_MANAGER_FILE_ACCESS)
    assert MEMORY_LANGUAGE_RULE in openai_manager_instructions(memory_map="", access=GENERAL_MANAGER_FILE_ACCESS)


def test_language_rule_keeps_names_and_existing_text_and_asks_for_ascii_file_names() -> None:
    rule = MEMORY_LANGUAGE_RULE
    assert "language of the conversation" in rule
    assert "names, nicknames and quoted words exactly" in rule
    assert "rather than translating it" in rule
    assert "ASCII letters, digits, dots, hyphens and underscores" in rule


def test_episode_batch_keeps_note_text_as_written() -> None:
    episode = MemoryEpisodeItem(
        id="episode-1",
        user_id="user-1",
        source_anima_id=None,
        source_chat_id=None,
        source_run_id=None,
        source_message_id=None,
        occurred_at=datetime(2026, 10, 28, tzinfo=UTC),
        local_date=date(2026, 10, 28),
        local_timezone=None,
        episode_path="episodes/2026/10/2026-10-28.md",
        kind="turn",
        text='ユーザーは週末に京都で抹茶を飲んだ。"美味しい"と言った。',
        status="pending",
    )

    instructions = render_episode_processing_instructions(
        batch=(EpisodeProcessingBatchItem(ref="e1", episode=episode, source_anima_name="ハル"),)
    )

    # JSON quoting still escapes quotes, but Japanese reaches the model as written rather than as \\u escapes.
    assert 'text: "ユーザーは週末に京都で抹茶を飲んだ。\\"美味しい\\"と言った。"' in instructions
    assert 'source_anima: "ハル"' in instructions


def test_tool_results_keep_escapes_for_text_utf8_cannot_encode() -> None:
    assert _tool_error("invalid_request", "京都") == '{"ok":false,"code":"invalid_request","message":"京都"}'
    # A lone surrogate echoed from a malformed argument stays escaped, so the result can still be stored and sent.
    lone_surrogate = _tool_error("invalid_request", "bad \ud800 patch")
    assert lone_surrogate.encode("utf-8") and "\\ud800" in lone_surrogate
