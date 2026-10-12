"""A Local Action outlives the removal of an Included effect it uses.

Pre-launch, Included effects are removed outright once Included content no
longer uses them. A Local Reaction or Gesture that still names one keeps
playing without it: the catalog keeps it valid with a
``missing_effect_dependency`` diagnostic, typed views and the runtime see only
its remaining dependencies, the runtime projection names the removed effects
by alias, and Portable export refuses it until it is repaired. Every other
unresolved dependency still invalidates the Action.
"""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services.runtime_content_closure import RuntimeContentClosureCompiler
from animama.app.services.typed_content_service import TypedContentResolutionContext
from animama.app.services.typed_runtime_projection import project_typed_runtime_catalog
from animama.domain.content_catalog import (
    MISSING_EFFECT_DEPENDENCY,
    CatalogContentEntry,
    ContentConflictError,
    ContentKind,
    ContentStatus,
)
from animama.domain.runtime_content_descriptor import RuntimeContentRootSelection
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services

OWNER = "removed-effect-owner"
REPOSITORY = Path(__file__).parents[1]
AVATAR = "builtin:avatar-effect:angry"
PARTICLE = "builtin:particle-effect:hearts-v1"
SCENE = "builtin:scene-effect:background:scene-vfx-emotion-joy"
INCLUDED = {
    AVATAR: "vfx/avatar/angry",
    PARTICLE: "vfx/particle/quark/hearts-v1",
    SCENE: "vfx/scene/scene-vfx-emotion-joy",
}


@pytest.fixture(autouse=True)
async def _cleanup(async_session):  # noqa: ANN001, ANN202
    yield
    await async_session.rollback()
    await async_session.execute(
        delete(ORMContentCatalogItem).where(
            (ORMContentCatalogItem.owner_user_id == OWNER) | ORMContentCatalogItem.logical_key.in_(INCLUDED)
        )
    )
    await async_session.commit()


def _include(paths: Any, ref: str) -> None:
    """Copy one Included effect, with the licence inventory Included entries need."""

    inventory = paths.included_root / "licenses/inventory.json"
    if not inventory.exists():
        inventory.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPOSITORY / "content/included/licenses/inventory.json", inventory)
    shutil.copytree(REPOSITORY / "content/included" / INCLUDED[ref], paths.included_root / INCLUDED[ref])


def _reaction_files(dependencies: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    """A Reaction descriptor and clip playing one event per effect dependency."""

    events = [
        {"id": "avatar", "time": 0.1, "kind": "avatar_vfx", "effectId": "angry"},
        {"id": "particle", "time": 0.1, "kind": "particle_vfx", "effectId": "stream"},
        {
            "id": "scene",
            "time": 0.1,
            "kind": "scene_vfx",
            "presetId": "joy",
            "sceneKind": "background_layers",
        },
    ]
    aliases = {dependency["alias"] for dependency in dependencies}
    clip = json.loads((REPOSITORY / "content/included/reactions/anger-2/anger-2.json").read_text())
    clip["id"] = "cheer"
    clip["events"] = [event for event in events if (event.get("effectId") or event.get("presetId")) in aliases]
    meta = {
        "schema_version": 1,
        "content_type": "reaction",
        "content_id": "local:reaction:cheer",
        "version": 1,
        "name": "Cheer",
        "placement_hint": {"emotion": "joy", "intensity": 2},
        "implementation": {"kind": "anima_clip", "file_role": "sequence"},
        "dependencies": [{"config": {}, **dependency} for dependency in dependencies],
        "files": [{"path": "cheer.json", "role": "sequence"}],
    }
    return meta, clip


def _write_reaction(paths: Any, dependencies: list[dict[str, Any]], *, root: Path | None = None) -> None:
    """Write the Reaction into the Local library (or ``root``)."""

    meta, clip = _reaction_files(dependencies)
    folder = (root or paths.local_root) / "reactions/cheer"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "cheer.json").write_text(json.dumps(clip))
    (folder / "cheer.meta.json").write_text(json.dumps(meta))


EFFECTS = [
    {"ref": AVATAR, "alias": "angry", "content_type": "avatar_effect"},
    {"ref": PARTICLE, "alias": "stream", "content_type": "particle_effect"},
    {"ref": SCENE, "alias": "joy", "content_type": "scene_effect"},
]


async def _reaction(catalog: Any) -> CatalogContentEntry:  # noqa: ANN401
    reaction: CatalogContentEntry
    [reaction] = [
        item for item in await catalog.list_visible(user_id=OWNER) if item.logical_key == "local:reaction:cheer"
    ]
    return reaction


