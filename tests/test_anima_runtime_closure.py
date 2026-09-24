from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import replace
from io import BytesIO

import pytest

from animama.app.services.runtime_content_closure import RuntimeContentClosureCompiler
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentIntegrityError,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
    VerifiedContentFile,
)
from animama.domain.runtime_content_descriptor import RuntimeContentRootSelection


@pytest.mark.asyncio
@pytest.mark.parametrize("gesture_ref", ["local:gesture:breathe", "gestures/breathe"])
async def test_idle_gesture_closure_is_finite_and_separate_from_ai_gestures(gesture_ref: str) -> None:
    from animama.app.services.typed_runtime_projection import project_typed_runtime_catalog

    clip = json.dumps(
        {
            "schema": "animaPoseClip/1.0",
            "id": "breathe",
            "name": "Breathe",
            "duration": 3,
            "poses": {"rest": {}},
            "poseKeyframes": [{"time": 0, "pose": "rest"}],
        }
    ).encode()
    motion = replace(_file("breathe", "breathe.json", hashlib.sha256(clip).hexdigest(), len(clip)), role="sequence")
    gesture = replace(
        _entry("breathe", files=(motion,)),
        logical_key="local:gesture:breathe",
        metadata={
            "schema_version": 1,
            "content_type": "gesture",
            "name": "Breathe",
            "semantic_key": "breathe",
            "implementation": {"kind": "anima_clip", "file_role": "sequence"},
            "config": {"time_scale": 2},
        },
    )
    style = replace(
        _entry("quiet", kind=ContentKind.IDLE_STYLE, dependencies=(gesture.id,)),
        logical_key="local:idle:quiet",
        dependencies=(gesture_ref,),
        metadata={
            "schema_version": 2,
            "content_type": "idle_style",
            "name": "Quiet",
            "dependencies": [{"ref": gesture_ref, "content_type": "gesture"}],
            "default_pool": [gesture_ref],
            "cells": {"joy": {"2": {"mode": "none"}}},
        },
    )

    class Store(_Store):
        def open_verified_file(self, **facts):  # noqa: ANN003, ANN202
            return VerifiedContentFile(BytesIO(clip), len(clip), facts["expected_sha256"], facts["media_type"])

    catalog = _Catalog([style, gesture])
    descriptor = await RuntimeContentClosureCompiler(catalog=catalog, store=Store()).compile(  # type: ignore[arg-type]
        user_id="owner",
        loadout_revision=1,
        selections=(RuntimeContentRootSelection("idle-style", style.id, style.kind),),
    )
    runtime = project_typed_runtime_catalog(loadout_revision=1, descriptor=descriptor, visible=catalog.entries)
    assert runtime["gestures"] == []
    assert runtime["idle_style"]["default_pool"] == [gesture.id]
    nested = runtime["idle_style"]["gestures"][0]
    assert nested["binding_id"] == f"idle:{gesture.id}"
    assert nested["runtime_root_id"] == descriptor.roots[0].root_id
    assert nested["idle_playback"]["duration_seconds"] == 1.5
    assert runtime["idle_style"]["cells"] == {"joy": {"2": {"mode": "none"}}}

    invalid = replace(gesture, metadata={**gesture.metadata, "config": {"loop": True}})
    catalog.entries = [style, invalid]
    rejected = await RuntimeContentClosureCompiler(catalog=catalog, store=Store()).compile(  # type: ignore[arg-type]
        user_id="owner",
        loadout_revision=2,
        selections=(RuntimeContentRootSelection("idle-style", style.id, style.kind),),
    )
    assert rejected.roots == ()
    assert rejected.diagnostics[0].code == "idle_repetitions_invalid"


