from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import suppress
from typing import Any, cast

from openai.types.chat import ChatCompletionToolUnionParam

from animama.app.main_structured_response import (
    MAIN_STRUCTURED_RESPONSE_FORMAT,
    MAIN_STRUCTURED_RESPONSE_PART_DISPLAY,
    MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE,
    MAIN_STRUCTURED_RESPONSE_PART_SPEECH,
    MainStructuredJsonStreamParser,
    MainStructuredResponse,
    MainStructuredStreamEvent,
    build_main_structured_response_model,
    parse_main_structured_response,
    validate_main_structured_gesture,
)
from animama.app.model_clients import (
    DirectChatPrompt,
    ModelClientDelta,
    ModelClientRegistry,
    ModelClientRequest,
    model_client_preview_log_context,
    model_client_request_log_context,
)
from animama.app.model_clients.prompt import ChatCompletionResponseFormat
from animama.app.ports import ModelProviderRepository
from animama.app.primary_emotion_update import build_primary_emotion_update_event
from animama.app.safety.moderation import moderation_indicates_crisis
from animama.app.services import AnimaChatProfileService, ChatManager
from animama.domain import ModelProvider
from animama.domain.chat import ChatMessage, MessageRole
from animama.domain.events import Event
from animama.logging import get_logger

from .api_standard import chat_api_standard_for_provider
from .direct_turn.events import avatar_gesture_event, crisis_support_event, error_event, user_response_event
from .direct_turn.message_builders import (
    assistant_messages_for_persistence,
    chat_metadata_patch_from_prompt,
    user_provider_message,
)
from .direct_turn.model_stream import DirectTurnModelStreamCollector
from .direct_turn.provider_state import (
    build_memory_tool_config,
    build_model_client_provider_options,
    compiled_context_history,
    native_memory_apply_patch_enabled,
    openai_responses_continuation_from_chat,
    should_skip_context_fetch_for_responses_cursor,
    turn_memory_context_manifest,
    turn_reasoning_effort,
    validate_model_provider_for_direct_turn,
)
from .direct_turn.response_format import (
    build_main_structured_response_format,
    main_structured_response_guidance,
    response_model_agent_id,
    turn_response_format,
    turn_response_schema_name,
)
from .direct_turn.types import (
    DirectChatAttachmentContext,
    DirectChatTurnRequest,
    DirectChatTurnSetupError,
    DirectChatTurnStreamError,
    ModelClientNotFoundError,
    PreparedDirectChatTurn,
    RuntimeGestureDescriptor as RuntimeGestureDescriptor,
)
from .memory_context import DirectChatMemoryContext, DirectChatMemoryContextError, DirectChatMemoryContextService
from .memory_tools import MEMORY_TOOL_SEARCH_UPLOADED_FILES
from .openai_prompt import DirectChatPromptAssembler, scoped_prompt_cache_key

_log = get_logger("app.chat.direct_executor")


