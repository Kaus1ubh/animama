from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from sqlalchemy import delete

from animama.domain.content_catalog import ContentConflictError, ContentKind, ContentSource, ContentStatus
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services, save_wave, vrma


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
            "poses": {},
            "poseKeyframes": [],
        }
    ).encode()


async def test_import_requires_an_explicit_collision_choice_and_installs_an_editable_copy(
    async_session, tmp_path: Path
) -> None:  # noqa: ANN001
    paths, _catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        exported = await packages.export_item(
            user_id="package-owner",
            root_item_id=saved.item.id,
            operation_id="export-wave-for-import",
        )
        original_path = paths.local_root / "gestures/friendly-wave.vrma"
        original_path.write_bytes(vrma("manually-edited"))
        await content.rescan(user_id="package-owner", include_included=False)

        with pytest.raises(ContentConflictError, match="package_destination_exists"):
            await packages.import_package(
                user_id="package-owner",
                archive_path=exported.path,
                operation_id="import-wave-cancel",
                collision="cancel",
            )
        assert original_path.read_bytes() == vrma("manually-edited")

        imported = await packages.import_package(
            user_id="package-owner",
            archive_path=exported.path,
            operation_id="import-wave-copy",
            collision="keep_both",
        )
        assert len(imported.items) == 1
        copy = imported.items[0]
        assert copy.relative_locator.startswith("gestures/friendly-wave-copy-")
        assert copy.relative_locator.endswith(".vrma")
        assert (paths.local_root / copy.relative_locator).read_bytes() == vrma("original")
        assert copy.logical_key is not None
        assert copy.logical_key.startswith("local:gesture:friendly-wave-copy-")
        assert copy.provenance["license"] == "fixture-only"
        assert copy.provenance["import"]["package_schema"] == "animama-content-package/2"
        rescanned = await content.rescan(user_id="package-owner", include_included=False)
        rescanned_copy = next(item for item in rescanned.items if item.id == copy.id)
        assert rescanned_copy.provenance["import"] == copy.provenance["import"]
        assert not any(path.name == "package.json" for path in paths.local_root.rglob("*"))
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_import_keep_both_preserves_action_control_and_payload_names(
    async_session, tmp_path: Path
) -> None:  # noqa: ANN001
    paths, _catalog, _content, saves, packages = package_services(async_session, tmp_path)
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
        exported = await packages.export_item(
            user_id="package-owner",
            root_item_id=saved.item.id,
            operation_id="export-happy-for-import",
        )

        imported = await packages.import_package(
            user_id="package-owner",
            archive_path=exported.path,
            operation_id="import-happy-copy",
            collision="keep_both",
        )

        copy = imported.items[0]
        copy_root = paths.local_root / copy.relative_locator
        copy_name = copy_root.name
        descriptor_path = copy_root / f"{copy_name}.meta.json"
        payload_path = copy_root / f"{copy_name}.json"
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
    archive_path = tmp_path / "unsafe.animama"
    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("../escape.vrma", b"unsafe")
        archive.writestr("package.json", b'{"schema":"animama-content-package/1"}')

    from animama.app.services.content_package_service import ContentPackageService

    with pytest.raises(ContentConflictError, match="package_path_invalid"):
        ContentPackageService._validated_archive(archive_path)

    assert not (tmp_path / "escape.vrma").exists()


async def test_late_import_failure_compensates_files_and_catalog_visibility(
    async_session,
    tmp_path: Path,
    monkeypatch,
) -> None:  # noqa: ANN001
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        exported = await packages.export_item(
            user_id="package-owner",
            root_item_id=saved.item.id,
            operation_id="export-wave-for-compensation",
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
        with pytest.raises(RuntimeError, match="forced late catalog failure"):
            await packages.import_package(
                user_id="package-owner",
                archive_path=exported.path,
                operation_id="import-wave-late-failure",
                collision="cancel",
            )

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
