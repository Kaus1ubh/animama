"""Real factory and launch wiring for the single local application listener."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from animama.local.http.protocol import LocalH11Protocol
from animama.runtime import cli
from animama.server import compose_entrypoint, native_entrypoint
from animama.server.app import create_local_app
from animama.server.config import Settings
from animama.server.local_http import local_http_config, local_telemetry, verified_model_mount


@pytest.mark.parametrize("field", ["animama_desktop_renderer_capability", "animama_desktop_control_token"])
def test_partial_desktop_credentials_fail_closed(field: str) -> None:
    with pytest.raises(ValueError, match="both renderer and control"):
        create_local_app(runtime_settings=Settings(**{field: "a" * 64}))


def test_new_serving_settings_read_the_current_launch_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANIMAMA_PUBLIC_ORIGIN", "http://localhost:8400")
    monkeypatch.setenv("ANIMAMA_WEB_ROOT", "   ")
    monkeypatch.setenv("ANIMAMA_DESKTOP_RENDERER_CAPABILITY", "a" * 64)
    monkeypatch.setenv("ANIMAMA_DESKTOP_CONTROL_TOKEN", "b" * 64)
    settings = Settings()
    config = local_http_config(settings)
    assert config.public_origin == "http://localhost:8400"
    assert settings.animama_web_root is None
    assert config.desktop is not None
    assert "a" * 64 not in repr(settings)
    assert "b" * 64 not in repr(settings)


def test_model_mount_accepts_only_the_exact_private_inventory(tmp_path: Path) -> None:
    payload: dict[str, Any] = {
        "root": str(tmp_path),
        "version": "1.0.0",
        "files": [
            {"path": "model.onnx", "size_bytes": 10, "sha256": "a" * 64, "media_type": "application/octet-stream"}
        ],
    }
    result = verified_model_mount(json.dumps(payload))
    assert result is not None and result.root == tmp_path and result.version == "1.0.0"
    assert result.files[0].path == "model.onnx"
    for invalid in (
        {**payload, "unreviewed": True},
        {**payload, "root": "relative/root"},
        {**payload, "files": []},
        {**payload, "files": [{**payload["files"][0], "path": "../private"}]},
        {**payload, "files": [{**payload["files"][0], "size_bytes": True}]},
        {**payload, "files": [{**payload["files"][0], "unknown": "field"}]},
        {**payload, "files": [payload["files"][0], payload["files"][0]]},
    ):
        with pytest.raises(ValueError):
            verified_model_mount(json.dumps(invalid))
    with pytest.raises(ValueError, match="duplicate"):
        verified_model_mount('{"root":"/one","root":"/two"}')
    with pytest.raises(ValueError, match="bounded"):
        verified_model_mount(" " * (4 * 1024 * 1024 + 1))


async def test_built_factory_serves_assets_after_bootstrap_and_hides_private_routes(tmp_path: Path) -> None:
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<html>built application</html>")
    (web / "app.js").write_text("window.fixture = true")
    application = create_local_app(
        runtime_settings=Settings(
            animama_public_origin="http://localhost:8000",
            animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data", animama_web_root=web
        )
    )
    paths = {getattr(route, "path", "") for route in application.routes}
    assert not any(path.startswith("/_desktop") for path in paths)
    assert "/docs" not in paths and "/openapi.json" not in paths
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(application), base_url="http://localhost:8000"
    ) as client:
        assert (await client.get("/", headers={"accept": "text/html"})).status_code == 503
        application.state.local_http_lifecycle.mark_ready("fixture-owner")
        assert (await client.get("/chats", headers={"accept": "text/html"})).text == "<html>built application</html>"
        assert (await client.get("/app.js")).text == "window.fixture = true"
        assert (await client.get("/v1/not-present", headers={"accept": "text/html"})).status_code == 404
        assert (await client.get("/_desktop/health")).status_code == 404
        assert (await client.get("/health")).json() == {"status": "ok"}
        assert (await client.get("/app.js", headers={"origin": "https://untrusted.invalid"})).status_code == 403


async def test_desktop_telemetry_ignores_inherited_collector_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "not-a-valid-collector")
    settings = Settings(animama_desktop_renderer_capability="a" * 64, animama_desktop_control_token="b" * 64)
    forwarder = local_telemetry(local_http_config(settings))
    assert not forwarder.config.enabled
    assert forwarder._client is None
    await forwarder.aclose()


@pytest.mark.parametrize("entrypoint", ["native", "compose", "frozen"])
def test_all_launchers_select_the_reviewed_transport(
    entrypoint: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import uvicorn

    calls: list[tuple[Any, dict[str, Any]]] = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **options: calls.append((app, options)))
    if entrypoint == "native":
        monkeypatch.delenv("ANIMAMA_LOCAL_API_PORT", raising=False)
        monkeypatch.setattr(native_entrypoint, "Settings", lambda: Settings(animama_local_bind_host="127.0.0.1"))
        native_entrypoint.main()
    elif entrypoint == "compose":
        compose_entrypoint.main()
    else:
        monkeypatch.setenv("ANIMAMA_PUBLIC_ORIGIN", "http://127.0.0.1:3000")
        monkeypatch.setenv("ANIMAMA_WEB_ROOT", str(tmp_path))
        monkeypatch.setenv("ANIMAMA_DESKTOP_RENDERER_CAPABILITY", "a" * 64)
        monkeypatch.setenv("ANIMAMA_DESKTOP_CONTROL_TOKEN", "b" * 64)
        monkeypatch.setenv("ANIMAMA_PROCESS_START_TOKEN", "11111111-1111-4111-8111-111111111111")
        assert cli.main(["serve", "--port", "3000"]) == 0
    assert len(calls) == 1
    _, options = calls[0]
    assert options["host"] == ("0.0.0.0" if entrypoint == "compose" else "127.0.0.1")
    assert options["port"] == (3000 if entrypoint == "frozen" else 8000)
    assert options["http"] is LocalH11Protocol
    assert options["ws"] == "websockets"
    assert options["proxy_headers"] is False
    assert options["timeout_keep_alive"] == 5
    assert options["timeout_graceful_shutdown"] == 15


@pytest.mark.parametrize("missing", ["ANIMAMA_WEB_ROOT", "ANIMAMA_PROCESS_START_TOKEN"])
def test_frozen_serving_refuses_incomplete_owned_configuration(
    missing: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANIMAMA_PUBLIC_ORIGIN", "http://127.0.0.1:3000")
    monkeypatch.setenv("ANIMAMA_WEB_ROOT", str(tmp_path))
    monkeypatch.setenv("ANIMAMA_DESKTOP_RENDERER_CAPABILITY", "a" * 64)
    monkeypatch.setenv("ANIMAMA_DESKTOP_CONTROL_TOKEN", "b" * 64)
    monkeypatch.setenv("ANIMAMA_PROCESS_START_TOKEN", "11111111-1111-4111-8111-111111111111")
    monkeypatch.delenv(missing)
    with pytest.raises(SystemExit) as failure:
        cli.main(["serve", "--port", "3000"])
    assert failure.value.code == 2
