"""Shared history search needs its three data families, not an avatar catalog."""

from __future__ import annotations

import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository


async def test_history_search_without_avatar_storage_preserves_owner_and_portrait(db_url: str) -> None:
    """An independent composition may admit history before avatar persistence."""
    engine = create_async_engine(db_url, poolclass=NullPool)
    try:
        async with engine.begin() as connection:
            # This transaction cannot fall back to the full local test schema.
            await connection.execute(text("SET LOCAL search_path TO pg_temp"))
            for statement in (
                "CREATE TEMP TABLE anima (id TEXT PRIMARY KEY, display_name TEXT, profile_picture_url TEXT)",
                "CREATE TEMP TABLE chats (id TEXT PRIMARY KEY, anima_id TEXT, user_id TEXT, title TEXT)",
                """CREATE TEMP TABLE chat_messages (
                    id BIGINT PRIMARY KEY, chat_id TEXT, message_data JSONB, content TEXT,
                    turn INTEGER, created_at TIMESTAMPTZ DEFAULT now(), internal BOOLEAN, role TEXT,
                    search_vector TSVECTOR GENERATED ALWAYS AS (
                        to_tsvector('english',
                            coalesce(message_data #>> '{structured,speech}', content, '') || ' ' ||
                            coalesce(message_data #>> '{structured,display}', ''))
                    ) STORED)""",
            ):
                await connection.execute(text(statement))
            await connection.execute(
                text(
                    "INSERT INTO anima VALUES ('a', 'Alice companion', '/private/portrait'), "
                    "('b', 'Bob companion', NULL)"
                )
            )
            await connection.execute(
                text(
                    "INSERT INTO chats VALUES ('a1', 'a', 'alice', 'First'), ('a2', 'a', 'alice', 'Second'), "
                    "('b1', 'b', 'bob', 'Private')"
                )
            )
            await connection.execute(
                text("""INSERT INTO chat_messages (id, chat_id, message_data, content, turn, internal, role)
                        VALUES (:id, :chat_id, CAST(:data AS jsonb), :content, :turn, :internal, :role)"""),
                [
                    {
                        "id": 1,
                        "chat_id": "a1",
                        "data": None,
                        "content": "React basics",
                        "turn": 1,
                        "internal": False,
                        "role": "user",
                    },
                    {
                        "id": 2,
                        "chat_id": "a1",
                        "data": json.dumps({"structured": {"speech": "React speech", "display": "React display"}}),
                        "content": "Raw provider response",
                        "turn": 2,
                        "internal": False,
                        "role": "assistant",
                    },
                    {
                        "id": 3,
                        "chat_id": "a1",
                        "data": None,
                        "content": "React private internal",
                        "turn": 3,
                        "internal": True,
                        "role": "assistant",
                    },
                    {
                        "id": 4,
                        "chat_id": "a2",
                        "data": None,
                        "content": "React next steps",
                        "turn": 1,
                        "internal": False,
                        "role": "user",
                    },
                    {
                        "id": 5,
                        "chat_id": "b1",
                        "data": None,
                        "content": "React another owner",
                        "turn": 1,
                        "internal": False,
                        "role": "user",
                    },
                ],
            )
            async with AsyncSession(bind=connection) as session:
                repository = SQLAlchemyChatMessageRepository(session)
                results = await repository.search_for_user(user_id="alice", query="React", limit=10)
                assert [result.chat_id for result in results] == ["a1", "a2"]
                assert results[0].message_id == 2
                assert results[0].snippet == "React speech React display"
                assert all(result.anima_name == "Alice companion" for result in results)
                assert all(result.anima_profile_picture_url == "/private/portrait" for result in results)
                page = await repository.search_for_user(user_id="alice", query="Reac", limit=1, offset=1)
                assert [result.chat_id for result in page] == ["a2"]
                assert not await repository.search_for_user(user_id="absent", query="React", limit=10)
    finally:
        await engine.dispose()
