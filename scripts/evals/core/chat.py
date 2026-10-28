"""Chat's turn executor around in-memory stand-ins, and the requests and history an evaluation sends.

The stand-ins replace the repositories ``DirectChatTurnExecutor`` reads, so an
evaluation turn reads and writes no Anima, chat or memory row. The replay
helpers follow the executor's own recovery order, so a scripted chat's later
turns see the history chat would have persisted.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, cast

from pydantic import BaseModel

from animama.app.chat import (
    DirectChatMemoryContext,
    DirectChatMemoryContextService,
    DirectChatPrompt,
    DirectChatTurnExecutor,
    DirectChatTurnRequest,
    DirectChatTurnSetupError,
    RuntimeGestureDescriptor,
)
from animama.app.chat.api_standard import OPENAI_CHAT_COMPLETIONS_PROVIDER_TYPE
from animama.app.chat.conversation_language import ConversationLanguage
from animama.app.chat.direct_turn.message_builders import user_provider_message
from animama.app.chat.memory_context import MEMORY_CONTEXT_METADATA_VERSION
from animama.app.chat.options import DirectChatOptions, DirectChatTtsOptions
from animama.app.main_structured_response import (
    MAIN_STRUCTURED_RESPONSE_PART_REMEMBER,
    MAIN_STRUCTURED_RESPONSE_PART_SPEECH,
    MainStructuredJsonStreamParser,
    MainStructuredResponse,
    main_structured_response_from_data,
    plain_text_main_structured_response,
    recover_main_structured_response,
    render_main_structured_json,
)
from animama.app.model_catalog import STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
from animama.app.model_clients import ModelClient, StaticModelClientRegistry
from animama.app.ports import ModelProviderRepository
from animama.app.services import AnimaChatProfileService, ChatManager
from animama.domain import ModelProvider, ModelProviderCapabilities
from animama.domain.chat import Chat, ChatContext, ChatMessage, MessageRole
from animama.domain.events import Event, EventType, UserResponsePayload

__all__ = [
    "ESTIMATE_MODEL_PROVIDER",
    "EvalChats",
    "NoAnimaProfile",
    "SelectedModelProvider",
    "StaticMemoryContext",
    "build_executor",
    "history_rows",
    "incognito_turn_options",
    "instruction_bytes",
    "is_speech",
    "replayed_reply",
    "turn_request",
]

# A built-in JSON-schema chat row used only to size prompts for the dry-run token estimate.
ESTIMATE_MODEL_PROVIDER = ModelProvider(
    id="gesture-eval:json-schema-estimate",
    model="json-schema-estimate",
    provider_type=OPENAI_CHAT_COMPLETIONS_PROVIDER_TYPE,
    model_label="JSON-schema estimate",
    provider_label="Estimate",
    capabilities=ModelProviderCapabilities(
        supports_streaming=True,
        structured_kinds=["main_structured_response"],
        structured_output_transport=STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
    ),
)


class EvalChats:
    """In-memory stand-in for ``ChatManager`` that keeps each evaluation conversation's history.

    Incognito turns are never recorded by chat, so the runner appends each
    successful turn's replay rows here and the next scripted turn reads them back.
    """

    def __init__(self) -> None:
        self._messages: dict[str, list[ChatMessage]] = {}

    async def ensure_owned_chat(
        self,
        *,
        anima_id: str,
        chat_id: str,
        user_id: str,
        api_standard: str | None = None,
        model_provider_id: str | None = None,
    ) -> Chat:
        # No Responses cursor: every turn sends its explicit visible history.
        return Chat(
            id=chat_id,
            anima_id=anima_id,
            user_id=user_id,
            api_standard=api_standard,
            last_model_provider_id=model_provider_id,
        )

    async def get_chat_context(self, *, chat_id: str, native_compaction: bool = False) -> ChatContext:
        # Evaluation chats keep no compaction, so ``native_compaction`` changes nothing.
        del native_compaction
        return ChatContext(messages=list(self._messages.get(chat_id, ())))

    async def record_turn(self, **_: Any) -> None:
        raise AssertionError("Incognito evaluation turns must never be persisted")

    def append(self, chat_id: str, rows: Sequence[ChatMessage]) -> None:
        self._messages.setdefault(chat_id, []).extend(rows)


class StaticMemoryContext:
    """Stand-in for ``DirectChatMemoryContextService``: a fixed identity and no memories.

    Matches what chat builds with memory influence off: no memory map and no ``MEMORIES.md``.
    """

    def __init__(self, *, identity: str, name: str) -> None:
        self._identity = identity
        self._name = name

    async def build_context(self, *, anima_id: str, **_: Any) -> DirectChatMemoryContext:
        return DirectChatMemoryContext(
            anima_identity=self._identity,
            anima_name=self._name,
            manifest={
                "version": MEMORY_CONTEXT_METADATA_VERSION,
                "anima_id": anima_id,
                "disable_memory_influence": True,
                "opened_files": [],
            },
        )


class SelectedModelProvider:
    """Model-provider repository holding only the row chosen for the evaluation."""

    def __init__(self, model_provider: ModelProvider) -> None:
        self._model_provider = model_provider

    async def get(self, model_provider_id: str, *, for_update: bool = False) -> ModelProvider | None:
        return self._model_provider if model_provider_id == self._model_provider.id else None


class NoAnimaProfile:
    """Every evaluation turn names its model, so chat never consults an Anima chat profile."""

    async def resolve_for_anima(self, anima_id: str) -> None:
        raise DirectChatTurnSetupError("The evaluation always names its model provider")


def build_executor(
    model_provider: ModelProvider,
    client: ModelClient,
    chats: EvalChats,
    *,
    memory_context: DirectChatMemoryContextService | StaticMemoryContext,
) -> DirectChatTurnExecutor:
    """Build chat's turn executor around the in-memory stand-ins and one model client.

    ``memory_context`` is the real memory context service, or the stand-in with a fixed identity.
    """

    return DirectChatTurnExecutor(
        registry=StaticModelClientRegistry({model_provider.provider_type: client}),
        profile_service=cast(AnimaChatProfileService, NoAnimaProfile()),
        model_providers=cast(ModelProviderRepository, SelectedModelProvider(model_provider)),
        chat_manager=cast(ChatManager, chats),
        # The stand-in provides only the ``build_context`` the executor calls.
        memory_context_service=cast(DirectChatMemoryContextService, memory_context),
    )


def incognito_turn_options(
    reasoning_effort: str | None,
    *,
    tts: DirectChatTtsOptions | None = None,
) -> DirectChatOptions:
    """Options for a turn that stores and remembers nothing; ``tts`` selects the voice's speech rules."""

    # Incognito: store=False at the provider, no persistence and no pre-send compaction.
    # Memory influence and updates off: no memory map, MEMORIES.md or episode capture.
    return DirectChatOptions(
        incognito=True,
        disable_memory_influence=True,
        disable_memory_updates=True,
        reasoning_effort=reasoning_effort,
        tts=tts,
    )


