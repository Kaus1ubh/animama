"""Creation uses the existing typed Save boundary, never a private upload lane."""

from __future__ import annotations

import asyncio
import json
from io import BytesIO
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select

from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_save_service import ContentSaveService
from animama.domain.content_catalog import ContentKind
from animama.domain.request_principal import RequestPrincipal
from animama.orm.content_catalog import ORMAnimaContentBinding, ORMContentCatalogItem
from animama.server.deps import get_current_principal
from tests.anima_creation_service_support import anima_creation_fixture, glb, image_bytes, vrm


async def upload_avatar(client, name, payload, **fields):
    return await client.put(
        f"/v1/avatar-content/{name}",
        data={"operation_id": str(uuid4()), "creation_context": "true", **fields},
        files={"files": ("avatar.vrm", payload, "model/gltf-binary")},
    )


async def test_owned_avatar_byte_reuse_is_not_cross_owner_or_included(async_session, tmp_path, monkeypatch):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        other = await fixture.add_owner(async_session)
        payload = vrm("confirmed-upload")
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            first = await upload_avatar(client, "First", payload, metadata_json='{"name":"Original name"}')
            assert first.status_code == 200, first.text
            original = first.json()
            duplicate = await upload_avatar(client, "Second", payload, metadata_json='{"name":"Do not overwrite"}')
            assert duplicate.status_code == 200, duplicate.text
            assert duplicate.json() == original
            assert not (fixture.paths.local_root / "avatars/second.vrm").exists()
            row = await async_session.get(ORMContentCatalogItem, original["item_id"])
            assert row.owner_user_id == fixture.owner and row.scope == "owner"

            # An Included copy is not an owner-owned reuse candidate.
            included = await upload_avatar(client, "IncludedCopy", vrm("AvatarSample_A_1_New"))
            assert included.status_code == 200, included.text
            assert included.json()["item_id"] != fixture.items["included-avatar"].id

            async def other_user():
                return RequestPrincipal(id=other)

            app.dependency_overrides[get_current_principal] = other_user
            independent = await upload_avatar(client, "OtherOwner", payload)
            assert independent.status_code == 200, independent.text
            assert independent.json()["item_id"] != original["item_id"]
            assert (
                await async_session.get(ORMContentCatalogItem, independent.json()["item_id"])
            ).owner_user_id == other
            inaccessible = await client.get(f"/v1/avatar-content/{original['item_id']}")
            assert inaccessible.status_code == 404


async def test_confirmed_upload_survives_failed_create_and_in_use_replace_is_blocked(
    async_session, tmp_path, monkeypatch
):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            saved = await upload_avatar(client, "Confirmed", vrm("confirmed"))
            assert saved.status_code == 200, saved.text
            avatar = saved.json()
            spec = fixture.request().model_dump()
            del spec["expected_source_revisions"][spec["avatar"]["item_id"]]
            spec["avatar"] = {key: avatar[key] for key in ("item_id", "revision_sha256")}
            spec["expected_source_revisions"][avatar["item_id"]] = {
                "kind": "avatar",
                "revision_sha256": avatar["revision_sha256"],
            }
            failed = await client.post("/v1/animas", json={**spec, "display_name": " "})
            assert failed.status_code == 422
            assert (fixture.paths.local_root / "avatars/confirmed.vrm").read_bytes() == vrm("confirmed")
            assert (await client.get(f"/v1/avatar-content/{avatar['item_id']}")).status_code == 200
            created = await client.post("/v1/animas", json=spec)
            assert created.status_code == 201, created.text
            collision = await upload_avatar(client, "Confirmed", vrm("different"))
            assert collision.status_code == 409
            assert collision.json()["detail"]["code"] == "content_path_exists"
            stale = await upload_avatar(
                client, "Confirmed", vrm("different"), catalog_item_id=avatar["item_id"], expected_revision="f" * 64
            )
            assert stale.status_code == 409 and stale.json()["detail"]["code"] == "catalog_revision_conflict"
            in_use = await upload_avatar(
                client,
                "Confirmed",
                vrm("different"),
                catalog_item_id=avatar["item_id"],
                expected_revision=avatar["revision_sha256"],
            )
            assert in_use.status_code == 409 and in_use.json()["detail"]["code"] == "avatar_in_use_choose_new_name"
            assert (fixture.paths.local_root / "avatars/confirmed.vrm").read_bytes() == vrm("confirmed")
            renamed = await upload_avatar(client, "Renamed", vrm("different"))
            assert renamed.status_code == 200 and renamed.json()["item_id"] != avatar["item_id"]


