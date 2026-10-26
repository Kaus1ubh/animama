"""Pure rules for an owner's per-Avatar settings (wind and materials).

The settings live in ``avatar_setting_overrides``, never in a Local sidecar. A
package is the one document that carries them: export writes the exporter's
stored values into the Avatar's package sidecar as ``spring_mode`` and
``material_mode``, and import moves them into the importer's table. These
helpers stay free of persistence so the content registry, the settings service
and package export and import apply the same rule.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from animama.app.contracts.avatar_settings import (
    AUTOMATIC,
    AVATAR_MATERIAL_MODES,
    AVATAR_SPRING_MODES,
    AvatarSettingsState,
)
from animama.app.ports.avatar_settings import AvatarSettingField, AvatarSettingOverride
from animama.domain.content_documents import AvatarDocumentV1, ContentDocumentError

AVATAR_SETTING_FIELDS: tuple[AvatarSettingField, ...] = ("spring_mode", "material_mode")
_ALLOWED: dict[AvatarSettingField, frozenset[str]] = {
    "spring_mode": AVATAR_SPRING_MODES,
    "material_mode": AVATAR_MATERIAL_MODES,
}


def stored_setting(value: str | None) -> str | None:
    """Return the stored form of a valid value: Automatic is the absence of one."""

    return None if value is None or value == AUTOMATIC else value


def document_setting(raw: object, *, field: AvatarSettingField) -> str | None:
    """Validate one document setting and return its stored form (``None`` for Automatic).

    Raises ``ContentDocumentError`` with code ``avatar_setting_invalid`` so a
    malformed package or sidecar value is a normal content diagnostic.
    """

    if raw is None:
        return None
    allowed = _ALLOWED[field]
    if not isinstance(raw, str) or raw not in allowed:
        raise ContentDocumentError(
            "avatar_setting_invalid", f"{field} must be one of: {', '.join(sorted(allowed))}", field=field
        )
    return stored_setting(raw)


def strip_document_settings(document: dict[str, Any]) -> bool:
    """Remove any setting keys from a sidecar object in place; report whether one was present."""

    present = any(name in document for name in AVATAR_SETTING_FIELDS)
    for name in AVATAR_SETTING_FIELDS:
        document.pop(name, None)
    return present


def _present(spring_mode: str | None, material_mode: str | None) -> dict[AvatarSettingField, str]:
    values: Mapping[AvatarSettingField, str | None] = {"spring_mode": spring_mode, "material_mode": material_mode}
    return {name: value for name, value in values.items() if value is not None}


def document_settings(document: AvatarDocumentV1) -> dict[AvatarSettingField, str]:
    """The non-Automatic settings a parsed (package) Avatar document carries."""

    return _present(document.spring_mode, document.material_mode)


def override_settings(override: AvatarSettingOverride | None) -> dict[AvatarSettingField, str]:
    """The stored non-Automatic settings of one row, in their document form."""

    return {} if override is None else _present(override.spring_mode, override.material_mode)


def settings_state(item_id: str, override: AvatarSettingOverride | None) -> AvatarSettingsState:
    """The effective settings of one Avatar: each stored value, else Automatic by default."""

    stored = override_settings(override)
    spring_mode, material_mode = stored.get("spring_mode"), stored.get("material_mode")
    return AvatarSettingsState.model_validate(
        {
            "item_id": item_id,
            "spring_mode": spring_mode or AUTOMATIC,
            "spring_mode_source": "default" if spring_mode is None else "stored",
            "material_mode": material_mode or AUTOMATIC,
            "material_mode_source": "default" if material_mode is None else "stored",
        }
    )


__all__ = [
    "AVATAR_SETTING_FIELDS",
    "document_setting",
    "document_settings",
    "override_settings",
    "settings_state",
    "stored_setting",
    "strip_document_settings",
]
