"""Owner web search settings routes and composition boundary (configurable models Plan B, R11)."""

from __future__ import annotations

import logging
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from sqlalchemy import delete

from animama.app.web_search import WebSearchError
from animama.domain.request_principal import RequestPrincipal
from animama.domain.web_search import WebSearchResult
from animama.orm import ORMWebSearchSettings
from animama.server.config import Settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers import router as shared_router, runtime_capabilities, web_search as web_search_routes
from tests.local_http_client import local_client


def _app(session, tmp_path, *, local: bool = True) -> FastAPI:  # noqa: ANN001
    app = FastAPI()
    app.state.runtime_settings = Settings(
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
        animama_user_file_processing_enabled=False,
    )
    if local:
        app.state.application_web_search_enabled = True
        app.include_router(web_search_routes.router)
    app.include_router(runtime_capabilities.router)

    async def principal():
        return RequestPrincipal(id=f"owner-{uuid4().hex[:8]}")

    async def database():
        yield session

    app.dependency_overrides[get_current_principal] = principal
    app.dependency_overrides[get_async_session] = database
    return app


@pytest.fixture(autouse=True)
async def _clean_settings(async_session):  # noqa: ANN001
    await async_session.execute(delete(ORMWebSearchSettings))
    await async_session.commit()
    yield
    await async_session.execute(delete(ORMWebSearchSettings))
    await async_session.commit()


def test_only_the_local_composition_mounts_web_search_routes(tmp_path):
    from animama.server.app import create_local_app

    search_paths = {route.path for route in web_search_routes.router.routes if isinstance(route, APIRoute)}
    shared_paths = {route.path for route in shared_router.routes if isinstance(route, APIRoute)}
    local_app = create_local_app(
        runtime_settings=Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    local_paths = {route.path for route in local_app.routes if isinstance(route, APIRoute)}

    assert "/v1/web-search/settings" in search_paths
    assert not search_paths & shared_paths
    assert search_paths <= local_paths
    assert local_app.state.application_web_search_enabled is True


async def test_settings_store_a_key_reference_and_never_its_value(
    async_session, tmp_path, set_runtime_credentials, caplog
):
    set_runtime_credentials(ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY="brave-secret-value")
    app = _app(async_session, tmp_path)

    with caplog.at_level(logging.INFO):
        async with local_client(app) as client:
            empty = (await client.get("/v1/web-search/settings")).json()
            saved = await client.put(
                "/v1/web-search/settings", json={"backend": "brave", "credential": {"mode": "managed"}}
            )
            listed = (await client.get("/v1/web-search/settings")).json()

    assert empty["configured"] is False
    assert empty["managed_credential_env"] == "ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY"
    assert saved.status_code == 200
    assert listed == saved.json()
    assert listed["backend"] == "brave"
    assert listed["credential_env"] == "ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY"
    assert listed["credential_state"] == "configured"
    assert "brave-secret-value" not in saved.text
    assert "brave-secret-value" not in caplog.text
    row = await async_session.get(ORMWebSearchSettings, "installation")
    assert row is not None and "brave-secret-value" not in repr(vars(row))


async def test_invalid_settings_are_rejected_with_a_code(async_session, tmp_path):
    app = _app(async_session, tmp_path)

    async with local_client(app) as client:
        response = await client.put(
            "/v1/web-search/settings",
            json={"backend": "brave", "credential": {"mode": "env", "env": "DATABASE_URL"}},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_credential_env"


async def test_test_reports_the_backend_result(async_session, tmp_path, monkeypatch):
    class _Backend:
        def __init__(self, error: WebSearchError | None = None) -> None:
            self.error = error

        async def search(self, query: str, *, count: int) -> list[WebSearchResult]:
            if self.error is not None:
                raise self.error
            return [WebSearchResult(title="T", url="https://e.com", snippet="")]

    backends = iter([_Backend(), _Backend(WebSearchError("x", category="json_format_disabled"))])
    monkeypatch.setattr(web_search_routes, "build_web_search_backend", lambda _settings: next(backends))
    app = _app(async_session, tmp_path)
    body = {"backend": "searxng", "base_url": "http://127.0.0.1:8888"}

    async with local_client(app) as client:
        passing = (await client.post("/v1/web-search/settings/test", json=body)).json()
        failing = (await client.post("/v1/web-search/settings/test", json=body)).json()
        unsaved = await client.post("/v1/web-search/settings/test")

    assert passing == {"ok": True, "category": None, "result_count": 1}
    assert failing == {"ok": False, "category": "json_format_disabled", "result_count": 0}
    assert unsaved.status_code == 400
    assert unsaved.json()["detail"]["code"] == "web_search_not_configured"


async def test_clearing_turns_search_off(async_session, tmp_path):
    app = _app(async_session, tmp_path)

    async with local_client(app) as client:
        await client.put("/v1/web-search/settings", json={"backend": "searxng", "base_url": "http://127.0.0.1:8888"})
        configured = (await client.get("/v1/runtime-capabilities")).json()["web_search"]
        cleared = await client.delete("/v1/web-search/settings")
        after = (await client.get("/v1/runtime-capabilities")).json()["web_search"]

    assert configured == {
        "configuration": True,
        "configured": True,
        "backend": "searxng",
        "credential_state": "not_required",
    }
    assert cleared.status_code == 204
    assert after == {"configuration": True, "configured": False, "backend": None, "credential_state": None}


async def test_other_compositions_offer_no_web_search(async_session, tmp_path):
    from animama.server.web_search import turn_web_search_tool

    async_session.add(ORMWebSearchSettings(id="installation", backend="searxng", base_url="http://127.0.0.1:8888"))
    await async_session.commit()
    hosted = _app(async_session, tmp_path, local=False)

    async with local_client(hosted) as client:
        view = (await client.get("/v1/runtime-capabilities")).json()["web_search"]
        missing = await client.get("/v1/web-search/settings")

    assert view == {"configuration": False, "configured": False, "backend": None, "credential_state": None}
    assert missing.status_code == 404
    assert await turn_web_search_tool(async_session, enabled=False) is None
    assert await turn_web_search_tool(async_session, enabled=True) is not None
