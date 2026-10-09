"""Capability probe for the built-in Anthropic connection.

Anthropic publishes each model's limits and capabilities through its Models
API, so the probe reads ``models.retrieve`` instead of sending test messages
and spends no tokens. The report uses the same shape as the OpenAI-compatible
probe, so the owner-model flow prefills capabilities the same way.

Failure details are fixed sentences: upstream error text is never copied into
a report, so it can never echo the key.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import Any

import anthropic
from anthropic.types import ModelCapabilities, ModelInfo

from animama.app.model_catalog import STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
from animama.app.model_clients.credentials import ModelCredentialResolver
from animama.app.model_clients.error_categories import (
    ERROR_BAD_REQUEST,
    ERROR_CREDENTIAL_MISSING,
    ERROR_CREDENTIAL_REJECTED,
    ERROR_MODEL_NOT_FOUND,
    ERROR_PROVIDER_ERROR,
    ERROR_RATE_LIMITED,
    ERROR_SERVER_ERROR,
    ERROR_TIMEOUT,
    ERROR_UNEXPECTED_RESPONSE,
    ERROR_UNREACHABLE,
)
from animama.app.model_clients.probe import (
    PROBE_STEP_AVAILABLE,
    ModelConnectionProbeError,
    ModelProbeReport,
    ModelProbeStep,
)
from animama.domain.model_connection import ModelConnection
from animama.logging import get_logger

from .support import anthropic_sdk_client

_log = get_logger("adapters.model_clients.anthropic_messages.probe")

_MAX_LISTED_MODELS = 500
_EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")
"""Messages API ``output_config.effort`` values, in catalog order."""

_WEB_SEARCH_TOOL = "web_search"
_MODELS_API_NOTE = "Capabilities come from Anthropic's Models API; no message was sent to the model."

AnthropicClientFactory = Callable[..., Any]
"""Builds an SDK client from ``api_key=`` and ``timeout=``; tests pass a fake."""


class AnthropicConnectionProbe:
    """List and describe models on the built-in Anthropic connection.

    Only the built-in ``anthropic`` connection is served, with only its own key
    (``ANTHROPIC_API_KEY``). Responses and embedding probes do not apply to
    Anthropic and are refused.
    """

    def __init__(
        self,
        *,
        credential_resolver: ModelCredentialResolver,
        default_timeout: float | None = 60.0,
        client_factory: AnthropicClientFactory | None = None,
    ) -> None:
        self._credentials = credential_resolver
        self._default_timeout = default_timeout
        self._client_factory = client_factory or anthropic_sdk_client

    async def list_models(self, connection: ModelConnection) -> list[str]:
        """Return the model ids Anthropic offers to the key's organization."""

        async with self._client(connection) as client:
            ids: list[str] = []
            try:
                async for item in client.models.list():
                    ids.append(str(item.id))
                    if len(ids) >= _MAX_LISTED_MODELS:
                        break
            except _FAILURES as exc:
                category, detail = _failure(exc)
                raise ModelConnectionProbeError(detail, category=category) from exc
        return sorted(set(ids))

    async def probe_chat_model(self, connection: ModelConnection, *, model: str) -> ModelProbeReport:
        """Read one model's limits and capabilities; a failure becomes a failed step."""

        async with self._client(connection) as client:
            try:
                info = await client.models.retrieve(model)
            except _FAILURES as exc:
                category, detail = _failure(exc)
                step = ModelProbeStep(name=PROBE_STEP_AVAILABLE, ok=False, category=category, detail=detail)
                return ModelProbeReport(model=model, steps=(step,))
            try:
                return anthropic_model_probe_report(model, info)
            except (AttributeError, TypeError, ValueError):
                # A reply that is not the documented model shape is reported, not raised.
                step = ModelProbeStep(
                    name=PROBE_STEP_AVAILABLE,
                    ok=False,
                    category=ERROR_UNEXPECTED_RESPONSE,
                    detail="Anthropic returned model details in an unexpected shape.",
                )
                return ModelProbeReport(model=model, steps=(step,))

    async def probe_responses_model(self, connection: ModelConnection, *, model: str) -> ModelProbeReport:
        raise ModelConnectionProbeError("Anthropic models do not use OpenAI Responses", category=ERROR_BAD_REQUEST)

    async def probe_embedding_model(self, connection: ModelConnection, *, model: str) -> ModelProbeReport:
        raise ModelConnectionProbeError("Anthropic offers no embedding models", category=ERROR_BAD_REQUEST)

    @asynccontextmanager
    async def _client(self, connection: ModelConnection) -> AsyncIterator[Any]:
        if not connection.is_builtin_anthropic:
            raise ModelConnectionProbeError(
                "Only the built-in Anthropic connection uses Anthropic's Models API", category=ERROR_BAD_REQUEST
            )
        credential = self._credentials.resolve(connection)
        if not credential.api_key:
            raise ModelConnectionProbeError(
                f"No key is configured for {connection.name}", category=ERROR_CREDENTIAL_MISSING
            )
        seconds = connection.timeout_seconds if connection.timeout_seconds is not None else self._default_timeout
        client = self._client_factory(api_key=credential.api_key, timeout=seconds)
        try:
            yield client
        finally:
            await client.close()


