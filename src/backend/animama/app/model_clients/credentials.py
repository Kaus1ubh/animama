"""Per-connection model credentials.

Model clients ask a :class:`ModelCredentialResolver` for the key of the
connection that owns the selected catalog row. A key is never shared across
connections: the built-in OpenAI connection uses only the OpenAI key, the
built-in Anthropic connection uses only the Anthropic key, and an owner
connection uses only the key variable it names. Keys come from the process's
:class:`~animama.app.model_clients.credential_store.RuntimeCredentialStore`,
never directly from ``os.environ``. Values are never stored in the database or
returned by APIs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Protocol

from animama.app.model_clients.credential_store import (
    ANTHROPIC_CREDENTIAL_ENV,
    KNOWN_PROVIDER_CREDENTIAL_ENVS,
    MANAGED_CREDENTIAL_ENV_PATTERN,
    OPENAI_CREDENTIAL_ENV,
    WEB_SEARCH_CREDENTIAL_ENVS,
    WEB_SEARCH_MANAGED_CREDENTIAL_ENV,
    CredentialSource,
    FixedCredentials,
    is_allowed_credential_env,
)
from animama.app.model_connection_presets import (
    ANTHROPIC_CONNECTION_COMPATIBILITY,
    PRESET_ANTHROPIC,
    PRESET_OPENAI,
)
from animama.domain import ModelProvider
from animama.domain.model_connection import (
    BUILTIN_ANTHROPIC_CONNECTION_ID,
    BUILTIN_OPENAI_CONNECTION_ID,
    MODEL_SOURCE_BUILTIN,
    ModelConnection,
)

CREDENTIAL_CONFIGURED = "configured"
CREDENTIAL_MISSING = "missing"
CREDENTIAL_NOT_REQUIRED = "not_required"


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


def builtin_anthropic_connection() -> ModelConnection:
    """Return the built-in Anthropic connection, which uses ``ANTHROPIC_API_KEY``."""

    return ModelConnection(
        id=BUILTIN_ANTHROPIC_CONNECTION_ID,
        name="Anthropic",
        preset=PRESET_ANTHROPIC,
        source=MODEL_SOURCE_BUILTIN,
        compatibility=ANTHROPIC_CONNECTION_COMPATIBILITY,
    )


_BUILTIN_CONNECTIONS = {
    BUILTIN_OPENAI_CONNECTION_ID: builtin_openai_connection,
    BUILTIN_ANTHROPIC_CONNECTION_ID: builtin_anthropic_connection,
}

_BUILTIN_CREDENTIAL_ENVS = {
    BUILTIN_OPENAI_CONNECTION_ID: OPENAI_CREDENTIAL_ENV,
    BUILTIN_ANTHROPIC_CONNECTION_ID: ANTHROPIC_CREDENTIAL_ENV,
}
"""The only key each built-in connection may use; neither falls back to the other's."""


def builtin_connection(connection_id: str) -> ModelConnection | None:
    """Return the built-in connection with this id, or ``None`` for owner connections."""

    factory = _BUILTIN_CONNECTIONS.get(connection_id)
    return factory() if factory is not None else None


def builtin_model_connections() -> list[ModelConnection]:
    """Return every release-managed connection, OpenAI first."""

    return [factory() for factory in _BUILTIN_CONNECTIONS.values()]


def connection_for_model_provider(model_provider: ModelProvider) -> ModelConnection:
    """Return the row's loaded connection.

    Only rows on a built-in connection may omit it (rows built outside the
    database). A row on an owner connection without its loaded connection is
    rejected so its request can never fall back to a built-in connection.
    """

    if model_provider.connection is not None:
        return model_provider.connection
    connection = builtin_connection(model_provider.connection_id)
    if connection is not None:
        return connection
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


class StoreModelCredentialResolver:
    """Resolve keys from the runtime credential store on every call.

    Each ``resolve`` reads the context's current snapshot (the one pinned for
    the request, or the latest), so a changed key applies to the next request
    without rebuilding clients. Callers resolve once per request and reuse the
    result so one request never mixes keys.
    """

    def __init__(self, store: CredentialSource) -> None:
        self._store = store

    def resolve(self, connection: ModelConnection) -> ModelCredential:
        snapshot = self._store.current()
        builtin_env = _BUILTIN_CREDENTIAL_ENVS.get(connection.id)
        if builtin_env is not None:
            return _credential(snapshot.get(builtin_env))
        name = (connection.credential_env or "").strip()
        if not name:
            return ModelCredential(state=CREDENTIAL_NOT_REQUIRED)
        if not is_allowed_credential_env(name):
            return ModelCredential(state=CREDENTIAL_MISSING)
        return _credential(snapshot.get(name))


def static_credential_resolver(values: dict[str, str] | None = None) -> StoreModelCredentialResolver:
    """Resolve from a fixed set of keys, for clients built without the process store."""

    return StoreModelCredentialResolver(FixedCredentials(values))


def _credential(value: str | None) -> ModelCredential:
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
    "ModelCredential",
    "ModelCredentialResolver",
    "StoreModelCredentialResolver",
    "builtin_anthropic_connection",
    "builtin_connection",
    "builtin_model_connections",
    "builtin_openai_connection",
    "connection_for_model_provider",
    "is_allowed_credential_env",
    "managed_credential_env",
    "static_credential_resolver",
]
