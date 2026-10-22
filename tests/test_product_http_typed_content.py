"""Shared typed content routes isolate owners and commit through the composition (ADR 0021)."""

from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.orm.content_catalog import ORMContentCatalogItem
from animama.product_http.routes import typed_content
from tests.anima_creation_service_support import image_bytes, vrm
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


async def test_avatar_face_parts_portraits_and_saves_stay_with_their_owner(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    ports = DeferredCommitPorts(async_session_factory, content_root=tmp_path)
    owner_a, owner_b = f"owner-a-{uuid4().hex[:8]}", f"owner-b-{uuid4().hex[:8]}"
    app = product_app(typed_content.router, ports=ports)
    composition = TwoOwnerComposition(app, tmp_path, owners=(owner_a, owner_b))
    model_bytes = vrm("Owner A")
    model = ("model.vrm", model_bytes, "model/gltf-binary")
    try:
        async with composition.client(owner_a) as a:
            avatar = await a.put(
                "/v1/avatar-content/Model", data={"operation_id": "save-avatar"}, files={"files": model}
            )
            assert avatar.status_code == 200, avatar.text
            gesture = await a.put(
                "/v1/gestures/Wave",
                data={"operation_id": "save-wave"},
                files={"files": ("wave.vrma", vrma("Wave A"), "model/gltf-binary")},
            )
            assert gesture.status_code == 200, gesture.text
        avatar_id, avatar_revision = avatar.json()["item_id"], avatar.json()["revision_sha256"]
        faces = f"/v1/avatar-content/{avatar_id}/face-parts"
        portrait = f"/v1/avatar-content/{avatar_id}/portrait"
        portrait_form = {
            "expected_avatar_revision": avatar_revision,
            "renderer_version": "2",
            "capture_preset_version": "3",
        }
        portrait_file = {"file": ("portrait.webp", image_bytes(portrait=True, format="WEBP"), "image/webp")}
        correction = {
            "expected_revision": avatar_revision,
            "face_parts": {
                "schema": "animama/avatar-face-parts/1",
                "vrm_sha256": hashlib.sha256(model_bytes).hexdigest(),
                "parts": {"face_skin": ["0:0:0"], "eye_left": ["0:0:0"], "eye_right": ["0:0:0"]},
            },
        }
        commits_before = ports.commits

        async with composition.client(owner_b) as b:
            assert (await b.get(faces)).status_code == 404
            assert (await b.put(faces, json=correction)).status_code == 404
            stolen = await b.put(portrait, data={**portrait_form, "operation_id": "portrait-b"}, files=portrait_file)
            assert stolen.status_code == 404, stolen.text
            # A save naming another owner's item replaces nothing.
            overwrite = await b.put(
                "/v1/gestures/Wave",
                data={
                    "operation_id": "overwrite-b",
                    "catalog_item_id": gesture.json()["item_id"],
                    "expected_revision": gesture.json()["revision_sha256"],
                },
                files={"files": ("wave.vrma", vrma("Wave B"), "model/gltf-binary")},
            )
            assert overwrite.status_code == 404, overwrite.text
        assert ports.commits == commits_before

        async with composition.client(owner_a) as a:
            assert (await a.get(faces)).status_code == 200
            saved = await a.put(portrait, data={**portrait_form, "operation_id": "portrait-a"}, files=portrait_file)
            assert saved.status_code == 200, saved.text
            portrait_commits = ports.commits
            assert portrait_commits > commits_before
            corrected = await a.put(faces, json=correction)
            assert corrected.status_code == 200, corrected.text
            assert (await a.get(f"/v1/gestures/{gesture.json()['item_id']}")).json()["revision_sha256"] == (
                gesture.json()["revision_sha256"]
            )
        # The portrait and the face-part save each committed through the composition.
        assert ports.commits > portrait_commits
    finally:
        async with async_session_factory() as session:
            await session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == owner_a))
            await session.commit()
