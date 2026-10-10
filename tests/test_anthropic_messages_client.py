"""Anthropic Messages adapter: request shape, streaming, rounds, errors and usage (plan Phase 5).

Every test drives ``AnthropicMessagesModelClient`` with a duck-typed fake SDK
client (``tests/anthropic_fakes.py``) that streams scripted raw events; no key
or network is used.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Any

import anthropic
import pytest

from animama.adapters.model_clients import AnthropicMessagesModelClient
from animama.adapters.model_clients.anthropic_messages.request import (
    ANTHROPIC_MAX_TOKENS_PER_REQUEST,
    messages_request_params,
)
from animama.adapters.model_clients.anthropic_messages.schema import anthropic_strict_schema
from animama.app.chat.memory_tools import memory_tool_specs
from animama.app.model_clients import (
    ANTHROPIC_TOOL_RESULT_ITEM_TYPE,
    ANTHROPIC_TOOL_USE_ITEM_TYPE,
    DirectChatPrompt,
    ModelClientContinuation,
    ModelClientDelta,
    ModelClientError,
    ModelClientFinal,
    ModelClientRequest,
    ModelClientTimeoutError,
)
from animama.app.model_clients.credentials import builtin_anthropic_connection, static_credential_resolver
from animama.app.model_clients.error_categories import model_error_category
from animama.app.model_clients.limits import ModelCallLimits
from animama.app.model_clients.types import ModelClientProviderOptions
from animama.app.safety.prompts import COMPANION_GUARDRAILS
from animama.domain import ModelProvider, ModelProviderCapabilities
from tests.anthropic_fakes import (
    SENTINEL_KEY,
    THINKING_SIGNATURE,
    FakeAnthropicClient,
    FakeClientFactory,
    chunked,
    connection_error,
    message_events,
    status_error,
    structured_reply,
    text_block,
    thinking_block,
    tool_use_block,
)

ANTHROPIC = "AnthropicMessagesHTTPAgent"
GUARDRAILS = COMPANION_GUARDRAILS.strip()
SYSTEM_TEXT = f"# Core Instructions\n\nYou are Mira.\n\n{GUARDRAILS}"
CONTEXT_TEXT = f"# List of memory files\n\nfiles: []\n\n{GUARDRAILS}"
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "speech": {"type": "string"},
        "emotional_intensity": {"type": "integer", "minimum": 1, "maximum": 5},
        "gesture": {"type": ["string", "null"], "enum": ["wave", None]},
    },
    "required": ["speech", "emotional_intensity", "gesture"],
    "additionalProperties": False,
}
RESPONSE_FORMAT: dict[str, Any] = {
    "type": "json_schema",
    "json_schema": {"name": "direct_chat_main_response", "strict": True, "schema": RESPONSE_SCHEMA},
}


def _provider(
    *,
    efforts: list[str] | None = None,
    max_output_tokens: int | None = 128_000,
    connection_id: str = "anthropic",
) -> ModelProvider:
    return ModelProvider(
        id=f"{ANTHROPIC}:claude-haiku-5-5",
        provider_type=ANTHROPIC,
        model="claude-haiku-5-5",
        model_label="Claude Haiku 5.5",
        provider_label="Anthropic",
        connection_id=connection_id,
        connection=builtin_anthropic_connection() if connection_id == "anthropic" else None,
        max_output_tokens=max_output_tokens,
        capabilities=ModelProviderCapabilities(
            supports_tools=True,
            supports_streaming=True,
            supports_reasoning=True,
            structured_kinds=["main_structured_response"],
            structured_output_transport="json_schema",
            supported_reasoning_efforts=efforts if efforts is not None else ["none", "low", "medium", "high"],
        ),
    )


def _messages(
    *,
    history: list[dict[str, Any]] | None = None,
    user: str = "What did I plan for the garden?",
    extra: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], ...]:
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_TEXT}]
    messages += history or []
    messages += [{"role": "developer", "content": CONTEXT_TEXT}, {"role": "user", "content": user}]
    messages += extra or []
    return tuple(messages)


def _request(
    *,
    messages: tuple[dict[str, Any], ...] | None = None,
    tools: bool = True,
    effort: str | None = None,
    provider: ModelProvider | None = None,
    continuation: ModelClientContinuation | None = None,
    tool_choice: str | None = None,
) -> ModelClientRequest:
    specs = memory_tool_specs(allow_reads=True, allow_writes=True) if tools else ()
    return ModelClientRequest(
        model_provider=provider or _provider(),
        prompt=DirectChatPrompt(
            messages=messages or _messages(),
            response_format=RESPONSE_FORMAT,  # type: ignore[arg-type]
            tools=specs,  # type: ignore[arg-type]
            tool_choice=tool_choice or ("auto" if tools else None),  # type: ignore[arg-type]
            parallel_tool_calls=False if tools and tool_choice is None else None,
            reasoning_effort=effort,  # type: ignore[arg-type]
            prompt_cache_key="scoped-key",
            metadata={"run_id": "run-1"},
        ),
        continuation=continuation,
    )


def _adapter(
    client: FakeAnthropicClient, values: dict[str, str] | None = None
) -> tuple[AnthropicMessagesModelClient, FakeClientFactory]:
    factory = FakeClientFactory(client)
    adapter = AnthropicMessagesModelClient(
        credential_resolver=static_credential_resolver(
            {"ANTHROPIC_API_KEY": SENTINEL_KEY} if values is None else values
        ),
        timeout=30.0,
        client_factory=factory,
    )
    return adapter, factory


async def _collect(stream: AsyncIterator[ModelClientDelta]) -> list[ModelClientDelta]:
    return [delta async for delta in stream]


def _final(deltas: list[ModelClientDelta]) -> ModelClientFinal:
    finals = [delta.final for delta in deltas if delta.kind == "final" and delta.final is not None]
    assert len(finals) == 1
    return finals[0]


# ---------------------------------------------------------------- request shape


def test_request_places_stable_system_history_user_then_turn_context_with_breakpoints() -> None:
    history: list[dict[str, Any]] = [
        {"role": "user", "content": "Hi Mira"},
        {"role": "assistant", "content": [{"type": "text", "text": structured_reply("Hello!")}]},
    ]
    params = messages_request_params(_request(messages=_messages(history=history)))

    assert params["system"] == [{"type": "text", "text": SYSTEM_TEXT, "cache_control": {"type": "ephemeral"}}]
    assert params["system"][0]["text"].endswith(GUARDRAILS)
    assert [message["role"] for message in params["messages"]] == ["user", "assistant", "user", "system"]
    # The last history block carries the second breakpoint; nothing else does.
    assert params["messages"][1]["content"][-1]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in params["messages"][0]["content"][0]
    assert params["messages"][2] == {
        "role": "user",
        "content": [{"type": "text", "text": "What did I plan for the garden?"}],
    }
    # The turn context follows the user's words and ends with the guardrails; no tagged block.
    assert params["messages"][3] == {"role": "system", "content": CONTEXT_TEXT}
    assert params["messages"][-1]["content"].endswith(GUARDRAILS)
    assert "<turn_context" not in json.dumps(params)


def test_request_never_sends_sampling_parameters_or_a_prefill() -> None:
    params = messages_request_params(_request(effort="high"))

    for name in ("temperature", "top_p", "top_k", "stop_sequences", "metadata", "prompt_cache_key"):
        assert name not in params
    assert params["messages"][-1]["role"] != "assistant"
    assert "budget_tokens" not in json.dumps(params)


def test_tools_are_strict_with_converted_schemas_and_one_call_at_a_time() -> None:
    params = messages_request_params(_request())
    specs = memory_tool_specs(allow_reads=True, allow_writes=True)

    assert [tool["name"] for tool in params["tools"]] == [spec["function"]["name"] for spec in specs]
    for tool, spec in zip(params["tools"], specs, strict=True):
        assert tool["strict"] is True
        assert tool["description"] == spec["function"]["description"]
        assert tool["input_schema"] == anthropic_strict_schema(spec["function"]["parameters"])
        assert set(tool) == {"name", "description", "input_schema", "strict"}
    assert params["tool_choice"] == {"type": "auto", "disable_parallel_tool_use": True}
    # Keywords strict mode rejects are moved into descriptions, never sent as keys.
    assert '"maxItems":' not in json.dumps(params["tools"])


def test_structured_output_uses_the_strict_converted_schema() -> None:
    params = messages_request_params(_request(tools=False))

    assert params["output_config"]["format"] == {
        "type": "json_schema",
        "schema": anthropic_strict_schema(RESPONSE_SCHEMA),
    }
    assert "tools" not in params and "tool_choice" not in params


@pytest.mark.parametrize(
    ("effort", "efforts", "expected_effort", "expected_thinking"),
    [
        (None, None, "medium", None),  # D22: chat defaults to medium
        ("low", None, "low", None),  # an explicit setting wins over the default
        ("high", None, "high", None),
        ("none", None, None, {"type": "disabled"}),  # D6
        (None, ["low", "high"], None, None),  # no medium on the row: send no effort
        (None, [], None, None),
    ],
)
def test_effort_and_thinking_mapping(
    effort: str | None,
    efforts: list[str] | None,
    expected_effort: str | None,
    expected_thinking: dict[str, str] | None,
) -> None:
    params = messages_request_params(_request(effort=effort, provider=_provider(efforts=efforts)))

    assert params.get("output_config", {}).get("effort") == expected_effort
    assert params.get("thinking") == expected_thinking


@pytest.mark.parametrize(
    ("row_limit", "expected"), [(128_000, ANTHROPIC_MAX_TOKENS_PER_REQUEST), (8_192, 8_192), (None, 64_000)]
)
def test_max_tokens_is_the_row_limit_capped_per_request(row_limit: int | None, expected: int) -> None:
    params = messages_request_params(_request(provider=_provider(max_output_tokens=row_limit)))

    assert params["max_tokens"] == expected


def test_history_replay_merges_roles_maps_tool_exchanges_and_never_sends_thinking() -> None:
    history: list[dict[str, Any]] = [
        {"role": "user", "content": "Do you remember my dog?"},
        {"type": ANTHROPIC_TOOL_USE_ITEM_TYPE, "id": "toolu_1", "name": "memory_list_files", "input": {}},
        {"type": ANTHROPIC_TOOL_RESULT_ITEM_TYPE, "tool_use_id": "toolu_1", "content": '{"ok":true}'},
        {
            "role": "assistant",
            "content": [
                {"type": "thinking", "thinking": "", "signature": THINKING_SIGNATURE},
                {"type": "text", "text": structured_reply("Yes, Biscuit!")},
            ],
        },
        {"role": "user", "content": "Great."},
        {"role": "user", "content": "Tell me more."},
        {"role": "assistant", "content": structured_reply("Sure.")},
    ]
    params = messages_request_params(_request(messages=_messages(history=history)))
    messages = params["messages"]

    assert [message["role"] for message in messages] == [
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
        "system",
    ]
    assert messages[1]["content"] == [{"type": "tool_use", "id": "toolu_1", "name": "memory_list_files", "input": {}}]
    assert messages[2]["content"] == [{"type": "tool_result", "tool_use_id": "toolu_1", "content": '{"ok":true}'}]
    assert [block["type"] for block in messages[3]["content"]] == ["text"]
    assert messages[4]["content"] == [{"type": "text", "text": "Great."}, {"type": "text", "text": "Tell me more."}]
    assert "thinking" not in json.dumps(messages)
    assert sum(1 for message in messages if message["role"] == "system") == 1


def test_history_that_starts_inside_a_tool_exchange_is_trimmed_to_a_user_turn() -> None:
    history = [
        {"type": ANTHROPIC_TOOL_RESULT_ITEM_TYPE, "tool_use_id": "toolu_old", "content": "{}"},
        {"role": "assistant", "content": structured_reply("Earlier.")},
        {"role": "user", "content": "Next question"},
        {"role": "assistant", "content": structured_reply("Answer.")},
    ]
    params = messages_request_params(_request(messages=_messages(history=history)))

    assert params["messages"][0] == {"role": "user", "content": [{"type": "text", "text": "Next question"}]}
    assert "toolu_old" not in json.dumps(params)


# ------------------------------------------------------------------- streaming


@pytest.mark.asyncio
async def test_structured_speech_streams_incrementally_and_the_final_is_authoritative() -> None:
    reply = structured_reply("Your garden plan had tomatoes and basil.")
    client = FakeAnthropicClient([message_events(thinking_block("private"), text_block(*chunked(reply, 6)))])
    adapter, _ = _adapter(client)

    deltas = await _collect(adapter.stream(_request(tools=False)))

    texts = [delta.text for delta in deltas if delta.kind == "text_delta"]
    assert len(texts) == len(chunked(reply, 6)) > 3
    assert "".join(text or "" for text in texts) == reply
    # Thinking is never public text.
    assert all("private" not in (text or "") for text in texts)
    final = _final(deltas)
    assert final.text == reply
    assert final.tool_calls == ()
    assert final.continuation is None
    assert deltas.index(next(d for d in deltas if d.kind == "text_delta")) < deltas.index(
        next(d for d in deltas if d.kind == "final")
    )
    assert deltas[-1].kind == "done"


@pytest.mark.asyncio
async def test_usage_counts_cache_reads_and_writes_and_sums_iterations() -> None:
    client = FakeAnthropicClient(
        [
            message_events(text_block(structured_reply()), thinking_tokens=11),
            message_events(
                text_block(structured_reply()),
                iterations=[
                    {
                        "type": "compaction",
                        "input_tokens": 50_000,
                        "output_tokens": 900,
                        "cache_read_input_tokens": 0,
                        "cache_creation_input_tokens": 0,
                    },
                    {
                        "type": "message",
                        "input_tokens": 300,
                        "output_tokens": 40,
                        "cache_read_input_tokens": 1_000,
                        "cache_creation_input_tokens": 200,
                    },
                ],
            ),
        ]
    )
    adapter, _ = _adapter(client)

    plain = _final(await _collect(adapter.stream(_request(tools=False))))
    iterated = _final(await _collect(adapter.stream(_request(tools=False))))

    assert plain.usage.input_tokens == 40 + 900 + 60
    assert plain.usage.input_tokens_details.cached_tokens == 900
    assert plain.usage.input_tokens_details.cache_write_tokens == 60
    assert plain.usage.output_tokens == 25
    assert plain.usage.total_tokens == 1_025
    assert plain.usage.output_tokens_details.reasoning_tokens == 11
    assert plain.usage.requests == 1
    assert iterated.usage.input_tokens == 50_000 + 300 + 1_000 + 200
    assert iterated.usage.input_tokens_details.cached_tokens == 1_000
    assert iterated.usage.output_tokens == 940
    stored = iterated.raw_provider_metadata["anthropic"]["usage"]
    assert [entry["type"] for entry in stored["iterations"]] == ["compaction", "message"]
    metadata = plain.raw_provider_metadata["anthropic"]
    assert metadata["message_id"] == "msg_test_1"
    assert metadata["stop_reason"] == "end_turn"
    assert list(metadata["block_types"]) == ["text"]


# ----------------------------------------------------------------- tool rounds


@pytest.mark.asyncio
async def test_tool_round_resends_the_returned_content_byte_exact_with_the_tool_result() -> None:
    first = message_events(
        thinking_block("let me check"),
        text_block("Checking."),
        tool_use_block("toolu_1", "memory_list_files", {"path_prefix": "notes/"}),
        stop_reason="tool_use",
    )
    second = message_events(text_block(structured_reply("Found it.")), message_id="msg_test_2")
    client = FakeAnthropicClient([first, second])
    adapter, _ = _adapter(client)
    request = _request()

    round_one = _final(await _collect(adapter.stream(request)))
    assert [(call.id, call.name, json.loads(call.arguments)) for call in round_one.tool_calls] == [
        ("toolu_1", "memory_list_files", {"path_prefix": "notes/"})
    ]
    assert round_one.continuation is not None
    returned_content = [
        {"type": "thinking", "thinking": "let me check", "signature": THINKING_SIGNATURE},
        {"type": "text", "text": "Checking."},
        {"type": "tool_use", "id": "toolu_1", "name": "memory_list_files", "input": {"path_prefix": "notes/"}},
    ]
    assert json.loads(round_one.continuation.cursor) == [returned_content]

    follow_up = ModelClientRequest(
        model_provider=request.model_provider,
        prompt=DirectChatPrompt(
            messages=(
                *request.prompt.messages,
                {"type": ANTHROPIC_TOOL_USE_ITEM_TYPE, "id": "toolu_1", "name": "memory_list_files", "input": {}},
                {"type": ANTHROPIC_TOOL_RESULT_ITEM_TYPE, "tool_use_id": "toolu_1", "content": '{"ok":true}'},
            ),
            response_format=request.prompt.response_format,
            tools=request.prompt.tools,
            tool_choice=request.prompt.tool_choice,
            parallel_tool_calls=request.prompt.parallel_tool_calls,
        ),
        continuation=round_one.continuation,
    )
    round_two = _final(await _collect(adapter.stream(follow_up)))

    first_request, second_request = client.requests
    assert second_request["messages"][: len(first_request["messages"])] == first_request["messages"]
    assert second_request["messages"][-2:] == [
        {"role": "assistant", "content": returned_content},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_1", "content": '{"ok":true}'}]},
    ]
    assert [message["role"] for message in second_request["messages"]] == ["user", "system", "assistant", "user"]
    assert second_request["system"] == first_request["system"]
    assert second_request["tools"] == first_request["tools"]
    assert round_two.text == structured_reply("Found it.")
    assert round_two.continuation is None


@pytest.mark.asyncio
async def test_a_second_tool_round_extends_the_cursor_and_resends_both_rounds() -> None:
    client = FakeAnthropicClient(
        [
            message_events(
                thinking_block(), tool_use_block("toolu_1", "memory_list_files", {}), stop_reason="tool_use"
            ),
            message_events(
                thinking_block(signature="sig-two"),
                tool_use_block("toolu_2", "memory_read_files", {"paths": ["PROFILE.md"]}),
                stop_reason="tool_use",
            ),
        ]
    )
    adapter, _ = _adapter(client)
    request = _request()
    round_one = _final(await _collect(adapter.stream(request)))
    after_one = (
        {"type": ANTHROPIC_TOOL_USE_ITEM_TYPE, "id": "toolu_1", "name": "memory_list_files", "input": {}},
        {"type": ANTHROPIC_TOOL_RESULT_ITEM_TYPE, "tool_use_id": "toolu_1", "content": "{}"},
    )
    round_two = _final(
        await _collect(
            adapter.stream(
                ModelClientRequest(
                    model_provider=request.model_provider,
                    prompt=DirectChatPrompt(
                        messages=(*request.prompt.messages, *after_one), tools=request.prompt.tools
                    ),
                    continuation=round_one.continuation,
                )
            )
        )
    )

    assert round_two.continuation is not None
    rounds = json.loads(round_two.continuation.cursor)
    assert [[block["type"] for block in content] for content in rounds] == [
        ["thinking", "tool_use"],
        ["thinking", "tool_use"],
    ]
    assert rounds[1][0]["signature"] == "sig-two"


def test_forced_final_instruction_is_text_in_the_user_turn_after_the_tool_results() -> None:
    cursor = json.dumps(
        [[{"type": "thinking", "thinking": "", "signature": "s"}, tool_use_block("toolu_1", "memory_list_files", {})]]
    )
    instruction = f"Tool round limit reached. Answer now.\n\n{GUARDRAILS}"
    params = messages_request_params(
        _request(
            tool_choice="none",
            messages=_messages(
                extra=[
                    {"type": ANTHROPIC_TOOL_USE_ITEM_TYPE, "id": "toolu_1", "name": "memory_list_files", "input": {}},
                    {"type": ANTHROPIC_TOOL_RESULT_ITEM_TYPE, "tool_use_id": "toolu_1", "content": "{}"},
                    {"role": "developer", "content": instruction},
                ]
            ),
            continuation=ModelClientContinuation(provider_type=ANTHROPIC, cursor=cursor),
        )
    )

    assert params["tool_choice"] == {"type": "none"}
    assert params["tools"]  # kept, so the cache and the turn's thinking blocks stay valid
    last = params["messages"][-1]
    assert last["role"] == "user"
    assert [block["type"] for block in last["content"]] == ["tool_result", "text"]
    assert last["content"][-1]["text"] == instruction
    assert last["content"][-1]["text"].endswith(GUARDRAILS)
    assert [message["role"] for message in params["messages"]] == ["user", "system", "assistant", "user"]


def test_repair_instruction_follows_the_invalid_reply_in_a_user_turn() -> None:
    instruction = f"The last reply did not match the required response format.\n\n{GUARDRAILS}"
    params = messages_request_params(
        _request(
            tool_choice="none",
            messages=_messages(
                extra=[
                    {"role": "assistant", "content": "not json"},
                    {"role": "developer", "content": instruction},
                ]
            ),
        )
    )

    assert params["messages"][-2:] == [
        {"role": "assistant", "content": [{"type": "text", "text": "not json"}]},
        {"role": "user", "content": [{"type": "text", "text": instruction}]},
    ]


def test_an_instruction_with_no_reply_before_it_joins_the_turn_context_message() -> None:
    instruction = f"Produce the final answer.\n\n{GUARDRAILS}"
    params = messages_request_params(
        _request(tool_choice="none", messages=_messages(extra=[{"role": "developer", "content": instruction}]))
    )

    assert [message["role"] for message in params["messages"]] == ["user", "system"]
    assert params["messages"][-1]["content"] == f"{CONTEXT_TEXT}\n\n{instruction}"
    assert params["messages"][-1]["content"].endswith(GUARDRAILS)


@pytest.mark.asyncio
async def test_a_reply_cut_off_at_max_tokens_offers_no_tool_calls() -> None:
    client = FakeAnthropicClient(
        [
            message_events(
                text_block('{"speech":"Hel'),
                tool_use_block("toolu_1", "memory_list_files", {}),
                stop_reason="max_tokens",
            )
        ]
    )
    adapter, _ = _adapter(client)

    final = _final(await _collect(adapter.stream(_request())))

    assert final.tool_calls == ()
    assert final.continuation is None
    assert final.raw_provider_metadata["stop_reason"] == "max_tokens"


# -------------------------------------------------------------- refusal, errors


@pytest.mark.asyncio
async def test_refusal_raises_model_refused_after_partial_deltas() -> None:
    client = FakeAnthropicClient(
        [
            message_events(
                text_block('{"emotional_tone":"neutral","speech":"I'),
                stop_reason="refusal",
                stop_details={"type": "refusal", "category": "cyber", "explanation": "Declined."},
            )
        ]
    )
    adapter, _ = _adapter(client)
    seen: list[ModelClientDelta] = []

    with pytest.raises(ModelClientError) as caught:
        async for delta in adapter.stream(_request()):
            seen.append(delta)

    assert [delta.text for delta in seen if delta.kind == "text_delta"] == ['{"emotional_tone":"neutral","speech":"I']
    assert all(delta.kind != "final" for delta in seen)
    assert caught.value.code == "model_refused"
    assert caught.value.raw_metadata["stop_details_category"] == "cyber"
    assert "Declined." not in json.dumps(dict(caught.value.raw_metadata))
    assert model_error_category(caught.value.code, caught.value.raw_metadata) == "provider_error"


@pytest.mark.parametrize(
    ("error", "code", "category"),
    [
        (
            status_error(
                401, error_type="authentication_error", message="invalid x-api-key", cls=anthropic.AuthenticationError
            ),
            "anthropic_authentication_error",
            "credential_rejected",
        ),
        (
            status_error(403, error_type="permission_error", message="no access", cls=anthropic.PermissionDeniedError),
            "anthropic_permission_denied",
            "credential_rejected",
        ),
        (
            status_error(404, error_type="not_found_error", message="model: claude-x", cls=anthropic.NotFoundError),
            "anthropic_not_found",
            "model_not_found",
        ),
        (
            status_error(
                429,
                error_type="rate_limit_error",
                message="slow down",
                cls=anthropic.RateLimitError,
                headers={"retry-after": "30"},
            ),
            "anthropic_rate_limit",
            "rate_limited",
        ),
        (
            status_error(
                529,
                error_type="overloaded_error",
                message="Overloaded",
                cls=anthropic.OverloadedError,
                headers={"retry-after": "30"},
            ),
            "anthropic_overloaded",
            "server_error",
        ),
        (
            status_error(
                500,
                error_type="api_error",
                message="Internal",
                cls=anthropic.InternalServerError,
                headers={"retry-after": "30"},
            ),
            "anthropic_server_error",
            "server_error",
        ),
        (
            status_error(
                400,
                error_type="invalid_request_error",
                message="prompt is too long: 1000001 tokens > 1000000 maximum",
                cls=anthropic.BadRequestError,
            ),
            "anthropic_context_exceeded",
            "context_exceeded",
        ),
        (
            status_error(
                413,
                error_type="request_too_large",
                message="Request exceeds the maximum size",
                cls=anthropic.RequestTooLargeError,
            ),
            "anthropic_context_exceeded",
            "context_exceeded",
        ),
        (
            status_error(
                400,
                error_type="invalid_request_error",
                message="Your credit balance is too low to access the Anthropic API.",
                cls=anthropic.BadRequestError,
            ),
            "anthropic_quota_exceeded",
            "quota_exceeded",
        ),
        (
            status_error(
                400, error_type="invalid_request_error", message="messages: bad shape", cls=anthropic.BadRequestError
            ),
            "anthropic_bad_request",
            "bad_request",
        ),
        (connection_error(timeout=True), "anthropic_timeout", "timeout"),
        (connection_error(), "anthropic_connection_error", "unreachable"),
    ],
)
@pytest.mark.asyncio
async def test_sdk_errors_map_to_anthropic_codes_and_neutral_categories(
    error: BaseException, code: str, category: str
) -> None:
    # Each failure is scripted twice: transient ones are retried once.
    client = FakeAnthropicClient([error, error])
    adapter, _ = _adapter(client)

    with pytest.raises(ModelClientError) as caught:
        await _collect(adapter.stream(_request()))

    assert caught.value.code == code
    assert model_error_category(caught.value.code, caught.value.raw_metadata) == category
    assert isinstance(caught.value, ModelClientTimeoutError) == (code == "anthropic_timeout")
    assert SENTINEL_KEY not in json.dumps(dict(caught.value.raw_metadata), default=str)
    assert SENTINEL_KEY not in caught.value.message


@pytest.mark.asyncio
async def test_a_stream_error_event_is_classified_by_its_error_type() -> None:
    overloaded = status_error(200, error_type="overloaded_error", message="Overloaded")
    client = FakeAnthropicClient([[*message_events(text_block("{"))[:3], overloaded]])
    adapter, _ = _adapter(client)

    with pytest.raises(ModelClientError) as caught:
        await _collect(adapter.stream(_request()))

    assert caught.value.code == "anthropic_overloaded"
    assert len(client.requests) == 1  # text already streamed: no retry


@pytest.mark.asyncio
async def test_a_transient_failure_before_any_text_is_retried_once() -> None:
    client = FakeAnthropicClient(
        [
            status_error(529, error_type="overloaded_error", message="Overloaded", cls=anthropic.OverloadedError),
            message_events(text_block(structured_reply())),
        ]
    )
    adapter, _ = _adapter(client)

    final = _final(await _collect(adapter.stream(_request())))

    assert final.text == structured_reply()
    assert len(client.requests) == 2
    assert client.requests[0] == client.requests[1]


def test_composition_limits_cap_output_tokens_and_searches() -> None:
    request = replace(
        _request(),
        provider_options=ModelClientProviderOptions(native_tools=("web_search",)),
        limits=ModelCallLimits(max_output_tokens=77, timeout_seconds=3, max_native_tool_calls=2),
    )

    params = messages_request_params(request)

    assert params["max_tokens"] == 77
    [search] = [tool for tool in params["tools"] if tool.get("name") == "web_search"]
    assert search["max_uses"] == 2


@pytest.mark.asyncio
async def test_a_bounded_request_uses_its_timeout_and_is_never_retried() -> None:
    client = FakeAnthropicClient(
        [
            status_error(529, error_type="overloaded_error", message="Overloaded", cls=anthropic.OverloadedError),
            message_events(text_block(structured_reply())),
        ]
    )
    adapter, factory = _adapter(client)
    request = replace(_request(), limits=ModelCallLimits(max_output_tokens=100, timeout_seconds=3))

    with pytest.raises(ModelClientError):
        await _collect(adapter.stream(request))

    assert len(client.requests) == 1
    assert factory.calls[0]["timeout"] == 3


@pytest.mark.asyncio
async def test_error_messages_never_echo_the_key() -> None:
    error = status_error(
        401,
        error_type="authentication_error",
        message=f"invalid x-api-key {SENTINEL_KEY}",
        cls=anthropic.AuthenticationError,
    )
    client = FakeAnthropicClient([error])
    adapter, _ = _adapter(client)

    with pytest.raises(ModelClientError) as caught:
        await _collect(adapter.stream(_request()))

    assert SENTINEL_KEY not in json.dumps(dict(caught.value.raw_metadata), default=str)
    assert "[redacted]" in caught.value.raw_metadata["provider_error_message"]


@pytest.mark.asyncio
async def test_a_stream_that_ends_before_message_stop_is_an_error() -> None:
    client = FakeAnthropicClient([message_events(text_block(structured_reply()), include_stop=False)])
    adapter, _ = _adapter(client)

    with pytest.raises(ModelClientError) as caught:
        await _collect(adapter.stream(_request()))

    assert caught.value.code == "anthropic_stream_incomplete"


# ------------------------------------------------------------------ credentials


@pytest.mark.asyncio
async def test_missing_key_fails_naming_the_anthropic_connection_without_a_request() -> None:
    client = FakeAnthropicClient([])
    adapter, factory = _adapter(client, values={"OPENAI_API_KEY": "sk-openai-not-for-anthropic"})

    with pytest.raises(ModelClientError) as caught:
        await _collect(adapter.stream(_request()))

    assert caught.value.code == "missing_api_key"
    assert caught.value.message == "No key is configured for Anthropic"
    assert caught.value.raw_metadata["connection_name"] == "Anthropic"
    assert model_error_category(caught.value.code) == "credential_missing"
    assert factory.calls == [] and client.requests == []


@pytest.mark.asyncio
async def test_one_sdk_client_per_credential_built_with_only_the_anthropic_key() -> None:
    client = FakeAnthropicClient([message_events(text_block(structured_reply())) for _ in range(2)])
    adapter, factory = _adapter(client, values={"ANTHROPIC_API_KEY": SENTINEL_KEY, "OPENAI_API_KEY": "sk-openai-x"})

    await _collect(adapter.stream(_request()))
    await _collect(adapter.stream(_request()))
    await adapter.aclose()

    assert factory.calls == [{"api_key": SENTINEL_KEY, "timeout": 30.0}]
    assert client.close_calls == 1
    assert SENTINEL_KEY not in json.dumps(client.requests)


@pytest.mark.asyncio
async def test_rows_outside_the_builtin_anthropic_connection_are_refused() -> None:
    client = FakeAnthropicClient([])
    adapter, factory = _adapter(client)

    with pytest.raises(ModelClientError) as caught:
        await _collect(adapter.stream(_request(provider=_provider(connection_id="c_owner"))))

    assert caught.value.code == "anthropic_connection_unsupported"
    assert factory.calls == []
