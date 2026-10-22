"""Music retirement preserves exact private equipment evidence and original audio."""

from __future__ import annotations

import hashlib
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
from animama.app.ports.content_store import LocalContentStore
from animama.app.ports.content_transition import MusicTransitionAnima
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.music_retirement_service import MusicRetirementService
from animama.domain.content_catalog import ContentConflictError
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMAnimaContentBinding
from animama.orm.memory_entry import ORMMemoryEntry
from animama.server.local_runtime import LocalRuntimePaths
from tests.content_package_helpers import package_services
from tests.typed_loadout_support import LoadoutFixture, add_typed_item, cleanup_loadout_fixture, create_loadout_fixture


@dataclass
class _RetirementFixture:
    owner: LoadoutFixture
    paths: LocalRuntimePaths
    content: ContentCatalogService
    audio: Path
    identity_id: str
    gesture_binding_id: str
    music_ids: tuple[str, ...]


@pytest_asyncio.fixture
async def retired_music(async_session: AsyncSession, tmp_path: Path) -> AsyncIterator[_RetirementFixture]:
    owner = await create_loadout_fixture(async_session)
    paths, _, content, _, _ = package_services(async_session, tmp_path)
    audio = paths.local_root / "music/original.wav"
    audio.parent.mkdir(parents=True, exist_ok=True)
    audio.write_bytes(b"original owner audio stays byte-for-byte unchanged")
    music_ids = []
    for index in range(2):
        track = await add_typed_item(
            async_session,
            owner,
            kind="music_track",
            name=f"Original Music {index}",
            metadata={"duration_seconds": 30, "codec": "audio/wav"},
        )
        if index == 1:
            track.status = "missing"
        binding_id = f"music-{owner.suffix}-{index}"
        music_ids.append(binding_id)
        async_session.add(
            ORMAnimaContentBinding(
                id=binding_id,
                anima_id=owner.anima_id,
                slot_key=f"music:{index}",
                kind="music_track",
                catalog_item_id=track.id,
                config={
                    "enabled": index == 0,
                    "autoplay": index == 0,
                    "loop_override": False,
                    "gain_override": 0.35,
                    "legacy": {"retain": ["all", "fields"]},
                },
            )
        )
    gesture = await add_typed_item(async_session, owner, kind="gesture", name="Keep Gesture", metadata={})
    gesture_binding_id = f"gesture-{owner.suffix}"
    async_session.add(
        ORMAnimaContentBinding(
            id=gesture_binding_id,
            anima_id=owner.anima_id,
            slot_key="gesture:keep",
            kind="gesture",
            catalog_item_id=gesture.id,
            config={"time_scale": 0.7},
        )
    )
    identity_id = f"identity-{owner.suffix}"
    identity = "Reviewed companion identity must survive retirement."
    async_session.add(
        ORMMemoryEntry(
            id=identity_id,
            user_id=owner.user_id,
            anima_id=owner.anima_id,
            type="file",
            name="identity.md",
            normalized_name="identity.md",
            path="identity.md",
            normalized_path="identity.md",
            content=identity,
            content_sha256=hashlib.sha256(identity.encode()).hexdigest(),
            size_bytes=len(identity),
            version=9,
        )
    )
    anima = await async_session.get(ORMAnima, owner.anima_id)
    assert anima is not None
    anima.identity_status = "ready"
    anima.display_name = "Keep My Name"
    anima.metadata_ = {"private": "preserve"}
    root = await async_session.get(ORMAnimaLoadout, owner.anima_id)
    assert root is not None
    root.starter_catalog_version = 3
    await async_session.commit()
    try:
        yield _RetirementFixture(owner, paths, content, audio, identity_id, gesture_binding_id, tuple(music_ids))
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.user_id == owner.user_id))
        await cleanup_loadout_fixture(async_session, owner)


