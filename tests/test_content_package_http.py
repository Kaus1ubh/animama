"""The same-origin package API reviews exact bytes before one installation."""

from __future__ import annotations

import hashlib
import re
from collections.abc import AsyncIterator
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
from zipfile import ZipFile

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.request_principal import RequestPrincipal
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.orm.user_profile import ORMUserProfile
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers import router
from tests.content_package_helpers import package_services, save_wave


async def test_http_export_reviews_then_streams_the_same_package(async_session: AsyncSession, tmp_path: Path) -> None:
    paths, catalog, content, saves, _packages = package_services(async_session, tmp_path)
    async_session.add_all(
        [
            ORMUserProfile(user_id="package-owner", display_name="Élodie / Ray"),
            ORMUserProfile(user_id="another-owner", display_name="Another owner"),
        ]
    )
    saved = await save_wave(saves)
    app = FastAPI()
    app.state.local_runtime_paths = paths
    app.include_router(router)

    async def session() -> AsyncIterator[AsyncSession]:
        yield async_session

    app.dependency_overrides[get_async_session] = session
    app.dependency_overrides[get_current_principal] = lambda: RequestPrincipal("package-owner")
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            summary = await client.post("/v1/content/package-exports:summary", json={"item_ids": [saved.item.id]})
            assert summary.status_code == 200, summary.text
            assert summary.json()["selected_count"] == 1
            assert summary.json()["required_count"] == 0
            assert not list(paths.exports_staging_root.rglob("*.zip"))
            prepared = await client.post(
                "/v1/content/package-exports",
                json={"item_ids": [saved.item.id], "expected_digest": summary.json()["digest"]},
            )
            assert prepared.status_code == 200, prepared.text
            reviewed = prepared.json()
            assert re.fullmatch(r"Élodie - Ray-\d{8}-\d{6}Z\.zip", reviewed["filename"])
            downloaded = await client.get(f"/v1/content/package-exports/{reviewed['export_id']}/file")
            assert downloaded.status_code == 200, downloaded.text
            assert downloaded.headers["content-type"] == "application/zip"
            assert len(downloaded.content) == reviewed["size_bytes"]
            assert downloaded.headers["x-content-sha256"] == reviewed["package_sha256"]
            assert hashlib.sha256(downloaded.content).hexdigest() == reviewed["package_sha256"]
            assert downloaded.headers["cache-control"] == "private, no-store"
            assert downloaded.headers["content-disposition"] == (
                f"attachment; filename*=utf-8''{quote(reviewed['filename'], safe='')}"
            )
            with ZipFile(BytesIO(downloaded.content)) as archive:
                assert all("Élodie".encode() not in archive.read(name) for name in archive.namelist())
            record, active = _packages.stages.status("package-owner", reviewed["export_id"], "export")
            assert record.state == "completed" and not active
            await async_session.execute(
                update(ORMUserProfile)
                .where(ORMUserProfile.user_id == "package-owner")
                .values(display_name="Later name")
            )
            await async_session.commit()
            retry = await client.get(f"/v1/content/package-exports/{reviewed['export_id']}/file")
            assert retry.content == downloaded.content
            assert retry.headers["content-disposition"] == downloaded.headers["content-disposition"]
            # A finished response remains retryable, but cannot block later normal
            # exports forever. A second, never-downloaded review stays protected.
            second = await client.post(
                "/v1/content/package-exports",
                json={"item_ids": [saved.item.id], "expected_digest": summary.json()["digest"]},
            )
            assert second.status_code == 200, second.text
            third = await client.post(
                "/v1/content/package-exports",
                json={"item_ids": [saved.item.id], "expected_digest": summary.json()["digest"]},
            )
            assert third.status_code == 200, third.text
            removed = await client.delete(f"/v1/content/package-exports/{third.json()['export_id']}")
            assert removed.status_code == 204
            assert "/v1/content/packages:import" not in app.openapi()["paths"]
            assert "/v1/content/items/{item_id}:export" not in app.openapi()["paths"]
            allocated = await client.post(
                "/v1/content/package-imports",
                json={
                    "filename": "wave.zip",
                    "expected_size_bytes": len(downloaded.content),
                    "operation_id": "http-import",
                },
            )
            assert allocated.status_code == 201, allocated.text
            stage_id = allocated.json()["stage_id"]
            base = f"/v1/content/package-imports/{stage_id}"
            assert allocated.json()["received_bytes"] == 0
            app.dependency_overrides[get_current_principal] = lambda: RequestPrincipal("another-owner")
            hidden = await client.get(base)
            assert hidden.status_code == 404
            app.dependency_overrides[get_current_principal] = lambda: RequestPrincipal("package-owner")
            excessive = await client.put(
                f"{base}/parts/0", content=b"", headers={"content-length": str(8 * 1024 * 1024 + 1)}
            )
            assert excessive.status_code == 413
            pending = await client.get("/v1/content/package-operations/http-import")
            assert pending.json()["state"] == "pending"
            over_quota = await client.post(
                "/v1/content/package-imports",
                json={"filename": "another.zip", "expected_size_bytes": 1, "operation_id": "third-stage"},
            )
            assert over_quota.status_code == 409
            ahead = await client.put(f"{base}/parts/1", content=downloaded.content)
            assert ahead.status_code == 409
            uploaded = await client.put(f"{base}/parts/0", content=downloaded.content)
            assert uploaded.status_code == 200, uploaded.text
            assert uploaded.json()["complete"] is True
            duplicate = await client.put(f"{base}/parts/0", content=downloaded.content)
            assert duplicate.json() == uploaded.json()
            changed_part = await client.put(f"{base}/parts/0", content=b"wrong")
            assert changed_part.status_code == 409
            inspected = await client.post(f"{base}/review")
            assert inspected.status_code == 200, inspected.text
            proposal = inspected.json()
            assert proposal["items"][0]["name"] == "Friendly Wave-2"
            assert len(await catalog.list_visible(user_id="package-owner")) == 1
            progress = await client.get(base)
            assert progress.json()["review"] is not None
            assert "plan" not in progress.text and "relative_locator" not in progress.text
            assert "logical_key" not in inspected.text
            body = {"operation_id": "http-import", "review_digest": proposal["review_digest"]}
            installed = await client.post(f"{base}/commit", json=body)
            assert installed.status_code == 200, installed.text
            result = installed.json()
            assert result["anima_id"] is None
            assert result["items"][0]["item_id"] != saved.item.id
            item = await catalog.get_visible_item(item_id=result["items"][0]["item_id"], user_id="package-owner")
            assert item is not None and item.revision_sha256 is not None
            await content.delete_item(user_id="package-owner", item_id=item.id, expected_revision=item.revision_sha256)
            removed = await client.delete(base)
            assert removed.status_code == 204
            replay = await client.post(f"{base}/commit", json=body)
            assert replay.status_code == 200 and replay.json() == result
            status = await client.get("/v1/content/package-operations/http-import")
            assert status.json()["state"] == "completed" and status.json()["result"] == result
            mismatch = await client.post(f"{base}/commit", json={**body, "review_digest": "0" * 64})
            assert mismatch.status_code == 409
            bad = await client.post(
                "/v1/content/package-imports", json={"filename": "PRIVATE-TEXT", "expected_size_bytes": -1}
            )
            assert bad.status_code == 422 and "PRIVATE-TEXT" not in bad.text
            discarded = await client.delete(f"/v1/content/package-exports/{second.json()['export_id']}")
            assert discarded.status_code == 204
            assert len(await catalog.list_visible(user_id="package-owner")) == 1
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.execute(
            delete(ORMUserProfile).where(ORMUserProfile.user_id.in_(("package-owner", "another-owner")))
        )
        await async_session.commit()


