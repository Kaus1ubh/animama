"""Owner web search settings API (local composition only)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from animama.server.schemas.model_configuration import PyModelConnectionCredential


class PyWebSearchSettingsRequest(BaseModel):
    """``managed`` stores the key in the desktop vault; ``env`` names a variable on self-hosted web."""

    model_config = ConfigDict(extra="forbid")

    backend: Literal["searxng", "brave"]
    base_url: str | None = Field(default=None, max_length=2048)
    credential: PyModelConnectionCredential = Field(default_factory=PyModelConnectionCredential)
    timeout_seconds: float | None = None


class PyWebSearchSettings(BaseModel):
    """The configured backend; the key value is never returned."""

    configured: bool
    backend: Literal["searxng", "brave"] | None = None
    base_url: str | None = None
    credential_env: str | None = None
    credential_state: Literal["configured", "missing", "not_required"] = "not_required"
    managed_credential_env: str
    timeout_seconds: float | None = None


class PyWebSearchTestResult(BaseModel):
    ok: bool
    category: str | None = None
    result_count: int = 0


__all__ = ["PyWebSearchSettings", "PyWebSearchSettingsRequest", "PyWebSearchTestResult"]
