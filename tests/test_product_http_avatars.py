"""Shared Avatar routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.orm.avatar import ORMAvatar
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.product_http.routes import avatars
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app


def catalog_avatar(item_id: str, owner: str) -> ORMContentCatalogItem:
    """A valid Local Avatar item owned by ``owner``."""

    return ORMContentCatalogItem(
        id=item_id,
        source="local",
        scope="owner",
        owner_user_id=owner,
        kind="avatar",
        relative_locator=f"avatars/{item_id}.vrm",
        display_name=item_id,
        status="valid",
        revision_sha256="a" * 64,
    )


async def test_an_owner_never_reaches_another_owners_avatars(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    suffix = uuid4().hex[:8]
    owner_a, owner_b = f"owner-a-{suffix}", f"owner-b-{suffix}"
    ports = DeferredCommitPorts(async_session_factory)
    composition = TwoOwnerComposition(product_app(avatars.router, ports=ports), tmp_path, owners=(owner_a, owner_b))
    item_id, other_item_id = f"avatar-item-a-{suffix}", f"avatar-item-b-{suffix}"
    async with async_session_factory() as session:
        session.add_all([catalog_avatar(item_id, owner_a), catalog_avatar(other_item_id, owner_b)])
        await session.commit()
    try:
        async with composition.client(owner_a) as a:
            registered = await a.post("/v1/avatars", json={"catalog_item_id": item_id, "name": f"Mine {suffix}"})
            assert registered.status_code == 201, registered.text
        avatar_id = registered.json()["id"]
        # The registration committed once, through the composition.
        assert ports.commits == ports.commits_requested == 1

        async with composition.client(owner_b) as b:
            listed = (await b.get("/v1/avatars", params={"include_private": True})).json()
            assert avatar_id not in {avatar["id"] for avatar in listed}
            catalog = (await b.get("/v1/avatar-catalog", params={"q": suffix})).json()
            assert avatar_id not in {item["avatar_id"] for item in catalog["items"]}
            for response in (
                await b.get(f"/v1/avatars/{avatar_id}"),
                await b.patch(f"/v1/avatars/{avatar_id}", json={"name": "Taken"}),
                await b.delete(f"/v1/avatars/{avatar_id}"),
            ):
                assert (response.status_code, response.json()) == (404, {"detail": {"code": "avatar_not_found"}})
            # Another owner's catalog item cannot become this owner's Avatar.
            foreign = await b.post("/v1/avatars", json={"catalog_item_id": item_id, "name": "Taken"})
            assert (foreign.status_code, foreign.json()) == (404, {"detail": {"code": "avatar_content_not_found"}})
            # A name is unique per owner, so owner b may reuse owner a's.
            own = await b.post("/v1/avatars", json={"catalog_item_id": other_item_id, "name": f"Mine {suffix}"})
            assert own.status_code == 201, own.text
        assert ports.commits == ports.commits_requested == 2

        async with composition.client(owner_a) as a:
            assert (await a.get(f"/v1/avatars/{avatar_id}")).json()["name"] == f"Mine {suffix}"
            assert avatar_id in {
                item["avatar_id"] for item in (await a.get("/v1/avatar-catalog", params={"q": suffix})).json()["items"]
            }
            renamed = await a.patch(f"/v1/avatars/{avatar_id}", json={"name": f"Renamed {suffix}"})
            assert renamed.json()["name"] == f"Renamed {suffix}"
            assert (await a.delete(f"/v1/avatars/{avatar_id}")).status_code == 204
        assert ports.commits == ports.commits_requested == 4
    finally:
        async with async_session_factory() as session:
            await session.execute(delete(ORMAvatar).where(ORMAvatar.catalog_item_id.in_([item_id, other_item_id])))
            await session.execute(
                delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([item_id, other_item_id]))
            )
            await session.commit()
