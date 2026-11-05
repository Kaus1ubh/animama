"""Shared backend model-asset downloader: verification, lifecycle and routes (R8–R12)."""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from animama.adapters.model_assets import FilesystemModelAssetStore, HttpAssetFetcher
from animama.app.ports.model_assets import AssetFetchError, FetchedBody
from animama.app.services.model_asset_service import (
    TRANSFER_RETRY_DELAYS,
    AssetInstallRefusedError,
    ModelAssetService,
    load_packaged_asset_catalog,
)
from animama.domain.model_assets import (
    ASSET_CATALOG_SCHEMA,
    INSTALL_HEADROOM_BYTES,
    AssetCatalog,
    AssetDescriptor,
    AssetFile,
    AssetRemovalVeto,
    parse_asset_catalog,
)
from animama.domain.request_principal import RequestPrincipal
from animama.server.config import Settings
from animama.server.deps import get_current_principal
from animama.server.model_assets import get_model_asset_service, model_asset_service_for
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


class FlakyFetcher:
    """An in-memory ``AssetFetcher`` honoring resume offsets.

    Each positional count breaks one request's body after that many bytes, in
    request order; later requests send the whole remainder.
    """

    def __init__(self, *breaks: int, body: bytes = PAYLOAD) -> None:
        self.starts: list[int] = []
        self._breaks = list(breaks)
        self._body = body

    @asynccontextmanager
    async def stream(self, asset_id: str, file: AssetFile, *, start: int = 0) -> AsyncIterator[FetchedBody]:
        self.starts.append(start)
        cut = self._breaks.pop(0) if self._breaks else None
        yield FetchedBody(start, self._chunks(asset_id, self._body[start:], cut))

    @staticmethod
    async def _chunks(asset_id: str, remainder: bytes, cut: int | None) -> AsyncIterator[bytes]:
        if cut is None:
            yield remainder
            return
        if cut:
            yield remainder[:cut]
        raise AssetFetchError("asset_download_failed", f"Asset {asset_id} transfer was interrupted: ReadTimeout")


class Backoff:
    """Record transfer retry delays instead of waiting them out."""

    def __init__(self) -> None:
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


def _service(data_root: Path, release: Release, catalog: AssetCatalog | None = None) -> ModelAssetService:
    return ModelAssetService(
        catalog or _catalog(), FilesystemModelAssetStore(data_root), release.fetcher(), sleep=Backoff()
    )


def _flaky_service(data_root: Path, fetcher: FlakyFetcher, backoff: Backoff) -> ModelAssetService:
    return ModelAssetService(_catalog(), FilesystemModelAssetStore(data_root), fetcher, sleep=backoff)


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


REPOSITORY = Path(__file__).resolve().parents[1]
# Each speech-to-text set is exactly its tracked manifest, published content-addressed.
SPEECH_SETS = {
    "parakeet-stt": "parakeet-tdt-0.6b-v2",
    "parakeet-stt-webgpu": "parakeet-tdt-0.6b-v2-webgpu",
    "sensevoice-stt": "sensevoice-small",
    "sensevoice-stt-webgpu": "sensevoice-small-webgpu",
}


@pytest.mark.parametrize(("asset_id", "model_id"), sorted(SPEECH_SETS.items()))
def test_packaged_speech_sets_equal_their_tracked_manifests(asset_id: str, model_id: str) -> None:
    manifest_path = REPOSITORY / "models" / model_id / "manifest.json"
    manifest = json.loads(manifest_path.read_bytes())

    asset = load_packaged_asset_catalog().get(asset_id)
    assert asset is not None and asset.is_set
    # The version directory is the digest of the manifest's exact bytes, as in scripts/models/parakeet.py.
    assert asset.manifest_sha256 == hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    assert [(file.path, file.size, file.sha256, file.url) for file in asset.files] == [
        (
            entry["path"],
            entry["size"],
            entry["sha256"],
            f"https://downloads.animama.ai/models/{model_id}/{entry['sha256']}/{entry['path']}",
        )
        for entry in manifest["files"]
    ]
    assert asset.size == sum(entry["size"] for entry in manifest["files"])
    assert asset.license_ref == manifest["license"]
    # The notices that ship with the weights are reviewed source inputs.
    reviewed = {
        record["path"] for record in json.loads((REPOSITORY / "licenses" / "source-review.json").read_text())["files"]
    }
    assert {f"models/{model_id}/ATTRIBUTION.md", f"models/{model_id}/README.md"} <= reviewed


