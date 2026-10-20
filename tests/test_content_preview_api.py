from __future__ import annotations

import json
import struct
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI
from sqlalchemy import delete

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentKind,
    ContentPreview,
    ContentPreviewFile,
    ContentScope,
    ContentSource,
    ContentStatus,
)
from animama.domain.request_principal import RequestPrincipal
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.avatar import ORMAvatar
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.product_http.routes.content import router
from animama.product_http.routes.loadouts import router as anima_loadout_router
from animama.product_http.routes.typed_content import router as typed_content_router
from animama.server.config import Settings
from animama.server.deps import get_current_principal
from animama.server.local_runtime import initialize_local_runtime
from animama.server.schemas.content import PyContentPreview
from tests.local_http_client import local_client
from tests.product_http_support import install_local_ports


def _glb(label: str) -> bytes:
    document = json.dumps(
        {
            "asset": {"version": "2.0"},
            "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
            "extras": {"label": label},
        },
        separators=(",", ":"),
    ).encode()
    document += b" " * (-len(document) % 4)
    return (
        struct.pack("<4sII", b"glTF", 2, 20 + len(document)) + struct.pack("<II", len(document), 0x4E4F534A) + document
    )


def test_preview_projects_descriptor_relative_logical_resources() -> None:
    item_id = "particle-item"
    files = (
        CatalogContentFile(
            file_ref="descriptor-ref",
            item_id=item_id,
            source=ContentSource.INCLUDED,
            relative_path="vfx/particle/quark/spark/spark.json",
            role="descriptor",
            media_type="application/json",
            size_bytes=10,
            sha256="a" * 64,
        ),
        CatalogContentFile(
            file_ref="manifest-ref",
            item_id=item_id,
            source=ContentSource.INCLUDED,
            relative_path="vfx/particle/quark/spark/particle.json",
            role="manifest",
            media_type="application/json",
            size_bytes=20,
            sha256="b" * 64,
        ),
        CatalogContentFile(
            file_ref="texture-ref",
            item_id=item_id,
            source=ContentSource.INCLUDED,
            relative_path="vfx/particle/quark/spark/textures/spark.png",
            role="texture",
            media_type="image/png",
            size_bytes=30,
            sha256="c" * 64,
        ),
    )
    item = CatalogContentEntry(
        id=item_id,
        source=ContentSource.INCLUDED,
        scope=ContentScope.INCLUDED,
        owner_user_id=None,
        kind=ContentKind.PARTICLE_EFFECT,
        relative_locator="vfx/particle/quark/spark",
        display_name="Spark",
        status=ContentStatus.VALID,
        revision_sha256="d" * 64,
        files=files,
        metadata={"content_type": "particle_effect"},
    )
    preview = ContentPreview(
        id="preview-particle",
        owner_user_id="owner",
        item_id=item_id,
        revision_sha256="d" * 64,
        files=tuple(
            ContentPreviewFile(
                file_ref=file.file_ref,
                source=file.source,
                relative_path=file.relative_path,
                role=file.role,
                media_type=file.media_type,
                size_bytes=file.size_bytes,
                sha256=file.sha256,
            )
            for file in files
        ),
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )

    response = PyContentPreview.from_domain(preview, item)

    assert response.metadata["logical_resource_files"] == {"textures/spark.png": {"role": "texture", "ordinal": 3}}


async def test_preview_freezes_exact_owner_scoped_file_facts(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths = initialize_local_runtime(
        Settings(
            animama_content_root=tmp_path / "content",
            animama_data_root=tmp_path / "data",
        )
    )
    wave = paths.local_root / "gestures/wave.vrma"
    wave.write_bytes(_glb("first"))
    service = ContentCatalogService(
        store=FilesystemContentStore(
            included_root=paths.included_root,
            local_root=paths.local_root,
            operations_root=paths.operations_root,
        ),
        catalog=SQLAlchemyContentCatalog(async_session),
    )
    result = await service.rescan(user_id="owner-a", include_included=False)
    item = next(entry for entry in result.items if entry.relative_locator == "gestures/wave.vrma")

    app = FastAPI()
    app.include_router(router)
    app.include_router(typed_content_router)
    app.state.local_runtime_paths = paths
    current_user = {"id": "owner-a"}

    async def override_user() -> RequestPrincipal:
        return RequestPrincipal(id=current_user["id"])

    app.dependency_overrides[get_current_principal] = override_user
    install_local_ports(app, async_session)
    client = local_client(app)
    try:
        response = await client.post(f"/v1/gestures/{item.id}:preview")
        assert response.status_code == 200
        preview = response.json()
        assert preview["revision_sha256"] == item.revision_sha256
        assert len(preview["files"]) == 1

        exact = await client.get(preview["files"][0]["url"])
        assert exact.status_code == 200
        assert exact.content == _glb("first")

        current_user["id"] = "owner-b"
        hidden = await client.get(preview["files"][0]["url"])
        assert hidden.status_code == 404

        current_user["id"] = "owner-a"
        wave.write_bytes(_glb("second"))
        changed = await client.get(preview["files"][0]["url"])
        assert changed.status_code == 409
        assert changed.json()["detail"]["code"] == "content_preview_changed"
    finally:
        await client.aclose()
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id == item.id))
        await async_session.commit()


