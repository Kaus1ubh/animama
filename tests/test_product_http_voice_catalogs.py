"""Shared voice-catalog uploads isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.domain.request_principal import RequestPrincipal
from animama.orm.avatar_upload import ORMAvatarUpload
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.product_http.routes import voice_catalogs
from animama.server.config import Settings
from animama.server.deps import get_current_principal
from animama.server.local_runtime import initialize_local_runtime
from tests.local_http_client import local_client
from tests.product_http_support import DeferredCommitPorts, TwoOwnerComposition, install_local_ports, product_app
from tests.test_anima_voice_catalog_api import _voice_catalog

UPLOADS = "/v1/animas/voice-catalogs/uploads"


async def _stage(client: AsyncClient, payload: bytes, filename: str = "Wren.bin") -> str:
    initialized = await client.post(UPLOADS, json={"filename": filename, "size_bytes": len(payload)})
    assert initialized.status_code == 200, initialized.text
    return str(initialized.json()["upload_id"])


async def test_owners_reach_only_their_own_uploads(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory, content_root=tmp_path / "owners")
    composition = TwoOwnerComposition(product_app(voice_catalogs.router, ports=ports), tmp_path)
    owner_a, owner_b = composition.owners
    payload = _voice_catalog()
    try:
        async with composition.client(owner_a) as a:
            upload_id = await _stage(a, payload)
            assert (await a.put(f"{UPLOADS}/{upload_id}/content", content=payload)).status_code == 204
        commits = ports.commits

        async with composition.client(owner_b) as b:
            # Owner a's upload is not owner b's to fill, publish or discard.
            assert (await b.put(f"{UPLOADS}/{upload_id}/content", content=payload)).status_code == 404
            assert (await b.post(f"{UPLOADS}/{upload_id}:finalize")).status_code == 404
            assert (await b.delete(f"{UPLOADS}/{upload_id}")).status_code == 404
        assert ports.commits == commits

        async with composition.client(owner_a) as a:
            finalized = await a.post(f"{UPLOADS}/{upload_id}:finalize")
            assert finalized.status_code == 200, finalized.text
            # A retried finalize returns the saved file; a finalized upload cannot be aborted.
            retried = (await a.post(f"{UPLOADS}/{upload_id}:finalize")).json()
            assert retried["item"]["item_id"] == finalized.json()["item"]["item_id"]
            assert (await a.delete(f"{UPLOADS}/{upload_id}")).status_code == 409
            discarded = await _stage(a, payload)
            assert (await a.delete(f"{UPLOADS}/{discarded}")).status_code == 204
            assert (await a.delete(f"{UPLOADS}/{discarded}")).status_code == 204

        item = finalized.json()["item"]
        assert (item["kind"], item["relative_locator"], item["status"]) == ("voice", "voices/wren.bin", "valid")
        # The file is in owner a's content tree only, and its staged bytes are gone.
        assert (tmp_path / "owners" / owner_a / "content/local/voices/wren.bin").read_bytes() == payload
        assert not (tmp_path / "owners" / owner_b / "content/local/voices/wren.bin").exists()
        assert not list((tmp_path / "owners" / owner_a / "data").glob("staging/uploads/**/*.bin"))
        # Finalize, its retry (which rescans), the second initiate and its first abort
        # committed through the composition; owner b's refusals and the repeated abort
        # committed nothing.
        assert ports.commits == commits + 4
    finally:
        async with async_session_factory() as session:
            await session.execute(delete(ORMAvatarUpload).where(ORMAvatarUpload.user_id.in_(composition.owners)))
            await session.execute(
                delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id.in_(composition.owners))
            )
            await session.commit()


async def test_upload_requests_use_the_runtime_layout_startup_prepared(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    runtime_settings = Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    app = FastAPI()
    app.include_router(voice_catalogs.router)
    app.state.runtime_settings = runtime_settings
    paths = app.state.local_runtime_paths = initialize_local_runtime(runtime_settings)
    install_local_ports(app, async_session)

    async def owner() -> RequestPrincipal:
        return RequestPrincipal(id="voice-layout-owner")

    app.dependency_overrides[get_current_principal] = owner
    # A request that rebuilt the runtime layout would recreate this root.
    shutil.rmtree(paths.derivatives_root)
    payload = _voice_catalog()
    try:
        async with local_client(app) as client:
            upload_id = await _stage(client, payload)
            assert (await client.put(f"{UPLOADS}/{upload_id}/content", content=payload)).status_code == 204
            assert (await client.post(f"{UPLOADS}/{upload_id}:finalize")).status_code == 200
            assert (await client.delete(f"{UPLOADS}/{await _stage(client, payload)}")).status_code == 204
        assert not paths.derivatives_root.exists()
    finally:
        await async_session.execute(delete(ORMAvatarUpload).where(ORMAvatarUpload.user_id == "voice-layout-owner"))
        await async_session.execute(
            delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == "voice-layout-owner")
        )
        await async_session.commit()
