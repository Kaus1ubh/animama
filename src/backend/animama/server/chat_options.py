from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.settings_repo import (
    SQLAlchemyAnimaSettingsRepository,
    SQLAlchemyUserSettingsRepository,
)
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.chat.options import DirectChatOptions, DirectChatTtsOptions, merge_chat_request_options
from animama.app.services.settings_service import SettingsService
from animama.domain.request_principal import RequestPrincipal


async def resolve_chat_request_options(
    *,
    session: AsyncSession,
    user: RequestPrincipal,
    anima_id: str,
    request_opts: dict[str, Any] | None,
) -> DirectChatOptions:
    settings_service = SettingsService(
        user_settings=SQLAlchemyUserSettingsRepository(session),
        anima_settings=SQLAlchemyAnimaSettingsRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )
    user_settings = await settings_service.get_user_settings(user.id)
    anima_settings = await settings_service.get_anima_settings(user_id=user.id, anima_id=anima_id)
    user_prefs = user_settings.preferences if user_settings is not None else None
    anima_prefs = anima_settings.preferences if anima_settings is not None else None
    return merge_chat_request_options(
        request_opts=request_opts,
        user_prefs=user_prefs,
        anima_prefs=anima_prefs,
    )


__all__ = ["DirectChatOptions", "DirectChatTtsOptions", "merge_chat_request_options", "resolve_chat_request_options"]