class _MainStructuredResponseStreamEmitter:
    """Convert streamed main-structured JSON text into direct chat events.

    A "round" is one model request inside a chat turn. Most turns have one
    round; memory tool calls can create follow-up rounds before the final answer.
    The model-stream collector invokes this emitter through simple observer
    callbacks as each round starts and as provider-neutral text deltas arrive.

    This emitter owns the public policy: only semantic main structured parts are
    emitted, never provider chunks or raw JSON. The final validated JSON remains
    authoritative, so this object also tracks streamed speech/display text and
    asks the executor to send full correction events if final parsing disagrees.
    """

    def __init__(self, request: DirectChatTurnRequest, *, response_format: str) -> None:
        self._request = request
        self._response_format = response_format
        self._round_index: int | None = None
        self._parser = MainStructuredJsonStreamParser()
        self._round_disabled = False
        self._emotional_tone_emitted = False
        self._speech_text_parts: list[str] = []
        self._display_text_parts: list[str] = []
        self._speech_event_count = 0
        self._display_event_count = 0

    def start_round(self, round_index: int) -> None:
        """Reset parser state for one provider model round."""

        if self._round_index == round_index:
            return
        self._round_index = round_index
        self._parser = MainStructuredJsonStreamParser()
        self._round_disabled = False

    def feed_text_delta(self, round_index: int, text: str) -> list[Event]:
        """Return public semantic events decoded from one provider text delta."""

        if self._round_index != round_index:
            self.start_round(round_index)
        if self._round_disabled:
            return []
        try:
            stream_events = self._parser.feed(text)
        except ValueError as exc:
            self._round_disabled = True
            _log.warning(
                "Direct chat main structured stream parser disabled",
                anima_id=self._request.anima_id,
                chat_id=self._request.chat_id,
                run_id=self._request.run_id,
                round_index=round_index,
                exc_type=exc.__class__.__name__,
            )
            return []

        events = [self._event_from_stream_event(stream_event) for stream_event in stream_events]
        if self._parser.streaming_unavailable:
            self._round_disabled = True
            _log.info(
                "Direct chat main structured stream prefix unavailable",
                anima_id=self._request.anima_id,
                chat_id=self._request.chat_id,
                run_id=self._request.run_id,
                round_index=round_index,
            )
        return events

    def final_response_events(self, parsed: MainStructuredResponse) -> list[Event]:
        """Return final full/correction response events not already covered by deltas."""

        events: list[Event] = []
        if not self._emotional_tone_emitted:
            events.append(
                user_response_event(
                    self._request,
                    parsed.emotional_tone,
                    response_format=self._response_format,
                    response_part=MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE,
                    event_id_suffix="emotional-tone",
                    emotional_intensity=parsed.emotional_intensity,
                )
            )

        streamed_speech = "".join(self._speech_text_parts).strip()
        if not streamed_speech:
            events.append(
                self._full_response_event(
                    parsed.speech,
                    response_part=MAIN_STRUCTURED_RESPONSE_PART_SPEECH,
                    event_id_suffix="speech",
                    part_index=0,
                )
            )
        elif streamed_speech != parsed.speech:
            events.append(
                self._full_response_event(
                    parsed.speech,
                    response_part=MAIN_STRUCTURED_RESPONSE_PART_SPEECH,
                    event_id_suffix="speech-final",
                    part_index=self._speech_event_count,
                )
            )

        streamed_display = "".join(self._display_text_parts).strip()
        if parsed.display and not streamed_display:
            events.append(
                self._full_response_event(
                    parsed.display,
                    response_part=MAIN_STRUCTURED_RESPONSE_PART_DISPLAY,
                    event_id_suffix="display",
                    part_index=0,
                )
            )
        elif parsed.display and streamed_display != parsed.display:
            events.append(
                self._full_response_event(
                    parsed.display,
                    response_part=MAIN_STRUCTURED_RESPONSE_PART_DISPLAY,
                    event_id_suffix="display-final",
                    part_index=self._display_event_count,
                )
            )
        return events

    def _event_from_stream_event(self, stream_event: MainStructuredStreamEvent) -> Event:
        response_part = stream_event.response_part
        if response_part == MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE:
            self._emotional_tone_emitted = True
            event_id_suffix = "stream-emotional-tone"
        elif response_part == MAIN_STRUCTURED_RESPONSE_PART_SPEECH:
            if stream_event.text:
                self._speech_text_parts.append(stream_event.text)
            self._speech_event_count += 1
            event_id_suffix = f"stream-speech-{stream_event.part_index or 0}"
        elif response_part == MAIN_STRUCTURED_RESPONSE_PART_DISPLAY:
            if stream_event.text:
                self._display_text_parts.append(stream_event.text)
            self._display_event_count += 1
            event_id_suffix = f"stream-display-{stream_event.part_index or 0}"
        else:
            event_id_suffix = f"stream-{response_part}"
        return user_response_event(
            self._request,
            stream_event.text,
            response_format=self._response_format,
            response_part=response_part,
            event_id_suffix=event_id_suffix,
            is_delta=stream_event.is_delta,
            part_index=stream_event.part_index,
            part_final=stream_event.part_final,
            emotional_intensity=stream_event.emotional_intensity,
        )

    def _full_response_event(
        self,
        text: str,
        *,
        response_part: str,
        event_id_suffix: str,
        part_index: int,
    ) -> Event:
        return user_response_event(
            self._request,
            text,
            response_format=self._response_format,
            response_part=response_part,
            event_id_suffix=event_id_suffix,
            is_delta=False,
            part_index=part_index,
            part_final=True,
        )


