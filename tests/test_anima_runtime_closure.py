from __future__ import annotations

import asyncio
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
from animama.domain.runtime_content_descriptor import MAX_RUNTIME_ENTRIES, RuntimeContentRootSelection
from tests.content_package_helpers import anima_clip


@pytest.mark.asyncio
async def test_idle_pool_members_are_finite_separate_from_ai_gestures_and_drop_alone() -> None:
    from animama.app.services.typed_runtime_projection import project_typed_runtime_catalog

    clip = json.dumps(anima_clip(clip_id="breathe", name="Breathe", duration=3)).encode()

    def gesture(name: str, config: dict[str, object]) -> CatalogContentEntry:
        motion = replace(_file(name, f"{name}.json", hashlib.sha256(clip).hexdigest(), len(clip)), role="sequence")
        return replace(
            _entry(name, files=(motion,)),
            logical_key=f"local:gesture:{name}",
            metadata={
                "schema_version": 1,
                "content_type": "gesture",
                "name": name.title(),
                "semantic_key": name,
                "implementation": {"kind": "anima_clip", "file_role": "sequence"},
                "config": config,
            },
        )

    breathe = gesture("breathe", {"time_scale": 2})
    # A looping clip without a finite repetition count cannot idle.
    endless = gesture("endless", {"loop": True})

    class Store(_Store):
        def open_verified_file(self, **facts):
            return VerifiedContentFile(BytesIO(clip), len(clip), facts["expected_sha256"], facts["media_type"])

    def idle_root(item: CatalogContentEntry, cells: list[str]) -> RuntimeContentRootSelection:
        return RuntimeContentRootSelection(
            f"idle:{item.id}",
            item.id,
            ContentKind.GESTURE,
            context={"binding_id": f"idle:{item.id}", "idle_cells": cells, "origin": "idle"},
        )

    catalog = _Catalog([breathe, endless])
    descriptor = await RuntimeContentClosureCompiler(catalog=catalog, store=Store()).compile(  # type: ignore[arg-type]
        user_id="owner",
        loadout_revision=1,
        selections=(idle_root(breathe, ["default", "joy-2"]), idle_root(endless, ["default"])),
    )
    assert [root.item_id for root in descriptor.roots] == [breathe.id]
    assert [(issue.code, issue.item_id) for issue in descriptor.diagnostics] == [
        ("idle_repetitions_invalid", endless.id)
    ]
    runtime = project_typed_runtime_catalog(loadout_revision=1, descriptor=descriptor, visible=catalog.entries)
    assert runtime["gestures"] == []
    assert runtime["idle"]["default_pool"] == [breathe.id]
    assert runtime["idle"]["cells"] == {"joy": {"2": [breathe.id]}}
    nested = runtime["idle"]["gestures"][0]
    assert nested["binding_id"] == f"idle:{breathe.id}"
    assert nested["runtime_root_id"] == descriptor.roots[0].root_id
    assert nested["idle_playback"]["duration_seconds"] == 1.5


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

    async def list_visible(self, *, user_id: str):
        assert user_id == "owner"
        return self.entries

    async def mark_scan_required(self, *, source, relative_paths):
        self.invalidations.append((source, relative_paths))


