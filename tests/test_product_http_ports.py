"""Shared routes take per-owner sessions from composition-installed ports (ADR 0021)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

from fastapi import FastAPI, Request, WebSocket
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import (
    ProductPolicy,
    ReadRepositories,
    ReadSession,
    WriteRepositories,
    WriteSession,
    install_product_ports,
)
from animama.server.app import create_local_app
from animama.server.config import Settings
from animama.server.product_ports import LocalProductPorts

OWNER = RequestPrincipal(id="owner")


class FixedOwner:
    async def resolve_http(self, request: Request) -> RequestPrincipal:
        return OWNER

    async def resolve_websocket(self, websocket: WebSocket) -> RequestPrincipal:
        return OWNER


def session_probe_app(*, resolver: object | None = FixedOwner()) -> FastAPI:
    app = FastAPI()
    if resolver is not None:
        app.state.request_principal_resolver = resolver

    @app.get("/read")
    async def read(session: ReadSession) -> dict[str, str]:
        return {"session": str(session)}

    @app.post("/write")
    async def write(session: WriteSession) -> dict[str, str]:
        return {"session": str(session)}

    return app


class RecordingPorts:
    """Opens placeholder sessions and records whose they are; can fail the deferred commit."""

    policy = ProductPolicy(memory_file_max_bytes=1)

    def __init__(self, *, fail_commit: bool = False) -> None:
        self.opened: list[tuple[str, str]] = []
        self.fail_commit = fail_commit

    @asynccontextmanager
    async def read_session(self, principal: RequestPrincipal) -> AsyncIterator[AsyncSession]:
        self.opened.append(("read", principal.id))
        yield MagicMock(spec=AsyncSession)

    @asynccontextmanager
    async def write_session(self, principal: RequestPrincipal) -> AsyncIterator[AsyncSession]:
        self.opened.append(("write", principal.id))
        yield MagicMock(spec=AsyncSession)
        if self.fail_commit:
            raise RuntimeError("deferred commit failed")

    def repositories(self, session: AsyncSession) -> Any:
        return SimpleNamespace(session=session)

    async def update_display_name(self, session: AsyncSession, principal: RequestPrincipal, display_name: str) -> str:
        return display_name

    def user_settings_changed(self, principal: RequestPrincipal) -> None:
        pass


def test_shared_routes_fail_closed_without_installed_ports() -> None:
    with TestClient(session_probe_app()) as client:
        responses = [client.get("/read"), client.post("/write")]
    for response in responses:
        assert response.status_code == 503
        assert response.json() == {"detail": {"code": "product_ports_unavailable"}}


def test_no_session_opens_before_the_principal_resolves() -> None:
    app = session_probe_app(resolver=None)
    ports = RecordingPorts()
    install_product_ports(app, ports)
    with TestClient(app) as client:
        responses = [client.get("/read"), client.post("/write")]
    for response in responses:
        assert response.status_code == 503
        assert response.json() == {"detail": {"code": "request_principal_unavailable"}}
    assert ports.opened == []


def test_sessions_open_for_the_resolved_principal() -> None:
    app = session_probe_app()
    ports = RecordingPorts()
    install_product_ports(app, ports)
    with TestClient(app) as client:
        assert client.get("/read").status_code == 200
        assert client.post("/write").status_code == 200
    assert ports.opened == [("read", "owner"), ("write", "owner")]


def test_local_app_installs_ports_without_opening_the_database(tmp_path: Path) -> None:
    factory = MagicMock(side_effect=AssertionError("ports must not open a session at startup"))
    app = create_local_app(
        runtime_settings=Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data"),
        session_factory=factory,
    )
    assert isinstance(app.state.product_ports, LocalProductPorts)
    factory.assert_not_called()


def test_local_ports_open_sessions_from_the_app_factory() -> None:
    opened: list[str] = []

    @asynccontextmanager
    async def factory() -> AsyncIterator[str]:
        opened.append("session")
        yield "session"

    app = session_probe_app()
    app.state.session_factory = factory
    install_product_ports(app, LocalProductPorts(app))
    with TestClient(app) as client:
        assert client.get("/read").json() == {"session": "session"}
        assert client.post("/write").json() == {"session": "session"}
    assert opened == ["session", "session"]


def test_a_write_session_ends_before_the_response_is_sent() -> None:
    # The failure must replace the handler's success; a session ended after
    # sending would have reported 200 for a write that never became durable.
    app = session_probe_app()
    install_product_ports(app, RecordingPorts(fail_commit=True))
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.post("/write").status_code == 500
        assert client.get("/read").status_code == 200


def test_repositories_come_from_the_ports_over_the_opened_session() -> None:
    app = FastAPI()
    app.state.request_principal_resolver = FixedOwner()

    @app.get("/repositories")
    async def read(repositories: ReadRepositories, session: ReadSession) -> dict[str, bool]:
        return {"same_session": repositories.session is session}  # type: ignore[attr-defined]

    @app.post("/repositories")
    async def write(repositories: WriteRepositories, session: WriteSession) -> dict[str, bool]:
        return {"same_session": repositories.session is session}  # type: ignore[attr-defined]

    ports = RecordingPorts()
    install_product_ports(app, ports)
    with TestClient(app) as client:
        assert client.get("/repositories").json() == {"same_session": True}
        assert client.post("/repositories").json() == {"same_session": True}
    # Each request opened one session, shared by its repositories.
    assert ports.opened == [("read", "owner"), ("write", "owner")]


def test_local_policy_follows_the_apps_runtime_settings(tmp_path: Path) -> None:
    app = create_local_app(
        runtime_settings=Settings(
            animama_content_root=tmp_path / "content",
            animama_data_root=tmp_path / "data",
            anima_memory_file_max_bytes=1234,
        ),
        session_factory=MagicMock(),
    )
    assert app.state.product_ports.policy == ProductPolicy(memory_file_max_bytes=1234)