def anthropic_model_probe_report(model: str, info: ModelInfo) -> ModelProbeReport:
    """Map a Models API ``ModelInfo`` into the probe report.

    Every Messages API model streams and calls tools. Reasoning efforts are the
    supported ``effort`` levels, with ``none`` (``thinking`` disabled) first
    when the model accepts disabled thinking; a model without effort levels has
    no reasoning control. Structured outputs mean strict JSON schema replies,
    which may share a request with tools.
    """

    capabilities = info.capabilities
    report = ModelProbeReport(
        model=model,
        steps=(ModelProbeStep(name=PROBE_STEP_AVAILABLE, ok=True),),
        supports_streaming=True,
        supports_tools=True,
        context_window_tokens=_positive_int(info.max_input_tokens),
        max_output_tokens=_positive_int(info.max_tokens),
        notes=(_MODELS_API_NOTE,),
    )
    if capabilities is None:
        return report
    structured = capabilities.structured_outputs.supported
    return replace(
        report,
        structured_output_transport=STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA if structured else None,
        tools_with_structured_output=structured,
        supported_reasoning_efforts=_reasoning_efforts(capabilities),
        native_tool_support=(_WEB_SEARCH_TOOL,) if capabilities.server_tools.web_search.supported else None,
    )


def _reasoning_efforts(capabilities: ModelCapabilities) -> tuple[str, ...] | None:
    effort = capabilities.effort
    if not effort.supported:
        return None
    levels = [name for name in _EFFORT_LEVELS if (level := getattr(effort, name, None)) is not None and level.supported]
    if not levels:
        return None
    if capabilities.thinking.types.disabled.supported:
        levels.insert(0, "none")
    return tuple(levels)


def _positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


# SDK errors, plus replies that are not the documented shape.
_FAILURES: tuple[type[BaseException], ...] = (anthropic.AnthropicError, ValueError, TypeError, AttributeError)


def _failure(exc: BaseException) -> tuple[str, str]:
    """Return a neutral category and a fixed detail; upstream text is never used."""

    if isinstance(exc, anthropic.APITimeoutError):
        return ERROR_TIMEOUT, "Anthropic did not answer before the connection timeout."
    if isinstance(exc, anthropic.APIConnectionError):
        return ERROR_UNREACHABLE, "The connection to Anthropic failed."
    if isinstance(exc, anthropic.AuthenticationError | anthropic.PermissionDeniedError):
        return ERROR_CREDENTIAL_REJECTED, "Anthropic rejected the API key."
    if isinstance(exc, anthropic.NotFoundError):
        return ERROR_MODEL_NOT_FOUND, "Anthropic does not offer this model to the key's organization."
    if isinstance(exc, anthropic.RateLimitError):
        return ERROR_RATE_LIMITED, "Anthropic limited the request rate; try again shortly."
    if isinstance(exc, anthropic.APIStatusError):
        if exc.status_code >= 500:
            return ERROR_SERVER_ERROR, "Anthropic reported a server error."
        return ERROR_BAD_REQUEST, "Anthropic rejected the request."
    if isinstance(exc, anthropic.AnthropicError):
        return ERROR_PROVIDER_ERROR, "The Anthropic request failed."
    _log.info("Anthropic model probe received an unexpected response", error_type=exc.__class__.__name__)
    return ERROR_UNEXPECTED_RESPONSE, "Anthropic's reply was not a Models API response."


__all__ = ["AnthropicClientFactory", "AnthropicConnectionProbe", "anthropic_model_probe_report"]
