"""Explicit browser metadata for product-route tests using an ASGI transport.

Boundary tests construct their own clients to test omitted or hostile inputs.
This helper grants no identity: normal admission and fixture bootstrap still
apply, and each route test retains its explicit principal dependency override.
"""

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from animama.local.http.config import canonical_origin


def local_client(application: FastAPI) -> AsyncClient:
    settings = getattr(application.state, "runtime_settings", None)
    origin = canonical_origin(getattr(settings, "animama_public_origin", "http://localhost:8000"))
    return AsyncClient(
        transport=ASGITransport(app=application),
        base_url=origin,
        headers={"origin": origin, "sec-fetch-site": "same-origin", "x-animama-csrf": "1"},
    )
