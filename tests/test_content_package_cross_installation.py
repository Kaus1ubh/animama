"""Original package bytes cross independent databases, owners and Local roots."""

from __future__ import annotations

import hashlib
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from io import BytesIO
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, Mock
from uuid import uuid4
from zipfile import ZipFile

import pytest
from PIL import Image
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.anima_aggregate_materializer import AnimaAggregateMaterializer
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService, ImportedContentPackage
from animama.app.services.local_content_mutations import mutation_digest
from animama.app.services.portable_anima_service import rewrite_portable_anima
from animama.domain.anima_creation import (
    ResolvedAnimaSpec,
    ResolvedAppearanceSelection,
    ResolvedGestureSelection,
    ResolvedReactionSelection,
)
from animama.domain.anima_definition import ANIMA_MEMORIES_TEMPLATE, DEFAULT_ANIMA_VOICE_ID
from animama.domain.content_catalog import CatalogContentEntry, ContentKind, ContentSource, ContentStatus
from animama.domain.emotions import TRACKED_EMOTIONS
from animama.orm import ORMAnima, ORMAnimaSettings, ORMChat, ORMChatMessage, ORMMemoryEntry, ORMMemoryEntryVersion
from animama.orm.anima_chat_profile import ORMAnimaChatProfile
from animama.orm.model_provider import ORMModelProvider
from animama.server.config import Settings
from animama.server.local_runtime import LocalRuntimePaths, initialize_local_runtime
from tests.anima_creation_service_support import anima_creation_fixture, vrm, write_file, write_json
from tests.content_package_helpers import reviewed_import
from tests.migration_database_helpers import migrated_database, migration_postgres  # noqa: F401
from tests.test_content_gltf import _fixture_document, _glb_source


@dataclass
class _Installation:
    session: AsyncSession
    owner: str
    provider: str
    paths: LocalRuntimePaths
    catalog: SQLAlchemyContentCatalog
    content: ContentCatalogService
    packages: ContentPackageService
    sources: AnimaPackageSourceService
    items: dict[str, CatalogContentEntry]


def _installation(session: AsyncSession, owner: str, provider: str, paths: LocalRuntimePaths) -> _Installation:
    """Use ordinary service composition, including its real mutation journals."""
    catalog = SQLAlchemyContentCatalog(session)
    content = ContentCatalogService(
        catalog=catalog,
        store=FilesystemContentStore(
            included_root=paths.included_root, local_root=paths.local_root, operations_root=paths.operations_root
        ),
    )
    sources = AnimaPackageSourceService(catalog=catalog, sources=SQLAlchemyAnimaPackageSourceRepository(session))
    packages = ContentPackageService(
        content=content,
        imports_root=paths.imports_staging_root,
        exports_root=paths.exports_staging_root,
        anima_sources=sources,
        uow=SQLAlchemyAnimaAggregateUnitOfWork(session),
        default_model_provider_id=provider,
    )
    return _Installation(session, owner, provider, paths, catalog, content, packages, sources, {})


def _image(color: str, size: tuple[int, int]) -> bytes:
    """Distinct original images make slot/portrait aliasing observable."""
    with Image.new("RGB", size, color) as image, BytesIO() as output:
        image.save(output, "PNG")
        return output.getvalue()


