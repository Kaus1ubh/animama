"""The Anima replies and speaks in the owner's applied UI Locale (ADR 0024)."""

from __future__ import annotations

import pytest

from animama.app.chat.anthropic_instructions import INSTRUCTION_STYLE_ANTHROPIC
from animama.app.chat.conversation_language import conversation_language, with_speech_language
from animama.app.chat.openai_prompt import DirectChatPromptAssembler
from animama.app.chat.options import DirectChatOptions
from animama.app.safety.prompts import COMPANION_GUARDRAILS
from animama.server.gemini_tts_service import GeminiFinalizedSpeech, _interaction_request


@pytest.mark.parametrize(
    ("ui_locale", "name", "speech_code"),
    [
        ("ja", "Japanese", "ja"),
        ("ko", "Korean", "ko"),
        ("zh-Hans", "Simplified Chinese", "zh"),
        ("zh-Hant", "Traditional Chinese", "zh"),
    ],
)
def test_each_non_english_locale_names_its_language_and_speech_code(ui_locale, name, speech_code) -> None:
    language = conversation_language(ui_locale)
    assert language is not None
    assert (language.locale, language.name, language.speech_code) == (ui_locale, name, speech_code)


@pytest.mark.parametrize("ui_locale", [None, "", "en", "en-XA", "fr", "ja-JP"])
def test_english_unset_pseudo_and_unknown_locales_keep_the_default(ui_locale) -> None:
    assert conversation_language(ui_locale) is None


def _system_text(**kwargs) -> str:
    prompt = DirectChatPromptAssembler().assemble(user_message="hi", anima_identity="Identity", **kwargs)
    content = prompt.messages[0]["content"]
    assert isinstance(content, str)
    return content


@pytest.mark.parametrize("instruction_style", ["default", INSTRUCTION_STYLE_ANTHROPIC])
def test_a_conversation_language_asks_for_replies_in_it_before_the_guardrails(instruction_style) -> None:
    system = _system_text(conversation_language=conversation_language("ko"), instruction_style=instruction_style)

    section = system.index("# Conversation Language")
    assert "Write every reply in Korean" in system
    assert system.index("# Response Guidance") < section < system.index(COMPANION_GUARDRAILS.strip())


def test_without_a_conversation_language_the_prompt_has_no_language_section() -> None:
    assert "# Conversation Language" not in _system_text()
    assert "# Conversation Language" not in _system_text(instruction_style=INSTRUCTION_STYLE_ANTHROPIC)


def test_speech_takes_the_language_code_unless_the_request_chose_one() -> None:
    japanese = conversation_language("ja")
    speaking = DirectChatOptions.from_value({"tts": {"enabled": True, "provider": "gemini"}})
    chosen = DirectChatOptions.from_value({"tts": {"enabled": True, "provider": "gemini", "language_code": "en"}})
    silent = DirectChatOptions.from_value({})

    tts = with_speech_language(speaking, japanese).tts
    assert tts is not None and tts.language_code == "ja"
    assert with_speech_language(chosen, japanese) == chosen
    assert with_speech_language(silent, japanese) == silent
    assert with_speech_language(speaking, None) == speaking


@pytest.mark.parametrize(
    ("language_code", "expected"), [("zh", {"voice": "Kore", "language": "zh"}), (None, {"voice": "Kore"})]
)
def test_gemini_speech_config_carries_the_language_only_when_set(language_code, expected) -> None:
    prepared = GeminiFinalizedSpeech(
        run_id="run",
        voice_id="Kore",
        model_id="gemini-3.8-flash-lite-tts",
        text="你好。",
        style=None,
        language_code=language_code,
    )
    assert _interaction_request(prepared)["generation_config"]["speech_config"] == [expected]
