"""Legacy Action clip references become owned motion without losing user data."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import delete

from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
from animama.app.services.content_transition_service import ContentTransitionService
from animama.domain.content_catalog import ContentKind
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services


@pytest.fixture(autouse=True)
async def _cleanup(async_session):  # noqa: ANN001, ANN202
    yield
    await async_session.rollback()
    await async_session.execute(
        delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == "action-transition-owner")
    )
    await async_session.commit()


def _write_fixture(content):  # noqa: ANN001, ANN202
    store = content.mutations.store
    sound = "local:sound:transition-pop"
    store.save_standalone(
        kind=ContentKind.SOUND_EFFECT,
        relative_locator="sfx/pop.wav",
        payload=b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00" + b"\x00" * 32,
        metadata_sidecar=json.dumps({"content_type": "sound_effect", "content_id": sound, "name": "Pop"}).encode(),
    )
    clip = {
        "schema": "animaPoseClip/1.0",
        "id": "local:pose-clip:shared",
        "name": "Shared clip",
        "duration": 3,
        "loop": True,
        "poses": {},
        "poseKeyframes": [],
        "events": [{"id": "pop", "kind": "sfx", "time": 1, "cueId": "pop", "volume": 0.4}],
        "dependencies": [{"ref": sound, "content_type": "sound_effect", "alias": "pop", "config": {"gain": 0.7}}],
    }
    raw = json.dumps(clip).encode()
    store.save_standalone(kind=ContentKind.POSE_CLIP, relative_locator="pose-clips/shared.json", payload=raw)
    for kind in (ContentKind.GESTURE, ContentKind.REACTION):
        document = {
            "schema_version": 1,
            "content_type": kind.value,
            "content_id": f"local:{kind.value}:owned",
            "name": f"Owned {kind.value}",
            "description": "Keep the authored Action identity",
            "implementation": {
                "kind": "anima_clip",
                "technical_source": {"type": "content_dependency", "ref": clip["id"]},
            },
            "config": {"time_scale": 0.75, "weight": 0.8},
            "dependencies": [{"ref": clip["id"], "content_type": "pose_clip"}],
        }
        if kind is ContentKind.GESTURE:
            document["semantic_key"] = "authored-selector"
        else:
            document["placement_hint"] = {"emotion": "joy", "intensity": 2}
        store.save_descriptor_entry(
            kind=kind,
            relative_locator=f"{kind.value}s/owned",
            descriptor=json.dumps(document).encode(),
            companion_files={},
        )
    return raw, clip


async def test_shared_clip_becomes_two_owned_sequences_with_identity_events_and_originals_preserved(
    async_session, tmp_path
) -> None:  # noqa: ANN001
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    raw, clip = _write_fixture(content)
    await content.rescan(user_id="action-transition-owner")
    before = {
        item.kind: item
        for item in await catalog.list_visible(user_id="action-transition-owner")
        if item.kind in {ContentKind.GESTURE, ContentKind.REACTION}
    }
    service = ContentTransitionService(content=content, bindings=SQLAlchemyContentTransitionBindings(async_session))
    await service.transition(user_id="action-transition-owner")
    for kind, original in before.items():
        after = await catalog.get_visible_item(item_id=original.id, user_id="action-transition-owner")
        assert after.metadata["implementation"] == {"kind": "anima_clip", "file_role": "sequence"}
        assert after.metadata["config"] == original.metadata["config"]
        assert after.logical_key == original.logical_key
        assert after.relative_locator == original.relative_locator
        assert after.metadata["dependencies"] == clip["dependencies"]
        if kind is ContentKind.GESTURE:
            assert after.metadata["semantic_key"] == "authored-selector"
        else:
            assert after.metadata["placement_hint"] == {"emotion": "joy", "intensity": 2}
        sequence = next(file for file in after.files if file.role == "sequence")
        assert (paths.local_root / sequence.relative_path).read_bytes() == raw
        assert ContentKind.POSE_CLIP.value not in json.dumps(after.metadata)
    assert (paths.local_root / "pose-clips/shared.json").read_bytes() == raw
    assert any(path.read_bytes() == raw for path in paths.operations_root.rglob("*.original"))
    original_ids = {value.id for value in before.values()}
    await service.transition(user_id="action-transition-owner")
    assert {
        value.id for value in await catalog.list_visible(user_id="action-transition-owner") if value.kind in before
    } == original_ids
    assert all(
        item.kind is not ContentKind.POSE_CLIP for item in await content.list_visible(user_id="action-transition-owner")
    )


async def test_alias_collision_is_rewritten_only_in_the_owned_clip(async_session, tmp_path) -> None:  # noqa: ANN001
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    raw, _ = _write_fixture(content)
    store = content.mutations.store
    store.save_standalone(
        kind=ContentKind.SOUND_EFFECT,
        relative_locator="sfx/other.wav",
        payload=b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00" + b"\x00" * 32,
        metadata_sidecar=json.dumps(
            {"content_type": "sound_effect", "content_id": "local:sound:other", "name": "Other"}
        ).encode(),
    )
    path = paths.local_root / "gestures/owned/owned.meta.json"
    document = json.loads(path.read_bytes())
    document["dependencies"].append({"ref": "local:sound:other", "content_type": "sound_effect", "alias": "pop"})
    path.write_text(json.dumps(document))
    await ContentTransitionService(
        content=content, bindings=SQLAlchemyContentTransitionBindings(async_session)
    ).transition(user_id="action-transition-owner")
    gesture = next(
        item
        for item in await catalog.list_visible(user_id="action-transition-owner")
        if item.kind is ContentKind.GESTURE
    )
    by_ref = {edge["ref"]: edge for edge in gesture.metadata["dependencies"]}
    assert by_ref["local:sound:other"]["alias"] == "pop"
    assert by_ref["local:sound:transition-pop"]["alias"] == "clip-pop"
    sequence = next(file for file in gesture.files if file.role == "sequence")
    owned = json.loads((paths.local_root / sequence.relative_path).read_bytes())
    assert owned["events"] == [{"id": "pop", "kind": "sfx", "time": 1, "cueId": "clip-pop", "volume": 0.4}]
    assert (paths.local_root / "pose-clips/shared.json").read_bytes() == raw


async def test_interrupted_publication_rolls_back_and_restart_preserves_later_edits(
    async_session, tmp_path, monkeypatch
) -> None:  # noqa: ANN001
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    raw, _ = _write_fixture(content)
    descriptor_path = paths.local_root / "gestures/owned/owned.meta.json"
    original = descriptor_path.read_bytes()
    publish = content.mutations.store.save_descriptor_entry_streams

    def interrupted(**kwargs):  # noqa: ANN003, ANN202
        publish(**kwargs)
        raise RuntimeError("interrupt after publication")

    monkeypatch.setattr(content.mutations.store, "save_descriptor_entry_streams", interrupted)
    service = ContentTransitionService(content=content, bindings=SQLAlchemyContentTransitionBindings(async_session))
    with pytest.raises(RuntimeError, match="interrupt after publication"):
        await service.transition(user_id="action-transition-owner")
    assert descriptor_path.read_bytes() == original
    assert not list(descriptor_path.parent.glob("owned-clip-*.json"))
    assert not content.mutations.store.pending_mutations()
    # A fresh service/store lifetime reads the same evidence and creates exactly
    # the two original Action identities; subsequent edits are not replayed over.
    _, catalog, restarted, _, _ = package_services(async_session, tmp_path)
    restarted_service = ContentTransitionService(
        content=restarted, bindings=SQLAlchemyContentTransitionBindings(async_session)
    )
    await restarted_service.transition(user_id="action-transition-owner")
    edited = json.loads(descriptor_path.read_bytes())
    edited["name"] = "My later edit"
    edited["config"]["time_scale"] = 2
    descriptor_path.write_text(json.dumps(edited))
    await restarted_service.transition(user_id="action-transition-owner")
    gesture = next(
        item
        for item in await catalog.list_visible(user_id="action-transition-owner")
        if item.kind is ContentKind.GESTURE
    )
    assert gesture.display_name == "My later edit"
    assert gesture.metadata["config"]["time_scale"] == 2
    assert (
        len(
            [
                item
                for item in await catalog.list_visible(user_id="action-transition-owner")
                if item.kind is ContentKind.GESTURE
            ]
        )
        == 1
    )
    assert (paths.local_root / "pose-clips/shared.json").read_bytes() == raw


async def test_ambiguous_support_settings_preserve_the_source_and_report_repair(async_session, tmp_path) -> None:  # noqa: ANN001
    from animama.domain.content_catalog import ContentStatus

    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    raw, _ = _write_fixture(content)
    path = paths.local_root / "gestures/owned/owned.meta.json"
    document = json.loads(path.read_bytes())
    document["dependencies"].append(
        {"ref": "local:sound:transition-pop", "content_type": "sound_effect", "alias": "pop", "config": {"gain": 0.2}}
    )
    original = json.dumps(document).encode()
    path.write_bytes(original)
    service = ContentTransitionService(content=content, bindings=SQLAlchemyContentTransitionBindings(async_session))
    for _ in range(2):
        await service.transition(user_id="action-transition-owner")
        gesture = next(
            item
            for item in await catalog.list_visible(user_id="action-transition-owner")
            if item.kind is ContentKind.GESTURE
        )
        assert gesture.status is ContentStatus.INVALID
        assert gesture.diagnostics[0].code == "action_clip_transition_dependency_conflict"
        assert path.read_bytes() == original
        assert (paths.local_root / "pose-clips/shared.json").read_bytes() == raw
        assert not content.mutations.store.pending_mutations()


async def test_malformed_legacy_events_are_diagnosed_without_aborting_scan(async_session, tmp_path) -> None:  # noqa: ANN001
    from animama.domain.content_catalog import ContentStatus

    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    _, clip = _write_fixture(content)
    clip["events"] = ["malformed"]
    raw = json.dumps(clip).encode()
    (paths.local_root / "pose-clips/shared.json").write_bytes(raw)
    descriptor = paths.local_root / "gestures/owned/owned.meta.json"
    action = json.loads(descriptor.read_bytes())
    action["dependencies"].append({**clip["dependencies"][0], "alias": "root-pop"})
    original = json.dumps(action).encode()
    descriptor.write_bytes(original)
    await ContentTransitionService(
        content=content, bindings=SQLAlchemyContentTransitionBindings(async_session)
    ).transition(user_id="action-transition-owner")
    gesture = next(
        item
        for item in await catalog.list_visible(user_id="action-transition-owner")
        if item.kind is ContentKind.GESTURE
    )
    assert gesture.status is ContentStatus.INVALID
    assert gesture.diagnostics[0].code == "action_clip_transition_events_invalid"
    assert "Action" in gesture.diagnostics[0].message
    assert descriptor.read_bytes() == original
    assert (paths.local_root / "pose-clips/shared.json").read_bytes() == raw


async def test_old_unused_sequence_cannot_replace_converted_active_motion(async_session, tmp_path) -> None:  # noqa: ANN001
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    raw, clip = _write_fixture(content)
    descriptor = paths.local_root / "gestures/owned/owned.meta.json"
    action = json.loads(descriptor.read_bytes())
    action["files"] = [{"path": "aaa-stale.json", "role": "sequence"}]
    descriptor.write_text(json.dumps(action))
    stale = json.dumps({**clip, "duration": 100, "name": "Unused old clip"}).encode()
    (descriptor.parent / "aaa-stale.json").write_bytes(stale)
    await ContentTransitionService(
        content=content, bindings=SQLAlchemyContentTransitionBindings(async_session)
    ).transition(user_id="action-transition-owner")
    gesture = next(
        item
        for item in await catalog.list_visible(user_id="action-transition-owner")
        if item.kind is ContentKind.GESTURE
    )
    selected = [file for file in gesture.files if file.role == gesture.metadata["implementation"]["file_role"]]
    assert len(selected) == 1
    assert (paths.local_root / selected[0].relative_path).read_bytes() == raw
    assert (descriptor.parent / "aaa-stale.json").read_bytes() == stale
