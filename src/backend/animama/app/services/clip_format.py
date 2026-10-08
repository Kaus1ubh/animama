"""Gesture and Reaction clip-format admission.

``animaPoseClip/2.0`` is the only clip format. The retired
``animaPoseClip/1.0`` and any other schema are rejected with one clear,
user-facing reason, never converted (ADR 0016). The frontend shows the same
wording (``unsupportedAnimaPoseClipFormatMessage`` in ``parseClip.ts``).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from animama.domain.content_catalog import ContentDiagnostic, ContentKind
from animama.domain.content_documents import GestureDocumentV1, ReactionDocumentV1

ANIMA_POSE_CLIP_SCHEMA = "animaPoseClip/2.0"
RETIRED_ANIMA_POSE_CLIP_SCHEMA = "animaPoseClip/1.0"
CLIP_FORMAT_UNSUPPORTED = "clip_format_unsupported"
# Fixed package-import reason: the HTTP boundary never echoes submitted data.
PACKAGE_CLIP_FORMAT_HINT = (
    f"This package contains a clip in an unsupported format, such as the retired "
    f"{RETIRED_ANIMA_POSE_CLIP_SCHEMA}. Only {ANIMA_POSE_CLIP_SCHEMA} clips can be imported or exported."
)
"""The package router's message for ``CLIP_FORMAT_UNSUPPORTED``; frontend
``lib/content-sharing/errors.ts`` shows the same text."""


def unsupported_clip_format_message(schema: object) -> str:
    """Return why a clip with this schema cannot be played, edited or imported."""

    if schema == RETIRED_ANIMA_POSE_CLIP_SCHEMA:
        return (
            f"This clip uses the retired {RETIRED_ANIMA_POSE_CLIP_SCHEMA} format, which is no longer "
            f"supported. Only {ANIMA_POSE_CLIP_SCHEMA} clips can be played, edited or imported."
        )
    # Name only a short, printable schema: diagnostics are persisted and shown.
    nameable = isinstance(schema, str) and 0 < len(schema) <= 64 and schema.isprintable()
    named = f' "{schema}"' if nameable else ""
    return f"Unsupported clip format{named}. Only {ANIMA_POSE_CLIP_SCHEMA} clips can be played, edited or imported."


def clip_format_diagnostic(value: Any, path: str | None = None) -> ContentDiagnostic | None:
    """Return a diagnostic when a parsed clip document is not ``animaPoseClip/2.0``."""

    schema = value.get("schema") if isinstance(value, dict) else None
    if schema == ANIMA_POSE_CLIP_SCHEMA:
        return None
    return ContentDiagnostic(CLIP_FORMAT_UNSUPPORTED, unsupported_clip_format_message(schema), path)


def validate_action_clip_files(
    document: GestureDocumentV1 | ReactionDocumentV1, files: Mapping[str, Path]
) -> tuple[ContentDiagnostic, ...]:
    """Reject an ``anima_clip`` Action whose clip is in another format.

    The clip is the Action's sequence file (``file_role``, ``sequence`` when
    omitted). A legacy Action whose motion is a retired standalone Pose Clip
    (always ``animaPoseClip/1.0``) is rejected too. Unreadable or malformed
    files are left to the companion-file checks, which already report them.
    """

    implementation = document.implementation
    if implementation.kind != "anima_clip":
        return ()
    if implementation.content_dependency_ref and any(
        dependency.kind is ContentKind.POSE_CLIP
        and implementation.content_dependency_ref in {dependency.ref, dependency.alias}
        for dependency in document.dependencies
    ):
        return (
            ContentDiagnostic(CLIP_FORMAT_UNSUPPORTED, unsupported_clip_format_message(RETIRED_ANIMA_POSE_CLIP_SCHEMA)),
        )
    role = implementation.file_role or "sequence"
    # A descriptor that lists no files lets the scanner infer the clip's role,
    # so every companion is a candidate.
    candidates = (
        [declared.path for declared in document.files if declared.role == role] if document.files else list(files)
    )
    diagnostics: list[ContentDiagnostic] = []
    for relative in candidates:
        path = files.get(relative)
        if path is None:
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        diagnostic = clip_format_diagnostic(value, relative)
        if diagnostic is not None:
            diagnostics.append(diagnostic)
    return tuple(diagnostics)


__all__ = [
    "ANIMA_POSE_CLIP_SCHEMA",
    "CLIP_FORMAT_UNSUPPORTED",
    "PACKAGE_CLIP_FORMAT_HINT",
    "RETIRED_ANIMA_POSE_CLIP_SCHEMA",
    "clip_format_diagnostic",
    "unsupported_clip_format_message",
    "validate_action_clip_files",
]
