"""HTTP schemas for private local display-name personalization."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from animama.app.services.user_profile_service import DISPLAY_NAME_MAX_LENGTH

from .base import Base

DisplayName = Annotated[str, Field(min_length=1, max_length=DISPLAY_NAME_MAX_LENGTH)]


class PyUserProfile(Base):
    display_name: str | None


class PyUserProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: DisplayName


__all__ = ["PyUserProfile", "PyUserProfileUpdate"]
