from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Any

from animama.adapters.repositories.sqlalchemy.chat_compaction_repo import SQLAlchemyChatCompactionRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.chat.direct_turn.constants import NATIVE_COMPACTION_PROVIDERS
from animama.app.chat.direct_turn.types import PreSendCompactionRequest, PreSendCompactor
from animama.app.chat.options import DirectChatOptions
from animama.app.model_clients import ModelClientRegistry
from animama.app.model_clients.context_budget import context_budget_for_model
from animama.app.services.chat_compaction_service import ChatCompactionService, ChatCompactionSettings
from animama.app.services.direct_model_prompt_runner import DirectModelPromptRunner
from animama.domain import ModelProvider
from animama.logging_config import get_logger
from animama.server.config import settings
from animama.server.model_roles import ModelRoleSettings

from .setup_helpers import chat_manager

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


def pre_send_compactor(
    *,
    session_factory: Any,
    model_client_registry: ModelClientRegistry,
    model_roles: ModelRoleSettings,
) -> PreSendCompactor:
    """Compact in a fresh session before a turn that would not fit its model's window."""

    async def compact(request: PreSendCompactionRequest) -> Any | None:
        session = session_factory()
        try:
            result = await chat_compaction_service(session, model_client_registry, model_roles).compact_for_budget(
                chat_id=request.chat_id,
                user_id=request.user_id,
                anima_id=request.anima_id,
                keep_recent_tokens=request.keep_recent_tokens,
            )
            _log.info(
                "Direct chat pre-send compaction checked",
                anima_id=request.anima_id,
                chat_id=request.chat_id,
                run_id=request.run_id,
                compacted=result.compacted,
                reason=result.reason,
                compaction_id=getattr(result.compaction, "id", None),
            )
            if not result.compacted:
                return None
            return await chat_manager(session).get_chat_context(chat_id=request.chat_id)
        except BaseException:
            rollback = getattr(session, "rollback", None)
            if rollback is not None:
                with suppress(Exception):
                    await rollback()
            raise
        finally:
            close = getattr(session, "close", None)
            if close is not None:
                with suppress(Exception):
                    await close()

    return compact


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
    model_provider: ModelProvider | None = None,
) -> None:
    """Compact after a successful turn once the chat's context crosses the threshold.

    For models with a context window the threshold is at most a share of the
    window, so a small model compacts after replies instead of before them.
    Providers with server-side compaction (OpenAI Responses, Anthropic
    Messages) are skipped.
    """

    model_provider_type = model_provider.provider_type if model_provider is not None else None
    if chat_options.incognito:
        _log.info(
            "Direct chat post-response compaction skipped for incognito turn",
            anima_id=anima_id,
            chat_id=chat_id,
            run_id=run_id,
        )
        return
    if model_provider_type in NATIVE_COMPACTION_PROVIDERS:
        # OpenAI Responses and Anthropic Messages compact on the provider's server.
        _log.info(
            "Direct chat post-response compaction skipped for provider-native compaction",
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
        budget = context_budget_for_model(model_provider) if model_provider is not None else None
        result = await chat_compaction_service(session, model_client_registry, model_roles).maybe_compact_chat(
            chat_id=chat_id,
            user_id=user_id,
            anima_id=anima_id,
            threshold_tokens=budget.post_response_trigger_tokens if budget is not None else None,
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
    "pre_send_compactor",
]
