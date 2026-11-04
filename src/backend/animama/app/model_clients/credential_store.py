"""In-memory provider credentials that can change while the process runs.

One :class:`RuntimeCredentialStore` per process holds the current keys as an
immutable :class:`CredentialSnapshot`. Replacing the store swaps the whole
snapshot in one assignment, so a reader sees either every old value or every
new one. Work that must finish on the keys it started with pins a snapshot with
:meth:`RuntimeCredentialStore.pinned`; tasks it starts inherit the pin.

Values live only here. They are never written to ``os.environ``, never part of
a ``repr`` and never included in an error message.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Protocol

from animama.logging import get_logger

_log = get_logger("app.model_clients.credential_store")

OPENAI_CREDENTIAL_ENV = "OPENAI_API_KEY"
ANTHROPIC_CREDENTIAL_ENV = "ANTHROPIC_API_KEY"
ELEVENLABS_CREDENTIAL_ENV = "ELEVENLABS_API_KEY"
GEMINI_CREDENTIAL_ENV = "GEMINI_API_KEY"

MANAGED_CREDENTIAL_ENV_PATTERN = re.compile(r"^ANIMAMA_CONNECTION_[A-Z0-9_]{1,64}_API_KEY$")
"""Names for owner connection keys; the desktop vault writes keys under this namespace."""

KNOWN_PROVIDER_CREDENTIAL_ENVS = frozenset(
    {OPENAI_CREDENTIAL_ENV, "DEEPSEEK_API_KEY", "HF_TOKEN", "OPENROUTER_API_KEY"}
)
"""Conventional provider key variables an owner connection may also reference.

``ANTHROPIC_API_KEY`` and ``GEMINI_API_KEY`` are deliberately absent: only the
built-in Anthropic connection and the Gemini voice read them, so each is sent
only to its own provider's API.
"""

WEB_SEARCH_MANAGED_CREDENTIAL_ENV = "ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY"
"""The desktop vault's name for the web search key (inside the managed namespace, so no new vault field)."""

WEB_SEARCH_CREDENTIAL_ENVS = frozenset({WEB_SEARCH_MANAGED_CREDENTIAL_ENV, "BRAVE_SEARCH_API_KEY"})
"""Names the web search backend may read its key from."""

MAX_CREDENTIAL_LENGTH = 8192
"""Longest accepted key, matching the desktop vault."""

MAX_CONNECTION_CREDENTIALS = 32
"""Most managed connection keys one delivery may carry, matching the desktop vault."""

_INVALID_VALUE_CHARACTER = re.compile(r"[\x00-\x20\x7f]")


