"""Avatar face-part corrections: Local sidecar, owner-scoped Included override, projections and packages."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.avatar_face_part_override_repo import (
    SQLAlchemyAvatarFacePartOverrideRepository,
)
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.anima_runtime_service import AnimaRuntimeService
from animama.app.services.avatar_face_parts_service import AvatarFacePartsService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService
from animama.domain.content_catalog import CatalogContentEntry, ContentKind, ContentStatus
from animama.orm.avatar_face_part_override import ORMAvatarFacePartOverride
from animama.server.schemas.runtime_content import PyAnimaRuntime
from tests.anima_creation_service_support import AnimaCreationFixture, anima_creation_fixture, vrm, write_json
from tests.content_package_helpers import reviewed_export, reviewed_import
from tests.local_http_client import local_client


def _correction(vrm_sha256: str, *, eyes: str = "2:2:0") -> dict[str, Any]:
    return {
        "schema": "animama/avatar-face-parts/1",
        "vrm_sha256": vrm_sha256,
        "parts": {"face_skin": ["1:1:0"], "eye_left": [eyes], "eye_right": [eyes], "hair": []},
    }


def _api(correction: dict[str, Any]) -> dict[str, Any]:
    """The HTTP form of a correction lists unknown optional parts as ``null``."""

    optional = dict.fromkeys(("eye_highlight", "eyeline", "eyelash", "hair"))
    return {**correction, "parts": {**optional, **correction["parts"]}}


def _model_sha256(item: CatalogContentEntry) -> str:
    return next(file.sha256 for file in item.files if file.role == "model")


async def _rescan(session: AsyncSession, fixture: AnimaCreationFixture) -> dict[str, CatalogContentEntry]:
    content = ContentCatalogService(catalog=SQLAlchemyContentCatalog(session), store=fixture.store())
    items = {item.id: item for item in (await content.rescan(user_id=fixture.owner)).items}
    for name, item in fixture.items.items():
        fixture.items[name] = items[item.id]
    return items


async def _runtime_avatar(session: AsyncSession, fixture: AnimaCreationFixture, avatar: str) -> dict[str, Any]:
    """Create an Anima for one Avatar and return its validated runtime ``avatar`` lane."""

    created = await fixture.service(session).create(
        user_id=fixture.owner, request=fixture.request(key=f"face-parts-{avatar}", avatar=avatar)
    )
    runtime = await AnimaRuntimeService(session, store=fixture.store()).issue(
        user_id=fixture.owner, anima_id=created["anima_id"]
    )
    lane = PyAnimaRuntime.model_validate(runtime).avatar
    assert lane is not None
    return lane.model_dump(mode="json", by_alias=True)


async def test_local_avatar_face_parts_live_in_the_sidecar(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        sidecar = fixture.paths.local_root / "avatars/local-avatar.meta.json"
        write_json(sidecar, {"name": "Local Hero", "notes": "keep this authored note"})
        await _rescan(async_session, fixture)
        avatar = fixture.items["local-avatar"]
        model_path = fixture.paths.local_root / avatar.relative_locator
        model_bytes = model_path.read_bytes()
        correction = _correction(_model_sha256(avatar))
        path = f"/v1/avatar-content/{avatar.id}/face-parts"

        async with local_client(fixture.app(async_session, monkeypatch)) as client:
            initial = await client.get(path)
            assert initial.status_code == 200, initial.text
            assert initial.json() == {
                "item_id": avatar.id,
                "revision": avatar.revision_sha256,
                "source": "none",
                "face_parts": None,
            }

            mismatch = await client.put(
                path,
                json={"expected_revision": avatar.revision_sha256, "face_parts": _correction("0" * 64)},
            )
            assert mismatch.status_code == 422, mismatch.text
            assert mismatch.json()["detail"]["reason"] == "avatar_face_parts_digest_mismatch"

            saved = await client.put(path, json={"expected_revision": avatar.revision_sha256, "face_parts": correction})
            assert saved.status_code == 200, saved.text
            state = saved.json()
            assert state["item_id"] == avatar.id and state["source"] == "local_metadata"
            assert state["revision"] != avatar.revision_sha256
            assert state["face_parts"] == _api(correction)
            # Other authored keys survive and the VRM bytes are untouched.
            assert json.loads(sidecar.read_text()) == {
                "name": "Local Hero",
                "notes": "keep this authored note",
                "face_parts": correction,
            }
            assert model_path.read_bytes() == model_bytes

            stale = await client.put(path, json={"expected_revision": avatar.revision_sha256, "face_parts": None})
            assert stale.status_code == 409, stale.text
            assert stale.json()["detail"] == {
                "code": "catalog_revision_conflict",
                "current_revision": state["revision"],
            }

            assert (await client.get(path)).json() == state
            item = (await client.get(f"/v1/avatar-content/{avatar.id}")).json()
            assert item["revision_sha256"] == state["revision"] and item["face_parts"] == _api(correction)
            listed = (await client.get("/v1/avatar-content")).json()["items"]
            assert next(value for value in listed if value["item_id"] == avatar.id)["face_parts"] == _api(correction)
            # Previews and prepared preview batches report the same effective parts.
            preview = await client.post(f"/v1/avatar-content/{avatar.id}:preview")
            assert preview.status_code == 200, preview.text
            assert preview.json()["item"]["face_parts"] == _api(correction)
            prepared = await client.post(
                "/v1/content/previews:prepare",
                json={
                    "schema_version": 1,
                    "roots": [{"kind": "avatar", "source": {"type": "catalog", "catalog_item_id": avatar.id}}],
                },
            )
            assert prepared.status_code == 200, prepared.text
            assert [item["face_parts"] for item in prepared.json()["items"]] == [_api(correction)]
            assert all(value["face_parts"] is None for value in listed if value["item_id"] != avatar.id)

            cleared = await client.put(path, json={"expected_revision": state["revision"], "face_parts": None})
            assert cleared.status_code == 200, cleared.text
            assert cleared.json()["source"] == "none" and cleared.json()["face_parts"] is None
            assert cleared.json()["revision"] not in {state["revision"], None}
            assert json.loads(sidecar.read_text()) == {"name": "Local Hero", "notes": "keep this authored note"}

            # Saving again leaves the correction in the runtime avatar lane.
            await client.put(path, json={"expected_revision": cleared.json()["revision"], "face_parts": correction})
        await _rescan(async_session, fixture)
        assert (await _runtime_avatar(async_session, fixture, "local-avatar"))["face_parts"] == _api(correction)


async def test_local_sidecar_correction_for_other_bytes_is_not_effective(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        write_json(
            fixture.paths.local_root / "avatars/local-avatar.meta.json",
            {"face_parts": _correction(hashlib.sha256(b"other model").hexdigest())},
        )
        await _rescan(async_session, fixture)
        avatar = fixture.items["local-avatar"]
        assert avatar.status is ContentStatus.VALID
        async with local_client(fixture.app(async_session, monkeypatch)) as client:
            state = (await client.get(f"/v1/avatar-content/{avatar.id}/face-parts")).json()
            assert state["source"] == "none" and state["face_parts"] is None

        write_json(fixture.paths.local_root / "avatars/local-avatar.meta.json", {"face_parts": {"schema": "nope"}})
        await _rescan(async_session, fixture)
        assert fixture.items["local-avatar"].status is ContentStatus.INVALID
        assert {value.code for value in fixture.items["local-avatar"].diagnostics} == {"avatar_face_parts_invalid"}


async def test_included_avatar_face_parts_are_an_owner_scoped_override(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        avatar = fixture.items["included-avatar"]
        included = fixture.paths.included_root / avatar.relative_locator
        included_bytes = included.read_bytes()
        correction = _correction(_model_sha256(avatar))
        path = f"/v1/avatar-content/{avatar.id}/face-parts"

        async with local_client(fixture.app(async_session, monkeypatch)) as client:
            stale = await client.put(path, json={"expected_revision": "f" * 64, "face_parts": correction})
            assert stale.status_code == 409, stale.text
            assert stale.json()["detail"]["current_revision"] == avatar.revision_sha256
            missing = await client.put(
                "/v1/avatar-content/not-an-item/face-parts",
                json={"expected_revision": avatar.revision_sha256, "face_parts": None},
            )
            assert missing.status_code == 404, missing.text

            saved = await client.put(path, json={"expected_revision": avatar.revision_sha256, "face_parts": correction})
            assert saved.status_code == 200, saved.text
            assert saved.json() == {
                "item_id": avatar.id,
                "revision": avatar.revision_sha256,
                "source": "included_override",
                "face_parts": _api(correction),
            }
            assert included.read_bytes() == included_bytes
            assert (await client.get(path)).json() == saved.json()
            item = (await client.get(f"/v1/avatar-content/{avatar.id}")).json()
            assert item["face_parts"] == _api(correction) and item["revision_sha256"] == avatar.revision_sha256
            listed = (await client.get("/v1/avatar-content")).json()["items"]
            assert next(value for value in listed if value["item_id"] == avatar.id)["face_parts"] == _api(correction)

        # Another owner sees the Included Avatar without this owner's correction.
        other = await fixture.add_owner(async_session)
        other_state = await AvatarFacePartsService(
            catalog=SQLAlchemyContentCatalog(async_session),
            overrides=SQLAlchemyAvatarFacePartOverrideRepository(async_session),
        ).get(user_id=other, item_id=avatar.id)
        assert other_state.source == "none" and other_state.face_parts is None

        assert (await _runtime_avatar(async_session, fixture, "included-avatar"))["face_parts"] == _api(correction)

        async with local_client(fixture.app(async_session, monkeypatch)) as client:
            cleared = await client.put(path, json={"expected_revision": avatar.revision_sha256, "face_parts": None})
            assert cleared.status_code == 200, cleared.text
            assert cleared.json()["source"] == "none"
            assert (
                await async_session.scalar(
                    select(ORMAvatarFacePartOverride).where(ORMAvatarFacePartOverride.avatar_item_id == avatar.id)
                )
            ) is None


async def test_stale_included_override_is_ignored_after_the_avatar_changes(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        avatar = fixture.items["included-avatar"]
        correction = _correction(_model_sha256(avatar))
        path = f"/v1/avatar-content/{avatar.id}/face-parts"
        async with local_client(fixture.app(async_session, monkeypatch)) as client:
            saved = await client.put(path, json={"expected_revision": avatar.revision_sha256, "face_parts": correction})
            assert saved.status_code == 200, saved.text

            # A new Included release replaces the model bytes at the same locator.
            (fixture.paths.included_root / avatar.relative_locator).write_bytes(vrm("A newer Included release"))
            await _rescan(async_session, fixture)
            changed = fixture.items["included-avatar"]
            assert changed.id == avatar.id and changed.revision_sha256 != avatar.revision_sha256

            state = (await client.get(path)).json()
            assert state == {
                "item_id": avatar.id,
                "revision": changed.revision_sha256,
                "source": "none",
                "face_parts": None,
            }
            assert (await client.get(f"/v1/avatar-content/{avatar.id}")).json()["face_parts"] is None
        row = await async_session.scalar(
            select(ORMAvatarFacePartOverride).where(ORMAvatarFacePartOverride.avatar_item_id == avatar.id)
        )
        assert row is not None and row.avatar_revision_sha256 == avatar.revision_sha256

        # The digest is checked too: an override recorded against the current
        # revision but different VRM bytes is still not applied.
        await async_session.execute(
            update(ORMAvatarFacePartOverride)
            .where(ORMAvatarFacePartOverride.avatar_item_id == avatar.id)
            .values(avatar_revision_sha256=changed.revision_sha256)
        )
        await async_session.commit()
        state = await AvatarFacePartsService(
            catalog=SQLAlchemyContentCatalog(async_session),
            overrides=SQLAlchemyAvatarFacePartOverrideRepository(async_session),
        ).get(user_id=fixture.owner, item_id=avatar.id)
        assert state.source == "none"


def _package_service(session: AsyncSession, fixture: AnimaCreationFixture) -> ContentPackageService:
    catalog = SQLAlchemyContentCatalog(session)
    return ContentPackageService(
        content=ContentCatalogService(catalog=catalog, store=fixture.store()),
        exports_root=fixture.paths.exports_staging_root,
        imports_root=fixture.paths.imports_staging_root,
        anima_sources=AnimaPackageSourceService(
            catalog=catalog, sources=SQLAlchemyAnimaPackageSourceRepository(session)
        ),
        uow=SQLAlchemyAnimaAggregateUnitOfWork(session),
        default_model_provider_id=fixture.provider,
        face_part_overrides=SQLAlchemyAvatarFacePartOverrideRepository(session),
    )


async def _imported_avatar_state(
    session: AsyncSession, fixture: AnimaCreationFixture, packages: ContentPackageService, archive: Path, operation: str
) -> tuple[CatalogContentEntry, Any]:
    command = await reviewed_import(packages, user_id=fixture.owner, archive_path=archive, operation_id=operation)
    result = await packages.imports.commit(**command)
    copied_id = next(item.item_id for item in result.items if item.kind is ContentKind.AVATAR)
    fixture.extra_catalog_ids.add(copied_id)
    copied = await SQLAlchemyContentCatalog(session).get_visible_item(item_id=copied_id, user_id=fixture.owner)
    assert copied is not None
    state = await AvatarFacePartsService(
        catalog=SQLAlchemyContentCatalog(session),
        overrides=SQLAlchemyAvatarFacePartOverrideRepository(session),
    ).get(user_id=fixture.owner, item_id=copied_id)
    return copied, state


async def test_local_avatar_package_round_trip_keeps_face_parts(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        avatar = fixture.items["local-avatar"]
        correction = _correction(_model_sha256(avatar))
        async with local_client(fixture.app(async_session, monkeypatch)) as client:
            saved = await client.put(
                f"/v1/avatar-content/{avatar.id}/face-parts",
                json={"expected_revision": avatar.revision_sha256, "face_parts": correction},
            )
            assert saved.status_code == 200, saved.text
        packages = _package_service(async_session, fixture)
        exported = await reviewed_export(packages, user_id=fixture.owner, root_item_id=avatar.id)
        copied, state = await _imported_avatar_state(async_session, fixture, packages, exported.path, "face-parts-copy")
        assert copied.id != avatar.id and _model_sha256(copied) == _model_sha256(avatar)
        assert state.source == "local_metadata"
        assert (
            state.face_parts is not None and state.face_parts.model_dump(by_alias=True, exclude_none=True) == correction
        )


async def test_anima_export_merges_the_included_avatar_override(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        avatar = fixture.items["included-avatar"]
        correction = _correction(_model_sha256(avatar))
        created = await fixture.service(async_session).create(
            user_id=fixture.owner, request=fixture.request(avatar="included-avatar")
        )
        async with local_client(fixture.app(async_session, monkeypatch)) as client:
            saved = await client.put(
                f"/v1/avatar-content/{avatar.id}/face-parts",
                json={"expected_revision": avatar.revision_sha256, "face_parts": correction},
            )
            assert saved.status_code == 200, saved.text
        packages = _package_service(async_session, fixture)
        summary = await packages.summarize(user_id=fixture.owner, anima_id=created["anima_id"])
        review = await packages.prepare_export(
            user_id=fixture.owner, anima_id=created["anima_id"], expected_digest=summary.digest
        )
        cached = await packages.get_export(user_id=fixture.owner, export_id=review.export_id)
        (entry,) = [value for value in review.manifest.entries if value.kind is ContentKind.AVATAR]
        (metadata,) = [file for file in entry.files if file.role == "metadata"]
        with ZipFile(cached.path) as archive:
            document = json.loads(archive.read(metadata.archive_path))
            assert hashlib.sha256(archive.read(metadata.archive_path)).hexdigest() == metadata.sha256
        assert document["face_parts"] == correction

        copied, state = await _imported_avatar_state(
            async_session, fixture, packages, cached.path, "face-parts-anima-copy"
        )
        assert copied.source.value == "local"
        assert state.source == "local_metadata"
        assert (
            state.face_parts is not None and state.face_parts.model_dump(by_alias=True, exclude_none=True) == correction
        )
