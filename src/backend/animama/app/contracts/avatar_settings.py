"""Per-owner Avatar settings: wind and ambient forces, and materials.

Each owner keeps one optional value per setting for each Avatar item, Local and
Included alike, in ``avatar_setting_overrides``. A missing value means
``automatic``. The settings are keyed by owner and Avatar item only, not by
revision or model digest, so an updated Avatar keeps the owner's choice. They
are not part of an Avatar's sidecar, revision or runtime snapshot: saving one
applies live without minting a new Avatar revision.
"""

from __future__ import annotations

from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict

# How the Avatar's spring bones (hair, clothes) move: ``automatic`` applies
# ambient forces unless the model's springs were tuned without them; ``on`` and
# ``off`` force ambient forces on or off; ``springs_off`` holds springs at rest.
type AvatarSpringMode = Literal["automatic", "on", "off", "springs_off"]
# Which materials a lilToon Avatar loads with: ``automatic`` chooses, ``liltoon``
# always builds lilToon materials, ``simple`` builds the standard fallback materials.
type AvatarMaterialMode = Literal["automatic", "liltoon", "simple"]
# ``stored`` is the owner's saved value; ``default`` is Automatic because none is saved.
type AvatarSettingSource = Literal["stored", "default"]

AVATAR_SPRING_MODES: frozenset[str] = frozenset(get_args(AvatarSpringMode.__value__))
AVATAR_MATERIAL_MODES: frozenset[str] = frozenset(get_args(AvatarMaterialMode.__value__))
AUTOMATIC = "automatic"


class AvatarSettingsUpdate(BaseModel):
    """Change some of the owner's settings for one Avatar.

    An omitted field keeps its stored value; ``automatic`` or ``null`` clears it.
    """

    model_config = ConfigDict(extra="forbid")

    spring_mode: AvatarSpringMode | None = None
    material_mode: AvatarMaterialMode | None = None


class AvatarSettingsState(BaseModel):
    """The effective settings for one Avatar and whether each was stored or defaulted."""

    model_config = ConfigDict(extra="forbid")

    item_id: str
    spring_mode: AvatarSpringMode
    spring_mode_source: AvatarSettingSource
    material_mode: AvatarMaterialMode
    material_mode_source: AvatarSettingSource


__all__ = [
    "AUTOMATIC",
    "AVATAR_MATERIAL_MODES",
    "AVATAR_SPRING_MODES",
    "AvatarMaterialMode",
    "AvatarSettingSource",
    "AvatarSettingsState",
    "AvatarSettingsUpdate",
    "AvatarSpringMode",
]