class CredentialStoreError(ValueError):
    """A refused replacement. ``code`` is stable; messages never name values."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def is_allowed_credential_env(name: str) -> bool:
    """Return whether an owner connection may read a key from ``name``.

    References are limited to model-key names so a connection cannot send an
    unrelated process secret (such as a database URL) to its endpoint. The web
    search key is not a model key, so no connection may read it.
    """

    if name == WEB_SEARCH_MANAGED_CREDENTIAL_ENV:
        return False
    return name in KNOWN_PROVIDER_CREDENTIAL_ENVS or bool(MANAGED_CREDENTIAL_ENV_PATTERN.fullmatch(name))


def is_process_credential_env(name: str) -> bool:
    """Return whether startup may load ``name`` from the process environment."""

    return (
        name in {ELEVENLABS_CREDENTIAL_ENV, ANTHROPIC_CREDENTIAL_ENV, GEMINI_CREDENTIAL_ENV}
        or name in WEB_SEARCH_CREDENTIAL_ENVS
        or is_allowed_credential_env(name)
    )


def is_deliverable_credential_env(name: str) -> bool:
    """Return whether a runtime replacement may set ``name``.

    This is the desktop vault's namespace: the OpenAI, Anthropic, ElevenLabs and
    Gemini keys and managed connection keys. It is deliberately narrower than what
    startup reads, so a delivery can never name an arbitrary environment
    variable.
    """

    return name in {
        OPENAI_CREDENTIAL_ENV,
        ANTHROPIC_CREDENTIAL_ENV,
        ELEVENLABS_CREDENTIAL_ENV,
        GEMINI_CREDENTIAL_ENV,
    } or bool(MANAGED_CREDENTIAL_ENV_PATTERN.fullmatch(name))


def credential_values_from_environment(environ: Mapping[str, str]) -> dict[str, str]:
    """Return trimmed, non-empty credential values from a process environment."""

    values: dict[str, str] = {}
    for name, value in environ.items():
        if is_process_credential_env(name) and (trimmed := value.strip()):
            values[name] = trimmed
    return values


def _validated_delivery(values: Mapping[str, object]) -> dict[str, str]:
    if not isinstance(values, Mapping):
        raise CredentialStoreError("credentials_invalid")
    connections = 0
    validated: dict[str, str] = {}
    for name, value in values.items():
        if not isinstance(name, str) or not is_deliverable_credential_env(name):
            raise CredentialStoreError("credentials_invalid")
        if (
            not isinstance(value, str)
            or not 1 <= len(value) <= MAX_CREDENTIAL_LENGTH
            or _INVALID_VALUE_CHARACTER.search(value)
        ):
            raise CredentialStoreError("credentials_invalid")
        if MANAGED_CREDENTIAL_ENV_PATTERN.fullmatch(name):
            connections += 1
        validated[name] = value
    if connections > MAX_CONNECTION_CREDENTIALS:
        raise CredentialStoreError("credentials_invalid")
    return validated


@dataclass(frozen=True, slots=True, eq=False)
class CredentialSnapshot:
    """One immutable set of keys; ``generation`` orders replacements."""

    generation: int
    _values: Mapping[str, str] = field(repr=False)

    def get(self, name: str) -> str | None:
        return self._values.get(name)

    def names(self) -> frozenset[str]:
        return frozenset(self._values)

    def __repr__(self) -> str:
        return f"CredentialSnapshot(generation={self.generation}, names={sorted(self._values)})"


CredentialListener = Callable[[CredentialSnapshot, CredentialSnapshot], None]


class CredentialSource(Protocol):
    """Anything that supplies the snapshot for the current context."""

    def current(self) -> CredentialSnapshot: ...


class FixedCredentials:
    """A constant snapshot, for clients built outside the process store."""

    def __init__(self, values: Mapping[str, str] | None = None) -> None:
        self._snapshot = CredentialSnapshot(0, MappingProxyType(dict(values or {})))

    def current(self) -> CredentialSnapshot:
        return self._snapshot


class RuntimeCredentialStore:
    """The process's current credentials, replaced whole by newer generations."""

    def __init__(self, values: Mapping[str, str] | None = None) -> None:
        self._snapshot = CredentialSnapshot(0, MappingProxyType(dict(values or {})))
        self._listeners: list[CredentialListener] = []
        self._pinned: ContextVar[CredentialSnapshot | None] = ContextVar(
            f"animama_pinned_credentials_{id(self)}", default=None
        )

    def __repr__(self) -> str:
        return f"RuntimeCredentialStore({self._snapshot!r})"

    def snapshot(self) -> CredentialSnapshot:
        """The latest snapshot, ignoring any pin."""

        return self._snapshot

    def current(self) -> CredentialSnapshot:
        """The snapshot pinned for this context, or the latest one."""

        return self._pinned.get() or self._snapshot

    @contextmanager
    def pinned(self) -> Iterator[CredentialSnapshot]:
        """Keep this context (and tasks it starts) on the current snapshot."""

        snapshot = self.current()
        token = self._pinned.set(snapshot)
        try:
            yield snapshot
        finally:
            self._pinned.reset(token)

    def subscribe(self, listener: CredentialListener) -> None:
        """Call ``listener(previous, current)`` after each replacement."""

        self._listeners.append(listener)

    def replace(self, values: Mapping[str, object], *, generation: int) -> CredentialSnapshot:
        """Validate and install a complete delivery; absent names are removed."""

        if type(generation) is not int or generation < 1:
            raise CredentialStoreError("credentials_invalid")
        if generation <= self._snapshot.generation:
            raise CredentialStoreError("credentials_generation_stale")
        validated = _validated_delivery(values)
        return self._install(CredentialSnapshot(generation, MappingProxyType(validated)))

    def reset(self, values: Mapping[str, str]) -> CredentialSnapshot:
        """Install startup values at generation 0, bypassing delivery rules.

        For process startup and tests only; a running desktop backend changes
        credentials through :meth:`replace`.
        """

        return self._install(CredentialSnapshot(0, MappingProxyType(dict(values))))

    def _install(self, snapshot: CredentialSnapshot) -> CredentialSnapshot:
        previous, self._snapshot = self._snapshot, snapshot
        for listener in list(self._listeners):
            # The swap already happened; a failing cache invalidation must not
            # report the delivery as refused. Log only the listener's type.
            try:
                listener(previous, snapshot)
            except Exception as exc:
                _log.error(
                    "Credential listener failed",
                    listener=getattr(listener, "__qualname__", "?"),
                    error_type=type(exc).__name__,
                )
        return snapshot


__all__ = [
    "ANTHROPIC_CREDENTIAL_ENV",
    "ELEVENLABS_CREDENTIAL_ENV",
    "GEMINI_CREDENTIAL_ENV",
    "KNOWN_PROVIDER_CREDENTIAL_ENVS",
    "MANAGED_CREDENTIAL_ENV_PATTERN",
    "MAX_CONNECTION_CREDENTIALS",
    "MAX_CREDENTIAL_LENGTH",
    "OPENAI_CREDENTIAL_ENV",
    "WEB_SEARCH_CREDENTIAL_ENVS",
    "WEB_SEARCH_MANAGED_CREDENTIAL_ENV",
    "CredentialListener",
    "CredentialSnapshot",
    "CredentialSource",
    "CredentialStoreError",
    "RuntimeCredentialStore",
    "FixedCredentials",
    "credential_values_from_environment",
    "is_allowed_credential_env",
    "is_deliverable_credential_env",
    "is_process_credential_env",
]
