"""Pure rules for an Avatar's ``animama/avatar-face-parts/1`` correction.

A correction names glTF primitives that are meaningful only for one exact VRM
file, so every effective value is gated on the Avatar's current model digest.
These helpers stay free of persistence so the content registry, typed views,
runtime projection and package export apply the same rule.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from animama.app.contracts.avatar_face_parts import AvatarFacePartCorrection, AvatarFacePartsSource
from animama.app.ports.avatar_face_parts import AvatarFacePartOverride
from animama.domain.content_catalog import CatalogContentEntry, CatalogContentFile, ContentSource
from animama.domain.content_documents import AvatarDocumentV1, ContentDocumentError


@dataclass(frozen=True, slots=True)
class EffectiveFaceParts:
    """The correction a viewer of one Avatar revision should apply, and where it came from."""

    source: AvatarFacePartsSource
    face_parts: dict[str, Any] | None = None


def normalize_face_parts(raw: object, *, field: str = "face_parts") -> dict[str, Any]:
    """Validate one correction and return its canonical JSON form.

    Raises ``ContentDocumentError`` with code ``avatar_face_parts_invalid`` so a
    malformed sidecar is a normal content diagnostic, not a server error.
    """

    try:
        correction = AvatarFacePartCorrection.model_validate(raw)
    except ValidationError as exc:
        errors = exc.errors()
        location = ".".join(str(part) for part in errors[0]["loc"]) if errors else ""
        raise ContentDocumentError(
            "avatar_face_parts_invalid",
            "face_parts must be a valid animama/avatar-face-parts/1 correction",
            field=f"{field}.{location}" if location else field,
        ) from exc
    return correction_json(correction)


def correction_json(correction: AvatarFacePartCorrection) -> dict[str, Any]:
    """Dump a correction deterministically; unknown optional parts are omitted."""

    return correction.model_dump(mode="json", by_alias=True, exclude_none=True)


def model_sha256(files: Iterable[CatalogContentFile | Mapping[str, Any]]) -> str | None:
    """Return the sha256 of the single registered ``model`` file, if exactly one exists."""

    digests = [
        (file.get("sha256") if isinstance(file, Mapping) else file.sha256)
        for file in files
        if (file.get("role") if isinstance(file, Mapping) else file.role) == "model"
    ]
    return digests[0] if len(digests) == 1 and isinstance(digests[0], str) else None


def matching_correction(value: Mapping[str, Any] | None, *, model_digest: str | None) -> dict[str, Any] | None:
    """Return ``value`` only when it targets exactly this model's bytes."""

    if value is None or model_digest is None or value.get("vrm_sha256") != model_digest:
        return None
    return dict(value)


def local_face_parts(
    *,
    source: ContentSource,
    document_face_parts: Mapping[str, Any] | None,
    files: Iterable[CatalogContentFile | Mapping[str, Any]],
) -> dict[str, Any] | None:
    """Effective sidecar correction of a Local Avatar; Included sidecars are not editable."""

    if source is not ContentSource.LOCAL:
        return None
    return matching_correction(document_face_parts, model_digest=model_sha256(files))


def override_face_parts(
    *,
    revision_sha256: str | None,
    files: Iterable[CatalogContentFile | Mapping[str, Any]],
    override_revision_sha256: str,
    override_parts: Mapping[str, Any],
) -> dict[str, Any] | None:
    """Effective owner override: the exact current revision and model bytes only.

    A stale override (the Avatar changed since it was saved) is ignored, never
    applied to different bytes.
    """

    if revision_sha256 is None or override_revision_sha256 != revision_sha256:
        return None
    return matching_correction(override_parts, model_digest=model_sha256(files))


def effective_face_parts(
    *,
    item: CatalogContentEntry,
    document: AvatarDocumentV1,
    override: AvatarFacePartOverride | None,
) -> EffectiveFaceParts:
    """Resolve Local sidecar or owner override authority for one current Avatar item.

    ``override`` must already be scoped to the requesting owner.
    """

    if item.source is ContentSource.LOCAL:
        local = local_face_parts(source=item.source, document_face_parts=document.face_parts, files=item.files)
        return EffectiveFaceParts("local_metadata", local) if local is not None else EffectiveFaceParts("none")
    if override is not None:
        included = override_face_parts(
            revision_sha256=item.revision_sha256,
            files=item.files,
            override_revision_sha256=override.avatar_revision_sha256,
            override_parts=override.parts,
        )
        if included is not None:
            return EffectiveFaceParts("included_override", included)
    return EffectiveFaceParts("none")


__all__ = [
    "EffectiveFaceParts",
    "correction_json",
    "effective_face_parts",
    "local_face_parts",
    "matching_correction",
    "model_sha256",
    "normalize_face_parts",
    "override_face_parts",
]
