"""Structured-reply recovery for direct chat turns (configurable models Plan B, R12).

A final reply is validated locally. Replies that fail get one repair request;
a reply whose speech already streamed is salvaged instead; a reply that still
fails becomes plain text with neutral emotion and no gesture.
"""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from typing import Any

import pytest

from animama.app.main_structured_response import (
    MAIN_STRUCTURED_RESPONSE_FORMAT,
    MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE,
    MAIN_STRUCTURED_RESPONSE_PART_SPEECH,
)
from animama.app.model_clients import ModelClientError, ModelClientFinal, ModelClientToolCall
from animama.app.model_clients.prompt import prompt_messages
from animama.app.safety.prompts import COMPANION_GUARDRAILS
from animama.domain import ModelConnection, ModelConnectionCompatibility
from animama.domain.events import EventType
from animama.domain.usage import Usage
from tests.test_direct_chat_turn_executor import (
    _ChunkedModelClient,
    _collect,
    _executor,
    _FakeMemoryToolService,
    _provider,
    _request,
    _ScriptedModelClient,
    _structured_response,
)


class _RecordingHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


def _final(text: str, *, tokens: int = 5, **metadata: Any) -> ModelClientFinal:
    return ModelClientFinal(
        text=text,
        usage=Usage(requests=1, input_tokens=tokens - 1, output_tokens=1, total_tokens=tokens),
        raw_provider_metadata=dict(metadata),
    )


def _speech_text(events: list[Any]) -> str:
    return "".join(
        str(event.payload.value or "")
        for event in events
        if event.type == EventType.USER_RESPONSE
        and getattr(event.payload, "response_part", None) == MAIN_STRUCTURED_RESPONSE_PART_SPEECH
    )


def _assistant(chats: Any) -> Any:
    assistant = chats.record_turn_calls[0]["assistant_msg"]
    return assistant[-1] if isinstance(assistant, list) else assistant


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    [
        "```json\n" + _structured_response(speech="Fenced reply.") + "\n```",
        "Sure! " + _structured_response(speech="Fenced reply.") + " Hope that helps.",
    ],
)
async def test_direct_turn_accepts_a_reply_wrapped_in_a_fence_or_prose(text: str) -> None:
    model_client = _ScriptedModelClient([_final(text)])
    executor, chats = _executor(client=model_client)

    events = await _collect(executor.stream_turn(_request()))

    assert len(model_client.seen_specs) == 1
    assert _speech_text(events) == "Fenced reply."
    assert _assistant(chats).data["structured"]["speech"] == "Fenced reply."
    assert "structured_recovery" not in _assistant(chats).data


@pytest.mark.asyncio
async def test_direct_turn_coerces_missing_optional_fields_and_unknown_keys() -> None:
    text = json.dumps({"speech": "Only speech.", "gesture": "not-a-gesture", "mood": "calm"})
    model_client = _ScriptedModelClient([_final(text)])
    executor, chats = _executor(client=model_client)

    events = await _collect(executor.stream_turn(_request()))

    assert len(model_client.seen_specs) == 1
    assert _speech_text(events) == "Only speech."
    assert EventType.AVATAR_GESTURE_REQUESTED not in [event.type for event in events]
    structured = _assistant(chats).data["structured"]
    assert structured["emotional_tone"] == "neutral"
    assert structured["speech"] == "Only speech."


@pytest.mark.asyncio
async def test_direct_turn_repairs_an_invalid_reply_once() -> None:
    model_client = _ScriptedModelClient(
        [_final("I am not JSON.", tokens=5), _final(_structured_response(speech="Repaired."), tokens=7)]
    )
    executor, chats = _executor(client=model_client, memory_tool_service=_FakeMemoryToolService())

    events = await _collect(executor.stream_turn(_request()))

    first, repair = model_client.seen_specs
    assert first.prompt.tools
    assert repair.prompt.tools == ()
    assert repair.prompt.response_format == first.prompt.response_format
    messages = prompt_messages(repair.prompt)
    assert messages[-2] == {"role": "assistant", "content": "I am not JSON."}
    assert messages[-1]["role"] == "developer"
    assert messages[-1]["content"].endswith(COMPANION_GUARDRAILS.strip())
    assert EventType.ERROR not in [event.type for event in events]
    assert _speech_text(events) == "Repaired."
    assistant = _assistant(chats)
    assert assistant.data["structured"]["speech"] == "Repaired."
    assert assistant.data["structured_recovery"] == "repaired"
    # Both requests are billed; only the repair stays in the next turn's context.
    assert assistant.usage.total_tokens == 12
    assert assistant.data["model_client"]["raw_provider_metadata"]["context_tokens"] == 7


