"""Model role resolution for application compositions.

Whether the owner's App Settings role assignments apply is a composition input:
the local composition enables owner models and roles through its
``ModelCatalogPolicy``; any other composition uses only operator defaults from
the environment.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.settings_repo import SQLAlchemyUserSettingsRepository
from animama.app.services.model_provider_catalog_service import ModelCatalogPolicy
from animama.app.services.model_role_resolver import ModelRoleDefaults, ModelRoleResolver
from animama.server.config import Settings, settings


def composition_model_policy(app: Any) -> ModelCatalogPolicy:
    """Return the composition's model policy; owner models and roles are off unless it enables them."""

    policy = getattr(app.state, "model_catalog_policy", None)
    return policy if isinstance(policy, ModelCatalogPolicy) else ModelCatalogPolicy()


def model_role_defaults(app_settings: Settings = settings) -> ModelRoleDefaults:
    return ModelRoleDefaults(
        chat=app_settings.anima_default_model_provider_id,
        utility=app_settings.anima_default_utility_model_provider_id,
        memory_manager=app_settings.anima_default_memory_manager_model_provider_id,
        embeddings=app_settings.anima_default_embedding_model_provider_id,
    )


@dataclass(frozen=True, slots=True)
class ModelRoleSettings:
    """Composition inputs for resolving model roles."""

    owner_roles_enabled: bool
    # The process settings unless the composition supplies its own.
    app_settings: Settings = field(default_factory=lambda: settings)

    @classmethod
    def for_app(cls, app: Any) -> ModelRoleSettings:
        runtime_settings = getattr(app.state, "runtime_settings", None)
        return cls(
            owner_roles_enabled=composition_model_policy(app).owner_models_enabled,
            app_settings=runtime_settings if isinstance(runtime_settings, Settings) else settings,
        )

    def resolver(self, session: AsyncSession) -> ModelRoleResolver:
        """Resolve roles from App Settings when enabled, falling back to operator defaults."""

        return ModelRoleResolver(
            model_providers=SQLAlchemyModelProviderRepository(session),
            user_settings=SQLAlchemyUserSettingsRepository(session),
            defaults=model_role_defaults(self.app_settings),
            owner_roles_enabled=self.owner_roles_enabled,
        )


def get_model_role_settings(request: Request) -> ModelRoleSettings:
    """FastAPI dependency: the requesting composition's role settings."""

    return ModelRoleSettings.for_app(request.app)


__all__ = [
    "ModelRoleSettings",
    "composition_model_policy",
    "get_model_role_settings",
    "model_role_defaults",
]
