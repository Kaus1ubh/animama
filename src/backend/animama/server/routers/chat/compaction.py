from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Any

from animama.adapters.repositories.sqlalchemy.chat_compaction_repo import SQLAlchemyChatCompactionRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.chat.direct_turn.constants import OPENAI_RESPONSES_PROVIDER
from animama.app.chat.options import DirectChatOptions
from animama.app.model_clients import ModelClientRegistry
from animama.app.services.chat_compaction_service import ChatCompactionService, ChatCompactionSettings
from animama.app.services.direct_model_prompt_runner import DirectModelPromptRunner
from animama.logging_config import get_logger
from animama.server.config import settings
from animama.server.model_roles import ModelRoleSettings

_log = get_logger("server.routers.chat.compaction")


def chat_compaction_settings() -> ChatCompactionSettings:
    return ChatCompactionSettings(
        enabled=settings.anima_chat_compaction_enabled,
        threshold_tokens=settings.anima_chat_compaction_threshold_tokens,
        recent_message_min_count=settings.anima_chat_compaction_recent_message_min_count,
        prompt_version=settings.anima_chat_compaction_prompt_version,
    )


def direct_model_prompt_runner(
    session: Any,
    model_client_registry: ModelClientRegistry,
    model_roles: ModelRoleSettings,
) -> DirectModelPromptRunner:
    return DirectModelPromptRunner(
        registry=model_client_registry,
        role_resolver=model_roles.resolver(session),
    )


def chat_compaction_service(
    session: Any,
    model_client_registry: ModelClientRegistry,
    model_roles: ModelRoleSettings,
) -> ChatCompactionService:
    return ChatCompactionService(
        chats=SQLAlchemyChatRepository(session),
        messages=SQLAlchemyChatMessageRepository(session),
        compactions=SQLAlchemyChatCompactionRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        model_runner=direct_model_prompt_runner(session, model_client_registry, model_roles),
        settings=chat_compaction_settings(),
    )


async def compact_chat_after_success(
    *,
    session_factory: Any,
    model_client_registry: ModelClientRegistry,
    chat_id: str,
    user_id: str,
    anima_id: str,
    run_id: str,
    chat_options: DirectChatOptions,
    model_roles: ModelRoleSettings,
    model_provider_type: str | None = None,
) -> None:
    if chat_options.incognito:
        _log.info(
            "Direct chat post-response compaction skipped for incognito turn",
            anima_id=anima_id,
            chat_id=chat_id,
            run_id=run_id,
        )
        return
    if model_provider_type == OPENAI_RESPONSES_PROVIDER:
        _log.info(
            "Direct chat post-response compaction skipped for OpenAI Responses native compaction",
            anima_id=anima_id,
            chat_id=chat_id,
            run_id=run_id,
            model_provider_type=model_provider_type,
        )
        return

    session = session_factory()
    try:
        expire_all = getattr(session, "expire_all", None)
        if expire_all is not None:
            expire_all()
        result = await chat_compaction_service(session, model_client_registry, model_roles).maybe_compact_chat(
            chat_id=chat_id,
            user_id=user_id,
            anima_id=anima_id,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        rollback = getattr(session, "rollback", None)
        if rollback is not None:
            with suppress(Exception):
                await rollback()
        _log.warning(
            "Direct chat post-response compaction failed",
            anima_id=anima_id,
            chat_id=chat_id,
            run_id=run_id,
            error=str(exc),
        )
        return
    finally:
        close = getattr(session, "close", None)
        if close is not None:
            with suppress(Exception):
                await close()

    _log.info(
        "Direct chat post-response compaction checked",
        anima_id=anima_id,
        chat_id=chat_id,
        run_id=run_id,
        compacted=result.compacted,
        reason=result.reason,
        compaction_id=getattr(result.compaction, "id", None),
        trigger_active_context_tokens=result.trigger_active_context_tokens,
    )


__all__ = [
    "ChatCompactionSettings",
    "chat_compaction_settings",
    "compact_chat_after_success",
    "direct_model_prompt_runner",
]
