"""Shared backend model-asset downloader: verification, lifecycle and routes (R8–R12)."""

from __future__ import annotations

import asyncio
import gzip
import hashlib
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from animama.adapters.model_assets import FilesystemModelAssetStore, HttpAssetFetcher
from animama.app.ports.model_assets import AssetFetchError
from animama.app.services.model_asset_service import ModelAssetService, load_packaged_asset_catalog
from animama.domain.model_assets import (
    ASSET_CATALOG_SCHEMA,
    AssetCatalog,
    AssetDescriptor,
    AssetRemovalVeto,
    parse_asset_catalog,
)
from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_current_principal
from animama.server.model_assets import get_model_asset_service
from animama.server.routers import model_assets
from tests.local_http_client import local_client

PAYLOAD = bytes(range(256)) * 64  # 16 KiB
DIGEST = hashlib.sha256(PAYLOAD).hexdigest()
RELEASE = "https://downloads.animama.ai/voices/test"


def _entry(asset_id: str = "voice-a", **overrides: object) -> dict[str, object]:
    entry: dict[str, object] = {
        "id": asset_id,
        "url": f"{RELEASE}/{asset_id}.bin",
        "size": len(PAYLOAD),
        "sha256": DIGEST,
        "media_type": "application/octet-stream",
        "license_ref": "CC-BY-4.0",
    }
    entry.update(overrides)
    return entry


def _catalog(*entries: dict[str, object]) -> AssetCatalog:
    return parse_asset_catalog({"schema": ASSET_CATALOG_SCHEMA, "assets": list(entries or [_entry()])})


