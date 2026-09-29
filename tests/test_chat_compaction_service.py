from __future__ import annotations

# These injection casts adapt intentionally partial test doubles to the production ports.
from typing import Any, cast

import pytest

from animama.adapters.repositories.sqlalchemy.chat_compaction_repo import SQLAlchemyChatCompactionRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.chat_compaction_service import ChatCompactionService, ChatCompactionSettings
from animama.app.services.direct_model_prompt_runner import DirectModelPromptResult, DirectModelPromptRunner
from animama.domain import ModelProvider
from animama.domain.chat import Chat, ChatMessage, MessageRole
from animama.domain.chat_compaction import ChatCompaction
from animama.domain.usage import Usage, UsageInputDetails, UsageOutputDetails
from animama.orm import ORMAnima


class _FakeModelRunner:
    def __init__(
        self,
        *,
        summary: str = "Compacted continuity summary.",
        usage: Usage | None = None,
        role_model: ModelProvider | None = None,
    ) -> None:
        self.summary = summary
        self.usage = usage
        self.role_model = role_model
        self.calls: list[Any] = []

    async def model_provider_for_role(self, user_id, role="utility"):
        return self.role_model

    async def run_prompt(self, request):
        self.calls.append(request)
        return DirectModelPromptResult(
            text=self.summary,
            usage=self.usage,
            model_provider=ModelProvider(
                id="OpenAIResponsesHTTPAgent:gpt-6-luna",
                provider_type="OpenAIResponsesHTTPAgent",
                model="gpt-6-luna",
                model_label="gpt-6-luna",
                provider_label="OpenAI",
                active=True,
            ),
        )


async def _create_chat(
    async_session,
    *,
    anima_id: str,
    chat_id: str,
    user_id: str = "user-1",
    active_context_tokens: int = 0,
) -> None:
    async_session.add(ORMAnima(id=anima_id, user_id=user_id))
    await async_session.flush()
    await SQLAlchemyChatRepository(async_session).create(
        Chat(id=chat_id, anima_id=anima_id, user_id=user_id, active_context_tokens=active_context_tokens)
    )
    await async_session.commit()


async def _append_visible_messages(
    async_session,
    *,
    chat_id: str,
    count: int,
    prefix: str = "message",
) -> list[ChatMessage]:
    repo = SQLAlchemyChatMessageRepository(async_session)
    rows: list[ChatMessage] = []
    for index in range(count):
        role = MessageRole.USER if index % 2 == 0 else MessageRole.ASSISTANT
        rows.append(
            await repo.append(
                ChatMessage(
                    id=None,
                    chat_id=chat_id,
                    run_id=f"run-{index}",
                    message_type="message",
                    role=role,
                    content=f"{prefix}-{index}",
                    data=None,
                    usage=None,
                    turn=index + 1,
                    created_at=None,
                    internal=False,
                )
            )
        )
    await async_session.commit()
    return rows


def _service(
    async_session,
    *,
    model_runner: _FakeModelRunner,
    settings: ChatCompactionSettings,
) -> ChatCompactionService:
    return ChatCompactionService(
        chats=SQLAlchemyChatRepository(async_session),
        messages=SQLAlchemyChatMessageRepository(async_session),
        compactions=SQLAlchemyChatCompactionRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
        model_runner=cast(DirectModelPromptRunner, model_runner),
        settings=settings,
    )


def _trigger_settings(**overrides: Any) -> ChatCompactionSettings:
    values: dict[str, Any] = {
        "threshold_tokens": 1,
        "recent_message_min_count": 2,
    }
    values.update(overrides)
    return ChatCompactionSettings(**values)


@pytest.mark.asyncio
async def test_chat_compaction_service_disabled_is_noop(async_session):
    await _create_chat(
        async_session,
        anima_id="anima-cmp-disabled",
        chat_id="chat-cmp-disabled",
        active_context_tokens=10,
    )
    await _append_visible_messages(async_session, chat_id="chat-cmp-disabled", count=6)
    model_runner = _FakeModelRunner()
    service = _service(
        async_session,
        model_runner=model_runner,
        settings=_trigger_settings(enabled=False),
    )

    result = await service.maybe_compact_chat(
        chat_id="chat-cmp-disabled",
        user_id="user-1",
        anima_id="anima-cmp-disabled",
    )

    assert result.compacted is False
    assert result.reason == "disabled"
    assert model_runner.calls == []


@pytest.mark.asyncio
async def test_chat_compaction_service_below_threshold_is_noop(async_session):
    await _create_chat(
        async_session,
        anima_id="anima-cmp-below",
        chat_id="chat-cmp-below",
        active_context_tokens=12,
    )
    await _append_visible_messages(async_session, chat_id="chat-cmp-below", count=6)
    model_runner = _FakeModelRunner()
    service = _service(
        async_session,
        model_runner=model_runner,
        settings=_trigger_settings(threshold_tokens=1_000_000),
    )

    result = await service.maybe_compact_chat(
        chat_id="chat-cmp-below",
        user_id="user-1",
        anima_id="anima-cmp-below",
    )

    assert result.compacted is False
    assert result.reason == "below_threshold"
    assert result.trigger_active_context_tokens == 12
    assert model_runner.calls == []


