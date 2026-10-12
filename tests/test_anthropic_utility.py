"""Utility prompts on Anthropic rows: chat titles and other chats' summaries (plan Phase 7, R7).

``DirectModelPromptRunner`` drives the real ``AnthropicMessagesModelClient``
with a duck-typed fake SDK client (``tests/anthropic_fakes.py``); no key or
network is used.
"""

from __future__ import annotations

from typing import Any

import pytest

from animama.adapters.model_clients import AnthropicMessagesModelClient
from animama.adapters.repositories.sqlalchemy.chat_compaction_repo import SQLAlchemyChatCompactionRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.model_clients import StaticModelClientRegistry
from animama.app.model_clients.credentials import builtin_anthropic_connection, static_credential_resolver
from animama.app.services.chat_compaction_service import ChatCompactionService, ChatCompactionSettings
from animama.app.services.chat_title_generation_service import ChatTitleGenerationService
from animama.app.services.direct_model_prompt_runner import DirectModelPromptRequest, DirectModelPromptRunner
from animama.app.services.model_role_resolver import ModelRoleDefaults, ModelRoleResolver
from animama.domain import ModelProvider, ModelProviderCapabilities
from tests.anthropic_fakes import (
    SENTINEL_KEY,
    FakeAnthropicClient,
    FakeClientFactory,
    message_events,
    text_block,
    thinking_block,
)
from tests.test_chat_compaction_service import _append_visible_messages, _create_chat

ANTHROPIC = "AnthropicMessagesHTTPAgent"
HAIKU = f"{ANTHROPIC}:claude-haiku-5-5"


def _haiku(*, efforts: list[str] | None = None) -> ModelProvider:
    return ModelProvider(
        id=HAIKU,
        provider_type=ANTHROPIC,
        model="claude-haiku-5-5",
        model_label="Claude Haiku 5.5",
        provider_label="Anthropic",
        connection_id="anthropic",
        connection=builtin_anthropic_connection(),
        context_window_tokens=1_000_000,
        max_output_tokens=128_000,
        capabilities=ModelProviderCapabilities(
            supports_tools=True,
            supports_streaming=True,
            supports_reasoning=True,
            supported_reasoning_efforts=(
                efforts if efforts is not None else ["none", "low", "medium", "high", "xhigh", "max"]
            ),
        ),
    )


class _Rows:
    def __init__(self, *rows: ModelProvider) -> None:
        self._rows = {row.id: row for row in rows}

    async def get(self, model_provider_id: str) -> ModelProvider | None:
        return self._rows.get(model_provider_id)


class _NoPreferences:
    async def get(self, user_id: str) -> None:
        return None


def _runner(client: FakeAnthropicClient, row: ModelProvider | None = None) -> DirectModelPromptRunner:
    """A runner whose Utility role resolves to Claude Haiku 5.5 (through the chat default)."""

    row = row or _haiku()
    registry = StaticModelClientRegistry()
    registry.register(
        ANTHROPIC,
        AnthropicMessagesModelClient(
            credential_resolver=static_credential_resolver({"ANTHROPIC_API_KEY": SENTINEL_KEY}),
            client_factory=FakeClientFactory(client),
        ),
    )
    resolver = ModelRoleResolver(
        model_providers=_Rows(row),  # type: ignore[arg-type]
        user_settings=_NoPreferences(),  # type: ignore[arg-type]
        defaults=ModelRoleDefaults(chat=row.id),
        owner_roles_enabled=True,
    )
    return DirectModelPromptRunner(registry=registry, role_resolver=resolver)


def _reply(text: str) -> list[dict[str, Any]]:
    return message_events(thinking_block(), text_block(text), input_tokens=120, output_tokens=12)


def _assert_utility_request(params: dict[str, Any], *, effort: str | None = "low") -> None:
    """A Utility request: no server compaction, no tools, no structured output."""

    assert "context_management" not in params
    assert "betas" not in params
    assert "tools" not in params and "tool_choice" not in params
    assert "format" not in params.get("output_config", {})
    assert params.get("output_config", {}).get("effort") == effort
    assert "thinking" not in params
    roles = [message["role"] for message in params["messages"]]
    assert roles == ["user"]


async def test_a_new_chat_gets_a_title_from_haiku_at_low_effort_without_compaction() -> None:
    client = FakeAnthropicClient([_reply("Garden Planning For Spring")])
    service = ChatTitleGenerationService(model_runner=_runner(client))

    result = await service.generate_title(
        anima_id="anima-1",
        user_id="owner",
        chat_id="chat-1",
        source_run_id="run-1",
        user_message="Can you help me plan what to plant in my garden this spring?",
    )

    assert result.reason == "generated"
    assert result.title == "Garden Planning For Spring"
    assert result.model_provider == ANTHROPIC
    [params] = client.requests
    # The title prompt asks for "minimal", which Anthropic does not offer: the Utility default applies.
    _assert_utility_request(params)
    assert params["system"][0]["text"] == "Generate concise chat titles. Return only the title."
    assert "garden this spring" in params["messages"][0]["content"][0]["text"]


@pytest.mark.parametrize(
    ("requested", "efforts", "expected"),
    [
        ("high", None, "high"),  # an explicit supported effort always wins
        (None, ["medium", "high"], None),  # no low on the row: send no effort
    ],
)
async def test_utility_effort_follows_an_explicit_choice_and_the_row(
    requested: str | None, efforts: list[str] | None, expected: str | None
) -> None:
    client = FakeAnthropicClient([_reply("Summary")])
    runner = _runner(client, _haiku(efforts=efforts))

    await runner.run_prompt(
        DirectModelPromptRequest(
            anima_id="anima-1",
            user_id="owner",
            chat_id="chat-1",
            prompt="Summarize.",
            task="test",
            instructions="Summarize only.",
            request_options={"reasoning_effort": requested} if requested else {},
        )
    )

    _assert_utility_request(client.requests[0], effort=expected)


async def test_another_chats_compaction_summary_runs_on_haiku_without_server_compaction(async_session) -> None:
    await _create_chat(async_session, anima_id="anima-ant-util", chat_id="chat-ant-util", active_context_tokens=50)
    await _append_visible_messages(async_session, chat_id="chat-ant-util", count=10, prefix="garden")
    client = FakeAnthropicClient([_reply("The user is planning a spring vegetable garden.")])
    service = ChatCompactionService(
        chats=SQLAlchemyChatRepository(async_session),
        messages=SQLAlchemyChatMessageRepository(async_session),
        compactions=SQLAlchemyChatCompactionRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
        model_runner=_runner(client),
        settings=ChatCompactionSettings(threshold_tokens=1, recent_message_min_count=2),
    )

    result = await service.maybe_compact_chat(chat_id="chat-ant-util", user_id="user-1", anima_id="anima-ant-util")

    assert result.compacted is True
    assert result.compaction is not None
    assert result.compaction.summary_text == "The user is planning a spring vegetable garden."
    [params] = client.requests
    _assert_utility_request(params)
    prompt_text = params["messages"][0]["content"][0]["text"]
    assert "garden-0" in prompt_text
