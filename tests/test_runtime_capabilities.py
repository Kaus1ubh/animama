"""Optional desktop work is admitted by the API, independently of renderer state."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from sqlalchemy import delete

from animama.adapters.model_assets import FilesystemModelAssetStore
from animama.adapters.repositories.sqlalchemy.runtime_worker_repo import (
    clear_document_heartbeat,
    record_document_heartbeat,
)
from animama.app.services.model_asset_service import ModelAssetService
from animama.app.services.user_file_processing_service import (
    UserFileProcessingConflictError,
    UserFileProcessingService,
)
from animama.domain.model_assets import ASSET_CATALOG_SCHEMA, parse_asset_catalog
from animama.domain.request_principal import RequestPrincipal
from animama.orm.runtime_worker import ORMRuntimeWorkerHeartbeat
from animama.orm.user_file import ORMUserFile
from animama.orm.user_file_processing_job import ORMUserFileProcessingJob
from animama.server.config import Settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers import desktop_control, runtime_capabilities, user_files
from tests.local_http_client import local_client
from tests.test_model_asset_sets import FILES, GPU_FILES, GPU_MANIFEST, MANIFEST, SetRelease, _set_entry


def _app(session, tmp_path, *, enabled=False, **settings):
    """Use real route dependencies with a deliberately separate test principal."""

    app = FastAPI()
    app.state.runtime_settings = Settings(
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
        animama_user_file_processing_enabled=enabled,
        animama_desktop_control_token="c" * 64,
        animama_document_worker_instance_id="expected-instance",
        **{"animama_parakeet_stt_enabled": False, **settings},
    )
    app.state.local_runtime_paths = SimpleNamespace(included_sources=(), operations_root=tmp_path / "operations")
    app.include_router(runtime_capabilities.router)
    app.include_router(desktop_control.router)
    app.include_router(user_files.router)

    async def principal():
        return RequestPrincipal(id="installation-owner")

    async def database():
        yield session

    app.dependency_overrides[get_current_principal] = principal
    app.dependency_overrides[get_async_session] = database
    return app


@pytest.mark.parametrize(
    ("enabled", "age", "instance", "expected"),
    [
        (False, None, None, "disabled"),
        (True, None, None, "starting"),
        (True, 1, "expected-instance", "ready"),
        (True, 21, "expected-instance", "stale"),
        (True, 1, "previous-instance", "starting"),
    ],
)
async def test_capabilities_separate_pack_presence_and_worker_liveness(
    async_session, tmp_path, enabled, age, instance, expected
):
    await async_session.execute(delete(ORMRuntimeWorkerHeartbeat))
    if age is not None:
        async_session.add(
            ORMRuntimeWorkerHeartbeat(
                kind="document-processing",
                instance_id=instance,
                heartbeat_at=datetime.now(UTC) - timedelta(seconds=age),
            )
        )
    await async_session.commit()
    app = _app(async_session, tmp_path, enabled=enabled)
    async with local_client(app) as client:
        response = await client.get("/v1/runtime-capabilities")
        assert response.status_code == 200
        body = response.json()
        assert body["runtime_kind"] == "desktop"
        assert body["offline_speech_enabled"] is False
        assert body["offline_speech_asset_version"] is None
        assert body["offline_speech_gpu_asset_version"] is None
        processing = body["user_file_processing"]
        assert processing["enabled"] is enabled
        assert processing["worker_state"] == expected
        assert bool(processing["supported_extensions"]) is enabled
        assert (processing["last_heartbeat_at"] is not None) == (expected in {"ready", "stale"})
        assert "expected-instance" not in response.text
        assert "c" * 64 not in response.text
    await async_session.execute(delete(ORMRuntimeWorkerHeartbeat))
    await async_session.commit()


async def test_operator_parakeet_source_reports_its_launch_versions(async_session, tmp_path):
    app = _app(
        async_session,
        tmp_path,
        animama_parakeet_stt_enabled=True,
        animama_parakeet_asset_version="0.1.0-base",
        animama_parakeet_webgpu_asset_version="0.1.1-gpu",
    )
    async with local_client(app) as client:
        body = (await client.get("/v1/runtime-capabilities")).json()
    assert (body["offline_speech_enabled"], body["offline_speech_asset_version"]) == (True, "0.1.0-base")
    assert body["offline_speech_gpu_asset_version"] == "0.1.1-gpu"


@pytest.mark.parametrize("operator_enabled", [True, False])
async def test_asset_store_offline_speech_follows_installs_without_a_restart(async_session, tmp_path, operator_enabled):
    app = _app(
        async_session,
        tmp_path,
        animama_parakeet_source="asset-store",
        animama_parakeet_stt_enabled=operator_enabled,
        # Launch versions belong to the operator source and are ignored here.
        animama_parakeet_asset_version="0.1.0-base",
    )
    service = ModelAssetService(
        parse_asset_catalog(
            {
                "schema": ASSET_CATALOG_SCHEMA,
                "assets": [
                    _set_entry("parakeet-stt", "speech-model", FILES, MANIFEST),
                    _set_entry(
                        "parakeet-stt-webgpu", "speech-gpu-model", GPU_FILES, GPU_MANIFEST, requires=["parakeet-stt"]
                    ),
                ],
            }
        ),
        FilesystemModelAssetStore(tmp_path / "data"),
        SetRelease().fetcher(),
    )
    app.state.model_asset_service = service

    async def capabilities():
        body = (await client.get("/v1/runtime-capabilities")).json()
        return (
            body["offline_speech_enabled"],
            body["offline_speech_asset_version"],
            body["offline_speech_gpu_asset_version"],
        )

    async with local_client(app) as client:
        assert await capabilities() == (False, None, None)
        for asset_id in ("parakeet-stt", "parakeet-stt-webgpu"):
            service.install(asset_id)
            assert (await service.wait(asset_id)).status == "installed"
        assert await capabilities() == (operator_enabled, MANIFEST, GPU_MANIFEST)
        await service.remove("parakeet-stt-webgpu")
        await service.remove("parakeet-stt")
        assert await capabilities() == (False, None, None)


async def test_api_guard_returns_409_before_looking_up_or_queueing_a_file(async_session, tmp_path):
    app = _app(async_session, tmp_path)
    async with local_client(app) as client:
        result = await client.post("/v1/files/does-not-matter:process", json={"force": True})
        assert result.status_code == 409
        assert result.json()["detail"]["code"] == "file_processing_unavailable"


async def test_service_guard_precedes_repository_calls():
    processing, uow = AsyncMock(), AsyncMock()
    service = UserFileProcessingService(processing=processing, uow=uow, processing_enabled=False)
    with pytest.raises(UserFileProcessingConflictError, match="file_processing_unavailable"):
        await service.enqueue_processing_job(user_id="owner", file_id="file", force=True)
    assert processing.mock_calls == []
    assert uow.mock_calls == []


async def test_private_control_is_not_a_browser_api_and_contains_no_paths(async_session, tmp_path):
    app = _app(async_session, tmp_path)
    assert not any(key.startswith("/_desktop") for key in app.openapi()["paths"])
    async with local_client(app) as client:
        url = "/_desktop/feature-packs/parakeet-stt:removal-check"
        for headers in ({}, {"X-Animama-Desktop-Control": "wrong"}, {"X-Animama-Internal-Token": "c" * 64}):
            assert (await client.post(url, headers=headers)).status_code == 404
        result = await client.post(url, headers={"X-Animama-Desktop-Control": "c" * 64})
        assert result.status_code == 200
        assert result.json()["removable"] is True
        assert result.json()["blockers"] == []
        assert str(tmp_path) not in result.text
        app.state.runtime_settings.animama_parakeet_webgpu_asset_version = "0.1.0-bbbbbbbbbbbbbbbb"
        webgpu = await client.post(
            "/_desktop/feature-packs/parakeet-stt-webgpu:removal-check",
            headers={"X-Animama-Desktop-Control": "c" * 64},
        )
        assert webgpu.status_code == 200
        assert webgpu.json()["pack_version"] == "0.1.0-bbbbbbbbbbbbbbbb"
        assert webgpu.json()["removable"] is True
        assert (
            await client.post(
                "/_desktop/feature-packs/unknown:removal-check", headers={"X-Animama-Desktop-Control": "c" * 64}
            )
        ).status_code == 404

        async def denied():
            raise HTTPException(401)

        app.dependency_overrides[get_current_principal] = denied
        assert (await client.get("/v1/runtime-capabilities")).status_code == 401


async def test_old_worker_cannot_clear_replacement_heartbeat(async_session):
    await record_document_heartbeat(async_session, instance_id="new", worker_id="new-worker")
    await clear_document_heartbeat(async_session, instance_id="old")
    row = await async_session.get(ORMRuntimeWorkerHeartbeat, "document-processing")
    assert row.instance_id == "new"
    await clear_document_heartbeat(async_session, instance_id="new")
    async_session.expire_all()
    assert await async_session.get(ORMRuntimeWorkerHeartbeat, "document-processing") is None


async def test_removal_control_blocks_live_jobs_and_preserves_the_queue(async_session, tmp_path):
    file_id = str(uuid4())
    now = datetime.now(UTC)
    async_session.add(
        ORMUserFile(
            id=file_id,
            user_id="installation-owner",
            storage_locator=f"files/{file_id}/original",
            original_filename="Project\nnotes.pdf",
            normalized_extension=".pdf",
            declared_size_bytes=10,
            stored_size_bytes=10,
            status="uploaded",
            upload_expires_at=now + timedelta(minutes=5),
        )
    )
    await async_session.flush()
    for status in ("running", "queued"):
        async_session.add(
            ORMUserFileProcessingJob(
                id=f"{file_id}-{status}",
                file_id=file_id,
                user_id="installation-owner",
                status=status,
                locked_at=now if status == "running" else None,
                locked_by="worker" if status == "running" else None,
            )
        )
    await async_session.commit()
    try:
        app = _app(async_session, tmp_path, enabled=True)
        async with local_client(app) as client:
            url = "/_desktop/feature-packs/document-processing:removal-check"
            headers = {"X-Animama-Desktop-Control": "c" * 64}
            blocked = (await client.post(url, headers=headers)).json()
            assert blocked["removable"] is False
            assert blocked["blockers"] == [
                {"kind": "document_job", "id": f"{file_id}-running", "label": "Projectnotes.pdf"}
            ]
            running = await async_session.get(ORMUserFileProcessingJob, f"{file_id}-running")
            running.status = "succeeded"
            await async_session.commit()
            assert (await client.post(url, headers=headers)).json()["removable"] is True
            assert (await async_session.get(ORMUserFileProcessingJob, f"{file_id}-queued")).status == "queued"
            assert (await async_session.get(ORMUserFile, file_id)).stored_size_bytes == 10
    finally:
        await async_session.execute(delete(ORMUserFile).where(ORMUserFile.id == file_id))
        await async_session.commit()