class _Store:
    def __init__(self, changed_paths: set[str] | None = None) -> None:
        self.changed_paths = changed_paths or set()

    def open_verified_file(self, **facts):
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

    clip = json.dumps(anima_clip(clip_id="breathe", name="Breathe", duration=1)).encode()
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
                    files=(
                        replace(
                            _file(name, f"{name}.json", hashlib.sha256(clip).hexdigest(), len(clip)), role="sequence"
                        ),
                    ),
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

    class Store(_Store):
        def open_verified_file(self, **facts):
            return VerifiedContentFile(BytesIO(clip), len(clip), facts["expected_sha256"], facts["media_type"])

    catalog = _Catalog([*gestures, sound])
    descriptor = await RuntimeContentClosureCompiler(catalog=catalog, store=Store()).compile(  # type: ignore[arg-type]
        user_id="owner",
        loadout_revision=1,
        selections=tuple(
            RuntimeContentRootSelection(
                f"idle:{value.id}", value.id, ContentKind.GESTURE, context={"idle_cells": ["default"]}
            )
            for value in gestures
        ),
    )
    runtime = project_typed_runtime_catalog(loadout_revision=1, descriptor=descriptor, visible=catalog.entries)
    nested = runtime["idle"]["gestures"]
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


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", [False, True])
async def test_unavailable_voice_retains_slot_diagnostic_for_playback_failure(missing: bool) -> None:
    voice = _entry("voice", kind=ContentKind.VOICE, status=ContentStatus.INVALID)
    descriptor = await RuntimeContentClosureCompiler(
        catalog=_Catalog([] if missing else [voice]),  # type: ignore[arg-type]
        store=_Store(),  # type: ignore[arg-type]
    ).compile(
        user_id="owner",
        loadout_revision=1,
        selections=(RuntimeContentRootSelection("voice", voice.id, voice.kind),),
    )
    assert descriptor.roots == ()
    assert len(descriptor.diagnostics) == 1
    diagnostic = descriptor.diagnostics[0]
    assert diagnostic.slot_key == "voice"
    assert diagnostic.item_id == voice.id
    assert diagnostic.code == ("catalog_root_unavailable" if missing else "catalog_root_invalid")


@pytest.mark.asyncio
async def test_closure_admits_more_than_500_entries_within_the_runtime_entry_limit() -> None:
    # Reaction pools of up to four per cell take a full Anima past 500 entries.
    count = 600
    assert count < MAX_RUNTIME_ENTRIES
    gestures = [
        _entry(f"gesture-{index}", files=(_file(f"gesture-{index}", f"g{index}.bin", "a" * 64),))
        for index in range(count)
    ]
    descriptor = await RuntimeContentClosureCompiler(
        catalog=_Catalog(gestures),  # type: ignore[arg-type]
        store=_Store(),  # type: ignore[arg-type]
    ).compile(
        user_id="owner",
        loadout_revision=1,
        selections=tuple(
            RuntimeContentRootSelection(f"gesture:{item.display_name}", item.id, item.kind) for item in gestures
        ),
    )

    assert descriptor.diagnostics == ()
    assert len(descriptor.roots) == len(descriptor.admitted_item_revisions) == count


