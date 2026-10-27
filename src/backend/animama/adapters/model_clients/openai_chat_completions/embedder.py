"""Text embeddings from the catalog row assigned to the embeddings role."""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Mapping
from itertools import islice
from typing import Any

import httpx2
from openai import OpenAIError

from animama.app.model_clients import ModelClientError, ModelClientProviderError, ModelClientTimeoutError
from animama.app.model_clients.call_boundary import DEADLINE_CODE, INPUT_LIMIT_CODE
from animama.app.model_clients.credentials import ModelCredentialResolver
from animama.app.model_clients.error_categories import model_error_category
from animama.app.ports.text_embedder import EmbeddingLimits, EmbeddingResult
from animama.domain import ModelProvider
from animama.domain.usage import Usage

from ..openai_errors import classify_openai_exception
from .connection_sdk import (
    connection_base_url,
    connection_for_request,
    connection_timeout,
    keyless_request_headers,
    sdk_client_for_connection,
)
from .support import OPENAI_API, OPENAI_HTTP_PROVIDER_TYPE


class ConnectionEmbedder:
    """Embed text with one embedding row through its connection's ``/embeddings``.

    ``model_id`` is the catalog row id stored with every vector, so vectors from
    different models are never compared. Each call opens a short-lived client
    scoped to the row's connection and credential. Failures are raised as
    model-client errors whose codes map to neutral error categories.
    """

    def __init__(
        self,
        model_provider: ModelProvider,
        *,
        credential_resolver: ModelCredentialResolver,
        openai_base_url: str,
        default_timeout_seconds: float | None,
        limits: EmbeddingLimits | None = None,
    ) -> None:
        self._limits = limits
        self._model_provider = model_provider
        self._credentials = credential_resolver
        self._openai_base_url = openai_base_url
        self._default_timeout_seconds = default_timeout_seconds

    @property
    def model_id(self) -> str:
        return self._model_provider.id

    async def embed_texts(self, texts: Iterable[str]) -> list[list[float]]:
        return (await self.embed_texts_with_usage(texts)).vectors

    async def embed_texts_with_usage(self, texts: Iterable[str]) -> EmbeddingResult:
        """Expose provider usage before a composition settles this exact call."""
        limits = self._limits
        payload = list(islice(texts, limits.max_texts + 1)) if limits is not None else list(texts)
        if limits is not None and (len(payload) > limits.max_texts or sum(map(len, payload)) > limits.max_characters):
            # A model error with the context-exceeded category: callers split the
            # batch or record a single text as too long instead of failing.
            raise ModelClientError("Embedding input exceeds the admitted limit", code=INPUT_LIMIT_CODE)
        if not payload:
            return EmbeddingResult([], Usage())
        connection = connection_for_request(self._model_provider)
        credential = self._credentials.resolve(connection)
        if not credential.usable:
            raise ModelClientProviderError(
                f"No key is configured for {connection.name}",
                code="missing_api_key",
                raw_metadata={"connection_id": connection.id, "model": self._model_provider.model},
            )
        timeout = (
            connection.timeout_seconds if connection.timeout_seconds is not None else self._default_timeout_seconds
        )
        client = sdk_client_for_connection(
            connection,
            credential=credential,
            base_url=connection_base_url(connection, openai_base_url=self._openai_base_url),
            timeout=connection_timeout(timeout),
        )
        if limits is not None:
            client = client.with_options(max_retries=0, timeout=limits.timeout_seconds)
        model = self._model_provider.model
        try:
            async with client, asyncio.timeout(limits.timeout_seconds if limits is not None else None):
                response = await client.embeddings.create(
                    model=model,
                    input=payload,
                    # Float is the one encoding every OpenAI-compatible server accepts.
                    encoding_format="float",
                    extra_headers=keyless_request_headers(connection, credential),
                )
        except OpenAIError as exc:
            info = classify_openai_exception(exc, api=OPENAI_API, provider_type=OPENAI_HTTP_PROVIDER_TYPE, model=model)
            error_type = ModelClientTimeoutError if info.code == "openai_timeout" else ModelClientProviderError
            raise error_type(
                _failure_message(connection.name, info.code, info.metadata), code=info.code, raw_metadata=info.metadata
            ) from exc
        except httpx2.HTTPError as exc:
            raise ModelClientProviderError(
                _failure_message(connection.name, "openai_connection_error", None), code="openai_connection_error"
            ) from exc
        except TimeoutError as exc:
            # The admitted absolute deadline, reported like the chat call boundary's.
            raise ModelClientTimeoutError(
                _failure_message(connection.name, DEADLINE_CODE, None), code=DEADLINE_CODE
            ) from exc
        reported = getattr(response, "usage", None)
        usage = (
            Usage(requests=1, input_tokens=reported.prompt_tokens, total_tokens=reported.total_tokens)
            if reported is not None
            else None
        )
        return EmbeddingResult(
            [list(item.embedding) for item in sorted(response.data, key=lambda item: item.index)], usage
        )


def _failure_message(connection_name: str, code: str, metadata: Mapping[str, Any] | None) -> str:
    """Describe a failure by neutral category; these messages reach file processing warnings."""

    category = model_error_category(code, metadata).replace("_", " ")
    return f"The embeddings request to {connection_name} failed ({category})"


__all__ = ["ConnectionEmbedder"]
