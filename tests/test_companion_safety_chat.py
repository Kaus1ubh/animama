"""Companion safety in chat turns: notice, crisis card, care note, inline moderation (spec R2–R5)."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request

from animama.adapters.model_clients.openai_responses.final import input_moderation_from_response
from animama.adapters.model_clients.openai_responses.request import create_response_kwargs
from animama.app.chat.direct_turn.provider_state import MemoryToolConfig, build_model_client_provider_options
from animama.app.chat.openai_prompt import DirectChatPromptAssembler
from animama.app.chat.options import DirectChatOptions
from animama.app.model_clients import (
    ModelClientFinal,
    ModelClientModeration,
    ModelClientProviderOptions,
    ModelClientRequest,
)
from animama.app.model_clients.prompt import prompt_instruction_text
from animama.app.safety.config import OperatorSafetyConfig, SafetyPreferences, resolve_companion_safety
from animama.app.safety.crisis_detector import NEGATIVE
from animama.app.safety.crisis_resources import crisis_resource_table
from animama.app.safety.moderation import RESPONSES_MODERATION_MODEL, moderation_indicates_crisis
from animama.app.safety.prompts import COMPANION_GUARDRAILS, CRISIS_CARE_NOTE
from animama.domain.request_principal import RequestPrincipal
from animama.domain.usage import Usage
from animama.orm.companion_safety import ORMCompanionSafetyState
from animama.server.config import Settings
from animama.server.routers.anima import chat_anima_direct_sse
from animama.server.routers.chat.safety import TurnSafety, ai_notice_frame
from tests import test_anima_chat_sse as route

CRISIS_MESSAGE = "I want to kill myself"


def _moderation(**categories: bool) -> SimpleNamespace:
    return SimpleNamespace(
        type="moderation_result",
        categories=categories,
        category_scores={name: (0.95 if flagged else 0.01) for name, flagged in categories.items()},
    )


# --- Inline moderation plumbing ------------------------------------------------


def test_input_moderation_is_parsed_without_content() -> None:
    response = SimpleNamespace(
        moderation=SimpleNamespace(input=_moderation(**{"self-harm/intent": True, "violence": False}), output=None)
    )
    parsed = input_moderation_from_response(response)  # type: ignore[arg-type]
    assert parsed == ModelClientModeration(
        status="result",
        flagged_categories=("self-harm/intent",),
        category_scores={"self-harm/intent": 0.95, "violence": 0.01},
    )
    assert input_moderation_from_response(SimpleNamespace(moderation=None)) is None  # type: ignore[arg-type]
    errored = SimpleNamespace(moderation=SimpleNamespace(input=SimpleNamespace(type="error", code="x", message="y")))
    assert input_moderation_from_response(errored) == ModelClientModeration(status="error")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("moderation", "expected"),
    [
        (None, False),
        (ModelClientModeration(status="error"), False),
        (ModelClientModeration(status="result"), False),
        (ModelClientModeration(status="result", flagged_categories=("self-harm/intent",)), True),
        (ModelClientModeration(status="result", flagged_categories=("self-harm/instructions",)), True),
        (ModelClientModeration(status="result", flagged_categories=("violence",)), False),
        (ModelClientModeration(status="result", category_scores={"self-harm": 0.85}), True),
        (ModelClientModeration(status="result", category_scores={"self-harm": 0.4}), False),
    ],
)
def test_moderation_crisis_interpretation(moderation: ModelClientModeration | None, expected: bool) -> None:
    assert moderation_indicates_crisis(moderation) is expected


@pytest.mark.parametrize(
    ("provider_type", "provider_moderation", "expected"),
    [
        ("OpenAIResponsesHTTPAgent", True, RESPONSES_MODERATION_MODEL),
        ("OpenAIResponsesHTTPAgent", False, None),
        ("OpenAIHTTPAgent", True, None),
    ],
)
def test_moderation_is_requested_only_for_responses(
    provider_type: str, provider_moderation: bool, expected: str | None
) -> None:
    options = build_model_client_provider_options(
        DirectChatOptions(),
        model_provider=route._model_provider(provider_type=provider_type),
        memory_tool_config=MemoryToolConfig(allow_reads=False, allow_writes=False),
        provider_moderation=provider_moderation,
    )
    assert options.moderation_model == expected


def test_responses_request_carries_moderation_field_only_when_requested() -> None:
    prompt = DirectChatPromptAssembler().assemble(user_message="hi", anima_identity="Identity")
    provider = route._model_provider(provider_type="OpenAIResponsesHTTPAgent", model="gpt-test")
    with_moderation = ModelClientRequest(
        model_provider=provider,
        prompt=prompt,
        provider_options=ModelClientProviderOptions(moderation_model=RESPONSES_MODERATION_MODEL),
    )
    without = ModelClientRequest(model_provider=provider, prompt=prompt)
    assert create_response_kwargs(with_moderation, None, timeout=None)["moderation"] == {
        "model": RESPONSES_MODERATION_MODEL
    }
    assert "moderation" not in create_response_kwargs(without, None, timeout=None)


# --- Route-level safety frames ---------------------------------------------------


def _request(runtime_settings: Settings | None = None) -> Request:
    app = FastAPI()
    app.state.model_client_registry = route._CURRENT_TEST_REGISTRY
    if runtime_settings is not None:
        app.state.runtime_settings = runtime_settings
    return Request({"type": "http", "app": app})


async def _run(message: str, *, runtime_settings: Settings | None = None, **chat_values: Any) -> list[str]:
    response = await chat_anima_direct_sse(
        "anima-1",
        route._chat_request(message=message, run_id="run-1", chat_id="chat-1", **chat_values),
        request=_request(runtime_settings),
        user=RequestPrincipal(id="user-1"),
    )
    return await route._collect_chunks(response)


def _names(chunks: list[str]) -> list[str]:
    return [line[7:] for chunk in chunks for line in chunk.splitlines() if line.startswith("event: ")]


@pytest.mark.asyncio
async def test_local_crisis_turn_shows_card_before_reply_and_adds_care_note(monkeypatch) -> None:
    client = route._RouteModelClient()
    route._install_route_mocks(monkeypatch, model_client=client)

    chunks = await _run(CRISIS_MESSAGE, client_context={"locale": "en-GB"})

    names = _names(chunks)
    assert names.count("safety.crisis_support") == 1
    assert names.index("safety.crisis_support") < names.index("user.response")
    assert names[-1] == "run.completed"
    card = route._event_data(chunks, "safety.crisis_support")
    assert card["source"] == "local"
    assert card["resources"]["code"] == "GB"
    assert not {"text", "error", "emotions", "gesture"} & set(card)
    instructions = prompt_instruction_text(client.seen_specs[0].prompt)
    assert instructions is not None
    assert instructions.endswith(COMPANION_GUARDRAILS.strip())
    assert instructions.index(CRISIS_CARE_NOTE.strip()) < instructions.index("# Companion Guardrails")
    assert CRISIS_MESSAGE not in json.dumps(card)


@pytest.mark.asyncio
async def test_ordinary_turn_has_no_card_or_care_note(monkeypatch) -> None:
    client = route._RouteModelClient()
    route._install_route_mocks(monkeypatch, model_client=client)

    chunks = await _run("Work was rough today, I just need to vent.")

    assert "safety.crisis_support" not in _names(chunks)
    instructions = prompt_instruction_text(client.seen_specs[0].prompt)
    assert instructions is not None and "# Care Note" not in instructions


@pytest.mark.asyncio
async def test_ai_notice_precedes_reply_and_names_the_anima(monkeypatch) -> None:
    route._install_route_mocks(monkeypatch)

    chunks = await _run("hello")

    names = _names(chunks)
    assert names[0] == "safety.ai_notice"
    notice = route._event_data(chunks, "safety.ai_notice")
    assert notice == {"type": "safety.ai_notice", "run_id": "run-1", "kind": "start", "anima_name": "Anima"}


@pytest.mark.asyncio
async def test_global_switch_off_removes_notice_card_and_moderation_but_keeps_guardrail(monkeypatch, tmp_path) -> None:
    client = route._RouteModelClient()
    provider = route._model_provider(
        model_provider_id="OpenAIResponsesHTTPAgent:gpt-test", provider_type="OpenAIResponsesHTTPAgent"
    )
    route._install_route_mocks(monkeypatch, model_client=client, model_provider=provider)
    disabled = Settings(
        animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data", companion_safety_enabled=False
    )

    chunks = await _run(CRISIS_MESSAGE, runtime_settings=disabled)

    names = _names(chunks)
    assert "safety.ai_notice" not in names
    assert "safety.crisis_support" not in names
    spec = client.seen_specs[0]
    assert spec.provider_options.moderation_model is None
    instructions = prompt_instruction_text(spec.prompt)
    assert instructions is not None and instructions.endswith(COMPANION_GUARDRAILS.strip())
    assert "# Care Note" not in instructions


@pytest.mark.asyncio
async def test_moderation_flag_shows_card_after_reply_before_completion(monkeypatch) -> None:
    final = ModelClientFinal(
        text=route._direct_structured_response(speech="I'm here with you."),
        usage=Usage(),
        input_moderation=ModelClientModeration(status="result", flagged_categories=("self-harm/intent",)),
    )
    client = route._RouteModelClient(finals=[final])
    provider = route._model_provider(
        model_provider_id="OpenAIResponsesHTTPAgent:gpt-test", provider_type="OpenAIResponsesHTTPAgent"
    )
    route._install_route_mocks(monkeypatch, model_client=client, model_provider=provider)

    chunks = await _run("everything feels pointless and heavy")

    names = _names(chunks)
    assert client.seen_specs[0].provider_options.moderation_model == RESPONSES_MODERATION_MODEL
    assert names.count("safety.crisis_support") == 1
    assert names.index("safety.crisis_support") < names.index("run.completed")
    assert route._event_data(chunks, "safety.crisis_support")["source"] == "moderation"


@pytest.mark.asyncio
async def test_moderation_after_local_detection_does_not_repeat_the_card(monkeypatch) -> None:
    final = ModelClientFinal(
        text=route._direct_structured_response(),
        usage=Usage(),
        input_moderation=ModelClientModeration(status="result", flagged_categories=("self-harm/intent",)),
    )
    client = route._RouteModelClient(finals=[final])
    provider = route._model_provider(
        model_provider_id="OpenAIResponsesHTTPAgent:gpt-test", provider_type="OpenAIResponsesHTTPAgent"
    )
    route._install_route_mocks(monkeypatch, model_client=client, model_provider=provider)

    chunks = await _run(CRISIS_MESSAGE)

    assert _names(chunks).count("safety.crisis_support") == 1
    assert route._event_data(chunks, "safety.crisis_support")["source"] == "local"


@pytest.mark.asyncio
@pytest.mark.parametrize("moderation", [None, ModelClientModeration(status="error")])
async def test_missing_or_errored_moderation_does_not_affect_the_turn(monkeypatch, moderation) -> None:
    final = ModelClientFinal(text=route._direct_structured_response(), usage=Usage(), input_moderation=moderation)
    client = route._RouteModelClient(finals=[final])
    provider = route._model_provider(
        model_provider_id="OpenAIResponsesHTTPAgent:gpt-test", provider_type="OpenAIResponsesHTTPAgent"
    )
    route._install_route_mocks(monkeypatch, model_client=client, model_provider=provider)

    chunks = await _run("hello")

    names = _names(chunks)
    assert "safety.crisis_support" not in names
    assert "error" not in names
    assert names[-1] == "run.completed"


@pytest.mark.asyncio
async def test_crisis_card_still_shows_when_the_provider_fails(monkeypatch) -> None:
    route._install_route_mocks(monkeypatch, model_client=route._RouteModelClient(fail=True))

    chunks = await _run(CRISIS_MESSAGE)

    names = _names(chunks)
    assert names.index("safety.crisis_support") < names.index("error")
    assert names[-1] == "run.completed"


@pytest.mark.asyncio
@pytest.mark.parametrize("dispatch", [{"incognito": True}, {"disable_memory_influence": True}])
async def test_incognito_and_memory_disabled_turns_keep_safety(monkeypatch, dispatch) -> None:
    route._install_route_mocks(monkeypatch, chat_options=dispatch)

    chunks = await _run(CRISIS_MESSAGE, dispatch_options=dispatch)

    names = _names(chunks)
    assert "safety.ai_notice" in names
    assert "safety.crisis_support" in names


# --- Notice state persistence ----------------------------------------------------


def _turn_safety() -> TurnSafety:
    return TurnSafety(
        effective=resolve_companion_safety(OperatorSafetyConfig(), SafetyPreferences()),
        detection=NEGATIVE,
        crisis_region=crisis_resource_table().fallback,
        time_zone=None,
    )


async def test_ai_notice_is_recorded_once_per_day_across_turns(async_session_factory) -> None:
    owner = f"notice-owner-{uuid4()}"
    first = await ai_notice_frame(
        _turn_safety(), session_factory=async_session_factory, user_id=owner, run_id="run-a", anima_name="Annie"
    )
    second = await ai_notice_frame(
        _turn_safety(), session_factory=async_session_factory, user_id=owner, run_id="run-b", anima_name="Caitlyn"
    )
    assert first is not None and '"kind": "start"' in first
    assert second is None
    async with async_session_factory() as session:
        row = await session.get(ORMCompanionSafetyState, owner)
        assert row is not None and row.last_notice_at is not None and row.age_status == "unknown"


async def test_ai_notice_is_shown_when_state_is_unavailable() -> None:
    def broken_factory() -> Any:
        raise RuntimeError("database unavailable")

    frame = await ai_notice_frame(
        _turn_safety(), session_factory=broken_factory, user_id="owner", run_id="run-x", anima_name=None
    )
    assert frame is not None and '"kind": "start"' in frame


@pytest.mark.asyncio
async def test_detector_failure_never_interrupts_chat(monkeypatch) -> None:
    from animama.server.routers.chat import safety as chat_safety

    def broken_detector(_text: str) -> Any:
        raise RuntimeError("detector bug")

    monkeypatch.setattr(chat_safety, "detect_crisis", broken_detector)
    route._install_route_mocks(monkeypatch)

    chunks = await _run(CRISIS_MESSAGE)

    names = _names(chunks)
    assert "safety.crisis_support" not in names
    assert "user.response" in names and names[-1] == "run.completed"


@pytest.mark.asyncio
async def test_crisis_turn_persists_like_any_other_turn(monkeypatch) -> None:
    chats = route._FakeChatManager()
    route._install_route_mocks(monkeypatch, chat_manager=chats)

    await _run(CRISIS_MESSAGE)

    assert chats.record_turn_calls == 1
