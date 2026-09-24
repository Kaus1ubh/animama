"""Existing Local idle content survives conversion and repeated application lifetimes."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import delete

from animama.app.services.content_transition_service import ContentTransitionService
from animama.domain.content_catalog import ContentKind
from animama.domain.content_documents import IdleStyleDocumentV2
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services
from tests.test_content_gltf import _fixture_document, _glb_source


@pytest.fixture(autouse=True)
async def _clear_unbound_fixtures(async_session):  # noqa: ANN001, ANN202
    await async_session.execute(
        delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == "transition-owner")
    )
    await async_session.commit()
    yield
    await async_session.rollback()
    await async_session.execute(
        delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == "transition-owner")
    )
    await async_session.commit()


async def test_old_idle_lanes_become_owned_gestures_without_losing_originals(async_session, tmp_path) -> None:  # noqa: ANN001
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    descriptor = {
        "schema_version": 1,
        "content_type": "idle_style",
        "content_id": "local:idle-style:calm",
        "name": "Calm",
        "files": [{"path": "calm.vrma", "role": "animation"}],
        "animations": [
            {
                "animation_id": "calm",
                "name": "Calm motion",
                "file_ref": "calm.vrma",
                "playback": {"loop_type": "once", "duration_seconds": 2},
            }
        ],
        "default_pool": ["calm"],
        "emotion_pools": {"joy": ["calm"], "fear": []},
    }
    gltf, binary = _fixture_document(buffer_uri=None)
    original = _glb_source(gltf, binary)
    content.mutations.store.save_descriptor_entry(
        kind=ContentKind.IDLE_STYLE,
        relative_locator="idle-styles/calm",
        descriptor=json.dumps(descriptor).encode(),
        companion_files={"calm.vrma": original},
        operation_id="fixture-old-idle",
    )
    await content.rescan(user_id="transition-owner")
    before = next(
        item for item in await catalog.list_visible(user_id="transition-owner") if item.kind is ContentKind.IDLE_STYLE
    )

    # No Anima consumes this fixture. The real implementation does not need a
    # private Anima/profile to preserve an unbound editable Library item.
    class NoBindings:
        async def idle_consumers(self, **kwargs):  # noqa: ANN003, ANN202
            return ()

        async def replace_idle(self, **kwargs):  # noqa: ANN003, ANN202
            raise AssertionError("An unbound Style must not equip an Anima")

    service = ContentTransitionService(content=content, bindings=NoBindings())
    await service.convert_idle_styles(user_id="transition-owner")
    converted = await catalog.get_visible_item(item_id=before.id, user_id="transition-owner")
    assert converted is not None
    assert converted.metadata["schema_version"] == 2
    gestures = [
        item for item in await catalog.list_visible(user_id="transition-owner") if item.kind is ContentKind.GESTURE
    ]
    assert len(gestures) == 1
    gesture = gestures[0]
    assert converted.metadata["default_pool"] == [gesture.logical_key]
    assert converted.metadata["cells"]["joy"] == {
        str(level): {"mode": "pool", "gestures": [gesture.logical_key]} for level in (1, 2, 3)
    }
    assert "fear" not in converted.metadata["cells"]
    assert gesture.metadata["config"]["loop_type"] == "once"
    assert any(path.read_bytes() == original for path in paths.operations_root.rglob("*.original"))
    motion = next(file for file in gesture.files if file.role == "animation")
    assert (paths.local_root / motion.relative_path).read_bytes() == original
    after = [(item.id, item.revision_sha256) for item in await catalog.list_visible(user_id="transition-owner")]
    await service.convert_idle_styles(user_id="transition-owner")
    assert [(item.id, item.revision_sha256) for item in await catalog.list_visible(user_id="transition-owner")] == after


async def test_startup_preserves_per_anima_override_and_private_state(
    async_session,
    async_session_factory,
    tmp_path,
) -> None:  # noqa: ANN001
    from sqlalchemy import select

    from animama.orm.anima import ORMAnima
    from animama.orm.anima_loadout import ORMAnimaLoadout
    from animama.orm.content_catalog import ORMAnimaContentBinding
    from animama.server.content_startup import rescan_content_once
    from tests.typed_loadout_support import cleanup_loadout_fixture, create_loadout_fixture

    fixture = await create_loadout_fixture(async_session)
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    try:
        gltf, binary = _fixture_document(buffer_uri=None)
        descriptor = {
            "schema_version": 1,
            "content_type": "idle_style",
            "content_id": "local:idle-style:overridden",
            "name": "Overridden",
            "files": [{"path": "calm.vrma", "role": "animation"}],
            "animations": [
                {"animation_id": "calm", "name": "Calm", "file_ref": "calm.vrma", "playback": {"loop_type": "once"}}
            ],
            "default_pool": ["calm"],
            "emotion_pools": {"joy": ["calm"]},
        }
        content.mutations.store.save_descriptor_entry(
            kind=ContentKind.IDLE_STYLE,
            relative_locator="idle-styles/overridden",
            descriptor=json.dumps(descriptor).encode(),
            companion_files={"calm.vrma": _glb_source(gltf, binary)},
        )
        await content.rescan(user_id=fixture.user_id)
        source = next(
            item for item in await catalog.list_visible(user_id=fixture.user_id) if item.kind is ContentKind.IDLE_STYLE
        )
        async_session.add(
            ORMAnimaContentBinding(
                id="old-idle-binding",
                anima_id=fixture.anima_id,
                slot_key="idle-style",
                kind="idle_style",
                catalog_item_id=source.id,
                config={"pool_overrides": {"default": [], "joy": []}},
            )
        )
        await async_session.commit()
        original = await async_session.get(ORMAnima, fixture.anima_id)
        old_avatar = original.avatar_id
        old_revision = original.aggregate_revision
        await rescan_content_once(paths, owner_id=fixture.user_id, session_factory=async_session_factory)
        async_session.expire_all()
        binding = await async_session.get(ORMAnimaContentBinding, "old-idle-binding")
        assert binding.config == {}
        selected = await catalog.get_visible_item(item_id=binding.catalog_item_id, user_id=fixture.user_id)
        assert selected.id != source.id
        assert selected.metadata["schema_version"] == 2
        assert selected.metadata["default_pool"] == []
        assert selected.metadata["cells"] == {}
        root = await async_session.get(ORMAnimaLoadout, fixture.anima_id)
        assert root.revision == 2
        current = await async_session.get(ORMAnima, fixture.anima_id)
        assert current.avatar_id == old_avatar
        assert current.aggregate_revision == old_revision + 1
        assert (
            await async_session.scalars(
                select(ORMAnimaContentBinding).where(
                    ORMAnimaContentBinding.anima_id == fixture.anima_id,
                )
            )
        ).all() == [binding]
        manifests = [json.loads(path.read_text()) for path in paths.operations_root.rglob("manifest.json")]
        assert manifests[0]["bindings"][0]["config"] == {"pool_overrides": {"default": [], "joy": []}}
        selected_id = selected.id
        await rescan_content_once(paths, owner_id=fixture.user_id, session_factory=async_session_factory)
        async_session.expire_all()
        assert (await async_session.get(ORMAnimaContentBinding, "old-idle-binding")).catalog_item_id == selected_id
        assert (await async_session.get(ORMAnimaLoadout, fixture.anima_id)).revision == 2
    finally:
        await cleanup_loadout_fixture(async_session, fixture)


async def test_failed_binding_conversion_rolls_back_then_retries_without_touching_private_memory(
    async_session,
    tmp_path,
) -> None:  # noqa: ANN001
    import hashlib

    import pytest
    from sqlalchemy import delete, select

    from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
    from animama.orm.anima_loadout import ORMAnimaLoadout
    from animama.orm.content_catalog import ORMAnimaContentBinding
    from animama.orm.memory_entry import ORMMemoryEntry
    from tests.typed_loadout_support import cleanup_loadout_fixture, create_loadout_fixture

    fixture = await create_loadout_fixture(async_session)
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    try:
        gltf, binary = _fixture_document(buffer_uri=None)
        original = _glb_source(gltf, binary)
        descriptor = {
            "schema_version": 1,
            "content_type": "idle_style",
            "content_id": "local:idle-style:retry",
            "name": "Retry",
            "files": [{"path": "calm.vrma", "role": "animation"}],
            "animations": [
                {"animation_id": "calm", "name": "Calm", "file_ref": "calm.vrma", "playback": {"loop_type": "once"}}
            ],
            "default_pool": ["calm"],
        }
        content.mutations.store.save_descriptor_entry(
            kind=ContentKind.IDLE_STYLE,
            relative_locator="idle-styles/retry",
            descriptor=json.dumps(descriptor).encode(),
            companion_files={"calm.vrma": original},
        )
        await content.rescan(user_id=fixture.user_id)
        source = next(
            item for item in await catalog.list_visible(user_id=fixture.user_id) if item.kind is ContentKind.IDLE_STYLE
        )
        async_session.add(
            ORMAnimaContentBinding(
                id="retry-idle-binding",
                anima_id=fixture.anima_id,
                slot_key="idle-style",
                kind="idle_style",
                catalog_item_id=source.id,
                config={"pool_overrides": {"default": []}},
            )
        )
        private = "private fixture memory must survive conversion"
        async_session.add(
            ORMMemoryEntry(
                id="private-conversion-fixture",
                user_id=fixture.user_id,
                anima_id=fixture.anima_id,
                type="file",
                name="private.txt",
                normalized_name="private.txt",
                path="/private.txt",
                normalized_path="/private.txt",
                content=private,
                content_sha256=hashlib.sha256(private.encode()).hexdigest(),
                size_bytes=len(private),
                version=7,
            )
        )
        await async_session.commit()

        class InterruptedBindings(SQLAlchemyContentTransitionBindings):
            async def replace_idle(self, **kwargs):  # noqa: ANN003, ANN202
                await super().replace_idle(**kwargs)
                raise RuntimeError("fixture interrupted after binding write")

        with pytest.raises(RuntimeError, match="fixture interrupted"):
            await ContentTransitionService(
                content=content, bindings=InterruptedBindings(async_session)
            ).convert_idle_styles(user_id=fixture.user_id)
        assert (paths.local_root / "idle-styles/retry/calm.vrma").read_bytes() == original
        unchanged = await catalog.get_visible_item(item_id=source.id, user_id=fixture.user_id)
        assert unchanged.metadata["schema_version"] == 1
        assert (await async_session.get(ORMAnimaLoadout, fixture.anima_id, populate_existing=True)).revision == 1
        assert not content.mutations.store.pending_mutations()
        assert not [
            item for item in await catalog.list_visible(user_id=fixture.user_id) if item.kind is ContentKind.GESTURE
        ]
        # A fresh service/store lifetime consumes the same retained originals and
        # performs one conversion after the interrupted attempt was compensated.
        _, catalog, restarted, _, _ = package_services(async_session, tmp_path)
        await ContentTransitionService(
            content=restarted, bindings=SQLAlchemyContentTransitionBindings(async_session)
        ).convert_idle_styles(user_id=fixture.user_id)
        memory = await async_session.get(ORMMemoryEntry, "private-conversion-fixture", populate_existing=True)
        assert (memory.content, memory.version) == (private, 7)
        bindings = (
            await async_session.scalars(
                select(ORMAnimaContentBinding).where(ORMAnimaContentBinding.anima_id == fixture.anima_id)
            )
        ).all()
        assert len(bindings) == 1
        assert bindings[0].kind == "idle_style"
        assert bindings[0].config == {}
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.user_id == fixture.user_id))
        await cleanup_loadout_fixture(async_session, fixture)


async def test_included_conversion_preserves_mount_and_later_local_edits(async_session, tmp_path) -> None:  # noqa: ANN001
    from sqlalchemy import delete

    from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
    from animama.domain.content_catalog import ContentSource
    from animama.orm.content_catalog import ORMContentCatalogItem

    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    gltf, binary = _fixture_document(buffer_uri=None)
    original = _glb_source(gltf, binary)
    folder = paths.included_root / "idle-styles/included-calm"
    folder.mkdir(parents=True)
    document = {
        "schema_version": 1,
        "content_type": "idle_style",
        "content_id": "builtin:idle-style:test-calm",
        "name": "Included Calm",
        "provenance": {"creator": "Fixture author", "license": "CC0"},
        "files": [{"path": "calm.vrma", "role": "animation"}],
        "animations": [
            {"animation_id": "calm", "name": "Calm", "file_ref": "calm.vrma", "playback": {"loop_type": "once"}}
        ],
        "default_pool": ["calm"],
    }
    raw = json.dumps(document).encode()
    (folder / "included-calm.json").write_bytes(raw)
    (folder / "calm.vrma").write_bytes(original)
    try:
        service = ContentTransitionService(content=content, bindings=SQLAlchemyContentTransitionBindings(async_session))
        await service.convert_idle_styles(user_id="transition-owner")
        styles = [
            item
            for item in await catalog.list_visible(user_id="transition-owner")
            if item.kind is ContentKind.IDLE_STYLE and item.source is ContentSource.LOCAL
        ]
        assert len(styles) == 1
        converted = styles[0]
        assert converted.metadata["schema_version"] == 2
        # Simulate a user's ordinary edit after successful conversion.
        new = {**converted.metadata, "name": "My later edit", "default_pool": [], "cells": {}, "dependencies": []}
        content.mutations.store.save_descriptor_entry(
            kind=ContentKind.IDLE_STYLE,
            relative_locator=converted.relative_locator,
            descriptor=json.dumps(new).encode(),
            companion_files={},
        )
        await service.convert_idle_styles(user_id="transition-owner")
        preserved = await catalog.get_visible_item(item_id=converted.id, user_id="transition-owner")
        assert preserved.display_name == "My later edit"
        assert preserved.metadata["default_pool"] == []
        assert (folder / "included-calm.json").read_bytes() == raw
        assert (folder / "calm.vrma").read_bytes() == original
        assert (
            len(
                [
                    item
                    for item in await catalog.list_visible(user_id="transition-owner")
                    if item.kind is ContentKind.GESTURE
                ]
            )
            == 1
        )
    finally:
        await async_session.execute(
            delete(ORMContentCatalogItem).where(
                (ORMContentCatalogItem.owner_user_id == "transition-owner")
                | (ORMContentCatalogItem.logical_key == "builtin:idle-style:test-calm")
            )
        )
        await async_session.commit()


async def test_unbounded_legacy_style_is_preserved_with_a_repair_diagnostic(async_session, tmp_path) -> None:  # noqa: ANN001
    from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
    from animama.domain.content_catalog import ContentStatus

    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    gltf, binary = _fixture_document(buffer_uri=None)
    original = _glb_source(gltf, binary)
    descriptor = {
        "schema_version": 1,
        "content_type": "idle_style",
        "content_id": "local:idle-style:unbounded",
        "name": "Unbounded",
        "files": [{"path": "calm.vrma", "role": "animation"}],
        "animations": [
            {"animation_id": "calm", "name": "Calm", "file_ref": "calm.vrma", "playback": {"loop_type": "repeat"}}
        ],
        "default_pool": ["calm"],
    }
    content.mutations.store.save_descriptor_entry(
        kind=ContentKind.IDLE_STYLE,
        relative_locator="idle-styles/unbounded",
        descriptor=json.dumps(descriptor).encode(),
        companion_files={"calm.vrma": original},
    )
    service = ContentTransitionService(content=content, bindings=SQLAlchemyContentTransitionBindings(async_session))
    await service.convert_idle_styles(user_id="transition-owner")
    item = next(
        item
        for item in await catalog.list_visible(user_id="transition-owner")
        if item.kind is ContentKind.IDLE_STYLE and item.logical_key == descriptor["content_id"]
    )
    assert item.status is ContentStatus.INVALID
    assert item.metadata["schema_version"] == 1
    assert item.diagnostics[0].code == "idle_repetitions_invalid"
    assert (paths.local_root / "idle-styles/unbounded/calm.vrma").read_bytes() == original
    assert not content.mutations.store.pending_mutations()


@pytest.mark.parametrize("lane_speed", [1, 2])
@pytest.mark.parametrize("standalone", [False, True])
async def test_referenced_gesture_reuses_only_identical_playback_and_preserves_original(
    async_session,
    tmp_path,
    lane_speed: int,
    standalone: bool,
) -> None:  # noqa: ANN001
    from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings

    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    gltf, binary = _fixture_document(buffer_uri=None)
    motion = _glb_source(gltf, binary)
    original_document = {
        "schema_version": 1,
        "content_type": "gesture",
        "content_id": "local:gesture:authored",
        "name": "Authored wave",
        "semantic_key": "authored-wave",
        "implementation": {"kind": "vrma", "file_role": "animation"},
        "config": {"loop_type": "once", "time_scale": 1, "weight": 0.75},
        "files": [{"path": "wave.vrma", "role": "animation"}],
    }
    if standalone:
        content.mutations.store.save_standalone(
            kind=ContentKind.GESTURE,
            relative_locator="gestures/authored.vrma",
            payload=motion,
            metadata_sidecar=json.dumps({**original_document, "files": []}).encode(),
        )
    else:
        content.mutations.store.save_descriptor_entry(
            kind=ContentKind.GESTURE,
            relative_locator="gestures/authored",
            descriptor=json.dumps(original_document).encode(),
            companion_files={"wave.vrma": motion},
        )
    legacy = {
        "schema_version": 1,
        "content_type": "idle_style",
        "content_id": "local:idle-style:referenced",
        "name": "Referenced",
        "dependencies": [{"ref": "local:gesture:authored", "content_type": "gesture"}],
        "animations": [
            {
                "animation_id": "wave",
                "name": "Wave lane",
                "dependency_ref": "local:gesture:authored",
                "playback": {"time_scale": lane_speed},
            }
        ],
        "default_pool": ["wave"],
    }
    content.mutations.store.save_descriptor_entry(
        kind=ContentKind.IDLE_STYLE,
        relative_locator="idle-styles/referenced",
        descriptor=json.dumps(legacy).encode(),
        companion_files={},
    )
    await content.rescan(user_id="transition-owner")
    before = next(
        item
        for item in await catalog.list_visible(user_id="transition-owner")
        if item.logical_key == "local:gesture:authored"
    )
    original_files = {file.relative_path: (paths.local_root / file.relative_path).read_bytes() for file in before.files}
    await ContentTransitionService(
        content=content, bindings=SQLAlchemyContentTransitionBindings(async_session)
    ).convert_idle_styles(user_id="transition-owner")
    visible = await catalog.list_visible(user_id="transition-owner")
    style = next(item for item in visible if item.logical_key == legacy["content_id"])
    selected = next(item for item in visible if item.logical_key == style.metadata["default_pool"][0])
    unchanged = await catalog.get_visible_item(item_id=before.id, user_id="transition-owner")
    assert unchanged.revision_sha256 == before.revision_sha256
    assert unchanged.metadata["semantic_key"] == "authored-wave"
    assert unchanged.metadata["config"] == original_document["config"]
    assert all((paths.local_root / path).read_bytes() == data for path, data in original_files.items())
    assert (selected.id == before.id) is (lane_speed == 1)
    assert selected.metadata["semantic_key"] == "authored-wave"
    assert isinstance(original_document["config"], dict)
    assert selected.metadata["config"] == {**original_document["config"], "time_scale": lane_speed}
    assert len([item for item in visible if item.kind is ContentKind.GESTURE]) == (1 if lane_speed == 1 else 2)


async def test_direct_pose_clip_transition_owns_sequence_and_preserves_effect_sound_closure(
    async_session,
    tmp_path,
) -> None:  # noqa: ANN001
    from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
    from animama.app.services.typed_content_service import TypedContentResolutionContext, validate_idle_style

    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    store = content.mutations.store
    store.save_standalone(
        kind=ContentKind.SOUND_EFFECT,
        relative_locator="sfx/transition-bell.wav",
        payload=b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00" + b"\x00" * 32,
        metadata_sidecar=json.dumps(
            {"content_type": "sound_effect", "content_id": "local:sound:transition-bell", "name": "Bell"}
        ).encode(),
    )
    effect = {
        "content_type": "scene_effect",
        "content_id": "local:scene:transition-glow",
        "name": "Glow",
        "dependencies": [
            {
                "ref": "local:sound:transition-bell",
                "content_type": "sound_effect",
                "alias": "bell",
                "config": {"gain": 0.3},
            }
        ],
        "definition": {
            "schema": "animama/scene-effect/1",
            "kind": "background_layers",
            "solid": {"enabled": True, "color": "#ffd2e5"},
        },
    }
    store.save_descriptor_entry(
        kind=ContentKind.SCENE_EFFECT,
        relative_locator="vfx/scene/transition-glow",
        descriptor=json.dumps(effect).encode(),
        companion_files={},
    )
    clip = {
        "schema": "animaPoseClip/1.0",
        "id": "local:pose-clip:transition",
        "name": "Transition clip",
        "duration": 2,
        "loop": False,
        "poses": {},
        "poseKeyframes": [],
        "events": [
            {"id": "glow-event", "kind": "scene_vfx", "time": 0, "sceneKind": "background_layers", "presetId": "glow"}
        ],
        "dependencies": [
            {"ref": effect["content_id"], "content_type": "scene_effect", "alias": "glow", "config": {"weight": 0.6}}
        ],
    }
    clip_bytes = json.dumps(clip).encode()
    store.save_standalone(kind=ContentKind.POSE_CLIP, relative_locator="pose-clips/transition.json", payload=clip_bytes)
    legacy = {
        "schema_version": 1,
        "content_type": "idle_style",
        "content_id": "local:idle-style:clip-transition",
        "name": "Clip transition",
        "dependencies": [{"ref": clip["id"], "content_type": "pose_clip"}],
        "animations": [{"animation_id": "clip", "name": "Clip", "dependency_ref": clip["id"]}],
        "default_pool": ["clip"],
    }
    store.save_descriptor_entry(
        kind=ContentKind.IDLE_STYLE,
        relative_locator="idle-styles/clip-transition",
        descriptor=json.dumps(legacy).encode(),
        companion_files={},
    )
    await content.rescan(user_id="transition-owner")
    await ContentTransitionService(
        content=content, bindings=SQLAlchemyContentTransitionBindings(async_session)
    ).convert_idle_styles(user_id="transition-owner")
    visible = {item.id: item for item in await catalog.list_visible(user_id="transition-owner")}
    style = next(item for item in visible.values() if item.logical_key == legacy["content_id"])
    closure = TypedContentResolutionContext(visible).resolve(style.id)
    assert style.metadata["schema_version"] == 2
    gesture = next(value.item for value in closure if value.item.kind is ContentKind.GESTURE)
    assert gesture.metadata["implementation"] == {"kind": "anima_clip", "file_role": "sequence"}
    assert gesture.metadata["dependencies"] == clip["dependencies"]
    assert {value.item.kind for value in closure} == {
        ContentKind.IDLE_STYLE,
        ContentKind.GESTURE,
        ContentKind.SCENE_EFFECT,
        ContentKind.SOUND_EFFECT,
    }
    owned = next(file for file in gesture.files if file.role == "sequence")
    assert (paths.local_root / owned.relative_path).read_bytes() == clip_bytes
    assert (paths.local_root / "pose-clips/transition.json").read_bytes() == clip_bytes
    document = closure[-1].document
    assert isinstance(document, IdleStyleDocumentV2)
    facts = await validate_idle_style(document=document, visible=visible, store=store)
    assert facts[gesture.id].duration_seconds == 2
