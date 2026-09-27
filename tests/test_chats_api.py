from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import CheckConstraint, ForeignKeyConstraint

from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services import ModelProviderCatalogService
from animama.domain.chat import Chat, MessageRole
from animama.domain.request_principal import RequestPrincipal
from animama.orm import ORMAnima, ORMChat, ORMChatMessage
from animama.orm.base import Base
from animama.server.routers import chats as chats_router, router as api_router
from animama.server.schemas.chat_history import PyChatCreate, PyChatSearchRequest, PyChatUpdate


def _user(user_id: str) -> RequestPrincipal:
    return RequestPrincipal(id=user_id)


async def _create_anima(
    session,
    *,
    anima_id: str,
    user_id: str,
    profile_picture_url: str | None = None,
) -> None:
    session.add(
        ORMAnima(
            id=anima_id,
            user_id=user_id,
            profile_picture_url=profile_picture_url,
        )
    )
    await session.commit()


async def _create_chat(
    session,
    *,
    chat_id: str,
    anima_id: str,
    user_id: str,
    title: str | None = None,
) -> None:
    session.add(ORMChat(id=chat_id, anima_id=anima_id, user_id=user_id, title=title, metadata_={}))
    await session.commit()


async def _sync_model_catalog(session) -> None:
    await ModelProviderCatalogService(
        model_providers=SQLAlchemyModelProviderRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    ).sync_from_registry()


def test_chat_routes_are_mounted_and_conversation_routes_are_absent() -> None:
    paths = {getattr(route, "path", None) for route in api_router.routes}

    assert "/v1/chats" in paths
    assert "/v1/chats/search" in paths
    assert "/v1/chats/{chat_id}" in paths
    assert "/v1/chats/{chat_id}/messages" in paths
    assert "/v1/conversations" not in paths
    assert "/v1/conversations/{conversation_id}" not in paths


def test_fresh_metadata_uses_chat_tables_without_legacy_session_tables() -> None:
    tables = set(Base.metadata.tables)
    chat_messages = Base.metadata.tables["chat_messages"]

    assert "chats" in tables
    assert "chat_messages" in tables
    chats = Base.metadata.tables["chats"]
    assert "openai_previous_response_id" in Base.metadata.tables["chats"].c
    assert "model_client" not in chats.c
    assert "api_standard" in chats.c
    assert "last_model_client" in chats.c
    assert "last_model_id" in chats.c
    assert chats.c.api_standard.nullable
    assert chats.c.last_model_client.nullable
    assert chats.c.last_model_id.nullable
    assert "conversations" not in tables
    assert "agent_sessions" not in tables
    assert "agent_messages" not in tables
    assert "search_vector" in chat_messages.c
    assert "model" in chat_messages.c
    assert "model_provider" in chat_messages.c
    assert chat_messages.c.model.nullable
    assert chat_messages.c.model_provider.nullable
    assert chat_messages.c.search_vector.computed is not None
    search_vector_sql = str(chat_messages.c.search_vector.computed.sqltext)
    assert "to_tsvector" in search_vector_sql
    assert "||" in search_vector_sql
    assert "{structured,speech}" in search_vector_sql
    assert "{structured,display}" in search_vector_sql

    foreign_keys = [
        constraint for constraint in chat_messages.constraints if isinstance(constraint, ForeignKeyConstraint)
    ]
    # Message model columns are a snapshot: two connections may serve the same
    # model slug and history outlives catalog rows, so they are not a foreign key.
    assert not any(
        {element.column.table.name for element in constraint.elements} == {"model_providers"}
        for constraint in foreign_keys
    )
    chat_check_sql = {
        str(constraint.sqltext) for constraint in chats.constraints if isinstance(constraint, CheckConstraint)
    }
    assert (
        "last_model_client IS NULL OR last_model_client IN ('openai_chat_completions', 'openai_responses')"
        in chat_check_sql
    )
    assert "api_standard IS NULL OR api_standard IN ('chat_completions', 'responses')" in chat_check_sql
    index_columns = {str(index.name): [column.name for column in index.columns] for index in chat_messages.indexes}
    assert index_columns["idx_chat_messages_model_provider"] == ["model_provider", "model"]
    assert index_columns["idx_chat_messages_chat_model_provider"] == ["chat_id", "model_provider", "model"]

    fts_index = next(index for index in chat_messages.indexes if index.name == "ix_chat_messages_content_fts")
    fts_indexed_columns = {column.name for column in fts_index.columns}
    assert fts_indexed_columns == {"search_vector"}
    fts_where = str(fts_index.dialect_options["postgresql"]["where"])
    assert "internal IS false" in fts_where
    assert "role IN ('user', 'assistant')" in fts_where
    assert "content IS NOT NULL" in fts_where


