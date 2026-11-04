"""Server composition helpers for companion safety (spec R2–R8)."""

from __future__ import annotations

from animama.app.safety.crisis_resources import CrisisResourceTable, crisis_resource_table
from animama.server.config import Settings


def runtime_crisis_resources(runtime_settings: Settings) -> CrisisResourceTable:
    return crisis_resource_table(runtime_settings.crisis_resources_path)


__all__ = ["runtime_crisis_resources"]
