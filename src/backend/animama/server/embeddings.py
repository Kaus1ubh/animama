"""Embedders for the embeddings model role."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.model_clients.openai_chat_completions.embedder import ConnectionEmbedder
from animama.app.services.model_role_resolver import ROLE_EMBEDDINGS
from animama.domain import ModelProvider
from animama.server.config import Settings, settings
from animama.server.model_clients import build_model_credential_resolver, openai_base_url
from animama.server.model_roles import ModelRoleSettings


def embedder_for_row(model_provider: ModelProvider, *, app_settings: Settings = settings) -> ConnectionEmbedder:
    return ConnectionEmbedder(
        model_provider,
        credential_resolver=build_model_credential_resolver(app_settings=app_settings),
        openai_base_url=openai_base_url(),
        default_timeout_seconds=app_settings.anima_model_client_timeout_seconds,
    )


async def role_embedder(session: AsyncSession, user_id: str, roles: ModelRoleSettings) -> ConnectionEmbedder | None:
    """Return the owner's embeddings-role embedder, or ``None`` while embeddings are off."""

    resolved = await roles.resolver(session).resolve(user_id, ROLE_EMBEDDINGS)
    if resolved.model_provider is None:
        return None
    return embedder_for_row(resolved.model_provider, app_settings=roles.app_settings)


__all__ = ["embedder_for_row", "role_embedder"]
