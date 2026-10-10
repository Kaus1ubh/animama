"""Shared model provider contracts; delivery owns admission and transport."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class PyModelProviderCatalogItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    model: str
    model_provider: str
    model_label: str | None = None
    provider_label: str | None = None
    logo_provider: str | None = None
    model_client: str | None = None
    api_standard: str | None = None
    source: str = "builtin"
    connection_id: str = "openai"
    connection_name: str | None = None
    model_kind: str = "chat"
    hidden: bool = False
    context_window_tokens: int | None = None
    accepts: list[str] = Field(default_factory=list)
    produces: list[str] = Field(default_factory=list)
    supports_developer_role: bool = True
    supports_tools: bool = False
    supports_streaming: bool = False
    supports_reasoning: bool | None = None
    supported_reasoning_efforts: list[str] | None = None
    default_reasoning_effort: str | None = Field(
        default=None,
        description=(
            "Effort a chat picker preselects for this row (one of supported_reasoning_efforts), "
            "or null to use the first supported effort. Anthropic Messages rows report their "
            "chat default when they offer it."
        ),
    )
    native_tool_support: list[str] | None = None
    requestable_native_tool_support: list[str] | None = None
