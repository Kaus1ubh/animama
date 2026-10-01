"""Request and response schemas for owner model configuration (local composition only).

Responses name credential variables and report whether a key is configured,
but never carry key values.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class PyModelConnectionCompatibility(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fold_developer_role: bool = False
    send_openai_extensions: bool = True
    send_stream_usage: bool = True
    strip_function_strict: bool = False
    reasoning_mode: Literal["openai_effort", "deepseek_thinking", "omit"] = "openai_effort"


class PyModelConnectionPreset(BaseModel):
    id: str
    label: str
    logo_provider: str | None = None
    local: bool
    expects_key: bool
    default_base_url: str | None = None
    suggested_credential_env: str | None = None
    compatibility: PyModelConnectionCompatibility
    timeout_seconds: float


class PyModelConnectionCredential(BaseModel):
    """``managed`` stores the key in the desktop vault under a derived variable name."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["none", "env", "managed"] = "none"
    env: str | None = Field(default=None, max_length=96)


class PyModelConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    preset: str = Field(min_length=1, max_length=40)
    base_url: str = Field(min_length=1, max_length=2048)
    credential: PyModelConnectionCredential = Field(default_factory=PyModelConnectionCredential)
    compatibility: PyModelConnectionCompatibility | None = None
    timeout_seconds: float | None = None


