"""Direct-chat model client for Anthropic's Messages API (official ``anthropic`` SDK)."""

from __future__ import annotations

import asyncio
import hashlib
import time
from collections.abc import AsyncIterator
from typing import Any

import anthropic

from animama.app.model_clients import (
    MCTerminalIncompleteEvent,
    ModelClientDelta,
    ModelClientFinal,
    ModelClientProviderError,
    ModelClientRequest,
    elapsed_ms,
    model_client_event_delta,
    model_client_preview_log_context,
    model_client_request_log_context,
    model_client_run_status_delta,
)
from animama.app.model_clients.credentials import ModelCredentialResolver, connection_for_model_provider
from animama.domain.events import RunStatusKind
from animama.domain.model_connection import BUILTIN_ANTHROPIC_CONNECTION_ID
from animama.logging import get_logger

from .._common import close_maybe_async
from .errors import (
    classify_anthropic_exception,
    model_client_error_from_anthropic_info,
    should_retry_anthropic_error,
    sleep_before_anthropic_retry,
)
from .events import (
    AnthropicStreamState,
    events_from_stream_event,
    public_text_delta,
)
from .final import (
    STOP_REASON_PAUSE_TURN,
    STOP_REASON_REFUSAL,
    AnthropicResponse,
    content_block_param,
    message_final_parts,
)
from .probe import AnthropicClientFactory
from .request import (
    continuation_rounds,
    continuation_with_round,
    messages_request_params,
    messages_with_paused_content,
)
from .support import (
    ANTHROPIC_API,
    ANTHROPIC_CONNECTION_UNSUPPORTED_CODE,
    ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE,
    ANTHROPIC_STREAM_INCOMPLETE_CODE,
    MODEL_REFUSED_CODE,
    anthropic_sdk_client,
)

_log = get_logger("adapters.model_clients.anthropic_messages.client")

MAX_PAUSE_TURN_CONTINUATIONS = 3
"""Resends after ``stop_reason: pause_turn`` before the round ends with what it has."""


