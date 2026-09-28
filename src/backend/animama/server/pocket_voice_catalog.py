"""Compatibility exports for the shared Pocket voice catalog validator."""

from animama.app.services.pocket_voice_catalog import (
    REQUIRED_BASE_VOICE_KEY,
    VOICE_EMBEDDING_DIM,
    VOICE_NAME_BYTES,
    ParsedPocketVoiceCatalogEntry,
    parse_pocket_voice_catalog_bytes,
    validate_pocket_voice_catalog_bytes,
)

__all__ = [
    "ParsedPocketVoiceCatalogEntry",
    "REQUIRED_BASE_VOICE_KEY",
    "VOICE_EMBEDDING_DIM",
    "VOICE_NAME_BYTES",
    "parse_pocket_voice_catalog_bytes",
    "validate_pocket_voice_catalog_bytes",
]