async def test_local_reaction_plays_without_removed_included_effects(async_session, tmp_path) -> None:  # noqa: ANN001
    paths, catalog, content, _, packages = package_services(async_session, tmp_path)
    for ref in INCLUDED:
        _include(paths, ref)
    _write_reaction(paths, EFFECTS)
    await content.rescan(user_id=OWNER)
    before = await _reaction(catalog)
    assert before.status is ContentStatus.VALID
    assert before.missing_dependencies == ()
    assert len(before.dependency_item_ids) == 3

    # The Particle and Scene Effects are removed from Included content.
    for ref in (PARTICLE, SCENE):
        shutil.rmtree(paths.included_root / INCLUDED[ref])
    await content.rescan(user_id=OWNER)
    reaction = await _reaction(catalog)
    assert reaction.status is ContentStatus.VALID
    assert reaction.missing_dependencies == (PARTICLE, SCENE)
    # The remaining dependencies still pair one ref with one item.
    assert reaction.dependencies == (AVATAR,)
    assert len(reaction.dependency_item_ids) == 1
    assert [
        (diagnostic.code, diagnostic.relative_path)
        for diagnostic in reaction.diagnostics
        if diagnostic.code == MISSING_EFFECT_DEPENDENCY
    ] == [(MISSING_EFFECT_DEPENDENCY, PARTICLE), (MISSING_EFFECT_DEPENDENCY, SCENE)]

    # Typed views resolve the remaining closure; the removed effects have no ID.
    visible = await catalog.list_visible(user_id=OWNER)
    context = TypedContentResolutionContext({item.id: item for item in visible})
    closure = context.resolve(reaction.id)
    assert [item.item.kind for item in closure] == [ContentKind.AVATAR_EFFECT, ContentKind.REACTION]
    assert set(context.parse(reaction).dependency_ids) == {AVATAR}

    # The runtime admits the Reaction and names the removed effects by alias.
    store = FilesystemContentStore(
        included_root=paths.included_root, local_root=paths.local_root, operations_root=paths.operations_root
    )
    descriptor = await RuntimeContentClosureCompiler(catalog=catalog, store=store).compile(
        user_id=OWNER,
        loadout_revision=1,
        selections=(RuntimeContentRootSelection("reaction:joy-2", reaction.id, ContentKind.REACTION),),
    )
    assert descriptor.diagnostics == ()
    projected = project_typed_runtime_catalog(loadout_revision=1, descriptor=descriptor, visible=visible)
    [action] = projected["reactions"]
    assert action["reference_map"] == {"angry": "angry"}
    assert action["missing_references"] == {"stream": PARTICLE, "joy": SCENE}

    # Portable export refuses it until the events are repaired.
    with pytest.raises(ContentConflictError) as refused:
        await packages.summarize(user_id=OWNER, item_ids=(reaction.id,))
    assert refused.value.code == "package_dependency_missing"

    # Restoring an effect resolves its dependency again.
    _include(paths, PARTICLE)
    await content.rescan(user_id=OWNER)
    restored = await _reaction(catalog)
    assert restored.missing_dependencies == (SCENE,)
    assert restored.dependencies == (AVATAR, PARTICLE)


@pytest.mark.parametrize(
    "dependency",
    [
        # Only Included effects may be removed under a Local Action.
        {"ref": "builtin:sound-effect:gone", "alias": "gone", "content_type": "sound_effect"},
        {"ref": "local:particle-effect:gone", "alias": "stream", "content_type": "particle_effect"},
    ],
)
async def test_other_unresolved_dependencies_still_invalidate(
    async_session,  # noqa: ANN001
    tmp_path,  # noqa: ANN001
    dependency: dict[str, Any],
) -> None:
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    _include(paths, AVATAR)
    _write_reaction(paths, [EFFECTS[0], dependency])
    await content.rescan(user_id=OWNER)
    reaction = await _reaction(catalog)
    assert reaction.status is ContentStatus.INVALID
    assert reaction.missing_dependencies == ()
    assert {diagnostic.code for diagnostic in reaction.diagnostics} >= {"unresolved_dependency"}


async def test_an_invalid_included_effect_still_invalidates(async_session, tmp_path) -> None:  # noqa: ANN001
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    for ref in (AVATAR, PARTICLE):
        _include(paths, ref)
    # Present but broken: its manifest is gone, so it is invalid, not removed.
    (paths.included_root / INCLUDED[PARTICLE] / "particle.json").unlink()
    _write_reaction(paths, EFFECTS[:2])
    await content.rescan(user_id=OWNER)
    reaction = await _reaction(catalog)
    assert reaction.status is ContentStatus.INVALID
    assert reaction.missing_dependencies == ()


async def test_an_included_action_naming_a_removed_effect_is_invalid(async_session, tmp_path) -> None:  # noqa: ANN001
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    _include(paths, AVATAR)
    meta, clip = _reaction_files(EFFECTS[:2])
    meta["content_id"] = "builtin:reaction:cheer"
    folder = paths.included_root / "reactions/cheer"
    folder.mkdir(parents=True)
    (folder / "cheer.json").write_text(json.dumps(clip))
    (folder / "cheer.meta.json").write_text(json.dumps(meta))
    await content.rescan(user_id=OWNER)
    [reaction] = [
        item for item in await catalog.list_visible(user_id=OWNER) if item.logical_key == "builtin:reaction:cheer"
    ]
    assert reaction.status is ContentStatus.INVALID
    assert reaction.missing_dependencies == ()


async def test_a_save_naming_a_missing_effect_is_refused(async_session, tmp_path) -> None:  # noqa: ANN001
    paths, catalog, content, saves, _ = package_services(async_session, tmp_path)
    _include(paths, AVATAR)
    await content.rescan(user_id=OWNER)
    # A mistyped Included effect: only Actions saved before a removal outlive it.
    meta, clip = _reaction_files(
        [
            EFFECTS[0],
            {"ref": "builtin:particle-effect:hearts-v1-typo", "alias": "stream", "content_type": "particle_effect"},
        ]
    )
    with pytest.raises(ContentConflictError) as refused:
        await saves.save_descriptor(
            user_id=OWNER,
            kind=ContentKind.REACTION,
            entry_name="Cheer",
            descriptor=json.dumps(meta).encode(),
            companion_files={"cheer.json": json.dumps(clip).encode()},
            operation_id=str(uuid.uuid4()),
            catalog_item_id=None,
            expected_revision=None,
        )
    assert refused.value.code == "saved_content_invalid"
    assert not [
        item
        for item in await catalog.list_visible(user_id=OWNER)
        if item.logical_key == "local:reaction:cheer" and item.status is ContentStatus.VALID
    ]