@pytest.mark.parametrize("valid_zip", [False, True], ids=["malformed-zip", "unrelated-zip"])
async def test_http_rejects_non_package_zip_before_library_admission(
    async_session: AsyncSession, tmp_path: Path, valid_zip: bool
) -> None:
    paths, catalog, _content, _saves, _packages = package_services(async_session, tmp_path)
    payload = b"This is not a ZIP archive."
    if valid_zip:
        output = BytesIO()
        with ZipFile(output, "w") as archive:
            archive.writestr("readme.txt", "A regular ZIP file is not an Animama content package.")
        payload = output.getvalue()
    app = FastAPI()
    app.state.local_runtime_paths = paths
    app.include_router(router)

    async def session() -> AsyncIterator[AsyncSession]:
        yield async_session

    app.dependency_overrides[get_async_session] = session
    app.dependency_overrides[get_current_principal] = lambda: RequestPrincipal("package-owner")
    before = sorted(path.relative_to(paths.local_root) for path in paths.local_root.rglob("*"))
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            allocated = await client.post(
                "/v1/content/package-imports",
                json={"filename": "unrelated.zip", "expected_size_bytes": len(payload), "operation_id": "not-package"},
            )
            assert allocated.status_code == 201, allocated.text
            base = f"/v1/content/package-imports/{allocated.json()['stage_id']}"
            uploaded = await client.put(f"{base}/parts/0", content=payload)
            assert uploaded.status_code == 200, uploaded.text
            reviewed = await client.post(f"{base}/review")
            assert reviewed.status_code == 409, reviewed.text
            assert reviewed.json()["detail"]["code"] == (
                "package_manifest_size_invalid" if valid_zip else "package_zip_directory_invalid"
            )
            assert not await catalog.list_visible(user_id="package-owner")
            assert sorted(path.relative_to(paths.local_root) for path in paths.local_root.rglob("*")) == before
            assert await catalog.get_mutation_receipt(user_id="package-owner", operation_id="not-package") is None
    finally:
        await async_session.rollback()
