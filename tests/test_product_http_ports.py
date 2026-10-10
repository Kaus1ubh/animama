"""Shared routes take sessions from composition-installed ports (ADR 0021)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from animama.product_http.ports import ReadSession, WriteSession
from animama.server.app import create_local_app
from animama.server.config import Settings
from animama.server.product_ports import LocalProductPorts


def session_probe_app() -> FastAPI:
    app = FastAPI()

    @app.get("/read")
    async def read(session: ReadSession) -> dict[str, str]:
        return {"session": str(session)}

    @app.post("/write")
    async def write(session: WriteSession) -> dict[str, str]:
        return {"session": str(session)}

    return app


def test_shared_routes_fail_closed_without_installed_ports() -> None:
    with TestClient(session_probe_app()) as client:
        responses = [client.get("/read"), client.post("/write")]
    for response in responses:
        assert response.status_code == 503
        assert response.json() == {"detail": {"code": "product_ports_unavailable"}}


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
    app.state.product_ports = LocalProductPorts(app)
    with TestClient(app) as client:
        assert client.get("/read").json() == {"session": "session"}
        assert client.post("/write").json() == {"session": "session"}
    assert opened == ["session", "session"]


class FailingCommitPorts:
    """A composition whose deferred commit fails when the write session ends."""

    @asynccontextmanager
    async def read_session(self) -> AsyncIterator[AsyncSession]:
        yield MagicMock(spec=AsyncSession)

    @asynccontextmanager
    async def write_session(self) -> AsyncIterator[AsyncSession]:
        yield MagicMock(spec=AsyncSession)
        raise RuntimeError("deferred commit failed")


def test_a_write_session_ends_before_the_response_is_sent() -> None:
    # The failure must replace the handler's success; a session ended after
    # sending would have reported 200 for a write that never became durable.
    app = session_probe_app()
    app.state.product_ports = FailingCommitPorts()
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.post("/write").status_code == 500
        assert client.get("/read").status_code == 200
