"""Receipt authority covers failures around promotion and the one SQL commit."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from sqlalchemy import delete

from animama.adapters.content_store import mutations
from animama.app.services.content_package_service import ImportedContentPackage
from animama.app.services.local_content_mutations import mutation_digest
from animama.domain.content_catalog import ContentConflictError, ContentKind
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services, reviewed_export, reviewed_import, save_wave


@pytest.mark.parametrize("failure", ["promotion", "admission", "before_commit", "after_commit"])
async def test_import_files_and_catalog_follow_one_durable_outcome(
    async_session, tmp_path: Path, monkeypatch, failure: str
) -> None:
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        exported = await reviewed_export(packages, user_id="package-owner", root_item_id=saved.item.id)
        command = await reviewed_import(
            packages, user_id="package-owner", archive_path=exported.path, operation_id="atomic-copy"
        )
        with monkeypatch.context() as patch:
            if failure == "promotion":
                original_install = content.mutations.store.install_package_atomic

                def fail_install(**kwargs):
                    original_install(**kwargs)
                    raise RuntimeError("after promotion")

                patch.setattr(content.mutations.store, "install_package_atomic", fail_install)
            elif failure == "admission":
                original_admit = catalog.record_import_provenance

                async def fail_admission(**kwargs):
                    await original_admit(**kwargs)
                    raise RuntimeError("after admission")

                patch.setattr(catalog, "record_import_provenance", fail_admission)
            else:
                original_commit = async_session.commit
                attempted = False

                async def fail_commit():
                    nonlocal attempted
                    if attempted:
                        return await original_commit()
                    attempted = True
                    if failure == "after_commit":
                        await original_commit()
                    raise RuntimeError("unknown SQL outcome")

                patch.setattr(async_session, "commit", fail_commit)
            if failure == "after_commit":
                completed = await packages.imports.commit(**command)
                assert len(completed.items) == 1
            else:
                with pytest.raises(RuntimeError):
                    await packages.imports.commit(**command)
                assert not (paths.local_root / "gestures/friendly-wave-2.vrma").exists()
                assert not (paths.local_root / "gestures/friendly-wave-2.meta.json").exists()
                assert await catalog.get_mutation_receipt(user_id="package-owner", operation_id="atomic-copy") is None
                assert {item.id for item in await catalog.list_visible(user_id="package-owner")} == {saved.item.id}
        retried = await packages.imports.commit(**command)
        assert len(retried.items) == 1
        assert (paths.local_root / "gestures/friendly-wave-2.vrma").is_file()
        assert not content.mutations.store.pending_mutations()
        assert len(await catalog.list_visible(user_id="package-owner")) == 2
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_historical_import_receipt_status_survives_retirement_and_result_deletion(
    async_session, tmp_path: Path
) -> None:
    _paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        historical = ImportedContentPackage(
            items=(replace(saved.item, kind=ContentKind.MUSIC_TRACK),), skipped_existing_item_ids=("prior-support",)
        )

        async def old_result():
            return historical

        await content.mutations.run(
            user_id="package-owner",
            operation_id="old-import",
            request_digest=mutation_digest({"command": "old-import"}),
            result_type=ImportedContentPackage,
            action=old_result,
        )
        await catalog.purge_item(item_id=saved.item.id)
        status = await packages.imports.operation_status(user_id="package-owner", operation_id="old-import")
        assert status.state == "completed" and status.result is not None
        assert status.result.schema_version == 0
        assert status.result.items[0].kind == "music_track"
        assert status.result.items[0].item_id == saved.item.id
        assert (
            await packages.imports.operation_status(user_id="other-owner", operation_id="old-import")
        ).state == "not_found"
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_lost_finalize_receipt_wins_then_restart_cleanup_preserves_later_manual_edits(
    async_session, tmp_path: Path, monkeypatch
) -> None:
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        exported = await reviewed_export(packages, user_id="package-owner", root_item_id=saved.item.id)
        command = await reviewed_import(
            packages, user_id="package-owner", archive_path=exported.path, operation_id="lost-finalize"
        )
        with monkeypatch.context() as patch:

            def unavailable_finalize(**kwargs):
                raise OSError("process died before journal cleanup")

            patch.setattr(content.mutations.store, "finalize_mutation", unavailable_finalize)
            completed = await packages.imports.commit(**command)
        status = await packages.imports.operation_status(user_id="package-owner", operation_id="lost-finalize")
        assert status.state == "completed" and status.result is not None
        assert status.result == completed
        edited = paths.local_root / "gestures/friendly-wave-2.meta.json"
        edited.write_text(edited.read_text().replace("Friendly Wave-2", "Manual edit"))
        before = edited.read_bytes()
        assert await packages.imports.commit(**command) == status.result
        _paths, _catalog, restarted, _saves, _packages = package_services(async_session, tmp_path)
        await restarted.rescan(user_id="package-owner", include_included=False)
        assert edited.read_bytes() == before
        assert not restarted.mutations.store.pending_mutations()
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


@pytest.mark.parametrize("manual_edit", [False, True])
async def test_operation_status_recovers_interrupted_uncommitted_import_without_harming_manual_edits(
    async_session, tmp_path: Path, monkeypatch, manual_edit: bool
) -> None:
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        exported = await reviewed_export(packages, user_id="package-owner", root_item_id=saved.item.id)
        command = await reviewed_import(
            packages, user_id="package-owner", archive_path=exported.path, operation_id="interrupted"
        )
        with packages.stages.acquire("package-owner", command["stage_id"]) as lease:
            lease.set_state("committing")
            assert (
                await packages.imports.operation_status(user_id="package-owner", operation_id="interrupted")
            ).state == "pending"
            lease.set_state("reviewed")
        with monkeypatch.context() as patch:
            original = content.mutations.store.install_package_atomic

            def promoted_then_lost(**kwargs):
                original(**kwargs)
                raise RuntimeError("lost process during install")

            def interrupted_cleanup(**kwargs):
                raise OSError("process stopped before compensation")

            patch.setattr(content.mutations.store, "install_package_atomic", promoted_then_lost)
            patch.setattr(content.mutations.store, "finalize_mutation", interrupted_cleanup)
            with pytest.raises(OSError):
                await packages.imports.commit(**command)
        destination = paths.local_root / "gestures/friendly-wave-2.vrma"
        assert destination.exists()
        if manual_edit:
            destination.write_bytes(b"new host-authority bytes")
        _paths, _catalog, restarted, _saves, restarted_packages = package_services(async_session, tmp_path)
        status = await restarted_packages.imports.operation_status(user_id="package-owner", operation_id="interrupted")
        if manual_edit:
            assert status.state == "recovery_needed"
            assert destination.read_bytes() == b"new host-authority bytes"
            assert restarted.mutations.store.pending_mutations()
        else:
            assert status.state == "pending"
            assert not destination.exists()
            assert not restarted.mutations.store.pending_mutations()
            result = await restarted_packages.imports.commit(**command)
            assert len(result.items) == 1
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_manual_file_wins_atomic_fresh_publication_race(async_session, tmp_path: Path, monkeypatch) -> None:
    paths, catalog, _content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        exported = await reviewed_export(packages, user_id="package-owner", root_item_id=saved.item.id)
        command = await reviewed_import(
            packages, user_id="package-owner", archive_path=exported.path, operation_id="host-race"
        )
        original_publish = mutations.publish_new
        raced = False
        manual_path = None

        def publish_after_host_file(source, destination):
            nonlocal raced, manual_path
            if not raced:
                raced = True
                manual_path = Path(destination)
                manual_path.write_bytes(b"host file created after preflight")
            return original_publish(source, destination)

        monkeypatch.setattr(mutations, "publish_new", publish_after_host_file)
        with pytest.raises(ContentConflictError, match="package_destination_changed"):
            await packages.imports.commit(**command)
        assert manual_path is not None and manual_path.read_bytes() == b"host file created after preflight"
        assert await catalog.get_mutation_receipt(user_id="package-owner", operation_id="host-race") is None
        assert len(await catalog.list_visible(user_id="package-owner")) == 1
        assert (paths.local_root / saved.item.relative_locator).exists()
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()
