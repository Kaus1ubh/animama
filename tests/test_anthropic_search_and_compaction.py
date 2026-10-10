"""Anthropic native web search and server-side compaction (anthropic-model-provider plan, Phase 6).

Adapter tests drive ``AnthropicMessagesModelClient`` with the fake SDK client;
turn tests run ``DirectChatTurnExecutor`` with the real adapter, so each test
sees the exact Messages requests a turn sends, the run statuses it emits and
the rows it persists. No key or network is used.
"""

from __future__ import annotations

import json
from dataclasses import asdict, replace
from types import SimpleNamespace
from typing import Any

import pytest

import tests.test_direct_chat_turn_executor as executor_helpers
from animama.adapters.model_clients.anthropic_messages.client import MAX_PAUSE_TURN_CONTINUATIONS
from animama.adapters.model_clients.anthropic_messages.final import AnthropicResponse, message_final_parts
from animama.adapters.model_clients.anthropic_messages.request import (
    WEB_SEARCH_SERVER_TOOL,
    compaction_trigger_tokens,
    messages_request_params,
)
from animama.app.model_clients import (
    ModelClientDelta,
    ModelClientProviderOptions,
    ModelClientRequest,
)
from animama.app.web_search import WebSearchToolService
from animama.domain import ModelProvider, ModelProviderPricing
from animama.domain.chat import ChatMessage, MessageRole
from animama.domain.events import EventType
from animama.domain.model_connection import MODEL_SOURCE_OWNER
from animama.domain.web_search import WebSearchResult
from tests.anthropic_fakes import (
    THINKING_SIGNATURE,
    FakeAnthropicClient,
    compaction_block,
    message_events,
    search_error_block,
    search_result_block,
    server_search_block,
    status_error,
    structured_reply,
    text_block,
    thinking_block,
    tool_use_block,
    web_citation,
)
from tests.test_anthropic_direct_chat import _anthropic, _anthropic_provider, _assistant_rows, _executor
from tests.test_anthropic_messages_client import _adapter, _collect, _final, _messages, _provider, _request

SEARCH_ON = {"native_tools": ["web_search"]}
SUMMARY = "The user and Annie planned a lighthouse garden."


def _searching(request: ModelClientRequest) -> ModelClientRequest:
    return replace(request, provider_options=ModelClientProviderOptions(native_tools=("web_search",)))


def _statuses(items: list[Any]) -> list[tuple[str, str]]:
    """Run statuses from adapter deltas or executor events, in order."""

    statuses: list[tuple[str, str]] = []
    for item in items:
        if isinstance(item, ModelClientDelta):
            if item.kind == "run_status" and item.run_status is not None:
                statuses.append((item.run_status.status, item.run_status.phase))
        elif item.type == EventType.RUN_STATUS:
            statuses.append((item.payload.status, item.payload.phase))
    return statuses


def _priced(provider: ModelProvider, threshold: int | None = 100_000) -> ModelProvider:
    return replace(provider, pricing=ModelProviderPricing(long_context_token_threshold=threshold))