def test_packaged_catalog_orders_parakeet_sets_and_drops_the_old_encoder() -> None:
    catalog = load_packaged_asset_catalog()
    assert catalog.get("parakeet-tdt-0.6b-v2-webgpu-encoder") is None
    gpu, base = catalog.get("parakeet-stt-webgpu"), catalog.get("parakeet-stt")
    assert gpu is not None and gpu.requires == ("parakeet-stt",)
    assert base is not None and base.requires == ()
    assert [asset.id for asset in catalog.required_by("parakeet-stt")] == ["parakeet-stt-webgpu"]
    sensevoice_gpu = catalog.get("sensevoice-stt-webgpu")
    assert sensevoice_gpu is not None and sensevoice_gpu.requires == ("sensevoice-stt",)
    assert [asset.id for asset in catalog.required_by("sensevoice-stt")] == ["sensevoice-stt-webgpu"]


def _set_entry(asset_id: str = "speech-set", **overrides: object) -> dict[str, object]:
    entry: dict[str, object] = {
        "id": asset_id,
        "manifest_sha256": "a" * 64,
        "license_ref": "CC-BY-4.0",
        "files": [
            {"path": "README.md", "url": f"{RELEASE}/{DIGEST}/README.md", "size": 3, "sha256": "b" * 64},
            {"path": "model.onnx", "url": f"{RELEASE}/{DIGEST}/model.onnx", "size": 5, "sha256": "c" * 64},
        ],
    }
    entry.update(overrides)
    return entry


def test_catalog_parses_sets_with_requirements() -> None:
    catalog = _catalog(_set_entry("base-set"), _set_entry("gpu-set", requires=["base-set"]), _entry())
    base, gpu, voice = (catalog.get(name) for name in ("base-set", "gpu-set", "voice-a"))
    assert base is not None and gpu is not None and voice is not None
    assert (base.is_set, base.version, base.size, base.media_type) == (True, "a" * 64, 8, None)
    assert [(file.path, file.media_type) for file in base.files] == [
        ("README.md", "text/plain; charset=utf-8"),
        ("model.onnx", "application/octet-stream"),
    ]
    assert gpu.requires == ("base-set",)
    assert (voice.is_set, voice.version, voice.media_type) == (False, DIGEST, "application/octet-stream")
    assert base.free_bytes_needed(5) == 3 + INSTALL_HEADROOM_BYTES


def _set_files(**overrides: object) -> list[dict[str, object]]:
    return [{"path": "model.onnx", "url": f"{RELEASE}/model.onnx", "size": 5, "sha256": "c" * 64, **overrides}]


