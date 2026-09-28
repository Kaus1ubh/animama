from __future__ import annotations

import pytest
from sqlalchemy import select

from animama.adapters.repositories.sqlalchemy.chat_compaction_repo import SQLAlchemyChatCompactionRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.domain.chat import Chat, ChatMessage, MessageRole
from animama.domain.chat_compaction import STATUS_ACTIVE, STATUS_FAILED, STATUS_SUPERSEDED, ChatCompaction
from animama.domain.usage import Usage, UsageInputDetails, UsageOutputDetails
from animama.orm import ORMAnima, ORMChatCompaction


async def _create_chat(async_session, *, anima_id: str, chat_id: str, user_id: str = "user-1") -> None:
    async_session.add(ORMAnima(id=anima_id, user_id=user_id))
    await async_session.flush()
    await SQLAlchemyChatRepository(async_session).create(Chat(id=chat_id, anima_id=anima_id, user_id=user_id))
    await async_session.commit()


async def _append_message(
    async_session,
    *,
    chat_id: str,
    run_id: str = "run-1",
    role: MessageRole = MessageRole.USER,
    content: str = "hello",
    turn: int | None = None,
) -> ChatMessage:
    return await SQLAlchemyChatMessageRepository(async_session).append(
        ChatMessage(
            id=None,
            chat_id=chat_id,
            run_id=run_id,
            message_type="message",
            role=role,
            content=content,
            data=None,
            usage=None,
            turn=turn,
            created_at=None,
            internal=False,
        )
    )


def _compaction(
    *,
    chat_id: str,
    anima_id: str,
    user_id: str = "user-1",
    summary_text: str = "Earlier summary.",
    status: str = STATUS_ACTIVE,
    start_turn: int | None = None,
    end_turn: int | None = None,
    usage: Usage | None = None,
) -> ChatCompaction:
    return ChatCompaction(
        id=None,
        chat_id=chat_id,
        user_id=user_id,
        anima_id=anima_id,
        status=status,
        summary_text=summary_text,
        start_turn=start_turn,
        end_turn=end_turn,
        source_message_count=2,
        model_provider="openai",
        model="gpt-6-luna",
        prompt_version="chat-compaction-v1",
        usage=usage,
        metadata={"threshold": 100},
    )


@pytest.mark.asyncio
async def test_chat_compaction_repo_create_and_get_active_round_trips_fields(async_session):
    anima_id = "anima-chat-compaction-create"
    chat_id = "chat-compaction-create"
    await _create_chat(async_session, anima_id=anima_id, chat_id=chat_id)
    first_message = await _append_message(async_session, chat_id=chat_id, content="old user message", turn=1)
    second_message = await _append_message(
        async_session,
        chat_id=chat_id,
        role=MessageRole.ASSISTANT,
        content="old assistant message",
        turn=2,
    )
    await async_session.commit()

    repo = SQLAlchemyChatCompactionRepository(async_session)
    created = await repo.create(
        _compaction(
            chat_id=chat_id,
            anima_id=anima_id,
            start_turn=first_message.turn,
            end_turn=second_message.turn,
            usage=Usage(
                input_tokens=100,
                output_tokens=25,
                total_tokens=125,
                input_tokens_details=UsageInputDetails(cached_tokens=10),
                output_tokens_details=UsageOutputDetails(reasoning_tokens=5),
            ),
        )
    )
    await async_session.commit()

    active = await repo.get_active(chat_id)

    assert created.id is not None
    assert created.id.startswith("cmp-")
    assert active is not None
    assert active.id == created.id
    assert active.status == STATUS_ACTIVE
    assert active.summary_text == "Earlier summary."
    assert active.start_turn == first_message.turn
    assert active.end_turn == second_message.turn
    assert active.source_message_count == 2
    assert active.model_provider == "openai"
    assert active.model == "gpt-6-luna"
    assert active.prompt_version == "chat-compaction-v1"
    assert active.metadata == {"threshold": 100}
    assert active.usage is not None
    assert active.usage.input_tokens == 100
    assert active.usage.output_tokens == 25
    assert active.usage.total_tokens == 125
    assert active.usage.input_tokens_details.cached_tokens == 10
    assert active.usage.output_tokens_details.reasoning_tokens == 5


