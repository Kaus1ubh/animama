from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Any

from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.app.chat.options import DirectChatOptions
from animama.app.model_clients import ModelClientRegistry
from animama.app.services.chat_title_generation_service import (
    ChatTitleGenerationResult,
    ChatTitleGenerationService,
    ChatTitleGenerationSettings,
)
from animama.app.services.direct_model_prompt_runner import DirectModelPromptRunner
from animama.domain.chat import Chat
from animama.logging_config import get_logger
from animama.server.config import settings
from animama.server.sse_events import format_chat_title_updated_event

from .setup_helpers import chat_manager

_log = get_logger("server.routers.chat.title")


def chat_title_generation_settings() -> ChatTitleGenerationSettings:
    return ChatTitleGenerationSettings(
        enabled=settings.anima_chat_title_generation_enabled,
        model_provider=settings.anima_chat_title_generation_provider,
        model=settings.anima_chat_title_generation_model,
        prompt_version=settings.anima_chat_title_generation_prompt_version,
        max_chars=settings.anima_chat_title_generation_max_chars,
        timeout_seconds=settings.anima_chat_title_generation_timeout_seconds,
        reasoning_effort=settings.anima_chat_title_generation_reasoning_effort,
    )


def direct_model_prompt_runner(
    session: Any,
    model_client_registry: ModelClientRegistry,
) -> DirectModelPromptRunner:
    return DirectModelPromptRunner(
        registry=model_client_registry,
        model_providers=SQLAlchemyModelProviderRepository(session),
    )


def chat_title_generation_service(
    session: Any,
    model_client_registry: ModelClientRegistry,
) -> ChatTitleGenerationService:
    return ChatTitleGenerationService(
        model_runner=direct_model_prompt_runner(session, model_client_registry),
        settings=chat_title_generation_settings(),
    )


def chat_title_generation_skip_reason(chat: Chat, *, chat_options: DirectChatOptions) -> str | None:
    if chat_options.incognito:
        return "incognito"
    if not chat_title_generation_settings().enabled:
        return "disabled"
    title = getattr(chat, "title", None)
    if isinstance(title, str) and title.strip():
        return "title_exists"
    next_turn = int(getattr(chat, "next_turn", 0) or 0)
    if next_turn != 1:
        return f"not_first_turn:{next_turn}"
    return None


def should_generate_chat_title(chat: Chat, *, chat_options: DirectChatOptions) -> bool:
    return chat_title_generation_skip_reason(chat, chat_options=chat_options) is None


async def generate_chat_title_for_stream(
    *,
    session_factory: Any,
    model_client_registry: ModelClientRegistry,
    anima_id: str,
    user_id: str,
    chat_id: str,
    run_id: str,
    message: str,
) -> ChatTitleGenerationResult:
    title_session = session_factory()
    try:
        _log.info(
            "Direct chat title generation started",
            anima_id=anima_id,
            chat_id=chat_id,
            run_id=run_id,
        )
        return await chat_title_generation_service(title_session, model_client_registry).generate_title(
            anima_id=anima_id,
            user_id=user_id,
            chat_id=chat_id,
            source_run_id=run_id,
            user_message=message,
        )
    finally:
        close = getattr(title_session, "close", None)
        if close is not None:
            with suppress(Exception):
                await close()


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
    session_factory: Any,
    user_id: str,
    chat_id: str,
    run_id: str,
    result: ChatTitleGenerationResult,
) -> str | None:
    title = result.title.strip() if isinstance(result.title, str) else ""
    if not title:
        return None
    session = session_factory()
    try:
        chat = await chat_manager(session).set_title_if_blank(
            chat_id=chat_id,
            user_id=user_id,
            title=title,
            metadata_patch=chat_title_metadata_patch(result=result, run_id=run_id),
        )
        if chat is None:
            _log.info("Direct chat generated title skipped because chat already has a title", chat_id=chat_id)
            return None
        return chat.title
    finally:
        close = getattr(session, "close", None)
        if close is not None:
            with suppress(Exception):
                await close()


async def cancel_chat_title_task(task: asyncio.Task[ChatTitleGenerationResult] | None) -> None:
    if task is None or task.done():
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def chat_title_updated_frame(
    *,
    title_task: asyncio.Task[ChatTitleGenerationResult] | None,
    session_factory: Any,
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
            session_factory=session_factory,
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
    "chat_title_generation_settings",
    "chat_title_generation_skip_reason",
    "chat_title_updated_frame",
    "direct_model_prompt_runner",
    "generate_chat_title_for_stream",
    "should_generate_chat_title",
]