@pytest.mark.parametrize(
    "entries",
    [
        [_set_entry(manifest_sha256="A" * 64)],
        [_set_entry(manifest_sha256=None)],
        [_set_entry(files=[])],
        [_set_entry(files=_set_files() * 2)],
        [_set_entry(files=_set_files(path="../escape"))],
        [_set_entry(files=_set_files(path=".hidden"))],
        [_set_entry(files=_set_files(path="nested/model.onnx"))],
        [_set_entry(files=_set_files(url="https://example.com/model.onnx"))],
        [_set_entry(files=_set_files(size=0))],
        [_set_entry(files=_set_files(extra=1))],
        [_set_entry(files=_set_files(media_type="application/octet-stream"))],
        [{**_set_entry(), "url": f"{RELEASE}/model.onnx"}],
        [_set_entry(requires=["missing"])],
        [_set_entry(requires="speech-set-base")],
        [_set_entry(requires=[])],
        [_set_entry(requires=["speech-set"])],
        [_set_entry("a"), _set_entry("b", requires=["a"]), _set_entry("c", requires=["b"])],
    ],
    ids=[
        "manifest-digest",
        "no-manifest-digest",
        "no-files",
        "repeated-path",
        "traversal",
        "hidden",
        "nested",
        "host",
        "size",
        "extra-file-field",
        "file-media-type",
        "mixed-shape",
        "unknown-requirement",
        "requirement-shape",
        "empty-requirements",
        "self-requirement",
        "nested-requirement",
    ],
)
def test_catalog_rejects_invalid_sets(entries: list[dict[str, object]]) -> None:
    with pytest.raises(ValueError):
        parse_asset_catalog({"schema": ASSET_CATALOG_SCHEMA, "assets": entries})


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
async def test_failed_downloads_install_nothing(
    data_root: Path,
    release: Release,
    response: Callable[[], httpx.Response],
    reason: str,
    request: pytest.FixtureRequest,
) -> None:
    reason_id = request.node.callspec.id
    release.routes["/voices/test/voice-a.bin"] = response
    release.serve("/voices/test/elsewhere.bin")
    service = _service(data_root, release)

    service.install("voice-a")
    state = await service.wait("voice-a")

    assert (state.status, state.reason) == ("failed", reason)
    # Redirects are never followed; only a body broken mid-stream is requested again.
    retries = len(TRANSFER_RETRY_DELAYS) if reason_id == "interrupted" else 0
    assert len(release.requests) == 1 + retries
    assert _installed(data_root) == []
    # Only an interrupted transfer keeps its received prefix for resume; corrupt bytes are discarded.
    assert [path.stat().st_size for path in _staged(data_root)] == ([100] if reason_id == "interrupted" else [])
    async with local_client(_app(service)) as client:
        assert (await client.get("/v1/model-assets/voice-a")).json()["reason"] == reason
        assert (await client.get("/v1/model-assets/voice-a/content")).status_code == 404

    # A later install retries and can succeed.
    release.serve("/voices/test/voice-a.bin")
    service.install("voice-a")
    assert (await service.wait("voice-a")).status == "installed"


