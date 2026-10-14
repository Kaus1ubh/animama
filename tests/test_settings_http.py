"""HTTP characterization of the user and Anima settings routes on the local app."""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.app.services.settings_service import default_anima_preferences
from animama.orm import ORMAnima
from animama.server.app import app
from animama.server.embedding_refresh import EmbeddingRefreshWorker
from tests.local_http_client import local_client

USER_SETTINGS = "/v1/users/me/settings"


@pytest.fixture
def app_sessions(async_session_factory: async_sessionmaker[AsyncSession]) -> Iterator[None]:
    """Serve the shared app from this test's own session factory and event loop."""

    previous = app.state.session_factory
    app.state.session_factory = async_session_factory
    try:
        yield
    finally:
        app.state.session_factory = previous


@pytest.fixture
def refresh_worker() -> Iterator[MagicMock]:
    """Record wakes of the embedding refresh worker that settings writes trigger."""

    previous = getattr(app.state, "embedding_refresh_worker", None)
    worker = MagicMock(spec=EmbeddingRefreshWorker)
    app.state.embedding_refresh_worker = worker
    try:
        yield worker
    finally:
        app.state.embedding_refresh_worker = previous


@pytest.mark.usefixtures("app_sessions")
async def test_user_settings_lifecycle_and_refresh_wakes(request_principal_override, refresh_worker: MagicMock) -> None:
    owner = request_principal_override.id
    async with local_client(app) as client:
        await client.delete(USER_SETTINGS)
        refresh_worker.wake.reset_mock()
        defaults = await client.get(USER_SETTINGS)
        assert defaults.status_code == 200
        assert defaults.json() == {
            "user_id": owner,
            "theme": "anima",
            "locale": None,
            "last_active_anima_id": None,
            "preferences": {},
        }

        created = await client.post(USER_SETTINGS, json={"locale": "ja"})
        assert created.status_code == 201
        assert created.json()["locale"] == "ja"
        assert (await client.post(USER_SETTINGS, json={})).status_code == 409

        patched = await client.patch(USER_SETTINGS, json={"theme": "dusk", "preferences": {"chat": {"x": 1}}})
        assert patched.status_code == 200
        stored = (await client.get(USER_SETTINGS)).json()
        assert (stored["theme"], stored["locale"], stored["preferences"]) == ("dusk", "ja", {"chat": {"x": 1}})

        assert (await client.delete(USER_SETTINGS)).status_code == 204
        assert (await client.get(USER_SETTINGS)).json() == defaults.json()

    # Create, patch and delete each re-check stored vectors; reads and the conflict do not.
    assert refresh_worker.wake.call_count == 3


@pytest.mark.usefixtures("app_sessions")
async def test_anima_settings_lifecycle(
    async_session: AsyncSession, request_principal_override, refresh_worker: MagicMock
) -> None:
    owner = request_principal_override.id
    anima_id = f"anima-{uuid4().hex}"
    async_session.add(ORMAnima(id=anima_id, user_id=owner))
    await async_session.commit()
    path = f"/v1/animas/{anima_id}/settings"
    async with local_client(app) as client:
        defaults = await client.get(path)
        assert defaults.status_code == 200
        body = defaults.json()
        assert (body["user_id"], body["anima_id"], body["favorited"]) == (owner, anima_id, False)
        assert body["preferences"] == default_anima_preferences()

        patched = await client.patch(path, json={"favorited": True, "background": "stars"})
        assert patched.status_code == 200
        assert (patched.json()["favorited"], patched.json()["background"]) == (True, "stars")
        assert (await client.get(path)).json()["favorited"] is True

        assert (await client.delete(path)).status_code == 204
        assert (await client.get(path)).json()["favorited"] is False

        missing = f"/v1/animas/anima-{uuid4().hex}/settings"
        assert (await client.get(missing)).status_code == 404
        assert (await client.patch(missing, json={"favorited": True})).status_code == 404
        assert (await client.delete(missing)).status_code == 404

    # Anima settings never re-check stored vectors.
    refresh_worker.wake.assert_not_called()
