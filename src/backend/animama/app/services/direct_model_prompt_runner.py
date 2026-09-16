"""Shared prompt-only model-client runner for backend maintenance tasks."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from animama.app.model_clients import (
    ModelClientDelta,
    ModelClientError,
    ModelClientFinal,
    ModelClientProviderOptions,
    ModelClientRegistry,
    ModelClientRequest,
)
from animama.app.model_clients.prompt import direct_model_prompt
from animama.app.ports import ModelProviderRepository
from animama.domain import ModelProvider
from animama.domain.usage import Usage
from animama.utils.type_helpers import coerce_provider_type


@dataclass(frozen=True, slots=True)
class DirectModelPromptResult:
    """Collected text result from one prompt-only model-client run."""

    text: str
    usage: Usage | None
    model_provider: ModelProvider


@dataclass(frozen=True, slots=True)
class DirectModelPromptRequest:
    """Request for a backend-owned prompt-only model-client run."""

    anima_id: str
    user_id: str
    chat_id: str
    prompt: str
    task: str
    model_provider: str
    model: str
    run_id: str | None = None
    instructions: str | None = None
    prompt_version: str | None = None
    request_options: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))


class DirectModelPromptRunner:
    """Resolve a durable catalog row and stream a prompt through a shared model client."""

    def __init__(
        self,
        *,
        registry: ModelClientRegistry,
        model_providers: ModelProviderRepository,
    ) -> None:
        self._registry = registry
        self._model_providers = model_providers

    async def run_prompt(self, request: DirectModelPromptRequest) -> DirectModelPromptResult:
        provider = await self._resolve_model_provider(
            model_provider=request.model_provider,
            model=request.model,
        )
        if not provider.active:
            raise ValueError(f"Model provider is inactive: {provider.id}")
        client = self._registry.get(provider.provider_type)
        if client is None:
            raise ValueError(f"No model client registered for provider type {provider.provider_type!r}")
        run_id = request.run_id or f"{request.task}-{uuid.uuid4().hex}"
        model_request = ModelClientRequest(
            model_provider=provider,
            prompt=_prompt_context(request, run_id=run_id),
            provider_options=ModelClientProviderOptions(),
        )
        final = await _collect_final(client.stream(model_request))
        if final is None:
            raise ModelClientError("Model client did not return a final response", code="model_client_missing_final")
        return DirectModelPromptResult(
            text=final.text,
            usage=final.usage,
            model_provider=provider,
        )

    async def _resolve_model_provider(self, *, model_provider: str, model: str) -> ModelProvider:
        provider_type = str(coerce_provider_type(model_provider) or model_provider).strip()
        model_name = str(model or "").strip()
        if not provider_type:
            raise ValueError("Model provider is required")
        if not model_name:
            raise ValueError("Model is required")
        row = await self._model_providers.get_by_provider_model(provider_type, model_name)
        if row is None:
            row = await self._model_providers.get(f"{provider_type}:{model_name}")
        if row is None:
            raise ValueError(f"Model provider catalog row not found: {provider_type}:{model_name}")
        return row


def _prompt_context(request: DirectModelPromptRequest, *, run_id: str) -> Any:
    return direct_model_prompt(
        prompt=request.prompt,
        instructions=request.instructions,
        metadata={
            "context_source": "direct_model_prompt",
            "task": request.task,
            "prompt_version": request.prompt_version,
            "run_id": run_id,
        },
    )


async def _collect_final(stream: Any) -> ModelClientFinal | None:
    parts: list[str] = []
    raw_metadata: dict[str, Any] = {}
    try:
        async for delta in stream:
            if not isinstance(delta, ModelClientDelta):
                continue
            if delta.kind == "text_delta" and isinstance(delta.text, str):
                parts.append(delta.text)
                raw_metadata.update(dict(delta.raw_metadata))
            elif delta.kind == "event":
                continue
            elif delta.kind == "final" and delta.final is not None:
                return delta.final
            elif delta.kind == "error":
                raise ModelClientError(
                    delta.error or "Model client stream failed",
                    code="model_client_error",
                    raw_metadata=delta.raw_metadata,
                )
    except asyncio.CancelledError:
        raise
    if parts:
        return ModelClientFinal(
            text="".join(parts),
            usage=Usage(),
            raw_provider_metadata={**raw_metadata, "final_missing": True},
        )
    return None


__all__ = [
    "DirectModelPromptRequest",
    "DirectModelPromptResult",
    "DirectModelPromptRunner",
]
