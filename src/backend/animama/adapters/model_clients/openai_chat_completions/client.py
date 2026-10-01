from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI, OpenAIError

from animama.app.model_clients import (
    ModelClientDelta,
    ModelClientFinal,
    ModelClientProviderError,
    ModelClientRequest,
    elapsed_ms,
    model_client_preview_log_context,
    model_client_request_log_context,
)
from animama.app.model_clients.credential_store import OPENAI_CREDENTIAL_ENV
from animama.app.model_clients.credentials import (
    ModelCredential,
    ModelCredentialResolver,
    static_credential_resolver,
)
from animama.app.model_clients.usage_estimate import estimate_usage
from animama.domain.model_connection import ModelConnection
from animama.domain.usage import Usage
from animama.logging import get_logger

from .._common import close_maybe_async
from ..openai_errors import (
    classify_openai_exception,
    model_client_error_from_openai_info,
    should_retry_openai_error,
    sleep_before_openai_retry,
)
from .connection_sdk import (
    base_client_for_connection,
    connection_base_url,
    connection_for_request,
    connection_timeout,
    keyed_client,
    keyless_request_headers,
)
from .events import (
    choice_zero,
    content_deltas_from_choice_zero,
    events_from_chat_completion_chunk,
    merge_chunk_metadata,
)
from .request import create_chat_completion_kwargs
from .support import OPENAI_API, OPENAI_HTTP_PROVIDER_TYPE, resolve_openai_base_url
from .tools import merge_tool_call_deltas_from_choice, tool_calls_from_parts
from .usage import usage_from_chat_completion_usage

_log = get_logger("adapters.model_clients.openai_chat_completions.client")


