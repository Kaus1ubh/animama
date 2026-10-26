"""Offline tests for the shared evaluation core (scripts/evals/core).

Every test uses a fake model client: the core must never reach a provider here.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from decimal import Decimal
from typing import Any

import pytest

from animama.app.chat import RuntimeGestureDescriptor
from animama.app.chat.conversation_language import conversation_language
from animama.app.chat.options import DirectChatTtsOptions
from animama.app.model_catalog import STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
from animama.app.model_clients import ModelClientDelta, ModelClientError, ModelClientFinal, ModelClientRequest
from animama.domain import ModelProvider, ModelProviderCapabilities
from animama.domain.usage import Usage
from scripts.evals.core import chat, model_calls, pricing, stats, turns
from scripts.evals.core.inputs import EvalInputError

WAVE = RuntimeGestureDescriptor(selector="wave", name="Wave", description="Greet or say goodbye.")
PROVIDER = ModelProvider(
    id="OpenAIHTTPAgent:gpt-core",
    provider_type="OpenAIHTTPAgent",
    model="gpt-core",
    model_label="GPT Core",
    provider_label="OpenAI",
    capabilities=ModelProviderCapabilities(
        supports_streaming=True,
        structured_kinds=["main_structured_response"],
        structured_output_transport=STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
    ),
)


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class _Client:
    """Streams each reply as one text delta, then a final reporting ``served`` as the model."""

    def __init__(self, replies: list[str], *, clock: _Clock, served: str | None = "gpt-core-2026-10-01") -> None:
        self.replies = replies
        self.clock = clock
        self.served = served
        self.requests: list[ModelClientRequest] = []

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        self.requests.append(request)
        text = self.replies[len(self.requests) - 1]
        self.clock.now += 0.5
        yield ModelClientDelta(kind="text_delta", text=text)
        self.clock.now += 0.25
        yield ModelClientDelta(
            kind="final",
            final=ModelClientFinal(
                text=text,
                usage=Usage(requests=1, input_tokens=1000, output_tokens=50, total_tokens=1050),
                usage_reported=True,
                raw_provider_metadata={"model": self.served} if self.served else {},
            ),
        )
        yield ModelClientDelta(kind="done")

    async def aclose(self) -> None:
        return None


def _reply(gesture: str | None = "wave", speech: str = "Hello there. Nice to see you.") -> str:
    return json.dumps(
        {
            "emotional_tone": "happy",
            "emotional_intensity": 4,
            "gesture": gesture,
            "speech": speech,
            "display": None,
            "remember": None,
        }
    )


async def _drain(client: model_calls.BudgetedModelClient, request: Any) -> list[ModelClientDelta]:
    return [delta async for delta in client.stream(request)]


async def test_budgeted_client_records_calls_and_refuses_beyond_the_cap() -> None:
    clock = _Clock()
    budget = model_calls.BudgetedModelClient(_Client([_reply(), _reply()], clock=clock), max_calls=1, clock=clock)

    await _drain(budget, object())
    with pytest.raises(ModelClientError) as refused:
        await _drain(budget, object())

    assert refused.value.code == model_calls.BUDGET_ERROR_CODE
    assert budget.refused is True
    [call] = budget.calls
    assert (call.started, call.first_text, call.finished) == (0.0, 0.5, 0.75)
    assert call.served_model == "gpt-core-2026-10-01"
    assert call.usage is not None and call.usage.input_tokens == 1000
    assert model_calls.call_latency(call) == {"seconds": 0.75, "first_text_seconds": 0.5}


async def test_budgeted_client_records_no_served_model_when_the_provider_reports_none() -> None:
    clock = _Clock()
    budget = model_calls.BudgetedModelClient(_Client([_reply()], clock=clock, served=None), max_calls=1, clock=clock)

    await _drain(budget, object())

    assert budget.calls[0].served_model is None


def test_token_prices_parse_and_cost() -> None:
    prices = pricing.parse_token_prices("input=0.10, cached_input=0.01, cache_write=0.125, output=0.50")
    usage = {"input_tokens": 3000, "cached_input_tokens": 1000, "cache_write_tokens": 1000, "output_tokens": 200}

    # 1000 uncached x 0.10 + 1000 cached x 0.01 + 1000 written x 0.125 + 200 output x 0.50, per 1M tokens.
    assert prices.cost(usage) == Decimal("0.000335")
    assert prices.as_json() == {"input": "0.10", "cached_input": "0.01", "cache_write": "0.125", "output": "0.50"}


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("input=1,cached_input=1,cache_write=1", "missing output"),
        ("input=1,input=1,cached_input=1,cache_write=1,output=1", "duplicate rate"),
        ("input=-1,cached_input=1,cache_write=1,output=1", "non-negative"),
        ("input=x,cached_input=1,cache_write=1,output=1", "must be a number"),
        ("tokens=1", "unknown or malformed"),
    ],
)
def test_token_prices_reject_bad_rates(text: str, message: str) -> None:
    with pytest.raises(EvalInputError, match=message):
        pricing.parse_token_prices(text)


def test_usage_totals_count_completed_calls_without_usage() -> None:
    reported = model_calls.CallRecord(
        started=0.0, final_text="ok", usage=Usage(requests=1, input_tokens=10, output_tokens=2, total_tokens=12)
    )
    unreported = model_calls.CallRecord(started=0.0, final_text="ok")
    failed = model_calls.CallRecord(started=0.0)

    totals = pricing.usage_json([reported, unreported, failed])

    assert totals["input_tokens"] == 10 and totals["output_tokens"] == 2
    assert totals["unreported_calls"] == 1


def test_reply_calls_leave_out_tool_rounds_and_failed_calls() -> None:
    tool_round = model_calls.CallRecord(started=0.0, final_text="", tool_calls=1)
    failed = model_calls.CallRecord(started=0.0)
    reply = model_calls.CallRecord(started=0.0, final_text="{}")
    repair = model_calls.CallRecord(started=0.0, final_text="{}")

    assert model_calls.reply_calls([tool_round, failed, reply, repair]) == [reply, repair]


def test_nearest_rank_p90_and_distribution() -> None:
    values = [float(value) for value in range(1, 11)]

    assert stats.p90(values) == 9.0
    assert stats.p90([5.0]) == 5.0
    assert stats.distribution(values) == {"median": 5.5, "p90": 9.0, "mean": 5.5}
    assert stats.distribution([]) == {"median": None, "p90": None, "mean": None}


def test_gesture_runs_and_variety() -> None:
    gestures = ["wave", "wave", None, "think", "think", "think", "wave"]

    assert stats.longest_run(gestures) == (3, "think")
    assert stats.distinct_gestures(gestures) == 2


def _executor(client: Any, chats: chat.EvalChats) -> Any:
    return chat.build_executor(
        PROVIDER, client, chats, memory_context=chat.StaticMemoryContext(identity="A calm companion.", name="Kai")
    )


def _request(message: str, *, tts: DirectChatTtsOptions | None = None) -> Any:
    return chat.turn_request(
        (WAVE,),
        anima_id="core-anima",
        user_id="core-owner",
        chat_id="core/chat",
        turn_index=1,
        message=message,
        model_provider_id=PROVIDER.id,
        options=chat.incognito_turn_options(None, tts=tts),
    )


async def test_execute_turn_collects_the_played_reply_and_its_history() -> None:
    clock = _Clock()
    budget = model_calls.BudgetedModelClient(_Client([_reply()], clock=clock), max_calls=2, clock=clock)
    chats = chat.EvalChats()

    outcome = await turns.execute_turn(
        _executor(budget, chats), _request("Hi!"), budget=budget, chats=chats, clock=clock
    )

    assert outcome.refused is False and outcome.error is None
    assert outcome.gesture == "wave" and outcome.recovery is None
    assert outcome.reply is not None and outcome.reply.speech.startswith("Hello there.")
    assert len(outcome.calls) == 1 and outcome.calls[0].served_model == "gpt-core-2026-10-01"
    assert outcome.sent == 0.0 and outcome.finished == 0.75 and outcome.first_output is not None
    history = await chats.get_chat_context(chat_id="core/chat")
    assert [row.content for row in history.messages] == ["Hi!", _reply()]


async def test_execute_turn_marks_a_refused_turn_and_keeps_no_history() -> None:
    clock = _Clock()
    budget = model_calls.BudgetedModelClient(_Client([], clock=clock), max_calls=0, clock=clock)
    chats = chat.EvalChats()

    outcome = await turns.execute_turn(
        _executor(budget, chats), _request("Hi!"), budget=budget, chats=chats, clock=clock
    )

    assert outcome.refused is True and outcome.reply is None and outcome.calls == ()
    assert (await chats.get_chat_context(chat_id="core/chat")).messages == []


async def test_turn_options_carry_the_voice_into_the_prompt() -> None:
    clock = _Clock()
    budget = model_calls.BudgetedModelClient(_Client([_reply()], clock=clock), max_calls=1, clock=clock)
    chats = chat.EvalChats()
    executor = _executor(budget, chats)

    voiced = await executor.prepare_turn(_request("Hi!", tts=DirectChatTtsOptions(enabled=True, provider="elevenlabs")))
    silent = await executor.prepare_turn(_request("Hi!"))

    def system_text(prepared: Any) -> str:
        return "\n".join(
            str(message["content"]) for message in prepared.model_request.prompt.messages if message["role"] == "system"
        )

    assert "[excited]" in system_text(voiced) and "[excited]" not in system_text(silent)
    assert chat.instruction_bytes(voiced.model_request.prompt) > 0


def test_turn_request_carries_the_language_and_moderation() -> None:
    japanese = conversation_language("ja")
    request = chat.turn_request(
        (WAVE,),
        anima_id="core-anima",
        user_id="core-owner",
        chat_id="core/ja",
        turn_index=2,
        message="こんにちは",
        model_provider_id=PROVIDER.id,
        options=chat.incognito_turn_options(None),
        conversation_language=japanese,
        provider_moderation=True,
    )
    default = _request("Hi!")

    assert japanese is not None and request.conversation_language == japanese
    assert request.provider_moderation is True and request.run_id == "core/ja/t2"
    assert default.conversation_language is None and default.provider_moderation is False


async def test_execute_turn_shows_the_prepared_turn_before_it_streams() -> None:
    clock = _Clock()
    budget = model_calls.BudgetedModelClient(_Client([_reply()], clock=clock), max_calls=1, clock=clock)
    chats = chat.EvalChats()
    seen: list[tuple[float, int]] = []

    await turns.execute_turn(
        _executor(budget, chats),
        _request("Hi!"),
        budget=budget,
        chats=chats,
        clock=clock,
        on_prepared=lambda prepared: seen.append((clock(), len(budget.calls))),
    )

    # Before the stream: the clock has not moved and no model call was made yet.
    assert seen == [(0.0, 0)]
