"""An Anima can carry its encoded Pocket clone, never the retained recording."""

from __future__ import annotations

import hashlib
import io
import json
import struct
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from animama.app.contracts.content_package import PackageManifest, portable_revision
from animama.app.services.content_kind_registry import handler_for_kind, media_type_for
from animama.app.services.content_package_capabilities import (
    derive_document_capabilities,
    derive_file_capabilities,
    validate_capabilities,
)
from animama.domain.content_catalog import ContentConflictError, ContentKind, ContentSource, ContentStatus
from animama.domain.content_documents import ContentDocumentError, VoiceDocumentV1
from animama.domain.emotions import TRACKED_EMOTIONS
from tests.anima_creation_service_support import vrm
from tests.test_content_package_v3_archive import inspector, write_package
from tests.test_pocket_voice_content import clone_document, content_store, source_audio, voice_catalog

VOICE_CAPABILITY = "animama/pocket-voice/1"


def _descriptor(*, source_sample: bool = False) -> dict[str, Any]:
    document = {**clone_document(), "id": "voice", "name": "Narrator"}
    if not source_sample:
        document["files"] = [{"path": "voice.bin", "role": "pocket_voice_catalog"}]
    return document


def _voice_document() -> VoiceDocumentV1:
    parsed = handler_for_kind(ContentKind.VOICE).parse_document(
        _descriptor(), fallback_path=Path("voices/narrator"), descriptor_backed=True
    )
    assert isinstance(parsed.document, VoiceDocumentV1)
    return parsed.document


