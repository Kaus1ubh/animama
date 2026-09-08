"""Bounded local runtime-context and first-run schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from .base import Base
from .user_profile import DisplayName


class PyRuntimeContext(Base):
    schema_version: Literal[1] = 1
    principal_id: str
    bootstrap_status: Literal["ready", "repair_required"]
    failed_steps: list[Literal["local_profile", "user_settings", "profile_memory", "starter_animas"]]
    first_run_complete: bool
    display_name: str | None


class PyOnboardingCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: DisplayName


__all__ = ["PyOnboardingCompleteRequest", "PyRuntimeContext"]
