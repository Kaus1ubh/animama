"""Shared chat contracts; delivery owns admission and transport."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from .dispatch import PyAnimaDispatchOptions


class PyChatClientContext(BaseModel):
    """Client-reported context for one turn.

    ``time_zone`` and ``locale`` serve only safety presentation (companion safety
    spec R2, R5). ``ui_locale`` sets the conversation language (ADR 0024).
    """

    time_zone: str | None = Field(default=None, max_length=64, description="IANA time zone, e.g. America/Toronto.")
    locale: str | None = Field(default=None, max_length=64, description="BCP 47 locale, e.g. en-US.")
    ui_locale: str | None = Field(
        default=None,
        max_length=35,
        description=(
            "UI Locale the client applied, e.g. ja. A non-English supported locale sets the language "
            "the Anima replies and speaks in; other values are ignored."
        ),
    )


class PyAnimaChatRequest(BaseModel):
    message: str
    chat_id: str | None = None
    run_id: str | None = None
    model_provider_id: str | None = None
    runtime_revision: str = Field(max_length=128)
    attached_file_ids: list[str] | None = Field(default=None, max_length=50)
    dispatch_options: PyAnimaDispatchOptions | None = None
    client_context: PyChatClientContext | None = None

    @field_validator("message")
    @classmethod
    def trim_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message must not be blank")
        return normalized

    @field_validator("model_provider_id")
    @classmethod
    def trim_model_provider_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("model_provider_id must not be blank")
        return normalized

    @field_validator("runtime_revision")
    @classmethod
    def trim_runtime_revision(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("runtime revision must not be blank")
        return normalized

    @field_validator("attached_file_ids", mode="before")
    @classmethod
    def trim_attached_file_ids(cls, value: object) -> object:
        if value is None:
            return None
        if not isinstance(value, list):
            return value
        normalized: list[str] = []
        for item in value:
            if not isinstance(item, str):
                normalized.append(item)
                continue
            trimmed = item.strip()
            if not trimmed:
                raise ValueError("attached_file_ids must not include blank ids")
            normalized.append(trimmed)
        return normalized
