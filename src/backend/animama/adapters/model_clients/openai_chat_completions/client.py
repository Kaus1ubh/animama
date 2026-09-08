from __future__ import annotations

import asyncio
import os
import time
from collections.abc import AsyncIterator, Mapping
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
from animama.domain.usage import Usage
from animama.logging import get_logger

from .._common import close_maybe_async
from ..openai_errors import (
    classify_openai_exception,
    model_client_error_from_openai_info,
    should_retry_openai_error,
    sleep_before_openai_retry,
)
from .events import (
    choice_zero,
    content_deltas_from_choice_zero,
    events_from_chat_completion_chunk,
    merge_chunk_metadata,
)
from .request import (
    base_url_for_spec,
    create_chat_completion_kwargs,
    is_deepseek_model_provider,
    is_huggingface_model_provider,
)
from .support import DEFAULT_BASE_URL, OPENAI_API, OPENAI_HTTP_PROVIDER_TYPE
from .tools import merge_tool_call_deltas_from_choice, tool_calls_from_parts
from .usage import usage_from_chat_completion_usage

_log = get_logger("adapters.model_clients.openai_chat_completions.client")


class OpenAIChatCompletionsModelClient:
    """Provider-neutral model client backed by OpenAI Chat Completions streaming."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        api_keys_by_base_url: Mapping[str, str | None] | None = None,
        client: AsyncOpenAI | None = None,
        timeout: float | None = 60.0,
        close_client: bool | None = None,
    ) -> None:
        resolved_api_key = api_key if api_key is not None else os.getenv("OPENAI_API_KEY")
        resolved_base_url = base_url if base_url is not None else os.getenv("OPENAI_BASE_URL")
        self._api_key = (resolved_api_key or "").strip()
        self._base_url = (resolved_base_url or DEFAULT_BASE_URL).rstrip("/")
        self._api_keys_by_base_url = {
            _normalize_base_url(base_url): (api_key or "").strip()
            for base_url, api_key in (api_keys_by_base_url or {}).items()
            if str(base_url or "").strip()
        }
        self._client = client
        self._clients_by_base_url: dict[str, AsyncOpenAI] = {}
        self._timeout = timeout
        self._close_client = (client is None) if close_client is None else close_client

    async def stream(self, spec: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        """Stream ChatCompletionChunk values as provider-neutral deltas.

        Chat Completions streams incremental chunks with `choice.delta`. This
        adapter emits observability events for every meaningful chunk, buffers
        choice-0 content/tool-call fragments, and emits the final delta only
        after the stream ends with finish/usage metadata captured.
        """

        if self._client is None:
            base_url = base_url_for_spec(spec, self._base_url)
            if not self._api_key_for_spec(spec, base_url=base_url):
                raise ModelClientProviderError(
                    "OpenAI-compatible API key is not configured",
                    code="missing_api_key",
                    raw_metadata={
                        "provider_type": spec.model_provider.provider_type,
                        "model": spec.model_provider.model,
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
            handled_choice_extra_field_names = _handled_choice_extra_field_names_for_spec(spec)

            try:
                attempt_started_at = time.monotonic()
                _log.info(
                    "OpenAI Chat Completions stream request started",
                    **model_client_request_log_context(spec, include_prompt_preview=True),
                    attempt=attempt,
                )
                stream = await self._create_stream(spec)
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
                            handled_choice_extra_field_names=handled_choice_extra_field_names,
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

        if not usage_seen:
            metadata["usage_missing"] = True
        final_text = "".join(parts)
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
            for sdk_client in list(self._clients_by_base_url.values()):
                await sdk_client.close()
        self._clients_by_base_url.clear()

    async def _create_stream(self, spec: ModelClientRequest) -> Any:
        """Create the OpenAI SDK stream with request fields translated upstream."""

        client = self._client_for_spec(spec)
        return await client.chat.completions.create(**create_chat_completion_kwargs(spec, timeout=self._timeout))

    def _client_for_spec(self, spec: ModelClientRequest) -> Any:
        """Return an SDK client for the selected OpenAI-compatible endpoint."""

        base_url = base_url_for_spec(spec, self._base_url)

        if self._client is None:
            client = self._clients_by_base_url.get(base_url)
            if client is None:
                api_key = self._api_key_for_spec(spec, base_url=base_url)
                client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=self._timeout)
                self._clients_by_base_url[base_url] = client
            return client
        with_options = getattr(self._client, "with_options", None)
        if callable(with_options):
            return with_options(base_url=base_url, timeout=self._timeout)
        return self._client

    def _api_key_for_spec(self, spec: ModelClientRequest, *, base_url: str) -> str:
        """Resolve the credential for one OpenAI-compatible provider row."""

        normalized_base_url = _normalize_base_url(base_url)
        if normalized_base_url in self._api_keys_by_base_url:
            return self._api_keys_by_base_url[normalized_base_url]
        if is_deepseek_model_provider(spec.model_provider) or is_huggingface_model_provider(spec.model_provider):
            return ""
        return self._api_key


def _normalize_base_url(value: str) -> str:
    return value.strip().rstrip("/")


def _handled_choice_extra_field_names_for_spec(spec: ModelClientRequest) -> frozenset[str]:
    fields = {"text"}
    if is_huggingface_model_provider(spec.model_provider):
        fields.update({"reasoning", "reasoning_content", "token_id"})
    return frozenset(fields)


__all__ = ["OPENAI_HTTP_PROVIDER_TYPE", "OpenAIChatCompletionsModelClient"]
