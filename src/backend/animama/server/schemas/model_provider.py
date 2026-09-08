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
    accepts: list[str] = Field(default_factory=list)
    produces: list[str] = Field(default_factory=list)
    supports_developer_role: bool = True
    supports_tools: bool = False
    supports_streaming: bool = False
    supports_reasoning: bool | None = None
    supported_reasoning_efforts: list[str] | None = None
    native_tool_support: list[str] | None = None
    requestable_native_tool_support: list[str] | None = None