@pytest.mark.asyncio
async def test_chat_compaction_service_creates_active_summary_with_usage_and_boundaries(async_session):
    anima_id = "anima-cmp-create"
    chat_id = "chat-cmp-create"
    await _create_chat(async_session, anima_id=anima_id, chat_id=chat_id, active_context_tokens=10)
    rows = await _append_visible_messages(async_session, chat_id=chat_id, count=6, prefix="turn")
    usage = Usage(
        input_tokens=100,
        output_tokens=20,
        total_tokens=120,
        input_tokens_details=UsageInputDetails(cached_tokens=10),
        output_tokens_details=UsageOutputDetails(reasoning_tokens=5),
    )
    model_runner = _FakeModelRunner(summary="Summary with continuity.", usage=usage)
    service = _service(async_session, model_runner=model_runner, settings=_trigger_settings())

    result = await service.maybe_compact_chat(
        chat_id=chat_id,
        user_id="user-1",
        anima_id=anima_id,
    )
    active = await SQLAlchemyChatCompactionRepository(async_session).get_active(chat_id)
    stored_chat = await SQLAlchemyChatRepository(async_session).get(chat_id)
    prompt = model_runner.calls[0].prompt

    assert result.compacted is True
    assert result.reason == "compacted"
    assert active is not None
    assert active.summary_text == "Summary with continuity."
    assert active.start_turn == rows[0].turn
    assert active.end_turn == rows[3].turn
    assert active.source_message_count == 4
    assert result.trigger_active_context_tokens == 10
    assert active.usage is not None
    assert active.usage.input_tokens == 100
    assert active.usage.output_tokens == 20
    assert active.usage.total_tokens == 120
    assert active.usage.input_tokens_details.cached_tokens == 10
    assert active.usage.output_tokens_details.reasoning_tokens == 5
    assert active.metadata["trigger_active_context_tokens"] == 10
    assert active.metadata["preserved_message_count"] == 2
    assert "turn-0" in prompt
    assert "turn-5" in prompt
    assert stored_chat is not None
    assert stored_chat.usage.total_tokens == 0
    assert stored_chat.active_context_tokens == 10


@pytest.mark.asyncio
async def test_chat_compaction_service_folds_previous_active_summary(async_session):
    anima_id = "anima-cmp-fold"
    chat_id = "chat-cmp-fold"
    await _create_chat(async_session, anima_id=anima_id, chat_id=chat_id, active_context_tokens=10)
    rows = await _append_visible_messages(async_session, chat_id=chat_id, count=6, prefix="fold")
    compactions = SQLAlchemyChatCompactionRepository(async_session)
    previous = await compactions.activate_new(
        ChatCompaction(
            id=None,
            chat_id=chat_id,
            user_id="user-1",
            anima_id=anima_id,
            summary_text="Previous summary.",
            start_turn=rows[0].turn,
            end_turn=rows[1].turn,
        )
    )
    await async_session.commit()
    model_runner = _FakeModelRunner(summary="Folded summary.")
    service = _service(async_session, model_runner=model_runner, settings=_trigger_settings())

    result = await service.maybe_compact_chat(
        chat_id=chat_id,
        user_id="user-1",
        anima_id=anima_id,
    )
    rows_after = await compactions.list_for_chat(chat_id)
    active = await compactions.get_active(chat_id)
    previous_row = next(row for row in rows_after if row.id == previous.id)
    prompt = model_runner.calls[0].prompt

    assert result.compacted is True
    assert active is not None
    assert active.summary_text == "Folded summary."
    assert active.start_turn == rows[0].turn
    assert active.end_turn == rows[3].turn
    assert active.metadata["previous_compaction_id"] == previous.id
    assert previous_row.status == "superseded"
    assert "Previous summary." in prompt
    assert "fold-2" in prompt
    assert "fold-5" in prompt


@pytest.mark.asyncio
async def test_chat_compaction_service_no_eligible_messages_is_noop(async_session):
    await _create_chat(
        async_session,
        anima_id="anima-cmp-none",
        chat_id="chat-cmp-none",
        active_context_tokens=10,
    )
    await _append_visible_messages(async_session, chat_id="chat-cmp-none", count=2)
    model_runner = _FakeModelRunner()
    service = _service(
        async_session,
        model_runner=model_runner,
        settings=_trigger_settings(recent_message_min_count=8),
    )

    result = await service.maybe_compact_chat(
        chat_id="chat-cmp-none",
        user_id="user-1",
        anima_id="anima-cmp-none",
    )

    assert result.compacted is False
    assert result.reason == "no_eligible_messages"
    assert model_runner.calls == []


