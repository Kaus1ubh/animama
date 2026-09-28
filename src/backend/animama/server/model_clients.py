from __future__ import annotations

import os
from typing import Any

from openai import AsyncOpenAI

from animama.adapters.model_clients import (
    OPENAI_HTTP_PROVIDER_TYPE,
    OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
    MockModelClient,
    OpenAIChatCompletionsModelClient,
    OpenAIResponsesModelClient,
)
from animama.adapters.model_clients.openai_chat_completions.support import resolve_openai_base_url
from animama.app.model_clients import StaticModelClientRegistry
from animama.app.model_clients.credentials import EnvironmentModelCredentialResolver, ModelCredentialResolver
from animama.server.config import Settings, settings

_STATE_ATTR = "model_client_registry"


def _truthy_env(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def build_model_credential_resolver(*, app_settings: Settings = settings) -> ModelCredentialResolver:
    """Resolve connection keys from the OpenAI setting and the process environment."""

    return EnvironmentModelCredentialResolver(openai_api_key=app_settings.openai_api_key, environ=os.environ)


def openai_base_url() -> str:
    """Return the built-in OpenAI connection's base URL from the process environment."""

    return resolve_openai_base_url()


def build_model_client_registry(
    *,
    app_settings: Settings = settings,
    openai_client: AsyncOpenAI | None = None,
    credential_resolver: ModelCredentialResolver | None = None,
) -> StaticModelClientRegistry:
    """Build shared model clients for app startup without request-local state."""

    registry = StaticModelClientRegistry()
    if _truthy_env(os.getenv("ANIMAMA_LLM_SKIP")):
        mock_client = MockModelClient()
        for provider_type in (OPENAI_HTTP_PROVIDER_TYPE, OPENAI_RESPONSES_HTTP_PROVIDER_TYPE):
            registry.register(provider_type, mock_client)
        registry.register(MockModelClient.PROVIDER_TYPE, mock_client)
        return registry

    base_url = openai_base_url()
    responses_client = openai_client
    if responses_client is None and app_settings.openai_api_key:
        responses_client = AsyncOpenAI(
            api_key=app_settings.openai_api_key,
            base_url=base_url,
            timeout=app_settings.anima_model_client_timeout_seconds,
        )
    registry.register(
        OPENAI_HTTP_PROVIDER_TYPE,
        OpenAIChatCompletionsModelClient(
            base_url=base_url,
            credential_resolver=credential_resolver or build_model_credential_resolver(app_settings=app_settings),
            client=openai_client,
            timeout=app_settings.anima_model_client_timeout_seconds,
            close_client=True if openai_client is not None else None,
        ),
    )
    registry.register(
        OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
        OpenAIResponsesModelClient(
            api_key=app_settings.openai_api_key,
            base_url=base_url,
            client=responses_client,
            timeout=app_settings.anima_model_client_timeout_seconds,
            compaction_threshold_tokens=app_settings.anima_openai_responses_compaction_threshold_tokens,
            close_client=False if openai_client is not None else True,
        ),
    )
    return registry


async def init_model_client_registry(app: Any, *, app_settings: Settings = settings) -> StaticModelClientRegistry:
    """Attach the process-wide model-client registry to ``app.state``."""

    registry = build_model_client_registry(app_settings=app_settings)
    setattr(app.state, _STATE_ATTR, registry)
    return registry


def get_model_client_registry(app: Any) -> StaticModelClientRegistry | None:
    """Return the app-scoped model-client registry when startup has initialized it."""

    registry = getattr(app.state, _STATE_ATTR, None)
    return registry if isinstance(registry, StaticModelClientRegistry) else None


async def close_model_client_registry(app: Any) -> None:
    """Close and detach the app-scoped model-client registry."""

    registry = get_model_client_registry(app)
    if registry is not None:
        await registry.aclose()
    if hasattr(app.state, _STATE_ATTR):
        delattr(app.state, _STATE_ATTR)


__all__ = [
    "build_model_client_registry",
    "build_model_credential_resolver",
    "close_model_client_registry",
    "get_model_client_registry",
    "init_model_client_registry",
    "openai_base_url",
]