class _Backend:
    """An application search backend that must never be called on Anthropic rows."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    async def search(self, query: str, *, count: int) -> list[WebSearchResult]:
        self.queries.append(query)
        return [WebSearchResult(title="App result", url="https://app.example", snippet="App snippet.")]


def _with_app_search(executor: Any) -> _Backend:
    backend = _Backend()
    executor._web_search_tool = WebSearchToolService(backend)
    return backend


def _tool_names(request: dict[str, Any]) -> list[str]:
    return [str(tool.get("name")) for tool in request.get("tools", ())]


# ------------------------------------------------------------- web search tool


def test_the_web_search_server_tool_is_offered_only_when_the_turn_asks_for_it() -> None:
    searching = messages_request_params(_searching(_request()))
    plain = messages_request_params(_request())

    assert searching["tools"][-1] == {
        "type": "web_search_20250305",
        "name": "web_search",
        "max_uses": 5,
        "allowed_callers": ["direct"],
    }
    assert searching["tools"][:-1] == plain["tools"]
    assert "web_search" not in _tool_names(plain)
    # Search alone, without memory tools, still offers the server tool.
    alone = messages_request_params(_searching(_request(tools=False)))
    assert alone["tools"] == [WEB_SEARCH_SERVER_TOOL] and alone["tool_choice"] == {"type": "auto"}


@pytest.mark.asyncio
async def test_a_turn_with_search_on_offers_only_the_server_tool_never_the_application_tool() -> None:
    adapter, fake = _anthropic([message_events(text_block(structured_reply()))])
    executor, _ = _executor(adapter)
    backend = _with_app_search(executor)

    await executor_helpers._collect(executor.stream_turn(executor_helpers._request(request_options=SEARCH_ON)))

    request = fake.requests[0]
    assert _tool_names(request).count("web_search") == 1
    assert request["tools"][-1] == WEB_SEARCH_SERVER_TOOL
    # Every other tool is a strict memory function tool.
    assert all(tool.get("strict") is True for tool in request["tools"][:-1])
    assert backend.queries == []


@pytest.mark.asyncio
@pytest.mark.parametrize("search_on", [True, False])
async def test_rows_without_native_search_and_turns_with_search_off_offer_no_search_tool(search_on: bool) -> None:
    provider = _anthropic_provider()
    if search_on:
        # An owner-added row whose model has no native web search.
        provider = replace(provider, source=MODEL_SOURCE_OWNER)
        provider.capabilities.native_tool_support = []
    adapter, fake = _anthropic([message_events(text_block(structured_reply()))])
    executor, chats = _executor(adapter, provider=provider)
    backend = _with_app_search(executor)

    events = await executor_helpers._collect(
        executor.stream_turn(executor_helpers._request(request_options=SEARCH_ON if search_on else {}))
    )

    assert "web_search" not in _tool_names(fake.requests[0])
    assert backend.queries == []
    assert EventType.ERROR not in [event.type for event in events]
    assert chats.record_turn_calls


# --------------------------------------------------------- searching the web


def _search_turn_script(*, error: bool = False) -> list[dict[str, Any]]:
    result = (
        search_error_block("srvtoolu_1", "max_uses_exceeded")
        if error
        else search_result_block(
            "srvtoolu_1", [("Tide tables", "https://tides.example"), ("Port news", "https://port.example")]
        )
    )
    return message_events(
        server_search_block("srvtoolu_1", "high tide today"),
        result,
        text_block(
            structured_reply("High tide is at noon."),
            citations=[] if error else [web_citation("https://tides.example", "Tide tables", "High tide 12:04.")],
        ),
    )


@pytest.mark.asyncio
async def test_a_search_turn_shows_searching_and_records_queries_sources_and_citations() -> None:
    adapter, fake = _anthropic([_search_turn_script()])
    executor, chats = _executor(adapter)

    events = await executor_helpers._collect(executor.stream_turn(executor_helpers._request(request_options=SEARCH_ON)))

    assert _statuses(events) == [("searching_web", "started"), ("searching_web", "finished")]
    rows = _assistant_rows(chats)
    # Server searches are not tool rows; only the reply is stored.
    assert [row.message_type for row in rows] == ["message"]
    final_row = rows[-1]
    assert final_row.content == structured_reply("High tide is at noon.")
    assert final_row.raw_provider_message == {
        "role": "assistant",
        "content": [{"type": "text", "text": structured_reply("High tide is at noon.")}],
    }
    stored = final_row.data["anthropic"]  # type: ignore[index]
    assert stored["native_tool_summaries"] == [
        {
            "tool_type": "web_search",
            "tool_use_id": "srvtoolu_1",
            "query": "high tide today",
            "results": [
                {"title": "Tide tables", "url": "https://tides.example"},
                {"title": "Port news", "url": "https://port.example"},
            ],
        }
    ]
    assert stored["citations"] == [
        {"url": "https://tides.example", "title": "Tide tables", "cited_text": "High tide 12:04."}
    ]
    assert stored["usage"]["web_search_requests"] == 1
    persisted = json.dumps([asdict(row) for row in rows], default=str)
    assert "Encrypted-" not in persisted and "EncryptedIndex" not in persisted
    assert len(fake.requests) == 1


@pytest.mark.asyncio
async def test_a_search_error_result_keeps_the_turn_successful() -> None:
    adapter, _ = _anthropic([_search_turn_script(error=True)])
    executor, chats = _executor(adapter)

    events = await executor_helpers._collect(executor.stream_turn(executor_helpers._request(request_options=SEARCH_ON)))

    assert EventType.ERROR not in [event.type for event in events]
    assert _statuses(events) == [("searching_web", "started"), ("searching_web", "finished")]
    summary = _assistant_rows(chats)[-1].data["anthropic"]["native_tool_summaries"]  # type: ignore[index]
    assert summary == [
        {
            "tool_type": "web_search",
            "tool_use_id": "srvtoolu_1",
            "query": "high tide today",
            "error_code": "max_uses_exceeded",
        }
    ]


@pytest.mark.asyncio
async def test_a_paused_turn_is_resumed_by_resending_its_content_unchanged() -> None:
    paused = message_events(
        server_search_block("srvtoolu_1", "lighthouse history"),
        search_result_block("srvtoolu_1", [("History", "https://history.example")]),
        server_search_block("srvtoolu_2", "lighthouse keeper"),
        stop_reason="pause_turn",
        message_id="msg_paused",
    )
    resumed = message_events(
        search_result_block("srvtoolu_2", [("Keepers", "https://keepers.example")]),
        text_block(structured_reply("It was built in 1890.")),
        message_id="msg_resumed",
    )
    client = FakeAnthropicClient([paused, resumed])
    adapter, _ = _adapter(client)
    request = _searching(_request())

    deltas = await _collect(adapter.stream(request))

    first, second = client.requests
    paused_content = [
        {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {"query": "lighthouse history"}},
        {
            "type": "web_search_tool_result",
            "tool_use_id": "srvtoolu_1",
            "content": [
                {
                    "type": "web_search_result",
                    "title": "History",
                    "url": "https://history.example",
                    "encrypted_content": "Encrypted-0==",
                    "page_age": "1 day ago",
                }
            ],
        },
        {"type": "server_tool_use", "id": "srvtoolu_2", "name": "web_search", "input": {"query": "lighthouse keeper"}},
    ]
    # The continuation is the same request plus the paused content, with no extra user message.
    assert second["messages"] == [*first["messages"], {"role": "assistant", "content": paused_content}]
    assert {key: value for key, value in second.items() if key != "messages"} == {
        key: value for key, value in first.items() if key != "messages"
    }
    final = _final(deltas)
    assert final.text == structured_reply("It was built in 1890.")
    assert final.usage.requests == 2
    stored = final.raw_provider_metadata["anthropic"]
    assert stored["pause_turn_continuations"] == 1
    assert [summary["query"] for summary in stored["native_tool_summaries"]] == [
        "lighthouse history",
        "lighthouse keeper",
    ]
    # The second search started before the pause and finished after it.
    assert _statuses(deltas) == [
        ("searching_web", "started"),
        ("searching_web", "finished"),
        ("searching_web", "started"),
        ("searching_web", "finished"),
    ]


@pytest.mark.asyncio
async def test_pause_turn_is_resumed_at_most_three_times() -> None:
    pauses = [
        message_events(
            server_search_block(f"srvtoolu_{index}", f"query {index}"),
            search_result_block(f"srvtoolu_{index}", [("Result", "https://result.example")]),
            stop_reason="pause_turn",
            message_id=f"msg_{index}",
        )
        for index in range(MAX_PAUSE_TURN_CONTINUATIONS + 2)
    ]
    client = FakeAnthropicClient(pauses)
    adapter, _ = _adapter(client)

    final = _final(await _collect(adapter.stream(_searching(_request()))))

    assert MAX_PAUSE_TURN_CONTINUATIONS == 3
    assert len(client.requests) == 4
    assert final.raw_provider_metadata["stop_reason"] == "pause_turn"
    assert final.raw_provider_metadata["anthropic"]["pause_turn_continuations"] == 3
    assert final.text == ""
    # Each resume resends the request plus every paused response's content, in
    # order, merged into one trailing assistant message.
    first, *resumes = client.requests
    for count, resumed in enumerate(resumes, start=1):
        assert resumed["messages"][: len(first["messages"])] == first["messages"]
        trailing = resumed["messages"][-1]
        assert trailing["role"] == "assistant"
        assert [block["id"] for block in trailing["content"] if block["type"] == "server_tool_use"] == [
            f"srvtoolu_{index}" for index in range(count)
        ]
    assert final.raw_provider_metadata["anthropic"]["web_search_requests"] == 4


@pytest.mark.asyncio
async def test_a_search_cut_off_by_a_failed_stream_still_finishes_its_status() -> None:
    overloaded = status_error(200, error_type="overloaded_error", message="Overloaded")
    started_then_failed = [*message_events(server_search_block("srvtoolu_1", "tides"))[:2], overloaded]
    adapter, _ = _anthropic([started_then_failed, list(started_then_failed)])
    executor, chats = _executor(adapter)

    events = await executor_helpers._collect(executor.stream_turn(executor_helpers._request(request_options=SEARCH_ON)))

    assert events[-1].type == EventType.ERROR
    statuses = _statuses(events)
    assert statuses.count(("searching_web", "started")) == statuses.count(("searching_web", "finished")) == 2
    assert statuses[-1] == ("searching_web", "finished")
    assert chats.record_turn_calls == []


@pytest.mark.asyncio
async def test_searches_from_every_round_of_a_turn_are_recorded_on_the_reply() -> None:
    adapter, fake = _anthropic(
        [
            message_events(
                server_search_block("srvtoolu_1", "tides"),
                search_result_block("srvtoolu_1", [("Tides", "https://tides.example")]),
                thinking_block("check memory"),
                tool_use_block("toolu_1", "memory_read_files", {"paths": ["PROFILE.md"]}),
                stop_reason="tool_use",
            ),
            message_events(text_block(structured_reply("Noon, as you like it."))),
        ]
    )
    executor, chats = _executor(adapter)

    await executor_helpers._collect(executor.stream_turn(executor_helpers._request(request_options=SEARCH_ON)))

    # The tool round resends the search blocks exactly as returned.
    resent = fake.requests[1]["messages"][-2]
    assert [block["type"] for block in resent["content"]] == [
        "server_tool_use",
        "web_search_tool_result",
        "thinking",
        "tool_use",
    ]
    assert resent["content"][1]["content"][0]["encrypted_content"] == "Encrypted-0=="
    rows = _assistant_rows(chats)
    assert [row.message_type for row in rows] == ["tool_call", "tool_result", "message"]
    stored = rows[-1].data["anthropic"]  # type: ignore[index]
    assert [summary["query"] for summary in stored["native_tool_summaries"]] == ["tides"]
    assert stored["web_search_requests"] == 1
    # Raw search blocks are never stored, so later turns never replay them (D8).
    assert "Encrypted-" not in json.dumps([asdict(row) for row in rows], default=str)


# --------------------------------------------------------------- compaction


@pytest.mark.parametrize(
    ("provider", "expected"),
    [
        (_priced(_provider()), 90_000),  # Haiku 5.5 with Compact early on (the default)
        (replace(_priced(_provider()), early_compaction=False), 150_000),
        (_provider(), 150_000),  # an unpriced owner row
        (_priced(_provider(), threshold=40_000), 50_000),  # never below Anthropic's minimum
        (_priced(_provider(), threshold=1_000_000), 900_000),
    ],
)
def test_requests_compact_on_the_server_at_the_rows_trigger(provider: ModelProvider, expected: int) -> None:
    params = messages_request_params(_request(provider=provider))

    assert compaction_trigger_tokens(provider) == expected
    assert params["betas"] == ["compact-2026-01-12"]
    assert params["context_management"] == {
        "edits": [
            {
                "type": "compact_20260112",
                "trigger": {"type": "input_tokens", "value": expected},
                "pause_after_compaction": False,
            }
        ]
    }


def _compacting_turn_script() -> list[dict[str, Any]]:
    return message_events(
        compaction_block(SUMMARY),
        thinking_block("after the summary"),
        text_block(structured_reply("Let's plant tomatoes.")),
        iterations=[
            {
                "type": "compaction",
                "input_tokens": 91_000,
                "output_tokens": 800,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
            {
                "type": "message",
                "input_tokens": 1_500,
                "output_tokens": 60,
                "cache_read_input_tokens": 3_000,
                "cache_creation_input_tokens": 500,
            },
        ],
        thinking_tokens=20,
    )


@pytest.mark.asyncio
async def test_a_compacting_turn_shows_summarizing_and_stores_the_block_before_the_reply() -> None:
    adapter, _ = _anthropic([_compacting_turn_script()])
    executor, chats = _executor(adapter)

    events = await executor_helpers._collect(executor.stream_turn(executor_helpers._request()))

    assert _statuses(events) == [("summarizing_context", "started"), ("summarizing_context", "finished")]
    final_row = _assistant_rows(chats)[-1]
    assert final_row.raw_provider_message == {
        "role": "assistant",
        "content": [
            {"type": "compaction", "content": SUMMARY},
            {"type": "text", "text": structured_reply("Let's plant tomatoes.")},
        ],
    }
    assert "after the summary" not in json.dumps(asdict(final_row), default=str)
    # Billing includes the compaction step; the chat's context is the last iteration only.
    assert final_row.usage is not None
    assert final_row.usage.input_tokens == 91_000 + 1_500 + 3_000 + 500
    assert final_row.usage.output_tokens == 860
    raw = final_row.data["model_client"]["raw_provider_metadata"]  # type: ignore[index]
    assert raw["context_tokens"] == 1_500 + 3_000 + 500 + 60 - 20
    stored = final_row.data["anthropic"]  # type: ignore[index]
    assert [entry["type"] for entry in stored["usage"]["iterations"]] == ["compaction", "message"]


@pytest.mark.asyncio
async def test_a_compaction_inside_a_tool_round_travels_in_the_turn_and_is_stored() -> None:
    adapter, fake = _anthropic(
        [
            message_events(
                compaction_block(SUMMARY),
                thinking_block("check"),
                tool_use_block("toolu_1", "memory_list_files", {}),
                stop_reason="tool_use",
            ),
            message_events(text_block(structured_reply("Found your notes."))),
        ]
    )
    executor, chats = _executor(adapter)

    events = await executor_helpers._collect(executor.stream_turn(executor_helpers._request()))

    assert _statuses(events) == [("summarizing_context", "started"), ("summarizing_context", "finished")]
    resent = fake.requests[1]["messages"][-2]
    assert resent["role"] == "assistant"
    assert resent["content"][0] == {"type": "compaction", "content": SUMMARY}
    assert resent["content"][1]["signature"] == THINKING_SIGNATURE
    final_row = _assistant_rows(chats)[-1]
    assert final_row.raw_provider_message["content"][0] == {  # type: ignore[index]
        "type": "compaction",
        "content": SUMMARY,
    }


def _compacted_history(extra_turns: int = 0) -> list[ChatMessage]:
    """Stored rows from the compacting turn on, as the chat manager replays them."""

    reply = structured_reply("Let's plant tomatoes.")
    rows = [
        executor_helpers._history_message(
            reply,
            turn=10,
            raw_provider_message={
                "role": "assistant",
                "content": [{"type": "compaction", "content": SUMMARY}, {"type": "text", "text": reply}],
            },
        )
    ]
    for index in range(extra_turns):
        turn = 11 + 2 * index
        rows.append(executor_helpers._history_message(f"Question {index}", role=MessageRole.USER, turn=turn))
        rows.append(
            executor_helpers._history_message(
                structured_reply(f"Answer {index}."),
                turn=turn + 1,
                raw_provider_message={
                    "role": "assistant",
                    "content": [{"type": "text", "text": structured_reply(f"Answer {index}.")}],
                },
            )
        )
    return rows


@pytest.mark.asyncio
async def test_the_next_turn_replays_from_the_compaction_block_with_a_cache_breakpoint() -> None:
    adapter, fake = _anthropic([message_events(text_block(structured_reply("Basil too.")))])
    chats = executor_helpers._FakeChatManager(history=_compacted_history(extra_turns=1))
    executor, _ = _executor(adapter, chat_manager=chats)

    await executor_helpers._collect(executor.stream_turn(executor_helpers._request(user_message="And herbs?")))

    assert chats.context_calls == [{"chat_id": "chat-1", "native_compaction": True}]
    messages = fake.requests[0]["messages"]
    assert [message["role"] for message in messages] == ["assistant", "user", "assistant", "user", "system"]
    assert messages[0]["content"][0] == {
        "type": "compaction",
        "content": SUMMARY,
        "cache_control": {"type": "ephemeral"},
    }
    assert messages[2]["content"][-1]["cache_control"] == {"type": "ephemeral"}
    breakpoints = json.dumps(fake.requests[0]).count('"cache_control"')
    assert breakpoints == 3  # system, compaction block, last history block (of 4 allowed)


@pytest.mark.asyncio
async def test_anthropic_chats_never_use_application_compaction_or_window_fitting() -> None:
    provider = replace(_anthropic_provider(), context_window_tokens=4_000, max_output_tokens=500)
    long_history = [
        executor_helpers._history_message(
            f"message {index} " + "words " * 200,
            role=MessageRole.USER if index % 2 == 0 else MessageRole.ASSISTANT,
            turn=index + 1,
        )
        for index in range(30)
    ]
    compactor_calls: list[Any] = []

    async def compactor(request: Any) -> Any:
        compactor_calls.append(request)
        return None

    adapter, fake = _anthropic([message_events(text_block(structured_reply()))])
    executor, _ = _executor(
        adapter, provider=provider, chat_manager=executor_helpers._FakeChatManager(history=long_history)
    )
    executor._pre_send_compactor = compactor

    events = await executor_helpers._collect(executor.stream_turn(executor_helpers._request()))

    assert compactor_calls == []
    assert _statuses(events) == []
    # Nothing is trimmed: the server compacts past the trigger.
    sent = json.dumps(fake.requests[0]["messages"])
    assert "message 0 " in sent and "message 29 " in sent


@pytest.mark.asyncio
async def test_post_response_compaction_skips_anthropic_and_still_runs_for_chat_completions(monkeypatch) -> None:
    from animama.app.chat.options import DirectChatOptions
    from animama.server.routers.chat import compaction as chat_compaction

    calls: list[dict[str, Any]] = []

    class _Service:
        async def maybe_compact_chat(self, **kwargs: Any) -> Any:
            calls.append(kwargs)
            return type(
                "Result",
                (),
                {
                    "compacted": False,
                    "reason": "below_threshold",
                    "compaction": None,
                    "trigger_active_context_tokens": 0,
                },
            )()

    class _Session:
        async def close(self) -> None:
            return None

    monkeypatch.setattr(chat_compaction, "chat_compaction_service", lambda *_args: _Service())
    for provider in (_anthropic_provider(), executor_helpers._provider()):
        await chat_compaction.compact_chat_after_success(
            session_factory=_Session,
            model_client_registry=object(),  # type: ignore[arg-type]
            chat_id="chat-1",
            user_id="user-1",
            anima_id="anima-1",
            run_id="run-1",
            chat_options=DirectChatOptions(),
            model_roles=object(),  # type: ignore[arg-type]
            model_provider=provider,
        )

    assert len(calls) == 1  # only the Chat Completions row


def test_history_without_a_compaction_block_still_starts_at_a_user_turn() -> None:
    history: list[dict[str, Any]] = [
        {"role": "assistant", "content": [{"type": "text", "text": structured_reply("Earlier.")}]},
        {"role": "user", "content": "Next"},
        {"role": "assistant", "content": [{"type": "text", "text": structured_reply("Answer.")}]},
    ]
    params = messages_request_params(_request(messages=_messages(history=history)))

    assert params["messages"][0]["role"] == "user"
    assert '"compaction"' not in json.dumps(params["messages"])


def test_an_earlier_rounds_compaction_block_is_the_replay_prefix_of_a_later_round() -> None:
    # Round 2 has no compaction of its own; the reply still carries round 1's block.
    earlier_rounds: list[list[dict[str, Any]]] = [
        [{"type": "compaction", "content": SUMMARY}, {"type": "tool_use", "id": "t", "name": "n", "input": {}}]
    ]
    message = SimpleNamespace(content=[], stop_reason="end_turn", usage=None, id="msg", model="m", stop_details=None)

    parts = message_final_parts([AnthropicResponse(message=message)], earlier_rounds=earlier_rounds)

    assert parts.replay_prefix == ({"type": "compaction", "content": SUMMARY},)
