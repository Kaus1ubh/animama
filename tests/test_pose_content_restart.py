"""Pose persistence survives new database, bootstrap, session and store lifetimes.

Each case migrates an empty owned database through Alembic, without create_all.
This is an application-resource restart, not a PostgreSQL or desktop restart.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text

from animama.app.services.typed_content_service import TypedContentService
from animama.domain.content_catalog import ContentKind
from animama.local.database import LocalDatabase
from animama.server.config import Settings
from animama.server.local_installation_bootstrap import create_local_installation_bootstrap_service
from animama.server.local_runtime import initialize_local_runtime
from tests.content_package_helpers import package_services
from tests.migration_database_helpers import (
    migrated_database as migrated_database,
    migration_postgres as migration_postgres,
)


def _document(weight: float = 0.5) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "content_type": "pose",
        "content_id": "local:pose:salute",
        "name": "Salute",
        "pose": {
            "schema": "animaPose/1.0",
            "id": "local:pose:salute",
            "name": "Salute",
            "humanoid": {"hips": {"rotation": [0, 0, 0, 1]}},
            "expressions": {"happy": weight},
        },
    }


async def _bootstrap(database: LocalDatabase, settings: Settings) -> str:
    """Resolve the same installation owner through the real bootstrap factory."""
    service = create_local_installation_bootstrap_service(
        session_factory=database.session_factory(),
        paths=initialize_local_runtime(settings),
        settings=settings,
    )
    state = await service.ensure()
    assert state.content_ready
    assert state.failed_steps == ("starter_animas",)  # This isolated root has no Included starters.
    return state.principal_id


@pytest.mark.parametrize("failed_update", [False, True], ids=["saved", "rolled-back-update"])
async def test_pose_baseline_save_restart_and_failed_update_recovery(
    migrated_database: str,  # noqa: F811 - imported pytest fixture
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failed_update: bool,
) -> None:
    settings = Settings(
        animama_database_url=migrated_database,
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
    )
    first = LocalDatabase(settings)
    try:
        owner = await _bootstrap(first, settings)
        async with first.session_factory()() as session:
            assert await session.scalar(text("SELECT version_num FROM alembic_version")) == "baseline_20260908"
            paths, catalog, content, saves, _ = package_services(session, tmp_path)
            command: dict[str, Any] = {
                "user_id": owner,
                "kind": ContentKind("pose"),
                "entry_name": "Salute",
                "descriptor": json.dumps(_document()).encode(),
                "companion_files": {},
                "operation_id": "save-salute",
                "catalog_item_id": None,
                "expected_revision": None,
            }
            saved = await saves.save_descriptor(**command)
            assert saved.item.logical_key == "local:pose:salute"
            descriptor = next((paths.local_root / saved.item.relative_locator).glob("*.json"))
            original_bytes = descriptor.read_bytes()
            assert json.loads(original_bytes)["pose"] == _document()["pose"]
            update = {
                **command,
                "descriptor": json.dumps(_document(0.9)).encode(),
                "operation_id": "update-salute",
                "catalog_item_id": saved.item.id,
                "expected_revision": saved.item.revision_sha256,
            }
            if failed_update:
                record_receipt = catalog.record_mutation_receipt

                async def fail_after_publication(**kwargs: Any) -> None:
                    # Fail after disk promotion and catalog reconciliation, before commit.
                    await record_receipt(**kwargs)
                    assert json.loads(descriptor.read_bytes())["pose"]["expressions"] == {"happy": 0.9}
                    raise OSError("injected receipt-stage failure")

                with monkeypatch.context() as patch:
                    patch.setattr(catalog, "record_mutation_receipt", fail_after_publication)
                    with pytest.raises(OSError, match="injected receipt-stage failure"):
                        await saves.save_descriptor(**update)
                assert descriptor.read_bytes() == original_bytes
                assert await catalog.get_mutation_receipt(user_id=owner, operation_id="update-salute") is None
    finally:
        await first.close()

    restarted = LocalDatabase(settings)
    try:
        assert await _bootstrap(restarted, settings) == owner
        async with restarted.session_factory()() as session:
            paths, catalog, content, saves, _ = package_services(session, tmp_path)
            typed = TypedContentService(catalog=catalog, content=content)
            current = await typed.get(user_id=owner, kind=ContentKind("pose"), item_id=saved.item.id)
            assert current.item.logical_key == saved.item.logical_key
            assert current.item.owner_user_id == owner
            assert current.item.revision_sha256 == saved.item.revision_sha256
            assert current.item.metadata["pose"] == _document()["pose"]
            assert descriptor.read_bytes() == original_bytes
            assert not list(paths.operations_root.glob("mutation-*.json"))
            # The successful save receipt also remains valid in the fresh lifetime.
            assert await saves.save_descriptor(**command) == saved
            if failed_update:
                assert await catalog.get_mutation_receipt(user_id=owner, operation_id="update-salute") is None
                retried = await saves.save_descriptor(**update)
                assert retried.item.id == saved.item.id
                assert retried.item.revision_sha256 != saved.item.revision_sha256
                assert retried.item.metadata["pose"] == _document(0.9)["pose"]
                assert json.loads(descriptor.read_bytes())["pose"] == _document(0.9)["pose"]
    finally:
        await restarted.close()
