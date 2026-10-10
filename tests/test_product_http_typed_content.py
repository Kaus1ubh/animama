"""Shared typed content routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.orm.content_catalog import ORMContentCatalogItem
from animama.product_http.routes import typed_content
from tests.content_package_helpers import vrma
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app


def evidence(item: dict[str, str]) -> dict[str, object]:
    root = {"kind": "gesture", "source": {"item_id": item["item_id"], "revision_sha256": item["revision_sha256"]}}
    return {"schema_version": 1, "roots": [root]}


def previews(item: dict[str, str]) -> dict[str, object]:
    root = {"kind": "gesture", "source": {"type": "catalog", "catalog_item_id": item["item_id"]}}
    return {"schema_version": 1, "roots": [root]}


async def test_an_owner_never_reaches_another_owners_typed_content(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory, content_root=tmp_path)
    owner_a, owner_b = f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"
    app = product_app(typed_content.router, ports=ports)
    composition = TwoOwnerComposition(app, tmp_path, owners=(owner_a, owner_b))
    try:
        async with composition.client(owner_a) as a:
            saved = await a.put(
                "/v1/gestures/Wave",
                data={"operation_id": "save-wave"},
                files={"files": ("wave.vrma", vrma("Wave A"), "model/gltf-binary")},
            )
            assert saved.status_code == 200, saved.text
        item = saved.json()
        item_id = item["item_id"]
        # The save committed once, through the composition.
        assert ports.commits == 1
        commits_before = ports.commits

        async with composition.client(owner_b) as b:
            assert item_id not in {gesture["item_id"] for gesture in (await b.get("/v1/gestures")).json()["items"]}
            for path in (f"/v1/gestures/{item_id}", f"/v1/gestures/{item_id}/idle-playback"):
                missing = await b.get(path)
                assert (missing.status_code, missing.json()) == (404, {"detail": {"code": "content_not_found"}}), path
            assert (await b.post(f"/v1/gestures/{item_id}:preview")).status_code == 404
            unresolved = (await b.post("/v1/content/evidence:resolve", json=evidence(item))).json()
            assert (unresolved["complete"], unresolved["roots"]) == (False, [])
            prepared = (await b.post("/v1/content/previews:prepare", json=previews(item))).json()
            assert (prepared["roots"], prepared["lease"]) == ([], None)
            assert (await b.get(f"/v1/avatar-content/{item_id}/face-parts")).status_code == 404
        assert ports.commits == commits_before

        async with composition.client(owner_a) as a:
            assert item_id in {gesture["item_id"] for gesture in (await a.get("/v1/gestures")).json()["items"]}
            assert (await a.get(f"/v1/gestures/{item_id}")).json()["item_id"] == item_id
            # Evidence is a read: it runs on a read session, which refuses writes.
            assert (await a.post("/v1/content/evidence:resolve", json=evidence(item))).json()["complete"] is True
            assert (await a.post(f"/v1/gestures/{item_id}:preview")).status_code == 200
            assert (await a.post("/v1/content/previews:prepare", json=previews(item))).json()["lease"] is not None
        # Each issued preview committed through the composition.
        assert ports.commits == commits_before + 2
    finally:
        async with async_session_factory() as session:
            await session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == owner_a))
            await session.commit()