@pytest.mark.parametrize("version", ["0.0", "1.0"])
async def test_typed_avatar_save_uses_strong_vrm_validation(async_session, tmp_path, monkeypatch, version):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            valid = await upload_avatar(client, "Valid", vrm("validated", version))
            assert valid.status_code == 200, valid.text
            invalid = await upload_avatar(
                client,
                "Invalid",
                glb({"asset": {"version": "2.0"}, "extensions": {"VRMC_vrm": {"specVersion": "1.0"}}}),
            )
            assert invalid.status_code == 422, invalid.text
            assert invalid.json()["detail"]["code"] == "content_invalid"
            assert not (fixture.paths.local_root / "avatars/invalid.vrm").exists()
            assert (await client.get("/v1/animas/creation-options")).json()["limits"][
                "avatar_max_bytes"
            ] == 100 * 1024**2


@pytest.mark.parametrize(
    "format,suffix,mime", [("PNG", "png", "image/png"), ("JPEG", "jpg", "image/jpeg"), ("WEBP", "webp", "image/webp")]
)
async def test_static_appearance_is_canonical_and_exact_framing_is_bound(
    async_session, tmp_path, monkeypatch, format, suffix, mime
):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        with Image.new("RGB", (32, 24), "purple") as image:
            stream = BytesIO()
            image.save(stream, format=format)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.put(
                "/v1/appearance-content/Profile",
                data={"operation_id": "save-profile"},
                files={"files": (f"profile.{suffix}", stream.getvalue(), mime)},
            )
            assert response.status_code == 200, response.text
            appearance = response.json()
            with Image.open(fixture.paths.local_root / "appearances/profile.webp") as image:
                assert image.format == "WEBP" and image.size == (32, 24)
            spec = fixture.request().model_dump()
            framing = {"fit": "contain", "focal_x": 0.25, "focal_y": 0.75, "zoom": 2}
            spec["appearance"]["profile"] = {
                "source": {key: appearance[key] for key in ("item_id", "revision_sha256")},
                "presentation": framing,
            }
            spec["expected_source_revisions"][appearance["item_id"]] = {
                "kind": "appearance",
                "revision_sha256": appearance["revision_sha256"],
            }
            created = await client.post("/v1/animas", json=spec)
            assert created.status_code == 201, created.text
            bindings = list(
                await async_session.scalars(
                    select(ORMAnimaContentBinding).where(
                        ORMAnimaContentBinding.anima_id == created.json()["anima_id"],
                        ORMAnimaContentBinding.kind == "appearance",
                    )
                )
            )
            assert len(bindings) == 1 and bindings[0].config == framing


@pytest.mark.parametrize("case", ["animated", "svg", "mime", "corrupt", "dimension"])
async def test_appearance_rejects_unsupported_or_misleading_image_inputs(async_session, tmp_path, monkeypatch, case):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        payload, filename, mime = image_bytes(), "image.png", "image/png"
        if case == "animated":
            with Image.new("RGB", (4, 4), "red") as first, Image.new("RGB", (4, 4), "blue") as second:
                stream = BytesIO()
                first.save(stream, format="PNG", save_all=True, append_images=[second], duration=100)
                payload = stream.getvalue()
        elif case == "svg":
            payload, filename, mime = b"<svg></svg>", "image.svg", "image/svg+xml"
        elif case == "mime":
            mime = "image/jpeg"
        elif case == "corrupt":
            payload = b"not an image"
        elif case == "dimension":
            with Image.new("RGB", (8193, 1), "red") as image:
                stream = BytesIO()
                image.save(stream, format="PNG")
                payload = stream.getvalue()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.put(
                "/v1/appearance-content/Invalid",
                data={"operation_id": "save-invalid"},
                files={"files": (filename, payload, mime)},
            )
            assert response.status_code in {409, 422}, response.text
            assert not (fixture.paths.local_root / "appearances/invalid.webp").exists()