class Release:
    """A MockTransport-backed release host; each path maps to a response factory."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.routes: dict[str, Callable[[], httpx.Response]] = {}

    def serve(self, path: str, body: bytes = PAYLOAD) -> None:
        self.routes[path] = lambda: httpx.Response(200, content=body)

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        factory = self.routes.get(request.url.path)
        response = factory() if factory else httpx.Response(404)
        if isinstance(response.stream, httpx.ByteStream):
            # Real transports stream bodies; a pre-read mock body cannot be read raw.
            return httpx.Response(response.status_code, headers=response.headers, content=_chunks(response.content))
        return response

    def fetcher(self) -> HttpAssetFetcher:
        return HttpAssetFetcher(transport=httpx.MockTransport(self.handler))


def _service(data_root: Path, release: Release, catalog: AssetCatalog | None = None) -> ModelAssetService:
    return ModelAssetService(catalog or _catalog(), FilesystemModelAssetStore(data_root), release.fetcher())


def _files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*") if path.is_file()) if root.exists() else []


def _installed(data_root: Path) -> list[Path]:
    return _files(data_root / "internal" / "model-assets")


def _staged(data_root: Path) -> list[Path]:
    return _files(data_root / "staging" / "model-assets")


def _app(service: ModelAssetService) -> FastAPI:
    app = FastAPI()
    app.include_router(model_assets.router)
    app.dependency_overrides[get_model_asset_service] = lambda: service
    app.dependency_overrides[get_current_principal] = lambda: RequestPrincipal(id="model-asset-owner")
    return app


@pytest.fixture
def data_root(tmp_path: Path) -> Path:
    return tmp_path / "data"


@pytest.fixture
def release() -> Release:
    release = Release()
    release.serve("/voices/test/voice-a.bin")
    return release


# Catalog


def test_packaged_catalog_is_valid_and_ships_no_assets_yet() -> None:
    assert load_packaged_asset_catalog().assets == ()


@pytest.mark.parametrize(
    "document",
    [
        {"schema": "animama-asset-catalog/2", "assets": []},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [], "base_url": RELEASE},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry(), _entry()]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry("../escape")]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry("Upper")]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry(url="http://downloads.animama.ai/a.bin")]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry(url="https://example.com/a.bin")]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry(url=f"{RELEASE}/a.bin?token=1")]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry(url="https://downloads.animama.ai:8443/a.bin")]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry(sha256=DIGEST.upper())]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry(sha256="abc")]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry(size=0)]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry(size=True)]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [_entry(media_type="not a type")]},
        {"schema": ASSET_CATALOG_SCHEMA, "assets": [{**_entry(), "extra": 1}]},
    ],
)
def test_catalog_rejects_invalid_documents(document: object) -> None:
    with pytest.raises(ValueError):
        parse_asset_catalog(document)


# Install and serving


async def test_verified_install_is_served_with_ranges_and_etag(data_root: Path, release: Release) -> None:
    service = _service(data_root, release)
    async with local_client(_app(service)) as client:
        assert (await client.get("/v1/model-assets")).json()["assets"][0]["status"] == "not_installed"
        assert (await client.get("/v1/model-assets/voice-a/content")).status_code == 404

        started = await client.post("/v1/model-assets/voice-a:install")
        assert started.status_code == 202
        assert started.json()["status"] == "downloading"
        assert started.json()["total_bytes"] == len(PAYLOAD)
        await service.wait("voice-a")

        state = (await client.get("/v1/model-assets/voice-a")).json()
        assert state["status"] == "installed"
        assert state["license_ref"] == "CC-BY-4.0"
        assert "url" not in state

        content = await client.get(state["content_url"])
        assert content.status_code == 200
        assert content.content == PAYLOAD
        assert content.headers["etag"] == f'"{DIGEST}"'
        assert content.headers["accept-ranges"] == "bytes"

        partial = await client.get(state["content_url"], headers={"range": "bytes=10-19"})
        assert partial.status_code == 206
        assert partial.content == PAYLOAD[10:20]
        assert partial.headers["content-range"] == f"bytes 10-19/{len(PAYLOAD)}"

        head = await client.head(state["content_url"])
        assert head.status_code == 200 and head.content == b""
        assert head.headers["content-length"] == str(len(PAYLOAD))

        cached = await client.get(state["content_url"], headers={"if-none-match": f'"{DIGEST}"'})
        assert cached.status_code == 304

        again = await client.post("/v1/model-assets/voice-a:install")
        assert again.status_code == 202 and again.json()["status"] == "installed"
    assert len(release.requests) == 1
    assert _installed(data_root) == [data_root / "internal" / "model-assets" / "voice-a" / DIGEST]
    assert _staged(data_root) == []


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (lambda: httpx.Response(200, content=PAYLOAD[:-1]), "asset_size_invalid"),
        (lambda: httpx.Response(200, content=PAYLOAD + b"x"), "asset_size_invalid"),
        (
            lambda: httpx.Response(200, headers={"content-length": "1"}, content=_chunks(PAYLOAD)),
            "asset_size_invalid",
        ),
        (lambda: httpx.Response(200, content=b"\0" * len(PAYLOAD)), "asset_hash_invalid"),
        (lambda: httpx.Response(503), "asset_download_failed"),
        (
            lambda: httpx.Response(302, headers={"location": f"{RELEASE}/elsewhere.bin"}),
            "asset_download_failed",
        ),
        (lambda: httpx.Response(200, content=_interrupted()), "asset_download_failed"),
        (
            lambda: httpx.Response(200, headers={"content-encoding": "gzip"}, content=gzip.compress(PAYLOAD)),
            "asset_download_failed",
        ),
    ],
    ids=["short", "long", "declared-length", "hash", "server-error", "redirect", "interrupted", "encoded"],
)
async def test_failed_downloads_leave_nothing(
    data_root: Path, release: Release, response: Callable[[], httpx.Response], reason: str
) -> None:
    release.routes["/voices/test/voice-a.bin"] = response
    release.serve("/voices/test/elsewhere.bin")
    service = _service(data_root, release)

    service.install("voice-a")
    state = await service.wait("voice-a")

    assert (state.status, state.reason) == ("failed", reason)
    assert len(release.requests) == 1  # Redirects are never followed.
    assert _installed(data_root) == []
    assert _staged(data_root) == []
    async with local_client(_app(service)) as client:
        assert (await client.get("/v1/model-assets/voice-a")).json()["reason"] == reason
        assert (await client.get("/v1/model-assets/voice-a/content")).status_code == 404

    # A later install retries and can succeed.
    release.serve("/voices/test/voice-a.bin")
    service.install("voice-a")
    assert (await service.wait("voice-a")).status == "installed"


async def test_cancelled_install_leaves_nothing(data_root: Path, release: Release) -> None:
    first_chunk_sent = asyncio.Event()
    never = asyncio.Event()

    async def stalled() -> AsyncIterator[bytes]:
        yield PAYLOAD[:1024]
        first_chunk_sent.set()
        await never.wait()
        yield PAYLOAD[1024:]

    release.routes["/voices/test/voice-a.bin"] = lambda: httpx.Response(200, content=stalled())
    service = _service(data_root, release)
    async with local_client(_app(service)) as client:
        await client.post("/v1/model-assets/voice-a:install")
        await asyncio.wait_for(first_chunk_sent.wait(), 5)
        progress = (await client.get("/v1/model-assets/voice-a")).json()
        assert progress["status"] == "downloading"
        assert progress["bytes_downloaded"] == 1024
        assert _staged(data_root) != []

        cancelled = await client.delete("/v1/model-assets/voice-a")

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "not_installed"
    assert _installed(data_root) == []
    assert _staged(data_root) == []


async def test_unknown_ids_are_refused_without_fetching(data_root: Path, release: Release) -> None:
    service = _service(data_root, release)
    async with local_client(_app(service)) as client:
        for response in (
            await client.get("/v1/model-assets/voice-z"),
            await client.post("/v1/model-assets/voice-z:install"),
            await client.delete("/v1/model-assets/voice-z"),
            await client.get("/v1/model-assets/voice-z/content"),
        ):
            assert response.status_code == 404
            assert response.json()["detail"] == {"code": "model_asset_not_found"}
    assert release.requests == []


async def test_fetcher_refuses_hosts_outside_its_allowlist(data_root: Path, release: Release) -> None:
    # Bypass catalog parsing to prove the fetcher enforces the host boundary too.
    outside = AssetDescriptor(**{**_entry(), "url": "https://example.com/voice-a.bin"})  # type: ignore[arg-type]
    service = _service(data_root, release, AssetCatalog((outside,)))

    service.install("voice-a")
    state = await service.wait("voice-a")

    assert (state.status, state.reason) == ("failed", "asset_host_not_allowed")
    assert release.requests == []


@pytest.mark.parametrize(
    "url",
    ["https://example.com/voice-a.bin", "https://downloads.animama.ai:8443/voice-a.bin"],
)
async def test_fetcher_refuses_other_hosts_and_ports_directly(release: Release, url: str) -> None:
    # A stand-in descriptor, since real descriptors already reject these URLs.
    asset = SimpleNamespace(id="voice-a", url=url)
    with pytest.raises(AssetFetchError) as refused:
        async with release.fetcher().stream(asset):  # type: ignore[arg-type]
            pass
    assert refused.value.reason == "asset_host_not_allowed"
    assert release.requests == []


async def test_concurrent_installs_share_one_download(data_root: Path, release: Release) -> None:
    service = _service(data_root, release)
    async with local_client(_app(service)) as client:
        responses = await asyncio.gather(*(client.post("/v1/model-assets/voice-a:install") for _ in range(5)))
        assert all(response.status_code == 202 for response in responses)
        await service.wait("voice-a")
    assert len(release.requests) == 1
    assert service.state("voice-a").status == "installed"


# Removal


async def test_removal_respects_guards(data_root: Path, release: Release) -> None:
    service = _service(data_root, release)
    service.install("voice-a")
    await service.wait("voice-a")
    in_use = {"voice-a"}

    async def async_guard(asset: AssetDescriptor) -> AssetRemovalVeto | None:
        if asset.id in in_use:
            return AssetRemovalVeto("pocket_voice_in_use", {"animas": [{"id": "a1", "name": "Mira"}]})
        return None

    seen: list[str] = []
    service.register_removal_guard(lambda asset: seen.append(asset.id))
    service.register_removal_guard(async_guard)

    async with local_client(_app(service)) as client:
        refused = await client.delete("/v1/model-assets/voice-a")
        assert refused.status_code == 409
        assert refused.json()["detail"] == {
            "code": "pocket_voice_in_use",
            "details": {"animas": [{"id": "a1", "name": "Mira"}]},
        }
        assert (await client.get("/v1/model-assets/voice-a")).json()["status"] == "installed"
        assert (await client.get("/v1/model-assets/voice-a/content")).status_code == 200

        in_use.clear()
        removed = await client.delete("/v1/model-assets/voice-a")
        assert removed.status_code == 200 and removed.json()["status"] == "not_installed"
        assert (await client.get("/v1/model-assets/voice-a/content")).status_code == 404
        # Removing an absent asset is idempotent.
        assert (await client.delete("/v1/model-assets/voice-a")).status_code == 200
    assert seen == ["voice-a", "voice-a"]
    assert _installed(data_root) == []


async def test_install_is_refused_while_removal_is_in_progress(data_root: Path, release: Release) -> None:
    service = _service(data_root, release)
    service.install("voice-a")
    await service.wait("voice-a")
    guard_entered, release_guard = asyncio.Event(), asyncio.Event()

    async def slow_guard(asset: AssetDescriptor) -> None:
        guard_entered.set()
        await release_guard.wait()

    service.register_removal_guard(slow_guard)
    async with local_client(_app(service)) as client:
        removal = asyncio.create_task(client.delete("/v1/model-assets/voice-a"))
        await asyncio.wait_for(guard_entered.wait(), 5)

        for busy in (
            await client.post("/v1/model-assets/voice-a:install"),
            await client.delete("/v1/model-assets/voice-a"),
        ):
            assert busy.status_code == 409
            assert busy.json()["detail"] == {"code": "model_asset_busy"}

        release_guard.set()
        removed = await removal
        assert removed.status_code == 200 and removed.json()["status"] == "not_installed"
        # Once removal settles, installing works again.
        assert (await client.post("/v1/model-assets/voice-a:install")).status_code == 202
        await service.wait("voice-a")
    assert len(release.requests) == 2
    assert service.state("voice-a").status == "installed"


async def test_store_errors_during_removal_are_reported(
    data_root: Path, release: Release, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = FilesystemModelAssetStore(data_root)
    service = ModelAssetService(_catalog(), store, release.fetcher())
    service.install("voice-a")
    await service.wait("voice-a")

    def fail(asset: AssetDescriptor) -> None:
        raise PermissionError("read-only data root")

    monkeypatch.setattr(store, "remove", fail)
    async with local_client(_app(service)) as client:
        response = await client.delete("/v1/model-assets/voice-a")
    assert response.status_code == 200
    assert (response.json()["status"], response.json()["reason"]) == ("failed", "asset_store_failed")


async def test_content_vanishing_before_delivery_is_not_installed(
    data_root: Path, release: Release, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _service(data_root, release)
    service.install("voice-a")
    await service.wait("voice-a")
    located = service.installed_location

    def vanish(asset_id: str):  # noqa: ANN202
        location = located(asset_id)
        for path in _installed(data_root):
            path.unlink()
        return location

    monkeypatch.setattr(service, "installed_location", vanish)
    async with local_client(_app(service)) as client:
        response = await client.get("/v1/model-assets/voice-a/content")
        head = await client.head("/v1/model-assets/voice-a/content")
    assert response.status_code == 404
    assert response.json() == {"detail": {"code": "model_asset_not_installed"}}
    assert head.status_code == 404 and head.content == b""


# Restart


async def test_installed_assets_survive_restart_and_are_size_checked(data_root: Path, release: Release) -> None:
    first = _service(data_root, release)
    first.install("voice-a")
    await first.wait("voice-a")

    restarted = _service(data_root, release)
    assert restarted.state("voice-a").status == "installed"
    async with local_client(_app(restarted)) as client:
        assert (await client.get("/v1/model-assets/voice-a/content")).content == PAYLOAD

    (installed,) = _installed(data_root)
    installed.write_bytes(PAYLOAD[:-1])
    assert _service(data_root, release).state("voice-a").status == "not_installed"


def test_service_start_discards_stale_staging(data_root: Path, release: Release) -> None:
    staging = data_root / "staging" / "model-assets"
    staging.mkdir(parents=True)
    (staging / "voice-a.abc.part").write_bytes(b"partial")

    _service(data_root, release)

    assert _staged(data_root) == []
    assert not staging.exists()


async def _chunks(body: bytes) -> AsyncIterator[bytes]:
    yield body


async def _interrupted() -> AsyncIterator[bytes]:
    yield PAYLOAD[:100]
    raise httpx.ReadError("connection reset")