@pytest.mark.asyncio
async def test_chat_compaction_service_empty_provider_summary_is_noop(async_session):
    anima_id = "anima-cmp-empty"
    chat_id = "chat-cmp-empty"
    await _create_chat(async_session, anima_id=anima_id, chat_id=chat_id, active_context_tokens=10)
    await _append_visible_messages(async_session, chat_id=chat_id, count=6)
    model_runner = _FakeModelRunner(summary="   ")
    service = _service(async_session, model_runner=model_runner, settings=_trigger_settings())

    result = await service.maybe_compact_chat(
        chat_id=chat_id,
        user_id="user-1",
        anima_id=anima_id,
    )
    active = await SQLAlchemyChatCompactionRepository(async_session).get_active(chat_id)

    assert result.compacted is False
    assert result.reason == "empty_summary"
    assert active is None
    assert len(model_runner.calls) == 1


@pytest.mark.asyncio
async def test_chat_compaction_service_threshold_override_lowers_the_threshold(async_session):
    await _create_chat(async_session, anima_id="anima-cmp-low", chat_id="chat-cmp-low", active_context_tokens=500)
    await _append_visible_messages(async_session, chat_id="chat-cmp-low", count=6)
    model_runner = _FakeModelRunner()
    service = _service(async_session, model_runner=model_runner, settings=_trigger_settings(threshold_tokens=6000))

    result = await service.maybe_compact_chat(
        chat_id="chat-cmp-low", user_id="user-1", anima_id="anima-cmp-low", threshold_tokens=400
    )

    assert result.compacted is True


@pytest.mark.asyncio
async def test_chat_compaction_service_never_separates_a_message_from_its_reply(async_session):
    await _create_chat(async_session, anima_id="anima-cmp-pair", chat_id="chat-cmp-pair", active_context_tokens=10)
    rows = await _append_visible_messages(async_session, chat_id="chat-cmp-pair", count=6)
    service = _service(
        async_session, model_runner=_FakeModelRunner(), settings=_trigger_settings(recent_message_min_count=3)
    )

    await service.maybe_compact_chat(chat_id="chat-cmp-pair", user_id="user-1", anima_id="anima-cmp-pair")
    active = await SQLAlchemyChatCompactionRepository(async_session).get_active("chat-cmp-pair")

    # Keeping three would start at an assistant reply; its user message is kept too.
    assert active is not None
    assert active.end_turn == rows[1].turn
    assert active.metadata["preserved_message_count"] == 4


@pytest.mark.asyncio
async def test_chat_compaction_service_compacts_for_a_token_budget_regardless_of_threshold(async_session):
    await _create_chat(async_session, anima_id="anima-cmp-budget", chat_id="chat-cmp-budget", active_context_tokens=0)
    rows = await _append_visible_messages(async_session, chat_id="chat-cmp-budget", count=8, prefix="x" * 40)
    service = _service(
        async_session, model_runner=_FakeModelRunner(), settings=_trigger_settings(threshold_tokens=1_000_000)
    )

    # Each message is about 11 tokens; 25 tokens keeps the last two messages (one turn).
    result = await service.compact_for_budget(
        chat_id="chat-cmp-budget", user_id="user-1", anima_id="anima-cmp-budget", keep_recent_tokens=25
    )

    assert result.compacted is True
    assert result.compaction is not None
    assert result.compaction.end_turn == rows[5].turn
    assert result.compaction.metadata["preserved_message_count"] == 2
    assert result.compaction.metadata["keep_recent_tokens"] == 25


@pytest.mark.asyncio
async def test_chat_compaction_service_bounds_its_input_to_the_compaction_model_window(async_session):
    await _create_chat(async_session, anima_id="anima-cmp-window", chat_id="chat-cmp-window", active_context_tokens=10)
    await _append_visible_messages(async_session, chat_id="chat-cmp-window", count=40, prefix="y" * 400)
    small_model = ModelProvider(
        id="owner:small",
        provider_type="OpenAIHTTPAgent",
        model="small",
        model_label="small",
        provider_label="Local",
        active=True,
        context_window_tokens=2048,
    )
    model_runner = _FakeModelRunner(role_model=small_model)
    service = _service(async_session, model_runner=model_runner, settings=_trigger_settings())

    result = await service.maybe_compact_chat(chat_id="chat-cmp-window", user_id="user-1", anima_id="anima-cmp-window")

    prompt = model_runner.calls[0].prompt
    assert result.compacted is True
    assert result.compaction is not None
    assert result.compaction.source_message_count == 38
    assert result.compaction.metadata["omitted_from_summary_count"] > 0
    # The newest compacted message is summarized; the oldest is left out.
    assert f"{'y' * 400}-37" in prompt
    assert f"{'y' * 400}-0" not in prompt
