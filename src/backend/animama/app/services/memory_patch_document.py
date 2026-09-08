"""Render and parse the AI-only document used by native memory Apply Patch."""

from __future__ import annotations

import json
from dataclasses import dataclass

from .memory_entry_service import MemoryEntryValidationError, normalize_memory_entry_description

_DOCUMENT_PREFIX = "---\ndescription: "
_DOCUMENT_SEPARATOR = "\n---\n"


class MemoryPatchDocumentError(ValueError):
    """Raised when a native-patch document violates the reserved header format."""


@dataclass(frozen=True, slots=True)
class ParsedMemoryPatchDocument:
    """Description metadata and Markdown body parsed from one patch document."""

    description: str | None
    content: str


def render_memory_patch_document(*, description: str | None, content: str) -> str:
    """Return the canonical synthetic header followed by the unmodified body."""

    if not isinstance(content, str):
        raise MemoryPatchDocumentError("Memory patch document content must be a string")
    try:
        normalized_description = normalize_memory_entry_description(description)
    except MemoryEntryValidationError as exc:
        raise MemoryPatchDocumentError(exc.detail) from exc
    encoded_description = (
        "null" if normalized_description is None else json.dumps(normalized_description, ensure_ascii=False)
    )
    return f"{_DOCUMENT_PREFIX}{encoded_description}{_DOCUMENT_SEPARATOR}{content}"


def parse_memory_patch_document(document: str) -> ParsedMemoryPatchDocument:
    """Parse only Animama's strict leading description header and Markdown body."""

    if not isinstance(document, str):
        raise MemoryPatchDocumentError("Memory patch document must be a string")
    if not document.startswith(_DOCUMENT_PREFIX):
        raise MemoryPatchDocumentError("Memory patch document must start with the canonical description header")
    separator_index = document.find(_DOCUMENT_SEPARATOR, len(_DOCUMENT_PREFIX))
    if separator_index < 0:
        raise MemoryPatchDocumentError("Memory patch document description header is malformed or unterminated")

    encoded_description = document[len(_DOCUMENT_PREFIX) : separator_index]
    if "\n" in encoded_description or "\r" in encoded_description:
        raise MemoryPatchDocumentError("Memory patch document description must occupy exactly one header line")
    try:
        description = json.loads(encoded_description)
    except json.JSONDecodeError as exc:
        raise MemoryPatchDocumentError("Memory patch document description must be a JSON string or null") from exc
    if description is not None and not isinstance(description, str):
        raise MemoryPatchDocumentError("Memory patch document description must be a JSON string or null")
    try:
        normalized_description = normalize_memory_entry_description(description)
    except MemoryEntryValidationError as exc:
        raise MemoryPatchDocumentError(exc.detail) from exc
    return ParsedMemoryPatchDocument(
        description=normalized_description,
        content=document[separator_index + len(_DOCUMENT_SEPARATOR) :],
    )


__all__ = [
    "MemoryPatchDocumentError",
    "ParsedMemoryPatchDocument",
    "parse_memory_patch_document",
    "render_memory_patch_document",
]
