"""Capability probe contracts for model connections.

A probe sends a few small, bounded requests to one model on one connection and
reports what worked. The owner applies the suggested capabilities when adding
or editing the model; the probe never saves anything itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from animama.domain.model_connection import ModelConnection

PROBE_STEP_STREAMING = "streaming"
PROBE_STEP_STRUCTURED_OUTPUT = "structured_output"
PROBE_STEP_JSON_MODE = "json_mode"
PROBE_STEP_TOOL_CALLS = "tool_calls"
PROBE_STEP_TOOLS_WITH_STRUCTURED_OUTPUT = "tools_with_structured_output"
PROBE_STEP_EMBEDDINGS = "embeddings"
PROBE_STEP_AVAILABLE = "available"


@dataclass(frozen=True, slots=True)
class ModelProbeStep:
    """One probe request. ``category`` names the failure (see error categories)."""

    name: str
    ok: bool
    category: str | None = None
    detail: str | None = None


@dataclass(frozen=True, slots=True)
class ModelProbeReport:
    """Probe results and the capabilities they suggest.

    ``None`` means the probe did not determine a value (for example because an
    earlier step failed or the server does not report it).
    """

    model: str
    steps: tuple[ModelProbeStep, ...] = ()
    supports_streaming: bool | None = None
    structured_output_transport: str | None = None
    supports_tools: bool | None = None
    tools_with_structured_output: bool | None = None
    context_window_tokens: int | None = None
    embedding_dimensions: int | None = None
    notes: tuple[str, ...] = field(default_factory=tuple)


class ModelConnectionProbe(Protocol):
    """Reach one connection to list its models or test one model."""

    async def list_models(self, connection: ModelConnection) -> list[str]: ...

    async def probe_chat_model(self, connection: ModelConnection, *, model: str) -> ModelProbeReport: ...

    async def probe_responses_model(self, connection: ModelConnection, *, model: str) -> ModelProbeReport: ...

    async def probe_embedding_model(self, connection: ModelConnection, *, model: str) -> ModelProbeReport: ...


class ModelConnectionProbeError(Exception):
    """A connection-level failure, such as an unreachable server."""

    def __init__(self, message: str, *, category: str) -> None:
        super().__init__(message)
        self.category = category


__all__ = [
    "PROBE_STEP_AVAILABLE",
    "PROBE_STEP_EMBEDDINGS",
    "PROBE_STEP_JSON_MODE",
    "PROBE_STEP_STREAMING",
    "PROBE_STEP_STRUCTURED_OUTPUT",
    "PROBE_STEP_TOOLS_WITH_STRUCTURED_OUTPUT",
    "PROBE_STEP_TOOL_CALLS",
    "ModelConnectionProbe",
    "ModelConnectionProbeError",
    "ModelProbeReport",
    "ModelProbeStep",
]