def _id(value: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://animama.test/runtime/{value}"))


def _file(item_id: str, name: str, digest: str, size: int = 4) -> CatalogContentFile:
    return CatalogContentFile(
        file_ref=f"catalog-{name}",
        item_id=_id(item_id),
        source=ContentSource.LOCAL,
        relative_path=f"gestures/{name}",
        role="primary",
        media_type="application/octet-stream",
        size_bytes=size,
        sha256=digest,
    )


def _entry(
    item_id: str,
    *,
    kind: ContentKind = ContentKind.GESTURE,
    files: tuple[CatalogContentFile, ...] = (),
    dependencies: tuple[str, ...] = (),
    status: ContentStatus = ContentStatus.VALID,
) -> CatalogContentEntry:
    return CatalogContentEntry(
        id=_id(item_id),
        source=ContentSource.LOCAL,
        scope=ContentScope.OWNER,
        owner_user_id="owner",
        kind=kind,
        relative_locator=f"gestures/{item_id}",
        display_name=item_id,
        status=status,
        revision_sha256=hashlib.sha256(item_id.encode()).hexdigest() if status is ContentStatus.VALID else None,
        files=files,
        dependency_item_ids=dependencies,
    )


class _Catalog:
    def __init__(self, entries: list[CatalogContentEntry]) -> None:
        self.entries = entries
        self.invalidations: list[tuple[ContentSource, tuple[str, ...]]] = []

    async def list_visible(self, *, user_id: str):  # noqa: ANN202
        assert user_id == "owner"
        return self.entries

    async def mark_scan_required(self, *, source, relative_paths):  # noqa: ANN001, ANN202
        self.invalidations.append((source, relative_paths))


class _Store:
    def __init__(self, changed_paths: set[str] | None = None) -> None:
        self.changed_paths = changed_paths or set()

    def open_verified_file(self, **facts):  # noqa: ANN003, ANN202
        if facts["relative_path"] in self.changed_paths:
            raise ContentIntegrityError("changed")
        return VerifiedContentFile(
            BytesIO(b"data"),
            facts["expected_size_bytes"],
            facts["expected_sha256"],
            facts["media_type"],
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("sound_ref", ["local:sound:bell", "gestures/bell"])
async def test_idle_gestures_preserve_distinct_authored_config_for_the_same_sound(sound_ref: str) -> None:
    from animama.app.services.typed_runtime_projection import project_typed_runtime_catalog

    clip = json.dumps(
        {
            "schema": "animaPoseClip/1.0",
            "id": "breathe",
            "name": "Breathe",
            "duration": 1,
            "poses": {"rest": {}},
            "poseKeyframes": [{"time": 0, "pose": "rest"}],
        }
    ).encode()
    sound = replace(
        _entry("bell", kind=ContentKind.SOUND_EFFECT, files=(_file("bell", "bell.wav", "a" * 64),)),
        logical_key="local:sound:bell",
        metadata={"content_type": "sound_effect", "name": "Bell"},
    )
    gestures = []
    assert sound.logical_key is not None
    for name, gain in (("quiet", 0.2), ("loud", 0.8)):
        gestures.append(
            replace(
                _entry(
                    name,
                    files=(replace(_file(name, f"{name}.json", "b" * 64, len(clip)), role="sequence"),),
                    dependencies=(sound.id,),
                ),
                logical_key=f"local:gesture:{name}",
                dependencies=(sound_ref,),
                metadata={
                    "content_type": "gesture",
                    "name": name,
                    "semantic_key": name,
                    "implementation": {"kind": "anima_clip", "file_role": "sequence"},
                    "dependencies": [
                        {
                            "ref": sound_ref,
                            "content_type": "sound_effect",
                            "alias": "bell",
                            "config": {"gain": gain},
                        }
                    ],
                },
            )
        )
    style = replace(
        _entry("style", kind=ContentKind.IDLE_STYLE, dependencies=tuple(g.id for g in gestures)),
        dependencies=tuple(g.logical_key for g in gestures if g.logical_key is not None),
        metadata={
            "schema_version": 2,
            "content_type": "idle_style",
            "name": "Style",
            "dependencies": [{"ref": g.logical_key, "content_type": "gesture"} for g in gestures],
            "default_pool": [g.logical_key for g in gestures],
        },
    )

    class Store(_Store):
        def open_verified_file(self, **facts):  # noqa: ANN003, ANN202
            return VerifiedContentFile(BytesIO(clip), len(clip), facts["expected_sha256"], facts["media_type"])

    catalog = _Catalog([style, *gestures, sound])
    descriptor = await RuntimeContentClosureCompiler(catalog=catalog, store=Store()).compile(  # type: ignore[arg-type]
        user_id="owner",
        loadout_revision=1,
        selections=(RuntimeContentRootSelection("idle-style", style.id, style.kind),),
    )
    runtime = project_typed_runtime_catalog(loadout_revision=1, descriptor=descriptor, visible=catalog.entries)
    nested = runtime["idle_style"]["gestures"]
    first, second = (value["reference_map"]["bell"] for value in nested)
    assert first != second
    sounds = {value["runtime_id"]: value for value in runtime["sound_effects"]}
    assert sounds[first]["config"]["gain"] == 0.2
    assert sounds[second]["config"]["gain"] == 0.8
    assert sounds[first]["source"]["item_id"] == sounds[second]["source"]["item_id"] == sound.id


@pytest.mark.asyncio
async def test_closure_flattens_dependencies_and_deduplicates_members() -> None:
    shared_file = _file("support", "sparkle.bin", "a" * 64)
    root_file = _file("gesture", "wave.bin", "b" * 64)
    support = _entry(
        "support",
        kind=ContentKind.PARTICLE_EFFECT,
        files=(shared_file,),
    )
    gesture = _entry("gesture", files=(root_file,), dependencies=(support.id,))
    catalog = _Catalog([gesture, support])
    descriptor = await RuntimeContentClosureCompiler(
        catalog=catalog,  # type: ignore[arg-type]
        store=_Store(),  # type: ignore[arg-type]
    ).compile(
        user_id="owner",
        loadout_revision=3,
        selections=(
            RuntimeContentRootSelection("gesture:wave", gesture.id, gesture.kind),
            RuntimeContentRootSelection("effect:sparkle", support.id, support.kind),
        ),
    )

    assert [root.slot_key for root in descriptor.roots] == ["gesture:wave", "effect:sparkle"]
    assert len(descriptor.entries) == 2
    assert len(descriptor.members) == 2
    assert {member.file_ref for member in descriptor.members} == {
        root_file.file_ref,
        shared_file.file_ref,
    }
    assert descriptor.admitted_item_revisions == dict(
        sorted(
            {
                gesture.id: gesture.revision_sha256,
                support.id: support.revision_sha256,
            }.items()
        )
    )
    assert descriptor.roots[0].entry_ids == (support.id, gesture.id)
    assert descriptor.diagnostics == ()


@pytest.mark.asyncio
async def test_changed_dependency_omits_only_affected_roots_and_requests_rescan() -> None:
    bad_file = _file("bad", "bad.bin", "a" * 64)
    good_file = _file("good", "good.bin", "b" * 64)
    dependency = _entry("bad", kind=ContentKind.PARTICLE_EFFECT, files=(bad_file,))
    affected = _entry("affected", dependencies=(dependency.id,))
    good = _entry("good", files=(good_file,))
    catalog = _Catalog([dependency, affected, good])
    descriptor = await RuntimeContentClosureCompiler(
        catalog=catalog,  # type: ignore[arg-type]
        store=_Store({bad_file.relative_path}),  # type: ignore[arg-type]
    ).compile(
        user_id="owner",
        loadout_revision=1,
        selections=(
            RuntimeContentRootSelection("gesture:affected", affected.id, affected.kind),
            RuntimeContentRootSelection("gesture:good", good.id, good.kind),
        ),
    )

    assert [root.slot_key for root in descriptor.roots] == ["gesture:good"]
    assert [item.code for item in descriptor.diagnostics] == ["runtime_source_changed"]
    assert catalog.invalidations == [(ContentSource.LOCAL, (bad_file.relative_path,))]
