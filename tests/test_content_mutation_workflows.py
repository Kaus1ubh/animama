"""Exercise Local mutation publication through real filesystem/catalog workflows."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService
from animama.app.services.content_save_service import ContentSaveService
from animama.domain.content_catalog import CatalogContentEntry, ContentConflictError, ContentKind, ContentSource
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.orm.content_mutation import ORMContentMutationReceipt
from animama.server.local_runtime import LocalRuntimePaths
from tests.content_package_helpers import package_services, reviewed_export, reviewed_import, vrma


@dataclass
class _Workflow:
    owner: str
    session: AsyncSession
    paths: LocalRuntimePaths
    catalog: SQLAlchemyContentCatalog
    content: ContentCatalogService
    saves: ContentSaveService
    packages: ContentPackageService

    def wave_command(self, *, label: str = "original", operation: str = "original-save") -> dict[str, Any]:
        """Return the exact original command so retries do not silently refresh it."""

        return {
            "user_id": self.owner,
            "kind": ContentKind.GESTURE,
            "entry_name": "Replay Wave",
            "filename": "wave.vrma",
            "payload": vrma(label),
            "metadata_sidecar": json.dumps(
                {"schema_version": 1, "id": "local:gesture:replay-wave", "name": "Replay Wave"}
            ).encode(),
            "operation_id": operation,
            "catalog_item_id": None,
            "expected_revision": None,
        }

    def local_files(self) -> dict[str, bytes]:
        """Compare all Local bytes, including abandoned recovery artifacts."""

        return {
            path.relative_to(self.paths.local_root).as_posix(): path.read_bytes()
            for path in self.paths.local_root.rglob("*")
            if path.is_file()
        }


@pytest_asyncio.fixture
async def workflow(async_session: AsyncSession, tmp_path: Path) -> AsyncIterator[_Workflow]:
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    value = _Workflow(f"workflow-{uuid4().hex}", async_session, paths, catalog, content, saves, packages)
    try:
        yield value
    finally:
        await async_session.rollback()
        await async_session.execute(
            delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == value.owner)
        )
        await async_session.execute(
            delete(ORMContentMutationReceipt).where(ORMContentMutationReceipt.owner_user_id == value.owner)
        )
        await async_session.commit()


@pytest.mark.parametrize("later_change", ["edited", "deleted"])
async def test_save_replay_returns_original_snapshot_without_repeating_a_later_mutation(
    workflow: _Workflow, later_change: str
) -> None:
    command = workflow.wave_command()
    original = await workflow.saves.save_standalone(**command)
    destination = workflow.paths.local_root / original.item.relative_locator
    if later_change == "edited":
        changed = await workflow.saves.save_standalone(
            **{
                **workflow.wave_command(label="edited", operation="later-save"),
                "catalog_item_id": original.item.id,
                "expected_revision": original.item.revision_sha256,
            }
        )
        assert changed.item.revision_sha256 != original.item.revision_sha256
    else:
        assert original.item.revision_sha256 is not None
        await workflow.content.delete_item(
            user_id=workflow.owner, item_id=original.item.id, expected_revision=original.item.revision_sha256
        )

    before_retry = workflow.local_files()
    replayed = await workflow.saves.save_standalone(**command)

    assert replayed == original
    assert workflow.local_files() == before_retry
    current = await workflow.catalog.get_visible_item(item_id=original.item.id, user_id=workflow.owner)
    if later_change == "edited":
        assert current is not None
        assert current.revision_sha256 == changed.item.revision_sha256
        assert destination.read_bytes() == vrma("edited")
    else:
        assert current is None
        assert not destination.exists()


@pytest.mark.parametrize("changed_field", ["payload", "metadata_sidecar", "entry_name", "expected_revision"])
async def test_save_operation_id_rejects_any_changed_command_before_path_or_revision_preflight(
    workflow: _Workflow, changed_field: str
) -> None:
    command = workflow.wave_command()
    original = await workflow.saves.save_standalone(**command)
    changes = {
        "payload": vrma("different bytes"),
        "metadata_sidecar": b'{"name":"Different metadata"}',
        "entry_name": "Another Destination",
        "expected_revision": "f" * 64,
    }
    before_retry = workflow.local_files()

    with pytest.raises(ContentConflictError, match="operation_id_reused"):
        await workflow.saves.save_standalone(**{**command, changed_field: changes[changed_field]})

    assert workflow.local_files() == before_retry
    assert await workflow.catalog.get_visible_item(item_id=original.item.id, user_id=workflow.owner) == original.item


@pytest.mark.parametrize("later_change", ["edited", "deleted"])
async def test_import_replays_its_original_result_without_installing_again(
    workflow: _Workflow, later_change: str
) -> None:
    saved = await workflow.saves.save_standalone(**workflow.wave_command())
    exported = await reviewed_export(workflow.packages, user_id=workflow.owner, root_item_id=saved.item.id)
    command = await reviewed_import(
        workflow.packages, user_id=workflow.owner, archive_path=exported.path, operation_id="import-replay"
    )
    imported = await workflow.packages.imports.commit(**command)
    assert len(imported.items) == 1
    item = await workflow.catalog.get_visible_item(item_id=imported.items[0].item_id, user_id=workflow.owner)
    assert item is not None
    destination = workflow.paths.local_root / item.relative_locator
    if later_change == "edited":
        destination.write_bytes(vrma("manual edit after import"))
        await workflow.content.rescan(user_id=workflow.owner, include_included=False)
    else:
        assert item.revision_sha256 is not None
        await workflow.content.delete_item(
            user_id=workflow.owner, item_id=item.id, expected_revision=item.revision_sha256
        )
    before_retry = workflow.local_files()

    replayed = await workflow.packages.imports.commit(**command)

    assert replayed == imported
    assert workflow.local_files() == before_retry
    current = await workflow.catalog.get_visible_item(item_id=item.id, user_id=workflow.owner)
    if later_change == "edited":
        assert current is not None and current.revision_sha256 != item.revision_sha256
        assert destination.read_bytes() == vrma("manual edit after import")
    else:
        assert current is None
        assert not destination.exists()


async def _export_two_entry_package(workflow: _Workflow) -> Path:
    """Create and export an actual Idle Style with one Gesture dependency."""

    from tests.test_content_gltf import _fixture_document, _glb_source

    gltf, binary = _fixture_document(buffer_uri=None)
    wave = await workflow.saves.save_standalone(**{**workflow.wave_command(), "payload": _glb_source(gltf, binary)})
    idle = await workflow.saves.save_descriptor(
        user_id=workflow.owner,
        kind=ContentKind.IDLE_STYLE,
        entry_name="Replay Idle",
        descriptor=json.dumps(
            {
                "schema_version": 2,
                "content_type": "idle_style",
                "id": "local:idle-style:replay-idle",
                "name": "Replay Idle",
                "default_pool": [wave.item.logical_key],
                "dependencies": [{"ref": wave.item.logical_key, "content_type": "gesture"}],
                "files": [],
            }
        ).encode(),
        companion_files={},
        operation_id="save-idle",
        catalog_item_id=None,
        expected_revision=None,
    )
    exported = await reviewed_export(workflow.packages, user_id=workflow.owner, root_item_id=idle.item.id)
    assert exported.item_count == 2
    for item in (idle.item, wave.item):
        assert item.revision_sha256 is not None
        await workflow.content.delete_item(
            user_id=workflow.owner, item_id=item.id, expected_revision=item.revision_sha256
        )
    return exported.path


async def test_idle_save_rejects_unknown_bounds_without_publishing_files_or_receipt(workflow: _Workflow) -> None:
    """A finite-looking config cannot admit media that has no actual motion timeline."""
    from animama.domain.content_documents import ContentDocumentError

    wave = await workflow.saves.save_standalone(**workflow.wave_command())
    before = workflow.local_files()
    with pytest.raises(ContentDocumentError) as error:
        await workflow.saves.save_descriptor(
            user_id=workflow.owner,
            kind=ContentKind.IDLE_STYLE,
            entry_name="Unsafe Idle",
            descriptor=json.dumps(
                {
                    "schema_version": 2,
                    "content_type": "idle_style",
                    "name": "Unsafe Idle",
                    "default_pool": [wave.item.logical_key],
                    "dependencies": [{"ref": wave.item.logical_key, "content_type": "gesture"}],
                }
            ).encode(),
            companion_files={},
            operation_id="unsafe-idle-save",
            catalog_item_id=None,
            expected_revision=None,
        )
    assert error.value.code == "idle_motion_invalid"
    assert workflow.local_files() == before
    assert await workflow.catalog.get_mutation_receipt(user_id=workflow.owner, operation_id="unsafe-idle-save") is None
    assert not any(
        item.kind is ContentKind.IDLE_STYLE for item in await workflow.catalog.list_visible(user_id=workflow.owner)
    )


async def test_idle_preview_contains_finite_facts_for_its_exact_gesture_revision(workflow: _Workflow) -> None:
    from animama.app.services.typed_content_service import TypedContentService
    from animama.server.schemas.typed_content import PyTypedContentPreview
    from tests.test_content_gltf import _fixture_document, _glb_source

    gltf, binary = _fixture_document(buffer_uri=None)
    wave = await workflow.saves.save_standalone(**{**workflow.wave_command(), "payload": _glb_source(gltf, binary)})
    idle = await workflow.saves.save_descriptor(
        user_id=workflow.owner,
        kind=ContentKind.IDLE_STYLE,
        entry_name="Preview Idle",
        descriptor=json.dumps(
            {
                "schema_version": 2,
                "content_type": "idle_style",
                "name": "Preview Idle",
                "default_pool": [wave.item.logical_key],
                "dependencies": [{"ref": wave.item.logical_key, "content_type": "gesture"}],
            }
        ).encode(),
        companion_files={},
        operation_id="preview-idle-save",
        catalog_item_id=None,
        expected_revision=None,
    )
    service = TypedContentService(catalog=workflow.catalog, content=workflow.content)
    eligibility = await service.gesture_idle_playback(user_id=workflow.owner, item_id=wave.item.id)
    assert eligibility["eligible"] is True
    preview = await service.preview(user_id=workflow.owner, kind=ContentKind.IDLE_STYLE, item_id=idle.item.id)
    response = PyTypedContentPreview.from_domain(preview)
    assert wave.item.logical_key is not None
    assert response.idle_playback[wave.item.logical_key].duration_seconds == 1
    assert response.expected_source_revisions[wave.item.id].revision_sha256 == wave.item.revision_sha256


@pytest.mark.parametrize("motion_kind", ["vrma", "anima_clip"])
@pytest.mark.parametrize("finite", [True, False])
async def test_gesture_candidate_preview_carries_only_exact_finite_idle_facts(
    workflow: _Workflow, motion_kind: str, finite: bool
) -> None:
    from animama.app.services.typed_content_service import TypedContentService
    from animama.server.schemas.typed_content import PyTypedContentPreview
    from tests.test_content_gltf import _fixture_document, _glb_source

    if motion_kind == "vrma":
        gltf, binary = _fixture_document(buffer_uri=None)
        filename, role, payload = "motion.vrma", "animation", _glb_source(gltf, binary)
    else:
        filename, role = "motion.json", "sequence"
        payload = json.dumps(
            {
                "schema": "animaPoseClip/1.0",
                "id": "candidate",
                "name": "Candidate",
                "poses": {"rest": {}},
                "poseKeyframes": [{"time": 0, "pose": "rest"}],
                "duration": 1,
                "loop": True,
            }
        ).encode()
    config = {"time_scale": 0.5, "loop_type": "repeat", **({"loop_count": 3} if finite else {})}
    saved = await workflow.saves.save_descriptor(
        user_id=workflow.owner,
        kind=ContentKind.GESTURE,
        entry_name="Idle Candidate",
        descriptor=json.dumps(
            {
                "schema_version": 1,
                "content_type": "gesture",
                "content_id": "local:gesture:idle-candidate",
                "name": "Idle Candidate",
                "semantic_key": "idle-candidate",
                "implementation": {"kind": motion_kind, "file_role": role},
                "files": [{"path": filename, "role": role}],
                "config": config,
            }
        ).encode(),
        companion_files={filename: payload},
        operation_id="idle-candidate-save",
        catalog_item_id=None,
        expected_revision=None,
    )
    service = TypedContentService(catalog=workflow.catalog, content=workflow.content)
    preview = await service.preview(user_id=workflow.owner, kind=ContentKind.GESTURE, item_id=saved.item.id)
    response = PyTypedContentPreview.from_domain(preview)
    assert response.expected_source_revisions[saved.item.id].revision_sha256 == saved.item.revision_sha256
    if finite:
        assert saved.item.logical_key is not None
        facts = response.idle_playback[saved.item.logical_key]
        assert facts.eligible is True
        assert facts.time_scale == 0.5
        assert facts.repetitions == 3
        assert facts.duration_seconds == 6
    else:
        # Ordinary looping Action previews remain allowed; an Idle consumer must refuse them.
        assert response.item.kind == "gesture"
        assert response.idle_playback == {}


async def test_multi_entry_import_rolls_back_prior_provenance_and_all_files_after_late_failure(
    workflow: _Workflow, monkeypatch: pytest.MonkeyPatch
) -> None:
    package_path = await _export_two_entry_package(workflow)
    before = workflow.local_files()
    record_provenance = workflow.catalog.record_import_provenance
    admitted_ids: list[str] = []

    async def fail_second_provenance(**kwargs: Any) -> CatalogContentEntry:
        item = await record_provenance(**kwargs)
        admitted_ids.append(item.id)
        if len(admitted_ids) == 2:
            raise RuntimeError("second entry provenance failed")
        return item

    monkeypatch.setattr(workflow.catalog, "record_import_provenance", fail_second_provenance)
    command = await reviewed_import(
        workflow.packages, user_id=workflow.owner, archive_path=package_path, operation_id="two-entry-import"
    )
    with pytest.raises(RuntimeError, match="second entry provenance failed"):
        await workflow.packages.imports.commit(**command)

    assert len(admitted_ids) == 2
    assert workflow.local_files() == before
    assert await workflow.catalog.get_mutation_receipt(user_id=workflow.owner, operation_id="two-entry-import") is None
    for item_id in admitted_ids:
        assert await workflow.catalog.get_visible_item(item_id=item_id, user_id=workflow.owner) is None

    # A compensated failure leaves the exact command available for a successful retry.
    monkeypatch.setattr(workflow.catalog, "record_import_provenance", record_provenance)
    retried = await workflow.packages.imports.commit(**command)
    assert len(retried.items) == 2
    for result in retried.items:
        item = await workflow.catalog.get_visible_item(item_id=result.item_id, user_id=workflow.owner)
        assert item is not None and item.owner_user_id == workflow.owner and "import" in item.provenance


async def test_delete_catalog_failure_restores_original_files_and_registration(
    workflow: _Workflow, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = await workflow.saves.save_standalone(**workflow.wave_command())
    before = workflow.local_files()
    purge_item = workflow.catalog.purge_item

    async def fail_after_purge(*, item_id: str) -> None:
        await purge_item(item_id=item_id)
        raise RuntimeError("catalog delete failed")

    monkeypatch.setattr(workflow.catalog, "purge_item", fail_after_purge)
    assert original.item.revision_sha256 is not None
    with pytest.raises(RuntimeError, match="catalog delete failed"):
        await workflow.content.delete_item(
            user_id=workflow.owner, item_id=original.item.id, expected_revision=original.item.revision_sha256
        )

    assert workflow.local_files() == before
    assert await workflow.catalog.get_visible_item(item_id=original.item.id, user_id=workflow.owner) == original.item
    # Registered-byte delivery still works, proving the rollback restored usable content.
    animation = next(file for file in original.item.files if file.role == "animation")
    registered = await workflow.content.open_registered_file(file_ref=animation.file_ref, user_id=workflow.owner)
    try:
        assert registered.handle.read() == vrma("original")
    finally:
        registered.handle.close()


async def test_save_publication_is_invisible_and_rescan_waits_until_the_owned_commit(
    workflow: _Workflow,
    async_session_factory,  # noqa: ANN001
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before_commit = asyncio.Event()
    permit_commit = asyncio.Event()
    scanner_started = asyncio.Event()
    receipt_writer = workflow.catalog.record_mutation_receipt

    async def hold_receipt(**kwargs: Any) -> None:
        await receipt_writer(**kwargs)
        before_commit.set()
        await permit_commit.wait()

    monkeypatch.setattr(workflow.catalog, "record_mutation_receipt", hold_receipt)
    async with async_session_factory() as scan_session, async_session_factory() as observer_session:
        _, _, scanner, _, _ = package_services(scan_session, tmp_path)
        observer = SQLAlchemyContentCatalog(observer_session)

        async def competing_rescan() -> None:
            scanner_started.set()
            await scanner.rescan(user_id=workflow.owner, include_included=False)

        save_task = asyncio.create_task(workflow.saves.save_standalone(**workflow.wave_command()))
        scan_task: asyncio.Task[None] | None = None
        try:
            await asyncio.wait_for(before_commit.wait(), timeout=5)
            # Promotion has happened, but the completed owner-scoped catalog result has not.
            assert (workflow.paths.local_root / "gestures/replay-wave.vrma").read_bytes() == vrma("original")
            assert (
                await observer.get_by_locator(source=ContentSource.LOCAL, relative_locator="gestures/replay-wave.vrma")
                is None
            )
            assert await observer.get_mutation_receipt(user_id=workflow.owner, operation_id="original-save") is None

            scan_task = asyncio.create_task(competing_rescan())
            await scanner_started.wait()
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(scan_task), timeout=0.1)

            permit_commit.set()
            saved = await asyncio.wait_for(save_task, timeout=5)
            await asyncio.wait_for(scan_task, timeout=5)
            visible = await observer.get_visible_item(item_id=saved.item.id, user_id=workflow.owner)
            assert visible is not None and visible.owner_user_id == workflow.owner
            assert visible.revision_sha256 == saved.item.revision_sha256
            assert await observer.get_mutation_receipt(user_id=workflow.owner, operation_id="original-save") is not None
        finally:
            permit_commit.set()
            pending = [task for task in (save_task, scan_task) if task is not None and not task.done()]
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            await scan_session.rollback()
            await observer_session.rollback()


async def test_gesture_save_and_package_keep_layer_mutes_and_unknown_clip_fields(workflow: _Workflow) -> None:
    """Optional clip metadata is stored and packaged verbatim; the backend does not strip it."""

    sequence = json.dumps(
        {
            "schema": "animaPoseClip/1.0",
            "id": "wave-hello",
            "name": "Wave Hello",
            "poses": {"rest": {}},
            "poseKeyframes": [{"time": 0, "pose": "rest"}],
            "duration": 1,
            "mutedProceduralLayers": ["sway", "cursorLookAt"],
            "generator": {"tool": "animama-animation"},
        }
    ).encode()
    saved = await workflow.saves.save_descriptor(
        user_id=workflow.owner,
        kind=ContentKind.GESTURE,
        entry_name="Wave Hello",
        descriptor=json.dumps(
            {
                "schema_version": 1,
                "content_type": "gesture",
                "content_id": "local:gesture:wave-hello",
                "name": "Wave Hello",
                "semantic_key": "wave-hello",
                "implementation": {"kind": "anima_clip", "file_role": "sequence"},
                "files": [{"path": "wave-hello.json", "role": "sequence"}],
            }
        ).encode(),
        companion_files={"wave-hello.json": sequence},
        operation_id="wave-hello-save",
        catalog_item_id=None,
        expected_revision=None,
    )
    assert saved.item.kind is ContentKind.GESTURE
    stored = [data for path, data in workflow.local_files().items() if path.endswith("wave-hello.json")]
    assert stored == [sequence]

    # A portable package re-serializes the clip but keeps every field.
    exported = await reviewed_export(workflow.packages, user_id=workflow.owner, root_item_id=saved.item.id)
    command = await reviewed_import(
        workflow.packages, user_id=workflow.owner, archive_path=exported.path, operation_id="wave-hello-import"
    )
    imported = await workflow.packages.imports.commit(**command)
    item = await workflow.catalog.get_visible_item(item_id=imported.items[0].item_id, user_id=workflow.owner)
    assert item is not None and item.id != saved.item.id
    clips = [
        json.loads(data)
        for path, data in workflow.local_files().items()
        if path.endswith(".json") and not path.endswith(".meta.json") and b'"wave-hello"' in data
    ]
    # The original and the imported copy carry the same fields.
    assert clips == [json.loads(sequence)] * 2
