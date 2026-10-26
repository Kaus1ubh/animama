"""The model benchmark's episodic-memory arms in chat (app/chat/memory_arm.py, issue #470 spec R6).

Each arm must offer exactly its channels, and without an arm chat's prompts,
reply schema and tools must stay as they are.
"""

from __future__ import annotations

import inspect
import json
from collections.abc import AsyncIterator
from dataclasses import fields
from typing import Any

import pytest

from animama.adapters.mappers.model_provider_map import model_provider_registry_row_to_domain
from animama.app.chat import DirectChatMemoryContext, DirectChatTurnExecutor, DirectChatTurnRequest
from animama.app.chat.direct_turn.response_format import main_structured_response_guidance
from animama.app.chat.memory_arm import DEFAULT_EPISODIC_MEMORY_ARM, EpisodicMemoryArm
from animama.app.chat.memory_context import (
    ANIMA_MEMORIES_WRITE_GUIDANCE,
    MAIN_STRUCTURED_OUTPUT_GUIDANCE,
    MEMORY_CONTEXT_METADATA_VERSION,
    MEMORY_SYSTEM_GUIDANCE,
)
from animama.app.chat.memory_tools import memory_tool_specs
from animama.app.chat.options import DirectChatOptions, merge_chat_request_options
from animama.app.main_structured_response import (
    build_main_structured_prompt,
    build_main_structured_response_json_schema,
    build_main_structured_response_model,
    parse_main_structured_response,
    recover_main_structured_response,
    render_main_structured_json,
)
from animama.app.model_catalog import serialize_model_provider_catalog
from animama.app.model_clients import ModelClientDelta, ModelClientRequest, StaticModelClientRegistry
from animama.domain import ModelProvider
from animama.domain.chat import Chat, ChatContext
from animama.product_http.chat import turn_setup

ROWS = (
    "OpenAIResponsesHTTPAgent:gpt-6-luna",
    "OpenAIHTTPAgent:gpt-6-luna",
    "AnthropicMessagesHTTPAgent:claude-haiku-5-5",
)
CANDIDATE = "Keep notable facts, events, decisions and plans in your MEMORIES.md too."
_WRITE_LINE = ANIMA_MEMORIES_WRITE_GUIDANCE.strip().splitlines()[0]


def _rows() -> dict[str, ModelProvider]:
    rows = [model_provider_registry_row_to_domain(row) for row in serialize_model_provider_catalog()]
    return {row.id: row for row in rows}


class _Unused:
    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        raise AssertionError("the turn is only prepared")
        yield  # pragma: no cover

    async def aclose(self) -> None:
        return None


class _Chats:
    async def ensure_owned_chat(self, *, anima_id: str, chat_id: str, user_id: str, **_: Any) -> Chat:
        return Chat(id=chat_id, anima_id=anima_id, user_id=user_id)

    async def get_chat_context(self, *, chat_id: str, native_compaction: bool = False) -> ChatContext:
        return ChatContext(messages=[])


class _Memory:
    async def build_context(self, *, anima_id: str, **_: Any) -> DirectChatMemoryContext:
        return DirectChatMemoryContext(
            anima_identity="Kai is a calm, curious companion.",
            anima_name="Kai",
            manifest={"version": MEMORY_CONTEXT_METADATA_VERSION, "anima_id": anima_id, "opened_files": []},
            memory_map="- PROFILE.md: The user's durable facts.",
            anima_memories="## Our story\n- We met on a rainy Tuesday.",
            anima_memories_version=3,
        )


class _Tools:
    def tool_specs(self, *, allow_reads: bool, allow_writes: bool, allow_uploaded_file_tools: bool = False) -> Any:
        return memory_tool_specs(
            allow_reads=allow_reads, allow_writes=allow_writes, allow_uploaded_file_tools=allow_uploaded_file_tools
        )


class _Profile:
    async def resolve_for_anima(self, anima_id: str) -> None:
        raise AssertionError("the request names its model")


class _Providers:
    def __init__(self, row: ModelProvider) -> None:
        self.row = row

    async def get(self, model_provider_id: str, *, for_update: bool = False) -> ModelProvider | None:
        return self.row if model_provider_id == self.row.id else None


async def _prepare(row_id: str, **executor_kwargs: Any) -> dict[str, Any]:
    """What chat would send for one memory-on turn: messages, tools, provider options and the reply schema."""

    row = _rows()[row_id]
    executor = DirectChatTurnExecutor(
        registry=StaticModelClientRegistry({row.provider_type: _Unused()}),
        profile_service=_Profile(),  # type: ignore[arg-type]
        model_providers=_Providers(row),  # type: ignore[arg-type]
        chat_manager=_Chats(),  # type: ignore[arg-type]
        memory_context_service=_Memory(),  # type: ignore[arg-type]
        memory_tool_service=_Tools(),
        **executor_kwargs,
    )
    prepared = await executor.prepare_turn(
        DirectChatTurnRequest(
            anima_id="anima-1",
            user_id="user-1",
            chat_id="chat-1",
            run_id="run-1",
            user_message="I just got back from Kyoto!",
            model_provider_id=row.id,
            request_options=DirectChatOptions(incognito=False),
            runtime_gesture_ids=("wave",),
        )
    )
    prompt = prepared.model_request.prompt
    return {
        "system": "\n".join(
            str(message["content"]) for message in prompt.messages if message["role"] in {"system", "developer"}
        ),
        "messages": json.dumps(prompt.messages, sort_keys=True, default=str),
        "tools": json.dumps(prompt.tools, sort_keys=True, default=str),
        "provider_options": repr(prepared.model_request.provider_options),
        "schema": build_main_structured_response_json_schema(prepared.output_type, gesture_ids=("wave",)),
        "guidance": main_structured_response_guidance(row, prepared.output_type),
        "json_mode_prompt": build_main_structured_prompt(prepared.output_type),
        "output_type": prepared.output_type,
    }


