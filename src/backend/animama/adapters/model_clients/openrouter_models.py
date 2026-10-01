"""OpenRouter's public model list, read for the add-model picker.

The list comes from one fixed public URL without a key. The fetch follows no
redirects, is bounded in time and size, and keeps only the fields the picker
needs; unknown fields and malformed entries are ignored. A successful list is
cached in memory briefly, since it changes rarely and the picker may reopen.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from animama.logging import get_logger

_log = get_logger("adapters.model_clients.openrouter_models")

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
DEFAULT_TIMEOUT_SECONDS = 10.0
"""Longest wait for the whole fetch, including reading the body."""
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
"""Largest accepted (decoded) body; the real list is a few hundred KiB."""
MAX_MODELS = 2000
CACHE_TTL_SECONDS = 600.0
_MAX_ID_LENGTH = 256
"""Matches the longest model id an owner model row accepts."""
_MAX_NAME_LENGTH = 256

_TOOL_PARAMETERS = frozenset({"tools"})
_STRUCTURED_OUTPUT_PARAMETERS = frozenset({"structured_outputs", "response_format"})


@dataclass(frozen=True, slots=True)
class OpenRouterModel:
    """One model OpenRouter offers, with capabilities its parameters suggest.

    ``supports_tools`` and ``supports_structured_outputs`` come from the
    model's ``supported_parameters``; they prefill the add-model form and the
    capability probe can override them.
    """

    id: str
    name: str
    context_length: int | None
    supports_tools: bool
    supports_structured_outputs: bool


class OpenRouterModelListError(Exception):
    """The model list could not be read; the message never echoes the body."""


class OpenRouterModelCatalog:
    """Fetch and briefly cache OpenRouter's public model list.

    ``transport`` and ``clock`` exist for tests; the URL is fixed.
    """

    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        max_bytes: int = MAX_RESPONSE_BYTES,
        cache_ttl_seconds: float = CACHE_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._transport = transport
        self._timeout_seconds = timeout_seconds
        self._max_bytes = max_bytes
        self._cache_ttl_seconds = cache_ttl_seconds
        self._clock = clock
        self._cached: tuple[OpenRouterModel, ...] | None = None
        self._cached_at = 0.0
        self._lock = asyncio.Lock()

    async def list_models(self) -> tuple[OpenRouterModel, ...]:
        """Return the cached list, or fetch it when absent or stale."""

        async with self._lock:
            if self._cached is not None and self._clock() - self._cached_at < self._cache_ttl_seconds:
                return self._cached
            models = await self._fetch()
            self._cached, self._cached_at = models, self._clock()
            return models

    async def _fetch(self) -> tuple[OpenRouterModel, ...]:
        try:
            async with asyncio.timeout(self._timeout_seconds):
                body = await self._read_body()
        except TimeoutError as exc:
            raise OpenRouterModelListError("OpenRouter timed out") from exc
        except httpx.HTTPError as exc:
            # httpx's own timeouts are HTTPErrors too; name them the same way.
            if isinstance(exc, httpx.TimeoutException):
                raise OpenRouterModelListError("OpenRouter timed out") from exc
            raise OpenRouterModelListError("OpenRouter is unreachable") from exc
        try:
            payload = json.loads(body)
        except ValueError as exc:
            raise OpenRouterModelListError("OpenRouter did not return JSON") from exc
        models = _parse_models(payload)
        _log.info("OpenRouter model list fetched", model_count=len(models))
        return models

    async def _read_body(self) -> bytes:
        timeout = httpx.Timeout(self._timeout_seconds, connect=min(self._timeout_seconds, 5.0))
        async with httpx.AsyncClient(transport=self._transport, timeout=timeout, follow_redirects=False) as client:
            async with client.stream("GET", OPENROUTER_MODELS_URL, headers={"Accept": "application/json"}) as response:
                if response.status_code != 200:
                    raise OpenRouterModelListError(f"OpenRouter answered HTTP {response.status_code}")
                declared = response.headers.get("content-length")
                if declared is not None and declared.isdigit() and int(declared) > self._max_bytes:
                    raise OpenRouterModelListError("OpenRouter's model list is too large")
                chunks: list[bytes] = []
                received = 0
                # Count decoded bytes, so a compressed body cannot expand past the bound.
                async for chunk in response.aiter_bytes():
                    received += len(chunk)
                    if received > self._max_bytes:
                        raise OpenRouterModelListError("OpenRouter's model list is too large")
                    chunks.append(chunk)
        return b"".join(chunks)


def _parse_models(payload: Any) -> tuple[OpenRouterModel, ...]:
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise OpenRouterModelListError("OpenRouter returned no model list")
    models: list[OpenRouterModel] = []
    seen: set[str] = set()
    for item in data:
        model = _parse_model(item)
        if model is None or model.id in seen:
            continue
        seen.add(model.id)
        models.append(model)
        if len(models) >= MAX_MODELS:
            break
    return tuple(models)


def _parse_model(item: Any) -> OpenRouterModel | None:
    if not isinstance(item, dict):
        return None
    model_id = item.get("id")
    if not isinstance(model_id, str) or not model_id.strip() or len(model_id) > _MAX_ID_LENGTH:
        return None
    model_id = model_id.strip()
    name = item.get("name")
    name = name.strip()[:_MAX_NAME_LENGTH] if isinstance(name, str) and name.strip() else model_id
    raw_parameters = item.get("supported_parameters")
    parameters = (
        {value for value in raw_parameters if isinstance(value, str)} if isinstance(raw_parameters, list) else set()
    )
    return OpenRouterModel(
        id=model_id,
        name=name,
        context_length=_context_length(item),
        supports_tools=bool(parameters & _TOOL_PARAMETERS),
        supports_structured_outputs=bool(parameters & _STRUCTURED_OUTPUT_PARAMETERS),
    )


def _context_length(item: dict[str, Any]) -> int | None:
    top_provider = item.get("top_provider")
    candidates = (
        item.get("context_length"),
        top_provider.get("context_length") if isinstance(top_provider, dict) else None,
    )
    for value in candidates:
        # bool is an int subclass; a JSON true is not a window size.
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return value
    return None


__all__ = [
    "CACHE_TTL_SECONDS",
    "DEFAULT_TIMEOUT_SECONDS",
    "MAX_MODELS",
    "MAX_RESPONSE_BYTES",
    "OPENROUTER_MODELS_URL",
    "OpenRouterModel",
    "OpenRouterModelCatalog",
    "OpenRouterModelListError",
]
