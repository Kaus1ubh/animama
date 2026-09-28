"""Real migrations plus new database/store lifetimes protect portable Local content.

No shared db_ready/create_all fixture participates. Each case migrates an empty
owned database. Restart means disposing the application database and recreating
bootstrap, sessions, adapters and filesystem store, not a PostgreSQL crash or an
entire desktop restart.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import pytest
from sqlalchemy import text

from animama.domain.content_catalog import ContentConflictError, ContentKind, ContentNotFoundError, ContentSource
from animama.local.database import LocalDatabase
from animama.server.config import Settings
from animama.server.local_installation_bootstrap import create_local_installation_bootstrap_service
from animama.server.local_runtime import initialize_local_runtime
from tests.content_package_helpers import package_services, reviewed_export, reviewed_import, vrma
from tests.migration_database_helpers import (
    migrated_database as migrated_database,
    migration_postgres as migration_postgres,
)


def _settings(url: str, root: Path) -> Settings:
    return Settings(animama_database_url=url, animama_content_root=root / "content", animama_data_root=root / "data")


async def _bootstrap(database: LocalDatabase, settings: Settings):  # noqa: ANN202
    """Run the real factory, including defaults; empty Included has no starters."""
    service = create_local_installation_bootstrap_service(
        session_factory=database.session_factory(),
        paths=initialize_local_runtime(settings),
        settings=settings,
    )
    state = await service.ensure()
    assert state.failed_steps == ("starter_animas",)
    return state


def _command(owner: str) -> dict[str, Any]:
    return {
        "user_id": owner,
        "kind": ContentKind.GESTURE,
        "entry_name": "Restart Wave",
        "filename": "wave.vrma",
        "payload": vrma("original"),
        "metadata_sidecar": json.dumps(
            {"schema_version": 1, "id": "local:gesture:restart-wave", "name": "Restart Wave"}
        ).encode(),
        "operation_id": "save-original",
        "catalog_item_id": None,
        "expected_revision": None,
    }


def _files(root: Path) -> dict[str, bytes]:
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob("*") if path.is_file()}


@pytest.mark.parametrize("later_change", ["edited", "deleted"])
async def test_reviewed_package_replay_after_fresh_bootstrap_preserves_later_changes(
    migrated_database: str,  # noqa: F811 - imported pytest fixture
    tmp_path: Path,
    later_change: str,
) -> None:
    settings = _settings(migrated_database, tmp_path)
    first = LocalDatabase(settings)
    try:
        state = await _bootstrap(first, settings)
        assert state.content_ready
        owner = state.principal_id
        async with first.session_factory()() as session:
            assert await session.scalar(text("SELECT version_num FROM alembic_version")) == "baseline_20260908"
            paths, catalog, content, saves, packages = package_services(session, tmp_path)
            saved = await saves.save_standalone(**_command(owner))
            exported = await reviewed_export(packages, user_id=owner, root_item_id=saved.item.id)
            with ZipFile(exported.path) as archive:
                manifest = json.loads(archive.read("package.json"))
                assert manifest["schema"] == "animama-content-package/3"
                assert len(manifest["entries"]) == 1
                for entry in manifest["entries"]:
                    for file in entry["files"]:
                        payload = archive.read(file["archive_path"])
                        assert len(payload) == file["size_bytes"]
                        assert hashlib.sha256(payload).hexdigest() == file["sha256"]
            command = await reviewed_import(
                packages, user_id=owner, archive_path=exported.path, operation_id="lost-response"
            )
            imported = await packages.imports.commit(**command)
            item = await catalog.get_visible_item(item_id=imported.items[0].item_id, user_id=owner)
            assert item is not None
            assert len(imported.items) == 1 and item.id != saved.item.id
            receipt = await catalog.get_mutation_receipt(user_id=owner, operation_id="lost-response")
            assert receipt is not None
            destination = paths.local_root / item.relative_locator
            if later_change == "edited":
                destination.write_bytes(vrma("later manual edit"))
                await content.rescan(user_id=owner, include_included=False)
            else:
                await content.delete_item(user_id=owner, item_id=item.id, expected_revision=item.revision_sha256)
            before = _files(paths.local_root)
            packages.stages.discard(user_id=owner, stage_id=command["stage_id"])
    finally:
        await first.close()

    restarted = LocalDatabase(settings)
    try:
        state = await _bootstrap(restarted, settings)
        assert state.principal_id == owner and state.content_ready
        async with restarted.session_factory()() as session:
            _, catalog, content, _, packages = package_services(session, tmp_path)
            assert await packages.imports.commit(**command) == imported
            assert _files(paths.local_root) == before
            assert await catalog.get_mutation_receipt(user_id=owner, operation_id="lost-response") == receipt
            with pytest.raises(ContentConflictError, match="operation_id_reused"):
                await packages.imports.commit(**{**command, "review_digest": "f" * 64})
            outcome = await packages.imports.operation_status(user_id=owner, operation_id="lost-response")
            assert outcome.state == "completed" and outcome.result == imported
            assert _files(paths.local_root) == before
            current = await catalog.get_visible_item(item_id=item.id, user_id=owner)
            if later_change == "deleted":
                assert current is None and not destination.exists()
            else:
                assert current is not None and current.revision_sha256 != item.revision_sha256
                assert destination.read_bytes() == vrma("later manual edit")
            other = "independent-foreign-owner"
            assert await catalog.get_visible_item(item_id=saved.item.id, user_id=other) is None
            assert await catalog.get_mutation_receipt(user_id=other, operation_id="lost-response") is None
            with pytest.raises(ContentConflictError, match="package_root_invalid"):
                await reviewed_export(packages, user_id=other, root_item_id=saved.item.id)
            animation = next(file for file in saved.item.files if file.role == "animation")
            with pytest.raises(ContentNotFoundError):
                await content.open_registered_file(file_ref=animation.file_ref, user_id=other)
    finally:
        await restarted.close()


@pytest.mark.parametrize("outcome", ["uncommitted", "committed", "manual_edit", "wrong_receipt"])
async def test_fresh_bootstrap_resolves_journal_from_durable_receipt_or_fences_recovery(
    migrated_database: str,  # noqa: F811 - imported pytest fixture
    tmp_path: Path,
    outcome: str,
) -> None:
    settings = _settings(migrated_database, tmp_path)
    first = LocalDatabase(settings)
    try:
        state = await _bootstrap(first, settings)
        owner = state.principal_id
        async with first.session_factory()() as session:
            paths, catalog, content, saves, _ = package_services(session, tmp_path)
            saved = await saves.save_standalone(**_command(owner))
            store = content.mutations.store
            destination = paths.local_root / saved.item.relative_locator
            store.begin_mutation(operation_id="interrupted", user_id=owner, request_digest="a" * 64)
            store.save_standalone(
                kind=ContentKind.GESTURE,
                relative_locator=saved.item.relative_locator,
                payload=vrma("interrupted"),
                operation_id="interrupted",
            )
            if outcome in {"committed", "wrong_receipt"}:
                async with catalog.mutation_transaction():
                    if outcome == "committed":
                        from animama.domain.content_catalog import ContentScope

                        await catalog.reconcile_source(
                            source=ContentSource.LOCAL,
                            entries=store.scan(ContentSource.LOCAL),
                            new_item_scope=ContentScope.OWNER,
                            new_item_owner_user_id=owner,
                        )
                    await catalog.record_mutation_receipt(
                        user_id=owner,
                        operation_id="interrupted",
                        request_digest=("a" if outcome == "committed" else "b") * 64,
                        result={"value": {"item_id": saved.item.id}},
                    )
            if outcome == "manual_edit":
                destination.write_bytes(vrma("manual change"))
            assert list(paths.operations_root.glob("mutation-*.json"))
    finally:
        await first.close()

    restarted = LocalDatabase(settings)
    try:
        state = await _bootstrap(restarted, settings)
        assert state.principal_id == owner
        blocked = outcome in {"manual_edit", "wrong_receipt"}
        assert state.content_ready is not blocked
        expected = (
            "manual change"
            if outcome == "manual_edit"
            else "interrupted"
            if outcome in {"committed", "wrong_receipt"}
            else "original"
        )
        assert destination.read_bytes() == vrma(expected)
        async with restarted.session_factory()() as session:
            _, catalog, content, _, _ = package_services(session, tmp_path)
            current = await catalog.get_visible_item(item_id=saved.item.id, user_id=owner)
            assert current is not None
            animation = next(file for file in current.files if file.role == "animation")
            assert (
                animation.sha256
                == hashlib.sha256(vrma("interrupted" if outcome == "committed" else "original")).hexdigest()
            )
            if blocked:
                assert list(paths.operations_root.glob("mutation-*.json"))
                assert any(
                    path.read_bytes() == vrma("original")
                    for path in paths.local_root.glob(".animama-mutations/*/*.original")
                )
                # Another fresh service must not admit the unreviewed bytes.
                with pytest.raises(ContentConflictError):
                    await content.rescan(user_id=owner, include_included=False)
            else:
                assert not list(paths.operations_root.glob("mutation-*.json"))
                assert not list(paths.local_root.glob(".animama-mutations/*/*.original"))
    finally:
        await restarted.close()
