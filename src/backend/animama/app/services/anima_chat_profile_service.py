from __future__ import annotations

from typing import Any

from animama.domain import AnimaChatProfile
from animama.domain.model_connection import MODEL_KIND_CHAT
from animama.logging import get_logger

from ..ports import AnimaChatProfileRepository, ModelProviderRepository, UnitOfWork


class AnimaChatProfileService:
    """Resolve and update anima-level direct chat model selection."""

    def __init__(
        self,
        *,
        profiles: AnimaChatProfileRepository,
        model_providers: ModelProviderRepository,
        uow: UnitOfWork | None = None,
    ) -> None:
        self._profiles = profiles
        self._model_providers = model_providers
        self._uow = uow
        self._log = get_logger("app.services.anima_chat_profile")

    async def resolve_for_anima(self, anima_id: str) -> AnimaChatProfile | None:
        return await self._profiles.get(anima_id)

    async def set_default_model_provider(
        self,
        *,
        anima_id: str,
        model_provider_id: str,
        metadata_patch: dict[str, Any] | None = None,
    ) -> AnimaChatProfile:
        model_provider = await self._model_providers.get(model_provider_id)
        if model_provider is None or not model_provider.active:
            raise ValueError("Default model provider must reference an active catalog row")
        if model_provider.model_kind != MODEL_KIND_CHAT:
            raise ValueError("Default model provider must be a chat model")

        current = await self._profiles.get(anima_id)
        metadata = dict(current.metadata or {}) if current is not None else {}
        if metadata_patch:
            metadata.update(metadata_patch)
        stored = await self._profiles.upsert(
            AnimaChatProfile(
                anima_id=anima_id,
                default_model_provider_id=model_provider_id,
                metadata=metadata,
                created_at=current.created_at if current is not None else None,
                updated_at=current.updated_at if current is not None else None,
            )
        )
        if self._uow is not None:
            await self._uow.commit()
        self._log.info(
            "Anima chat profile default model provider set",
            anima_id=anima_id,
            model_provider_id=model_provider_id,
        )
        return stored


__all__ = ["AnimaChatProfileService"]
