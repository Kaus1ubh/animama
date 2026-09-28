"""Portable clone selection creates fresh receiver settings and typed local references."""

from dataclasses import replace

import pytest

from animama.app.contracts.portable_anima import PortableAnima
from animama.app.services.portable_anima_service import resolve_portable_anima, rewrite_portable_anima
from animama.domain.content_catalog import ContentConflictError, ContentKind
from tests.test_pocket_voice_content import clone_document
from tests.test_portable_anima import portable_fixture


def voice_definition():
    definition, entries = portable_fixture()
    metadata = clone_document()
    metadata["files"] = [{"path": "voice.bin", "role": "pocket_voice_catalog"}]
    entries["clone"] = replace(entries["model"], id="clone", kind=ContentKind.VOICE, metadata=metadata)
    return PortableAnima.model_validate({**definition.model_dump(), "pocket_voice": "clone"}), entries


def test_portable_clone_rewrites_typed_reference_and_selects_fresh_pocket_settings():
    definition, entries = voice_definition()
    assert ("clone", ContentKind.VOICE) in definition.entry_references()
    resolved = resolve_portable_anima(definition, entries)
    assert resolved.voice_source == entries["clone"]
    assert resolved.speech_preferences == {
        "tts_provider": "pocket_tts",
        "tts_pocket_anima_voice": "eve",
        "tts_pocket_anima_custom_voice_available": False,
        "elevenlabs": {},
    }
    assert resolved.voice_profile is None
    rewritten = rewrite_portable_anima(definition, {"model": "receiver-avatar", "clone": "receiver-clone"})
    assert rewritten.pocket_voice == "receiver-clone"


@pytest.mark.parametrize("change", ["missing", "wrong_kind", "legacy_codec"])
def test_portable_clone_rejects_missing_or_unsupported_voice(change):
    definition, entries = voice_definition()
    if change == "missing":
        del entries["clone"]
    elif change == "wrong_kind":
        entries["clone"] = entries["model"]
    else:
        entries["clone"] = replace(entries["clone"], metadata={**entries["clone"].metadata, "codec": "pcm-f32"})
    with pytest.raises(ContentConflictError):
        resolve_portable_anima(definition, entries)


def test_no_clone_keeps_receiver_voice_defaults():
    definition, entries = portable_fixture()
    resolved = resolve_portable_anima(definition, entries)
    assert resolved.voice_source is None and resolved.speech_preferences is None
