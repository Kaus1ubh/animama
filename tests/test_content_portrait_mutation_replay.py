"""Portrait retries bind the original source through the real HTTP/catalog/store path."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_save_service import ContentSaveService
from animama.domain.content_catalog import CatalogContentEntry, ContentKind
from animama.domain.request_principal import RequestPrincipal
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.orm.content_mutation import ORMContentMutationReceipt
from animama.product_http.routes import typed_content
from animama.server.deps import get_current_principal
from animama.server.local_runtime import LocalRuntimePaths
from tests.anima_creation_service_support import image_bytes, vrm
from tests.content_package_helpers import package_services
from tests.local_http_client import local_client
from tests.product_http_support import install_local_ports


@dataclass
class PortraitWorkflow:
    owner: str
    paths: LocalRuntimePaths
    content: ContentCatalogService
    saves: ContentSaveService
    client: AsyncClient
    capture: bytes

    async def save_avatar(self, previous: CatalogContentEntry | None = None) -> CatalogContentEntry:
        """Create or replace a real admitted Avatar without a live Anima binding."""

        name = "Edited Avatar" if previous else "Original Avatar"
        saved = await self.saves.save_standalone(
            user_id=self.owner,
            kind=ContentKind.AVATAR,
            entry_name="Source Avatar",
            filename="avatar.vrm",
            payload=vrm(name),
            metadata_sidecar=json.dumps({"name": name}).encode(),
            operation_id="edit-source-avatar" if previous else "create-source-avatar",
            catalog_item_id=previous.id if previous else None,
            expected_revision=previous.revision_sha256 if previous else None,
        )
        return saved.item

    async def portrait(
        self, source_id: str, source_revision: str, *, operation_id: str = "capture-portrait"
    ) -> Response:
        """Submit fresh upload streams containing the exact same captured bytes."""

        return await self.client.put(
            f"/v1/avatar-content/{source_id}/portrait",
            data={
                "operation_id": operation_id,
                "expected_avatar_revision": source_revision,
                "renderer_version": "2",
                "capture_preset_version": "3",
            },
            files={"file": ("portrait.webp", self.capture, "image/webp")},
        )

    async def portraits_for(self, avatar_id: str) -> list[CatalogContentEntry]:
        return [
            item
            for item in await self.content.list_visible(user_id=self.owner)
            if item.kind is ContentKind.APPEARANCE
            and isinstance(item.metadata.get("presentation"), dict)
            and item.metadata["presentation"].get("avatar_item_id") == avatar_id
        ]

    def local_files(self) -> dict[str, bytes]:
        return {
            path.relative_to(self.paths.local_root).as_posix(): path.read_bytes()
            for path in self.paths.local_root.rglob("*")
            if path.is_file()
        }


@pytest_asyncio.fixture
async def portrait_workflow(async_session: AsyncSession, tmp_path: Path) -> AsyncIterator[PortraitWorkflow]:
    paths, _, content, saves, _ = package_services(async_session, tmp_path)
    owner = f"portrait-replay-{uuid4().hex}"
    app = FastAPI()
    app.state.local_runtime_paths = paths
    app.include_router(typed_content.router)

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id=owner)

    app.dependency_overrides[get_current_principal] = principal
    install_local_ports(app, async_session)
    try:
        async with local_client(app) as client:
            yield PortraitWorkflow(owner, paths, content, saves, client, image_bytes(portrait=True, format="WEBP"))
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == owner))
        await async_session.execute(
            delete(ORMContentMutationReceipt).where(ORMContentMutationReceipt.owner_user_id == owner)
        )
        await async_session.commit()


@pytest.mark.parametrize("later_change", ["edited", "deleted"])
async def test_portrait_replays_original_response_after_source_avatar_changes(
    portrait_workflow: PortraitWorkflow, later_change: str
) -> None:
    workflow = portrait_workflow
    avatar = await workflow.save_avatar()
    assert avatar.revision_sha256 is not None
    original = await workflow.portrait(avatar.id, avatar.revision_sha256)
    assert original.status_code == 200, original.text
    assert original.json()["name"] == "Original Avatar portrait"
    assert original.json()["kind"] == "appearance"
    assert original.json()["presentation"]["avatar_item_id"] == avatar.id

    if later_change == "edited":
        updated = await workflow.save_avatar(avatar)
        assert updated.id == avatar.id
        assert updated.revision_sha256 != avatar.revision_sha256
    else:
        await workflow.content.delete_item(
            user_id=workflow.owner, item_id=avatar.id, expected_revision=avatar.revision_sha256
        )
    current = await workflow.client.get(f"/v1/avatar-content/{avatar.id}")
    assert current.status_code == (200 if later_change == "edited" else 404), current.text
    if later_change == "edited":
        assert current.json()["name"] == "Edited Avatar"

    before_retry = workflow.local_files()
    replayed = await workflow.portrait(avatar.id, avatar.revision_sha256)

    assert replayed.status_code == 200, replayed.text
    assert replayed.json() == original.json()
    assert workflow.local_files() == before_retry


@pytest.mark.parametrize("changed_source_field", ["item_id", "expected_revision"])
async def test_portrait_operation_id_rejects_changed_source_with_identical_capture_bytes(
    portrait_workflow: PortraitWorkflow, changed_source_field: str
) -> None:
    workflow = portrait_workflow
    avatar = await workflow.save_avatar()
    assert avatar.revision_sha256 is not None
    original = await workflow.portrait(avatar.id, avatar.revision_sha256)
    assert original.status_code == 200, original.text
    before_retry = workflow.local_files()

    source_id = uuid4().hex if changed_source_field == "item_id" else avatar.id
    source_revision = "f" * 64 if changed_source_field == "expected_revision" else avatar.revision_sha256
    rejected = await workflow.portrait(source_id, source_revision)

    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["detail"]["code"] == "operation_id_reused"
    assert workflow.local_files() == before_retry
    current = await workflow.client.get(f"/v1/appearance-content/{original.json()['item_id']}")
    assert current.status_code == 200, current.text
    assert current.json() == original.json()


async def test_saving_again_replaces_the_avatars_one_portrait(portrait_workflow: PortraitWorkflow) -> None:
    workflow = portrait_workflow
    avatar = await workflow.save_avatar()
    assert avatar.revision_sha256 is not None
    first = await workflow.portrait(avatar.id, avatar.revision_sha256, operation_id="first-capture")
    assert first.status_code == 200, first.text

    edited = await workflow.save_avatar(avatar)
    assert edited.revision_sha256 is not None
    second = await workflow.portrait(edited.id, edited.revision_sha256, operation_id="second-capture")

    assert second.status_code == 200, second.text
    assert second.json()["item_id"] == first.json()["item_id"]
    assert second.json()["revision_sha256"] != first.json()["revision_sha256"]
    assert second.json()["name"] == "Edited Avatar portrait"
    (portrait,) = await workflow.portraits_for(avatar.id)
    assert portrait.metadata["presentation"] == {
        "avatar_item_id": avatar.id,
        "avatar_revision_sha256": edited.revision_sha256,
    }
    assert portrait.relative_locator == f"appearances/avatar-portrait-{avatar.id}.webp"
    images = [path for path in workflow.local_files() if path.endswith(".webp")]
    assert images == [portrait.relative_locator]


async def test_avatar_content_reports_its_portrait(portrait_workflow: PortraitWorkflow) -> None:
    workflow = portrait_workflow
    avatar = await workflow.save_avatar()
    assert avatar.revision_sha256 is not None
    before = await workflow.client.get(f"/v1/avatar-content/{avatar.id}")
    assert before.status_code == 200, before.text
    assert before.json()["portrait"] is None

    saved = await workflow.portrait(avatar.id, avatar.revision_sha256)
    assert saved.status_code == 200, saved.text
    image = next(file for file in saved.json()["files"] if file["role"] == "image")

    detail = (await workflow.client.get(f"/v1/avatar-content/{avatar.id}")).json()
    listed = next(
        item
        for item in (await workflow.client.get("/v1/avatar-content")).json()["items"]
        if item["item_id"] == avatar.id
    )
    expected = {
        "url": f"/v1/content/files/{image['file_ref']}",
        "avatar_revision_sha256": avatar.revision_sha256,
        "renderer_version": 2,
        "capture_preset_version": 3,
    }
    assert detail["portrait"] == expected
    assert listed["portrait"] == expected


async def test_portrait_for_an_unknown_avatar_is_not_found(portrait_workflow: PortraitWorkflow) -> None:
    response = await portrait_workflow.portrait(uuid4().hex, "a" * 64, operation_id="unknown-avatar")

    assert response.status_code == 404, response.text
    assert portrait_workflow.local_files() == {}
