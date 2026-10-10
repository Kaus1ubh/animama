"""Offline tests for the Gesture selection evaluation harness (scripts/evals/gesture_selection.py).

Every test uses a fake model client: the harness must never reach a provider here.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import AsyncIterator, Callable
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.app.chat import DirectChatPromptAssembler, RuntimeGestureDescriptor
from animama.app.chat.direct_turn.constants import DIRECT_CHAT_NODE_ID
from animama.app.chat.direct_turn.response_format import (
    gesture_response_guidance,
    main_structured_response_format_for_model,
    main_structured_response_guidance,
    render_available_gestures,
    response_model_agent_id,
    turn_response_schema_name,
)
from animama.app.chat.options import DirectChatOptions
from animama.app.main_structured_response import build_main_structured_response_model
from animama.app.model_catalog import STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
from animama.app.model_clients import (
    ModelClientDelta,
    ModelClientFinal,
    ModelClientProviderError,
    ModelClientRequest,
    StaticModelClientRegistry,
)
from animama.domain import ModelProvider, ModelProviderCapabilities
from animama.domain.model_provider import ModelProviderPricing
from animama.domain.usage import Usage
from scripts.evals import gesture_selection as harness

WAVE = RuntimeGestureDescriptor(selector="wave", name="Wave", description="Greet or say goodbye.")
THINK = RuntimeGestureDescriptor(selector="think", name="Think", description="Consider a hard question.")
CHEER = RuntimeGestureDescriptor(selector="cheer", name="Cheer", description="Celebrate good news.")
LOADOUT = harness.Loadout(name="starters", gestures=(WAVE, THINK))


def _reply(*, gesture: str | None, speech: str = "Sure thing.", tone: str = "neutral") -> str:
    return json.dumps(
        {
            "emotional_tone": tone,
            "emotional_intensity": 3,
            "gesture": gesture,
            "speech": speech,
            "display": None,
            "remember": None,
        }
    )


class _ReplyClient:
    """Fake model client answering each request from a callback and recording every request.

    With ``stream_text`` it streams the reply as one text delta before the final, as real clients do.
    """

    def __init__(self, reply: Callable[[ModelClientRequest], str | Exception], *, stream_text: bool = False) -> None:
        self.reply = reply
        self.stream_text = stream_text
        self.requests: list[ModelClientRequest] = []

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        self.requests.append(request)
        outcome = self.reply(request)
        if isinstance(outcome, Exception):
            raise outcome
        if self.stream_text:
            yield ModelClientDelta(kind="text_delta", text=outcome)
        yield ModelClientDelta(
            kind="final",
            final=ModelClientFinal(
                text=outcome,
                usage=Usage(requests=1, input_tokens=1000, output_tokens=100, total_tokens=1100),
                usage_reported=True,
            ),
        )
        yield ModelClientDelta(kind="done")

    async def aclose(self) -> None:
        return None


def _user_text(request: ModelClientRequest) -> str:
    content = request.prompt.messages[-1]["content"]
    assert isinstance(content, str)
    return content


def _provider(*, priced: bool = False) -> ModelProvider:
    return ModelProvider(
        id="OpenAIHTTPAgent:gpt-eval",
        provider_type="OpenAIHTTPAgent",
        model="gpt-eval",
        model_label="GPT Eval",
        provider_label="OpenAI",
        capabilities=ModelProviderCapabilities(
            supports_streaming=True,
            structured_kinds=["main_structured_response"],
            structured_output_transport=STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
        ),
        pricing=(
            ModelProviderPricing(
                pricing_status="priced",
                currency="USD",
                billing_unit="1M_tokens",
                standard_input_price_per_million=Decimal("1.00"),
                standard_cached_input_price_per_million=Decimal("0.10"),
                standard_output_price_per_million=Decimal("4.00"),
            )
            if priced
            else ModelProviderPricing()
        ),
    )


def _registry(client: _ReplyClient, provider: ModelProvider) -> StaticModelClientRegistry:
    return StaticModelClientRegistry({provider.provider_type: client})


def _item(item_id: str, message: str, *acceptable: str | None, tags: tuple[str, ...] = ()) -> harness.PromptItem:
    return harness.PromptItem(id=item_id, message=message, acceptable=tuple(acceptable), tags=tags)


def _plan(
    *,
    items: tuple[harness.PromptItem, ...] = (),
    chats: tuple[harness.ScriptedChat, ...] = (),
    loadouts: tuple[harness.Loadout, ...] = (LOADOUT,),
    repeats: int = 1,
    scripted_repeats: int = 1,
) -> harness.EvalPlan:
    return harness.EvalPlan(
        loadouts=loadouts,
        prompt_set=harness.PromptSet(items=items, scripted_chats=chats),
        repeats=repeats,
        scripted_repeats=scripted_repeats,
    )


async def test_prompt_and_schema_match_the_chat_assembly_for_the_loadout() -> None:
    provider = _provider()
    client = _ReplyClient(lambda _request: _reply(gesture="wave"))
    item = _item("greet", "Hi there!", "wave")

    await harness.run_evaluation(
        _plan(items=(item,)), model_provider=provider, registry=_registry(client, provider), max_calls=1
    )

    [request] = client.requests
    output_type = build_main_structured_response_model(
        agent_id=response_model_agent_id(DIRECT_CHAT_NODE_ID),
        gesture_ids=("wave", "think"),
    )
    expected = DirectChatPromptAssembler().assemble(
        user_message="Hi there!",
        anima_identity=harness.ANIMA_IDENTITY,
        anima_name=harness.ANIMA_NAME,
        response_format_guidance=gesture_response_guidance(
            main_structured_response_guidance(provider, output_type), LOADOUT.gestures
        ),
    )
    assert request.prompt.messages == expected.messages
    assert "- wave: Wave — Greet or say goodbye.\n- think: Think — Consider a hard question." in str(
        request.prompt.messages[0]["content"]
    )
    assert request.prompt.response_format == main_structured_response_format_for_model(
        provider, output_type, name=turn_response_schema_name(DirectChatOptions())
    )
    response_format: Any = request.prompt.response_format
    assert response_format["json_schema"]["schema"]["properties"]["gesture"]["enum"] == [None, "wave", "think"]
    # No memory tools, memory map or MEMORIES.md: the Anima is neutral and memoryless.
    assert request.prompt.tools == ()
    assert request.model_provider is provider
    # The turn is incognito, so the provider is asked not to store it.
    assert request.provider_options.store is False


def test_fit_counts_null_only_when_the_item_accepts_null() -> None:
    assert harness.score_fit("wave", ("wave", "think"))
    assert not harness.score_fit("think", ("wave",))
    assert not harness.score_fit(None, ("wave",))
    assert harness.score_fit(None, ("wave", None))
    assert not harness.score_fit("wave", (None,))


def test_turns_without_a_gesture_end_runs_and_do_not_count_as_distinct() -> None:
    gestures = ["wave", "wave", None, "think", "think", "think", None, None, "wave"]

    assert harness.longest_run(gestures) == (3, "think")
    assert harness.longest_run([None, None]) == (0, None)
    assert harness.distinct_gestures(gestures) == 2


async def test_single_turn_scores_fit_null_and_errors_per_loadout() -> None:
    provider = _provider(priced=True)
    replies: dict[str, str | Exception] = {
        "Hello!": _reply(gesture="wave", speech="Hello to you too."),
        "What is 2 + 2?": _reply(gesture=None, speech="Four."),
        "I got the job!": _reply(gesture="think", speech="Congratulations!"),
        "Broken": ModelClientProviderError("provider failed", code="provider_failed"),
    }
    client = _ReplyClient(lambda request: replies[_user_text(request)])
    items = (
        _item("greet", "Hello!", "wave", tags=("greeting",)),
        _item("math", "What is 2 + 2?", None, "think", tags=("neutral",)),
        _item("news", "I got the job!", "cheer", tags=("joy",)),
        _item("broken", "Broken", "wave"),
    )

    results = await harness.run_evaluation(
        _plan(items=items), model_provider=provider, registry=_registry(client, provider), max_calls=4
    )

    [loadout] = results["loadouts"]
    single = loadout["single_turn"]
    assert (single["runs"], single["scored"], single["errors"]) == (4, 3, 1)
    assert (single["fits"], single["nulls"]) == (2, 1)
    assert single["fit_rate"] == pytest.approx(2 / 3)
    assert single["null_rate"] == pytest.approx(1 / 3)
    assert single["by_tag"]["joy"] == {"scored": 1, "fits": 0, "fit_rate": 0.0}
    # "news" accepts only an unequipped Gesture, so it cannot fit this loadout.
    assert loadout["coverable_items"] == 3
    assert loadout["gesture_count"] == 2
    assert loadout["gesture_list_bytes"] == len(render_available_gestures(LOADOUT.gestures).encode())
    assert loadout["instruction_bytes"] > loadout["gesture_list_bytes"]
    turns = {turn["conversation_id"]: turn for turn in results["turns"]}
    assert turns["greet"]["gesture"] == "wave" and turns["greet"]["fit"] is True
    assert turns["math"]["gesture"] is None and turns["math"]["fit"] is True
    assert turns["broken"]["error"] == "provider_failed" and turns["broken"]["fit"] is None
    assert results["calls"] == {"estimated": 4, "max": 4, "made": 4}
    assert results["usage"]["input_tokens"] == 3000
    assert results["usage"]["output_tokens"] == 300
    assert results["cost"]["priced"] is True
    assert results["cost"]["total"] == "0.004200"
    assert results["aborted"] is None


async def test_run_refuses_to_start_when_the_estimate_exceeds_the_budget() -> None:
    provider = _provider()
    client = _ReplyClient(lambda _request: _reply(gesture="wave"))
    plan = _plan(items=(_item("a", "One", "wave"), _item("b", "Two", "wave")), repeats=2)

    with pytest.raises(harness.CallBudgetExceeded, match="4 model calls"):
        await harness.run_evaluation(plan, model_provider=provider, registry=_registry(client, provider), max_calls=3)

    assert client.requests == []


async def test_run_stops_before_a_call_beyond_the_budget() -> None:
    provider = _provider()
    # The first reply is not JSON, so chat spends a second call on its structured repair.
    replies = iter(["not json at all", _reply(gesture="wave"), _reply(gesture="wave")])
    client = _ReplyClient(lambda _request: next(replies))
    plan = _plan(items=(_item("a", "One", "wave"), _item("b", "Two", "wave")))

    results = await harness.run_evaluation(
        plan, model_provider=provider, registry=_registry(client, provider), max_calls=2
    )

    assert len(client.requests) == 2
    assert results["aborted"] == "max_calls"
    assert results["calls"]["made"] == 2
    # The repaired first turn is kept; the refused second turn is left out rather than scored.
    assert [turn["conversation_id"] for turn in results["turns"]] == ["a"]
    assert results["turns"][0]["calls"] == 2
    assert results["turns"][0]["structured_recovery"] == "repaired"
    assert results["turns"][0]["gesture"] == "wave"


async def test_a_refused_structured_repair_drops_the_turn_instead_of_scoring_it() -> None:
    provider = _provider()
    client = _ReplyClient(lambda _request: "not json at all")

    results = await harness.run_evaluation(
        _plan(items=(_item("a", "One", "wave"),)),
        model_provider=provider,
        registry=_registry(client, provider),
        max_calls=1,
    )

    # Without the cap chat would speak the plain-text fallback and play no Gesture; that is not a selection.
    assert len(client.requests) == 1
    assert results["aborted"] == "max_calls"
    assert results["turns"] == []
    assert results["loadouts"][0]["single_turn"]["runs"] == 0


async def test_a_reply_salvaged_from_streamed_speech_is_replayed_as_chat_salvages_it() -> None:
    provider = _provider()
    truncated = '{"emotional_tone":"joy","emotional_intensity":4,"gesture":"wave","speech":"Hello there. Nice to'
    replies = {"Hi!": truncated, "Again?": _reply(gesture=None)}
    client = _ReplyClient(lambda request: replies[_user_text(request)], stream_text=True)
    chat = harness.ScriptedChat(id="c", turns=("Hi!", "Again?"))

    results = await harness.run_evaluation(
        _plan(chats=(chat,)), model_provider=provider, registry=_registry(client, provider), max_calls=2
    )

    first = results["turns"][0]
    # Speech already streamed, so chat keeps the streamed reply instead of requesting a repair.
    assert (first["structured_recovery"], first["calls"]) == ("salvaged", 1)
    assert (first["gesture"], first["replayed_gesture"], first["gesture_mismatch"]) == ("wave", "wave", False)
    replayed = json.loads(str(client.requests[1].prompt.messages[2]["content"]))
    assert replayed["gesture"] == "wave"
    assert replayed["emotional_tone"] == "joy"
    assert replayed["speech"].startswith("Hello there.")


async def test_a_gesture_outside_the_loadout_is_dropped_and_flagged() -> None:
    provider = _provider()
    client = _ReplyClient(lambda _request: _reply(gesture="cheer"))

    results = await harness.run_evaluation(
        _plan(items=(_item("a", "Yay!", "cheer", None),)),
        model_provider=provider,
        registry=_registry(client, provider),
        max_calls=1,
    )

    [turn] = results["turns"]
    assert (turn["gesture"], turn["replayed_gesture"], turn["gesture_mismatch"]) == (None, "cheer", True)
    assert turn["fit"] is True


async def test_scripted_chats_repeat_separately_and_loadouts_interleave_per_item() -> None:
    provider = _provider()
    client = _ReplyClient(lambda _request: _reply(gesture="wave"))
    client.native_context_compaction = True  # type: ignore[attr-defined]
    everything = harness.Loadout(name="all", gestures=(CHEER, THINK, WAVE))
    plan = _plan(
        items=(_item("a", "One", "wave"),),
        chats=(harness.ScriptedChat(id="c", turns=("Hi!", "Bye!")),),
        loadouts=(LOADOUT, everything),
        repeats=2,
        scripted_repeats=1,
    )

    results = await harness.run_evaluation(
        plan, model_provider=provider, registry=_registry(client, provider), max_calls=8
    )

    assert plan.estimated_calls == 2 * (2 * 1 + 1 * 2)
    assert [(turn["loadout"], turn["conversation_id"], turn["repeat"], turn["turn"]) for turn in results["turns"]] == [
        ("starters", "a", 1, 1),
        ("all", "a", 1, 1),
        ("starters", "a", 2, 1),
        ("all", "a", 2, 1),
        ("starters", "c", 1, 1),
        ("starters", "c", 1, 2),
        ("all", "c", 1, 1),
        ("all", "c", 1, 2),
    ]
    assert (results["repeats"], results["scripted_repeats"], results["incognito"]) == (2, 1, True)
    assert results["model"]["native_context_compaction"] is True


async def test_partial_results_are_handed_over_when_the_run_fails() -> None:
    provider = _provider()
    replies: dict[str, str | Exception] = {"One": _reply(gesture="wave"), "Two": RuntimeError("network down")}
    client = _ReplyClient(lambda request: replies[_user_text(request)])
    finished: list[dict[str, Any]] = []

    with pytest.raises(RuntimeError, match="network down"):
        await harness.run_evaluation(
            _plan(items=(_item("a", "One", "wave"), _item("b", "Two", "wave"))),
            model_provider=provider,
            registry=_registry(client, provider),
            max_calls=2,
            on_finish=finished.append,
        )

    [results] = finished
    assert results["aborted"] == "error: RuntimeError"
    assert [turn["conversation_id"] for turn in results["turns"]] == ["a"]


async def test_scripted_chat_carries_its_visible_history_turn_by_turn() -> None:
    provider = _provider()
    gestures = {"Hello?": "wave", "Hi!": "wave", "Tell me a riddle.": "think", "Bye!": "wave"}
    client = _ReplyClient(
        lambda request: _reply(gesture=gestures[_user_text(request)], speech=f"Reply to {_user_text(request)}")
    )
    chat = harness.ScriptedChat(id="long", turns=("Hi!", "Tell me a riddle.", "Bye!"))
    single = _item("solo", "Hello?", "wave")

    results = await harness.run_evaluation(
        _plan(items=(single,), chats=(chat,)),
        model_provider=provider,
        registry=_registry(client, provider),
        max_calls=4,
    )

    solo_request, first, second, third = client.requests
    # Incognito turns: the provider stores nothing and no Responses cursor replaces the replayed history.
    assert all(request.provider_options.store is False for request in client.requests)
    assert all(request.continuation is None for request in client.requests)
    assert [message["role"] for message in solo_request.prompt.messages] == ["system", "developer", "user"]
    assert [message["role"] for message in first.prompt.messages] == ["system", "developer", "user"]
    first_reply = _reply(gesture="wave", speech="Reply to Hi!")
    second_reply = _reply(gesture="think", speech="Reply to Tell me a riddle.")
    assert [(message["role"], message["content"]) for message in second.prompt.messages[1:]] == [
        ("user", "Hi!"),
        ("assistant", first_reply),
        ("developer", first.prompt.messages[1]["content"]),
        ("user", "Tell me a riddle."),
    ]
    assert [(message["role"], message["content"]) for message in third.prompt.messages[1:5]] == [
        ("user", "Hi!"),
        ("assistant", first_reply),
        ("user", "Tell me a riddle."),
        ("assistant", second_reply),
    ]
    [scripted] = results["loadouts"][0]["scripted"]
    assert scripted == {
        "chat": "long",
        "repeat": 1,
        "turns": 3,
        "scored": 3,
        "errors": 0,
        "nulls": 0,
        "distinct_gestures": 2,
        "longest_run": 1,
        "longest_run_gesture": "wave",
    }


def test_inputs_load_and_reject_malformed_files(tmp_path: Path) -> None:
    loadout_path = tmp_path / "starters.json"
    loadout_path.write_text(json.dumps([{"selector": "wave", "name": "Wave", "description": "Greet."}]))
    prompts_path = tmp_path / "prompts.json"
    prompts_path.write_text(
        json.dumps(
            {
                "items": [{"id": "greet", "message": "Hi", "acceptable": ["wave", None], "tags": ["greeting"]}],
                "scripted_chats": [{"id": "long", "turns": ["Hi", "Bye"]}],
            }
        )
    )

    loadout = harness.load_loadout(loadout_path)
    prompt_set = harness.load_prompt_set(prompts_path)

    assert loadout == harness.Loadout(
        name="starters", gestures=(RuntimeGestureDescriptor(selector="wave", name="Wave", description="Greet."),)
    )
    assert prompt_set.items == (_item("greet", "Hi", "wave", None, tags=("greeting",)),)
    assert prompt_set.scripted_chats == (harness.ScriptedChat(id="long", turns=("Hi", "Bye")),)

    duplicate = tmp_path / "duplicate.json"
    duplicate.write_text(json.dumps([{"selector": "wave", "name": "A", "description": "a"}] * 2))
    with pytest.raises(harness.EvalInputError, match="duplicate selector 'wave'"):
        harness.load_loadout(duplicate)
    no_acceptable = tmp_path / "no-acceptable.json"
    no_acceptable.write_text(json.dumps({"items": [{"id": "x", "message": "Hi", "acceptable": []}]}))
    with pytest.raises(harness.EvalInputError, match="acceptable"):
        harness.load_prompt_set(no_acceptable)


def _write_inputs(tmp_path: Path) -> tuple[Path, Path]:
    loadout_path = tmp_path / "starters.json"
    loadout_path.write_text(
        json.dumps([{"selector": g.selector, "name": g.name, "description": g.description} for g in (WAVE, THINK)])
    )
    prompts_path = tmp_path / "prompts.json"
    prompts_path.write_text(
        json.dumps(
            {
                "items": [
                    {"id": "greet", "message": "Hello!", "acceptable": ["wave"]},
                    {"id": "news", "message": "I got the job!", "acceptable": ["cheer"]},
                ],
                "scripted_chats": [{"id": "long", "turns": ["Hi!", "Bye!"]}],
            }
        )
    )
    return loadout_path, prompts_path


def test_dry_run_prints_the_plan_without_resolving_a_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    loadout_path, prompts_path = _write_inputs(tmp_path)

    async def no_model(_model_provider_id: str) -> ModelProvider:
        raise AssertionError("a dry run must not resolve a model")

    monkeypatch.setattr(harness, "load_model_provider", no_model)
    output_dir = tmp_path / "out"

    exit_code = harness.main(
        [
            "--loadout",
            str(loadout_path),
            "--prompts",
            str(prompts_path),
            "--repeats",
            "3",
            "--scripted-repeats",
            "2",
            "--max-calls",
            "9",
            "--output-dir",
            str(output_dir),
            "--dry-run",
        ]
    )

    out = capsys.readouterr().out
    assert exit_code == 0
    # One loadout: 3 repeats x 2 single-turn items + 2 scripted repeats x 2 scripted turns.
    assert "Estimated model calls: 10" in out
    assert "exceeds --max-calls 9, so the run will not start" in out
    gesture_bytes = len(render_available_gestures((WAVE, THINK)).encode())
    assert f"starters: 2 Gestures, {gesture_bytes} gesture-list bytes, 1/2 items coverable" in out
    assert re.search(r"starters: ~\d+ input tokens per first turn", out)
    # Chat lists equipped Gestures sorted by selector; this file lists wave before think.
    assert "starters is not in production order" in out
    assert "Acceptable selectors in no loadout: cheer" in out
    assert not output_dir.exists()


def test_main_refuses_an_over_budget_plan_before_reading_the_catalog(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    loadout_path, prompts_path = _write_inputs(tmp_path)

    async def no_catalog(_model_provider_id: str) -> ModelProvider:
        raise AssertionError("an over-budget plan must not read the model catalog")

    def no_registry() -> StaticModelClientRegistry:
        raise AssertionError("an over-budget plan must not build model clients")

    monkeypatch.setattr(harness, "load_model_provider", no_catalog)
    monkeypatch.setattr(harness, "build_registry", no_registry)
    output_dir = tmp_path / "out"

    exit_code = harness.main(
        [
            "--loadout",
            str(loadout_path),
            "--prompts",
            str(prompts_path),
            "--model-provider-id",
            "OpenAIHTTPAgent:gpt-eval",
            "--max-calls",
            "3",
            "--output-dir",
            str(output_dir),
        ]
    )

    captured = capsys.readouterr()
    assert exit_code == 2
    assert "so the run will not start" in captured.out
    assert "The plan needs 4 model calls, more than --max-calls 3" in captured.err
    assert not output_dir.exists()


def test_real_run_writes_results_and_a_summary_without_raw_replies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    loadout_path, prompts_path = _write_inputs(tmp_path)
    loaded_prompts_sha256 = hashlib.sha256(prompts_path.read_bytes()).hexdigest()
    provider = _provider()

    def reply(request: ModelClientRequest) -> str:
        # Editing an input mid-run must not change the recorded hash of what the run loaded.
        prompts_path.write_text("{}")
        return _reply(gesture="wave", speech=f"SECRET-SPEECH {_user_text(request)}")

    client = _ReplyClient(reply)

    async def load_model_provider(model_provider_id: str) -> ModelProvider:
        assert model_provider_id == provider.id
        return provider

    monkeypatch.setattr(harness, "load_model_provider", load_model_provider)
    monkeypatch.setattr(harness, "build_registry", lambda: _registry(client, provider))
    output_dir = tmp_path / "out"

    exit_code = harness.main(
        [
            "--loadout",
            str(loadout_path),
            "--prompts",
            str(prompts_path),
            "--model-provider-id",
            provider.id,
            "--max-calls",
            "4",
            "--output-dir",
            str(output_dir),
        ]
    )

    assert exit_code == 0
    assert len(client.requests) == 4
    results = json.loads((output_dir / "results.json").read_text())
    assert results["model"]["model_provider_id"] == provider.id
    assert results["inputs"]["prompt_set"] == {"path": str(prompts_path), "sha256": loaded_prompts_sha256}
    assert [loadout["name"] for loadout in results["loadouts"]] == ["starters"]
    summary = (output_dir / "summary.md").read_text()
    assert "| starters | 2 |" in summary
    assert "50.0% (1/2)" in summary
    assert "SECRET-SPEECH" not in summary
    assert harness.ANIMA_IDENTITY not in summary
    assert str(output_dir / "summary.md") in capsys.readouterr().out


async def test_model_provider_resolves_from_the_catalog_without_writing(async_session: AsyncSession) -> None:
    await SQLAlchemyModelProviderRepository(async_session).upsert_many([_provider()])
    await async_session.commit()

    loaded = await harness.load_model_provider("OpenAIHTTPAgent:gpt-eval")

    assert (loaded.id, loaded.model) == ("OpenAIHTTPAgent:gpt-eval", "gpt-eval")
    assert loaded.connection is not None and loaded.connection.id == "openai"
    with pytest.raises(harness.EvalInputError, match="Model provider not found"):
        await harness.load_model_provider("OpenAIHTTPAgent:missing")
    async with harness._read_only_model_providers() as model_providers:
        with pytest.raises(DBAPIError, match="read-only transaction"):
            await model_providers.set_hidden("OpenAIHTTPAgent:gpt-eval", hidden=True)


async def test_cli_composition_runs_against_the_mock_model_client(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # ANIMAMA_LLM_SKIP makes chat's own registry serve the mock client: the smoke run the docs describe.
    monkeypatch.setenv("ANIMAMA_LLM_SKIP", "1")
    await SQLAlchemyModelProviderRepository(async_session).upsert_many([_provider()])
    await async_session.commit()
    loadout_path, prompts_path = _write_inputs(tmp_path)
    output_dir = tmp_path / "out"

    results = await harness._run(
        harness.EvalPlan(
            loadouts=(harness.load_loadout(loadout_path),), prompt_set=harness.load_prompt_set(prompts_path)
        ),
        model_provider_id="OpenAIHTTPAgent:gpt-eval",
        max_calls=4,
        reasoning_effort=None,
    )
    harness.write_outputs(results, output_dir)

    assert results["calls"]["made"] == 4
    assert results["aborted"] is None
    assert [turn["gesture"] for turn in results["turns"]] == [None, None, None, None]
    assert (output_dir / "summary.md").exists()


def test_real_run_requires_a_model_and_a_call_budget(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    loadout_path, prompts_path = _write_inputs(tmp_path)

    exit_code = harness.main(["--loadout", str(loadout_path), "--prompts", str(prompts_path)])

    assert exit_code == 2
    assert "--model-provider-id and --max-calls are required" in capsys.readouterr().err