@pytest.mark.asyncio
async def test_create_chat_for_owned_anima_succeeds(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=anima_id, user_id=owner_id)

    response = await chats_router.create_chat(
        PyChatCreate(anima_id=anima_id, title="New chat", metadata={"topic": "test"}),
        user=_user(owner_id),
        session=async_session,
    )

    assert response.id.startswith("chat-")
    assert response.anima_id == anima_id
    assert response.title == "New chat"
    assert response.api_standard is None
    assert response.last_model_client is None
    assert response.last_model_id is None
    assert response.metadata == {"topic": "test"}
    assert response.active_context_tokens == 0
    assert "model_client" not in response.model_dump()
    assert response.model_dump()["api_standard"] is None
    assert response.model_dump()["last_model_client"] is None
    assert response.model_dump()["last_model_id"] is None
    assert response.model_dump()["last_model_provider_id"] is None


@pytest.mark.asyncio
async def test_chat_repository_round_trips_api_standard_fields(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    chat_id = f"chat-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=anima_id, user_id=owner_id)
    repo = SQLAlchemyChatRepository(async_session)

    created = await repo.create(
        Chat(
            id=chat_id,
            anima_id=anima_id,
            user_id=owner_id,
            api_standard="responses",
            last_model_client="openai_responses",
            last_model_id="gpt-5-responses",
            last_model_provider_id="owner:gpt-5-responses",
        )
    )
    fetched = await repo.get(chat_id)

    assert created.api_standard == "responses"
    assert created.last_model_client == "openai_responses"
    assert created.last_model_id == "gpt-5-responses"
    assert fetched is not None
    assert fetched.api_standard == "responses"
    assert fetched.last_model_client == "openai_responses"
    assert fetched.last_model_id == "gpt-5-responses"
    assert fetched.last_model_provider_id == "owner:gpt-5-responses"

    updated = await repo.update(
        Chat(
            id=chat_id,
            anima_id=anima_id,
            user_id=owner_id,
            title="Updated standard",
            api_standard="chat_completions",
            last_model_client="openai_chat_completions",
            last_model_id="gpt-5-chat",
        )
    )

    assert updated.title == "Updated standard"
    assert updated.api_standard == "chat_completions"
    assert updated.last_model_client == "openai_chat_completions"
    assert updated.last_model_id == "gpt-5-chat"


@pytest.mark.asyncio
async def test_chat_repository_last_model_pair_requires_both_fields(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    chat_id = f"chat-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=anima_id, user_id=owner_id)
    await _create_chat(async_session, chat_id=chat_id, anima_id=anima_id, user_id=owner_id)
    repo = SQLAlchemyChatRepository(async_session)

    with pytest.raises(ValueError, match="last_model_client and last_model_id"):
        await repo.reserve_message_turns_and_add_usage(
            chat_id,
            message_count=1,
            last_model_client="openai_chat_completions",
        )

    with pytest.raises(ValueError, match="last_model_client and last_model_id"):
        await repo.reserve_message_turns_and_add_usage(
            chat_id,
            message_count=1,
            last_model_id="gpt-5-chat",
        )


@pytest.mark.asyncio
async def test_create_chat_missing_or_foreign_anima_returns_404(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    foreign_id = f"user-{uuid.uuid4()}"
    foreign_anima_id = f"anima-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=foreign_anima_id, user_id=foreign_id)

    with pytest.raises(HTTPException) as missing:
        await chats_router.create_chat(
            PyChatCreate(anima_id=f"anima-{uuid.uuid4()}"),
            user=_user(owner_id),
            session=async_session,
        )
    assert missing.value.status_code == 404

    with pytest.raises(HTTPException) as foreign:
        await chats_router.create_chat(
            PyChatCreate(anima_id=foreign_anima_id),
            user=_user(owner_id),
            session=async_session,
        )
    assert foreign.value.status_code == 404


@pytest.mark.asyncio
async def test_list_chats_returns_only_current_user_chats(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    other_id = f"user-{uuid.uuid4()}"
    owner_anima_id = f"anima-{uuid.uuid4()}"
    other_anima_id = f"anima-{uuid.uuid4()}"
    owner_chat_id = f"chat-{uuid.uuid4()}"
    other_chat_id = f"chat-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=owner_anima_id, user_id=owner_id)
    await _create_anima(async_session, anima_id=other_anima_id, user_id=other_id)
    await _create_chat(async_session, chat_id=owner_chat_id, anima_id=owner_anima_id, user_id=owner_id)
    await _create_chat(async_session, chat_id=other_chat_id, anima_id=other_anima_id, user_id=other_id)

    response = await chats_router.list_chats(user=_user(owner_id), session=async_session)

    chats_by_id = {chat.id: chat for chat in response}
    assert owner_chat_id in chats_by_id
    assert other_chat_id not in chats_by_id
    assert "model_client" not in chats_by_id[owner_chat_id].model_dump()
    assert chats_by_id[owner_chat_id].api_standard is None
    assert chats_by_id[owner_chat_id].last_model_client is None
    assert chats_by_id[owner_chat_id].last_model_id is None


@pytest.mark.asyncio
async def test_get_update_delete_enforce_chat_ownership(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    other_id = f"user-{uuid.uuid4()}"
    owner_anima_id = f"anima-{uuid.uuid4()}"
    other_anima_id = f"anima-{uuid.uuid4()}"
    owner_chat_id = f"chat-{uuid.uuid4()}"
    other_chat_id = f"chat-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=owner_anima_id, user_id=owner_id)
    await _create_anima(async_session, anima_id=other_anima_id, user_id=other_id)
    await _create_chat(
        async_session,
        chat_id=owner_chat_id,
        anima_id=owner_anima_id,
        user_id=owner_id,
        title="Before",
    )
    await _create_chat(async_session, chat_id=other_chat_id, anima_id=other_anima_id, user_id=other_id)

    fetched = await chats_router.get_chat(owner_chat_id, user=_user(owner_id), session=async_session)
    assert fetched.id == owner_chat_id
    assert "model_client" not in fetched.model_dump()
    assert fetched.api_standard is None
    assert fetched.last_model_client is None
    assert fetched.last_model_id is None

    updated = await chats_router.update_chat(
        owner_chat_id,
        PyChatUpdate(title="After", metadata={"updated": True}),
        user=_user(owner_id),
        session=async_session,
    )
    assert updated.title == "After"
    assert "model_client" not in updated.model_dump()
    assert updated.api_standard is None
    assert updated.last_model_client is None
    assert updated.last_model_id is None
    assert updated.metadata == {"updated": True}

    with pytest.raises(HTTPException) as foreign_get:
        await chats_router.get_chat(other_chat_id, user=_user(owner_id), session=async_session)
    assert foreign_get.value.status_code == 404

    with pytest.raises(HTTPException) as foreign_update:
        await chats_router.update_chat(
            other_chat_id,
            PyChatUpdate(title="Nope"),
            user=_user(owner_id),
            session=async_session,
        )
    assert foreign_update.value.status_code == 404

    with pytest.raises(HTTPException) as foreign_delete:
        await chats_router.delete_chat(other_chat_id, user=_user(owner_id), session=async_session)
    assert foreign_delete.value.status_code == 404

    deleted = await chats_router.delete_chat(owner_chat_id, user=_user(owner_id), session=async_session)
    assert deleted.status_code == 204


@pytest.mark.asyncio
async def test_chat_messages_hide_internal_by_default_and_do_not_expose_session_id(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    chat_id = f"chat-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=anima_id, user_id=owner_id)
    await _create_chat(async_session, chat_id=chat_id, anima_id=anima_id, user_id=owner_id)
    await _sync_model_catalog(async_session)
    created_at = datetime(2026, 1, 1, 12, 0, 0)
    raw_structured = json.dumps(
        {
            "emotional_tone": "neutral",
            "emotional_intensity": 1,
            "speech": "Spoken visible",
            "gesture": "",
            "display": "Display visible",
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )
    async_session.add_all(
        [
            ORMChatMessage(
                chat_id=chat_id,
                run_id="run-1",
                role=MessageRole.ASSISTANT.value,
                content=raw_structured,
                model="gpt-5-nano",
                model_provider="OpenAIHTTPAgent",
                message_data={
                    "openai": {"provider": "OpenAIResponsesHTTPAgent", "response_id": "resp_visible"},
                    "raw_response": {"id": "resp_visible", "object": "response"},
                    "structured": {
                        "emotional_tone": "neutral",
                        "emotional_intensity": 1,
                        "speech": "Spoken visible",
                        "gesture": "",
                        "display": "Display visible",
                    },
                },
                raw_provider_message={"role": "assistant", "content": raw_structured},
                internal=False,
                created_at=created_at,
            ),
            ORMChatMessage(
                chat_id=chat_id,
                run_id="run-1",
                role=MessageRole.ASSISTANT.value,
                content="internal",
                message_data={},
                internal=True,
                created_at=created_at + timedelta(seconds=1),
            ),
        ]
    )
    await async_session.commit()

    visible = await chats_router.list_chat_messages(chat_id, user=_user(owner_id), session=async_session)
    assert [message.content for message in visible.messages] == ["Display visible"]
    assert visible.messages[0].chat_id == chat_id
    assert visible.messages[0].model == "gpt-5-nano"
    assert visible.messages[0].model_provider == "OpenAIHTTPAgent"
    assert visible.messages[0].internal is False
    assert visible.messages[0].data == {
        "openai": {"provider": "OpenAIResponsesHTTPAgent", "response_id": "resp_visible"},
        "structured": {
            "emotional_tone": "neutral",
            "emotional_intensity": 1,
            "speech": "Spoken visible",
            "gesture": "",
            "display": "Display visible",
        },
    }
    assert "session_id" not in visible.messages[0].model_dump()

    with_internal = await chats_router.list_chat_messages(
        chat_id,
        user=_user(owner_id),
        session=async_session,
        include_internal=True,
    )
    assert [message.content for message in with_internal.messages] == ["Display visible", "internal"]
    assert with_internal.messages[1].internal is True


@pytest.mark.asyncio
async def test_search_chat_messages_scopes_to_user_visible_messages_and_returns_anima_image(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    other_id = f"user-{uuid.uuid4()}"
    owner_anima_id = f"anima-{uuid.uuid4()}"
    other_anima_id = f"anima-{uuid.uuid4()}"
    owner_chat_id = f"chat-{uuid.uuid4()}"
    other_chat_id = f"chat-{uuid.uuid4()}"
    profile_url = "https://example.test/anima.png"
    await _create_anima(
        async_session,
        anima_id=owner_anima_id,
        user_id=owner_id,
        profile_picture_url=profile_url,
    )
    await _create_anima(async_session, anima_id=other_anima_id, user_id=other_id)
    await _create_chat(
        async_session,
        chat_id=owner_chat_id,
        anima_id=owner_anima_id,
        user_id=owner_id,
        title="React planning",
    )
    await _create_chat(
        async_session,
        chat_id=other_chat_id,
        anima_id=other_anima_id,
        user_id=other_id,
        title="Foreign",
    )
    visible = ORMChatMessage(
        chat_id=owner_chat_id,
        role=MessageRole.USER.value,
        content="React hooks and context are useful for this interface.",
        message_data={},
        internal=False,
        turn=1,
        created_at=datetime(2026, 1, 1, 12, 0, 0),
    )
    async_session.add_all(
        [
            visible,
            ORMChatMessage(
                chat_id=owner_chat_id,
                role=MessageRole.ASSISTANT.value,
                content="React internals should stay hidden.",
                message_data={},
                internal=True,
                turn=2,
                created_at=datetime(2026, 1, 1, 12, 1, 0),
            ),
            ORMChatMessage(
                chat_id=other_chat_id,
                role=MessageRole.USER.value,
                content="React result from another user.",
                message_data={},
                internal=False,
                turn=1,
                created_at=datetime(2026, 1, 1, 12, 2, 0),
            ),
        ]
    )
    await async_session.commit()

    response = await chats_router.search_chat_messages(
        PyChatSearchRequest(query="React", limit=10, offset=0),
        user=_user(owner_id),
        session=async_session,
    )

    assert response.query == "React"
    assert response.has_more is False
    assert len(response.results) == 1
    result = response.results[0]
    assert result.message_id == visible.id
    assert result.chat_id == owner_chat_id
    assert result.anima_id == owner_anima_id
    assert result.anima_name == owner_anima_id
    assert result.anima_profile_picture_url == profile_url
    assert result.chat_title == "React planning"
    assert "React hooks" in result.snippet
    assert result.score > 0


@pytest.mark.asyncio
async def test_search_chat_messages_indexes_structured_speech_and_display(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    chat_id = f"chat-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=anima_id, user_id=owner_id)
    await _create_chat(async_session, chat_id=chat_id, anima_id=anima_id, user_id=owner_id)
    raw_structured = json.dumps(
        {
            "emotional_tone": "neutral",
            "emotional_intensity": 1,
            "speech": "Brief spoken line.",
            "gesture": "",
            "display": "Obsidian project notes are ready.",
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )
    async_session.add(
        ORMChatMessage(
            chat_id=chat_id,
            role=MessageRole.ASSISTANT.value,
            content=raw_structured,
            message_data={
                "structured": {
                    "emotional_tone": "neutral",
                    "emotional_intensity": 1,
                    "speech": "Brief spoken line.",
                    "gesture": "",
                    "display": "Obsidian project notes are ready.",
                }
            },
            raw_provider_message={"role": "assistant", "content": raw_structured},
            internal=False,
            turn=1,
            created_at=datetime(2026, 1, 1, 12, 0, 0),
        )
    )
    await async_session.commit()

    speech_response = await chats_router.search_chat_messages(
        PyChatSearchRequest(query="spoken", limit=10, offset=0),
        user=_user(owner_id),
        session=async_session,
    )
    display_response = await chats_router.search_chat_messages(
        PyChatSearchRequest(query="Obsidian", limit=10, offset=0),
        user=_user(owner_id),
        session=async_session,
    )

    assert len(speech_response.results) == 1
    assert speech_response.results[0].chat_id == chat_id
    assert "Brief spoken line" in speech_response.results[0].snippet
    assert "Obsidian project notes" in speech_response.results[0].snippet
    assert len(display_response.results) == 1
    assert display_response.results[0].chat_id == chat_id
    assert "Brief spoken line" in display_response.results[0].snippet
    assert "Obsidian project notes" in display_response.results[0].snippet


@pytest.mark.asyncio
async def test_search_chat_messages_supports_prefix_terms(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    chat_id = f"chat-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=anima_id, user_id=owner_id)
    await _create_chat(
        async_session,
        chat_id=chat_id,
        anima_id=anima_id,
        user_id=owner_id,
        title="React prefix search",
    )
    visible = ORMChatMessage(
        chat_id=chat_id,
        role=MessageRole.USER.value,
        content="React hooks and context are useful for this interface.",
        message_data={},
        internal=False,
        turn=1,
        created_at=datetime(2026, 1, 1, 12, 0, 0),
    )
    async_session.add(visible)
    await async_session.commit()

    response = await chats_router.search_chat_messages(
        PyChatSearchRequest(query="Reac", limit=10, offset=0),
        user=_user(owner_id),
        session=async_session,
    )

    assert len(response.results) == 1
    assert response.results[0].chat_id == chat_id
    assert response.results[0].message_id == visible.id
    assert response.results[0].score > 0


@pytest.mark.asyncio
async def test_search_chat_messages_prefers_plain_prefix_terms_over_web_syntax(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    combined_chat_id = f"chat-{uuid.uuid4()}"
    react_chat_id = f"chat-{uuid.uuid4()}"
    vue_chat_id = f"chat-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=anima_id, user_id=owner_id)
    await _create_chat(async_session, chat_id=combined_chat_id, anima_id=anima_id, user_id=owner_id)
    await _create_chat(async_session, chat_id=react_chat_id, anima_id=anima_id, user_id=owner_id)
    await _create_chat(async_session, chat_id=vue_chat_id, anima_id=anima_id, user_id=owner_id)
    async_session.add_all(
        [
            ORMChatMessage(
                chat_id=combined_chat_id,
                role=MessageRole.USER.value,
                content="React and Vue interoperability notes.",
                message_data={},
                internal=False,
                turn=1,
                created_at=datetime(2026, 1, 1, 12, 0, 0),
            ),
            ORMChatMessage(
                chat_id=react_chat_id,
                role=MessageRole.USER.value,
                content="React component notes.",
                message_data={},
                internal=False,
                turn=1,
                created_at=datetime(2026, 1, 1, 12, 1, 0),
            ),
            ORMChatMessage(
                chat_id=vue_chat_id,
                role=MessageRole.USER.value,
                content="Vue component notes.",
                message_data={},
                internal=False,
                turn=1,
                created_at=datetime(2026, 1, 1, 12, 2, 0),
            ),
        ]
    )
    await async_session.commit()

    response = await chats_router.search_chat_messages(
        PyChatSearchRequest(query="React OR Vue", limit=10, offset=0),
        user=_user(owner_id),
        session=async_session,
    )

    assert [result.chat_id for result in response.results] == [combined_chat_id]


@pytest.mark.asyncio
async def test_search_chat_messages_returns_one_best_result_per_chat(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    chat_id = f"chat-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=anima_id, user_id=owner_id)
    await _create_chat(async_session, chat_id=chat_id, anima_id=anima_id, user_id=owner_id)
    older = ORMChatMessage(
        chat_id=chat_id,
        role=MessageRole.USER.value,
        content="DuplicateTerm older chat match",
        message_data={},
        internal=False,
        turn=1,
        created_at=datetime(2026, 1, 1, 12, 0, 0),
    )
    newer = ORMChatMessage(
        chat_id=chat_id,
        role=MessageRole.ASSISTANT.value,
        content="DuplicateTerm newer chat match",
        message_data={},
        internal=False,
        turn=2,
        created_at=datetime(2026, 1, 1, 12, 1, 0),
    )
    async_session.add_all([older, newer])
    await async_session.commit()

    response = await chats_router.search_chat_messages(
        PyChatSearchRequest(query="DuplicateTerm", limit=10, offset=0),
        user=_user(owner_id),
        session=async_session,
    )

    assert len(response.results) == 1
    assert response.has_more is False
    assert response.results[0].chat_id == chat_id
    assert response.results[0].message_id == newer.id


@pytest.mark.asyncio
async def test_search_chat_messages_uses_chat_limit_offset_and_has_more(async_session) -> None:
    owner_id = f"user-{uuid.uuid4()}"
    anima_id = f"anima-{uuid.uuid4()}"
    first_chat_id = f"chat-{uuid.uuid4()}"
    second_chat_id = f"chat-{uuid.uuid4()}"
    await _create_anima(async_session, anima_id=anima_id, user_id=owner_id)
    await _create_chat(async_session, chat_id=first_chat_id, anima_id=anima_id, user_id=owner_id)
    await _create_chat(async_session, chat_id=second_chat_id, anima_id=anima_id, user_id=owner_id)
    async_session.add_all(
        [
            ORMChatMessage(
                chat_id=first_chat_id,
                role=MessageRole.USER.value,
                content="PaginationTerm first result",
                message_data={},
                internal=False,
                turn=1,
                created_at=datetime(2026, 1, 1, 12, 0, 0),
            ),
            ORMChatMessage(
                chat_id=second_chat_id,
                role=MessageRole.ASSISTANT.value,
                content="PaginationTerm second result",
                message_data={},
                internal=False,
                turn=2,
                created_at=datetime(2026, 1, 1, 12, 1, 0),
            ),
        ]
    )
    await async_session.commit()

    first_page = await chats_router.search_chat_messages(
        PyChatSearchRequest(query="PaginationTerm", limit=1, offset=0),
        user=_user(owner_id),
        session=async_session,
    )
    second_page = await chats_router.search_chat_messages(
        PyChatSearchRequest(query="PaginationTerm", limit=1, offset=1),
        user=_user(owner_id),
        session=async_session,
    )

    assert len(first_page.results) == 1
    assert first_page.has_more is True
    assert len(second_page.results) == 1
    assert second_page.has_more is False
    assert first_page.results[0].chat_id != second_page.results[0].chat_id