def _comparable(prepared: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in prepared.items() if key != "output_type"}


@pytest.mark.parametrize("row_id", ROWS)
async def test_the_default_arm_and_both_channels_keep_chats_own_turn(row_id: str) -> None:
    default = _comparable(await _prepare(row_id))

    assert _comparable(await _prepare(row_id, episodic_memory_arm=DEFAULT_EPISODIC_MEMORY_ARM)) == default
    assert _comparable(await _prepare(row_id, episodic_memory_arm=EpisodicMemoryArm())) == default
    assert "`remember`" in default["guidance"] and "remember" in default["schema"]["properties"]
    assert MEMORY_SYSTEM_GUIDANCE.strip() in default["system"]


@pytest.mark.parametrize("row_id", ROWS)
async def test_the_remember_only_arm_keeps_memories_md_read_only(row_id: str) -> None:
    default = await _prepare(row_id)
    arm = await _prepare(row_id, episodic_memory_arm=EpisodicMemoryArm(anima_memories_writes=False))

    assert _WRITE_LINE in default["system"] and _WRITE_LINE not in arm["system"]
    # Its MEMORIES.md stays in the instructions; the tools, schema and remember guidance are unchanged.
    assert "We met on a rainy Tuesday." in arm["system"]
    for key in ("tools", "provider_options", "schema", "guidance"):
        assert arm[key] == default[key], key


@pytest.mark.parametrize("row_id", ROWS)
async def test_the_memories_md_only_arm_has_no_remember_and_the_candidate_guidance(row_id: str) -> None:
    default = await _prepare(row_id)
    arm = await _prepare(
        row_id, episodic_memory_arm=EpisodicMemoryArm(remember=False, anima_memories_write_guidance=CANDIDATE)
    )

    assert "remember" not in arm["output_type"].model_fields
    assert "remember" not in arm["schema"]["properties"] and "remember" not in arm["schema"]["required"]
    for text in (arm["system"], arm["guidance"], arm["json_mode_prompt"]):
        assert "`remember`" not in text and '"remember"' not in text
    assert CANDIDATE in arm["system"] and _WRITE_LINE not in arm["system"]
    assert "You keep two kinds of memory" in arm["system"]
    assert arm["tools"] == default["tools"] and arm["provider_options"] == default["provider_options"]
    # The guidance is chat's own, less its `remember` bullet (Anthropic rows add their tools-first line).
    assert MAIN_STRUCTURED_OUTPUT_GUIDANCE.strip().rsplit("\n", 1)[0] in arm["guidance"]


def test_a_reply_without_remember_parses_strictly_only_in_the_memories_md_only_arm() -> None:
    chat_model = build_main_structured_response_model(agent_id="chat", gesture_ids=("wave",))
    arm_model = build_main_structured_response_model(agent_id="chat", gesture_ids=("wave",), remember=False)
    without = {"emotional_tone": "happy", "emotional_intensity": 4, "gesture": "wave", "speech": "Hi!", "display": None}
    with_note = {**without, "remember": "The user visited Kyoto."}

    assert parse_main_structured_response(json.dumps(without), arm_model).remember is None
    with pytest.raises(ValueError):
        parse_main_structured_response(json.dumps(without), chat_model)
    # A stray note in the arm is not schema-valid; chat's local recovery keeps the reply and drops the note.
    with pytest.raises(ValueError):
        parse_main_structured_response(json.dumps(with_note), arm_model)
    assert recover_main_structured_response(json.dumps(with_note), arm_model).remember is None
    assert parse_main_structured_response(json.dumps(with_note), chat_model).remember == "The user visited Kyoto."


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"remember": False, "anima_memories_writes": False}, "needs `remember` or MEMORIES.md writes"),
        ({"remember": False, "anima_memories_write_guidance": "  "}, "must not be empty"),
        ({"anima_memories_writes": False, "anima_memories_write_guidance": CANDIDATE}, "needs MEMORIES.md writes"),
    ],
)
def test_an_arm_that_would_do_nothing_is_rejected(kwargs: dict[str, Any], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        EpisodicMemoryArm(**kwargs)


def test_replayed_replies_follow_the_arms_fields() -> None:
    reply = recover_main_structured_response(
        json.dumps({"emotional_tone": "happy", "emotional_intensity": 4, "gesture": None, "speech": "Hi!"}),
        build_main_structured_response_model(agent_id="chat", remember=False),
    )

    assert "remember" not in json.loads(render_main_structured_json(reply, remember=False))
    assert json.loads(render_main_structured_json(reply))["remember"] is None


def test_no_request_option_or_production_wiring_reaches_the_arm() -> None:
    assert "episodic_memory_arm" not in {field.name for field in fields(DirectChatOptions)}
    merged = merge_chat_request_options(
        request_opts={"episodic_memory_arm": {"remember": False}}, user_prefs=None, anima_prefs=None
    )
    assert not hasattr(merged, "episodic_memory_arm")
    assert "episodic_memory_arm" not in inspect.getsource(turn_setup)
    assert inspect.signature(DirectChatTurnExecutor).parameters["episodic_memory_arm"].default is (
        DEFAULT_EPISODIC_MEMORY_ARM
    )
