"""The shared-route inventory matches the local app and the hosted capability contract (ADR 0021)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest import mock

import pytest
from fastapi.routing import APIRoute, APIWebSocketRoute

from animama.product_http.inventory import ROUTES, RouteSpec
from animama.server.app import create_local_app
from animama.server.config import Settings

ROOT = Path(__file__).resolve().parents[1]
HOSTED = json.loads((ROOT / "contracts/runtime-capabilities/hosted.json").read_text())
# The permissions of the capability contract (contracts/hosted-web.md, "Capabilities
# and requests"). The remaining fields report runtime state, not permission.
PERMISSIONS = (
    "chat",
    "model_selection",
    "model_role_selection",
    "model_configuration",
    "provider_credentials",
    "chat_file_uploads",
    "anima_creation",
    "local_filesystem_administration",
    "native_features",
    "user_file_processing.enabled",
    "web_search.configuration",
)


def hosted_permission(name: str) -> bool:
    value = HOSTED
    for part in name.split("."):
        value = value[part]
    assert isinstance(value, bool), name
    return value


def route_table(tmp_path: Path, *, desktop: bool) -> list[tuple[str, str, str]]:
    """The local app's ordered (method, path, handler) table."""

    desktop_credentials = (
        {"animama_desktop_renderer_capability": "e" * 64, "animama_desktop_control_token": "c" * 64} if desktop else {}
    )
    # Desktop startup scrubs credential names from the environment; keep this test's.
    with mock.patch.dict(os.environ):
        app = create_local_app(
            runtime_settings=Settings(
                animama_content_root=tmp_path / "content",
                animama_data_root=tmp_path / "data",
                **desktop_credentials,
            )
        )
    table = []
    for route in app.router.routes:
        assert isinstance(route, APIRoute | APIWebSocketRoute), route
        methods = ["WEBSOCKET"] if isinstance(route, APIWebSocketRoute) else sorted(route.methods)
        assert len(methods) == 1, route.path
        table.append((methods[0], route.path, route.endpoint.__name__))
    return table


@pytest.mark.parametrize("desktop", [False, True])
def test_inventory_lists_every_local_route_in_order(tmp_path: Path, desktop: bool) -> None:
    expected = [(spec.method, spec.path, spec.handler) for spec in ROUTES if desktop or not spec.desktop_only]
    assert route_table(tmp_path, desktop=desktop) == expected


def test_creation_options_matches_before_the_anima_path_parameter() -> None:
    paths = [spec.path for spec in ROUTES]
    assert paths.index("/v1/animas/creation-options") < paths.index("/v1/animas/{anima_id}")


def test_every_false_hosted_permission_withholds_at_least_one_route() -> None:
    gated = {spec.capability for spec in ROUTES if spec.disposition == "hosted-excluded"}
    withheld = {name for name in PERMISSIONS if not hosted_permission(name)}
    assert withheld <= gated


def test_routes_are_withheld_only_by_false_hosted_permissions() -> None:
    for spec in ROUTES:
        if spec.disposition == "hosted-excluded":
            assert spec.capability in PERMISSIONS, spec.path
            assert hosted_permission(spec.capability) is False, spec.path


def test_shared_routes_are_product_api_routes() -> None:
    shared = [spec for spec in ROUTES if spec.disposition == "shared"]
    assert shared
    assert all(spec.path.startswith("/v1/") and not spec.desktop_only for spec in shared)


def test_route_specs_reject_mismatched_stage_or_capability() -> None:
    with pytest.raises(ValueError, match="stage"):
        RouteSpec("GET", "/v1/chats", "list_chats", "shared", "read")
    with pytest.raises(ValueError, match="stage"):
        RouteSpec("GET", "/health", "health", "local", "read", stage=2)
    with pytest.raises(ValueError, match="capability"):
        RouteSpec("POST", "/v1/files/uploads", "init_user_file_upload", "hosted-excluded", "write")
    with pytest.raises(ValueError, match="capability"):
        RouteSpec("GET", "/v1/chats", "list_chats", "shared", "read", stage=2, capability="chat")
