from __future__ import annotations

from types import EllipsisType
from typing import Any

from animama.app.ports import AnimaChatProfileRepository, ModelProviderRepository, UnitOfWork
from animama.domain import AnimaChatProfile, ModelProvider
from animama.domain.model_connection import MODEL_KIND_CHAT
from animama.logging import get_logger


class AnimaChatProfileService:
    """Resolve and update anima-level direct chat model and reasoning effort selection."""

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
        reasoning_effort: str | None | EllipsisType = ...,
        metadata_patch: dict[str, Any] | None = None,
    ) -> AnimaChatProfile:
        """Save the anima's chat model and the reasoning effort chosen for it.

        ``reasoning_effort`` left as ``...`` keeps the stored effort while the
        model stays the same and clears it when the model changes, so a new
        model starts at its own default. ``None`` clears it; a string must be
        one of the model's supported efforts.
        """

        model_provider = await self._model_providers.get(model_provider_id)
        if model_provider is None or not model_provider.active:
            raise ValueError("Default model provider must reference an active catalog row")
        if model_provider.model_kind != MODEL_KIND_CHAT:
            raise ValueError("Default model provider must be a chat model")
        if isinstance(reasoning_effort, str):
            _require_offered_effort(model_provider, reasoning_effort)

        current = await self._profiles.get(anima_id)
        effort: str | None
        if isinstance(reasoning_effort, EllipsisType):
            # The same model keeps its effort; a new model starts at its own default.
            effort = (
                current.reasoning_effort
                if current is not None and current.default_model_provider_id == model_provider_id
                else None
            )
        else:
            effort = reasoning_effort
        metadata = dict(current.metadata or {}) if current is not None else {}
        if metadata_patch:
            metadata.update(metadata_patch)
        stored = await self._profiles.upsert(
            AnimaChatProfile(
                anima_id=anima_id,
                default_model_provider_id=model_provider_id,
                reasoning_effort=effort,
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
            reasoning_effort=stored.reasoning_effort,
        )
        return stored


def _require_offered_effort(model_provider: ModelProvider, effort: str) -> None:
    """Reject an effort the model does not list, as a chat turn would."""

    capabilities = model_provider.capabilities
    supported = {str(value).strip() for value in capabilities.supported_reasoning_efforts or ()}
    if not capabilities.supports_reasoning or effort not in supported:
        raise ValueError(f"Model provider does not support reasoning effort {effort}: {model_provider.id}")


__all__ = ["AnimaChatProfileService"]
