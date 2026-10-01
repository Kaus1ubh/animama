"""Multi-file model-asset sets: resume, atomic activation, use leases and requirements (ADR 0012)."""

from __future__ import annotations

import asyncio
import hashlib
import threading
from collections.abc import AsyncIterator, Callable
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from animama.adapters.model_assets import FilesystemModelAssetStore, HttpAssetFetcher
from animama.app.services.model_asset_service import (
    LEASE_TTL_SECONDS,
    AssetInstallRefusedError,
    AssetRemovalRefusedError,
    ModelAssetService,
)
from animama.domain.model_assets import (
    ASSET_CATALOG_SCHEMA,
    INSTALL_HEADROOM_BYTES,
    AssetCatalog,
    AssetDescriptor,
    parse_asset_catalog,
)
from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_current_principal
from animama.server.model_assets import get_model_asset_service
from animama.server.routers import model_assets
from tests.local_http_client import local_client

RELEASE = "https://downloads.animama.ai/models"
FILES = {
    "README.md": b"readme\n",
    "config.json": b'{"model": "fixture"}',
    "model.onnx": bytes(range(256)) * 32,  # 8 KiB
}
GPU_FILES = {"README.md": b"gpu readme\n", "encoder.onnx": bytes(reversed(range(256))) * 16}
MANIFEST = "1" * 64
GPU_MANIFEST = "2" * 64
LEASE = "renderer-lease-1"

Responder = Callable[[httpx.Request, bytes], httpx.Response]


def _digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _url(model: str, name: str, body: bytes) -> str:
    return f"{RELEASE}/{model}/{_digest(body)}/{name}"


def _set_entry(asset_id: str, model: str, files: dict[str, bytes], manifest: str, **extra: object) -> dict[str, object]:
    return {
        "id": asset_id,
        "manifest_sha256": manifest,
        "license_ref": "CC-BY-4.0",
        **extra,
        "files": [
            {"path": name, "url": _url(model, name, body), "size": len(body), "sha256": _digest(body)}
            for name, body in files.items()
        ],
    }


def _catalog() -> AssetCatalog:
    return parse_asset_catalog(
        {
            "schema": ASSET_CATALOG_SCHEMA,
            "assets": [
                _set_entry("speech", "speech-model", FILES, MANIFEST),
                _set_entry("speech-gpu", "speech-gpu-model", GPU_FILES, GPU_MANIFEST, requires=["speech"]),
            ],
        }
    )


async def _stream(body: bytes) -> AsyncIterator[bytes]:
    yield body


def ranged(request: httpx.Request, body: bytes) -> httpx.Response:
    """A release host honoring open-ended byte ranges, like the object store."""

    requested = request.headers.get("range")
    if requested:
        start = int(requested.removeprefix("bytes=").removesuffix("-"))
        headers = {"content-range": f"bytes {start}-{len(body) - 1}/{len(body)}"}
        return httpx.Response(206, headers=headers, content=_stream(body[start:]))
    return httpx.Response(200, content=_stream(body))


def whole(request: httpx.Request, body: bytes) -> httpx.Response:
    """A host that ignores Range and always sends the whole file."""

    return httpx.Response(200, content=_stream(body))


def interrupted_after(count: int) -> Responder:
    async def broken(body: bytes) -> AsyncIterator[bytes]:
        yield body[:count]
        raise httpx.ReadError("connection reset")

    def respond(request: httpx.Request, body: bytes) -> httpx.Response:
        return httpx.Response(200, content=broken(body))

    return respond


