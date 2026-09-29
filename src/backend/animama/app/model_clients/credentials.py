"""Per-connection model credentials.

Model clients ask a :class:`ModelCredentialResolver` for the key of the
connection that owns the selected catalog row. A key is never shared across
connections: the built-in OpenAI connection uses the process OpenAI key, and an
owner connection uses only the environment variable it names. Values are never
stored in the database or returned by APIs.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Protocol

from animama.app.model_connection_presets import PRESET_OPENAI
from animama.domain import ModelProvider
from animama.domain.model_connection import (
    BUILTIN_OPENAI_CONNECTION_ID,
    MODEL_SOURCE_BUILTIN,
    ModelConnection,
)

CREDENTIAL_CONFIGURED = "configured"
CREDENTIAL_MISSING = "missing"
CREDENTIAL_NOT_REQUIRED = "not_required"

MANAGED_CREDENTIAL_ENV_PATTERN = re.compile(r"^ANIMAMA_CONNECTION_[A-Z0-9_]{1,64}_API_KEY$")
"""Names for owner connection keys; the desktop vault writes keys under this namespace."""

KNOWN_PROVIDER_CREDENTIAL_ENVS = frozenset({"OPENAI_API_KEY", "DEEPSEEK_API_KEY", "HF_TOKEN"})
"""Conventional provider key variables an owner connection may also reference."""


WEB_SEARCH_MANAGED_CREDENTIAL_ENV = "ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY"
"""The desktop vault's name for the web search key (inside the managed namespace, so no new vault field)."""

WEB_SEARCH_CREDENTIAL_ENVS = frozenset({WEB_SEARCH_MANAGED_CREDENTIAL_ENV, "BRAVE_SEARCH_API_KEY"})
"""Names the web search backend may read its key from."""


def is_allowed_credential_env(name: str) -> bool:
    """Return whether an owner connection may read a key from ``name``.

    References are limited to model-key names so a connection cannot send an
    unrelated process secret (such as a database URL) to its endpoint. The web
    search key is not a model key, so no connection may read it.
    """

    if name == WEB_SEARCH_MANAGED_CREDENTIAL_ENV:
        return False
    return name in KNOWN_PROVIDER_CREDENTIAL_ENVS or bool(MANAGED_CREDENTIAL_ENV_PATTERN.fullmatch(name))


def is_allowed_web_search_credential_env(name: str) -> bool:
    """Return whether the web search backend may read its key from ``name``."""

    return name in WEB_SEARCH_CREDENTIAL_ENVS


def managed_credential_env(connection_id: str) -> str:
    """Return the managed key variable name for a generated connection id.

    Generated ids use only lowercase letters, digits and underscores, so the
    mapping is one-to-one; other ids are rejected rather than risk two
    connections sharing one key.
    """

    if not re.fullmatch(r"[a-z0-9_]{1,48}", connection_id):
        raise ValueError(f"Connection id cannot name a managed key: {connection_id!r}")
    return f"ANIMAMA_CONNECTION_{connection_id.upper()}_API_KEY"


def builtin_openai_connection() -> ModelConnection:
    """Return the built-in OpenAI connection, which uses process OpenAI settings."""

    return ModelConnection(
        id=BUILTIN_OPENAI_CONNECTION_ID,
        name="OpenAI",
        preset=PRESET_OPENAI,
        source=MODEL_SOURCE_BUILTIN,
    )


def connection_for_model_provider(model_provider: ModelProvider) -> ModelConnection:
    """Return the row's loaded connection.

    Only built-in OpenAI rows may omit it (rows built outside the database). A
    row on another connection without its loaded connection is rejected so its
    request can never fall back to OpenAI.
    """

    if model_provider.connection is not None:
        return model_provider.connection
    if model_provider.connection_id == BUILTIN_OPENAI_CONNECTION_ID:
        return builtin_openai_connection()
    raise ValueError(f"Model connection is not loaded for {model_provider.id}")


@dataclass(frozen=True, slots=True)
class ModelCredential:
    """Resolved key state for one connection; the key is excluded from ``repr``."""

    state: str
    api_key: str | None = field(default=None, repr=False)

    @property
    def usable(self) -> bool:
        return self.state != CREDENTIAL_MISSING


class ModelCredentialResolver(Protocol):
    """Resolve the key for a connection without persisting it."""

    def resolve(self, connection: ModelConnection) -> ModelCredential: ...


class EnvironmentModelCredentialResolver:
    """Resolve keys from the process OpenAI key and environment variables."""

    def __init__(self, *, openai_api_key: str | None, environ: Mapping[str, str]) -> None:
        self._openai_api_key = (openai_api_key or "").strip()
        self._environ = environ

    def resolve(self, connection: ModelConnection) -> ModelCredential:
        if connection.is_builtin_openai:
            return _credential(self._openai_api_key)
        name = (connection.credential_env or "").strip()
        if not name:
            return ModelCredential(state=CREDENTIAL_NOT_REQUIRED)
        if not is_allowed_credential_env(name):
            return ModelCredential(state=CREDENTIAL_MISSING)
        return _credential((self._environ.get(name) or "").strip())


def _credential(value: str) -> ModelCredential:
    if value:
        return ModelCredential(state=CREDENTIAL_CONFIGURED, api_key=value)
    return ModelCredential(state=CREDENTIAL_MISSING)


__all__ = [
    "WEB_SEARCH_CREDENTIAL_ENVS",
    "WEB_SEARCH_MANAGED_CREDENTIAL_ENV",
    "is_allowed_web_search_credential_env",
    "CREDENTIAL_CONFIGURED",
    "CREDENTIAL_MISSING",
    "CREDENTIAL_NOT_REQUIRED",
    "KNOWN_PROVIDER_CREDENTIAL_ENVS",
    "MANAGED_CREDENTIAL_ENV_PATTERN",
    "EnvironmentModelCredentialResolver",
    "ModelCredential",
    "ModelCredentialResolver",
    "builtin_openai_connection",
    "connection_for_model_provider",
    "is_allowed_credential_env",
    "managed_credential_env",
]
