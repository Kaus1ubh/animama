"""HTTP contract for the owner's UI Locale in ``/v1/users/me/settings``."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import FastAPI

from animama.domain.request_principal import RequestPrincipal
from animama.orm.settings import ORMUserSettings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers import settings
from tests.local_http_client import local_client

SETTINGS_PATH = "/v1/users/me/settings"


def _app(session, owner_id: str) -> FastAPI:
    app = FastAPI()
    app.include_router(settings.router)

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id=owner_id)

    async def database():
        yield session

    app.dependency_overrides[get_current_principal] = principal
    app.dependency_overrides[get_async_session] = database
    return app


async def test_locale_defaults_to_system_and_can_be_set_and_cleared(async_session) -> None:
    app = _app(async_session, str(uuid4()))

    async with local_client(app) as client:
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
    app = _app(async_session, str(uuid4()))

    async with local_client(app) as client:
        created = await client.post(SETTINGS_PATH, json={"locale": locale})
        assert created.status_code == 201
        assert created.json()["locale"] == locale
        assert (await client.get(SETTINGS_PATH)).json()["locale"] == locale


@pytest.mark.parametrize("locale", ["en-US", "fr", "zh", "JA", ""])
async def test_unsupported_locale_tags_are_rejected(async_session, locale) -> None:
    app = _app(async_session, str(uuid4()))

    async with local_client(app) as client:
        assert (await client.post(SETTINGS_PATH, json={"locale": locale})).status_code == 422
        assert (await client.patch(SETTINGS_PATH, json={"locale": "ko"})).status_code == 200
        assert (await client.patch(SETTINGS_PATH, json={"locale": locale})).status_code == 422
        assert (await client.get(SETTINGS_PATH)).json()["locale"] == "ko"


async def test_legacy_stored_locale_reads_as_system_default(async_session) -> None:
    owner_id = str(uuid4())
    # Development databases created before the UI Locale contract stored 'en-US'.
    async_session.add(ORMUserSettings(user_id=owner_id, locale="en-US"))
    await async_session.commit()
    app = _app(async_session, owner_id)

    async with local_client(app) as client:
        read = await client.get(SETTINGS_PATH)
        assert read.status_code == 200
        assert read.json()["locale"] is None

        unrelated = await client.patch(SETTINGS_PATH, json={"theme": "anima"})
        assert unrelated.status_code == 200
        assert unrelated.json()["locale"] is None