@pytest.mark.asyncio
async def test_direct_turn_falls_back_to_plain_text_after_a_failed_repair() -> None:
    model_client = _ScriptedModelClient([_final("Just talking."), _final("Still just talking.")])
    executor, chats = _executor(client=model_client)

    # Other tests may stop "anima" propagation, so collect at the executor's logger itself.
    handler = _RecordingHandler()
    records = handler.records
    executor_logger = logging.getLogger("anima.app.chat.direct_executor")
    # Logging configuration in other tests can disable existing loggers or raise their level.
    previous_state = (executor_logger.disabled, executor_logger.level)
    executor_logger.disabled = False
    executor_logger.setLevel(logging.WARNING)
    executor_logger.addHandler(handler)
    try:
        events = await _collect(executor.stream_turn(_request()))
    finally:
        executor_logger.removeHandler(handler)
        executor_logger.disabled, level = previous_state
        executor_logger.setLevel(level)

    assert len(model_client.seen_specs) == 2
    types = [event.type for event in events]
    assert EventType.ERROR not in types
    assert EventType.AVATAR_GESTURE_REQUESTED not in types
    tone_events = [
        event
        for event in events
        if event.type == EventType.USER_RESPONSE
        and event.payload.response_part == MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE
    ]
    assert [event.payload.value for event in tone_events] == ["neutral"]
    speech_events = [
        event
        for event in events
        if event.type == EventType.USER_RESPONSE and event.payload.response_part == MAIN_STRUCTURED_RESPONSE_PART_SPEECH
    ]
    # A structured speech part is what both TTS paths speak.
    assert [event.payload.value for event in speech_events] == ["Still just talking."]
    assert speech_events[0].payload.response_format == MAIN_STRUCTURED_RESPONSE_FORMAT
    emotion = next(event for event in events if event.type == EventType.EMOTION_UPDATE)
    assert emotion.payload.emotional_tone == "neutral"

    assistant = _assistant(chats)
    assert assistant.data["structured_recovery"] == "plain_text"
    assert assistant.data["structured"]["speech"] == "Still just talking."
    assert assistant.data["structured"]["gesture"] == ""
    # Replay carries a valid structured reply so history does not teach plain text.
    replayed = json.loads(assistant.raw_provider_message["content"])
    assert replayed["speech"] == "Still just talking."
    assert replayed["emotional_tone"] == "neutral"

    recovered = [record for record in records if record.getMessage() == "Direct chat structured reply recovered"]
    assert len(recovered) == 1
    assert recovered[0].levelno == logging.WARNING
    assert "just talking" not in json.dumps({key: str(value) for key, value in recovered[0].__dict__.items()})


@pytest.mark.asyncio
async def test_direct_turn_falls_back_to_the_original_text_when_the_repair_request_fails() -> None:
    model_client = _ScriptedModelClient([_final("Plain words."), ModelClientError("boom", code="provider_failed")])
    executor, chats = _executor(client=model_client)

    events = await _collect(executor.stream_turn(_request()))

    assert EventType.ERROR not in [event.type for event in events]
    assert _speech_text(events) == "Plain words."
    assert _assistant(chats).data["structured_recovery"] == "plain_text"


@pytest.mark.asyncio
async def test_direct_turn_salvages_a_reply_whose_speech_already_streamed() -> None:
    truncated = '{"emotional_tone":"joy","emotional_intensity":3,"gesture":null,"speech":"Hello friend."'
    model_client = _ChunkedModelClient(chunks=[truncated], final_text=truncated)
    executor, chats = _executor(client=model_client)

    events = await _collect(executor.stream_turn(_request()))

    assert len(model_client.seen_specs) == 1
    assert EventType.ERROR not in [event.type for event in events]
    assert _speech_text(events) == "Hello friend."
    assistant = _assistant(chats)
    assert assistant.data["structured_recovery"] == "salvaged"
    assert assistant.data["structured"]["emotional_tone"] == "joy"
    assert assistant.data["structured"]["speech"] == "Hello friend."


@pytest.mark.asyncio
async def test_direct_turn_asks_models_without_structured_output_for_json_by_prompt() -> None:
    model_client = _ScriptedModelClient([_final(_structured_response(speech="Prompted JSON."))])
    provider = _provider(structured_output_transport=None, structured_kinds=[])
    executor, chats = _executor(client=model_client, provider=provider, memory_tool_service=_FakeMemoryToolService())

    events = await _collect(executor.stream_turn(_request()))

    spec = model_client.seen_specs[0]
    assert spec.prompt.response_format is None
    system_text = " ".join(
        str(message.get("content")) for message in prompt_messages(spec.prompt) if message.get("role") == "system"
    )
    assert "Return ONLY one valid json object" in system_text
    assert _speech_text(events) == "Prompted JSON."
    assert "structured_recovery" not in _assistant(chats).data


@pytest.mark.asyncio
async def test_direct_turn_blank_text_after_repair_still_fails_without_persistence() -> None:
    model_client = _ScriptedModelClient([_final(""), _final("   ")])
    executor, chats = _executor(client=model_client)

    events = await _collect(executor.stream_turn(_request()))

    assert [event.type for event in events] == [EventType.ERROR]
    assert events[0].payload.code == "main_structured_response_parse_failed"
    assert chats.record_turn_calls == []


