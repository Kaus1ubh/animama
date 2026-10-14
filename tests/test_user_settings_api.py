"""HTTP contract for the owner's UI Locale in ``/v1/users/me/settings``."""

from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from animama.orm.settings import ORMUserSettings
from animama.product_http.routes import settings
from tests.product_http_support import OWNER_HEADER, install_local_ports, product_app

SETTINGS_PATH = "/v1/users/me/settings"


def _app(session) -> FastAPI:
    """The shared settings route served by the local ports on the test session."""

    app = product_app(settings.router, ports=None)
    install_local_ports(app, session)
    return app


@asynccontextmanager
async def _client(app: FastAPI, owner_id: str):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={OWNER_HEADER: owner_id}
    ) as client:
        yield client


async def test_locale_defaults_to_system_and_can_be_set_and_cleared(async_session) -> None:
    owner_id = str(uuid4())
    app = _app(async_session)

    async with _client(app, owner_id) as client:
        assert (await client.get(SETTINGS_PATH)).json()["locale"] is None

        created = await client.post(SETTINGS_PATH, json={})
        assert created.status_code == 201
        assert created.json()["locale"] is None

        chosen = await client.patch(SETTINGS_PATH, json={"locale": "ja"})
        assert chosen.status_code == 200
        assert chosen.json()["locale"] == "ja"

        # Omitting the field keeps the stored choice.
        unrelated = await client.patch(SETTINGS_PATH, json={"theme": "anima"})
        assert unrelated.json()["locale"] == "ja"
        assert (await client.get(SETTINGS_PATH)).json()["locale"] == "ja"

        cleared = await client.patch(SETTINGS_PATH, json={"locale": None})
        assert cleared.status_code == 200
        assert cleared.json()["locale"] is None
        assert (await client.get(SETTINGS_PATH)).json()["locale"] is None


@pytest.mark.parametrize("locale", ["zh-Hant", None])
async def test_create_accepts_a_supported_locale_or_explicit_null(async_session, locale) -> None:
    owner_id = str(uuid4())
    app = _app(async_session)

    async with _client(app, owner_id) as client:
        created = await client.post(SETTINGS_PATH, json={"locale": locale})
        assert created.status_code == 201
        assert created.json()["locale"] == locale
        assert (await client.get(SETTINGS_PATH)).json()["locale"] == locale


@pytest.mark.parametrize("locale", ["en-US", "fr", "zh", "JA", ""])
async def test_unsupported_locale_tags_are_rejected(async_session, locale) -> None:
    owner_id = str(uuid4())
    app = _app(async_session)

    async with _client(app, owner_id) as client:
        assert (await client.post(SETTINGS_PATH, json={"locale": locale})).status_code == 422
        assert (await client.patch(SETTINGS_PATH, json={"locale": "ko"})).status_code == 200
        assert (await client.patch(SETTINGS_PATH, json={"locale": locale})).status_code == 422
        assert (await client.get(SETTINGS_PATH)).json()["locale"] == "ko"


async def test_legacy_stored_locale_reads_as_system_default(async_session) -> None:
    owner_id = str(uuid4())
    # Development databases created before the UI Locale contract stored 'en-US'.
    async_session.add(ORMUserSettings(user_id=owner_id, locale="en-US"))
    await async_session.commit()
    app = _app(async_session)

    async with _client(app, owner_id) as client:
        read = await client.get(SETTINGS_PATH)
        assert read.status_code == 200
        assert read.json()["locale"] is None

        unrelated = await client.patch(SETTINGS_PATH, json={"theme": "anima"})
        assert unrelated.status_code == 200
        assert unrelated.json()["locale"] is None
