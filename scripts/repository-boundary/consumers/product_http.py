"""Mount the shared product HTTP package from an installed wheel, with local code blocked.

Run with Python isolated mode from outside the source checkout. Importing a local
composition module fails here, so the shared package cannot depend on one.
"""

from __future__ import annotations

import importlib.abc
import json
import sys

FORBIDDEN = ("animama.local", "animama.server", "animama.runtime", "animama.hooks", "animama.logging_config")


class LocalImportBlocker(importlib.abc.MetaPathFinder):
    """Refuse every local composition module a shared import might reach."""

    def find_spec(self, fullname, path=None, target=None):  # noqa: ANN001, ANN201
        if any(fullname == prefix or fullname.startswith(prefix + ".") for prefix in FORBIDDEN):
            raise ImportError(f"shared product HTTP imported local module {fullname}")
        return None


# Block local modules before the shared package (and anything it imports) loads.
sys.meta_path.insert(0, LocalImportBlocker())

from fastapi import FastAPI  # noqa: E402
from fastapi.routing import APIRoute  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from animama.product_http.inventory import ROUTES  # noqa: E402
from animama.product_http.ports import ReadSession, WriteSession  # noqa: E402
from animama.product_http.routes import ROUTERS  # noqa: E402


def main() -> None:
    # Every mounted shared route is a shared inventory route.
    shared = {(spec.method, spec.path, spec.handler) for spec in ROUTES if spec.disposition == "shared"}
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)
    mounted = {
        (method, route.path, route.endpoint.__name__)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    }
    assert mounted <= shared, sorted(mounted - shared)

    @app.get("/probe/read")
    async def read(session: ReadSession) -> dict[str, bool]:
        return {"ok": True}

    @app.post("/probe/write")
    async def write(session: WriteSession) -> dict[str, bool]:
        return {"ok": True}

    with TestClient(app) as client:
        for response in (client.get("/probe/read"), client.post("/probe/write")):
            assert response.status_code == 503, response.text
            assert response.json() == {"detail": {"code": "product_ports_unavailable"}}

    leaked = sorted(name for name in sys.modules if any(name == p or name.startswith(p + ".") for p in FORBIDDEN))
    assert not leaked, leaked
    print(json.dumps({"inventory_routes": len(ROUTES), "mounted_shared_routes": len(mounted), "local_imports": 0}))


if __name__ == "__main__":
    main()
