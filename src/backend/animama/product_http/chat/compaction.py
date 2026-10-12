"""Chat history compaction around a direct turn: before it (to fit) and after it (past a threshold)."""

from __future__ import annotations

import asyncio
from typing import Any

from animama.app.chat.direct_turn.constants import NATIVE_COMPACTION_PROVIDERS
from animama.app.chat.direct_turn.types import PreSendCompactionRequest, PreSendCompactor
from animama.app.chat.options import DirectChatOptions
from animama.app.model_clients import ModelClientRegistry
from animama.app.model_clients.context_budget import context_budget_for_model
from animama.app.services.chat_compaction_service import ChatCompactionService, ChatCompactionSettings
from animama.app.services.direct_model_prompt_runner import DirectModelPromptRunner
from animama.domain import ModelProvider
from animama.logging import get_logger
from animama.product_http.ports import ProductRepositories, model_role_resolver

from .setup_helpers import TurnSessions, chat_manager

_log = get_logger("product_http.chat.compaction")


def direct_model_prompt_runner(
    sessions: TurnSessions,
    repositories: ProductRepositories,
    model_client_registry: ModelClientRegistry,
) -> DirectModelPromptRunner:
    return DirectModelPromptRunner(
        registry=model_client_registry,
        role_resolver=model_role_resolver(sessions.ports, repositories),
    )


def chat_compaction_service(
    sessions: TurnSessions,
    repositories: ProductRepositories,
    model_client_registry: ModelClientRegistry,
    settings: ChatCompactionSettings,
) -> ChatCompactionService:
    return ChatCompactionService(
        chats=repositories.chats,
        messages=repositories.chat_messages,
        compactions=repositories.chat_compactions,
        uow=repositories.unit_of_work,
        model_runner=direct_model_prompt_runner(sessions, repositories, model_client_registry),
        settings=settings,
    )


def pre_send_compactor(
    *,
    sessions: TurnSessions,
    model_client_registry: ModelClientRegistry,
    settings: ChatCompactionSettings,
) -> PreSendCompactor:
    """Compact in a fresh session before a turn that would not fit its model's window."""

    async def compact(request: PreSendCompactionRequest) -> Any | None:
        async with sessions.write() as session:
            repositories = sessions.repositories(session)
            result = await chat_compaction_service(
                sessions, repositories, model_client_registry, settings
            ).compact_for_budget(
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
            return await chat_manager(repositories).get_chat_context(chat_id=request.chat_id)

    return compact


async def compact_chat_after_success(
    *,
    sessions: TurnSessions,
    model_client_registry: ModelClientRegistry,
    chat_id: str,
    user_id: str,
    anima_id: str,
    run_id: str,
    chat_options: DirectChatOptions,
    settings: ChatCompactionSettings,
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

    budget = context_budget_for_model(model_provider) if model_provider is not None else None
    try:
        async with sessions.write() as session:
            # Read the turn just recorded, even from a session that saw the chat before.
            session.expire_all()
            repositories = sessions.repositories(session)
            result = await chat_compaction_service(
                sessions, repositories, model_client_registry, settings
            ).maybe_compact_chat(
                chat_id=chat_id,
                user_id=user_id,
                anima_id=anima_id,
                threshold_tokens=budget.post_response_trigger_tokens if budget is not None else None,
            )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _log.warning(
            "Direct chat post-response compaction failed",
            anima_id=anima_id,
            chat_id=chat_id,
            run_id=run_id,
            error=str(exc),
        )
        return

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
    "chat_compaction_service",
    "compact_chat_after_success",
    "direct_model_prompt_runner",
    "pre_send_compactor",
]
