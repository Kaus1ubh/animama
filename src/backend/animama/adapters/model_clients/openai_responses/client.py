from __future__ import annotations

import asyncio
import os
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, cast

from openai import AsyncOpenAI, OpenAIError
from openai.types.responses import (
    ResponseCompletedEvent,
    ResponseErrorEvent,
    ResponseFailedEvent,
    ResponseIncompleteEvent,
    ResponseOutputItemAddedEvent,
    ResponseOutputItemDoneEvent,
    ResponseStreamEvent,
    ResponseTextDeltaEvent,
)

from animama.app.model_clients import (
    MCTerminalIncompleteEvent,
    ModelClientDelta,
    ModelClientFinal,
    ModelClientProviderError,
    ModelClientRequest,
    elapsed_ms,
    model_client_preview_log_context,
    model_client_request_log_context,
)
from animama.logging import get_logger

from .._common import close_maybe_async
from ..openai_errors import (
    classify_openai_exception,
    classify_openai_response_event,
    model_client_error_from_openai_info,
    should_retry_openai_error,
    sleep_before_openai_retry,
)
from .events import (
    event_metadata,
    events_from_response_stream_event,
    response_event_type,
    response_from_terminal_event,
    responses_stream_event_delta,
)
from .final import response_final_parts
from .request import base_url_for_spec, create_response_kwargs, previous_response_id
from .support import (
    DEFAULT_BASE_URL,
    OPENAI_API,
    OPENAI_MISSING_FINAL_ANSWER_PHASE_CODE,
    OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
    OPENAI_STREAM_INCOMPLETE_CODE,
    PHASE_FINAL_ANSWER,
    clean_str,
    response_item_id,
    response_message_phase,
)

_log = get_logger("adapters.model_clients.openai_responses.client")


@dataclass(slots=True)
class _ResponseStreamState:
    """Request-local state for filtering Responses text into public output."""

    public_text_parts: list[str] = field(default_factory=list)
    item_phases: dict[str, str] = field(default_factory=dict)
    stream_started: bool = False

    def record_output_item(self, item: object) -> None:
        """Remember item phase before later text deltas reference item_id."""

        item_id = response_item_id(item)
        phase = response_message_phase(item)
        if item_id is not None and phase is not None:
            self.item_phases[item_id] = phase

    def text_delta_for_public_stream(self, event: ResponseTextDeltaEvent) -> str | None:
        """Return text only for final-answer or unphased assistant messages."""

        delta = event.delta
        if not isinstance(delta, str) or not delta:
            return None
        self.stream_started = True
        phase = self.item_phases.get(event.item_id)
        if phase is None or phase == PHASE_FINAL_ANSWER:
            self.public_text_parts.append(delta)
            return delta
        return None


