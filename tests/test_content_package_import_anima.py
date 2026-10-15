"""Complete package import materializes receiver authority in the file/catalog transaction."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, update

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.anima_creation_contract import CreateAnimaRequest
from animama.app.ports.content_store import LocalContentStore
from animama.app.services.anima_aggregate_materializer import AnimaAggregateMaterializer
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService
from animama.app.services.portable_anima_service import rewrite_portable_anima
from animama.domain.anima_definition import DEFAULT_ANIMA_VOICE_ID
from animama.domain.content_catalog import ContentConflictError, ContentKind, ContentSource
from animama.orm import ORMAnima, ORMModelProvider
from animama.orm.anima_chat_profile import ORMAnimaChatProfile
from animama.orm.content_catalog import ORMAnimaContentBinding
from animama.orm.settings import ORMAnimaSettings
from tests.anima_creation_service_support import anima_creation_fixture, write_json
from tests.content_package_helpers import anima_clip, reviewed_import


@asynccontextmanager
async def complete_package(session, tmp_path: Path):  # noqa: ANN001, ANN201
    """Export a configured Anima with full Reaction cells, shared image roles and portrait."""
    receiver_model = f"receiver:{uuid4().hex}"
    try:
        async with anima_creation_fixture(session, tmp_path) as fixture:
            reaction_root = fixture.paths.local_root / "reactions/joy-2"
            (reaction_root / "motion.vrma").unlink()
            write_json(
                reaction_root / "joy-2.json",
                anima_clip(clip_id="joy-2", name="joy-2"),
            )
            reaction = json.loads((reaction_root / "joy-2.meta.json").read_bytes())
            reaction["implementation"] = {"kind": "anima_clip", "file_role": "sequence"}
            reaction["files"] = [{"path": "joy-2.json", "role": "sequence"}]
            write_json(reaction_root / "joy-2.meta.json", reaction)
            picture = fixture.items["image"]
            write_json(
                fixture.paths.local_root / "appearances/picture.meta.json",
                {
                    "name": "Shared image",
                    "content_id": "local:appearance:shared",
                    "presentation": {"avatar_item_id": fixture.items["local-avatar"].id},
                },
            )
            catalog = SQLAlchemyContentCatalog(session)
            content = ContentCatalogService(catalog=catalog, store=fixture.store())
            current = {item.id: item for item in (await content.rescan(user_id=fixture.owner)).items}
            fixture.items["reaction"] = current[fixture.items["reaction"].id]
            fixture.items["image"] = picture = current[picture.id]
            request = fixture.request(actions=True).model_dump()
            for role, fit in (("profile", "contain"), ("background", "cover")):
                request["appearance"][role] = {
                    "source": {"item_id": picture.id, "revision_sha256": picture.revision_sha256},
                    "presentation": {"fit": fit, "focal_x": 0.2, "focal_y": 0.8, "zoom": 1.5},
                }
            request["expected_source_revisions"][picture.id] = {
                "kind": "appearance",
                "revision_sha256": picture.revision_sha256,
            }
            created = await fixture.service(session).create(
                user_id=fixture.owner, request=CreateAnimaRequest.model_validate(request)
            )
            config = {"loop_type": "pingpong", "loop_count": 2, "time_scale": 0.5, "blend_mode": "additive"}
            await session.execute(
                update(ORMAnimaContentBinding)
                .where(
                    ORMAnimaContentBinding.anima_id == created["anima_id"],
                    ORMAnimaContentBinding.slot_key.startswith("gesture:"),
                )
                .values(config=config)
            )
            await session.execute(
                update(ORMAnimaSettings)
                .where(ORMAnimaSettings.anima_id == created["anima_id"])
                .values(
                    preferences={
                        "speech": {"elevenlabs": {"primary_voice": {"voice_id": "SENDER_PRIVATE_VOICE"}}},
                        "private": "SENDER_PRIVATE_SETTINGS",
                    }
                )
            )
            session.add(
                ORMModelProvider(
                    id=receiver_model,
                    provider_type="test",
                    model=receiver_model,
                    active=True,
                    model_label="Receiver",
                    provider_label="Receiver",
                )
            )
            await session.commit()
            sources = AnimaPackageSourceService(
                catalog=catalog, sources=SQLAlchemyAnimaPackageSourceRepository(session)
            )
            packages = ContentPackageService(
                content=content,
                exports_root=fixture.paths.exports_staging_root,
                imports_root=fixture.paths.imports_staging_root,
                anima_sources=sources,
                uow=SQLAlchemyAnimaAggregateUnitOfWork(session),
                default_model_provider_id=receiver_model,
            )
            summary = await packages.summarize(user_id=fixture.owner, anima_id=created["anima_id"])
            review = await packages.prepare_export(
                user_id=fixture.owner, anima_id=created["anima_id"], expected_digest=summary.digest
            )
            cached = await packages.get_export(user_id=fixture.owner, export_id=review.export_id)
            command = await reviewed_import(
                packages, user_id=fixture.owner, archive_path=cached.path, operation_id="complete-anima-copy"
            )
            yield fixture, catalog, content, sources, packages, command, created["anima_id"], receiver_model
    finally:
        await session.execute(delete(ORMModelProvider).where(ORMModelProvider.id == receiver_model))
        await session.commit()


async def test_complete_anima_import_round_trips_config_empty_cells_images_and_receiver_defaults(
    async_session, tmp_path: Path
) -> None:  # noqa: ANN001
    async with complete_package(async_session, tmp_path) as (
        fixture,
        catalog,
        content,
        sources,
        packages,
        command,
        original_id,
        receiver_model,
    ):
        review = await packages.imports.review(user_id=fixture.owner, stage_id=command["stage_id"])
        assert review.kind == "anima" and review.anima is not None
        assert review.anima.display_name == "Test  Companion-2"
        # Avatar, Gesture, Reaction, shared image and the seeded Idle Gesture.
        assert (review.selected_count, review.required_count) == (5, 0)
        assert review.anima.idle.cells == {} and len(review.anima.idle.default) == 1
        result = await packages.imports.commit(**command)
        assert result.anima_id is not None and result.anima_id != original_id
        imported = await sources.capture(user_id=fixture.owner, anima_id=result.anima_id)
        expected = rewrite_portable_anima(review.anima, {item.entry_id: item.item_id for item in result.items})
        assert imported.definition == expected
        assert imported.definition.gestures[0].config["blend_mode"] == "additive"
        # The imported Anima gets exactly the packaged pool, not a fresh starter seed.
        idle_id = next(item.item_id for item in result.items if item.entry_id == review.anima.idle.default[0])
        assert imported.definition.idle.model_dump() == {"default": [idle_id], "cells": {}}
        idle_rows = await async_session.scalars(
            select(ORMAnimaContentBinding.slot_key).where(
                ORMAnimaContentBinding.anima_id == result.anima_id, ORMAnimaContentBinding.slot_key.startswith("idle:")
            )
        )
        assert list(idle_rows) == [f"idle:default:{idle_id}"]
        assert sum(value is None for cells in imported.definition.reactions.values() for value in cells.values()) == 70
        profile = await async_session.get(ORMAnimaChatProfile, result.anima_id)
        assert profile.default_model_provider_id == receiver_model
        settings = await async_session.get(ORMAnimaSettings, (fixture.owner, result.anima_id))
        assert settings.preferences["speech"]["elevenlabs"]["primary_voice"]["voice_id"] == DEFAULT_ANIMA_VOICE_ID
        assert "SENDER_PRIVATE" not in json.dumps(settings.preferences)
        avatar_id = next(item.item_id for item in result.items if item.kind is ContentKind.AVATAR)
        image_id = next(item.item_id for item in result.items if item.kind is ContentKind.APPEARANCE)
        image = await catalog.get_visible_item(item_id=image_id, user_id=fixture.owner)
        assert image.metadata["presentation"]["avatar_item_id"] == avatar_id
        assert {item.item_id for item in result.items}.isdisjoint(item.id for item in fixture.items.values())
        await content.rescan(user_id=fixture.owner)
        assert (await sources.capture(user_id=fixture.owner, anima_id=result.anima_id)).definition == expected
        assert await packages.imports.commit(**command) == result


@pytest.mark.parametrize("failure", ["children", "before_commit", "after_commit", "model_retired"])
async def test_anima_children_and_files_rollback_together_and_unknown_commit_replays(
    async_session, tmp_path: Path, monkeypatch, failure: str
) -> None:  # noqa: ANN001
    async with complete_package(async_session, tmp_path) as (
        fixture,
        catalog,
        content,
        sources,
        packages,
        command,
        original_id,
        receiver_model,
    ):
        before_items = {item.id for item in await catalog.list_visible(user_id=fixture.owner)}
        before_files = {
            path.relative_to(fixture.paths.local_root): path.read_bytes()
            for path in fixture.paths.local_root.rglob("*")
            if path.is_file()
        }
        if failure == "model_retired":
            await async_session.execute(
                update(ORMModelProvider).where(ORMModelProvider.id == receiver_model).values(active=False)
            )
            await async_session.commit()
        with monkeypatch.context() as patch:
            if failure == "children":
                original = AnimaAggregateMaterializer._write_definition

                async def fail_children(self, **kwargs):
                    await original(self, **kwargs)
                    raise RuntimeError("after Anima children")

                patch.setattr(AnimaAggregateMaterializer, "_write_definition", fail_children)
            elif failure in {"before_commit", "after_commit"}:
                original_commit = async_session.commit
                called = False

                async def fail_commit():
                    nonlocal called
                    if called:
                        return await original_commit()
                    called = True
                    if failure == "after_commit":
                        await original_commit()
                    raise RuntimeError("lost SQL reply")

                patch.setattr(async_session, "commit", fail_commit)
            if failure == "after_commit":
                result = await packages.imports.commit(**command)
                assert result.anima_id != original_id
            else:
                with pytest.raises(ContentConflictError if failure == "model_retired" else RuntimeError):
                    await packages.imports.commit(**command)
                assert set(
                    await async_session.scalars(select(ORMAnima.id).where(ORMAnima.user_id == fixture.owner))
                ) == {original_id}
                assert {item.id for item in await catalog.list_visible(user_id=fixture.owner)} == before_items
                assert {
                    path.relative_to(fixture.paths.local_root): path.read_bytes()
                    for path in fixture.paths.local_root.rglob("*")
                    if path.is_file()
                } == before_files
        if failure == "model_retired":
            return
        result = await packages.imports.commit(**command)
        assert result.anima_id is not None
        assert len(set(await async_session.scalars(select(ORMAnima.id).where(ORMAnima.user_id == fixture.owner)))) == 2


@pytest.mark.parametrize("attempt", ["fresh-review", "cached-review", "commit", "stale-committing", "stale-recovery"])
async def test_composition_denial_removes_staging_and_keeps_catalog_unchanged(
    async_session, tmp_path: Path, attempt: str
) -> None:  # noqa: ANN001
    from animama.app.services.content_package_import import ContentPackageImportService

    async with complete_package(async_session, tmp_path) as (
        fixture,
        catalog,
        content,
        _sources,
        packages,
        command,
        _original_id,
        receiver_model,
    ):
        imports = ContentPackageImportService(
            content=content,
            mutations=content.mutations,
            stages=packages.stages,
            uow=SQLAlchemyAnimaAggregateUnitOfWork(async_session),
            default_model_provider_id=receiver_model,
            allow_anima_import=False,
        )
        before_items = await catalog.list_visible(user_id=fixture.owner)
        before_files = {
            path.relative_to(fixture.paths.local_root): path.read_bytes()
            for path in fixture.paths.local_root.rglob("*")
            if path.is_file()
        }
        stage_id = command["stage_id"]
        if attempt == "fresh-review":
            with packages.stages.acquire(fixture.owner, stage_id) as lease:
                with lease.open_archive() as archive:
                    payload = archive.read()
            packages.stages.discard(fixture.owner, stage_id)
            stage = packages.stages.create_import(fixture.owner, "fresh-denied", "anima.zip", len(payload))
            stage_id = stage.stage_id
            for index, offset in enumerate(range(0, len(payload), packages.stages.limits.part_bytes)):
                packages.stages.append_part(
                    fixture.owner,
                    stage_id,
                    index,
                    BytesIO(payload[offset : offset + packages.stages.limits.part_bytes]),
                )
        with packages.stages.acquire(fixture.owner, stage_id) as lease:
            stage_directory = lease.directory
            operation_id = lease.record.operation_id
            assert operation_id is not None
            expected_bytes = lease.record.expected_bytes
            if attempt.startswith("stale-"):
                lease.set_state("committing" if attempt == "stale-committing" else "recovery_needed")
        with pytest.raises(ContentConflictError, match="package_anima_import_unavailable"):
            if attempt in {"fresh-review", "cached-review"}:
                await imports.review(user_id=fixture.owner, stage_id=stage_id)
            else:
                await imports.commit(**command)
        assert not stage_directory.exists()  # archive, metadata, expansion and reservation are gone
        assert packages.stages.find_import(fixture.owner, operation_id) is None
        assert await catalog.list_visible(user_id=fixture.owner) == before_items
        assert {
            path.relative_to(fixture.paths.local_root): path.read_bytes()
            for path in fixture.paths.local_root.rglob("*")
            if path.is_file()
        } == before_files
        assert await catalog.get_mutation_receipt(user_id=fixture.owner, operation_id=operation_id) is None
        # The existing export occupies the other slot; denial must release this
        # reservation immediately, without waiting for TTL or quota reclamation.
        replacement = packages.stages.create_import(fixture.owner, "after-denial", "next.zip", expected_bytes)
        packages.stages.discard(fixture.owner, replacement.stage_id)


@pytest.mark.parametrize("attempt", ["review", "commit"])
async def test_denial_retains_a_real_unresolved_publication_journal(
    async_session, tmp_path: Path, attempt: str
) -> None:  # noqa: ANN001
    from animama.app.services.content_package_import import ContentPackageImportService, import_request_digest

    async with complete_package(async_session, tmp_path) as (
        fixture,
        catalog,
        content,
        _sources,
        packages,
        command,
        _original_id,
        receiver_model,
    ):
        store = cast(LocalContentStore, content.mutations.store)
        request_digest = import_request_digest(command["review_digest"])
        async with catalog.mutation_transaction():
            await catalog.lock_source(source=ContentSource.LOCAL)
            journal_id = store.begin_mutation(
                user_id=fixture.owner, operation_id=command["operation_id"], request_digest=request_digest
            )
        imports = ContentPackageImportService(
            content=content,
            mutations=content.mutations,
            stages=packages.stages,
            uow=SQLAlchemyAnimaAggregateUnitOfWork(async_session),
            default_model_provider_id=receiver_model,
            allow_anima_import=False,
        )
        try:
            with pytest.raises(ContentConflictError, match="package_anima_import_unavailable"):
                if attempt == "review":
                    await imports.review(user_id=fixture.owner, stage_id=command["stage_id"])
                else:
                    await imports.commit(**command)
            with packages.stages.acquire(fixture.owner, command["stage_id"]) as lease:
                assert lease.record.state == "recovery_needed"
                assert lease.archive_path.is_file()
            assert any(journal.journal_id == journal_id for journal in store.pending_mutations())
        finally:
            store.finalize_mutation(journal_id=journal_id, commit=False, expected_request_digest=request_digest)


async def test_completed_anima_import_replays_before_policy_and_missing_stage(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    from animama.app.services.content_package_import import ContentPackageImportService

    async with complete_package(async_session, tmp_path) as (
        fixture,
        _catalog,
        content,
        _sources,
        packages,
        command,
        _original_id,
        receiver_model,
    ):
        result = await packages.imports.commit(**command)
        packages.stages.discard(fixture.owner, command["stage_id"])
        imports = ContentPackageImportService(
            content=content,
            mutations=content.mutations,
            stages=packages.stages,
            uow=SQLAlchemyAnimaAggregateUnitOfWork(async_session),
            default_model_provider_id=receiver_model,
            allow_anima_import=False,
        )
        assert await imports.commit(**command) == result