class OpenAIChatCompletionsModelClient:
    """Provider-neutral model client backed by OpenAI Chat Completions streaming.

    One instance serves every Chat Completions connection. Each request uses the
    selected row's connection: its base URL (the built-in OpenAI connection
    uses ``base_url``), its timeout and only its own credential from
    ``credential_resolver``, resolved once per request so retries and headers
    never mix keys. ``api_key`` is a fixed built-in OpenAI key used when no
    resolver is supplied. ``client`` is a test hook that replaces SDK client
    construction; production registries never pass one.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        credential_resolver: ModelCredentialResolver | None = None,
        client: AsyncOpenAI | None = None,
        timeout: float | None = 60.0,
        close_client: bool | None = None,
    ) -> None:
        self._base_url = resolve_openai_base_url(base_url)
        self._credentials = credential_resolver or static_credential_resolver(
            {OPENAI_CREDENTIAL_ENV: api_key.strip()} if api_key and api_key.strip() else None
        )
        self._client = client
        # Key-free SDK clients per connection; each request adds its key to a view.
        self._clients_by_connection: dict[tuple[str, str, float | None], AsyncOpenAI] = {}
        self._timeout = timeout
        self._close_client = (client is None) if close_client is None else close_client

    async def stream(self, spec: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        """Stream ChatCompletionChunk values as provider-neutral deltas.

        Chat Completions streams incremental chunks with `choice.delta`. This
        adapter emits observability events for every meaningful chunk, buffers
        choice-0 content/tool-call fragments, and emits the final delta only
        after the stream ends with finish/usage metadata captured.
        """

        connection = connection_for_request(spec.model_provider)
        base_url = self._base_url_for_connection(connection)
        credential = self._credentials.resolve(connection)
        if self._client is None and not credential.usable:
            raise ModelClientProviderError(
                f"No key is configured for {connection.name}",
                code="missing_api_key",
                raw_metadata={
                    "provider_type": spec.model_provider.provider_type,
                    "model": spec.model_provider.model,
                    "connection_id": connection.id,
                    "connection_name": connection.name,
                    "base_url": base_url,
                },
            )

        request_started_at = time.monotonic()
        attempt = 0
        while True:
            parts: list[str] = []
            usage = Usage()
            usage_seen = False
            metadata: dict[str, Any] = {}
            tool_call_parts: dict[int, dict[str, Any]] = {}
            stream_started = False
            chunk_count = 0
            event_delta_count = 0
            text_delta_count = 0
            first_chunk_logged = False

            try:
                attempt_started_at = time.monotonic()
                _log.info(
                    "OpenAI Chat Completions stream request started",
                    **model_client_request_log_context(spec, include_prompt_preview=True),
                    attempt=attempt,
                )
                stream = await self._create_stream(spec, credential)
                _log.info(
                    "OpenAI Chat Completions stream opened",
                    **model_client_request_log_context(spec),
                    attempt=attempt,
                    elapsed_ms=elapsed_ms(attempt_started_at),
                )
                try:
                    async for chunk in stream:
                        chunk_count += 1
                        if not first_chunk_logged:
                            first_chunk_logged = True
                            _log.info(
                                "OpenAI Chat Completions first stream chunk received",
                                **model_client_request_log_context(spec),
                                attempt=attempt,
                                chunk_object=chunk.object,
                                chunk_model=chunk.model,
                                elapsed_ms=elapsed_ms(request_started_at),
                            )
                        # Keep last-seen chunk identity and finish_reason in the
                        # final metadata. Direct chat's observer separately
                        # warns if no finish_reason event is ever seen.
                        merge_chunk_metadata(metadata, chunk)
                        if chunk.usage is not None:
                            usage = usage_from_chat_completion_usage(chunk.usage)
                            usage_seen = True
                        # Intermediate chunk observations are not public chat
                        # text, but they are logged and summarized for audit.
                        event_deltas = events_from_chat_completion_chunk(
                            chunk,
                            provider_type=spec.model_provider.provider_type,
                            model=spec.model_provider.model,
                            metadata=metadata,
                        )
                        event_delta_count += len(event_deltas)
                        for event_delta in event_deltas:
                            yield event_delta
                        choice0 = choice_zero(chunk)
                        if choice0 is not None:
                            # Direct chat currently uses choice index 0 as the
                            # canonical assistant output. Additional choices are
                            # recorded as unknown/multi-choice observations.
                            tool_event_deltas = merge_tool_call_deltas_from_choice(
                                tool_call_parts,
                                chunk,
                                choice0,
                                provider_type=spec.model_provider.provider_type,
                                model=spec.model_provider.model,
                            )
                            event_delta_count += len(tool_event_deltas)
                            for event_delta in tool_event_deltas:
                                yield event_delta
                        for text in content_deltas_from_choice_zero(
                            choice0,
                        ):
                            text_delta_count += 1
                            parts.append(text)
                            stream_started = True
                            yield ModelClientDelta(kind="text_delta", text=text, raw_metadata=metadata)
                finally:
                    await close_maybe_async(stream)
            except asyncio.CancelledError:
                raise
            except OpenAIError as exc:
                info = classify_openai_exception(
                    exc,
                    api=OPENAI_API,
                    provider_type=OPENAI_HTTP_PROVIDER_TYPE,
                    model=spec.model_provider.model,
                )
                if should_retry_openai_error(info, attempt=attempt, stream_started=stream_started):
                    _log.warning(
                        "OpenAI Chat Completions stream retrying after provider error",
                        **model_client_request_log_context(spec),
                        attempt=attempt,
                        code=info.code,
                        status_code=info.metadata.get("status_code"),
                        elapsed_ms=elapsed_ms(request_started_at),
                    )
                    attempt += 1
                    await sleep_before_openai_retry(info)
                    continue
                raise model_client_error_from_openai_info(info) from exc
            break

        final_text = "".join(parts)
        if not usage_seen:
            metadata["usage_missing"] = True
            metadata["usage_estimated"] = True
            usage = estimate_usage(spec.prompt, final_text)
        tool_calls = tool_calls_from_parts(tool_call_parts)
        _log.info(
            "OpenAI Chat Completions stream final prepared",
            **model_client_request_log_context(spec),
            attempt=attempt,
            chunk_count=chunk_count,
            event_delta_count=event_delta_count,
            text_delta_count=text_delta_count,
            final_text_length=len(final_text),
            tool_call_count=len(tool_calls),
            finish_reason=metadata.get("finish_reason"),
            usage_seen=usage_seen,
            elapsed_ms=elapsed_ms(request_started_at),
            **model_client_preview_log_context(final_text_preview=final_text),
        )
        # This final is the authoritative adapter result consumed by direct
        # chat. It is emitted after the async SDK stream has been fully consumed.
        yield ModelClientDelta(
            kind="final",
            final=ModelClientFinal(
                text=final_text,
                usage=usage,
                raw_provider_metadata=metadata,
                tool_calls=tool_calls,
            ),
        )
        yield ModelClientDelta(kind="done")

    async def aclose(self) -> None:
        client = self._client
        if client is not None and self._close_client:
            await client.close()
        self._client = None
        if self._close_client:
            for sdk_client in list(self._clients_by_connection.values()):
                await sdk_client.close()
        self._clients_by_connection.clear()

    async def _create_stream(self, spec: ModelClientRequest, credential: ModelCredential) -> Any:
        """Create the OpenAI SDK stream with request fields translated upstream."""

        connection = connection_for_request(spec.model_provider)
        timeout = self._timeout_for_connection(connection)
        client = self._client_for_connection(connection, timeout=timeout, credential=credential)
        kwargs = create_chat_completion_kwargs(spec, timeout=connection_timeout(timeout))
        extra_headers = keyless_request_headers(connection, credential)
        if extra_headers is not None:
            kwargs["extra_headers"] = extra_headers
        return await client.chat.completions.create(**kwargs)

    def _base_url_for_connection(self, connection: ModelConnection) -> str:
        return connection_base_url(connection, openai_base_url=self._base_url)

    def _timeout_for_connection(self, connection: ModelConnection) -> float | None:
        return connection.timeout_seconds if connection.timeout_seconds is not None else self._timeout

    def _client_for_connection(
        self, connection: ModelConnection, *, timeout: float | None, credential: ModelCredential
    ) -> Any:
        """Return a view of the connection's key-free client carrying only its key."""

        base_url = self._base_url_for_connection(connection)
        if self._client is not None:
            with_options = getattr(self._client, "with_options", None)
            if callable(with_options):
                return with_options(base_url=base_url, timeout=connection_timeout(timeout))
            return self._client

        # The preset decides fixed request headers (OpenRouter attribution), so
        # a connection whose preset changes gets a fresh client.
        cache_key = (connection.id, connection.preset, base_url, timeout)
        client = self._clients_by_connection.get(cache_key)
        if client is None:
            client = base_client_for_connection(connection, base_url=base_url, timeout=connection_timeout(timeout))
            self._clients_by_connection[cache_key] = client
        return keyed_client(client, connection, credential=credential)


__all__ = ["OPENAI_HTTP_PROVIDER_TYPE", "OpenAIChatCompletionsModelClient"]
