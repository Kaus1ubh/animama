"""Companion-safety capabilities and crisis-resource API (spec R5, R8)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from sqlalchemy import delete

from animama.domain.request_principal import RequestPrincipal
from animama.orm.settings import ORMUserSettings
from animama.product_http.ports import install_product_ports
from animama.product_http.routes import safety
from animama.server.config import Settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.product_ports import LocalProductPorts
from animama.server.routers import runtime_capabilities
from tests.local_http_client import local_client

OWNER = "safety-owner"


def _app(session, tmp_path, **settings_overrides):  # noqa: ANN001, ANN003
    app = FastAPI()
    app.state.runtime_settings = Settings(
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
        animama_user_file_processing_enabled=False,
        **settings_overrides,
    )
    app.state.local_runtime_paths = SimpleNamespace(included_sources=(), operations_root=tmp_path / "operations")
    app.include_router(runtime_capabilities.router)
    app.include_router(safety.router)

    async def principal():
        return RequestPrincipal(id=OWNER)

    async def database():
        yield session

    # Shared routes take the test's session through the local composition's ports.
    app.state.session_factory = asynccontextmanager(database)
    install_product_ports(app, LocalProductPorts(app))
    app.dependency_overrides[get_current_principal] = principal
    app.dependency_overrides[get_async_session] = database
    return app


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        (
            {},
            {
                "enabled": True,
                "ai_notice_enabled": True,
                "crisis_detection_enabled": True,
                "operator_reminder_hours": 3.0,
            },
        ),
        (
            {"ai_notice_reminder_hours": 6},
            {
                "enabled": True,
                "ai_notice_enabled": True,
                "crisis_detection_enabled": True,
                "operator_reminder_hours": 6.0,
            },
        ),
        (
            {"companion_safety_enabled": False},
            {
                "enabled": False,
                "ai_notice_enabled": False,
                "crisis_detection_enabled": False,
                "operator_reminder_hours": 3.0,
            },
        ),
    ],
)
async def test_capabilities_report_operator_safety_without_secrets(
    async_session, tmp_path, overrides, expected, set_runtime_credentials
):
    set_runtime_credentials(OPENAI_API_KEY="sk-test")
    async with local_client(_app(async_session, tmp_path, **overrides)) as client:
        response = await client.get("/v1/runtime-capabilities")
    assert response.status_code == 200
    assert response.json()["companion_safety"] == expected
    assert "sk-test" not in response.text


async def test_crisis_resources_follow_preference_then_locale(async_session, tmp_path):
    await async_session.execute(delete(ORMUserSettings).where(ORMUserSettings.user_id == OWNER))
    await async_session.commit()
    app = _app(async_session, tmp_path)
    async with local_client(app) as client:
        by_locale = (await client.get("/v1/safety/crisis-resources", params={"locale": "en-AU"})).json()
        assert by_locale["resolved"]["code"] == "AU"
        assert by_locale["preferred_region"] is None
        assert {"US", "CA", "GB", "IE", "AU"} <= {region["code"] for region in by_locale["regions"]}
        unknown = (await client.get("/v1/safety/crisis-resources", params={"locale": "en"})).json()
        assert unknown["resolved"]["code"] == "fallback"

        async_session.add(ORMUserSettings(user_id=OWNER, preferences={"safety": {"crisis_resource_region": "GB"}}))
        await async_session.commit()
        preferred = (await client.get("/v1/safety/crisis-resources", params={"locale": "en-AU"})).json()
        assert preferred["preferred_region"] == "GB"
        assert preferred["resolved"]["code"] == "GB"
        assert preferred["resolved"]["services"][0]["contacts"][0]["value"] == "116123"
    await async_session.execute(delete(ORMUserSettings).where(ORMUserSettings.user_id == OWNER))
    await async_session.commit()