def turn_request(
    gestures: Sequence[RuntimeGestureDescriptor],
    *,
    anima_id: str,
    user_id: str,
    chat_id: str,
    turn_index: int,
    message: str,
    model_provider_id: str,
    options: DirectChatOptions,
    conversation_language: ConversationLanguage | None = None,
    provider_moderation: bool = False,
) -> DirectChatTurnRequest:
    """One turn's request; the language and moderation default to an English turn without moderation."""

    return DirectChatTurnRequest(
        anima_id=anima_id,
        user_id=user_id,
        chat_id=chat_id,
        run_id=f"{chat_id}/t{turn_index}",
        user_message=message,
        model_provider_id=model_provider_id,
        request_options=options,
        runtime_gesture_ids=tuple(gesture.selector for gesture in gestures),
        runtime_gesture_descriptors=tuple(gestures),
        conversation_language=conversation_language,
        provider_moderation=provider_moderation,
    )


def instruction_bytes(prompt: DirectChatPrompt) -> int:
    """UTF-8 size of a prompt's system and developer messages."""

    total = 0
    for message in prompt.messages:
        entry = cast(Mapping[str, Any], message)
        content = entry.get("content")
        if entry.get("role") in {"system", "developer"} and isinstance(content, str):
            total += len(content.encode("utf-8"))
    return total