@pytest.mark.asyncio
async def test_chat_message_repo_visible_history_readers_keep_distinct_semantics(async_session):
    anima_id = "anima-chat-compaction-source-history"
    chat_id = "chat-compaction-source-history"
    await _create_chat(async_session, anima_id=anima_id, chat_id=chat_id)
    messages = SQLAlchemyChatMessageRepository(async_session)

    before = await _append_message(async_session, chat_id=chat_id, content="before", turn=1)
    first = await _append_message(async_session, chat_id=chat_id, content="first after", turn=2)
    await _append_message(
        async_session,
        chat_id=chat_id,
        role=MessageRole.SYSTEM,
        content="system should be hidden",
        turn=3,
    )
    await messages.append(
        ChatMessage(
            id=None,
            chat_id=chat_id,
            run_id="run-1",
            message_type="message",
            role=MessageRole.ASSISTANT,
            content="internal should be hidden",
            data=None,
            usage=None,
            turn=4,
            created_at=None,
            internal=True,
        )
    )
    await messages.append(
        ChatMessage(
            id=None,
            chat_id=chat_id,
            run_id="run-1",
            message_type="message",
            role=MessageRole.ASSISTANT,
            content="second after",
            data=None,
            usage=None,
            turn=5,
            created_at=None,
            internal=False,
        )
    )
    await async_session.commit()

    after_boundary = await messages.visible_history_since(chat_id, after_turn=before.turn)
    limited = await messages.visible_history_since(chat_id, after_turn=None, limit=2)
    recent_after_boundary = await messages.recent_visible_history(chat_id, after_turn=before.turn, limit=10)
    recent_limited = await messages.recent_visible_history(chat_id, after_turn=None, limit=2)

    assert [message.content for message in after_boundary] == ["first after", "second after"]
    assert [message.content for message in limited] == ["before", "first after"]
    assert [message.content for message in recent_after_boundary] == ["first after", "second after"]
    assert [message.content for message in recent_limited] == ["first after", "second after"]
    assert first.turn == 2


@pytest.mark.asyncio
async def test_chat_compaction_repo_activate_new_supersedes_existing_active(async_session):
    anima_id = "anima-chat-compaction-activate"
    chat_id = "chat-compaction-activate"
    await _create_chat(async_session, anima_id=anima_id, chat_id=chat_id)
    repo = SQLAlchemyChatCompactionRepository(async_session)

    first = await repo.activate_new(_compaction(chat_id=chat_id, anima_id=anima_id, summary_text="First summary."))
    await async_session.commit()
    second = await repo.activate_new(_compaction(chat_id=chat_id, anima_id=anima_id, summary_text="Second summary."))
    await async_session.commit()

    active = await repo.get_active(chat_id)
    rows = await repo.list_for_chat(chat_id)
    first_row = next(row for row in rows if row.id == first.id)

    assert active is not None
    assert active.id == second.id
    assert active.summary_text == "Second summary."
    assert first_row.status == STATUS_SUPERSEDED
    assert first_row.superseded_at is not None
    assert sum(1 for row in rows if row.status == STATUS_ACTIVE) == 1


@pytest.mark.asyncio
async def test_chat_compaction_repo_failed_rows_are_not_active(async_session):
    anima_id = "anima-chat-compaction-failed"
    chat_id = "chat-compaction-failed"
    await _create_chat(async_session, anima_id=anima_id, chat_id=chat_id)
    repo = SQLAlchemyChatCompactionRepository(async_session)

    failed = await repo.create(_compaction(chat_id=chat_id, anima_id=anima_id, status=STATUS_FAILED))
    await async_session.commit()

    assert failed.status == STATUS_FAILED
    assert await repo.get_active(chat_id) is None


@pytest.mark.asyncio
async def test_chat_compaction_repo_list_for_chat_is_scoped_and_newest_first(async_session):
    anima_a = "anima-chat-compaction-list-a"
    chat_a = "chat-compaction-list-a"
    anima_b = "anima-chat-compaction-list-b"
    chat_b = "chat-compaction-list-b"
    await _create_chat(async_session, anima_id=anima_a, chat_id=chat_a)
    await _create_chat(async_session, anima_id=anima_b, chat_id=chat_b)
    repo = SQLAlchemyChatCompactionRepository(async_session)

    older = await repo.create(_compaction(chat_id=chat_a, anima_id=anima_a, status=STATUS_SUPERSEDED))
    await async_session.commit()
    newer = await repo.activate_new(_compaction(chat_id=chat_a, anima_id=anima_a))
    other_chat = await repo.activate_new(_compaction(chat_id=chat_b, anima_id=anima_b))
    await async_session.commit()

    rows = await repo.list_for_chat(chat_a)

    assert [row.id for row in rows] == [newer.id, older.id]
    assert other_chat.id not in {row.id for row in rows}


@pytest.mark.asyncio
async def test_chat_compaction_rows_cascade_when_chat_is_deleted(async_session):
    anima_id = "anima-chat-compaction-cascade"
    chat_id = "chat-compaction-cascade"
    await _create_chat(async_session, anima_id=anima_id, chat_id=chat_id)
    repo = SQLAlchemyChatCompactionRepository(async_session)
    created = await repo.activate_new(_compaction(chat_id=chat_id, anima_id=anima_id))
    await async_session.commit()

    deleted = await SQLAlchemyChatRepository(async_session).delete(chat_id)
    await async_session.commit()
    result = await async_session.execute(select(ORMChatCompaction).where(ORMChatCompaction.id == created.id))

    assert deleted is True
    assert result.scalar_one_or_none() is None