async def test_install_is_refused_without_enough_free_space(
    data_root: Path, release: Release, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = FilesystemModelAssetStore(data_root)
    service = ModelAssetService(_catalog(), store, release.fetcher())
    required = len(PAYLOAD) + INSTALL_HEADROOM_BYTES
    monkeypatch.setattr(store, "free_bytes", lambda: required - 1)

    async with local_client(_app(service)) as client:
        listed = (await client.get("/v1/model-assets")).json()
        assert listed["free_bytes"] == required - 1
        assert listed["assets"][0]["required_free_bytes"] == required

        refused = await client.post("/v1/model-assets/voice-a:install")
        assert refused.status_code == 202
        assert (refused.json()["status"], refused.json()["reason"]) == ("failed", "asset_insufficient_space")
    assert release.requests == []
    assert _staged(data_root) == []

    # Once space is available, a retry downloads normally.
    monkeypatch.setattr(store, "free_bytes", lambda: required)
    service.install("voice-a")
    assert (await service.wait("voice-a")).status == "installed"


async def test_unmeasurable_free_space_refuses_install(
    data_root: Path, release: Release, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = FilesystemModelAssetStore(data_root)
    service = ModelAssetService(_catalog(), store, release.fetcher())

    def unreadable() -> int:
        raise PermissionError("data root not readable")

    monkeypatch.setattr(store, "free_bytes", unreadable)
    async with local_client(_app(service)) as client:
        assert (await client.get("/v1/model-assets")).json()["free_bytes"] is None
        refused = (await client.post("/v1/model-assets/voice-a:install")).json()
    assert (refused["status"], refused["reason"]) == ("failed", "asset_store_failed")
    assert release.requests == []


def test_store_reports_free_space_before_its_directories_exist(data_root: Path) -> None:
    free = FilesystemModelAssetStore(data_root).free_bytes()
    assert isinstance(free, int) and free > 0
    assert not data_root.exists()


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
    outside = AssetDescriptor.single_file(**{**_entry(), "url": "https://example.com/voice-a.bin"})  # type: ignore[arg-type]
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
    # A stand-in file, since real descriptors already reject these URLs.
    file = SimpleNamespace(url=url, size=len(PAYLOAD))
    with pytest.raises(AssetFetchError) as refused:
        async with release.fetcher().stream("voice-a", file):  # type: ignore[arg-type]
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


# Interrupted transfers


async def test_an_interrupted_transfer_resumes_from_its_staged_prefix(data_root: Path) -> None:
    fetcher, backoff = FlakyFetcher(100, 1000), Backoff()
    service = _flaky_service(data_root, fetcher, backoff)

    service.install("voice-a")
    state = await service.wait("voice-a")

    assert state.status == "installed"
    assert fetcher.starts == [0, 100, 1100]
    # Each attempt grew the staged prefix, so the backoff never escalated.
    assert backoff.delays == [TRANSFER_RETRY_DELAYS[0]] * 2
    (installed,) = _installed(data_root)
    assert installed.read_bytes() == PAYLOAD
    assert _staged(data_root) == []


async def test_repeated_interruptions_without_progress_fail_and_keep_the_prefix(data_root: Path) -> None:
    fetcher, backoff = FlakyFetcher(100, *[0] * len(TRANSFER_RETRY_DELAYS)), Backoff()
    service = _flaky_service(data_root, fetcher, backoff)

    service.install("voice-a")
    state = await service.wait("voice-a")

    assert (state.status, state.reason) == ("failed", "asset_download_failed")
    assert fetcher.starts == [0] + [100] * len(TRANSFER_RETRY_DELAYS)
    assert backoff.delays == list(TRANSFER_RETRY_DELAYS)
    assert [path.stat().st_size for path in _staged(data_root)] == [100]

    # A later install resumes from the kept prefix.
    service.install("voice-a")
    assert (await service.wait("voice-a")).status == "installed"
    assert fetcher.starts[-1] == 100


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        (PAYLOAD[:-1], "asset_size_invalid"),
        (PAYLOAD + b"x", "asset_size_invalid"),
        (b"\0" * len(PAYLOAD), "asset_hash_invalid"),
    ],
    ids=["short", "long", "hash"],
)
async def test_integrity_failures_are_not_retried(data_root: Path, body: bytes, reason: str) -> None:
    fetcher, backoff = FlakyFetcher(body=body), Backoff()
    service = _flaky_service(data_root, fetcher, backoff)

    service.install("voice-a")
    state = await service.wait("voice-a")

    assert (state.status, state.reason) == ("failed", reason)
    assert fetcher.starts == [0]
    assert backoff.delays == []
    assert _staged(data_root) == []


async def test_removal_cancels_a_pending_transfer_retry(data_root: Path) -> None:
    waiting, never = asyncio.Event(), asyncio.Event()

    async def stalled(delay: float) -> None:
        waiting.set()
        await never.wait()

    fetcher = FlakyFetcher(100)
    service = ModelAssetService(_catalog(), FilesystemModelAssetStore(data_root), fetcher, sleep=stalled)
    service.install("voice-a")
    await asyncio.wait_for(waiting.wait(), 5)
    assert service.state("voice-a").bytes_downloaded == 100

    removed = await service.remove("voice-a")

    assert removed.status == "not_installed"
    assert fetcher.starts == [0]
    assert _installed(data_root) == []
    assert _staged(data_root) == []


async def test_an_interrupted_http_body_logs_its_cause_and_resumes_with_a_range(
    data_root: Path, release: Release, caplog: pytest.LogCaptureFixture
) -> None:
    release.routes["/voices/test/voice-a.bin"] = lambda: httpx.Response(200, content=_interrupted())
    service = _service(data_root, release)

    with caplog.at_level(logging.WARNING, logger="animama.app.services.model_asset_service"):
        service.install("voice-a")
        state = await service.wait("voice-a")

    assert (state.status, state.reason) == ("failed", "asset_download_failed")
    ranges = [request.headers.get("range") for request in release.requests]
    assert ranges == [None] + ["bytes=100-"] * len(TRANSFER_RETRY_DELAYS)
    # The log names the transport failure, not just that the transfer stopped.
    assert "transfer was interrupted: ReadError: connection reset" in caplog.text


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


