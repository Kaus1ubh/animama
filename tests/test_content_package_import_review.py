"""Real archive, filesystem and SQL behavior at the immutable import boundary."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import delete

from animama.app.services.content_package_import import ContentPackageImportService
from animama.domain.content_catalog import ContentConflictError, ContentSource
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services, reviewed_export, reviewed_import, save_wave


async def test_import_review_is_immutable_and_copies_again_without_reusing_content(
    async_session, tmp_path: Path
) -> None:
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        export = await reviewed_export(packages, user_id="package-owner", root_item_id=saved.item.id)
        command = await reviewed_import(
            packages, user_id="package-owner", archive_path=export.path, operation_id="copy-one"
        )
        first_review = await packages.imports.review(user_id="package-owner", stage_id=command["stage_id"])
        assert first_review.items[0].name == "Friendly Wave-2"
        assert len(await catalog.list_visible(user_id="package-owner")) == 1
        first = await packages.imports.commit(**command)
        assert first.items[0].item_id != saved.item.id
        assert first.items[0].logical_key != saved.item.logical_key
        assert first.items[0].selected is True
        installed = await catalog.get_visible_item(item_id=first.items[0].item_id, user_id="package-owner")
        assert installed is not None and installed.relative_locator == "gestures/friendly-wave-2.vrma"
        sidecar = paths.local_root / "gestures/friendly-wave-2.meta.json"
        document = json.loads(sidecar.read_bytes())
        assert document["semantic_key"] == "friendly-wave"
        assert document["name"] == "Friendly Wave-2"
        assert document["content_id"] == first.items[0].logical_key
        packages.stages.discard("package-owner", command["stage_id"])
        # Retry is a receipt lookup, even after stage cleanup and result deletion.
        for file in installed.files:
            (paths.local_root / file.relative_path).unlink()
        await catalog.purge_item(item_id=installed.id)
        restarted = ContentPackageImportService(mutations=content.mutations, content=content, stages=packages.stages)
        assert await restarted.commit(**command) == first
        assert (await restarted.operation_status(user_id="package-owner", operation_id="copy-one")).result == first
        with pytest.raises(ContentConflictError, match="operation_id_reused"):
            await restarted.commit(
                user_id=command["user_id"],
                stage_id=command["stage_id"],
                operation_id=command["operation_id"],
                review_digest="0" * 64,
            )
        second_command = await reviewed_import(
            packages, user_id="package-owner", archive_path=export.path, operation_id="copy-two"
        )
        second = await packages.imports.commit(**second_command)
        assert second.items[0].item_id not in {first.items[0].item_id, saved.item.id}
        assert second.items[0].logical_key not in {first.items[0].logical_key, saved.item.logical_key}
        assert len(await catalog.list_visible(user_id="package-owner")) == 2
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


@pytest.mark.parametrize("drift", ["unregistered_file", "catalog_name", "sealed_archive"])
async def test_commit_rejects_changed_review_without_replanning(async_session, tmp_path: Path, drift: str) -> None:
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        export = await reviewed_export(packages, user_id="package-owner", root_item_id=saved.item.id)
        command = await reviewed_import(
            packages, user_id="package-owner", archive_path=export.path, operation_id="review-drift"
        )
        if drift == "unregistered_file":
            (paths.local_root / "gestures/friendly-wave-2.vrma").write_bytes(b"manual host file")
        elif drift == "catalog_name":
            sidecar = json.loads((paths.local_root / "gestures/friendly-wave.meta.json").read_bytes())
            sidecar["name"] = "Friendly Wave-2"
            (paths.local_root / "gestures/friendly-wave.meta.json").write_text(json.dumps(sidecar))
        else:
            with packages.stages.acquire("package-owner", command["stage_id"]) as lease:
                lease.archive_path.write_bytes(b"replaced archive")
        with pytest.raises(ContentConflictError, match="package_destination_changed|package_archive_changed"):
            await packages.imports.commit(**command)
        assert await catalog.get_mutation_receipt(user_id="package-owner", operation_id=command["operation_id"]) is None
        assert (
            await catalog.get_by_locator(source=ContentSource.LOCAL, relative_locator="gestures/friendly-wave-3.vrma")
            is None
        )
        if drift == "unregistered_file":
            assert (paths.local_root / "gestures/friendly-wave-2.vrma").read_bytes() == b"manual host file"
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()
