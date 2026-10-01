"""Owner-visible runtime capability contract shared by every composition.

Compositions report what the current runtime admits; the UI decides what to
show from these values rather than from a build or deployment mode. The models
carry presentation metadata only, never executable paths or credentials.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class UserFileProcessingCapability(BaseModel):
    enabled: bool
    worker_state: Literal["disabled", "starting", "ready", "stale"]
    last_heartbeat_at: datetime | None
    pack_id: Literal["document-processing"] | None
    supported_extensions: list[str]


class CompanionSafetyCapability(BaseModel):
    """Operator safety configuration; owner preferences are in user settings."""

    enabled: bool
    ai_notice_enabled: bool
    crisis_detection_enabled: bool
    operator_reminder_hours: float


class WebSearchCapability(BaseModel):
    configuration: bool = False
    """Whether the owner may configure application web search (local composition only)."""
    configured: bool = False
    """Whether a backend is configured, so tool-capable models can search."""
    backend: Literal["searxng", "brave"] | None = None
    credential_state: Literal["configured", "missing", "not_required"] | None = None
    """Whether the backend's key is set; searches fail with a tool error while it is ``missing``."""


class RuntimeCapabilities(BaseModel):
    schema_version: Literal[1] = 1
    runtime_kind: Literal["desktop", "self_hosted_web", "hosted"]
    """Presentation metadata only; capability fields, not this value, gate features.

    The local composition reports ``desktop`` or ``self_hosted_web`` and never
    ``hosted``.
    """
    model_configuration: bool = False
    """Whether the owner may manage model connections, models and roles."""
    chat_file_uploads: bool
    """Whether chat accepts owner file uploads; the UI hides upload entry points when false."""
    anima_creation: bool
    """Whether the owner may create Animas; the UI hides every create-Anima entry point when false."""
    user_file_processing: UserFileProcessingCapability
    offline_speech_enabled: bool
    """Whether offline speech recognition (Parakeet) can be used now; read on every request."""
    offline_speech_asset_version: str | None
    """The active base Parakeet version, pinned by the browser with ``?v=``."""
    offline_speech_gpu_asset_version: str | None = None
    """The active WebGPU Parakeet version, or null when that set is unavailable."""
    companion_safety: CompanionSafetyCapability
    web_search: WebSearchCapability = Field(default_factory=WebSearchCapability)


__all__ = [
    "CompanionSafetyCapability",
    "RuntimeCapabilities",
    "UserFileProcessingCapability",
    "WebSearchCapability",
]