def _count_worker_calls(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []
    to_thread = asyncio.to_thread

    async def counted(function, /, *args, **kwargs):
        calls.append(getattr(function, "__name__", repr(function)))
        return await to_thread(function, *args, **kwargs)

    monkeypatch.setattr(asyncio, "to_thread", counted)
    return calls


@pytest.mark.asyncio
async def test_compile_verifies_every_member_in_one_worker_call(monkeypatch: pytest.MonkeyPatch) -> None:
    gestures = [
        _entry(f"gesture-{index}", files=(_file(f"gesture-{index}", f"g{index}.bin", "a" * 64),)) for index in range(50)
    ]

    class Store(_Store):
        def __init__(self) -> None:
            super().__init__()
            self.opened: list[str] = []

        def open_verified_file(self, **facts):
            self.opened.append(facts["relative_path"])
            return super().open_verified_file(**facts)

    store = Store()
    calls = _count_worker_calls(monkeypatch)
    descriptor = await RuntimeContentClosureCompiler(catalog=_Catalog(gestures), store=store).compile(  # type: ignore[arg-type]
        user_id="owner",
        loadout_revision=1,
        selections=tuple(
            RuntimeContentRootSelection(f"gesture:{item.display_name}", item.id, item.kind) for item in gestures
        ),
    )
    assert len(descriptor.members) == 50
    assert len(calls) == 1
    assert sorted(store.opened) == sorted(item.files[0].relative_path for item in gestures)


@pytest.mark.asyncio
async def test_batched_verification_keeps_diagnostic_order_and_rescan_paths() -> None:
    """Unavailable and changed roots keep their selection order; each changed root marks its first changed file."""

    first_bad = _file("changed", "first.bin", "a" * 64)
    second_bad = _file("changed", "second.bin", "b" * 64)
    changed = _entry("changed", files=(first_bad, second_bad))
    invalid = _entry("invalid", status=ContentStatus.INVALID)
    good = _entry("good", files=(_file("good", "good.bin", "c" * 64),))
    catalog = _Catalog([changed, invalid, good])
    descriptor = await RuntimeContentClosureCompiler(
        catalog=catalog,  # type: ignore[arg-type]
        store=_Store({first_bad.relative_path, second_bad.relative_path}),  # type: ignore[arg-type]
    ).compile(
        user_id="owner",
        loadout_revision=1,
        selections=(
            RuntimeContentRootSelection("gesture:changed", changed.id, changed.kind),
            RuntimeContentRootSelection("gesture:invalid", invalid.id, invalid.kind),
            RuntimeContentRootSelection("gesture:good", good.id, good.kind),
        ),
    )
    assert [root.slot_key for root in descriptor.roots] == ["gesture:good"]
    assert [(item.slot_key, item.code) for item in descriptor.diagnostics] == [
        ("gesture:changed", "runtime_source_changed"),
        ("gesture:invalid", "catalog_root_invalid"),
    ]
    assert catalog.invalidations == [(ContentSource.LOCAL, (first_bad.relative_path,))]


@pytest.mark.asyncio
async def test_idle_roots_reuse_cached_facts_for_bytes_the_compile_verified(monkeypatch: pytest.MonkeyPatch) -> None:
    clip = json.dumps(anima_clip(clip_id=f"breathe-{uuid.uuid4().hex}", name="Breathe", duration=3)).encode()
    motion = replace(_file("breathe", "breathe.json", hashlib.sha256(clip).hexdigest(), len(clip)), role="sequence")
    breathe = replace(
        _entry("breathe", files=(motion,)),
        logical_key="local:gesture:breathe",
        metadata={
            "schema_version": 1,
            "content_type": "gesture",
            "name": "Breathe",
            "semantic_key": "breathe",
            "implementation": {"kind": "anima_clip", "file_role": "sequence"},
            "config": {},
        },
    )

    class Store(_Store):
        def open_verified_file(self, **facts):
            return VerifiedContentFile(BytesIO(clip), len(clip), facts["expected_sha256"], facts["media_type"])

    async def compile_idle():
        return await RuntimeContentClosureCompiler(catalog=_Catalog([breathe]), store=Store()).compile(  # type: ignore[arg-type]
            user_id="owner",
            loadout_revision=1,
            selections=(
                RuntimeContentRootSelection(
                    f"idle:{breathe.id}", breathe.id, ContentKind.GESTURE, context={"idle_cells": ["default"]}
                ),
            ),
        )

    first = await compile_idle()
    calls = _count_worker_calls(monkeypatch)
    again = await compile_idle()
    assert again == first
    assert first.roots[0].idle_playback[breathe.id]["duration_seconds"] == 3
    # Only the batched member verification: the Idle facts come from the cache.
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_cached_idle_facts_never_admit_motion_that_failed_verification() -> None:
    clip = json.dumps(anima_clip(clip_id=f"sway-{uuid.uuid4().hex}", name="Sway", duration=2)).encode()
    motion = replace(_file("sway", "sway.json", hashlib.sha256(clip).hexdigest(), len(clip)), role="sequence")
    sway = replace(
        _entry("sway", files=(motion,)),
        metadata={
            "schema_version": 1,
            "content_type": "gesture",
            "name": "Sway",
            "semantic_key": "sway",
            "implementation": {"kind": "anima_clip", "file_role": "sequence"},
            "config": {},
        },
    )
    selection = RuntimeContentRootSelection(
        f"idle:{sway.id}", sway.id, ContentKind.GESTURE, context={"idle_cells": ["default"]}
    )

    class Store(_Store):
        def open_verified_file(self, **facts):
            if facts["relative_path"] in self.changed_paths:
                raise ContentIntegrityError("changed")
            return VerifiedContentFile(BytesIO(clip), len(clip), facts["expected_sha256"], facts["media_type"])

    async def compile_with(store: _Store):
        return await RuntimeContentClosureCompiler(catalog=_Catalog([sway]), store=store).compile(  # type: ignore[arg-type]
            user_id="owner", loadout_revision=1, selections=(selection,)
        )

    assert len((await compile_with(Store())).roots) == 1
    # The facts are cached now, yet changed motion bytes still drop the root for Rescan.
    changed = await compile_with(Store({motion.relative_path}))
    assert changed.roots == ()
    assert [item.code for item in changed.diagnostics] == ["runtime_source_changed"]
