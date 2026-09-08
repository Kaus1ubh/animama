"""Concrete player lanes used by resolved runtime content."""

from __future__ import annotations

from enum import Enum


class RuntimeContentSlot(str, Enum):
    """Concrete player destination for resolved typed content."""

    PRIMARY_MODEL = "primary_model"
    IDLE_ANIMATION = "idle_animation"
    GESTURE = "gesture"
    POSE = "pose"
    REACTION = "reaction"
    PARTICLE_VFX = "particle_vfx"
    AVATAR_VFX = "avatar_vfx"
    SCENE_BACKGROUND_VFX = "scene_background_vfx"
    SCENE_FOCUS_VFX = "scene_focus_vfx"
    BACKGROUND_IMAGE = "background_image"
    PROFILE_IMAGE = "profile_image"
    SFX = "sfx"
    BGM = "bgm"


__all__ = ["RuntimeContentSlot"]