@asynccontextmanager
async def _sender(session: AsyncSession, root: Path) -> AsyncIterator[_Installation]:
    async with anima_creation_fixture(session, root) as fixture:
        await fixture.add_action_support(session)
        local = fixture.paths.local_root
        # The existing generic fixture puts its owner in the VRM generator text.
        # Original portable asset bytes must not themselves contain privacy sentinels.
        write_file(local / "avatars/local-avatar.vrm", vrm("Original cross-installation avatar"))
        gltf, binary = _fixture_document(buffer_uri=None)
        write_file(local / "gestures/wave/motion.vrma", _glb_source(gltf, binary))
        clip = {
            "schema": "animaPoseClip/1.0",
            "id": "nod",
            "name": "Nod",
            "duration": 1,
            "poses": {"turn": {"humanoid": {"head": {"rotationEulerDegrees": [0, 15, 0]}}}},
            "poseKeyframes": [{"time": 0, "pose": "turn"}],
            "events": [{"id": "tone", "time": 0, "kind": "sfx", "cueId": "chime"}],
        }
        for kind, name in (("gesture", "nod"), ("reaction", "joy-2")):
            directory = local / f"{kind}s/{name}"
            (directory / "motion.vrma").unlink(missing_ok=True)
            write_json(directory / f"{name}.json", clip)
            write_json(
                directory / f"{name}.meta.json",
                {
                    "schema_version": 1,
                    "content_type": kind,
                    "content_id": f"local:{kind}:{name}",
                    "name": name,
                    **(
                        {"semantic_key": name}
                        if kind == "gesture"
                        else {"placement_hint": {"emotion": "joy", "intensity": 2}}
                    ),
                    "implementation": {"kind": "anima_clip", "file_role": "sequence"},
                    "files": [{"path": f"{name}.json", "role": "sequence"}],
                    "dependencies": [
                        {"ref": "local:sound-effect:chime", "alias": "chime", "content_type": "sound_effect"}
                    ],
                },
            )
        write_json(
            local / "idle-styles/calm/calm.json",
            {
                "schema_version": 2,
                "content_type": "idle_style",
                "content_id": "local:idle-style:calm",
                "name": "Calm",
                "default_pool": ["local:gesture:wave"],
                "cells": {"joy": {"1": {"mode": "none"}, "2": {"mode": "pool", "gestures": ["local:gesture:nod"]}}},
                "dependencies": [
                    {"ref": f"local:gesture:{name}", "content_type": "gesture"} for name in ("wave", "nod")
                ],
            },
        )
        for name, color, size in (
            ("profile", "red", (40, 32)),
            ("background", "blue", (64, 40)),
            ("portrait", "green", (512, 512)),
        ):
            write_file(local / f"appearances/{name}.png", _image(color, size))
            write_json(
                local / f"appearances/{name}.meta.json",
                {
                    "name": name,
                    "content_id": f"local:appearance:{name}",
                    **(
                        {"presentation": {"avatar_item_id": fixture.items["local-avatar"].id}}
                        if name == "portrait"
                        else {}
                    ),
                },
            )
        sender = _installation(session, fixture.owner, fixture.provider, fixture.paths)
        scanned = await sender.content.rescan(user_id=sender.owner)
        assert all(item.status is ContentStatus.VALID for item in scanned.items)
        sender.items = {item.logical_key: item for item in scanned.items if item.logical_key is not None}
        sender.items["avatar"] = next(
            item for item in scanned.items if item.relative_locator == "avatars/local-avatar.vrm"
        )
        yield sender