def _salvaged_reply(text_deltas: Sequence[str]) -> MainStructuredResponse | None:
    """Rebuild the reply chat salvages from a reply's streamed text, or ``None`` when no speech streamed.

    Mirrors ``_MainStructuredResponseStreamEmitter``: chat feeds the same parser
    delta by delta, stops when the parser fails or the stream is not
    structured, and salvages only after speech reached the client.
    """

    parser = MainStructuredJsonStreamParser()
    speech_streamed = False
    for delta in text_deltas:
        try:
            events = parser.feed(delta)
        except ValueError:
            break
        speech_streamed = speech_streamed or any(
            event.response_part == MAIN_STRUCTURED_RESPONSE_PART_SPEECH and event.text for event in events
        )
        if parser.streaming_unavailable:
            break
    data = parser.salvaged_data() if speech_streamed else None
    return main_structured_response_from_data(data) if data is not None else None


def replayed_reply(
    final_texts: Sequence[str],
    output_type: type[BaseModel],
    *,
    first_reply_deltas: Sequence[str] = (),
) -> tuple[MainStructuredResponse, str, str | None] | None:
    """Return the reply a turn produced, the text chat would replay for it in history, and its recovery.

    ``final_texts`` are the turn's successful replies in call order: the first
    reply, then its structured repair when one was requested;
    ``first_reply_deltas`` is the text the first reply streamed. This follows
    the executor's order (``_recover_final_reply``): the final text when it
    validates (``"repaired"`` after a repair); then the reply salvaged from
    streamed speech, which chat keeps instead of requesting a repair; then a
    neutral plain-text reply. Salvaged and plain-text replies are replayed as
    structured JSON.
    """

    if not final_texts:
        return None
    final_text = final_texts[-1]
    try:
        reply = recover_main_structured_response(final_text, output_type)
    except ValueError:
        pass
    else:
        return reply, final_text, "repaired" if len(final_texts) > 1 else None
    # Chat salvages only the first reply: a salvaged reply is never repaired.
    # The model benchmark's MEMORIES.md-only reply model has no `remember`; chat replays without it then.
    remember = MAIN_STRUCTURED_RESPONSE_PART_REMEMBER in output_type.model_fields
    salvaged = _salvaged_reply(first_reply_deltas) if len(final_texts) == 1 else None
    if salvaged is not None:
        return salvaged, render_main_structured_json(salvaged, remember=remember), "salvaged"
    for text in (final_text, final_texts[0]):
        plain = plain_text_main_structured_response(text)
        if plain is not None:
            return plain, render_main_structured_json(plain, remember=remember), "plain_text"
    return None


def history_rows(request: DirectChatTurnRequest, replay_text: str) -> list[ChatMessage]:
    """Build the user and assistant rows chat persists for a turn, which later turns replay."""

    def row(role: MessageRole, content: str, raw_provider_message: dict[str, Any]) -> ChatMessage:
        return ChatMessage(
            id=None,
            chat_id=request.chat_id,
            run_id=request.run_id,
            message_type="message",
            role=role,
            content=content,
            data=None,
            usage=None,
            turn=None,
            created_at=None,
            raw_provider_message=raw_provider_message,
        )

    return [
        row(MessageRole.USER, request.user_message, user_provider_message(request.user_message)),
        row(MessageRole.ASSISTANT, replay_text, {"role": "assistant", "content": replay_text}),
    ]


def is_speech(event: Event) -> bool:
    """Whether the event carries spoken reply text, the first output a listener hears."""

    payload = event.payload
    return (
        event.type is EventType.USER_RESPONSE
        and isinstance(payload, UserResponsePayload)
        and payload.response_part == MAIN_STRUCTURED_RESPONSE_PART_SPEECH
        and bool(payload.value)
    )