@pytest.mark.asyncio
async def test_direct_turn_keeps_tool_exchanges_when_the_reply_falls_back() -> None:
    tool_final = ModelClientFinal(
        text="",
        usage=Usage(requests=1, input_tokens=10, output_tokens=1, total_tokens=11),
        tool_calls=(
            ModelClientToolCall(
                id="call-1",
                name="memory_write_file",
                arguments=json.dumps({"path": "notes.md", "content": "Likes tea."}),
            ),
        ),
    )
    model_client = _ScriptedModelClient([tool_final, _final("No JSON here."), _final("Nor here.")])
    tools = _FakeMemoryToolService()
    executor, chats = _executor(client=model_client, memory_tool_service=tools)

    await _collect(executor.stream_turn(_request()))

    assert len(tools.calls) == 1
    rows = chats.record_turn_calls[0]["assistant_msg"]
    assert [row.internal for row in rows[:-1]] == [True, True]
    assert rows[-1].data["structured_recovery"] == "plain_text"


@pytest.mark.asyncio
async def test_direct_turn_repair_on_responses_keeps_the_round_continuation() -> None:
    provider = _provider(provider_type="OpenAIResponsesHTTPAgent")
    model_client = _ScriptedModelClient(
        [_final("Not JSON.", response_id="resp-invalid"), _final(_structured_response(speech="Fixed."))]
    )
    executor, _chats = _executor(client=model_client, provider=provider)

    events = await _collect(executor.stream_turn(_request()))

    first, repair = model_client.seen_specs
    assert repair.continuation == first.continuation
    # Responses repeats the round from its own cursor; the invalid reply is not resent, only the instruction.
    assert {"role": "assistant", "content": "Not JSON."} not in prompt_messages(repair.prompt)
    assert prompt_messages(repair.prompt)[-1]["role"] == "developer"
    assert _speech_text(events) == "Fixed."


@pytest.mark.asyncio
async def test_direct_turn_keeps_the_original_text_when_the_repair_is_blank() -> None:
    model_client = _ScriptedModelClient([_final("A perfectly speakable plain reply."), _final("")])
    executor, chats = _executor(client=model_client)

    events = await _collect(executor.stream_turn(_request()))

    assert EventType.ERROR not in [event.type for event in events]
    assert _speech_text(events) == "A perfectly speakable plain reply."
    assert _assistant(chats).data["structured_recovery"] == "plain_text"


@pytest.mark.asyncio
@pytest.mark.parametrize("fold_by", ["capability", "connection"])
async def test_direct_turn_repair_on_folded_rows_does_not_end_on_the_invalid_reply(fold_by: str) -> None:
    # Local presets fold developer messages into the system message; a trailing
    # assistant message would be continued as a prefill instead of answered.
    if fold_by == "capability":
        provider = _provider(supports_developer_role=False)
    else:
        provider = replace(
            _provider(),
            connection=ModelConnection(
                id="c_local",
                name="Home Ollama",
                preset="ollama",
                base_url="http://127.0.0.1:11434/v1",
                compatibility=ModelConnectionCompatibility(fold_developer_role=True),
            ),
        )
    assert not provider.accepts_developer_role
    model_client = _ScriptedModelClient([_final("Plain."), _final(_structured_response(speech="Fixed."))])
    executor, _chats = _executor(client=model_client, provider=provider)

    events = await _collect(executor.stream_turn(_request()))

    repair = model_client.seen_specs[1]
    messages = prompt_messages(repair.prompt)
    assert {"role": "assistant", "content": "Plain."} not in messages
    assert messages[-1]["role"] != "assistant"
    assert _speech_text(events) == "Fixed."


@pytest.mark.asyncio
async def test_direct_turn_repairs_the_structured_round_of_a_split_turn() -> None:
    tool_final = ModelClientFinal(
        text="",
        usage=Usage(requests=1, input_tokens=10, output_tokens=1, total_tokens=11),
        tool_calls=(
            ModelClientToolCall(id="call-1", name="memory_read_files", arguments=json.dumps({"paths": "profile.md"})),
        ),
    )
    model_client = _ScriptedModelClient(
        [
            tool_final,
            _final("unconstrained draft"),
            _final("structured round, not JSON"),
            _final(_structured_response(speech="Repaired after tools.")),
        ]
    )
    provider = _provider()
    provider.capabilities.tools_with_structured_output = False
    executor, chats = _executor(client=model_client, provider=provider, memory_tool_service=_FakeMemoryToolService())

    events = await _collect(executor.stream_turn(_request()))

    structured, repair = model_client.seen_specs[2:]
    assert repair.prompt.tools == ()
    assert repair.prompt.response_format == structured.prompt.response_format
    assert _speech_text(events) == "Repaired after tools."
    assert chats.record_turn_calls[0]["assistant_msg"][-1].data["structured_recovery"] == "repaired"
