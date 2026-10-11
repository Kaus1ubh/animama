"""A chat's generated title, made beside its first turn and shown after the reply."""

from __future__ import annotations

import asyncio
from contextlib import suppress

from animama.app.chat.options import DirectChatOptions
from animama.app.model_clients import ModelClientRegistry
from animama.app.services.chat_title_generation_service import (
    ChatTitleGenerationResult,
    ChatTitleGenerationService,
    ChatTitleGenerationSettings,
)
from animama.app.services.direct_model_prompt_runner import DirectModelPromptRunner
from animama.domain.chat import Chat
from animama.logging import get_logger
from animama.product_http.ports import ProductRepositories, model_role_resolver

from .setup_helpers import TurnSessions, chat_manager
from .sse_events import format_chat_title_updated_event

_log = get_logger("product_http.chat.title")


def direct_model_prompt_runner(
    sessions: TurnSessions,
    repositories: ProductRepositories,
    model_client_registry: ModelClientRegistry,
) -> DirectModelPromptRunner:
    return DirectModelPromptRunner(
        registry=model_client_registry,
        role_resolver=model_role_resolver(sessions.ports, repositories),
    )


def chat_title_generation_service(
    sessions: TurnSessions,
    repositories: ProductRepositories,
    model_client_registry: ModelClientRegistry,
    settings: ChatTitleGenerationSettings,
) -> ChatTitleGenerationService:
    return ChatTitleGenerationService(
        model_runner=direct_model_prompt_runner(sessions, repositories, model_client_registry),
        settings=settings,
    )


def chat_title_generation_skip_reason(
    chat: Chat, *, chat_options: DirectChatOptions, settings: ChatTitleGenerationSettings
) -> str | None:
    if chat_options.incognito:
        return "incognito"
    if not settings.enabled:
        return "disabled"
    title = getattr(chat, "title", None)
    if isinstance(title, str) and title.strip():
        return "title_exists"
    next_turn = int(getattr(chat, "next_turn", 0) or 0)
    if next_turn != 1:
        return f"not_first_turn:{next_turn}"
    return None


def should_generate_chat_title(
    chat: Chat, *, chat_options: DirectChatOptions, settings: ChatTitleGenerationSettings
) -> bool:
    return chat_title_generation_skip_reason(chat, chat_options=chat_options, settings=settings) is None


async def generate_chat_title_for_stream(
    *,
    sessions: TurnSessions,
    model_client_registry: ModelClientRegistry,
    settings: ChatTitleGenerationSettings,
    anima_id: str,
    user_id: str,
    chat_id: str,
    run_id: str,
    message: str,
) -> ChatTitleGenerationResult:
    # Generation only reads (the utility role); the title is saved in its own write session.
    async with sessions.read() as session:
        _log.info(
            "Direct chat title generation started",
            anima_id=anima_id,
            chat_id=chat_id,
            run_id=run_id,
        )
        return await chat_title_generation_service(
            sessions, sessions.repositories(session), model_client_registry, settings
        ).generate_title(
            anima_id=anima_id,
            user_id=user_id,
            chat_id=chat_id,
            source_run_id=run_id,
            user_message=message,
        )


def chat_title_metadata_patch(
    *,
    result: ChatTitleGenerationResult,
    run_id: str,
) -> dict[str, object]:
    usage = result.usage
    return {
        "title_generation": {
            "model_provider": result.model_provider,
            "model": result.model,
            "prompt_version": result.prompt_version,
            "source_run_id": run_id,
            "usage": {
                "input_tokens": int(getattr(usage, "input_tokens", 0) or 0) if usage is not None else 0,
                "output_tokens": int(getattr(usage, "output_tokens", 0) or 0) if usage is not None else 0,
                "total_tokens": int(getattr(usage, "total_tokens", 0) or 0) if usage is not None else 0,
            },
        }
    }


async def persist_generated_chat_title(
    *,
    sessions: TurnSessions,
    user_id: str,
    chat_id: str,
    run_id: str,
    result: ChatTitleGenerationResult,
) -> str | None:
    title = result.title.strip() if isinstance(result.title, str) else ""
    if not title:
        return None
    async with sessions.write() as session:
        chat = await chat_manager(sessions.repositories(session)).set_title_if_blank(
            chat_id=chat_id,
            user_id=user_id,
            title=title,
            metadata_patch=chat_title_metadata_patch(result=result, run_id=run_id),
        )
    if chat is None:
        _log.info("Direct chat generated title skipped because chat already has a title", chat_id=chat_id)
        return None
    return chat.title


async def cancel_chat_title_task(task: asyncio.Task[ChatTitleGenerationResult] | None) -> None:
    if task is None or task.done():
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def chat_title_updated_frame(
    *,
    title_task: asyncio.Task[ChatTitleGenerationResult] | None,
    sessions: TurnSessions,
    anima_id: str,
    user_id: str,
    chat_id: str,
    run_id: str,
) -> str | None:
    if title_task is None:
        return None
    try:
        result = await title_task
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _log.warning(
            "Direct chat title generation task failed",
            anima_id=anima_id,
            chat_id=chat_id,
            run_id=run_id,
            error=str(exc),
        )
        return None
    if result.title is None:
        _log.info(
            "Direct chat title generation produced no title",
            anima_id=anima_id,
            chat_id=chat_id,
            run_id=run_id,
            reason=result.reason,
        )
        return None
    try:
        title = await persist_generated_chat_title(
            sessions=sessions,
            user_id=user_id,
            chat_id=chat_id,
            run_id=run_id,
            result=result,
        )
    except Exception as exc:
        _log.warning(
            "Direct chat generated title persistence failed",
            anima_id=anima_id,
            chat_id=chat_id,
            run_id=run_id,
            error=str(exc),
        )
        return None
    if not title:
        return None
    return format_chat_title_updated_event(run_id=run_id, chat_id=chat_id, title=title)


__all__ = [
    "ChatTitleGenerationResult",
    "ChatTitleGenerationSettings",
    "cancel_chat_title_task",
    "chat_title_generation_skip_reason",
    "chat_title_updated_frame",
    "direct_model_prompt_runner",
    "generate_chat_title_for_stream",
    "should_generate_chat_title",
]
