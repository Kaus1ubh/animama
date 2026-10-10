"""Mount the shared product HTTP package from an installed wheel, with local code blocked.

Run with Python isolated mode from outside the source checkout. Importing a local
composition module fails here, so the shared package cannot depend on one.
"""

from __future__ import annotations

import importlib.abc
import json
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

FORBIDDEN = ("animama.local", "animama.server", "animama.runtime", "animama.hooks", "animama.logging_config")


class LocalImportBlocker(importlib.abc.MetaPathFinder):
    """Refuse every local composition module a shared import might reach."""

    def find_spec(self, fullname, path=None, target=None):  # noqa: ANN001, ANN201
        if any(fullname == prefix or fullname.startswith(prefix + ".") for prefix in FORBIDDEN):
            raise ImportError(f"shared product HTTP imported local module {fullname}")
        return None


# Block local modules before the shared package (and anything it imports) loads.
sys.meta_path.insert(0, LocalImportBlocker())

from fastapi import FastAPI, Request, WebSocket  # noqa: E402
from fastapi.routing import APIRoute  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from animama.adapters.repositories.sqlalchemy.product_repositories import (  # noqa: E402
    SQLAlchemyProductRepositories,
)
from animama.domain.request_principal import RequestPrincipal  # noqa: E402
from animama.product_http.inventory import ROUTES, SERVED_STAGES  # noqa: E402
from animama.product_http.ports import ReadSession, WriteSession, install_product_ports  # noqa: E402
from animama.product_http.routes import ROUTERS  # noqa: E402

OWNER = RequestPrincipal(id="consumer-owner")


class Owner:
    """A consumer's resolver: every request belongs to OWNER."""

    async def resolve_http(self, request: Request) -> RequestPrincipal:
        return OWNER

    async def resolve_websocket(self, websocket: WebSocket) -> RequestPrincipal:
        return OWNER


class Ports:
    """A consumer's ports with placeholder sessions; it can fail its deferred commit."""

    def __init__(self, *, fail_commit: bool = False) -> None:
        self.opened: list[tuple[str, str]] = []
        self.fail_commit = fail_commit

    @asynccontextmanager
    async def read_session(self, principal: RequestPrincipal) -> AsyncIterator[object]:
        self.opened.append(("read", principal.id))
        yield object()

    @asynccontextmanager
    async def write_session(self, principal: RequestPrincipal) -> AsyncIterator[object]:
        self.opened.append(("write", principal.id))
        yield object()
        if self.fail_commit:
            raise RuntimeError("deferred commit failed")


def consumer_app(*, ports: Ports | None, resolver: Owner | None) -> FastAPI:
    """Mount every shared router, plus session probes, the way a consumer would."""

    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)
    if resolver is not None:
        app.state.request_principal_resolver = resolver
    if ports is not None:
        install_product_ports(app, ports)  # type: ignore[arg-type]

    @app.get("/probe/read")
    async def read(session: ReadSession) -> dict[str, bool]:
        return {"ok": True}

    @app.post("/probe/write")
    async def write(session: WriteSession) -> dict[str, bool]:
        return {"ok": True}

    return app


def probe(app: FastAPI) -> list[tuple[int, object]]:
    with TestClient(app, raise_server_exceptions=False) as client:
        responses = [client.get("/probe/read"), client.post("/probe/write")]
    return [(response.status_code, response.json() if response.status_code != 500 else None) for response in responses]


def main() -> None:
    # The routers mount exactly the shared inventory routes of the stages the package serves.
    shared = {
        (spec.method, spec.path, spec.handler)
        for spec in ROUTES
        if spec.disposition == "shared" and spec.stage in SERVED_STAGES
    }
    mounted = {
        (method, route.path, route.endpoint.__name__)
        for route in consumer_app(ports=None, resolver=None).routes
        if isinstance(route, APIRoute) and not route.path.startswith("/probe/")
        for method in route.methods
    }
    assert mounted == shared, sorted(mounted ^ shared)

    missing_ports = {"detail": {"code": "product_ports_unavailable"}}
    assert probe(consumer_app(ports=None, resolver=Owner())) == [(503, missing_ports)] * 2

    # No session opens for a request whose owner is unknown.
    ports = Ports()
    missing_principal = {"detail": {"code": "request_principal_unavailable"}}
    assert probe(consumer_app(ports=ports, resolver=None)) == [(503, missing_principal)] * 2
    assert ports.opened == []

    assert probe(consumer_app(ports=ports, resolver=Owner())) == [(200, {"ok": True})] * 2
    assert ports.opened == [("read", OWNER.id), ("write", OWNER.id)]

    # A failed deferred commit replaces the handler's success.
    assert [status for status, _ in probe(consumer_app(ports=Ports(fail_commit=True), resolver=Owner()))] == [200, 500]

    # The shared repository bundle a consumer may reuse builds every repository without local code.
    bundle = SQLAlchemyProductRepositories(object())  # type: ignore[arg-type]
    for name in dir(type(bundle)):
        if not name.startswith("_"):
            getattr(bundle, name)

    leaked = sorted(name for name in sys.modules if any(name == p or name.startswith(p + ".") for p in FORBIDDEN))
    assert not leaked, leaked
    print(json.dumps({"inventory_routes": len(ROUTES), "mounted_shared_routes": len(mounted), "local_imports": 0}))


if __name__ == "__main__":
    main()
