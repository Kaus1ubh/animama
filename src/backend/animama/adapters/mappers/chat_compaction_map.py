"""Mappers between chat compaction ORM rows and domain dataclasses."""

from __future__ import annotations

from typing import Any

from animama.domain.chat_compaction import ChatCompaction
from animama.domain.usage import Usage, UsageInputDetails, UsageOutputDetails
from animama.orm.chat_compactions import ORMChatCompaction


def _usage_from_compaction_orm(orm: ORMChatCompaction) -> Usage | None:
    input_tokens = getattr(orm, "input_tokens", None)
    output_tokens = getattr(orm, "output_tokens", None)
    total_tokens = getattr(orm, "total_tokens", None)
    cached_input_tokens = getattr(orm, "cached_input_tokens", None)
    output_reasoning_tokens = getattr(orm, "output_reasoning_tokens", None)
    has_any = any(
        value is not None and int(value or 0) > 0
        for value in (input_tokens, output_tokens, total_tokens, cached_input_tokens, output_reasoning_tokens)
    )
    if not has_any:
        return None
    return Usage(
        input_tokens=int(input_tokens or 0),
        output_tokens=int(output_tokens or 0),
        total_tokens=int(total_tokens or 0),
        input_tokens_details=UsageInputDetails(cached_tokens=int(cached_input_tokens or 0)),
        output_tokens_details=UsageOutputDetails(reasoning_tokens=int(output_reasoning_tokens or 0)),
    )


def chat_compaction_orm_to_domain(orm: ORMChatCompaction) -> ChatCompaction:
    return ChatCompaction(
        id=orm.id,
        chat_id=orm.chat_id,
        user_id=orm.user_id,
        anima_id=orm.anima_id,
        status=orm.status,
        summary_text=orm.summary_text,
        start_turn=orm.start_turn,
        end_turn=orm.end_turn,
        source_message_count=int(orm.source_message_count or 0),
        model_provider=orm.model_provider,
        model=orm.model,
        prompt_version=orm.prompt_version,
        usage=_usage_from_compaction_orm(orm),
        metadata=dict(orm.metadata_ or {}),
        created_at=orm.created_at,
        updated_at=orm.updated_at,
        superseded_at=orm.superseded_at,
    )


def chat_compaction_domain_to_orm(compaction: ChatCompaction) -> ORMChatCompaction:
    usage = compaction.usage
    metadata: dict[str, Any] = dict(compaction.metadata or {})
    return ORMChatCompaction(
        id=str(compaction.id or ""),
        chat_id=compaction.chat_id,
        user_id=compaction.user_id,
        anima_id=compaction.anima_id,
        status=compaction.status,
        summary_text=compaction.summary_text,
        start_turn=compaction.start_turn,
        end_turn=compaction.end_turn,
        source_message_count=int(compaction.source_message_count or 0),
        model_provider=compaction.model_provider,
        model=compaction.model,
        prompt_version=compaction.prompt_version,
        input_tokens=int(getattr(usage, "input_tokens", 0) or 0) if usage else None,
        output_tokens=int(getattr(usage, "output_tokens", 0) or 0) if usage else None,
        cached_input_tokens=(
            int(getattr(getattr(usage, "input_tokens_details", None), "cached_tokens", 0) or 0) if usage else None
        ),
        output_reasoning_tokens=(
            int(getattr(getattr(usage, "output_tokens_details", None), "reasoning_tokens", 0) or 0) if usage else None
        ),
        total_tokens=int(getattr(usage, "total_tokens", 0) or 0) if usage else None,
        metadata_=metadata,
        superseded_at=compaction.superseded_at,
    )


__all__ = ["chat_compaction_domain_to_orm", "chat_compaction_orm_to_domain"]
