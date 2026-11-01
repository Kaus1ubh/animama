"""Pure rules for an owner's per-Avatar settings (wind, wind strength and materials).

The settings live in ``avatar_setting_overrides``, never in a Local sidecar. A
package is the one document that carries them: export writes the exporter's
stored values into the Avatar's package sidecar as ``spring_mode``,
``wind_strength`` and ``material_mode``, and import moves them into the
importer's table. These helpers stay free of persistence so the content
registry, the settings service and package export and import apply the same
rule.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from animama.app.contracts.avatar_settings import (
    AUTOMATIC,
    AVATAR_MATERIAL_MODES,
    AVATAR_SPRING_MODES,
    DEFAULT_WIND_STRENGTH,
    MAX_WIND_STRENGTH,
    MIN_WIND_STRENGTH,
    AvatarSettingsState,
)
from animama.app.ports.avatar_settings import AvatarSettingField, AvatarSettingOverride, AvatarSettingValue
from animama.domain.content_documents import AvatarDocumentV1, ContentDocumentError

AVATAR_SETTING_FIELDS: tuple[AvatarSettingField, ...] = ("spring_mode", "wind_strength", "material_mode")
_MODES: dict[str, frozenset[str]] = {
    "spring_mode": AVATAR_SPRING_MODES,
    "material_mode": AVATAR_MATERIAL_MODES,
}


def stored_setting(value: AvatarSettingValue | None) -> AvatarSettingValue | None:
    """Return the stored form of a valid value: Automatic (and the default wind strength) is the absence of one."""

    return None if value is None or value == AUTOMATIC or value == DEFAULT_WIND_STRENGTH else value


def document_mode(raw: object, *, field: AvatarSettingField) -> str | None:
    """Validate one document mode setting and return its stored form (``None`` for Automatic).

    Raises ``ContentDocumentError`` with code ``avatar_setting_invalid`` so a
    malformed package or sidecar value is a normal content diagnostic.
    """

    if raw is None:
        return None
    allowed = _MODES[field]
    if not isinstance(raw, str) or raw not in allowed:
        raise ContentDocumentError(
            "avatar_setting_invalid", f"{field} must be one of: {', '.join(sorted(allowed))}", field=field
        )
    return None if raw == AUTOMATIC else raw


def document_wind_strength(raw: object) -> int | None:
    """Validate a document's wind strength (whole percent) and return its stored form (``None`` for 100)."""

    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int) or not MIN_WIND_STRENGTH <= raw <= MAX_WIND_STRENGTH:
        raise ContentDocumentError(
            "avatar_setting_invalid",
            f"wind_strength must be a whole number from {MIN_WIND_STRENGTH} to {MAX_WIND_STRENGTH}",
            field="wind_strength",
        )
    return None if raw == DEFAULT_WIND_STRENGTH else raw


def strip_document_settings(document: dict[str, Any]) -> bool:
    """Remove any setting keys from a sidecar object in place; report whether one was present."""

    present = any(name in document for name in AVATAR_SETTING_FIELDS)
    for name in AVATAR_SETTING_FIELDS:
        document.pop(name, None)
    return present


def _present(
    values: Mapping[AvatarSettingField, AvatarSettingValue | None],
) -> dict[AvatarSettingField, AvatarSettingValue]:
    return {name: value for name, value in values.items() if value is not None}


def document_settings(document: AvatarDocumentV1) -> dict[AvatarSettingField, AvatarSettingValue]:
    """The non-Automatic settings a parsed (package) Avatar document carries."""

    return _present(
        {
            "spring_mode": document.spring_mode,
            "wind_strength": document.wind_strength,
            "material_mode": document.material_mode,
        }
    )


def override_settings(override: AvatarSettingOverride | None) -> dict[AvatarSettingField, AvatarSettingValue]:
    """The stored non-Automatic settings of one row, in their document form."""

    if override is None:
        return {}
    return _present(
        {
            "spring_mode": override.spring_mode,
            "wind_strength": override.wind_strength,
            "material_mode": override.material_mode,
        }
    )


def settings_state(item_id: str, override: AvatarSettingOverride | None) -> AvatarSettingsState:
    """The effective settings of one Avatar: each stored value, else Automatic by default."""

    stored = override_settings(override)

    def effective(name: AvatarSettingField, default: AvatarSettingValue) -> dict[str, Any]:
        value = stored.get(name)
        return {name: default if value is None else value, f"{name}_source": "default" if value is None else "stored"}

    return AvatarSettingsState.model_validate(
        {
            "item_id": item_id,
            **effective("spring_mode", AUTOMATIC),
            **effective("wind_strength", DEFAULT_WIND_STRENGTH),
            **effective("material_mode", AUTOMATIC),
        }
    )


__all__ = [
    "AVATAR_SETTING_FIELDS",
    "document_mode",
    "document_settings",
    "document_wind_strength",
    "override_settings",
    "settings_state",
    "stored_setting",
    "strip_document_settings",
]
