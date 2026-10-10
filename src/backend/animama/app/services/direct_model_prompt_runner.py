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
from animama.domain import ModelProvider
from animama.domain.usage import Usage

from .model_role_resolver import ROLE_UTILITY, ModelRoleResolver


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
    role: str = ROLE_UTILITY
    run_id: str | None = None
    instructions: str | None = None
    prompt_version: str | None = None
    request_options: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))


class DirectModelPromptRunner:
    """Run a prompt on the owner's model for a role (utility by default)."""

    def __init__(
        self,
        *,
        registry: ModelClientRegistry,
        role_resolver: ModelRoleResolver,
    ) -> None:
        self._registry = registry
        self._roles = role_resolver

    async def model_provider_for_role(self, user_id: str, role: str = ROLE_UTILITY) -> ModelProvider | None:
        """Return the row a prompt for this role would run on, or ``None`` when the role is off."""

        return (await self._roles.resolve(user_id, role)).model_provider

    async def run_prompt(self, request: DirectModelPromptRequest) -> DirectModelPromptResult:
        resolved = await self._roles.resolve(request.user_id, request.role)
        provider = resolved.model_provider
        if provider is None:
            raise ValueError(f"No model is available for the {request.role} role")
        client = self._registry.get(provider.provider_type)
        if client is None:
            raise ValueError(f"No model client registered for provider type {provider.provider_type!r}")
        run_id = request.run_id or f"{request.task}-{uuid.uuid4().hex}"
        model_request = ModelClientRequest(
            model_provider=provider,
            prompt=_prompt_context(request, run_id=run_id, reasoning_effort=_supported_effort(request, provider)),
            # Adapters apply their Utility defaults to these maintenance prompts.
            provider_options=ModelClientProviderOptions(utility_task=True),
        )
        final = await _collect_final(client.stream(model_request))
        if final is None:
            raise ModelClientError("Model client did not return a final response", code="model_client_missing_final")
        return DirectModelPromptResult(
            text=final.text,
            usage=final.usage,
            model_provider=provider,
        )


def _supported_effort(request: DirectModelPromptRequest, provider: ModelProvider) -> str | None:
    """Send a requested reasoning effort only when the row supports it."""

    effort = request.request_options.get("reasoning_effort")
    if not isinstance(effort, str) or not effort.strip():
        return None
    supported = provider.capabilities.supported_reasoning_efforts or []
    return effort.strip() if provider.capabilities.supports_reasoning and effort.strip() in supported else None


def _prompt_context(request: DirectModelPromptRequest, *, run_id: str, reasoning_effort: str | None) -> Any:
    return direct_model_prompt(
        prompt=request.prompt,
        instructions=request.instructions,
        reasoning_effort=reasoning_effort,
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
