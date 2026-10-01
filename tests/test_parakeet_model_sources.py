"""Parakeet mounts resolved per request from the model-asset store or operator launch input (ADR 0012)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from starlette.requests import Request

from animama.adapters.model_assets import FilesystemModelAssetStore
from animama.app.services.model_asset_service import ModelAssetService
from animama.domain.model_assets import ASSET_CATALOG_SCHEMA, parse_asset_catalog
from animama.local.http.assets import PARAKEET_MOUNT, PARAKEET_WEBGPU_MOUNT, LocalAssets
from animama.server.config import Settings
from animama.server.local_http import local_assets
from animama.server.model_assets import AssetStoreModelMounts, parakeet_availability
from tests.test_model_asset_sets import FILES, GPU_FILES, GPU_MANIFEST, MANIFEST, SetRelease, _set_entry


@pytest.fixture(autouse=True)
def request_principal_override():
    """The suite's product-principal fixture is unnecessary for this boundary."""

    yield


@pytest.fixture
def web_root(tmp_path: Path) -> Path:
    root = tmp_path / "web"
    root.mkdir()
    (root / "index.html").write_bytes(b"<html></html>")
    return root


@pytest.fixture
def service(tmp_path: Path) -> ModelAssetService:
    catalog = parse_asset_catalog(
        {
            "schema": ASSET_CATALOG_SCHEMA,
            "assets": [
                _set_entry("parakeet-stt", "speech-model", FILES, MANIFEST),
                _set_entry(
                    "parakeet-stt-webgpu", "speech-gpu-model", GPU_FILES, GPU_MANIFEST, requires=["parakeet-stt"]
                ),
            ],
        }
    )
    return ModelAssetService(catalog, FilesystemModelAssetStore(tmp_path / "data"), SetRelease().fetcher())


def _application(service: ModelAssetService) -> FastAPI:
    application = FastAPI()
    application.state.model_asset_service = service
    return application


def _client(assets: LocalAssets) -> httpx.AsyncClient:
    async def app(scope, receive, send):
        response = await assets.response(Request(scope, receive))
        await response(scope, receive, send)

    return httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://localhost:3000")


async def _install(service: ModelAssetService, asset_id: str) -> None:
    service.install(asset_id)
    assert (await service.wait(asset_id)).status == "installed"


async def test_asset_store_mounts_follow_installs_without_a_new_responder(
    web_root: Path, service: ModelAssetService
) -> None:
    assets = LocalAssets(web_root, mount_source=AssetStoreModelMounts(_application(service)))
    model = PARAKEET_MOUNT + "model.onnx"
    encoder = PARAKEET_WEBGPU_MOUNT + "encoder.onnx"
    async with _client(assets) as client:
        assert (await client.get(model)).status_code == 404
        assert (await client.head(encoder)).status_code == 404

        await _install(service, "parakeet-stt")
        pinned = await client.get(f"{model}?v={MANIFEST}")
        assert pinned.status_code == 200 and pinned.content == FILES["model.onnx"]
        assert pinned.headers["cache-control"] == "private, max-age=31536000, immutable"
        assert pinned.headers["etag"] == '"' + hashlib.sha256(FILES["model.onnx"]).hexdigest() + '"'
        partial = await client.get(f"{model}?v={MANIFEST}", headers={"range": "bytes=10-19"})
        assert partial.status_code == 206 and partial.content == FILES["model.onnx"][10:20]
        notice = await client.get(PARAKEET_MOUNT + "README.md")
        assert notice.headers["content-type"] == "text/plain; charset=utf-8"
        assert notice.headers["cache-control"] == "no-cache"
        config = await client.get(PARAKEET_MOUNT + "config.json")
        assert config.headers["content-type"] == "application/json"
        assert (await client.get(f"{model}?v={GPU_MANIFEST}")).status_code == 404
        assert (await client.get(PARAKEET_MOUNT + "missing.onnx")).status_code == 404
        assert (await client.head(encoder)).status_code == 404

        await _install(service, "parakeet-stt-webgpu")
        gpu = await client.head(f"{encoder}?v={GPU_MANIFEST}")
        assert gpu.status_code == 200 and gpu.headers["content-length"] == str(len(GPU_FILES["encoder.onnx"]))

        await service.remove("parakeet-stt-webgpu")
        await service.remove("parakeet-stt")
        assert (await client.get(f"{model}?v={MANIFEST}")).status_code == 404
        assert (await client.head(encoder)).status_code == 404


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
        animama_web_root=tmp_path / "web",
        **overrides,
    )


async def test_operator_source_serves_no_models(tmp_path: Path, web_root: Path, service: ModelAssetService) -> None:
    settings = _settings(tmp_path, animama_parakeet_source="operator")
    await _install(service, "parakeet-stt")  # The store is ignored by the operator source.

    assets = local_assets(settings, _application(service))
    assert assets is not None
    async with _client(assets) as client:
        assert (await client.get(f"{PARAKEET_MOUNT}model.onnx?v={MANIFEST}")).status_code == 404
        assert (await client.get(PARAKEET_WEBGPU_MOUNT + "encoder.onnx")).status_code == 404


async def test_built_composition_defaults_to_the_asset_store(
    tmp_path: Path, web_root: Path, service: ModelAssetService, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A native or built launch with a web root and no explicit source must
    # report and serve only what the app installed.
    monkeypatch.delenv("ANIMAMA_PARAKEET_SOURCE", raising=False)
    monkeypatch.delenv("ANIMAMA_PARAKEET_STT_ENABLED", raising=False)
    settings = _settings(tmp_path)
    assert settings.animama_parakeet_source == "asset-store"
    application = _application(service)
    assets = local_assets(settings, application)
    assert assets is not None
    async with _client(assets) as client:
        assert parakeet_availability(application, settings).enabled is False
        assert (await client.get(PARAKEET_MOUNT + "model.onnx")).status_code == 404
        await _install(service, "parakeet-stt")
        availability = parakeet_availability(application, settings)
        assert (availability.enabled, availability.asset_version) == (True, MANIFEST)
        assert (await client.get(f"{PARAKEET_MOUNT}model.onnx?v={MANIFEST}")).content == FILES["model.onnx"]


async def test_asset_store_source_serves_installed_sets(
    tmp_path: Path, web_root: Path, service: ModelAssetService
) -> None:
    assets = local_assets(_settings(tmp_path, animama_parakeet_source="asset-store"), _application(service))
    assert assets is not None
    async with _client(assets) as client:
        assert (await client.get(PARAKEET_MOUNT + "model.onnx")).status_code == 404
        await _install(service, "parakeet-stt")
        assert (await client.get(f"{PARAKEET_MOUNT}model.onnx?v={MANIFEST}")).content == FILES["model.onnx"]


def test_parakeet_source_accepts_only_known_values(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        _settings(tmp_path, animama_parakeet_source="cloud")


def test_parakeet_source_reads_its_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANIMAMA_PARAKEET_SOURCE", "operator")
    assert _settings(tmp_path).animama_parakeet_source == "operator"
    monkeypatch.setenv("ANIMAMA_PARAKEET_SOURCE", "unknown")
    with pytest.raises(ValueError):
        _settings(tmp_path)
