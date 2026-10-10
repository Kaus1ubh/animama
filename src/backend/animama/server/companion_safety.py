"""Server composition helpers for companion safety (spec R2–R8)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.settings_repo import SQLAlchemyUserSettingsRepository
from animama.app.safety.config import EffectiveCompanionSafety, load_safety_preferences, resolve_companion_safety
from animama.app.safety.crisis_resources import CrisisResourceTable, crisis_resource_table
from animama.server.config import Settings


async def load_effective_companion_safety(
    session: AsyncSession, user_id: str, runtime_settings: Settings
) -> EffectiveCompanionSafety:
    preferences = await load_safety_preferences(SQLAlchemyUserSettingsRepository(session), user_id)
    return resolve_companion_safety(runtime_settings.companion_safety, preferences)


def runtime_crisis_resources(runtime_settings: Settings) -> CrisisResourceTable:
    return crisis_resource_table(runtime_settings.crisis_resources_path)


__all__ = ["load_effective_companion_safety", "runtime_crisis_resources"]