# End of downloads


async def test_ended_downloads_keep_installed_assets_and_refuse_new_installs(data_root: Path, release: Release) -> None:
    offered = _service(data_root, release)
    offered.install("voice-a")
    await offered.wait("voice-a")
    assert len(release.requests) == 1

    ended = ModelAssetService(
        _catalog(), FilesystemModelAssetStore(data_root), release.fetcher(), downloads_offered=False
    )
    async with local_client(_app(ended)) as client:
        listed = (await client.get("/v1/model-assets")).json()
        assert listed["downloads_offered"] is False
        assert listed["assets"][0]["status"] == "installed"
        # An installed asset is still served and reported as installed.
        assert (await client.get("/v1/model-assets/voice-a/content")).content == PAYLOAD
        again = await client.post("/v1/model-assets/voice-a:install")
        assert again.status_code == 202 and again.json()["status"] == "installed"

        removed = await client.delete("/v1/model-assets/voice-a")
        assert removed.status_code == 200 and removed.json()["status"] == "not_installed"
        refused = await client.post("/v1/model-assets/voice-a:install")
        assert refused.status_code == 409
        assert refused.json()["detail"] == {"code": "model_downloads_ended", "details": {}}
        assert (await client.get("/v1/model-assets/voice-a")).json()["status"] == "not_installed"
    assert len(release.requests) == 1
    assert _installed(data_root) == []
    assert _staged(data_root) == []


async def test_offered_downloads_are_listed(data_root: Path, release: Release) -> None:
    async with local_client(_app(_service(data_root, release))) as client:
        assert (await client.get("/v1/model-assets")).json()["downloads_offered"] is True


def test_local_composition_offers_downloads_until_the_final_release(tmp_path: Path) -> None:
    application = FastAPI()
    application.state.runtime_settings = Settings(animama_data_root=tmp_path / "data")
    # The final release turns this off; until then local compositions download.
    assert model_asset_service_for(application).downloads_offered is True


def test_ended_downloads_are_refused_before_requirements(data_root: Path, release: Release) -> None:
    ended = ModelAssetService(
        load_packaged_asset_catalog(), FilesystemModelAssetStore(data_root), release.fetcher(), downloads_offered=False
    )
    # The GPU add-on needs its CPU set; the end of downloads is the answer first.
    with pytest.raises(AssetInstallRefusedError) as refused:
        ended.install("parakeet-stt-webgpu")
    assert refused.value.code == "model_downloads_ended"


def test_ended_downloads_discard_staged_bytes(data_root: Path) -> None:
    staged = data_root / "staging" / "model-assets" / "voice-a" / DIGEST
    staged.mkdir(parents=True)
    (staged / DIGEST).write_bytes(PAYLOAD[:100])  # A single file is staged under its digest.

    _service(data_root, Release())
    assert _staged(data_root), "a resumable prefix is kept while downloads are offered"

    ModelAssetService(_catalog(), FilesystemModelAssetStore(data_root), Release().fetcher(), downloads_offered=False)

    # A partial download can never resume, so its bytes are not kept.
    assert _staged(data_root) == []


def test_service_start_discards_stale_staging(data_root: Path, release: Release) -> None:
    staging = data_root / "staging" / "model-assets"
    staging.mkdir(parents=True)
    (staging / "voice-a.abc.part").write_bytes(b"partial")

    _service(data_root, release)

    # Legacy flat staging files can never resume.
    assert _staged(data_root) == []


async def _chunks(body: bytes) -> AsyncIterator[bytes]:
    yield body


async def _interrupted() -> AsyncIterator[bytes]:
    yield PAYLOAD[:100]
    raise httpx.ReadError("connection reset")