class SetRelease:
    """A MockTransport release host serving fixture files with per-path behavior."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.bodies: dict[str, bytes] = {}
        self.responders: dict[str, Responder] = {}
        for model, files in (("speech-model", FILES), ("speech-gpu-model", GPU_FILES)):
            for name, body in files.items():
                self.bodies[httpx.URL(_url(model, name, body)).path] = body

    def path(self, name: str, files: dict[str, bytes] = FILES, model: str = "speech-model") -> str:
        return httpx.URL(_url(model, name, files[name])).path

    def respond(self, name: str, responder: Responder) -> None:
        self.responders[self.path(name)] = responder

    def requested(self, name: str) -> list[httpx.Request]:
        return [request for request in self.requests if request.url.path == self.path(name)]

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        body = self.bodies.get(request.url.path)
        if body is None:
            return httpx.Response(404)
        return self.responders.get(request.url.path, ranged)(request, body)

    def fetcher(self) -> HttpAssetFetcher:
        return HttpAssetFetcher(transport=httpx.MockTransport(self.handler))


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def data_root(tmp_path: Path) -> Path:
    return tmp_path / "data"


@pytest.fixture
def release() -> SetRelease:
    return SetRelease()


@pytest.fixture
def clock() -> Clock:
    return Clock()


def _service(data_root: Path, release: SetRelease, clock: Clock | None = None) -> ModelAssetService:
    return ModelAssetService(
        _catalog(), FilesystemModelAssetStore(data_root), release.fetcher(), clock=clock or Clock()
    )


def _app(service: ModelAssetService) -> FastAPI:
    app = FastAPI()
    app.include_router(model_assets.router)
    app.dependency_overrides[get_model_asset_service] = lambda: service
    app.dependency_overrides[get_current_principal] = lambda: RequestPrincipal(id="model-asset-owner")
    return app


def _tree(root: Path) -> dict[str, int]:
    """Relative file paths and sizes beneath a root."""

    if not root.exists():
        return {}
    return {str(path.relative_to(root)): path.stat().st_size for path in sorted(root.rglob("*")) if path.is_file()}


def _installed(data_root: Path) -> dict[str, int]:
    return _tree(data_root / "internal" / "model-assets")


def _staged(data_root: Path) -> dict[str, int]:
    return _tree(data_root / "staging" / "model-assets")


def _staged_file(data_root: Path, name: str, asset: str = "speech", version: str = MANIFEST) -> Path:
    return data_root / "staging" / "model-assets" / asset / version / name


async def _install(service: ModelAssetService, asset_id: str = "speech") -> str:
    service.install(asset_id)
    return (await service.wait(asset_id)).status


# Activation


async def test_set_installs_as_one_version_directory(data_root: Path, release: SetRelease) -> None:
    service = _service(data_root, release)
    async with local_client(_app(service)) as client:
        before = (await client.get("/v1/model-assets/speech")).json()
        assert (before["files_total"], before["files_verified"], before["version"]) == (3, 0, None)
        assert before["media_type"] is None and before["size_bytes"] == sum(map(len, FILES.values()))

        started = (await client.post("/v1/model-assets/speech:install")).json()
        assert started["status"] == "downloading"
        assert started["total_bytes"] == sum(map(len, FILES.values()))
        await service.wait("speech")

        state = (await client.get("/v1/model-assets/speech")).json()
        assert (state["status"], state["files_verified"], state["version"]) == ("installed", 3, MANIFEST)
        assert state["content_url"] is None  # A set is served by its consumer's mount.
        gpu = (await client.get("/v1/model-assets/speech-gpu")).json()
        assert gpu["requires"] == ["speech"]

    assert _installed(data_root) == {f"speech/{MANIFEST}/{name}": len(body) for name, body in FILES.items()}
    assert _staged(data_root) == {}
    installed = service.installed_set("speech")
    assert installed is not None and installed.version == MANIFEST
    assert [(path.name, path.read_bytes()) for path in sorted(installed.root.iterdir())] == sorted(FILES.items())


async def test_activation_replaces_previous_versions_and_requires_every_file(
    data_root: Path, release: SetRelease
) -> None:
    previous = data_root / "internal" / "model-assets" / "speech" / ("0" * 64)
    previous.mkdir(parents=True)
    (previous / "model.onnx").write_bytes(b"old")
    service = _service(data_root, release)
    assert await _install(service) == "installed"
    assert sorted(path.name for path in previous.parent.iterdir()) == [MANIFEST]

    # A missing or wrongly sized file makes the whole set not installed.
    directory = previous.parent / MANIFEST
    (directory / "README.md").unlink()
    assert service.state("speech").status == "not_installed"
    assert service.installed_set("speech") is None
    (directory / "README.md").write_bytes(FILES["README.md"] + b"x")
    assert service.state("speech").status == "not_installed"


async def test_failure_mid_file_installs_nothing(data_root: Path, release: SetRelease) -> None:
    release.respond("config.json", interrupted_after(5))
    service = _service(data_root, release)

    state = await _install(service)

    assert state == "failed"
    assert _installed(data_root) == {}
    assert service.installed_set("speech") is None


async def test_failure_after_all_but_one_file_installs_nothing(data_root: Path, release: SetRelease) -> None:
    release.respond("model.onnx", lambda request, body: httpx.Response(200, content=_stream(b"\0" * len(body))))
    service = _service(data_root, release)

    service.install("speech")
    failed = await service.wait("speech")

    assert (failed.status, failed.reason) == ("failed", "asset_hash_invalid")
    assert _installed(data_root) == {}
    # Verified files stay staged; the corrupt file is discarded.
    assert _staged(data_root) == {
        f"speech/{MANIFEST}/README.md": len(FILES["README.md"]),
        f"speech/{MANIFEST}/config.json": len(FILES["config.json"]),
    }

    del release.responders[release.path("model.onnx")]
    release.requests.clear()
    assert await _install(service) == "installed"
    assert [request.url.path for request in release.requests] == [release.path("model.onnx")]


# Resume


async def test_interrupted_set_resumes_after_restart_with_a_range_request(data_root: Path, release: SetRelease) -> None:
    release.respond("model.onnx", interrupted_after(1000))
    assert await _install(_service(data_root, release)) == "failed"
    assert _staged_file(data_root, "model.onnx").stat().st_size == 1000

    del release.responders[release.path("model.onnx")]
    release.requests.clear()
    restarted = _service(data_root, release)
    resumed = restarted.install("speech")
    # Progress starts from the staged bytes, not zero.
    assert resumed.bytes_downloaded == len(FILES["README.md"]) + len(FILES["config.json"]) + 1000
    assert (await restarted.wait("speech")).status == "installed"

    (request,) = release.requests
    assert request.url.path == release.path("model.onnx")
    assert request.headers["range"] == "bytes=1000-"
    directory = data_root / "internal" / "model-assets" / "speech" / MANIFEST
    assert (directory / "model.onnx").read_bytes() == FILES["model.onnx"]


async def test_a_server_ignoring_range_restarts_the_file(data_root: Path, release: SetRelease) -> None:
    release.respond("model.onnx", interrupted_after(1000))
    service = _service(data_root, release)
    assert await _install(service) == "failed"

    release.respond("model.onnx", whole)
    assert await _install(service) == "installed"
    assert release.requested("model.onnx")[-1].headers["range"] == "bytes=1000-"
    directory = data_root / "internal" / "model-assets" / "speech" / MANIFEST
    assert (directory / "model.onnx").read_bytes() == FILES["model.onnx"]


@pytest.mark.parametrize(
    "content_range",
    ["bytes 0-8191/8192", "bytes 1000-8191/9000", "bytes 1000-8000/8192", None],
    ids=["wrong-start", "wrong-total", "wrong-end", "missing"],
)
async def test_a_mismatched_content_range_fails_and_keeps_the_prefix(
    data_root: Path, release: SetRelease, content_range: str | None
) -> None:
    release.respond("model.onnx", interrupted_after(1000))
    service = _service(data_root, release)
    assert await _install(service) == "failed"

    def mismatched(request: httpx.Request, body: bytes) -> httpx.Response:
        headers = {"content-range": content_range} if content_range else {}
        return httpx.Response(206, headers=headers, content=_stream(body[1000:]))

    release.respond("model.onnx", mismatched)
    service.install("speech")
    state = await service.wait("speech")

    assert (state.status, state.reason) == ("failed", "asset_download_failed")
    assert _installed(data_root) == {}
    assert _staged_file(data_root, "model.onnx").read_bytes() == FILES["model.onnx"][:1000]


async def test_unexpected_partial_content_for_a_fresh_request_fails(data_root: Path, release: SetRelease) -> None:
    release.respond(
        "README.md",
        lambda request, body: httpx.Response(206, headers={"content-range": "bytes 0-6/7"}, content=_stream(body)),
    )
    service = _service(data_root, release)
    service.install("speech")
    state = await service.wait("speech")
    assert (state.status, state.reason) == ("failed", "asset_download_failed")


async def test_a_corrupt_staged_prefix_fails_its_digest_then_restarts(data_root: Path, release: SetRelease) -> None:
    release.respond("model.onnx", interrupted_after(1000))
    service = _service(data_root, release)
    assert await _install(service) == "failed"
    _staged_file(data_root, "model.onnx").write_bytes(b"\xff" * 1000)

    del release.responders[release.path("model.onnx")]
    service.install("speech")
    failed = await service.wait("speech")
    assert (failed.status, failed.reason) == ("failed", "asset_hash_invalid")
    assert release.requested("model.onnx")[-1].headers["range"] == "bytes=1000-"
    assert not _staged_file(data_root, "model.onnx").exists()

    assert await _install(service) == "installed"
    assert "range" not in release.requested("model.onnx")[-1].headers


async def test_an_oversized_staged_file_restarts_from_zero(data_root: Path, release: SetRelease) -> None:
    staged = _staged_file(data_root, "README.md")
    staged.parent.mkdir(parents=True)
    staged.write_bytes(FILES["README.md"] + b"extra")
    service = _service(data_root, release)
    assert await _install(service) == "installed"
    assert "range" not in release.requested("README.md")[0].headers


async def test_cancel_discards_staged_bytes_but_shutdown_keeps_them(data_root: Path, release: SetRelease) -> None:
    sent, never = asyncio.Event(), asyncio.Event()

    async def stalled(body: bytes) -> AsyncIterator[bytes]:
        yield body[:1000]
        sent.set()
        await never.wait()

    release.respond("model.onnx", lambda request, body: httpx.Response(200, content=stalled(body)))
    service = _service(data_root, release)
    service.install("speech")
    await asyncio.wait_for(sent.wait(), 5)
    await service.aclose()
    assert _staged_file(data_root, "model.onnx").stat().st_size == 1000

    sent.clear()
    restarted = _service(data_root, release)
    restarted.install("speech")
    await asyncio.wait_for(sent.wait(), 5)
    removed = await restarted.remove("speech")
    assert removed.status == "not_installed"
    assert _staged(data_root) == {}


async def test_free_space_counts_only_the_remaining_bytes(
    data_root: Path, release: SetRelease, monkeypatch: pytest.MonkeyPatch
) -> None:
    release.respond("model.onnx", interrupted_after(1000))
    store = FilesystemModelAssetStore(data_root)
    service = ModelAssetService(_catalog(), store, release.fetcher())
    assert await _install(service) == "failed"
    remaining = len(FILES["model.onnx"]) - 1000 + INSTALL_HEADROOM_BYTES

    del release.responders[release.path("model.onnx")]
    monkeypatch.setattr(store, "free_bytes", lambda: remaining - 1)
    refused = service.install("speech")
    assert (refused.status, refused.reason) == ("failed", "asset_insufficient_space")
    monkeypatch.setattr(store, "free_bytes", lambda: remaining)
    assert await _install(service) == "installed"


# Startup cleanup


def test_startup_removes_obsolete_ids_and_unresumable_staging(data_root: Path, release: SetRelease) -> None:
    installed = data_root / "internal" / "model-assets"
    obsolete = installed / "parakeet-tdt-0.6b-v2-webgpu-encoder" / ("a" * 64)
    obsolete.parent.mkdir(parents=True)
    obsolete.write_bytes(b"old encoder")
    (installed / "speech" / MANIFEST).mkdir(parents=True)
    staging = data_root / "staging" / "model-assets"
    (staging / "unknown" / "v").mkdir(parents=True)
    (staging / "speech" / ("9" * 64)).mkdir(parents=True)
    (staging / "speech-gpu.abc.part").write_bytes(b"legacy")
    resumable = _staged_file(data_root, "model.onnx")
    resumable.parent.mkdir(parents=True)
    resumable.write_bytes(b"partial")
    (resumable.parent / "stray.bin").write_bytes(b"stray")

    _service(data_root, release)

    assert sorted(path.name for path in installed.iterdir()) == ["speech"]
    assert _staged(data_root) == {f"speech/{MANIFEST}/model.onnx": len(b"partial")}
    assert sorted(path.name for path in staging.iterdir()) == ["speech"]


# Leases and requirements


async def test_live_leases_refuse_removal_until_released_or_expired(
    data_root: Path, release: SetRelease, clock: Clock
) -> None:
    service = _service(data_root, release, clock)
    async with local_client(_app(service)) as client:
        not_installed = await client.post("/v1/model-assets/speech:lease", json={"lease_id": LEASE})
        assert not_installed.status_code == 409
        assert not_installed.json()["detail"] == {"code": "model_asset_not_installed"}
        assert await _install(service) == "installed"

        leased = await client.post("/v1/model-assets/speech:lease", json={"lease_id": LEASE})
        assert leased.status_code == 200
        assert leased.json()["ttl_seconds"] == LEASE_TTL_SECONDS
        assert (leased.json()["asset_id"], leased.json()["lease_id"]) == ("speech", LEASE)

        refused = await client.delete("/v1/model-assets/speech")
        assert refused.status_code == 409
        assert refused.json()["detail"] == {"code": "model_asset_in_use", "details": {}}
        assert service.state("speech").status == "installed"

        # Renewal extends the lease; expiry without renewal releases it.
        clock.now += LEASE_TTL_SECONDS - 1
        assert (await client.post("/v1/model-assets/speech:lease", json={"lease_id": LEASE})).status_code == 200
        clock.now += LEASE_TTL_SECONDS - 1
        assert (await client.delete("/v1/model-assets/speech")).status_code == 409
        clock.now += 2
        assert (await client.delete("/v1/model-assets/speech")).json()["status"] == "not_installed"

        assert await _install(service) == "installed"
        assert (await client.post("/v1/model-assets/speech:lease", json={"lease_id": LEASE})).status_code == 200
        released = await client.delete(f"/v1/model-assets/speech/leases/{LEASE}")
        assert released.status_code == 204
        assert (await client.delete(f"/v1/model-assets/speech/leases/{LEASE}")).status_code == 204
        assert (await client.delete("/v1/model-assets/speech")).json()["status"] == "not_installed"


async def test_lease_ids_are_validated_and_bounded(data_root: Path, release: SetRelease) -> None:
    service = _service(data_root, release)
    assert await _install(service) == "installed"
    async with local_client(_app(service)) as client:
        for invalid in ("short", "has/slash-1234", "x" * 129):
            response = await client.post("/v1/model-assets/speech:lease", json={"lease_id": invalid})
            assert response.status_code == 422
        assert (await client.post("/v1/model-assets/unknown:lease", json={"lease_id": LEASE})).status_code == 404
        assert (await client.delete(f"/v1/model-assets/unknown/leases/{LEASE}")).status_code == 404
        for index in range(32):
            lease = {"lease_id": f"renderer-{index:04d}"}
            assert (await client.post("/v1/model-assets/speech:lease", json=lease)).status_code == 200
        limited = await client.post("/v1/model-assets/speech:lease", json={"lease_id": "renderer-9999"})
        assert limited.status_code == 409
        assert limited.json()["detail"] == {"code": "model_asset_lease_limit"}


async def test_gpu_set_requires_the_base_set(data_root: Path, release: SetRelease) -> None:
    service = _service(data_root, release)
    async with local_client(_app(service)) as client:
        refused = await client.post("/v1/model-assets/speech-gpu:install")
        assert refused.status_code == 409
        assert refused.json()["detail"] == {"code": "model_asset_requires", "details": {"requires": ["speech"]}}
        assert not any(request.url.path.startswith("/models/speech-gpu-model") for request in release.requests)

        assert await _install(service) == "installed"
        assert await _install(service, "speech-gpu") == "installed"

        blocked = await client.delete("/v1/model-assets/speech")
        assert blocked.status_code == 409
        assert blocked.json()["detail"] == {
            "code": "model_asset_required_by",
            "details": {"required_by": ["speech-gpu"]},
        }
        assert service.state("speech").status == "installed"

        assert (await client.delete("/v1/model-assets/speech-gpu")).json()["status"] == "not_installed"
        assert (await client.delete("/v1/model-assets/speech")).json()["status"] == "not_installed"


async def test_a_dependent_cannot_start_while_its_requirement_is_being_removed(
    data_root: Path, release: SetRelease, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _service(data_root, release)
    assert await _install(service) == "installed"
    store = service._store  # noqa: SLF001 - hold the deletion open
    entered, proceed = threading.Event(), threading.Event()
    original_remove = store.remove

    def held_remove(asset: AssetDescriptor) -> None:
        entered.set()
        proceed.wait(5)
        original_remove(asset)

    monkeypatch.setattr(store, "remove", held_remove)
    removal = asyncio.create_task(service.remove("speech"))
    await asyncio.to_thread(entered.wait, 5)

    with pytest.raises(AssetInstallRefusedError) as refused:
        service.install("speech-gpu")
    assert refused.value.code == "model_asset_requires"

    proceed.set()
    assert (await removal).status == "not_installed"
    assert not any(request.url.path.startswith("/models/speech-gpu-model") for request in release.requests)


async def test_a_requirement_cannot_be_removed_while_its_dependent_downloads(
    data_root: Path, release: SetRelease
) -> None:
    service = _service(data_root, release)
    assert await _install(service) == "installed"
    gate = asyncio.Event()

    async def slow(body: bytes) -> AsyncIterator[bytes]:
        await gate.wait()
        yield body

    release.responders[release.path("encoder.onnx", GPU_FILES, "speech-gpu-model")] = lambda _request, body: (
        httpx.Response(200, content=slow(body), headers={"content-length": str(len(body))})
    )
    service.install("speech-gpu")
    await asyncio.sleep(0)

    with pytest.raises(AssetRemovalRefusedError) as refused:
        await service.remove("speech")
    assert refused.value.veto.code == "model_asset_required_by"

    gate.set()
    assert (await service.wait("speech-gpu")).status == "installed"


async def test_reinstall_replaces_an_incomplete_leftover_version_directory(
    data_root: Path, release: SetRelease
) -> None:
    leftover = data_root / "internal" / "model-assets" / "speech" / MANIFEST
    leftover.mkdir(parents=True)
    (leftover / "model.onnx").write_bytes(b"partial")
    service = _service(data_root, release)
    assert service.state("speech").status == "not_installed"

    assert await _install(service) == "installed"

    assert _installed(data_root) == {f"speech/{MANIFEST}/{name}": len(body) for name, body in FILES.items()}
