"""Settings mappers."""

from __future__ import annotations

from typing import Any

from animama.app.contracts.settings import PyAnimaSettings, PyUserSettings
from animama.domain.settings import AnimaSettings, UserSettings
from animama.orm.settings import ORMAnimaSettings, ORMUserSettings


def user_settings_orm_to_domain(orm: ORMUserSettings) -> UserSettings:
    return UserSettings(
        user_id=orm.user_id,
        theme=orm.theme,
        locale=orm.locale,
        last_active_anima_id=orm.last_active_anima_id,
        preferences=dict(getattr(orm, "preferences", {}) or {}),
        created_at=getattr(orm, "created_at", None),
        updated_at=getattr(orm, "updated_at", None),
    )


def anima_settings_orm_to_domain(orm: ORMAnimaSettings) -> AnimaSettings:
    theme_val = dict(orm.theme) if isinstance(orm.theme, dict) else None
    return AnimaSettings(
        user_id=orm.user_id,
        anima_id=orm.anima_id,
        theme=theme_val,
        background=orm.background,
        favorited=bool(orm.favorited),
        preferences=dict(getattr(orm, "preferences", {}) or {}),
        created_at=getattr(orm, "created_at", None),
        updated_at=getattr(orm, "updated_at", None),
    )


def user_settings_domain_to_orm(settings: UserSettings) -> ORMUserSettings:
    return ORMUserSettings(
        user_id=settings.user_id,
        theme=settings.theme,
        locale=settings.locale,
        last_active_anima_id=settings.last_active_anima_id,
        preferences=dict(settings.preferences or {}),
    )


def anima_settings_domain_to_orm(settings: AnimaSettings) -> ORMAnimaSettings:
    theme_val: dict[str, Any] | None = None
    if isinstance(settings.theme, dict):
        theme_val = dict(settings.theme)
    return ORMAnimaSettings(
        user_id=settings.user_id,
        anima_id=settings.anima_id,
        theme=theme_val,
        background=settings.background,
        favorited=bool(settings.favorited),
        preferences=dict(settings.preferences or {}),
    )


def apply_user_settings_to_orm(orm: ORMUserSettings, settings: UserSettings) -> ORMUserSettings:
    orm.theme = settings.theme
    orm.locale = settings.locale
    orm.last_active_anima_id = settings.last_active_anima_id
    orm.preferences = dict(settings.preferences or {})
    return orm


def apply_anima_settings_to_orm(orm: ORMAnimaSettings, settings: AnimaSettings) -> ORMAnimaSettings:
    orm.theme = dict(settings.theme) if isinstance(settings.theme, dict) else None
    orm.background = settings.background
    orm.favorited = bool(settings.favorited)
    orm.preferences = dict(settings.preferences or {})
    return orm


def user_settings_domain_to_schema(settings: UserSettings) -> PyUserSettings:
    return PyUserSettings(
        user_id=settings.user_id,
        theme=settings.theme,
        locale=settings.locale,
        last_active_anima_id=settings.last_active_anima_id,
        preferences=dict(settings.preferences or {}),
    )


def anima_settings_domain_to_schema(settings: AnimaSettings) -> PyAnimaSettings:
    theme_val = dict(settings.theme) if isinstance(settings.theme, dict) else None
    return PyAnimaSettings(
        user_id=settings.user_id,
        anima_id=settings.anima_id,
        theme=theme_val,
        background=settings.background,
        favorited=bool(settings.favorited),
        preferences=dict(settings.preferences or {}),
    )


__all__ = [
    "user_settings_orm_to_domain",
    "anima_settings_orm_to_domain",
    "user_settings_domain_to_orm",
    "anima_settings_domain_to_orm",
    "apply_user_settings_to_orm",
    "apply_anima_settings_to_orm",
    "user_settings_domain_to_schema",
    "anima_settings_domain_to_schema",
]
