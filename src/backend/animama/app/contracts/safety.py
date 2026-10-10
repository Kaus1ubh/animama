"""Companion-safety resource views shared by every composition (spec R5, R8)."""

from __future__ import annotations

from pydantic import BaseModel

from animama.app.safety.crisis_resources import CrisisResourceRegion


class PyCrisisResourceRegionOption(BaseModel):
    code: str
    label: str


class PyCrisisResources(BaseModel):
    regions: list[PyCrisisResourceRegionOption]
    preferred_region: str | None
    resolved: CrisisResourceRegion


__all__ = ["PyCrisisResourceRegionOption", "PyCrisisResources"]
