"""Shared package routes isolate owners' exports and import stages (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.orm.content_catalog import ORMContentCatalogItem
from animama.product_http.routes import packages
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app
from tests.test_product_http_content import save_gesture

EXPORTS = "/v1/content/package-exports"
IMPORTS = "/v1/content/package-imports"


async def test_an_owner_never_reaches_another_owners_exports_or_import_stages(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory, content_root=tmp_path)
    owner_a, owner_b = f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"
    composition = TwoOwnerComposition(product_app(packages.router, ports=ports), tmp_path, owners=(owner_a, owner_b))
    try:
        item = (await save_gesture(ports, owner_a, "Wave A")).item
        async with composition.client(owner_a) as a:
            summary = (await a.post(f"{EXPORTS}:summary", json={"item_ids": [item.id]})).json()
            review = await a.post(EXPORTS, json={"item_ids": [item.id], "expected_digest": summary["digest"]})
            assert review.status_code == 200, review.text
            export_id = review.json()["export_id"]
            archive = (await a.get(f"{EXPORTS}/{export_id}/file")).content
            allocated = await a.post(
                IMPORTS, json={"operation_id": "import-a", "filename": "wave.zip", "expected_size_bytes": len(archive)}
            )
            assert allocated.status_code == 201, allocated.text
            stage = f"{IMPORTS}/{allocated.json()['stage_id']}"
        commits_before = ports.commits

        async with composition.client(owner_b) as b:
            # Another owner's item is refused like any item the caller cannot select.
            foreign = await b.post(f"{EXPORTS}:summary", json={"item_ids": [item.id]})
            assert (foreign.status_code, foreign.json()) == (409, {"detail": {"code": "package_root_invalid"}})
            assert (await b.get(f"{EXPORTS}/{export_id}/file")).status_code == 404
            assert (await b.get(stage)).status_code == 404
            assert (await b.put(f"{stage}/parts/0", content=archive)).status_code == 404
            assert (await b.post(f"{stage}/review")).status_code == 404
            unknown = await b.get("/v1/content/package-operations/import-a")
            assert unknown.json()["state"] == "not_found"
            # Discards address only the caller's own stages.
            assert (await b.delete(f"{EXPORTS}/{export_id}")).status_code == 404
            assert (await b.delete(stage)).status_code == 404
        assert ports.commits == commits_before

        async with composition.client(owner_a) as a:
            assert (await a.get(f"{EXPORTS}/{export_id}/file")).content == archive
            assert (await a.put(f"{stage}/parts/0", content=archive)).status_code == 200
            reviewed = await a.post(f"{stage}/review")
            assert reviewed.status_code == 200, reviewed.text
            committed = await a.post(
                f"{stage}/commit", json={"operation_id": "import-a", "review_digest": reviewed.json()["review_digest"]}
            )
            assert committed.status_code == 200, committed.text
            status = (await a.get("/v1/content/package-operations/import-a")).json()
            assert status["state"] == "completed"
        # Owner a's import committed through the composition.
        assert ports.commits > commits_before
    finally:
        async with async_session_factory() as session:
            await session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == owner_a))
            await session.commit()
