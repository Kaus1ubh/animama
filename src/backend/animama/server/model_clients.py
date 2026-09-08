from __future__ import annotations

import os
from typing import Any

from openai import AsyncOpenAI

from animama.adapters.model_clients import (
    GEMINI_PROVIDER_TYPE,
    LITELLM_PROVIDER_TYPE,
    OPENAI_HTTP_PROVIDER_TYPE,
    OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
    GeminiModelClient,
    LiteLLMModelClient,
    MockModelClient,
    OpenAIChatCompletionsModelClient,
    OpenAIResponsesModelClient,
)
from animama.adapters.model_clients.openai_chat_completions.support import DEFAULT_BASE_URL
from animama.app.model_catalog import DEEPSEEK_BASE_URL, HUGGINGFACE_ROUTER_BASE_URL
from animama.app.model_clients import StaticModelClientRegistry
from animama.server.config import Settings, settings

_STATE_ATTR = "model_client_registry"


def _truthy_env(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def build_model_client_registry(
    *,
    app_settings: Settings = settings,
    openai_client: AsyncOpenAI | None = None,
    gemini_client: Any | None = None,
    litellm_module: Any | None = None,
) -> StaticModelClientRegistry:
    """Build shared model clients for app startup without request-local state."""

    registry = StaticModelClientRegistry()
    if _truthy_env(os.getenv("ANIMAMA_LLM_SKIP")):
        mock_client = MockModelClient()
        for provider_type in (
            OPENAI_HTTP_PROVIDER_TYPE,
            OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
            GEMINI_PROVIDER_TYPE,
            LITELLM_PROVIDER_TYPE,
        ):
            registry.register(provider_type, mock_client)
        registry.register(MockModelClient.PROVIDER_TYPE, mock_client)
        return registry

    openai_base_url = (os.getenv("OPENAI_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
    responses_client = openai_client
    if responses_client is None and app_settings.openai_api_key:
        responses_client = AsyncOpenAI(
            api_key=app_settings.openai_api_key,
            base_url=openai_base_url,
            timeout=app_settings.anima_model_client_timeout_seconds,
        )
    registry.register(
        OPENAI_HTTP_PROVIDER_TYPE,
        OpenAIChatCompletionsModelClient(
            api_key=app_settings.openai_api_key,
            base_url=openai_base_url,
            api_keys_by_base_url={
                DEFAULT_BASE_URL: app_settings.openai_api_key,
                openai_base_url: app_settings.openai_api_key,
                DEEPSEEK_BASE_URL: app_settings.deepseek_api_key,
                HUGGINGFACE_ROUTER_BASE_URL: app_settings.huggingface_api_key,
            },
            client=openai_client,
            timeout=app_settings.anima_model_client_timeout_seconds,
            close_client=True if openai_client is not None else None,
        ),
    )
    registry.register(
        OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
        OpenAIResponsesModelClient(
            api_key=app_settings.openai_api_key,
            base_url=openai_base_url,
            client=responses_client,
            timeout=app_settings.anima_model_client_timeout_seconds,
            compaction_threshold_tokens=app_settings.anima_openai_responses_compaction_threshold_tokens,
            close_client=False if openai_client is not None else True,
        ),
    )
    registry.register(
        GEMINI_PROVIDER_TYPE,
        GeminiModelClient(
            api_key=app_settings.gemini_api_key,
            client=gemini_client,
            timeout=app_settings.anima_model_client_timeout_seconds,
        ),
    )
    registry.register(
        LITELLM_PROVIDER_TYPE,
        LiteLLMModelClient(
            litellm_module=litellm_module,
            timeout=app_settings.anima_model_client_timeout_seconds,
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
    "close_model_client_registry",
    "get_model_client_registry",
    "init_model_client_registry",
]