@asynccontextmanager
async def _receiver(url: str, root: Path) -> AsyncIterator[tuple[_Installation, async_sessionmaker[AsyncSession]]]:
    engine = create_async_engine(url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            owner = str(
                (
                    await session.execute(text("SELECT installation_principal_id FROM installation_settings"))
                ).scalar_one()
            )
            provider = "receiver-" + uuid4().hex
            session.add(
                ORMModelProvider(
                    id=provider,
                    provider_type="test",
                    model=provider,
                    active=True,
                    model_label="Receiver",
                    provider_label="Fixture",
                )
            )
            await session.commit()
            paths = initialize_local_runtime(
                Settings(animama_content_root=root / "content", animama_data_root=root / "data")
            )
            yield _installation(session, owner, provider, paths), factory
    finally:
        await engine.dispose()


def _tree(root: Path) -> dict[str, bytes]:
    return {str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()}


@pytest.mark.parametrize("selection", ["gesture", "overlap", "idle_style", "avatar"])
async def test_content_packages_cross_installations_without_equipping(
    async_session: AsyncSession,
    migrated_database: str,  # noqa: F811 - imported pytest fixture
    tmp_path: Path,
    selection: str,
) -> None:
    async with (
        _sender(async_session, tmp_path / "sender") as sender,
        _receiver(migrated_database, tmp_path / "receiver") as (receiver, _factory),
    ):
        assert sender.owner != receiver.owner and sender.paths.local_root != receiver.paths.local_root
        assert await sender.session.scalar(text("SELECT current_database()")) != await receiver.session.scalar(
            text("SELECT current_database()")
        )
        keys = {
            "gesture": ("local:gesture:wave",),
            "overlap": ("local:gesture:wave", "local:gesture:nod"),
            "idle_style": ("local:idle-style:calm",),
            "avatar": ("avatar",),
        }[selection]
        roots = tuple(sender.items[key].id for key in keys)
        before = _tree(sender.paths.local_root)
        summary = await sender.packages.summarize(user_id=sender.owner, item_ids=roots)
        review = await sender.packages.prepare_export(
            user_id=sender.owner, item_ids=roots, expected_digest=summary.digest
        )
        archive = await sender.packages.get_export(user_id=sender.owner, export_id=review.export_id)
        command = await reviewed_import(
            receiver.packages, user_id=receiver.owner, archive_path=archive.path, operation_id="transfer-" + selection
        )
        result = await receiver.packages.imports.commit(**command)
        assert result.anima_id is None
        assert sum(item.selected for item in result.items) == len(roots)
        expected_counts = {"gesture": 2, "overlap": 3, "idle_style": 4, "avatar": 2}
        assert len(result.items) == len(review.manifest.entries) == expected_counts[selection]
        entries = {entry.package_entry_id: entry for entry in review.manifest.entries}
        mapping = {item.entry_id: item.item_id for item in result.items}
        for item in result.items:
            installed = await receiver.catalog.get_visible_item(item_id=item.item_id, user_id=receiver.owner)
            assert installed is not None and installed.source is ContentSource.LOCAL
            assert installed.owner_user_id == receiver.owner and installed.status is ContentStatus.VALID
            assert installed.id not in {entry.id for entry in sender.items.values()}
            assert set(installed.dependency_item_ids) == {
                mapping[edge.ref] for edge in entries[item.entry_id].dependencies
            }
        if selection == "avatar":
            portrait = review.manifest.avatar_portraits[0]
            installed = await receiver.catalog.get_visible_item(
                item_id=mapping[portrait.appearance_entry_id], user_id=receiver.owner
            )
            assert installed is not None
            assert installed.metadata["presentation"]["avatar_item_id"] == mapping[portrait.avatar_entry_id]
        assert (
            await receiver.session.scalar(
                select(func.count()).select_from(ORMAnima).where(ORMAnima.user_id == receiver.owner)
            )
            == 0
        )
        assert _tree(sender.paths.local_root) == before


async def _create_anima(sender: _Installation) -> str:
    items = sender.items
    spec = ResolvedAnimaSpec(
        display_name="Portable companion",
        identity="# Portable identity\nKeep every line.\n",
        avatar=items["avatar"],
        idle_style=items["local:idle-style:calm"],
        gestures=(
            ResolvedGestureSelection(
                items["local:gesture:wave"], {"loop_type": "pingpong", "loop_count": 2, "time_scale": 0.5}
            ),
        ),
        reactions=tuple(
            ResolvedReactionSelection(
                emotion, intensity, items["local:reaction:joy-2"] if (emotion, intensity) == ("joy", 2) else None
            )
            for emotion in sorted(TRACKED_EMOTIONS)
            for intensity in (1, 2, 3)
        ),
        profile=ResolvedAppearanceSelection(
            items["local:appearance:profile"], {"fit": "contain", "focal_x": 0.2, "focal_y": 0.8, "zoom": 1.5}
        ),
        background=ResolvedAppearanceSelection(
            items["local:appearance:background"], {"fit": "cover", "focal_x": 0.7, "focal_y": 0.3, "zoom": 2}
        ),
    )
    anima = await AnimaAggregateMaterializer(default_model_provider_id=sender.provider).materialize(
        user_id=sender.owner, spec=spec, uow=SQLAlchemyAnimaAggregateUnitOfWork(sender.session)
    )
    await sender.session.commit()
    return anima.id


async def _private_sentinels(installation: _Installation, anima_id: str, prefix: str) -> None:
    session = installation.session
    session.add(ORMChat(id=prefix, user_id=installation.owner, anima_id=anima_id, title=prefix + "_CHAT"))
    await session.flush()
    session.add(ORMChatMessage(chat_id=prefix, role="user", content=prefix + "_MESSAGE", turn=1))
    old_identity = prefix + "_OLD_IDENTITY"
    await session.execute(
        update(ORMMemoryEntryVersion)
        .where(ORMMemoryEntryVersion.anima_id == anima_id)
        .values(
            content=old_identity,
            content_sha256=hashlib.sha256(old_identity.encode()).hexdigest(),
            size_bytes=len(old_identity),
        )
    )
    memories = prefix + "_MEMORIES"
    await session.execute(
        update(ORMMemoryEntry)
        .where(ORMMemoryEntry.anima_id == anima_id, ORMMemoryEntry.normalized_path == "memories.md")
        .values(
            content=memories,
            content_sha256=hashlib.sha256(memories.encode()).hexdigest(),
            size_bytes=len(memories),
        )
    )
    await session.execute(
        update(ORMAnimaSettings)
        .where(ORMAnimaSettings.anima_id == anima_id)
        .values(
            preferences={
                "private": prefix + "_CREDENTIAL",
                "speech": {"elevenlabs": {"primary_voice": {"voice_id": prefix + "_VOICE"}}},
            }
        )
    )
    await session.commit()
    write_file(installation.paths.operations_root / (prefix + ".txt"), (prefix + "_ATTACHMENT").encode())


async def _private_snapshot(installation: _Installation, anima_id: str) -> dict[str, Any]:
    """Read stored rows, not cached ORM objects, after the operation under test."""
    result: dict[str, Any] = {}
    for name, table, column in (
        ("anima", ORMAnima.__table__, ORMAnima.id),
        ("settings", ORMAnimaSettings.__table__, ORMAnimaSettings.anima_id),
        ("memory", ORMMemoryEntry.__table__, ORMMemoryEntry.anima_id),
        ("history", ORMMemoryEntryVersion.__table__, ORMMemoryEntryVersion.anima_id),
        ("chats", ORMChat.__table__, ORMChat.anima_id),
    ):
        result[name] = [
            dict(row)
            for row in (await installation.session.execute(select(table).where(column == anima_id))).mappings()
        ]
    result["messages"] = [
        dict(row)
        for row in (
            await installation.session.execute(
                select(ORMChatMessage.__table__).where(
                    ORMChatMessage.chat_id.in_(select(ORMChat.id).where(ORMChat.anima_id == anima_id))
                )
            )
        ).mappings()
    ]
    return result


@pytest.mark.parametrize("existing", [False, True], ids=["fresh", "existing-with-history"])
async def test_full_anima_transfer_preserves_images_privacy_copy_isolation_and_restart(
    async_session: AsyncSession,
    migrated_database: str,  # noqa: F811 - imported pytest fixture
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    existing: bool,
) -> None:
    async with (
        _sender(async_session, tmp_path / "sender") as sender,
        _receiver(migrated_database, tmp_path / "receiver") as (receiver, factory),
    ):
        assert sender.owner != receiver.owner and sender.paths.local_root != receiver.paths.local_root
        assert await sender.session.scalar(text("SELECT current_database()")) != await receiver.session.scalar(
            text("SELECT current_database()")
        )
        source_id = await _create_anima(sender)
        await _private_sentinels(sender, source_id, "SENDER_PRIVATE")
        source_private = await _private_snapshot(sender, source_id)
        source_bytes = _tree(sender.paths.local_root)
        summary = await sender.packages.summarize(user_id=sender.owner, anima_id=source_id)
        export = await sender.packages.prepare_export(
            user_id=sender.owner, anima_id=source_id, expected_digest=summary.digest
        )
        cached = await sender.packages.get_export(user_id=sender.owner, export_id=export.export_id)
        with ZipFile(cached.path) as archive:
            for member in archive.infolist():
                payload = archive.read(member)
                assert all(
                    marker.encode() not in payload
                    for marker in ("SENDER_PRIVATE", sender.owner, sender.provider, source_id)
                )

        model = Mock(side_effect=AssertionError("Import must not construct a model provider"))
        voice = Mock(side_effect=AssertionError("Import must not construct a voice provider"))
        runtime = AsyncMock(side_effect=AssertionError("Import must not issue runtime"))
        monkeypatch.setattr("animama.server.model_clients.get_model_client_registry", model)
        monkeypatch.setattr("animama.server.elevenlabs_service.get_elevenlabs_client", voice)
        monkeypatch.setattr("animama.server.elevenlabs_service.validate_elevenlabs_voice_profile", voice)
        monkeypatch.setattr("animama.app.services.anima_runtime_service.AnimaRuntimeService.issue", runtime)
        existing_id = None
        existing_private = None
        legacy_status = None
        if existing:
            seed = await reviewed_import(
                receiver.packages, user_id=receiver.owner, archive_path=cached.path, operation_id="existing-companion"
            )
            seeded = await receiver.packages.imports.commit(**seed)
            assert seeded.anima_id is not None
            existing_id = seeded.anima_id
            receiver.packages.stages.discard(receiver.owner, seed["stage_id"])
            await _private_sentinels(receiver, existing_id, "RECEIVER_PRIVATE")
            existing_private = await _private_snapshot(receiver, existing_id)
            item = await receiver.catalog.get_visible_item(item_id=seeded.items[0].item_id, user_id=receiver.owner)
            assert item is not None
            historical = ImportedContentPackage(
                items=(replace(item, kind=ContentKind.MUSIC_TRACK),), skipped_existing_item_ids=()
            )

            async def historical_result() -> ImportedContentPackage:
                return historical

            await receiver.content.mutations.run(
                user_id=receiver.owner,
                operation_id="historical-package",
                request_digest=mutation_digest({"historical": True}),
                result_type=ImportedContentPackage,
                action=historical_result,
            )
            legacy_status = await receiver.packages.imports.operation_status(
                user_id=receiver.owner, operation_id="historical-package"
            )

        first_command = await reviewed_import(
            receiver.packages, user_id=receiver.owner, archive_path=cached.path, operation_id="first-transfer"
        )
        reviewed = await receiver.packages.imports.review(user_id=receiver.owner, stage_id=first_command["stage_id"])
        first = await receiver.packages.imports.commit(**first_command)
        assert first.anima_id is not None and first.anima_id not in {source_id, existing_id}
        receiver.packages.stages.discard(receiver.owner, first_command["stage_id"])
        captured = await receiver.sources.capture(user_id=receiver.owner, anima_id=first.anima_id)
        assert reviewed.anima is not None
        assert reviewed.anima.display_name == ("Portable companion-2" if existing else "Portable companion")
        assert all(item.name == item.original_name + ("-2" if existing else "") for item in reviewed.items)
        assert captured.definition == rewrite_portable_anima(
            reviewed.anima, {item.entry_id: item.item_id for item in first.items}
        )
        assert captured.definition.idle_style is not None
        assert sum(value is None for cells in captured.definition.reactions.values() for value in cells.values()) == 71
        assert captured.definition.gestures[0].config == {"loop_type": "pingpong", "loop_count": 2, "time_scale": 0.5}
        assert [gesture.semantic_key for gesture in captured.definition.gestures] == ["wave"]
        anima = await receiver.session.get(ORMAnima, first.anima_id)
        assert anima is not None and anima.user_id == receiver.owner and anima.aggregate_revision == 1
        profile = await receiver.session.get(ORMAnimaChatProfile, first.anima_id)
        settings = await receiver.session.get(ORMAnimaSettings, (receiver.owner, first.anima_id))
        assert profile is not None and profile.default_model_provider_id == receiver.provider
        assert (
            settings is not None
            and settings.preferences["speech"]["elevenlabs"]["primary_voice"]["voice_id"] == DEFAULT_ANIMA_VOICE_ID
        )
        assert (
            await receiver.session.scalar(
                select(func.count()).select_from(ORMChat).where(ORMChat.anima_id == first.anima_id)
            )
            == 0
        )
        assert "SENDER_PRIVATE" not in json.dumps(settings.preferences)
        memory_history = (
            await receiver.session.scalars(
                select(ORMMemoryEntryVersion).where(ORMMemoryEntryVersion.anima_id == first.anima_id)
            )
        ).all()
        assert len(memory_history) == 2 and all(entry.version == 1 for entry in memory_history)
        assert {entry.path: entry.content for entry in memory_history} == {
            "IDENTITY.md": reviewed.anima.identity_markdown,
            "MEMORIES.md": ANIMA_MEMORIES_TEMPLATE,
        }
        memories = await receiver.session.scalar(
            select(ORMMemoryEntry).where(
                ORMMemoryEntry.anima_id == first.anima_id, ORMMemoryEntry.normalized_path == "memories.md"
            )
        )
        assert memories is not None and memories.content == ANIMA_MEMORIES_TEMPLATE and memories.version == 1
        image_hashes: set[str] = set()
        entry_names = {item.package_entry_id: item.display_name for item in export.manifest.entries}
        for result_item in first.items:
            if result_item.kind is ContentKind.APPEARANCE:
                item = await receiver.catalog.get_visible_item(item_id=result_item.item_id, user_id=receiver.owner)
                assert item is not None
                image_hash = next(file.sha256 for file in item.files if file.role == "image")
                original_image = sender.paths.local_root / f"appearances/{entry_names[result_item.entry_id]}.png"
                assert image_hash == hashlib.sha256(original_image.read_bytes()).hexdigest()
                image_hashes.add(image_hash)
        assert len(image_hashes) == 3
        portrait = export.manifest.avatar_portraits[0]
        installed_ids = {item.entry_id: item.item_id for item in first.items}
        portrait_item = await receiver.catalog.get_visible_item(
            item_id=installed_ids[portrait.appearance_entry_id], user_id=receiver.owner
        )
        assert portrait_item is not None
        assert portrait_item.metadata["presentation"]["avatar_item_id"] == installed_ids[portrait.avatar_entry_id]
        first_bytes = _tree(receiver.paths.local_root)
        second_command = await reviewed_import(
            receiver.packages, user_id=receiver.owner, archive_path=cached.path, operation_id="second-transfer"
        )
        with monkeypatch.context() as patch:
            if existing:

                def lose_finalization(**kwargs: Any) -> None:
                    raise OSError("fixture process stopped after receipt commit")

                patch.setattr(receiver.content.mutations.store, "finalize_mutation", lose_finalization)
            second = await receiver.packages.imports.commit(**second_command)
        if existing:
            assert receiver.content.mutations.store.pending_mutations()
        assert second.anima_id not in {first.anima_id, source_id, existing_id}
        assert {item.item_id for item in first.items}.isdisjoint(item.item_id for item in second.items)
        receiver.packages.stages.discard(receiver.owner, second_command["stage_id"])
        sound_id = next(item.item_id for item in second.items if item.kind is ContentKind.SOUND_EFFECT)
        sound = await receiver.catalog.get_visible_item(item_id=sound_id, user_id=receiver.owner)
        assert sound is not None
        sound_path = receiver.paths.local_root / next(
            file.relative_path for file in sound.files if file.role == "audio"
        )
        original_sound = sound_path.read_bytes()
        # Change PCM data while retaining a valid WAV structure; only this copy's users may change.
        sound_path.write_bytes(original_sound[:-2] + b"\x02\x00")
        async with factory() as restarted_session:
            restarted = _installation(restarted_session, receiver.owner, receiver.provider, receiver.paths)
            await restarted.content.rescan(user_id=receiver.owner)
            assert await restarted.packages.imports.commit(**first_command) == first
            assert await restarted.packages.imports.commit(**second_command) == second
            assert not restarted.content.mutations.store.pending_mutations()
            assert sound_path.read_bytes() == original_sound[:-2] + b"\x02\x00"
            changed = await restarted.catalog.get_visible_item(item_id=sound_id, user_id=receiver.owner)
            assert (
                changed is not None
                and changed.status is ContentStatus.VALID
                and changed.revision_sha256 != sound.revision_sha256
            )
            assert all(
                (receiver.paths.local_root / name).read_bytes() == payload for name, payload in first_bytes.items()
            )
            assert (
                await restarted.sources.capture(user_id=receiver.owner, anima_id=first.anima_id)
            ).definition == captured.definition
            if existing_id:
                assert await _private_snapshot(restarted, existing_id) == existing_private
                assert (
                    receiver.paths.operations_root / "RECEIVER_PRIVATE.txt"
                ).read_bytes() == b"RECEIVER_PRIVATE_ATTACHMENT"
                assert (
                    await restarted.packages.imports.operation_status(
                        user_id=receiver.owner, operation_id="historical-package"
                    )
                    == legacy_status
                )
        assert _tree(sender.paths.local_root) == source_bytes
        assert await _private_snapshot(sender, source_id) == source_private
        assert (sender.paths.operations_root / "SENDER_PRIVATE.txt").read_bytes() == b"SENDER_PRIVATE_ATTACHMENT"
        model.assert_not_called()
        voice.assert_not_called()
        runtime.assert_not_called()
