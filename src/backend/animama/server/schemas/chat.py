from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from .dispatch import PyAnimaDispatchOptions


class PyAnimaChatRequest(BaseModel):
    message: str
    chat_id: str | None = None
    run_id: str | None = None
    model_provider_id: str | None = None
    runtime_revision: str = Field(max_length=128)
    attached_file_ids: list[str] | None = Field(default=None, max_length=50)
    dispatch_options: PyAnimaDispatchOptions | None = None

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
                normalized.append(item)  # type: ignore[arg-type]
                continue
            trimmed = item.strip()
            if not trimmed:
                raise ValueError("attached_file_ids must not include blank ids")
            normalized.append(trimmed)
        return normalized