class AnthropicMessagesModelClient:
    """Provider-neutral model client backed by the beta ``client.beta.messages.stream``.

    It serves only the built-in ``anthropic`` connection, with only that
    connection's ``ANTHROPIC_API_KEY``, resolved once per stream so a retry
    never mixes keys. One SDK client is kept per credential (keyed by a
    digest, never the key itself), so a key replaced on desktop applies to the
    next request. ``client_factory`` is a test hook that builds a fake client.
    """

    def __init__(
        self,
        *,
        credential_resolver: ModelCredentialResolver,
        timeout: float | None = 60.0,
        client_factory: AnthropicClientFactory | None = None,
    ) -> None:
        self._credentials = credential_resolver
        self._timeout = timeout
        self._client_factory = client_factory or anthropic_sdk_client
        self._clients: dict[tuple[str, float | None], Any] = {}

    @property
    def native_context_compaction(self) -> bool:
        """Chat requests always ask Anthropic to compact a long prompt (D4).

        Read through ``uses_native_context_compaction``: the direct-chat
        executor therefore does not fit Anthropic prompts to the window itself.
        """

        return True

    async def stream(self, spec: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        """Stream one round of a turn as provider-neutral deltas.

        Text deltas from text blocks are public reply text; thinking never is.
        Server-side web searches and compactions are reported as run statuses.
        A round that pauses (``pause_turn``, during server-side search) is
        resumed by resending its content unchanged, at most three times. The
        final carries the round's content blocks as a continuation when the
        model called tools, so the next round resends them unchanged, and the
        turn's latest compaction block as its replay prefix. A refusal raises
        ``model_refused`` after any text already streamed.
        """

        model = spec.model_provider.model
        if spec.model_provider.connection_id != BUILTIN_ANTHROPIC_CONNECTION_ID:
            # Anthropic requests carry the Anthropic key; no other connection may send one.
            raise ModelClientProviderError(
                "Anthropic Messages is only available on the built-in Anthropic connection",
                code=ANTHROPIC_CONNECTION_UNSUPPORTED_CODE,
                raw_metadata={"connection_id": spec.model_provider.connection_id, "model": model},
            )
        connection = connection_for_model_provider(spec.model_provider)
        credential = self._credentials.resolve(connection)
        if not credential.api_key:
            raise ModelClientProviderError(
                f"No key is configured for {connection.name}",
                code="missing_api_key",
                raw_metadata={
                    "provider_type": ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE,
                    "model": model,
                    "connection_id": connection.id,
                    "connection_name": connection.name,
                },
            )
        timeout = connection.timeout_seconds if connection.timeout_seconds is not None else self._timeout
        if spec.limits is not None:
            # A bounded invocation uses the composition's timeout and is never retried here.
            timeout = spec.limits.timeout_seconds
        client = self._client_for(credential.api_key, timeout)
        params = messages_request_params(spec)
        metadata: dict[str, Any] = {"provider": ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE, "api": ANTHROPIC_API}
        request_started_at = time.monotonic()
        attempt = 0
        text_seen = False
        # Started statuses not yet finished, finished before a retry and before
        # the final so each started status is followed by finished.
        open_statuses: list[RunStatusKind] = []
        # This round's responses: the first, then each pause_turn continuation.
        responses: list[AnthropicResponse] = []
        paused_content: list[dict[str, Any]] = []
        while True:
            state = AnthropicStreamState()
            request_params = (
                {**params, "messages": messages_with_paused_content(params["messages"], paused_content)}
                if paused_content
                else params
            )
            try:
                _log.info(
                    "Anthropic Messages stream request started",
                    **model_client_request_log_context(spec, include_prompt_preview=True),
                    attempt=attempt,
                    pause_turn_continuation=len(responses),
                )
                async with client.beta.messages.stream(**request_params) as stream:
                    async for event in stream:
                        for delta in events_from_stream_event(event, model=model, state=state):
                            _track_run_status(open_statuses, delta)
                            yield delta
                        text = public_text_delta(event, state)
                        if text is not None:
                            text_seen = True
                            yield ModelClientDelta(kind="text_delta", text=text, raw_metadata=metadata)
                    message = await stream.get_final_message() if state.message_stopped else None
            except asyncio.CancelledError:
                raise
            except anthropic.AnthropicError as exc:
                info = classify_anthropic_exception(exc, model=model)
                if spec.limits is None and should_retry_anthropic_error(
                    info, attempt=attempt, output_started=text_seen
                ):
                    _log.warning(
                        "Anthropic Messages stream retrying after provider error",
                        **model_client_request_log_context(spec),
                        attempt=attempt,
                        code=info.code,
                        status_code=info.metadata.get("status_code"),
                    )
                    for delta in _finish_run_statuses(open_statuses):
                        yield delta
                    attempt += 1
                    await sleep_before_anthropic_retry(info)
                    continue
                _log.warning(
                    "Anthropic Messages stream failed",
                    **model_client_request_log_context(spec),
                    attempt=attempt,
                    code=info.code,
                    status_code=info.metadata.get("status_code"),
                    provider_error_type=info.metadata.get("provider_error_type"),
                    elapsed_ms=elapsed_ms(request_started_at),
                )
                raise model_client_error_from_anthropic_info(info) from exc

            if message is None:
                # The stream closed without message_stop: never persist partial output.
                yield model_client_event_delta(
                    MCTerminalIncompleteEvent(
                        provider_type=ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE,
                        api=ANTHROPIC_API,
                        model=model,
                        provider_event_type="message.stream_eof",
                        response_id=state.message_id,
                        status="incomplete",
                    )
                )
                raise ModelClientProviderError(
                    "Anthropic stream ended before the message completed",
                    code=ANTHROPIC_STREAM_INCOMPLETE_CODE,
                    raw_metadata={**metadata, "model": model, "message_id": state.message_id},
                )
            responses.append(AnthropicResponse(message=message, stream_iterations=list(state.iterations)))
            if state.stop_reason != STOP_REASON_PAUSE_TURN or len(responses) > MAX_PAUSE_TURN_CONTINUATIONS:
                break
            # The server paused a long server-tool turn: send its content back
            # unchanged and it resumes where it stopped (no extra user message).
            paused_content.extend(content_block_param(block) for block in message.content or ())
            _log.info(
                "Anthropic Messages turn paused; resuming",
                **model_client_request_log_context(spec),
                pause_turn_continuation=len(responses),
                message_id=state.message_id,
            )

        for delta in _finish_run_statuses(open_statuses):
            yield delta
        parts = message_final_parts(responses, earlier_rounds=continuation_rounds(spec.continuation))
        metadata.update(parts.metadata)
        _log.info(
            "Anthropic Messages stream completed",
            **model_client_request_log_context(spec),
            attempt=attempt,
            message_id=parts.metadata.get("message_id"),
            stop_reason=parts.stop_reason,
            pause_turn_continuations=len(responses) - 1,
            final_text_length=len(parts.text),
            tool_call_count=len(parts.tool_calls),
            input_tokens=parts.usage.input_tokens,
            cached_input_tokens=parts.usage.input_tokens_details.cached_tokens,
            output_tokens=parts.usage.output_tokens,
            compacted=bool(parts.replay_prefix),
            elapsed_ms=elapsed_ms(request_started_at),
            **model_client_preview_log_context(final_text_preview=parts.text),
        )
        if parts.stop_reason == STOP_REASON_REFUSAL:
            # The model declined the turn: an error state, never a persisted reply (D12).
            raise ModelClientProviderError(
                "Claude declined to respond to this message",
                code=MODEL_REFUSED_CODE,
                raw_metadata={
                    "provider": ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE,
                    "api": ANTHROPIC_API,
                    "model": model,
                    "message_id": parts.metadata.get("message_id"),
                    "stop_reason": STOP_REASON_REFUSAL,
                    "stop_details_category": parts.refusal_category,
                },
            )
        yield ModelClientDelta(
            kind="final",
            final=ModelClientFinal(
                text=parts.text,
                usage=parts.usage,
                usage_reported=parts.usage_reported,
                raw_provider_metadata=metadata,
                tool_calls=parts.tool_calls,
                continuation=(
                    continuation_with_round(spec.continuation, parts.content, model=model) if parts.tool_calls else None
                ),
                replay_prefix=parts.replay_prefix,
            ),
        )
        yield ModelClientDelta(kind="done")

    async def aclose(self) -> None:
        clients = list(self._clients.values())
        self._clients.clear()
        for client in clients:
            await close_maybe_async(client)

    def _client_for(self, api_key: str, timeout: float | None) -> Any:
        """Return the SDK client for this credential, building it once."""

        cache_key = (hashlib.sha256(api_key.encode("utf-8")).hexdigest(), timeout)
        client = self._clients.get(cache_key)
        if client is None:
            client = self._client_factory(api_key=api_key, timeout=timeout)
            self._clients[cache_key] = client
        return client


def _track_run_status(open_statuses: list[RunStatusKind], delta: ModelClientDelta) -> None:
    status = delta.run_status
    if status is None:
        return
    if status.phase == "started":
        open_statuses.append(status.status)
    elif status.status in open_statuses:
        open_statuses.remove(status.status)


def _finish_run_statuses(open_statuses: list[RunStatusKind]) -> list[ModelClientDelta]:
    """Return ``finished`` deltas for statuses left open (a retried or truncated stream)."""

    finished = [model_client_run_status_delta(status, "finished") for status in reversed(open_statuses)]
    open_statuses.clear()
    return finished


__all__ = ["ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE", "MAX_PAUSE_TURN_CONTINUATIONS", "AnthropicMessagesModelClient"]
