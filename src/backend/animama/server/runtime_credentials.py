"""The process's provider credentials and their boundary with ``os.environ``.

Startup loads provider and connection keys from the environment once into
:data:`runtime_credentials`. Every consumer reads that store, never the
environment, so the embedded desktop backend can replace keys while it runs.
"""

from __future__ import annotations

import os
from collections.abc import MutableMapping

from starlette.types import ASGIApp, Receive, Scope, Send

from animama.app.model_clients.credential_store import (
    OPENAI_CREDENTIAL_ENV,
    CredentialSnapshot,
    RuntimeCredentialStore,
    credential_values_from_environment,
    is_process_credential_env,
)

runtime_credentials = RuntimeCredentialStore(credential_values_from_environment(os.environ))
"""The single credential store for this process."""


def scrub_credential_environment(environ: MutableMapping[str, str] | None = None) -> None:
    """Remove credential names from the process environment after startup loaded them.

    The desktop backend's keys can change while it runs, so a copy left in the
    environment would go stale: SDK environment fallbacks could keep sending a
    removed key, and child processes would inherit it.
    """

    target = os.environ if environ is None else environ
    for name in [name for name in target if is_process_credential_env(name)]:
        del target[name]


_trace_export_followed = False


def follow_trace_export_key() -> None:
    """Keep the ``openai-agents`` trace exporter on the current OpenAI key.

    The exporter otherwise falls back to ``os.environ["OPENAI_API_KEY"]``,
    which the desktop backend scrubs. Setting the key on the exporter (rather
    than per run) keeps key-derived fingerprints out of persisted run state.
    Idempotent; the application factory calls it.
    """

    global _trace_export_followed
    if _trace_export_followed:
        return
    from agents import set_tracing_export_api_key

    def apply(_previous: CredentialSnapshot, current: CredentialSnapshot) -> None:
        set_tracing_export_api_key(current.get(OPENAI_CREDENTIAL_ENV) or "")

    snapshot = runtime_credentials.snapshot()
    apply(snapshot, snapshot)
    runtime_credentials.subscribe(apply)
    _trace_export_followed = True


class PinnedCredentialsMiddleware:
    """Pin the current credentials for each HTTP request and WebSocket.

    A request, and every task it starts, finishes on the keys it was admitted
    with; a replacement applies to the next request. Background loops outside
    a request read the latest snapshot for each unit of work.
    """

    def __init__(self, app: ASGIApp, *, store: RuntimeCredentialStore = runtime_credentials) -> None:
        self.app = app
        self.store = store

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        with self.store.pinned():
            await self.app(scope, receive, send)


__all__ = [
    "PinnedCredentialsMiddleware",
    "follow_trace_export_key",
    "runtime_credentials",
    "scrub_credential_environment",
]
