#!/usr/bin/env python3
# ruff: noqa: E402
"""Seed synthetic chat history and searchable markdown memory for one user."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# The script is intentionally runnable from a source checkout without installing
# the backend package first, so it bootstraps `src/backend` before app imports.
ROOT = Path(__file__).resolve().parents[1]
BACKEND_SRC = ROOT / "src" / "backend"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))

load_dotenv(ROOT / ".env")
os.environ.setdefault("ANIMAMA_LOG_TO_CONSOLE", "0")
os.environ.setdefault("ANIMAMA_LOG_TO_FILE", "0")

from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.chat_compaction_repo import SQLAlchemyChatCompactionRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.chat.api_standard import CHAT_API_STANDARD_CHAT_COMPLETIONS, MODEL_CLIENT_OPENAI_CHAT_COMPLETIONS
from animama.app.services.chat_manager import ChatManager
from animama.app.services.memory_entry_service import MemoryEntryNotFoundError, MemoryEntryService
from animama.domain.chat import ChatMessage, MessageRole
from animama.local.database import dispose_engine, get_engine
from animama.orm.anima import ORMAnima
from animama.orm.chat_messages import ORMChatMessage
from animama.utils import slugify

SYNTHETIC_MODEL_ID = "synthetic-memory-search-demo"
SYNTHETIC_PROVIDER_TYPE = "OpenAIHTTPAgent"


@dataclass(frozen=True, slots=True)
class MemorySeed:
    path: str
    description: str
    content: str


@dataclass(frozen=True, slots=True)
class ChatTurnSeed:
    user: str
    speech: str
    display: str
    emotional_tone: str
    emotional_intensity: int
    gesture: str | None = None


def _memory_seeds(prefix: str) -> tuple[MemorySeed, ...]:
    return (
        MemorySeed(
            path="profile.md",
            description="Synthetic user profile for memory-search testing",
            content=(
                "# Profile\n\n"
                f"- Seed prefix: `{prefix}`.\n"
                "- The user is testing Project Atlas memory retrieval.\n"
                "- They prefer concise answers, visible citations, and follow-up questions only when needed.\n"
                "- Favorite working setup: Obsidian notes, dark mode, and small focused demos.\n"
            ),
        ),
        MemorySeed(
            path="notes/projects.md",
            description="Synthetic project notes with searchable terms",
            content=(
                "# Projects\n\n"
                "## Project Atlas\n\n"
                "Project Atlas tracks uploaded research dossiers, markdown memory files, and AI tool search "
                "behavior. The next demo should ask the anima to find the Atlas launch-window notes.\n\n"
                "## Project Lantern\n\n"
                "Project Lantern is a softer UI polish pass for memory and upload diagnostics.\n"
            ),
        ),
        MemorySeed(
            path="notes/preferences.md",
            description="Synthetic nested preferences for memory-search testing",
            content=(
                "# Preferences\n\n"
                "- Debug panels should be dense, scan-friendly, and avoid marketing copy.\n"
                "- Search snippets should be short enough to compare quickly.\n"
                "- If multiple result sources exist, show them in separate groups before mixing rankings.\n"
            ),
        ),
    )


def _chat_turns() -> tuple[ChatTurnSeed, ...]:
    return (
        ChatTurnSeed(
            user="Can you remember what Project Atlas is supposed to prove?",
            speech=(
                "Project Atlas is the memory-search demo: it proves I can search both markdown memory and "
                "processed uploads before answering."
            ),
            display=(
                "Project Atlas proves search_memory_files can retrieve markdown memory while search_uploaded_files "
                "can retrieve attached processed uploads."
            ),
            emotional_tone="confidence",
            emotional_intensity=4,
            gesture="right-thumbs-up",
        ),
        ChatTurnSeed(
            user="What should the Uploads tab debug panel feel like?",
            speech=(
                "It should feel practical and compact: separate result groups, clear snippets, and no extra ceremony."
            ),
            display=(
                "Keep the Uploads tab practical: compact controls, separate memory/upload result groups, "
                "clear snippets."
            ),
            emotional_tone="calm",
            emotional_intensity=2,
            gesture="thinking-hand-on-chin-hold",
        ),
        ChatTurnSeed(
            user="If I ask about Atlas launch windows later, where should you look?",
            speech=(
                "I should search memory files with search_memory_files and attached processed uploads with "
                "search_uploaded_files, then answer from the hits."
            ),
            display=(
                "For Atlas launch-window questions, use search_memory_files for markdown memory and "
                "search_uploaded_files for attached uploads."
            ),
            emotional_tone="curiosity",
            emotional_intensity=3,
            gesture="left-ok-sign",
        ),
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Seed user-scope markdown memory and a deterministic synthetic chat for local search_memory_files demos."
        )
    )
    parser.add_argument("--user-id", required=True, help="Opaque owner principal ID for the seeded rows.")
    parser.add_argument(
        "--anima-id",
        help="Existing anima ID owned by --user-id. Required unless --memory-only is supplied.",
    )
    parser.add_argument(
        "--memory-only",
        action="store_true",
        help="Seed only user-level memory files; skip anima validation and chat seeding.",
    )
    parser.add_argument(
        "--prefix",
        default="synthetic",
        help="Prefix used in the deterministic chat ID and title. Use a new prefix for a fresh chat.",
    )
    parser.add_argument(
        "--append-chat",
        action="store_true",
        help="Append synthetic turns if the deterministic chat already contains visible messages.",
    )
    return parser


def _memory_service(session: AsyncSession) -> MemoryEntryService:
    return MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        animas=SQLAlchemyAnimaRepository(session),
    )


def _chat_manager(session: AsyncSession) -> ChatManager:
    return ChatManager(
        chats=SQLAlchemyChatRepository(session),
        messages=SQLAlchemyChatMessageRepository(session),
        compactions=SQLAlchemyChatCompactionRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )


async def _require_owned_anima(session: AsyncSession, *, user_id: str, anima_id: str) -> None:
    result = await session.execute(select(ORMAnima.id).where(ORMAnima.id == anima_id, ORMAnima.user_id == user_id))
    if result.scalar_one_or_none() is None:
        raise RuntimeError(f"Anima {anima_id!r} was not found for user {user_id!r}.")


async def _existing_memory_revision(service: MemoryEntryService, *, user_id: str, path: str) -> int:
    try:
        entry = await service.get_entry_by_path(user_id=user_id, anima_id=None, path=path)
    except MemoryEntryNotFoundError:
        return 0
    return entry.revision


async def _seed_memory(session: AsyncSession, *, user_id: str, prefix: str) -> list[dict[str, Any]]:
    service = _memory_service(session)
    written: list[dict[str, Any]] = []
    for seed in _memory_seeds(prefix):
        revision = await _existing_memory_revision(service, user_id=user_id, path=seed.path)
        stored = await service.put_file_by_path(
            user_id=user_id,
            anima_id=None,
            path=seed.path,
            content=seed.content,
            kind="synthetic_context",
            description=seed.description,
            metadata={"source": {"type": "synthetic_context", "prefix": prefix}},
            expected_revision=revision,
            create_parents=True,
        )
        written.append(
            {
                "path": stored.path,
                "status": "created" if revision == 0 else "updated",
                "revision": stored.revision,
            }
        )
    return written


async def _latest_visible_turn(session: AsyncSession, *, chat_id: str) -> int:
    result = await session.execute(
        select(func.coalesce(func.max(ORMChatMessage.turn), 0)).where(
            ORMChatMessage.chat_id == chat_id,
            ORMChatMessage.internal.is_(False),
        )
    )
    return int(result.scalar_one() or 0)


def _assistant_structured(turn: ChatTurnSeed) -> dict[str, Any]:
    return {
        "emotional_tone": turn.emotional_tone,
        "emotional_intensity": turn.emotional_intensity,
        "gesture": turn.gesture,
        "speech": turn.speech,
        "display": turn.display,
    }


def _assistant_message_data(turn: ChatTurnSeed, *, prefix: str) -> dict[str, Any]:
    return {
        "structured": _assistant_structured(turn),
        "model_client": {
            "provider_type": SYNTHETIC_PROVIDER_TYPE,
            "model_provider_id": f"{SYNTHETIC_PROVIDER_TYPE}:{SYNTHETIC_MODEL_ID}",
            "raw_provider_metadata": {"synthetic": True, "prefix": prefix},
        },
    }


async def _record_synthetic_turn(
    manager: ChatManager,
    *,
    user_id: str,
    anima_id: str,
    chat_id: str,
    prefix: str,
    turn: ChatTurnSeed,
    index: int,
) -> None:
    run_id = f"{chat_id}-run-{index}"
    assistant_content = json.dumps(_assistant_structured(turn), ensure_ascii=True, separators=(",", ":"))
    await manager.record_turn(
        anima_id=anima_id,
        chat_id=chat_id,
        user_msg=ChatMessage(
            id=None,
            chat_id=chat_id,
            run_id=run_id,
            message_type="message",
            role=MessageRole.USER,
            content=turn.user,
            data=None,
            usage=None,
            turn=None,
            created_at=None,
            internal=False,
            raw_provider_message={"role": "user", "content": turn.user},
        ),
        assistant_msg=ChatMessage(
            id=None,
            chat_id=chat_id,
            run_id=run_id,
            message_type="message",
            role=MessageRole.ASSISTANT,
            content=assistant_content,
            data=_assistant_message_data(turn, prefix=prefix),
            usage=None,
            turn=None,
            created_at=None,
            internal=False,
            raw_provider_message={"role": "assistant", "content": assistant_content},
        ),
        chat_metadata_patch={
            "synthetic_context": {
                "prefix": prefix,
                "user_id": user_id,
                "anima_id": anima_id,
                "script": "scripts/seed_synthetic_context.py",
            }
        },
        last_model_client=MODEL_CLIENT_OPENAI_CHAT_COMPLETIONS,
        last_model_id=SYNTHETIC_MODEL_ID,
    )


async def _seed_chat(
    session: AsyncSession,
    *,
    user_id: str,
    anima_id: str,
    prefix: str,
    append_chat: bool,
) -> dict[str, Any]:
    manager = _chat_manager(session)
    chat_id = f"{slugify(prefix)}-context-chat"
    existing_chat = await SQLAlchemyChatRepository(session).get(chat_id)
    await manager.ensure_owned_chat(
        anima_id=anima_id,
        chat_id=chat_id,
        user_id=user_id,
        api_standard=CHAT_API_STANDARD_CHAT_COMPLETIONS,
        model_provider_id=f"{SYNTHETIC_PROVIDER_TYPE}:{SYNTHETIC_MODEL_ID}",
    )
    await manager.set_title_if_blank(
        chat_id=chat_id,
        user_id=user_id,
        title=f"{prefix.strip() or 'synthetic'} memory search demo",
        metadata_patch={"synthetic_context": {"prefix": prefix}},
    )

    latest_visible_turn = await _latest_visible_turn(session, chat_id=chat_id)
    if latest_visible_turn > 0 and not append_chat:
        return {
            "chat_id": chat_id,
            "status": "skipped_existing_messages",
            "turns_written": 0,
        }

    for index, turn in enumerate(_chat_turns(), start=1):
        await _record_synthetic_turn(
            manager,
            user_id=user_id,
            anima_id=anima_id,
            chat_id=chat_id,
            prefix=prefix,
            turn=turn,
            index=latest_visible_turn + index,
        )
    return {
        "chat_id": chat_id,
        "status": "created" if existing_chat is None else "appended",
        "turns_written": len(_chat_turns()),
    }


def _print_summary(
    *,
    user_id: str,
    anima_id: str | None,
    chat: dict[str, Any] | None,
    memory: Sequence[dict[str, Any]],
) -> None:
    print("Synthetic context seed complete")
    print(f"  user_id: {user_id}")
    if chat is None:
        print("  anima_id: not used (memory-only)")
        print("  chat_id: skipped (memory-only)")
    else:
        print(f"  anima_id: {anima_id}")
        print(f"  chat_id: {chat['chat_id']} ({chat['status']}, turns_written={chat['turns_written']})")
    print("  memory_paths:")
    for item in memory:
        print(f"    - {item['path']} ({item['status']}, revision={item['revision']})")


async def _run(args: argparse.Namespace) -> int:
    user_id = str(args.user_id or "").strip()
    prefix = str(args.prefix or "synthetic").strip() or "synthetic"
    anima_id = str(args.anima_id).strip() if args.anima_id is not None else None
    if not user_id:
        raise ValueError("--user-id is required")
    if args.append_chat and args.memory_only:
        raise ValueError("--append-chat cannot be used with --memory-only")
    if not args.memory_only and not anima_id:
        raise ValueError("--anima-id is required unless --memory-only is supplied")

    engine = get_engine()
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            chat: dict[str, Any] | None = None
            if not args.memory_only:
                assert anima_id is not None
                await _require_owned_anima(session, user_id=user_id, anima_id=anima_id)
            memory = await _seed_memory(session, user_id=user_id, prefix=prefix)
            if not args.memory_only:
                assert anima_id is not None
                chat = await _seed_chat(
                    session,
                    user_id=user_id,
                    anima_id=anima_id,
                    prefix=prefix,
                    append_chat=bool(args.append_chat),
                )
            _print_summary(user_id=user_id, anima_id=anima_id, chat=chat, memory=memory)
    finally:
        await dispose_engine(engine=engine)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        return asyncio.run(_run(args))
    except (PermissionError, RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
