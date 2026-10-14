"""Audio tags in speech text, against the case file the browser also runs."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import pytest

from animama.domain.audio_tags import (
    AUDIO_TAG_ACCENT_PREFIX,
    AUDIO_TAG_WORD_CLASSES,
    NEUTRAL_AUDIO_TAGS,
    SPEECH_SOUND_CAP,
    ProviderSpeechText,
    classify_audio_tag,
    find_audio_tags,
    opens_with_delivery_tag,
    strip_audio_tags,
)

FIXTURE = Path(__file__).parent / "fixtures" / "audio-tag-cases.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_uses_the_shared_vocabulary() -> None:
    vocabulary = CASES["vocabulary"]
    assert SPEECH_SOUND_CAP == vocabulary["soundCap"]
    assert AUDIO_TAG_ACCENT_PREFIX == vocabulary["accentPrefix"]
    assert [{**asdict(tag), "aliases": list(tag.aliases)} for tag in NEUTRAL_AUDIO_TAGS] == vocabulary["neutral"]
    assert {name: sorted(words) for name, words in AUDIO_TAG_WORD_CLASSES.items()} == vocabulary["wordClasses"]


@pytest.mark.parametrize("row", CASES["classes"], ids=lambda row: row["direction"])
def test_classifies_directions(row: dict[str, str]) -> None:
    assert classify_audio_tag(row["direction"]) == row["class"]


@pytest.mark.parametrize("row", CASES["tagLabels"], ids=lambda row: row["text"])
def test_finds_tags(row: dict[str, object]) -> None:
    assert [tag.label for tag in find_audio_tags(str(row["text"]))] == row["tags"]


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda case: case["id"])
def test_provider_speech_text(case: dict[str, list[str]]) -> None:
    gemini = ProviderSpeechText("gemini")
    elevenlabs = ProviderSpeechText("elevenlabs")
    assert [gemini.prepare(chunk) for chunk in case["chunks"]] == case["gemini"]
    assert [elevenlabs.prepare(chunk) for chunk in case["chunks"]] == case["elevenlabs"]
    assert [strip_audio_tags(chunk) for chunk in case["chunks"]] == case["stripped"]


@pytest.mark.parametrize(
    ("neutral", "alias", "written"),
    [
        (neutral, alias, written)
        for neutral in CASES["vocabulary"]["neutral"]
        for alias in neutral["aliases"]
        for written in (f"[{alias}]", f"<{alias}>", f"[{alias.title()}]")
    ],
)
def test_every_neutral_alias_maps_in_both_syntaxes(neutral: dict[str, str], alias: str, written: str) -> None:
    assert ProviderSpeechText("gemini").prepare(f"{written} Hi.") == f"{neutral['gemini']} Hi."
    assert ProviderSpeechText("elevenlabs").prepare(f"{written} Hi.") == f"{neutral['elevenlabs']} Hi."


def test_only_tag_capable_voices_prepare_tags() -> None:
    with pytest.raises(ValueError):
        ProviderSpeechText("pocket_tts")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("[excited] We won!", True),
        ("  [whispering, playful] Come closer.", True),
        ("<softly> Good night.", True),
        ("[laughs] Oh wow.", False),
        ("[laughs, whispering] Oh.", True),
        ("[sad, laughs] Oh.", True),
        ("[British accent] Hello.", False),
        ("Oh [excited] wow.", False),
        ("[see 2] the chart", False),
        ("", False),
    ],
)
def test_opens_with_delivery_tag(text: str, expected: bool) -> None:
    assert opens_with_delivery_tag(text) is expected