class OpenAIResponsesModelClient:
    """Provider-neutral model client backed by OpenAI Responses streaming."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        client: AsyncOpenAI | None = None,
        timeout: float | None = 60.0,
        compaction_threshold_tokens: int | None = 200_000,
        close_client: bool | None = None,
    ) -> None:
        resolved_api_key = api_key if api_key is not None else os.getenv("OPENAI_API_KEY")
        resolved_base_url = base_url if base_url is not None else os.getenv("OPENAI_BASE_URL")
        self._api_key = (resolved_api_key or "").strip()
        self._base_url = (resolved_base_url or DEFAULT_BASE_URL).rstrip("/")
        self._client = client
        self._timeout = timeout
        self._compaction_threshold_tokens = compaction_threshold_tokens
        self._close_client = (client is None) if close_client is None else close_client

    async def stream(self, spec: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        """Stream typed Responses events as provider-neutral deltas.

        Responses streaming is event-type based. This adapter forwards every
        meaningful event as an MC observability event, streams public text only
        from final-answer/unphased assistant messages, and emits ModelClientFinal
        only after the terminal `response.completed` event is received.
        """

        if self._client is None and not self._api_key:
            raise ModelClientProviderError("OpenAI API key is not configured", code="missing_api_key")

        metadata: dict[str, Any] = {
            "provider": OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
            "api": "responses",
            "model": spec.model_provider.model,
        }
        state = _ResponseStreamState()
        previous_id = previous_response_id(spec)
        if previous_id is not None:
            metadata["previous_response_id"] = previous_id

        request_started_at = time.monotonic()
        attempt = 0
        event_count = 0
        event_delta_count = 0
        text_delta_count = 0
        public_text_delta_count = 0
        first_event_logged = False
        while True:
            try:
                attempt_started_at = time.monotonic()
                _log.info(
                    "OpenAI Responses stream request started",
                    **model_client_request_log_context(spec, include_prompt_preview=True),
                    attempt=attempt,
                )
                stream = await self._create_stream(spec, previous_response_id=previous_id)
                _log.info(
                    "OpenAI Responses stream opened",
                    **model_client_request_log_context(spec),
                    attempt=attempt,
                    elapsed_ms=elapsed_ms(attempt_started_at),
                )
                try:
                    async for raw_event in stream:
                        state.stream_started = True
                        event = cast(ResponseStreamEvent, raw_event)
                        event_count += 1
                        event_type = response_event_type(event)
                        if not first_event_logged:
                            first_event_logged = True
                            _log.info(
                                "OpenAI Responses first stream event received",
                                **model_client_request_log_context(spec),
                                attempt=attempt,
                                provider_event_type=event_type,
                                elapsed_ms=elapsed_ms(request_started_at),
                            )
                        # Preserve the complete typed event stream as normalized
                        # model-client events, including phases, native tools,
                        # function-call arguments, and unknown provider events.
                        event_deltas = events_from_response_stream_event(
                            event,
                            provider_type=OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
                            model=spec.model_provider.model,
                            previous_response_id=previous_id,
                        )
                        event_delta_count += len(event_deltas)
                        for event_delta in event_deltas:
                            yield event_delta

                        if isinstance(event, ResponseOutputItemAddedEvent | ResponseOutputItemDoneEvent):
                            # Output item phase may arrive on item lifecycle
                            # events before the text delta that references it.
                            state.record_output_item(event.item)

                        if isinstance(event, ResponseTextDeltaEvent):
                            # Commentary text is observable but not public chat
                            # output. Only final_answer/unphased text becomes a
                            # direct chat text_delta.
                            text_delta_count += 1
                            delta = state.text_delta_for_public_stream(event)
                            if delta is not None:
                                public_text_delta_count += 1
                                yield ModelClientDelta(kind="text_delta", text=delta, raw_metadata=metadata)
                            continue

                        if isinstance(event, ResponseCompletedEvent) or event_type == "response.done":
                            # Terminal completion carries the authoritative
                            # Response object. Extract final text, usage, tool
                            # calls, phase metadata, and native tool summaries.
                            response = response_from_terminal_event(event)
                            final_parts = response_final_parts(
                                response,
                                previous_response_id=previous_id,
                            )
                            metadata.update(final_parts.metadata)
                            state.stream_started = True
                            final_text = (
                                final_parts.text if final_parts.text is not None else "".join(state.public_text_parts)
                            )
                            _log.info(
                                "OpenAI Responses terminal completion received",
                                **model_client_request_log_context(spec),
                                attempt=attempt,
                                response_id=response.id,
                                status=response.status,
                                event_count=event_count,
                                event_delta_count=event_delta_count,
                                text_delta_count=text_delta_count,
                                public_text_delta_count=public_text_delta_count,
                                final_text_length=len(final_text),
                                tool_call_count=len(final_parts.tool_calls),
                                missing_final_answer_phase=final_parts.missing_final_answer_phase,
                                elapsed_ms=elapsed_ms(request_started_at),
                                **model_client_preview_log_context(final_text_preview=final_text),
                            )
                            if final_parts.missing_final_answer_phase:
                                # If the model used phased output but never
                                # produced final_answer, treat the turn as
                                # incomplete instead of persisting commentary.
                                metadata["missing_final_answer_phase"] = True
                                raise ModelClientProviderError(
                                    "OpenAI Responses stream completed without a final_answer phase",
                                    code=OPENAI_MISSING_FINAL_ANSWER_PHASE_CODE,
                                    raw_metadata=metadata,
                                )
                            yield ModelClientDelta(
                                kind="final",
                                final=ModelClientFinal(
                                    text=final_text,
                                    usage=final_parts.usage,
                                    raw_provider_metadata=metadata,
                                    tool_calls=final_parts.tool_calls,
                                ),
                            )
                            yield ModelClientDelta(kind="done")
                            return
                        if isinstance(event, ResponseErrorEvent | ResponseFailedEvent | ResponseIncompleteEvent) or (
                            event_type in {"error", "response.failed", "response.incomplete"}
                        ):
                            # Error/incomplete typed events terminate the turn
                            # as provider errors; they are not converted to
                            # successful ModelClientFinal values.
                            info = classify_openai_response_event(
                                event_metadata(event),
                                provider_type=OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
                                model=spec.model_provider.model,
                                previous_response_id=previous_id,
                            )
                            _log.warning(
                                "OpenAI Responses terminal error event received",
                                **model_client_request_log_context(spec),
                                attempt=attempt,
                                provider_event_type=event_type,
                                code=info.code,
                                response_id=info.metadata.get("response_id"),
                                status=info.metadata.get("status"),
                                elapsed_ms=elapsed_ms(request_started_at),
                            )
                            raise model_client_error_from_openai_info(info)
                finally:
                    await close_maybe_async(stream)
            except asyncio.CancelledError:
                raise
            except ModelClientProviderError:
                raise
            except OpenAIError as exc:
                info = classify_openai_exception(
                    exc,
                    api=OPENAI_API,
                    provider_type=OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
                    model=spec.model_provider.model,
                    previous_response_id=previous_id,
                )
                if should_retry_openai_error(info, attempt=attempt, stream_started=state.stream_started):
                    _log.warning(
                        "OpenAI Responses stream retrying after provider error",
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

        metadata["completed_missing"] = True
        _log.warning(
            "OpenAI Responses stream ended without terminal event",
            **model_client_request_log_context(spec),
            attempt=attempt,
            event_count=event_count,
            event_delta_count=event_delta_count,
            text_delta_count=text_delta_count,
            public_text_delta_count=public_text_delta_count,
            elapsed_ms=elapsed_ms(request_started_at),
        )
        # Reaching EOF without a terminal Responses event means the provider
        # stream ended ambiguously. Surface this as a failure so direct chat does
        # not persist partial output as a valid assistant response.
        yield responses_stream_event_delta(
            event_cls=MCTerminalIncompleteEvent,
            provider_type=OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
            model=spec.model_provider.model,
            provider_event_type="response.stream_eof",
            response_id=clean_str(metadata.get("response_id")),
            status="incomplete",
            details={"completed_missing": True},
        )
        raise ModelClientProviderError(
            "OpenAI Responses stream ended without a terminal event",
            code=OPENAI_STREAM_INCOMPLETE_CODE,
            raw_metadata=metadata,
        )

    async def aclose(self) -> None:
        client = self._client
        if client is not None and self._close_client:
            await client.close()
        self._client = None

    async def _create_stream(self, spec: ModelClientRequest, *, previous_response_id: str | None) -> Any:
        """Create the OpenAI SDK Responses stream."""

        client = self._client_for_spec(spec)
        kwargs = create_response_kwargs(
            spec,
            previous_response_id,
            timeout=self._timeout,
            compaction_threshold_tokens=self._compaction_threshold_tokens,
        )
        return await client.responses.create(**kwargs)

    def _client_for_spec(self, spec: ModelClientRequest) -> Any:
        """Return a shared SDK client, overriding base URL/timeout per request."""

        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=self._api_key,
                base_url=base_url_for_spec(spec, self._base_url),
                timeout=self._timeout,
            )
            self._close_client = True
            return self._client
        with_options = getattr(self._client, "with_options", None)
        if callable(with_options):
            return with_options(base_url=base_url_for_spec(spec, self._base_url), timeout=self._timeout)
        return self._client


__all__ = ["OPENAI_RESPONSES_HTTP_PROVIDER_TYPE", "OpenAIResponsesModelClient"]
