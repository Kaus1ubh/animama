"""Mappers between chat message ORM rows and domain dataclasses."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from ...app.util.json_values import json_safe_dict
from ...domain.chat import ChatMessage, MessageRole
from ...domain.usage import Usage, UsageInputDetails, UsageOutputDetails
from ...orm.chat_messages import ORMChatMessage


def _usage_from_message_orm(orm: ORMChatMessage) -> Usage | None:
    it = getattr(orm, "input_tokens", None)
    ot = getattr(orm, "output_tokens", None)
    tt = getattr(orm, "total_tokens", None)
    cit = getattr(orm, "cached_input_tokens", None)
    ort = getattr(orm, "output_reasoning_tokens", None)
    has_any = any(v is not None and int(v or 0) > 0 for v in (it, ot, tt, cit, ort))
    if not has_any:
        return None
    return Usage(
        input_tokens=int(it or 0),
        output_tokens=int(ot or 0),
        total_tokens=int(tt or 0),
        input_tokens_details=UsageInputDetails(cached_tokens=int(cit or 0) if cit is not None else 0),
        output_tokens_details=UsageOutputDetails(reasoning_tokens=int(ort or 0) if ort is not None else 0),
    )


def _role_from_str(value: str | None) -> MessageRole | None:
    if not value:
        return None
    try:
        return MessageRole(value)
    except Exception:
        return None


def _role_to_str(role: MessageRole | None) -> str | None:
    return role.value if role is not None else None


def _message_data_to_dict(value: Mapping[str, Any] | None) -> dict[str, Any]:
    return json_safe_dict(value)


def chat_message_orm_to_domain(orm: ORMChatMessage) -> ChatMessage:
    created: datetime | None = getattr(orm, "created_at", None)
    return ChatMessage(
        id=int(getattr(orm, "id", 0) or 0) if getattr(orm, "id", None) is not None else None,
        chat_id=getattr(orm, "chat_id", None),
        run_id=getattr(orm, "run_id", None),
        message_type=getattr(orm, "message_type", None),
        role=_role_from_str(getattr(orm, "role", None)),
        content=getattr(orm, "content", None),
        data=_message_data_to_dict(getattr(orm, "message_data", None)),
        usage=_usage_from_message_orm(orm),
        turn=getattr(orm, "turn", None),
        created_at=created,
        model=getattr(orm, "model", None),
        model_provider=getattr(orm, "model_provider", None),
        internal=bool(getattr(orm, "internal", False)),
        raw_provider_message=_message_data_to_dict(getattr(orm, "raw_provider_message", None))
        if getattr(orm, "raw_provider_message", None) is not None
        else None,
    )


def chat_message_domain_to_orm(message: ChatMessage) -> ORMChatMessage:
    usage = message.usage
    input_tokens = int(getattr(usage, "input_tokens", 0) or 0) if usage else None
    output_tokens = int(getattr(usage, "output_tokens", 0) or 0) if usage else None
    total_tokens = int(getattr(usage, "total_tokens", 0) or 0) if usage else None
    cached_input_tokens = (
        int(getattr(getattr(usage, "input_tokens_details", None), "cached_tokens", 0) or 0) if usage else None
    )
    output_reasoning_tokens = (
        int(getattr(getattr(usage, "output_tokens_details", None), "reasoning_tokens", 0) or 0) if usage else None
    )

    return ORMChatMessage(
        chat_id=str(message.chat_id or ""),
        run_id=message.run_id,
        message_type=message.message_type,
        role=_role_to_str(message.role),
        content=message.content,
        model=message.model,
        model_provider=message.model_provider,
        message_data=_message_data_to_dict(message.data),
        raw_provider_message=_message_data_to_dict(message.raw_provider_message)
        if message.raw_provider_message is not None
        else None,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_input_tokens=cached_input_tokens,
        output_reasoning_tokens=output_reasoning_tokens,
        total_tokens=total_tokens,
        turn=message.turn,
        internal=bool(message.internal),
    )


__all__ = ["chat_message_domain_to_orm", "chat_message_orm_to_domain"]