def voice_package(
    *, source_sample: bool = False, catalog: bytes | None = None, codec: str = "pocket-tts-catalog-v1"
) -> tuple[dict[str, Any], dict[str, bytes]]:
    """Produce a complete small Anima archive through the real scanner grammar."""
    descriptor = {**_descriptor(source_sample=source_sample), "codec": codec}
    resources: dict[str, dict[str, tuple[str, bytes]]] = {
        "avatar": {
            "model.vrm": ("model", vrm()),
            "model.meta.json": (
                "metadata",
                json.dumps({"content_id": "avatar", "name": "Avatar"}).encode(),
            ),
        },
        "voice": {
            "narrator.json": ("descriptor", json.dumps(descriptor).encode()),
            "voice.bin": ("pocket_voice_catalog", voice_catalog() if catalog is None else catalog),
        },
    }
    if source_sample:
        resources["voice"]["original.wav"] = ("source_sample", source_audio())
    entries = []
    payloads = {}
    for entry_id, members in resources.items():
        files = []
        for ordinal, (name, (role, payload)) in enumerate(members.items(), 1):
            path = f"entries/{entry_id}/{name}"
            payloads[path] = payload
            files.append(
                {
                    "archive_path": path,
                    "relative_path": name,
                    "role": role,
                    "ordinal": ordinal,
                    "media_type": "model/gltf-binary" if name.endswith(".vrm") else media_type_for(Path(name)),
                    "size_bytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            )
        entries.append(
            {
                "package_entry_id": entry_id,
                "kind": entry_id,
                "logical_key": entry_id,
                "display_name": "Avatar" if entry_id == "avatar" else "Narrator",
                "portable_revision_sha256": portable_revision(files),
                "dependencies": [],
                "files": files,
            }
        )
    return {
        "schema": "animama-content-package/3",
        "kind": "anima",
        "root_entry_ids": [],
        "anima": {
            "display_name": "Shared companion",
            "identity_markdown": "A friendly companion.",
            "avatar": "avatar",
            "gestures": [],
            "reactions": {emotion: {str(level): None for level in (1, 2, 3)} for emotion in TRACKED_EMOTIONS},
            "idle_style": None,
            "pocket_voice": "voice",
            "appearance": {"profile": None, "background": None},
        },
        "entries": entries,
        "avatar_portraits": [],
        "capabilities": ["VRMC_vrm/1.0", VOICE_CAPABILITY],
    }, payloads


def test_archive_accepts_anima_with_only_encoded_neutral_clone(tmp_path: Path) -> None:
    manifest, payloads = voice_package()
    archive = tmp_path / "companion.zip"
    write_package(archive, manifest, payloads)
    inspected = inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    voice = inspected.entries["voice"]
    assert voice.scanned.status is ContentStatus.VALID
    assert set(voice.files) == {"narrator.json", "voice.bin"}
    assert voice.files["voice.bin"].read_bytes() == voice_catalog()
    assert inspected.manifest.anima is not None
    assert ("voice", ContentKind.VOICE) in inspected.manifest.anima.entry_references()


@pytest.mark.parametrize(
    "case", ["standalone", "orphan", "wrong-reference-kind", "ordinary-dependency", "voice-dependency"]
)
def test_voice_can_only_be_referenced_by_complete_anima(case: str) -> None:
    manifest, _ = voice_package()
    if case == "standalone":
        manifest.update(kind="content", root_entry_ids=["voice"], anima=None)
        manifest["entries"] = manifest["entries"][1:]
    elif case == "orphan":
        manifest["anima"]["pocket_voice"] = None
    elif case == "wrong-reference-kind":
        manifest["anima"]["pocket_voice"] = "avatar"
    elif case == "ordinary-dependency":
        manifest["entries"][0]["dependencies"] = [{"ref": "voice", "content_type": "voice"}]
    else:
        manifest["entries"][1]["dependencies"] = [{"ref": "avatar", "content_type": "avatar"}]
    with pytest.raises(ValidationError):
        PackageManifest.model_validate(manifest)


@pytest.mark.parametrize(
    "case", ["missing-capability", "wrong-codec", "source-sample", "malformed-binary", "extra-voice"]
)
def test_archive_rejects_invalid_or_private_voice_material(tmp_path: Path, case: str) -> None:
    manifest, payloads = voice_package(
        source_sample=case == "source-sample",
        codec="legacy-voice" if case == "wrong-codec" else "pocket-tts-catalog-v1",
        catalog=b"unrelated binary" if case == "malformed-binary" else None,
    )
    if case == "missing-capability":
        manifest["capabilities"].remove(VOICE_CAPABILITY)
    elif case == "extra-voice":
        second = struct.pack("<32sII1024f", b"happy", 1, 1024, *([0.0] * 1024))
        manifest, payloads = voice_package(catalog=struct.pack("<I", 2) + voice_catalog()[4:] + second)
    archive = tmp_path / "rejected.zip"
    write_package(archive, manifest, payloads)
    destination = tmp_path / "inspection"
    with pytest.raises(ContentConflictError):
        inspector(tmp_path).inspect(archive, destination=destination)
    assert not destination.exists()
    assert not (tmp_path / "local").exists()


def test_voice_capability_requires_exact_codec_neutral_catalog_and_bytes() -> None:
    document = _voice_document()
    assert derive_document_capabilities(document) == (VOICE_CAPABILITY,)
    assert derive_file_capabilities(ContentKind.VOICE, document, "voice.bin", io.BytesIO(voice_catalog())) == (
        VOICE_CAPABILITY,
    )
    with pytest.raises(ContentDocumentError):
        validate_capabilities([], [VOICE_CAPABILITY])
    for rejected in (replace(document, codec=None), replace(document, voices=("happy",))):
        with pytest.raises(ContentDocumentError):
            derive_document_capabilities(rejected)
    for payload in (b"not a voice", voice_catalog(float("nan")), voice_catalog() + b"trailing"):
        with pytest.raises(ContentDocumentError):
            derive_file_capabilities(ContentKind.VOICE, document, "voice.bin", io.BytesIO(payload))


@pytest.mark.parametrize("source_sample", [False, True])
def test_local_voice_admission_preserves_catalog_only_and_original_clones(tmp_path: Path, source_sample: bool) -> None:
    store = content_store(tmp_path)
    companions = {"voice.bin": voice_catalog()}
    if source_sample:
        companions["original.wav"] = source_audio()
    store.save_descriptor_entry(
        kind=ContentKind.VOICE,
        relative_locator="voices/narrator",
        descriptor=json.dumps(_descriptor(source_sample=source_sample)).encode(),
        companion_files=companions,
        operation_id="clone-copy",
    )
    scanned = store.scan(ContentSource.LOCAL)
    assert len(scanned) == 1 and scanned[0].status is ContentStatus.VALID
    for name, expected in companions.items():
        assert (tmp_path / "local/voices/narrator" / name).read_bytes() == expected
    assert (tmp_path / "local/voices/narrator/original.wav").exists() is source_sample
