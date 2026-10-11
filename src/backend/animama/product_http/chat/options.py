"""A chat turn's options: the request's flags over the Anima's and the owner's preferences."""

from __future__ import annotations

from typing import Any

from animama.app.chat.options import DirectChatOptions, DirectChatTtsOptions, merge_chat_request_options
from animama.app.services.settings_service import SettingsService
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import ProductRepositories


async def resolve_chat_request_options(
    *,
    repositories: ProductRepositories,
    user: RequestPrincipal,
    anima_id: str,
    request_opts: dict[str, Any] | None,
) -> DirectChatOptions:
    settings_service = SettingsService(
        user_settings=repositories.user_settings,
        anima_settings=repositories.anima_settings,
        uow=repositories.unit_of_work,
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
