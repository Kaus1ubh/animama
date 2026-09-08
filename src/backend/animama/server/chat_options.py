from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.settings_repo import (
    SQLAlchemyAnimaSettingsRepository,
    SQLAlchemyUserSettingsRepository,
)
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.chat.options import DirectChatOptions, DirectChatTtsOptions
from animama.app.services.settings_service import SettingsService
from animama.domain.request_principal import RequestPrincipal
from animama.server.schemas.elevenlabs import SUPPORTED_ELEVENLABS_CHAT_TTS_MODEL_IDS


def _pick_bool(*values: object) -> bool:
    for val in values:
        if isinstance(val, bool):
            return val
    return False


def _pick_str(*values: object) -> str | None:
    for val in values:
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list | tuple | set):
        return []
    seen: set[str] = set()
    result: list[str] = []
    for item in value:
        if item is None:
            continue
        text = str(item).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _normalize_tts_options(value: object) -> DirectChatTtsOptions | None:
    if not isinstance(value, dict):
        return None

    normalized: dict[str, object] = {}
    enabled = value.get("enabled")
    if isinstance(enabled, bool):
        normalized["enabled"] = enabled

    provider = value.get("provider")
    if provider in {"browser", "pocket_tts", "elevenlabs"}:
        normalized["provider"] = provider

    transport = value.get("transport")
    if transport in {"auto", "direct"}:
        normalized["transport"] = transport

    language_code = _pick_str(value.get("language_code"))
    if language_code is not None:
        normalized["language_code"] = language_code

    model_id = _pick_str(value.get("model_id"))
    if model_id in SUPPORTED_ELEVENLABS_CHAT_TTS_MODEL_IDS:
        normalized["model_id"] = model_id

    finalized_chunking = _pick_str(value.get("finalized_chunking"))
    if finalized_chunking in {"sentence", "paragraph"}:
        normalized["finalized_chunking"] = finalized_chunking

    if not normalized:
        return None
    return DirectChatTtsOptions.from_mapping(normalized)


def _get_pref_section(prefs: dict | None, key: str) -> dict:
    if isinstance(prefs, dict):
        section = prefs.get(key)
        if isinstance(section, dict):
            return section
    return {}


def merge_chat_request_options(
    *,
    request_opts: dict | None,
    user_prefs: dict | None,
    anima_prefs: dict | None,
) -> DirectChatOptions:
    req = dict(request_opts or {})
    user_memory = _get_pref_section(user_prefs, "memory")
    anima_memory = _get_pref_section(anima_prefs, "memory")
    user_emotion = _get_pref_section(user_prefs, "emotion")
    anima_emotion = _get_pref_section(anima_prefs, "emotion")

    return DirectChatOptions(
        disable_memory_influence=_pick_bool(
            req.get("disable_memory_influence"),
            anima_memory.get("disable_influence"),
            user_memory.get("disable_influence"),
        ),
        disable_memory_updates=_pick_bool(
            req.get("disable_memory_updates"),
            anima_memory.get("disable_updates"),
            user_memory.get("disable_updates"),
        ),
        disable_emotion_influence=_pick_bool(
            req.get("disable_emotion_influence"),
            anima_emotion.get("disable_influence"),
            user_emotion.get("disable_influence"),
        ),
        disable_emotion_updates=_pick_bool(
            req.get("disable_emotion_updates"),
            anima_emotion.get("disable_updates"),
            user_emotion.get("disable_updates"),
        ),
        incognito=_pick_bool(req.get("incognito")),
        main_structured_response=_pick_bool(req.get("main_structured_response")),
        native_tools=tuple(_string_list(req.get("native_tools"))),
        reasoning_effort=_pick_str(req.get("reasoning_effort")),
        tts=_normalize_tts_options(req.get("tts")),
    )


async def resolve_chat_request_options(
    *,
    session: AsyncSession,
    user: RequestPrincipal,
    anima_id: str,
    request_opts: dict | None,
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