async def test_music_retirement_preserves_evidence_audio_identity_and_other_equipment(
    async_session: AsyncSession,
    retired_music: _RetirementFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = retired_music
    service = MusicRetirementService(
        content=fixture.content, bindings=SQLAlchemyContentTransitionBindings(async_session)
    )

    def no_audio_read(**kwargs: object) -> None:
        raise AssertionError("Retirement must not depend on original audio availability")

    monkeypatch.setattr(fixture.content.mutations.store, "open_verified_file", no_audio_read)
    results = await service.retire(user_id=fixture.owner.user_id)
    music = (
        await async_session.scalars(
            select(ORMAnimaContentBinding).where(
                ORMAnimaContentBinding.anima_id == fixture.owner.anima_id,
                ORMAnimaContentBinding.kind == "music_track",
            )
        )
    ).all()
    assert music == []
    assert len(results) == 1
    assert results[0].removed_binding_ids == fixture.music_ids
    root = await async_session.get(ORMAnimaLoadout, fixture.owner.anima_id, populate_existing=True)
    anima = await async_session.get(ORMAnima, fixture.owner.anima_id, populate_existing=True)
    assert root is not None and anima is not None
    assert (root.revision, anima.aggregate_revision) == (2, 2)
    assert root.starter_catalog_version == 3
    assert (anima.display_name, anima.avatar_id, anima.metadata_, anima.identity_status) == (
        "Keep My Name",
        fixture.owner.avatar_id,
        {"private": "preserve"},
        "ready",
    )
    identity = await async_session.get(ORMMemoryEntry, fixture.identity_id, populate_existing=True)
    assert identity is not None and identity.version == 9
    assert identity.content == "Reviewed companion identity must survive retirement."
    other = await async_session.get(ORMAnimaContentBinding, fixture.gesture_binding_id, populate_existing=True)
    assert other is not None and other.config == {"time_scale": 0.7}
    assert fixture.audio.read_bytes() == b"original owner audio stays byte-for-byte unchanged"
    manifests = list(fixture.paths.operations_root.rglob("manifest.json"))
    assert len(manifests) == 1
    preserved = json.loads(manifests[0].read_text())
    assert preserved["files"] == []
    before = preserved["bindings"][0]
    assert before["starter_catalog_version"] == 3
    assert [row["binding_id"] for row in before["bindings"]] == list(fixture.music_ids)
    assert before["bindings"][0]["config"]["legacy"] == {"retain": ["all", "fields"]}
    assert await service.retire(user_id=fixture.owner.user_id) == ()
    await async_session.refresh(root)
    await async_session.refresh(anima)
    assert (root.revision, anima.aggregate_revision) == (2, 2)
    assert list(fixture.paths.operations_root.rglob("manifest.json")) == manifests


async def test_failed_music_removal_rolls_back_then_a_new_service_reuses_preserved_facts(
    async_session: AsyncSession,
    retired_music: _RetirementFixture,
    tmp_path: Path,
) -> None:
    fixture = retired_music
    bindings = SQLAlchemyContentTransitionBindings(async_session)
    before = await bindings.music_consumers(user_id=fixture.owner.user_id)

    class InterruptedBindings(SQLAlchemyContentTransitionBindings):
        async def remove_music(self, *, user_id: str, before: MusicTransitionAnima) -> None:
            await super().remove_music(user_id=user_id, before=before)
            raise RuntimeError("interrupted after removal")

    with pytest.raises(RuntimeError, match="interrupted after removal"):
        await MusicRetirementService(content=fixture.content, bindings=InterruptedBindings(async_session)).retire(
            user_id=fixture.owner.user_id,
        )
    assert await bindings.music_consumers(user_id=fixture.owner.user_id) == before
    manifests = {path: path.read_bytes() for path in fixture.paths.operations_root.rglob("manifest.json")}
    assert len(manifests) == 1
    assert not cast(LocalContentStore, fixture.content.mutations.store).pending_mutations()
    _, _, restarted, _, _ = package_services(async_session, tmp_path)
    results = await MusicRetirementService(content=restarted, bindings=bindings).retire(user_id=fixture.owner.user_id)
    assert len(results) == 1
    assert {path: path.read_bytes() for path in fixture.paths.operations_root.rglob("manifest.json")} == manifests
    assert await bindings.music_consumers(user_id=fixture.owner.user_id) == ()


async def test_restart_finalizes_committed_retirement_without_new_revisions(
    async_session: AsyncSession,
    retired_music: _RetirementFixture,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = retired_music
    bindings = SQLAlchemyContentTransitionBindings(async_session)

    def interrupted_finalize(**kwargs: object) -> None:
        raise RuntimeError("process stopped before journal cleanup")

    monkeypatch.setattr(fixture.content.mutations.store, "finalize_mutation", interrupted_finalize)
    with pytest.raises(RuntimeError, match="process stopped"):
        await MusicRetirementService(content=fixture.content, bindings=bindings).retire(user_id=fixture.owner.user_id)
    assert await bindings.music_consumers(user_id=fixture.owner.user_id) == ()
    assert len(cast(LocalContentStore, fixture.content.mutations.store).pending_mutations()) == 1
    _, _, restarted, _, _ = package_services(async_session, tmp_path)
    assert (
        await MusicRetirementService(content=restarted, bindings=bindings).retire(user_id=fixture.owner.user_id) == ()
    )
    assert not cast(LocalContentStore, restarted.mutations.store).pending_mutations()
    root = await async_session.get(ORMAnimaLoadout, fixture.owner.anima_id, populate_existing=True)
    anima = await async_session.get(ORMAnima, fixture.owner.anima_id, populate_existing=True)
    assert root is not None and anima is not None
    assert (root.revision, anima.aggregate_revision) == (2, 2)


async def test_retirement_receipt_replays_before_rechecking_deleted_bindings(
    async_session: AsyncSession,
    retired_music: _RetirementFixture,
) -> None:
    fixture = retired_music
    bindings = SQLAlchemyContentTransitionBindings(async_session)
    before = await bindings.music_consumers(user_id=fixture.owner.user_id)
    first = await MusicRetirementService(content=fixture.content, bindings=bindings).retire(
        user_id=fixture.owner.user_id
    )

    class RetriedBindings(SQLAlchemyContentTransitionBindings):
        async def music_consumers(self, *, user_id: str) -> tuple[MusicTransitionAnima, ...]:
            return before

        async def remove_music(self, *, user_id: str, before: MusicTransitionAnima) -> None:
            raise AssertionError("Completed retirement must replay before touching bindings")

    replay = await MusicRetirementService(content=fixture.content, bindings=RetriedBindings(async_session)).retire(
        user_id=fixture.owner.user_id,
    )
    assert replay == first


@pytest.mark.parametrize("field", ["config", "starter_catalog_version", "loadout_revision"])
async def test_music_removal_rechecks_exact_binding_and_starter_facts(
    async_session: AsyncSession,
    retired_music: _RetirementFixture,
    field: str,
) -> None:
    fixture = retired_music
    bindings = SQLAlchemyContentTransitionBindings(async_session)
    before = (await bindings.music_consumers(user_id=fixture.owner.user_id))[0]
    if field == "config":
        row = await async_session.get(ORMAnimaContentBinding, fixture.music_ids[0])
        assert row is not None
        row.config = {"gain_override": 0.75}
    else:
        root = await async_session.get(ORMAnimaLoadout, fixture.owner.anima_id)
        assert root is not None
        if field == "starter_catalog_version":
            root.starter_catalog_version = 1
        else:
            root.revision += 1
    await async_session.commit()
    with pytest.raises(ContentConflictError, match="content_transition_loadout_changed"):
        await bindings.remove_music(user_id=fixture.owner.user_id, before=before)
    await async_session.rollback()
    after = (await bindings.music_consumers(user_id=fixture.owner.user_id))[0]
    assert len(after.bindings) == 2
    assert after.aggregate_revision == before.aggregate_revision


async def test_other_owner_retirement_cannot_remove_music(
    async_session: AsyncSession,
    retired_music: _RetirementFixture,
) -> None:
    fixture = retired_music
    bindings = SQLAlchemyContentTransitionBindings(async_session)
    assert await MusicRetirementService(content=fixture.content, bindings=bindings).retire(user_id="other-owner") == ()
    assert len((await bindings.music_consumers(user_id=fixture.owner.user_id))[0].bindings) == 2
    assert not list(fixture.paths.operations_root.rglob("manifest.json"))