class DirectChatTurnExecutor:
    """High-level app-layer orchestrator for one request-local direct chat turn.

    The detailed stream collection, persistence payload building, provider
    continuation state, and event construction live under ``direct_turn``. This
    class intentionally keeps the caller-facing flow in one place while those
    lower-level concerns are split into focused modules.
    """

    def __init__(
        self,
        *,
        registry: ModelClientRegistry,
        profile_service: AnimaChatProfileService | None = None,
        model_providers: ModelProviderRepository | None = None,
        chat_manager: ChatManager | None = None,
        turn_recorder: Any | None = None,
        memory_episode_recorder: Any | None = None,
        prompt_assembler: DirectChatPromptAssembler | None = None,
        memory_context_service: DirectChatMemoryContextService | None = None,
        memory_tool_service: Any | None = None,
    ) -> None:
        self._registry = registry
        self._profile_service = profile_service
        self._model_providers = model_providers
        self._chat_manager = chat_manager
        self._turn_recorder = turn_recorder
        self._memory_episode_recorder = memory_episode_recorder
        self._prompt_assembler = prompt_assembler or DirectChatPromptAssembler()
        self._memory_context_service = memory_context_service
        self._memory_tool_service = memory_tool_service

    async def stream(self, model_request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        """Proxy one provider-neutral request to the registered shared model client."""

        provider_type = model_request.model_provider.provider_type
        client = self._registry.get(provider_type)
        if client is None:
            raise ModelClientNotFoundError(f"No model client registered for provider type {provider_type!r}")
        _log.info(
            "Direct chat model client dispatch started",
            **model_client_request_log_context(model_request, include_prompt_preview=True),
        )
        async for delta in client.stream(model_request):
            yield delta

    async def stream_turn(self, request: DirectChatTurnRequest) -> AsyncIterator[Event]:
        """Run one direct chat turn through the model-client boundary."""

        prepared = await self.prepare_turn(request)
        async for event in self.stream_prepared_turn(prepared):
            yield event

    async def prepare_turn(self, request: DirectChatTurnRequest) -> PreparedDirectChatTurn:
        """Resolve app-layer context and provider request data before streaming.

        The prepared turn is intentionally provider-neutral. OpenAI-specific
        details, such as Chat Completions chunks or Responses events, are handled
        only after this point by the selected model-client adapter.
        """

        _, _, chat_manager, memory_context_service = self._required_services()
        _log.info(
            "Direct chat turn preparation started",
            anima_id=request.anima_id,
            chat_id=request.chat_id,
            run_id=request.run_id,
            requested_model_provider_id=request.model_provider_id,
            incognito=request.options.incognito,
            memory_influence_disabled=request.options.disable_memory_influence,
            memory_updates_disabled=request.options.disable_memory_updates,
            native_tools=list(request.options.native_tools),
            reasoning_effort=request.options.reasoning_effort,
        )
        # Memory tools are request-scoped. Incognito and memory-disable flags are
        # applied before provider validation so unsupported tool combinations are
        # rejected before opening any upstream stream.
        memory_tool_config = build_memory_tool_config(
            request.options,
            enabled=self._memory_tool_service is not None,
        )
        model_provider = await self._resolve_model_provider(request)
        api_standard_profile = chat_api_standard_for_provider(model_provider)
        if api_standard_profile is None:
            raise DirectChatTurnSetupError(f"chat_api_standard_unsupported: {model_provider.id}")
        validate_model_provider_for_direct_turn(
            model_provider,
            request_options=request.options,
            memory_tools_active=memory_tool_config.active,
        )
        if self._registry.get(model_provider.provider_type) is None:
            raise ModelClientNotFoundError(
                f"No model client registered for provider type {model_provider.provider_type!r}"
            )

        # Chat ownership is checked by the ChatManager before the compiled
        # history or continuation cursor can be used in a model request.
        chat = await chat_manager.ensure_owned_chat(
            anima_id=request.anima_id,
            chat_id=request.chat_id,
            user_id=request.user_id,
            api_standard=api_standard_profile.api_standard,
            model_provider_id=model_provider.id,
        )
        try:
            memory_context = await memory_context_service.build_context(
                user_id=request.user_id,
                anima_id=request.anima_id,
                chat_metadata=getattr(chat, "metadata", {}),
                request_options=request.options,
            )
        except DirectChatMemoryContextError as exc:
            raise DirectChatTurnSetupError(str(exc)) from exc
        _log.info(
            "Direct chat memory context built",
            anima_id=request.anima_id,
            chat_id=request.chat_id,
            run_id=request.run_id,
            memory_tools_active=memory_tool_config.active,
            memory_tool_reads=memory_tool_config.allow_reads,
            memory_tool_writes=memory_tool_config.allow_writes,
            attached_file_count=len(request.attached_file_ids),
        )
        memory_tool_specs: tuple[dict[str, Any], ...] = ()
        native_memory_patch = native_memory_apply_patch_enabled(
            model_provider,
            memory_tool_config=memory_tool_config,
        )
        if memory_tool_config.active:
            assert self._memory_tool_service is not None
            memory_tool_specs = tuple(
                self._memory_tool_service.tool_specs(
                    allow_reads=memory_tool_config.allow_reads,
                    allow_writes=memory_tool_config.allow_writes and not native_memory_patch,
                    allow_uploaded_file_tools=memory_tool_config.allow_reads and bool(request.attached_file_ids),
                )
            )
        # Responses providers can continue from the provider-managed response id
        # stored on the chat row. Chat Completions always receives explicit
        # compiled history.
        continuation = openai_responses_continuation_from_chat(chat, model_provider)
        skip_context_fetch = should_skip_context_fetch_for_responses_cursor(model_provider, continuation)
        chat_context = None
        compiled_history: list[Any] = []
        if not skip_context_fetch:
            chat_context = await chat_manager.get_chat_context(chat_id=request.chat_id)
            compiled_history = compiled_context_history(chat_context)
        _log.info(
            "Direct chat history context prepared",
            anima_id=request.anima_id,
            chat_id=request.chat_id,
            run_id=request.run_id,
            context_loaded=not skip_context_fetch,
            previous_response_id_present=continuation is not None,
            compiled_history_count=len(compiled_history),
            visible_message_count=len(getattr(chat_context, "messages", ()) or ()),
        )
        # The public assistant payload still uses Animama's structured response
        # contract. Provider adapters only stream raw model text/events; parsing
        # and avatar state derivation happen after the final model result.
        runtime_gesture_ids = tuple(request.runtime_gesture_ids) if request.runtime_gesture_ids is not None else ()
        output_type = build_main_structured_response_model(
            agent_id=response_model_agent_id(request.node_id),
            gesture_ids=runtime_gesture_ids,
        )
        response_format = build_main_structured_response_format(
            output_type,
            name=turn_response_schema_name(request.options),
        )
        response_event_format = turn_response_format(request.options)
        model_request = ModelClientRequest(
            model_provider=model_provider,
            prompt=self._build_prompt(
                request=request,
                model_provider=model_provider,
                memory_context=memory_context,
                memory_tool_specs=memory_tool_specs,
                visible_history=compiled_history,
                response_format=response_format,
                response_format_guidance=self._gesture_guidance(
                    main_structured_response_guidance(model_provider, output_type),
                    request.runtime_gesture_descriptors,
                ),
                memory_tools_active=memory_tool_config.active,
                native_memory_patch_enabled=native_memory_patch,
            ),
            provider_options=build_model_client_provider_options(
                request.options,
                model_provider=model_provider,
                memory_tool_config=memory_tool_config,
                provider_moderation=request.provider_moderation,
            ),
            continuation=continuation,
        )
        _log.info(
            "Direct chat turn prepared",
            **model_client_request_log_context(model_request),
        )
        return PreparedDirectChatTurn(
            request=request,
            chat=chat,
            model_request=model_request,
            output_type=output_type,
            response_format=response_event_format,
            memory_context=memory_context,
            memory_tool_specs=memory_tool_specs,
            context_loaded=not skip_context_fetch,
            runtime_revision=request.runtime_revision,
            runtime_gesture_ids=runtime_gesture_ids,
        )

    async def stream_prepared_turn(self, prepared: PreparedDirectChatTurn) -> AsyncIterator[Event]:
        """Invoke the model client and translate the final result into domain events."""

        _log.info(
            "Direct chat prepared turn execution started",
            **model_client_request_log_context(prepared.model_request),
        )
        stream_emitter = (
            _MainStructuredResponseStreamEmitter(
                prepared.request,
                response_format=prepared.response_format,
            )
            if prepared.response_format == MAIN_STRUCTURED_RESPONSE_FORMAT
            else None
        )
        early_event_queue: asyncio.Queue[Event | None] = asyncio.Queue()

        async def on_model_round_start(round_index: int) -> None:
            if stream_emitter is not None:
                stream_emitter.start_round(round_index)

        async def on_text_delta(round_index: int, text: str) -> None:
            if stream_emitter is None:
                return
            for event in stream_emitter.feed_text_delta(round_index, text):
                await early_event_queue.put(event)

        async def collect_model_stream() -> tuple[Any, list[ChatMessage]]:
            try:
                return await self._model_stream_collector().collect(
                    prepared,
                    on_model_round_start=on_model_round_start,
                    on_text_delta=on_text_delta,
                )
            finally:
                await early_event_queue.put(None)

        collector_task = asyncio.create_task(
            collect_model_stream(),
            name=f"direct-chat-model-stream-{prepared.request.run_id}",
        )
        try:
            # The collector owns provider stream consumption, final-signal
            # validation, and request-local memory tool loops.
            while True:
                event = await early_event_queue.get()
                if event is None:
                    break
                yield event
            final, internal_tool_messages = await collector_task
        except asyncio.CancelledError:
            collector_task.cancel()
            with suppress(asyncio.CancelledError):
                await collector_task
            raise
        except DirectChatTurnStreamError as exc:
            _log.warning(
                "Direct chat model stream failed",
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                run_id=prepared.request.run_id,
                code=exc.error.code,
                error=exc.error.message,
                details=dict(exc.error.raw_metadata),
            )
            yield error_event(
                prepared.request,
                message=exc.error.message,
                code=exc.error.code or "model_client_error",
                details=dict(exc.error.raw_metadata),
            )
            return
        if final is not None and prepared.model_request.provider_options.moderation_model is not None:
            # Provider moderation arrives with the completed response, after the
            # reply text. It can only add a crisis card; it never alters the turn.
            if moderation_indicates_crisis(final.input_moderation):
                yield crisis_support_event(prepared.request, source="moderation")
            elif final.input_moderation is None or final.input_moderation.status == "error":
                _log.warning(
                    "Direct chat provider moderation unavailable",
                    anima_id=prepared.request.anima_id,
                    run_id=prepared.request.run_id,
                    status=None if final.input_moderation is None else final.input_moderation.status,
                )
        if final is None:
            _log.warning(
                "Direct chat model stream returned no final",
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                run_id=prepared.request.run_id,
            )
            yield error_event(
                prepared.request,
                message="Model client did not return a final response",
                code="model_client_missing_final",
            )
            return
        _log.info(
            "Direct chat model final received",
            anima_id=prepared.request.anima_id,
            chat_id=prepared.request.chat_id,
            run_id=prepared.request.run_id,
            final_text_length=len(final.text),
            tool_call_count=len(final.tool_calls),
            input_tokens=final.usage.input_tokens,
            output_tokens=final.usage.output_tokens,
            total_tokens=final.usage.total_tokens,
            **model_client_preview_log_context(final_text_preview=final.text),
        )

        try:
            # Only the final assistant text is parsed into Animama's structured
            # response. Intermediate provider events stay in model-client
            # observability metadata rather than becoming public chat SSE frames.
            parsed = parse_main_structured_response(final.text, prepared.output_type)
        except Exception as exc:
            _log.warning(
                "Direct chat structured response parse failed",
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                run_id=prepared.request.run_id,
                exc_type=exc.__class__.__name__,
            )
            yield error_event(
                prepared.request,
                message="Model client returned an invalid main structured response",
                code="main_structured_response_parse_failed",
                details={"exc_type": exc.__class__.__name__},
            )
            return
        _log.info(
            "Direct chat structured response parsed",
            anima_id=prepared.request.anima_id,
            chat_id=prepared.request.chat_id,
            run_id=prepared.request.run_id,
            emotional_tone=parsed.emotional_tone,
            emotional_intensity=parsed.emotional_intensity,
            speech_length=len(parsed.speech or ""),
            display_length=len(parsed.display or ""),
            gesture=parsed.gesture,
            **model_client_preview_log_context(
                speech_preview=parsed.speech,
                display_preview=parsed.display,
            ),
        )

        # Emit any structured response parts that were not already covered by
        # semantic stream chunks. The final parsed object remains authoritative.
        response_events = (
            stream_emitter.final_response_events(parsed)
            if stream_emitter is not None
            else [
                user_response_event(
                    prepared.request,
                    parsed.emotional_tone,
                    response_format=prepared.response_format,
                    response_part=MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE,
                    event_id_suffix="emotional-tone",
                    emotional_intensity=parsed.emotional_intensity,
                ),
                user_response_event(
                    prepared.request,
                    parsed.speech,
                    response_format=prepared.response_format,
                    response_part=MAIN_STRUCTURED_RESPONSE_PART_SPEECH,
                    event_id_suffix="speech",
                ),
                *(
                    [
                        user_response_event(
                            prepared.request,
                            parsed.display,
                            response_format=prepared.response_format,
                            response_part=MAIN_STRUCTURED_RESPONSE_PART_DISPLAY,
                            event_id_suffix="display",
                        )
                    ]
                    if parsed.display
                    else []
                ),
            ]
        )
        for event in response_events:
            yield event
        gesture = validate_main_structured_gesture(
            parsed.gesture,
            gesture_ids=prepared.runtime_gesture_ids,
        ).gesture
        if gesture:
            yield avatar_gesture_event(prepared.request, gesture)
        if not prepared.request.options.disable_emotion_updates:
            yield build_primary_emotion_update_event(
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                user_id=prepared.request.user_id,
                run_id=prepared.request.run_id,
                node_id=prepared.request.node_id,
                emotional_state=prepared.request.emotional_state,
                emotional_tone=parsed.emotional_tone,
                emotional_intensity=parsed.emotional_intensity,
            )

        if not prepared.request.options.incognito:
            api_standard_profile = chat_api_standard_for_provider(prepared.model_request.model_provider)
            if api_standard_profile is None:
                raise DirectChatTurnSetupError(
                    f"chat_api_standard_unsupported: {prepared.model_request.model_provider.id}"
                )
            # Persist the user message, internal memory tool transcript, final
            # assistant message, usage, and provider metadata after successful
            # parsing. Incognito turns deliberately skip durable history.
            _log.info(
                "Direct chat turn persistence started",
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                run_id=prepared.request.run_id,
                internal_tool_message_count=len(internal_tool_messages),
            )
            record_result = await self._record_turn(
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                user_msg=ChatMessage(
                    id=None,
                    chat_id=prepared.request.chat_id,
                    run_id=prepared.request.run_id,
                    message_type="message",
                    role=MessageRole.USER,
                    content=prepared.request.user_message,
                    data=(
                        {"attached_file_ids": list(prepared.request.attached_file_ids)}
                        if prepared.request.attached_file_ids
                        else None
                    ),
                    usage=None,
                    turn=None,
                    created_at=None,
                    raw_provider_message=user_provider_message(prepared.request.user_message),
                ),
                assistant_msg=assistant_messages_for_persistence(
                    request=prepared.request,
                    structured=parsed.structured,
                    final=final,
                    model_provider=prepared.model_request.model_provider,
                    internal_tool_messages=internal_tool_messages,
                ),
                chat_metadata_patch=chat_metadata_patch_from_prompt(prepared.model_request.prompt),
                last_model_client=api_standard_profile.model_client,
                last_model_id=prepared.model_request.model_provider.model,
            )
            _log.info(
                "Direct chat turn persistence completed",
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                run_id=prepared.request.run_id,
                internal_tool_message_count=len(internal_tool_messages),
            )
            await self._record_episode_memory(prepared=prepared, parsed=parsed, record_result=record_result)
        else:
            _log.info(
                "Direct chat turn persistence skipped",
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                run_id=prepared.request.run_id,
                reason="incognito",
            )

    async def _resolve_model_provider(self, request: DirectChatTurnRequest) -> ModelProvider:
        """Select the explicit request provider or the anima profile default."""

        profile_service, model_providers, _, _ = self._required_services()
        if request.model_provider_id is not None:
            model_provider = await model_providers.get(request.model_provider_id)
            if model_provider is None:
                raise DirectChatTurnSetupError(f"Model provider not found: {request.model_provider_id}")
            return model_provider

        profile = await profile_service.resolve_for_anima(request.anima_id)
        if profile is None:
            raise DirectChatTurnSetupError(
                "Anima chat profile is required for direct chat; select a model provider before chatting."
            )

        model_provider = await model_providers.get(profile.default_model_provider_id)
        if model_provider is None:
            raise DirectChatTurnSetupError(
                f"Anima default model provider not found: {profile.default_model_provider_id}"
            )
        return model_provider

    @staticmethod
    def _gesture_guidance(
        guidance: str,
        descriptors: tuple[RuntimeGestureDescriptor, ...],
    ) -> str:
        if not descriptors:
            return guidance
        rows = "\n".join(f"- {row.selector}: {row.name} — {row.description}" for row in descriptors)
        return f"{guidance}\n\nAvailable Gestures for this Anima:\n{rows}"

    def _build_prompt(
        self,
        *,
        request: DirectChatTurnRequest,
        model_provider: ModelProvider,
        memory_context: DirectChatMemoryContext,
        memory_tool_specs: tuple[dict[str, Any], ...],
        visible_history: list[Any],
        response_format: dict[str, Any],
        response_format_guidance: str,
        memory_tools_active: bool = False,
        native_memory_patch_enabled: bool = False,
    ) -> DirectChatPrompt:
        """Assemble provider-neutral prompt state for the selected model client."""

        return self._prompt_assembler.assemble(
            user_message=request.user_message,
            anima_identity=memory_context.anima_identity,
            anima_name=memory_context.anima_name,
            response_format_guidance=response_format_guidance,
            native_memory_patch_enabled=native_memory_patch_enabled,
            memory_map=getattr(memory_context, "memory_map", None),
            attached_files=(
                request.attached_files
                if any(
                    spec.get("function", {}).get("name") == MEMORY_TOOL_SEARCH_UPLOADED_FILES
                    for spec in memory_tool_specs
                )
                else ()
            ),
            supports_developer_role=model_provider.accepts_developer_role,
            visible_history=visible_history,
            # These dictionaries are produced by the local schema/tool builders.
            response_format=cast(ChatCompletionResponseFormat, response_format),
            tools=cast(tuple[ChatCompletionToolUnionParam, ...], memory_tool_specs),
            tool_choice="auto" if memory_tools_active else None,
            parallel_tool_calls=False if memory_tools_active else None,
            prompt_cache_key=scoped_prompt_cache_key(
                user_id=request.user_id,
                anima_id=request.anima_id,
                provider_type=model_provider.provider_type,
                model=model_provider.model,
            ),
            reasoning_effort=turn_reasoning_effort(request.options),
            metadata={
                "anima_id": request.anima_id,
                "chat_id": request.chat_id,
                "run_id": request.run_id,
                "context_source": "direct_chat_model_client",
                "memory_context": turn_memory_context_manifest(
                    memory_context.manifest,
                    request=request,
                    model_provider=model_provider,
                ),
            },
        )

    def _model_stream_collector(self) -> DirectTurnModelStreamCollector:
        """Create the stream collector with executor-local callbacks."""

        _, _, chat_manager, _ = self._required_services()

        async def load_chat_context(chat_id: str) -> Any:
            return await chat_manager.get_chat_context(chat_id=chat_id)

        return DirectTurnModelStreamCollector(
            stream=self.stream,
            memory_tool_service=self._memory_tool_service,
            load_chat_context=load_chat_context,
            build_prompt=self._build_prompt,
        )

    def _required_services(
        self,
    ) -> tuple[AnimaChatProfileService, ModelProviderRepository, ChatManager, DirectChatMemoryContextService]:
        """Return configured collaborators or fail before any provider call starts."""

        if (
            self._profile_service is None
            or self._model_providers is None
            or self._chat_manager is None
            or self._memory_context_service is None
        ):
            raise DirectChatTurnSetupError("Direct chat turn executor dependencies are not configured")
        return self._profile_service, self._model_providers, self._chat_manager, self._memory_context_service

    async def _record_turn(self, **kwargs: Any) -> Any:
        """Persist a successful direct turn through the configured recorder."""

        recorder = self._turn_recorder or self._chat_manager
        if recorder is None:
            raise DirectChatTurnSetupError("Direct chat turn recorder dependency is not configured")
        return await recorder.record_turn(**kwargs)

    async def _record_episode_memory(
        self,
        *,
        prepared: PreparedDirectChatTurn,
        parsed: MainStructuredResponse,
        record_result: Any,
    ) -> None:
        """Best-effort capture of the final turn's structured `remember` note."""

        remember = parsed.remember.strip() if isinstance(parsed.remember, str) else ""
        if not remember:
            return
        if prepared.request.options.disable_memory_updates:
            _log.info(
                "Direct chat episodic memory skipped",
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                run_id=prepared.request.run_id,
                reason="memory_updates_disabled",
            )
            return
        recorder = self._memory_episode_recorder
        if recorder is None:
            _log.info(
                "Direct chat episodic memory skipped",
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                run_id=prepared.request.run_id,
                reason="recorder_unavailable",
            )
            return
        try:
            await recorder.record_episode_item(
                user_id=prepared.request.user_id,
                source_anima_id=prepared.request.anima_id,
                source_chat_id=prepared.request.chat_id,
                source_run_id=prepared.request.run_id,
                source_message_id=_assistant_message_id_from_record_result(record_result),
                text=remember,
            )
        except Exception as exc:
            _log.warning(
                "Direct chat episodic memory capture failed",
                anima_id=prepared.request.anima_id,
                chat_id=prepared.request.chat_id,
                run_id=prepared.request.run_id,
                exc_type=exc.__class__.__name__,
            )
            return
        _log.info(
            "Direct chat episodic memory captured",
            anima_id=prepared.request.anima_id,
            chat_id=prepared.request.chat_id,
            run_id=prepared.request.run_id,
        )


def _assistant_message_id_from_record_result(record_result: Any) -> str | None:
    """Return the persisted final assistant message id when recorder output exposes it."""

    if not isinstance(record_result, tuple) or len(record_result) < 2:
        return None
    assistant_result = record_result[1]
    if isinstance(assistant_result, ChatMessage):
        candidates = [assistant_result]
    elif isinstance(assistant_result, list | tuple):
        candidates = [message for message in assistant_result if isinstance(message, ChatMessage)]
    else:
        return None
    for message in reversed(candidates):
        if message.role is not MessageRole.ASSISTANT:
            continue
        if message.internal:
            continue
        if message.message_type != "message":
            continue
        if message.id is not None:
            return str(message.id)
    return None


__all__ = [
    "DirectChatAttachmentContext",
    "DirectChatTurnExecutor",
    "DirectChatTurnRequest",
    "DirectChatTurnSetupError",
    "DirectChatTurnStreamError",
    "ModelClientNotFoundError",
    "PreparedDirectChatTurn",
    "build_main_structured_response_format",
]
