"""The content transition points Local Actions at merged Included Avatar Effects (ADR 0025)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete

from animama.app.contracts.avatar_effect import (
    AvatarEffectDefinitionV2,
    AvatarEffectEventOverride,
    merge_avatar_effect_override,
)
from animama.app.services import avatar_effect_merge_transition
from animama.app.services.avatar_effect_merge_transition import AvatarEffectMergeTransitionService
from animama.app.services.avatar_effect_merges import AvatarEffectMerge
from animama.app.services.avatar_effect_overrides import check_clip_effect_overrides
from animama.domain.content_catalog import CatalogContentEntry, ContentStatus
from animama.domain.content_documents import ContentDocumentError
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services

OWNER = "merge-transition-owner"
REPOSITORY = Path(__file__).parents[1]
FAMILY = "builtin:avatar-effect:kira_star"
# Any two Included body effects stand in for a family and a removed variant.
VARIANT = "builtin:avatar-effect:shake_lines"
OVERRIDE = {"attachment": {"kind": "body", "bone": "head", "offset": {"x": -0.05}, "size": 0.06}}
MERGES = {VARIANT: AvatarEffectMerge(ref=FAMILY, override=OVERRIDE, sound_alias="tehe", silent=False)}


@pytest.fixture(autouse=True)
async def _cleanup(async_session):  # noqa: ANN001, ANN202
    yield
    await async_session.rollback()
    await async_session.execute(
        delete(ORMContentCatalogItem).where(
            (ORMContentCatalogItem.owner_user_id == OWNER) | ORMContentCatalogItem.logical_key.in_([FAMILY, VARIANT])
        )
    )
    await async_session.commit()


async def _setup(async_session, tmp_path: Path):  # noqa: ANN001, ANN202
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    inventory = paths.included_root / "licenses/inventory.json"
    inventory.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(REPOSITORY / "content/included/licenses/inventory.json", inventory)
    for stem in ("kira_star", "shake_lines"):
        shutil.copytree(REPOSITORY / "content/included/vfx/avatar" / stem, paths.included_root / "vfx/avatar" / stem)
    clip = json.loads((REPOSITORY / "content/included/reactions/anger-2/anger-2.json").read_text())
    clip["id"] = "cheer"
    clip["events"] = [{"id": "star", "time": 0.1, "kind": "avatar_vfx", "effectId": "tehe"}]
    meta = {
        "schema_version": 1,
        "content_type": "reaction",
        "content_id": "local:reaction:cheer",
        "version": 1,
        "name": "Cheer",
        "implementation": {"kind": "anima_clip", "file_role": "sequence"},
        "dependencies": [{"ref": VARIANT, "alias": "tehe", "content_type": "avatar_effect", "config": {}}],
        "files": [{"path": "cheer.json", "role": "sequence"}],
    }
    folder = paths.local_root / "reactions/cheer"
    folder.mkdir(parents=True)
    (folder / "cheer.json").write_text(json.dumps(clip))
    (folder / "cheer.meta.json").write_text(json.dumps(meta))
    await content.rescan(user_id=OWNER)
    return folder, catalog, content


async def _reaction(catalog: Any) -> CatalogContentEntry:  # noqa: ANN401
    items: list[CatalogContentEntry] = [
        entry for entry in await catalog.list_visible(user_id=OWNER) if entry.logical_key == "local:reaction:cheer"
    ]
    [item] = items
    return item


async def test_a_local_reaction_names_the_family_with_the_override_and_keeps_its_identity(
    async_session,  # noqa: ANN001
    tmp_path: Path,
) -> None:
    folder, catalog, content = await _setup(async_session, tmp_path)
    before = await _reaction(catalog)
    assert before.status is ContentStatus.VALID

    await AvatarEffectMergeTransitionService(content=content, merges=MERGES).convert(user_id=OWNER)

    after = await _reaction(catalog)
    assert after.id == before.id and after.logical_key == before.logical_key
    assert after.status is ContentStatus.VALID and after.revision_sha256 != before.revision_sha256
    meta = json.loads((folder / "cheer.meta.json").read_text())
    assert meta["content_id"] == "local:reaction:cheer"
    assert meta["dependencies"] == [
        {"ref": FAMILY, "alias": "kira_star", "content_type": "avatar_effect", "config": {}}
    ]
    [event] = json.loads((folder / "cheer.json").read_text())["events"]
    assert event == {
        "id": "star",
        "time": 0.1,
        "kind": "avatar_vfx",
        "effectId": "kira_star",
        "override": {**OVERRIDE, "soundAlias": "tehe"},
    }

    # A second run finds nothing to rewrite.
    await AvatarEffectMergeTransitionService(content=content, merges=MERGES).convert(user_id=OWNER)
    assert (await _reaction(catalog)).revision_sha256 == after.revision_sha256


async def test_a_failed_rewrite_leaves_the_action_as_it_was(
    async_session,  # noqa: ANN001
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    folder, catalog, content = await _setup(async_session, tmp_path)
    before = await _reaction(catalog)
    original = (folder / "cheer.meta.json").read_bytes()

    def fail(*_: object) -> None:
        raise ContentDocumentError("avatar_effect_merge_failed", "broken")

    monkeypatch.setattr(avatar_effect_merge_transition, "rewrite_action_effect_merges", fail)
    await AvatarEffectMergeTransitionService(content=content, merges=MERGES).convert(user_id=OWNER)

    after = await _reaction(catalog)
    assert after.status is ContentStatus.VALID
    assert after.revision_sha256 == before.revision_sha256
    assert (folder / "cheer.meta.json").read_bytes() == original


async def test_local_actions_naming_removed_effects_play_their_families_as_before(
    async_session,  # noqa: ANN001
    tmp_path: Path,
) -> None:
    """A Local Gesture and Reaction that named removed effects, through the real merge map."""
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    inventory = paths.included_root / "licenses/inventory.json"
    inventory.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(REPOSITORY / "content/included/licenses/inventory.json", inventory)
    shutil.copytree(REPOSITORY / "content/included/vfx/avatar/kira_star", paths.included_root / "vfx/avatar/kira_star")
    clip = json.loads((REPOSITORY / "content/included/reactions/anger-2/anger-2.json").read_text())
    for kind, slug, removed, alias in (
        ("gesture", "tehe", "builtin:avatar-effect:kira_star_tehe", "tehe"),
        ("reaction", "laugh", "builtin:avatar-effect:laugh_sparkle", "laugh"),
    ):
        folder = paths.local_root / f"{kind}s/{slug}"
        folder.mkdir(parents=True)
        events = [{"id": "star", "time": 0.1, "kind": "avatar_vfx", "effectId": alias}]
        (folder / f"{slug}.json").write_text(json.dumps({**clip, "id": slug, "events": events}))
        meta = {
            "schema_version": 1,
            "content_type": kind,
            "content_id": f"local:{kind}:{slug}",
            "version": 1,
            "name": slug.title(),
            "implementation": {"kind": "anima_clip", "file_role": "sequence"},
            "dependencies": [{"ref": removed, "alias": alias, "content_type": "avatar_effect", "config": {}}],
            "files": [{"path": f"{slug}.json", "role": "sequence"}],
        }
        (folder / f"{slug}.meta.json").write_text(json.dumps(meta))
    await content.rescan(user_id=OWNER)

    await AvatarEffectMergeTransitionService(content=content).convert(user_id=OWNER)
    await content.rescan(user_id=OWNER)

    family = json.loads((REPOSITORY / "content/included/vfx/avatar/kira_star/kira_star.json").read_text())
    effect = AvatarEffectDefinitionV2.model_validate(family["definition"])
    sounds = {edge["alias"]: edge["ref"] for edge in family["dependencies"]}
    variants = json.loads((REPOSITORY / "tests/fixtures/avatar-effect-merge-variants.json").read_text())
    for kind, slug, removed in (
        ("gesture", "tehe", "builtin:avatar-effect:kira_star_tehe"),
        ("reaction", "laugh", "builtin:avatar-effect:laugh_sparkle"),
    ):
        [item] = [
            entry for entry in await catalog.list_visible(user_id=OWNER) if entry.logical_key == f"local:{kind}:{slug}"
        ]
        assert item.status is ContentStatus.VALID and item.missing_dependencies == ()
        folder = paths.local_root / f"{kind}s/{slug}"
        clip_after = json.loads((folder / f"{slug}.json").read_text())
        check_clip_effect_overrides(clip_after, {"kira_star": effect}, code="test")
        [event] = clip_after["events"]
        assert event["effectId"] == "kira_star"
        override = {key: value for key, value in event.get("override", {}).items() if key != "soundAlias"}
        played = merge_avatar_effect_override(effect, AvatarEffectEventOverride.model_validate(override))
        expected = AvatarEffectDefinitionV2.model_validate(variants[removed]["definition"])
        for part in ("attachment", "appearance", "motion"):
            assert getattr(played, part).model_dump() == getattr(expected, part).model_dump(), (slug, part)
        if variants[removed]["sound"] is None:
            assert event["playAccompanyingSound"] is False
        else:
            alias = event.get("override", {}).get("soundAlias", family["definition"]["soundAlias"])
            assert sounds[alias] == f"builtin:sound-effect:{variants[removed]['sound']}"