async def test_avatar_portrait_capture_is_an_ordinary_owned_appearance(async_session, tmp_path, monkeypatch):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        avatar = fixture.items["local-avatar"]
        data = {
            "entry_name": "Portrait",
            "operation_id": "capture-portrait",
            "expected_avatar_revision": avatar.revision_sha256,
        }
        capture = image_bytes(portrait=True, format="WEBP")
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            stale = await client.put(
                f"/v1/avatar-content/{avatar.id}/portrait",
                data={**data, "expected_avatar_revision": "f" * 64},
                files={"file": ("portrait.webp", capture, "image/webp")},
            )
            assert stale.status_code == 409
            portrait = await client.put(
                f"/v1/avatar-content/{avatar.id}/portrait",
                data=data,
                files={"file": ("portrait.webp", capture, "image/webp")},
            )
            assert portrait.status_code == 200, portrait.text
            saved = portrait.json()
            assert saved["kind"] == "appearance"
            row = await async_session.get(ORMContentCatalogItem, saved["item_id"])
            assert row.owner_user_id == fixture.owner
            path = fixture.paths.local_root / "appearances/portrait.webp"
            assert path.stat().st_size <= 256 * 1024
            with Image.open(path) as image:
                assert image.size == (256, 256) and image.format == "WEBP"
            still_avatar = await client.get(f"/v1/avatar-content/{avatar.id}")
            assert still_avatar.json()["revision_sha256"] == avatar.revision_sha256
            assert (await client.get(f"/v1/appearance-content/{saved['item_id']}")).status_code == 200


async def test_descriptor_appearance_uses_the_same_canonicalizer(async_session, tmp_path, monkeypatch):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        descriptor = {
            "schema_version": 1,
            "content_type": "appearance",
            "name": "Descriptor picture",
            "files": [{"path": "picture.png", "role": "image"}],
        }
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            saved = await client.put(
                "/v1/appearance-content/DescriptorPicture",
                data={
                    "operation_id": "save-descriptor-picture",
                    "descriptor_json": json.dumps(descriptor),
                    "companion_paths_json": '["picture.png"]',
                },
                files={"files": ("picture.png", image_bytes(), "image/png")},
            )
            assert saved.status_code == 200, saved.text
            assert (fixture.paths.local_root / "appearances/descriptorpicture/image.webp").is_file()
            assert not (fixture.paths.local_root / "appearances/descriptorpicture/picture.png").exists()


async def test_concurrent_rescan_cannot_expose_unadmitted_creator_upload(
    async_session, async_session_factory, tmp_path, monkeypatch
):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        other = await fixture.add_owner(async_session)
        async with async_session_factory() as save_session, async_session_factory() as scan_session:
            catalog = SQLAlchemyContentCatalog(save_session)
            saved_content = ContentCatalogService(catalog=catalog, store=fixture.store())
            saver = ContentSaveService(content=saved_content)
            scanner = ContentCatalogService(
                catalog=SQLAlchemyContentCatalog(scan_session),
                store=fixture.store(),
            )
            promoted, release = asyncio.Event(), asyncio.Event()
            original = saver._finish

            async def pause_before_owner_admission(**kwargs):
                promoted.set()
                await release.wait()
                return await original(**kwargs)

            monkeypatch.setattr(saver, "_finish", pause_before_owner_admission)
            save_task = asyncio.create_task(
                saver.save_standalone(
                    user_id=fixture.owner,
                    kind=ContentKind.AVATAR,
                    entry_name="Private Upload",
                    filename="private.vrm",
                    payload=vrm("private-upload"),
                    metadata_sidecar=None,
                    operation_id="private-upload",
                    catalog_item_id=None,
                    expected_revision=None,
                )
            )
            scan_task = None
            try:
                await asyncio.wait_for(promoted.wait(), timeout=5)
                scan_task = asyncio.create_task(scanner.rescan(user_id=other, include_included=False))
                # A real second session must wait before scanning the promoted
                # bytes or admit them to the wrong owner during this gap.
                with pytest.raises(TimeoutError):
                    await asyncio.wait_for(asyncio.shield(scan_task), timeout=0.1)
            finally:
                release.set()
                await asyncio.wait_for(save_task, timeout=5)
                if scan_task is not None:
                    result = await asyncio.wait_for(scan_task, timeout=5)
            assert all(item.relative_locator != "avatars/private-upload.vrm" for item in result.items)
