"""Actual >128 MiB private staging through the bounded raw-part HTTP API."""

import hashlib
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.services.content_package_staging import PackageStageService
from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers import router
from tests.content_package_helpers import package_services
from tests.product_http_support import install_local_ports


async def test_real_file_larger_than_128_mib_uploads_as_bounded_http_parts(
    async_session: AsyncSession, tmp_path: Path
) -> None:
    paths, *_ = package_services(async_session, tmp_path)
    app = FastAPI()
    app.state.local_runtime_paths = paths
    app.include_router(router)

    async def session() -> AsyncIterator[AsyncSession]:
        yield async_session

    app.dependency_overrides[get_async_session] = session
    app.dependency_overrides[get_current_principal] = lambda: RequestPrincipal("package-owner")
    install_local_ports(app, async_session)
    stages = PackageStageService(paths.imports_staging_root, paths.exports_staging_root)
    part = b"z" * stages.limits.part_bytes
    size = 17 * len(part)
    expected = hashlib.sha256()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/v1/content/package-imports",
                json={"operation_id": "large-http", "filename": "large.zip", "expected_size_bytes": size},
            )
            assert response.status_code == 201, response.text
            stage_id = response.json()["stage_id"]
            for index in range(17):
                expected.update(part)
                ack = await client.put(
                    f"/v1/content/package-imports/{stage_id}/parts/{index}",
                    content=part,
                    headers={"Content-Type": "application/octet-stream"},
                )
                assert ack.status_code == 200, ack.text
                assert ack.json()["received_bytes"] == (index + 1) * len(part)
            assert ack.json()["complete"]
            status = await client.get(f"/v1/content/package-imports/{stage_id}")
            assert status.json()["received_bytes"] == size
            assert status.json()["state"] == "uploaded"
            with stages.acquire("package-owner", stage_id) as lease:
                assert lease.archive_path.stat().st_size == size > 128 * 1024**2
                assert lease.seal_archive() == (size, expected.hexdigest())
            discarded = await client.delete(f"/v1/content/package-imports/{stage_id}")
            assert discarded.status_code == 204
            assert not list(paths.imports_staging_root.rglob("package.zip"))
    finally:
        await async_session.rollback()
