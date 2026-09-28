"""Admission rules for durable Pocket clones in the existing Voice library."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path, PurePosixPath

from animama.domain.content_catalog import ContentDiagnostic
from animama.domain.content_documents import ContentDocumentError, VoiceDocumentV1

from .content_audio import validate_audio_stream
from .content_file_validation import ContentFileInvalidError
from .pocket_voice_catalog import MAX_POCKET_VOICE_CATALOG_BYTES, validate_pocket_voice_catalog_bytes

POCKET_CLONE_CODEC = "pocket-tts-catalog-v1"
MAX_POCKET_SOURCE_BYTES = 25 * 1024 * 1024
POCKET_SOURCE_EXTENSIONS = frozenset({".wav", ".mp3", ".ogg"})


def validate_pocket_clone_document(document: VoiceDocumentV1) -> None:
    """Keep one retained recording and one neutral catalog under stable roles."""

    if document.codec != POCKET_CLONE_CODEC:
        return
    roles = {file.role: file.path for file in document.files}
    if len(document.files) != 2 or set(roles) != {"source_sample", "pocket_voice_catalog"}:
        raise ContentDocumentError(
            "pocket_clone_files_invalid", "A Pocket clone requires its source sample and catalog"
        )
    if PurePosixPath(roles["source_sample"]).suffix.lower() not in POCKET_SOURCE_EXTENSIONS:
        raise ContentDocumentError("pocket_clone_source_invalid", "Pocket clone samples must be WAV, MP3, or Ogg")
    if PurePosixPath(roles["pocket_voice_catalog"]).suffix.lower() != ".bin":
        raise ContentDocumentError("pocket_clone_catalog_invalid", "Pocket clone catalogs must be .bin files")
    if document.voices != ("neutral",):
        raise ContentDocumentError("pocket_clone_voices_invalid", "A Pocket clone must contain one neutral voice")


def validate_pocket_clone_files(
    document: VoiceDocumentV1,
    files: Mapping[str, Path],
) -> tuple[ContentDiagnostic, ...]:
    """Validate exact companion membership and bounded bytes on Save and scan."""

    if document.codec != POCKET_CLONE_CODEC:
        return ()
    expected = {file.path: file.role for file in document.files}
    if set(files) != set(expected):
        return (ContentDiagnostic("pocket_clone_files_invalid", "Pocket clone files must match the descriptor"),)
    diagnostics: list[ContentDiagnostic] = []
    for name, role in expected.items():
        path = files[name]
        try:
            size = path.stat().st_size
            limit = MAX_POCKET_SOURCE_BYTES if role == "source_sample" else MAX_POCKET_VOICE_CATALOG_BYTES
            if not 0 < size <= limit:
                diagnostics.append(
                    ContentDiagnostic(
                        "pocket_clone_file_size", "Pocket clone files must be nonempty and at most 25 MiB", name
                    )
                )
                continue
            with path.open("rb") as stream:
                if role == "source_sample":
                    validate_audio_stream(extension=PurePosixPath(name).suffix, content=stream, size_bytes=size)
                else:
                    voices = validate_pocket_voice_catalog_bytes(stream.read(limit + 1))
                    if set(voices) != {"neutral"}:
                        raise ValueError("A Pocket clone must contain only the neutral voice")
        except ContentFileInvalidError as exc:
            diagnostics.append(ContentDiagnostic(exc.reason, "Pocket clone sample failed audio validation", name))
        except OSError:
            diagnostics.append(
                ContentDiagnostic("pocket_clone_file_invalid", "Pocket clone file could not be read", name)
            )
        except ValueError as exc:
            diagnostics.append(ContentDiagnostic("pocket_clone_file_invalid", str(exc), name))
    return tuple(diagnostics)
