"""Finite idle playback facts shared by Gesture checks and the runtime Idle pool."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PyIdlePlayback(BaseModel):
    """An ineligible candidate has a safe reason; admitted occurrences have all facts."""

    model_config = ConfigDict(extra="forbid")
    eligible: bool
    reason: str | None = None
    cycle_seconds: float | None = Field(default=None, gt=0)
    time_scale: float | None = Field(default=None, gt=0)
    repetitions: int | None = Field(default=None, gt=0)
    duration_seconds: float | None = Field(default=None, gt=0)
    loop_type: Literal["once", "repeat", "pingpong"] | None = None
