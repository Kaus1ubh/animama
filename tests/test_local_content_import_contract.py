from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from sqlalchemy import delete

from animama.domain.content_catalog import ContentConflictError, ContentKind, ContentSource, ContentStatus
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services, reviewed_export, reviewed_import, save_wave, vrma


def _happy_reaction_descriptor() -> bytes:
    return json.dumps(
        {
            "schema_version": 1,
            "content_type": "reaction",
            "content_id": "local:reaction:happy",
            "name": "Happy",
            "placement_hint": {"emotion": "joy", "intensity": 2},
            "implementation": {"kind": "anima_clip", "file_role": "sequence"},
            "files": [{"path": "happy.json", "role": "sequence"}],
            "dependencies": [],
        }
    ).encode()


def _happy_pose_clip() -> bytes:
    return json.dumps(
        {
            "schema": "animaPoseClip/1.0",
            "id": "happy",
            "name": "Happy",
            "role": "reaction",
            "duration": 1,
            "poses": {"rest": {"ref": "relaxedRest"}},
            "poseKeyframes": [{"time": 0, "pose": "rest"}],
        }
    ).encode()


async def test_import_reviews_automatic_suffix_and_installs_an_editable_copy(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        exported = await reviewed_export(
            packages,
            user_id="package-owner",
            root_item_id=saved.item.id,
        )
        original_path = paths.local_root / "gestures/friendly-wave.vrma"
        original_path.write_bytes(vrma("manually-edited"))
        await content.rescan(user_id="package-owner", include_included=False)

        command = await reviewed_import(
            packages, user_id="package-owner", archive_path=exported.path, operation_id="import-wave-copy"
        )
        review = await packages.imports.review(user_id="package-owner", stage_id=command["stage_id"])
        assert review.items[0].name == "Friendly Wave-2"
        assert original_path.read_bytes() == vrma("manually-edited")
        imported = await packages.imports.commit(**command)
        assert len(imported.items) == 1
        copy = await catalog.get_visible_item(item_id=imported.items[0].item_id, user_id="package-owner")
        assert copy is not None
        assert copy.relative_locator == "gestures/friendly-wave-2.vrma"
        assert copy.relative_locator.endswith(".vrma")
        assert (paths.local_root / copy.relative_locator).read_bytes() == vrma("original")
        assert copy.logical_key is not None
        assert copy.logical_key != saved.item.logical_key
        assert copy.provenance["license"] == "fixture-only"
        assert copy.provenance["import"]["package_schema"] == "animama-content-package/3"
        rescanned = await content.rescan(user_id="package-owner", include_included=False)
        rescanned_copy = next(item for item in rescanned.items if item.id == copy.id)
        assert rescanned_copy.provenance["import"] == copy.provenance["import"]
        assert not any(path.name == "package.json" for path in paths.local_root.rglob("*"))
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_import_copy_preserves_action_control_and_payload_names(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths, catalog, _content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await saves.save_descriptor(
            user_id="package-owner",
            kind=ContentKind.REACTION,
            entry_name="Happy",
            descriptor=_happy_reaction_descriptor(),
            companion_files={"happy.json": _happy_pose_clip()},
            operation_id="save-happy-for-import",
            catalog_item_id=None,
            expected_revision=None,
        )
        exported = await reviewed_export(
            packages,
            user_id="package-owner",
            root_item_id=saved.item.id,
        )

        command = await reviewed_import(
            packages, user_id="package-owner", archive_path=exported.path, operation_id="import-happy-copy"
        )
        imported = await packages.imports.commit(**command)

        copy = await catalog.get_visible_item(item_id=imported.items[0].item_id, user_id="package-owner")
        assert copy is not None
        copy_root = paths.local_root / copy.relative_locator
        copy_name = copy_root.name
        descriptor_path = copy_root / f"{copy_name}.meta.json"
        payload_path = copy_root / "happy.json"
        assert descriptor_path.is_file()
        assert payload_path.is_file()
        assert not list(copy_root.glob("*.pose.json"))
        descriptor = json.loads(descriptor_path.read_bytes())
        assert descriptor["content_id"] == copy.logical_key
        assert descriptor["files"] == [{"path": payload_path.name, "role": "sequence"}]
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


def test_import_rejects_archive_traversal_before_writing_local(tmp_path: Path) -> None:
    archive_path = tmp_path / "unsafe.zip"
    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("../escape.vrma", b"unsafe")
        archive.writestr("package.json", b'{"schema":"animama-content-package/1"}')

    from tests.test_content_package_v3_archive import inspector

    with pytest.raises(ContentConflictError, match="package_archive_invalid"):
        inspector(tmp_path).inspect(archive_path, destination=tmp_path / "inspection")

    assert not (tmp_path / "escape.vrma").exists()


async def test_late_import_failure_compensates_files_and_catalog_visibility(
    async_session,
    tmp_path: Path,
    monkeypatch,
) -> None:  # noqa: ANN001
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        exported = await reviewed_export(
            packages,
            user_id="package-owner",
            root_item_id=saved.item.id,
        )
        assert saved.item.revision_sha256 is not None
        await content.delete_item(
            item_id=saved.item.id,
            user_id="package-owner",
            expected_revision=saved.item.revision_sha256,
        )

        async def fail_provenance(**_kwargs):  # noqa: ANN003, ANN202
            raise RuntimeError("forced late catalog failure")

        monkeypatch.setattr(catalog, "record_import_provenance", fail_provenance)
        command = await reviewed_import(
            packages, user_id="package-owner", archive_path=exported.path, operation_id="import-wave-late-failure"
        )
        with pytest.raises(RuntimeError, match="forced late catalog failure"):
            await packages.imports.commit(**command)

        assert not (paths.local_root / "gestures/friendly-wave.vrma").exists()
        reconciled = await catalog.get_by_locator(
            source=ContentSource.LOCAL,
            relative_locator="gestures/friendly-wave.vrma",
        )
        assert reconciled is None or reconciled.status is not ContentStatus.VALID
        assert all(
            item.relative_locator != "gestures/friendly-wave.vrma"
            for item in await catalog.list_visible(user_id="package-owner")
            if item.status is ContentStatus.VALID
        )
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()
