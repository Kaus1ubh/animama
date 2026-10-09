"""Opt-in live smoke of direct chat turns through the real Anthropic adapter.

Runs ``DirectChatTurnExecutor`` with ``AnthropicMessagesModelClient`` against
Claude Haiku 5.5: one structured turn, one memory-tool round, and a next turn
replayed from the stored rows (as after a restart). Memory tools, chat storage
and memory context are the offline test fakes, so nothing is persisted.

Paid requests: run only with ``ANIMAMA_RUN_LIVE_TESTS=1`` and a real
``ANTHROPIC_API_KEY``. Run with ``-s`` to see the measurements; no request or
response content is printed.
"""

from __future__ import annotations

import json
import os
from typing import Any

import pytest

import tests.test_direct_chat_turn_executor as executor_helpers
from animama.adapters.model_clients import AnthropicMessagesModelClient
from animama.app.main_structured_response import build_main_structured_response_model
from animama.app.model_clients.credentials import static_credential_resolver
from animama.domain.events import EventType
from tests.test_anthropic_direct_chat import _anthropic_provider, _assistant_rows, _executor


def _api_key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "").strip()


pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(
        os.getenv("ANIMAMA_RUN_LIVE_TESTS") != "1" or _api_key() in {"", "test-key"},
        reason="requires ANIMAMA_RUN_LIVE_TESTS=1 and ANTHROPIC_API_KEY",
    ),
]


class _RecordingAdapter(AnthropicMessagesModelClient):
    """The real adapter, keeping per-request facts (never content) for the record."""

    def __init__(self) -> None:
        super().__init__(
            credential_resolver=static_credential_resolver({"ANTHROPIC_API_KEY": _api_key()}),
            timeout=120.0,
        )
        self.requests: list[dict[str, Any]] = []

    async def stream(self, spec):  # noqa: ANN001, ANN201
        text_deltas = 0
        async for delta in super().stream(spec):
            if delta.kind == "text_delta":
                text_deltas += 1
            if delta.kind == "final" and delta.final is not None:
                anthropic = dict(delta.final.raw_provider_metadata.get("anthropic") or {})
                self.requests.append(
                    {
                        "stop_reason": anthropic.get("stop_reason"),
                        "block_types": list(anthropic.get("block_types") or ()),
                        "text_deltas": text_deltas,
                        "input_tokens": delta.final.usage.input_tokens,
                        "cached_input_tokens": delta.final.usage.input_tokens_details.cached_tokens,
                        "output_tokens": delta.final.usage.output_tokens,
                        "continuation": delta.final.continuation is not None,
                    }
                )
            yield delta


def _record(check: str, **values: Any) -> None:
    print(f"[anthropic-direct-turn] {check}: {json.dumps(values, sort_keys=True, default=str)}")


def _speech_deltas(events: list[Any]) -> int:
    return sum(
        1
        for event in events
        if event.type == EventType.USER_RESPONSE and event.payload.response_part == "speech" and event.payload.is_delta
    )


async def test_a_structured_turn_streams_speech_and_validates() -> None:
    adapter = _RecordingAdapter()
    executor, chats = _executor(adapter, provider=_anthropic_provider())
    try:
        events = await executor_helpers._collect(
            executor.stream_turn(executor_helpers._request(user_message="Hi! Tell me one calm thought about the sea."))
        )
    finally:
        await adapter.aclose()

    errors = [event.payload.code for event in events if event.type == EventType.ERROR]
    assert errors == []
    assert _speech_deltas(events) >= 1
    final_row = _assistant_rows(chats)[-1]
    output_type = build_main_structured_response_model(agent_id="direct_chat_model_client", gesture_ids=())
    output_type.model_validate(json.loads(final_row.content or ""))
    assert final_row.data is not None and final_row.data.get("structured_recovery") is None
    _record("structured_turn", speech_deltas=_speech_deltas(events), requests=adapter.requests)


async def test_a_memory_tool_round_then_a_replayed_next_turn() -> None:
    adapter = _RecordingAdapter()
    memory_tools = executor_helpers._FakeMemoryToolService(
        result={"ok": True, "files": [{"path": "PROFILE.md", "content": "- Favourite drink: jasmine tea."}]}
    )
    executor, chats = _executor(adapter, provider=_anthropic_provider(), memory_tools=memory_tools)
    try:
        events = await executor_helpers._collect(
            executor.stream_turn(
                executor_helpers._request(
                    user_message="What is my favourite drink? Read my PROFILE.md memory file to check.",
                    # The chat default (D22) is medium; stated here so the tool path is
                    # checked at the effort chosen for reliable memory-tool use.
                    request_options={"reasoning_effort": "medium"},
                )
            )
        )
        _record("memory_tool_round", requests=adapter.requests)
        assert [event.payload.code for event in events if event.type == EventType.ERROR] == []
        assert memory_tools.calls, "the model did not call a memory tool"
        rows = _assistant_rows(chats)
        assert [row.message_type for row in rows][-1] == "message"
        assert any(row.message_type == "tool_call" for row in rows)

        # A new process: the next turn rebuilds its prompt from the stored rows only.
        recorded = chats.record_turn_calls[0]
        history = [recorded["user_msg"], *recorded["assistant_msg"]]
        for row in history:
            row.turn = 1
        next_executor, next_chats = _executor(
            adapter,
            provider=_anthropic_provider(),
            chat_manager=executor_helpers._FakeChatManager(history=history),
            memory_tools=memory_tools,
        )
        next_events = await executor_helpers._collect(
            next_executor.stream_turn(executor_helpers._request(user_message="Thanks. Which file was that again?"))
        )
    finally:
        await adapter.aclose()

    assert [event.payload.code for event in next_events if event.type == EventType.ERROR] == []
    assert _assistant_rows(next_chats)[-1].message_type == "message"
    _record(
        "memory_tool_round_and_replay",
        tool_calls=[call["tool_name"] for call in memory_tools.calls],
        requests=adapter.requests,
    )
