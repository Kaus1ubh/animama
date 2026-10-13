"""Classify Anthropic SDK failures into sanitized model-client errors (D12).

Anthropic reports an ``error.type`` on HTTP failures and on stream ``error``
events (which the SDK raises as ``APIStatusError`` with the stream's 200
status), so classification uses that type first and the HTTP status second.
Codes are ``anthropic_*`` and map to the neutral categories in
``app/model_clients/error_categories.py``. Metadata carries only identifiers,
the status, the provider error type and a redacted, truncated provider
message; it never carries the key or a response body.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import anthropic

from animama.app.model_clients import ModelClientError, ModelClientProviderError, ModelClientTimeoutError

from ..openai_errors import sanitize_provider_error_message
from .support import ANTHROPIC_API, ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE, ANTHROPIC_PROVIDER, clean_str

_MAX_APP_RETRIES = 1
_MAX_RETRY_AFTER_SECONDS = 2.0
_PROMPT_TOO_LONG = re.compile(r"prompt is too long|context window|too many tokens", re.IGNORECASE)
_CREDIT_BALANCE = re.compile(r"credit balance", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class AnthropicErrorInfo:
    """Sanitized Anthropic failure safe to expose through model-client errors."""

    message: str
    code: str
    metadata: Mapping[str, Any]
    retryable: bool = False
    retry_after_seconds: float | None = None
    timeout: bool = False


def classify_anthropic_exception(exc: BaseException, *, model: str) -> AnthropicErrorInfo:
    """Return the code, message and safe metadata for one SDK exception."""

    metadata: dict[str, Any] = {
        "provider": ANTHROPIC_PROVIDER,
        "api": ANTHROPIC_API,
        "provider_type": ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE,
        "model": model,
        "exception_type": exc.__class__.__name__,
    }
    if isinstance(exc, anthropic.APITimeoutError):
        return _info("Anthropic request timed out", "anthropic_timeout", metadata, retryable=True, timeout=True)
    if isinstance(exc, anthropic.APIConnectionError):
        return _info("Anthropic connection failed", "anthropic_connection_error", metadata, retryable=True)
    if not isinstance(exc, anthropic.APIStatusError):
        return _info("Anthropic request failed", "anthropic_request_failed", metadata)

    status = exc.status_code
    metadata["status_code"] = status
    request_id = clean_str(getattr(exc, "request_id", None))
    if request_id is not None:
        metadata["request_id"] = request_id
    error_type, error_message = _error_fields(getattr(exc, "body", None))
    error_type = error_type or clean_str(getattr(exc, "type", None))
    if error_type is not None:
        metadata["provider_error_type"] = error_type
    if error_message is not None:
        metadata["provider_error_message"] = sanitize_provider_error_message(error_message)
    retry_after = _retry_after_seconds(exc)
    if retry_after is not None:
        metadata["retry_after_seconds"] = retry_after

    message_text = error_message or ""
    if error_type == "authentication_error" or status == 401:
        return _info("Anthropic rejected the API key", "anthropic_authentication_error", metadata)
    if error_type == "permission_error" or status == 403:
        return _info("Anthropic denied permission for this request", "anthropic_permission_denied", metadata)
    if error_type == "not_found_error" or status == 404:
        return _info("Anthropic does not offer this model to the key", "anthropic_not_found", metadata)
    if error_type == "billing_error" or status == 402 or _CREDIT_BALANCE.search(message_text):
        return _info("Anthropic credit balance or billing limit reached", "anthropic_quota_exceeded", metadata)
    if error_type == "rate_limit_error" or status == 429:
        return _info(
            "Anthropic rate limit exceeded",
            "anthropic_rate_limit",
            metadata,
            retryable=True,
            retry_after_seconds=retry_after,
        )
    if error_type == "overloaded_error" or status == 529:
        return _info(
            "Anthropic is temporarily overloaded",
            "anthropic_overloaded",
            metadata,
            retryable=True,
            retry_after_seconds=retry_after,
        )
    if error_type == "request_too_large" or status == 413 or _PROMPT_TOO_LONG.search(message_text):
        return _info("The conversation exceeds the model's context window", "anthropic_context_exceeded", metadata)
    if error_type == "api_error" or status >= 500:
        return _info("Anthropic reported a server error", "anthropic_server_error", metadata, retryable=True)
    if error_type == "invalid_request_error" or status in {400, 422}:
        return _info("Anthropic rejected the request", "anthropic_bad_request", metadata)
    return _info("Anthropic request failed", "anthropic_request_failed", metadata)


def model_client_error_from_anthropic_info(info: AnthropicErrorInfo) -> ModelClientError:
    """Build the model-client error the direct turn reports."""

    if info.timeout:
        return ModelClientTimeoutError(info.message, code=info.code, raw_metadata=info.metadata)
    return ModelClientProviderError(info.message, code=info.code, raw_metadata=info.metadata)


def should_retry_anthropic_error(info: AnthropicErrorInfo, *, attempt: int, output_started: bool) -> bool:
    """Retry once, only before any reply text reached the turn and only for transient failures."""

    if output_started or attempt >= _MAX_APP_RETRIES or not info.retryable:
        return False
    return info.retry_after_seconds is None or info.retry_after_seconds <= _MAX_RETRY_AFTER_SECONDS


async def sleep_before_anthropic_retry(info: AnthropicErrorInfo) -> None:
    """Honor a short ``retry-after`` before the single retry."""

    if info.retry_after_seconds is not None and info.retry_after_seconds > 0:
        await asyncio.sleep(min(info.retry_after_seconds, _MAX_RETRY_AFTER_SECONDS))


def _info(
    message: str,
    code: str,
    metadata: dict[str, Any],
    *,
    retryable: bool = False,
    retry_after_seconds: float | None = None,
    timeout: bool = False,
) -> AnthropicErrorInfo:
    safe = dict(metadata)
    safe["retryable"] = retryable
    return AnthropicErrorInfo(
        message=message,
        code=code,
        metadata=safe,
        retryable=retryable,
        retry_after_seconds=retry_after_seconds,
        timeout=timeout,
    )


def _error_fields(body: Any) -> tuple[str | None, str | None]:
    """Return ``error.type`` and ``error.message`` from an API error body or stream error event."""

    error = body.get("error") if isinstance(body, Mapping) else None
    if not isinstance(error, Mapping):
        return None, None
    return clean_str(error.get("type")), clean_str(error.get("message"))


def _retry_after_seconds(exc: anthropic.APIStatusError) -> float | None:
    headers = getattr(getattr(exc, "response", None), "headers", None)
    raw = headers.get("retry-after") if headers is not None else None
    if not isinstance(raw, str):
        return None
    try:
        return max(0.0, float(raw.strip()))
    except ValueError:
        return None


__all__ = [
    "AnthropicErrorInfo",
    "classify_anthropic_exception",
    "model_client_error_from_anthropic_info",
    "should_retry_anthropic_error",
    "sleep_before_anthropic_retry",
]