class PyModelConnectionUpdate(BaseModel):
    """Connection changes; omitted fields keep their current values."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    preset: str | None = Field(default=None, min_length=1, max_length=40)
    base_url: str | None = Field(default=None, min_length=1, max_length=2048)
    credential: PyModelConnectionCredential | None = None
    compatibility: PyModelConnectionCompatibility | None = None
    timeout_seconds: float | None = None


class PyOwnerModelCapabilities(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepts_images: bool = False
    supports_streaming: bool = True
    structured_output_transport: Literal["json_schema", "json_object"] | None = "json_schema"
    supports_tools: bool = False
    tools_with_structured_output: bool = True
    supported_reasoning_efforts: list[str] = Field(default_factory=list, max_length=7)


class PyModelCapabilitiesView(BaseModel):
    accepts: list[str]
    supports_streaming: bool
    supports_tools: bool
    structured_output_transport: str | None = None
    tools_with_structured_output: bool
    supports_reasoning: bool | None = None
    supported_reasoning_efforts: list[str] | None = None
    native_tool_support: list[str] | None = None


class PyConfiguredModel(BaseModel):
    """A catalog row as the owner manages it, including capabilities and probe results."""

    id: str
    model: str
    model_label: str
    provider_type: str
    source: Literal["builtin", "owner"]
    model_kind: Literal["chat", "embedding"]
    hidden: bool
    connection_id: str
    context_window_tokens: int | None = None
    allow_memory_writes: bool
    capabilities: PyModelCapabilitiesView
    probe_result: dict[str, Any] | None = None
    template_id: str | None = None


class PyModelConnection(BaseModel):
    id: str
    name: str
    preset: str
    source: Literal["builtin", "owner"]
    logo_provider: str | None = None
    base_url: str | None = None
    credential_env: str | None = None
    credential_state: Literal["configured", "missing", "not_required"]
    compatibility: PyModelConnectionCompatibility
    timeout_seconds: float | None = None
    models: list[PyConfiguredModel] = Field(default_factory=list)


class PyOwnerModelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1, max_length=256)
    label: str | None = Field(default=None, max_length=120)
    kind: Literal["chat", "embedding"] = "chat"
    provider_type: Literal["OpenAIHTTPAgent", "OpenAIResponsesHTTPAgent"] | None = None
    template_id: str | None = None
    capabilities: PyOwnerModelCapabilities | None = None
    context_window_tokens: int | None = None
    allow_memory_writes: bool = True
    probe_result: dict[str, Any] | None = None


class PyOwnerModelPatch(BaseModel):
    """Built-in models accept only ``hidden``."""

    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, max_length=120)
    capabilities: PyOwnerModelCapabilities | None = None
    context_window_tokens: int | None = None
    clear_context_window: bool = False
    allow_memory_writes: bool | None = None
    probe_result: dict[str, Any] | None = None
    hidden: bool | None = None


class PyModelUsageAnima(BaseModel):
    anima_id: str
    display_name: str
    model_provider_id: str


class PyModelUsage(BaseModel):
    animas: list[PyModelUsageAnima] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)


class PyModelRemovalResult(BaseModel):
    removed: bool
    usage: PyModelUsage


class PyAvailableModels(BaseModel):
    models: list[str]


class PyOpenRouterModel(BaseModel):
    """One model from OpenRouter's public list.

    ``supports_tools`` and ``supports_structured_outputs`` come from the
    model's advertised parameters; the capability probe can override them.
    """

    id: str
    name: str
    context_length: int | None = None
    supports_tools: bool
    supports_structured_outputs: bool


class PyOpenRouterModels(BaseModel):
    models: list[PyOpenRouterModel]


class PyModelConnectionDetection(BaseModel):
    """Whether a local preset's server answers at its default address, and its models.

    ``category`` names the failure when ``reachable`` is false.
    """

    preset: str
    base_url: str
    reachable: bool
    models: list[str]
    category: str | None = None


class PyModelProbeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1, max_length=256)
    kind: Literal["chat", "embedding"] = "chat"
    provider_type: Literal["OpenAIHTTPAgent", "OpenAIResponsesHTTPAgent"] = "OpenAIHTTPAgent"


class PyModelProbeStep(BaseModel):
    name: str
    ok: bool
    category: str | None = None
    detail: str | None = None


class PyModelProbeReport(BaseModel):
    """Suggested capabilities; ``None`` means the probe could not determine a value."""

    model: str
    steps: list[PyModelProbeStep]
    supports_streaming: bool | None = None
    structured_output_transport: str | None = None
    supports_tools: bool | None = None
    tools_with_structured_output: bool | None = None
    context_window_tokens: int | None = None
    embedding_dimensions: int | None = None
    notes: list[str] = Field(default_factory=list)


class PyModelRoleAssignment(BaseModel):
    """The row doing one role's job and how it was chosen.

    ``source`` is ``owner`` (App Settings), ``default`` (operator environment),
    ``inherited`` (the chat role) or ``off``. ``assignment_available`` is False
    when the owner's choice could not be used and the role fell back.
    """

    role: Literal["chat", "utility", "memory_manager", "embeddings"]
    source: Literal["owner", "default", "inherited", "off"]
    model_provider_id: str | None = None
    model_label: str | None = None
    connection_name: str | None = None
    requested_model_provider_id: str | None = None
    assignment_available: bool


class PyEmbeddingRefreshStatus(BaseModel):
    """Whether stored vectors match the embeddings role.

    While ``re_embedding`` or ``retrying``, search uses keyword retrieval;
    ``pending`` counts rows still waiting for a vector.
    """

    state: Literal["off", "current", "re_embedding", "retrying"]
    pending: int = 0
    error_category: str | None = None


class PyModelRoles(BaseModel):
    roles: list[PyModelRoleAssignment]
    embeddings_refresh: PyEmbeddingRefreshStatus


__all__ = [
    "PyAvailableModels",
    "PyOpenRouterModel",
    "PyOpenRouterModels",
    "PyEmbeddingRefreshStatus",
    "PyConfiguredModel",
    "PyModelCapabilitiesView",
    "PyModelConnection",
    "PyModelConnectionCompatibility",
    "PyModelConnectionCredential",
    "PyModelConnectionDetection",
    "PyModelConnectionPreset",
    "PyModelConnectionRequest",
    "PyModelConnectionUpdate",
    "PyModelProbeReport",
    "PyModelProbeRequest",
    "PyModelProbeStep",
    "PyModelRemovalResult",
    "PyModelRoleAssignment",
    "PyModelRoles",
    "PyModelUsage",
    "PyModelUsageAnima",
    "PyOwnerModelCapabilities",
    "PyOwnerModelPatch",
    "PyOwnerModelRequest",
]
