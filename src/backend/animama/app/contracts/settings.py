from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from animama.domain.settings import UiLocale

from .base import Base

_LOCALE_DESCRIPTION = "UI Locale for interface text and formatting; null follows the system language."


class PyUserSettings(Base):
    user_id: str
    theme: str = Field(default="anima")
    locale: UiLocale | None = Field(default=None, description=_LOCALE_DESCRIPTION)
    last_active_anima_id: str | None = None
    preferences: dict[str, Any] = Field(default_factory=dict)


class PyUserSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    theme: str | None = None
    locale: UiLocale | None = Field(default=None, description=_LOCALE_DESCRIPTION)
    last_active_anima_id: str | None = None
    preferences: dict[str, Any] | None = None


class PyAnimaSettings(Base):
    user_id: str
    anima_id: str
    theme: dict[str, Any] | None = None
    background: str | None = None
    favorited: bool = False
    preferences: dict[str, Any] = Field(default_factory=dict)


class PyAnimaSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    theme: dict[str, Any] | None = None
    background: str | None = None
    favorited: bool | None = None
    preferences: dict[str, Any] | None = None
