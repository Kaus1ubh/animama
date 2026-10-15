"""Shared Anima runtime routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.domain.request_principal import RequestPrincipal
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMAnimaContentBinding, ORMContentCatalogItem
from animama.product_http.routes import anima_runtime
from tests.content_package_helpers import vrma
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, product_app


async def mounted_anima(ports: DeferredCommitPorts, root: Path, owner: str) -> str:
    """An Anima of ``owner`` whose loadout binds one scanned Local Gesture."""

    clip = root / owner / "content" / "local" / "gestures" / "wave.vrma"
    clip.parent.mkdir(parents=True, exist_ok=True)
    clip.write_bytes(vrma("runtime"))
    anima_id = f"runtime-anima-{uuid4().hex}"
    async with ports.session_factory() as session:
        async with ports.content(session, RequestPrincipal(id=owner)) as owned:
            scanned = await owned.catalog.rescan(user_id=owner, include_included=False)
        gesture = next(item for item in scanned.items if item.relative_locator.endswith("wave.vrma"))
        session.add(ORMAnima(id=anima_id, user_id=owner))
        await session.flush()
        session.add(
            ORMAnimaLoadout(
                anima_id=anima_id,
                owner_user_id=owner,
                revision=1,
                starter_catalog_version=1,
                starter_exclusions=[],
            )
        )
        await session.flush()
        session.add(
            ORMAnimaContentBinding(
                id=str(uuid4()),
                anima_id=anima_id,
                slot_key="gesture:wave",
                catalog_item_id=gesture.id,
                kind="gesture",
                config={},
            )
        )
        await session.commit()
    return anima_id


async def test_an_owner_never_reaches_another_owners_runtime(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory, content_root=tmp_path)
    owner_a, owner_b = f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"
    composition = TwoOwnerComposition(
        product_app(anima_runtime.router, ports=ports), tmp_path, owners=(owner_a, owner_b)
    )
    anima_id = await mounted_anima(ports, tmp_path, owner_a)
    base = f"/v1/animas/{anima_id}/runtime"
    try:
        async with composition.client(owner_a) as a:
            issued = await a.get(base)
            assert issued.status_code == 200, issued.text
            revision = issued.json()["effective_revision"]
            member = issued.json()["content_descriptor"]["members"][0]["file_ref"]
            assert (await a.post(f"{base}/revisions/{revision}:renew")).status_code == 200
            assert (await a.get(f"{base}/revisions/{revision}/files/{member}")).content == vrma("runtime")
        # Issuing and renewing committed through the composition.
        commits_before = ports.commits
        assert commits_before >= 2

        async with composition.client(owner_b) as b:
            for response in (
                await b.get(base),
                await b.get(f"{base}/revisions/{revision}/json-bundle"),
                await b.get(f"{base}/revisions/{revision}/files/{member}"),
            ):
                assert response.status_code == 404, response.text
            # Renewal answers any revision the caller cannot renew the same way.
            renewal = await b.post(f"{base}/revisions/{revision}:renew")
            assert (renewal.status_code, renewal.json()) == (409, {"detail": {"code": "runtime_remount_required"}})
        assert ports.commits == commits_before
    finally:
        async with async_session_factory() as session:
            await session.execute(delete(ORMAnima).where(ORMAnima.id == anima_id))
            await session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == owner_a))
            await session.commit()
