"""Shared Idle Style cell and finite playback HTTP contracts."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class PyIdleNoneCell(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["none"] = "none"


class PyIdlePoolCell(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["pool"] = "pool"
    gestures: list[str] = Field(min_length=1)


PyIdleCell = Annotated[PyIdleNoneCell | PyIdlePoolCell, Field(discriminator="mode")]


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