async def test_equip_selects_a_logical_catalog_item_for_the_next_loadout_revision(
    async_session, tmp_path: Path
) -> None:  # noqa: ANN001
    paths = initialize_local_runtime(
        Settings(
            animama_content_root=tmp_path / "content",
            animama_data_root=tmp_path / "data",
        )
    )
    (paths.local_root / "gestures/wave.vrma").write_bytes(_glb("equip"))
    service = ContentCatalogService(
        store=FilesystemContentStore(
            included_root=paths.included_root,
            local_root=paths.local_root,
            operations_root=paths.operations_root,
        ),
        catalog=SQLAlchemyContentCatalog(async_session),
    )
    result = await service.rescan(user_id="owner-equip", include_included=False)
    item = next(entry for entry in result.items if entry.relative_locator == "gestures/wave.vrma")

    suffix = uuid4().hex
    avatar_id = f"avatar-{suffix}"
    anima_id = f"anima-{suffix}"
    async_session.add(
        ORMAvatar(
            id=avatar_id,
            name=f"Equip Avatar {suffix}",
            file_path="/vrm/Andrew.vrm",
            identity="Equip test",
        )
    )
    await async_session.flush()
    async_session.add(
        ORMAnima(
            id=anima_id,
            user_id="owner-equip",
            avatar_id=avatar_id,
        )
    )
    await async_session.flush()
    async_session.add(
        ORMAnimaLoadout(
            anima_id=anima_id,
            owner_user_id="owner-equip",
            revision=1,
            starter_catalog_version=1,
            starter_exclusions=[],
        )
    )
    await async_session.commit()

    app = FastAPI()
    app.include_router(router)
    app.include_router(anima_loadout_router)
    app.state.local_runtime_paths = paths

    async def override_user() -> RequestPrincipal:
        return RequestPrincipal(id="owner-equip")

    app.dependency_overrides[get_current_principal] = override_user
    install_local_ports(app, async_session)
    client = local_client(app)
    try:
        before = await client.get(f"/v1/animas/{anima_id}/loadout")
        assert before.status_code == 200
        assert before.json()["revision"] == 1

        intent = {
            "operation": "add",
            "source": {
                "type": "catalog",
                "catalog_item_id": item.id,
                "source": "local",
                "logical_key": item.logical_key,
            },
            "config_overrides": {},
        }
        planned = await client.post(
            f"/v1/animas/{anima_id}/gestures:plan",
            json={"expected_revision": 1, "intent": intent},
        )
        assert planned.status_code == 200, planned.text
        equipped = await client.post(
            f"/v1/animas/{anima_id}/gestures:commit",
            json={
                "expected_revision": 1,
                "intent": intent,
                "plan_digest": planned.json()["plan_digest"],
                "idempotency_key": "equip-wave-1",
            },
        )
        assert equipped.status_code == 200, equipped.text
        assert equipped.json()["revision"] == 2

        loadout = await client.get(f"/v1/animas/{anima_id}/loadout")
        custom = [value for value in loadout.json()["gestures"] if value["origin"] == "custom"]
        assert len(custom) == 1
        remove_intent = {
            "operation": "remove",
            "binding_id": custom[0]["binding_id"],
            "config_overrides": {},
        }
        remove_plan = await client.post(
            f"/v1/animas/{anima_id}/gestures:plan",
            json={"expected_revision": 2, "intent": remove_intent},
        )
        unequipped = await client.post(
            f"/v1/animas/{anima_id}/gestures:commit",
            json={
                "expected_revision": 2,
                "intent": remove_intent,
                "plan_digest": remove_plan.json()["plan_digest"],
                "idempotency_key": "unequip-wave-1",
            },
        )
        assert unequipped.status_code == 200, unequipped.text
        assert unequipped.json()["revision"] == 3
    finally:
        await client.aclose()
        await async_session.execute(delete(ORMAnima).where(ORMAnima.id == anima_id))
        await async_session.execute(delete(ORMAvatar).where(ORMAvatar.id == avatar_id))
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id == item.id))
        await async_session.commit()
