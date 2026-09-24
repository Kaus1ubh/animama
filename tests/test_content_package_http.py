"""The same-origin package API reviews exact bytes before one installation."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.request_principal import RequestPrincipal
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers import router
from tests.content_package_helpers import package_services, save_wave


async def test_http_export_reviews_then_streams_the_same_package(async_session: AsyncSession, tmp_path: Path) -> None:
    paths, catalog, content, saves, _packages = package_services(async_session, tmp_path)
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
            assert not list(paths.exports_staging_root.rglob("*.animama"))
            prepared = await client.post(
                "/v1/content/package-exports",
                json={"item_ids": [saved.item.id], "expected_digest": summary.json()["digest"]},
            )
            assert prepared.status_code == 200, prepared.text
            reviewed = prepared.json()
            downloaded = await client.get(f"/v1/content/package-exports/{reviewed['export_id']}/file")
            assert downloaded.status_code == 200, downloaded.text
            assert len(downloaded.content) == reviewed["size_bytes"]
            assert downloaded.headers["x-content-sha256"] == reviewed["package_sha256"]
            assert hashlib.sha256(downloaded.content).hexdigest() == reviewed["package_sha256"]
            assert downloaded.headers["cache-control"] == "private, no-store"
            assert "attachment;" in downloaded.headers["content-disposition"]
            record, active = _packages.stages.status("package-owner", reviewed["export_id"], "export")
            assert record.state == "completed" and not active
            retry = await client.get(f"/v1/content/package-exports/{reviewed['export_id']}/file")
            assert retry.content == downloaded.content
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
                    "filename": "wave.animama",
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
                json={"filename": "another.animama", "expected_size_bytes": 1, "operation_id": "third-stage"},
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
        await async_session.commit()
