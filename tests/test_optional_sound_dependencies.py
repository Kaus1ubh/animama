"""Built-in effects keep working, silently, when their licensed sound is absent.

An Included Avatar or Scene Effect may declare its sound edge ``optional``. The
Included scan drops an optional edge whose sound isn't installed, so every
consumer sees an ordinary effect without a sound. Local content never declares
optional edges and never depends on non-portable sounds.
"""

from __future__ import annotations

import base64
import json
import shutil
import zlib
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import pytest
from sqlalchemy import delete

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services.content_kind_registry import handler_for_kind
from animama.domain.content_catalog import (
    ContentConflictError,
    ContentKind,
    ContentSource,
    ContentStatus,
)
from animama.domain.content_documents import ContentDocumentError
from animama.domain.content_sources import IncludedContentSource
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.runtime.starter_content import starter_inventory
from tests.anima_creation_service_support import copy_tracked_included, write_json
from tests.content_package_helpers import package_services
from tests.test_content_audio import _VORBIS_SILENCE_ZLIB_BASE64

ROOT = Path(__file__).parents[1]
_RULE = {
    "creator": "Fixture",
    "license_id": "fixture-only",
    "provenance": "Fixture",
    "redistribution_review": "pending",
}
SOUND = "builtin:sound-effect:pop"
EFFECT = "vfx/avatar/sweat_drop"


def _vorbis() -> bytes:
    return zlib.decompress(base64.b64decode(_VORBIS_SILENCE_ZLIB_BASE64))


def _inventory(root: Path, *rules: dict[str, Any]) -> None:
    write_json(
        root / "licenses/inventory.json", {"schema_version": 1, "rules": list(rules or [{"glob": "**", **_RULE}])}
    )


def _effect(root: Path, *, optional: bool = True, content_id: str = "builtin:avatar-effect:sweat_drop") -> Path:
    """Copy a tracked Included effect and give it a sound edge."""

    folder = root / EFFECT
    shutil.copytree(ROOT / "content/included" / EFFECT, folder)
    descriptor = folder / "sweat_drop.json"
    document = json.loads(descriptor.read_text(encoding="utf-8"))
    document["content_id"] = content_id
    edge: dict[str, Any] = {"ref": SOUND, "content_type": "sound_effect", "alias": "on-apply"}
    if optional:
        edge["optional"] = True
    document["dependencies"] = [edge]
    document["definition"]["soundAlias"] = "on-apply"
    write_json(descriptor, document)
    return descriptor


def _sound(root: Path) -> bytes:
    payload = _vorbis()
    folder = root / "sfx/wow-comedy"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "pop.ogg").write_bytes(payload)
    write_json(
        folder / "pop.meta.json",
        {"content_type": "sound_effect", "content_id": SOUND, "version": 1, "name": "Pop"},
    )
    return payload


def _by_locator(entries: list[Any]) -> dict[str, Any]:
    return {entry.relative_locator: entry for entry in entries}


def _parse(kind: ContentKind, raw: dict[str, Any]) -> Any:
    return handler_for_kind(kind).parse_document(raw, fallback_path=Path("x"), descriptor_backed=True)


def test_optional_is_accepted_only_on_effect_sound_edges() -> None:
    descriptor = json.loads((ROOT / "content/included" / EFFECT / "sweat_drop.json").read_text(encoding="utf-8"))
    descriptor["dependencies"] = [{"ref": SOUND, "content_type": "sound_effect", "optional": True}]
    [edge] = _parse(ContentKind.AVATAR_EFFECT, descriptor).document.dependencies
    assert edge.optional is True

    with pytest.raises(ContentDocumentError) as refused:
        _parse(
            ContentKind.GESTURE,
            {
                "schema_version": 1,
                "content_type": "gesture",
                "content_id": "builtin:gesture:poke",
                "name": "Poke",
                "semantic_key": "poke",
                "implementation": {"kind": "vrma", "file_role": "animation"},
                "files": [{"path": "poke.vrma", "role": "animation"}],
                "dependencies": [{"ref": SOUND, "content_type": "sound_effect", "optional": True}],
            },
        )
    assert refused.value.code == "dependency_optional_not_allowed"
    descriptor["dependencies"] = [{"ref": SOUND, "content_type": "sound_effect", "optional": "yes"}]
    with pytest.raises(ContentDocumentError):
        _parse(ContentKind.AVATAR_EFFECT, descriptor)


def test_the_included_scan_drops_an_optional_sound_that_is_not_installed(tmp_path: Path) -> None:
    core, pack, local = tmp_path / "core", tmp_path / "pack", tmp_path / "local"
    local.mkdir()
    _inventory(core)
    _effect(core)
    _inventory(pack, {"glob": "**", "distribution": "non-portable", **_RULE})
    _sound(pack)

    def scan(*sources: IncludedContentSource) -> dict[str, Any]:
        store = FilesystemContentStore(
            included_root=core,
            local_root=local,
            operations_root=tmp_path / "operations",
            included_sources=sources,
            restricted_sha256=frozenset(),
        )
        return _by_locator(store.scan(ContentSource.INCLUDED))

    core_source = IncludedContentSource("core", "v1", core, None)
    without = scan(core_source)[EFFECT]
    assert without.status is ContentStatus.VALID
    assert without.dependencies == ()
    assert "dependencies" not in without.metadata or without.metadata["dependencies"] == []
    assert "soundAlias" not in without.metadata["definition"]

    with_pack = scan(core_source, IncludedContentSource("wow-comedy-sfx", "v1", pack, "wow-comedy-sfx"))
    effect = with_pack[EFFECT]
    assert effect.dependencies == (SOUND,)
    assert effect.metadata["definition"]["soundAlias"] == "on-apply"
    assert with_pack["sfx/wow-comedy/pop.ogg"].provenance["distribution"] == "non-portable"
    # Mounting the pack changes the effect's content, so its revision differs.
    assert effect.revision_sha256 != without.revision_sha256

    # The single-root (self-host) scan resolves optional edges too.
    single = FilesystemContentStore(
        included_root=core, local_root=local, operations_root=tmp_path / "operations", restricted_sha256=frozenset()
    )
    assert _by_locator(single.scan(ContentSource.INCLUDED))[EFFECT].dependencies == ()


def test_starter_staging_admits_an_effect_whose_optional_sound_is_excluded(tmp_path: Path) -> None:
    root = copy_tracked_included(tmp_path / "included")
    descriptor = root / EFFECT / "sweat_drop.json"
    document = json.loads(descriptor.read_text(encoding="utf-8"))
    document["dependencies"] = [{"ref": SOUND, "content_type": "sound_effect", "alias": "on-apply", "optional": True}]
    document["definition"]["soundAlias"] = "on-apply"
    write_json(descriptor, document)
    _sound(root)
    license_path = root / "licenses/inventory.json"
    policy = json.loads(license_path.read_text(encoding="utf-8"))
    policy["rules"].insert(0, {"glob": "sfx/**", "distribution": "non-portable", **_RULE})
    write_json(license_path, policy)

    inventory = starter_inventory(root)

    assert {"locator": "sfx/wow-comedy/pop.ogg", "reason": "non_portable"} in inventory["excluded"]
    [effect] = [entry for entry in inventory["entries"] if entry["locator"] == EFFECT]
    assert effect["dependencies"] == []
    assert all(not starter["diagnostics"] for starter in inventory["starters"])


async def test_local_content_cannot_use_optional_edges_or_non_portable_sounds(  # noqa: ANN001
    async_session, tmp_path: Path
) -> None:
    paths, _catalog, content, _saves, _packages = package_services(async_session, tmp_path)
    _inventory(
        paths.included_root, {"glob": "sfx/**", "distribution": "non-portable", **_RULE}, {"glob": "**", **_RULE}
    )
    _sound(paths.included_root)
    _effect(paths.local_root, optional=True, content_id="local:avatar-effect:optional")
    required = paths.local_root / "vfx/avatar/required"
    shutil.copytree(paths.local_root / EFFECT, required)
    (required / "sweat_drop.json").rename(required / "required.json")
    document = json.loads((required / "required.json").read_text(encoding="utf-8"))
    document["content_id"] = "local:avatar-effect:required"
    document["dependencies"][0].pop("optional")
    write_json(required / "required.json", document)
    owner = "package-owner"
    try:
        items = {item.relative_locator: item for item in (await content.rescan(user_id=owner)).items}
        optional, needs = items[EFFECT], items["vfx/avatar/required"]
        assert optional.status is ContentStatus.INVALID
        assert "dependency_optional_not_allowed" in {d.code for d in optional.diagnostics}
        assert needs.status is ContentStatus.INVALID
        assert "non_portable_dependency" in {d.code for d in needs.diagnostics}
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_export_leaves_out_an_optional_non_portable_sound(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths, _catalog, content, _saves, packages = package_services(async_session, tmp_path)
    _inventory(
        paths.included_root, {"glob": "sfx/**", "distribution": "non-portable", **_RULE}, {"glob": "**", **_RULE}
    )
    payload = _sound(paths.included_root)
    _effect(paths.included_root)
    owner = "package-owner"
    try:
        items = {item.relative_locator: item for item in (await content.rescan(user_id=owner)).items}
        effect, sound = items[EFFECT], items["sfx/wow-comedy/pop.ogg"]
        assert effect.status is ContentStatus.VALID and sound.id in effect.dependency_item_ids

        # A non-portable sound is still refused as a root.
        with pytest.raises(ContentConflictError) as refused:
            await packages.summarize(user_id=owner, item_ids=(sound.id,))
        assert refused.value.code == "package_non_portable"

        summary = await packages.summarize(user_id=owner, item_ids=(effect.id,))
        assert [(item.kind, item.name) for item in summary.omitted] == [("sound_effect", "Pop")]
        review = await packages.prepare_export(user_id=owner, item_ids=(effect.id,), expected_digest=summary.digest)
        cached = await packages.get_export(user_id=owner, export_id=review.export_id)
        with ZipFile(cached.path) as archive:
            manifest = json.loads(archive.read("package.json"))
            members = {name: archive.read(name) for name in archive.namelist()}
        [entry] = manifest["entries"]
        assert entry["kind"] == "avatar_effect" and entry["dependencies"] == []
        assert "non_portable_references" not in manifest
        assert payload not in members.values()
        descriptor = next(
            json.loads(data) for name, data in members.items() if name.endswith(".json") and name != "package.json"
        )
        assert descriptor.get("dependencies", []) == []
        assert "soundAlias" not in descriptor["definition"]
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_a_required_non_portable_sound_still_blocks_export(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths, _catalog, content, _saves, packages = package_services(async_session, tmp_path)
    _inventory(
        paths.included_root, {"glob": "sfx/**", "distribution": "non-portable", **_RULE}, {"glob": "**", **_RULE}
    )
    _sound(paths.included_root)
    _effect(paths.included_root, optional=False)
    owner = "package-owner"
    try:
        items = {item.relative_locator: item for item in (await content.rescan(user_id=owner)).items}
        with pytest.raises(ContentConflictError) as refused:
            await packages.summarize(user_id=owner, item_ids=(items[EFFECT].id,))
        assert refused.value.code == "package_non_portable" and refused.value.items == ("Pop",)
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


@pytest.mark.parametrize("optional", [False, True])
async def test_saving_own_content_with_a_licensed_sound_is_refused_and_rolled_back(  # noqa: ANN001
    async_session, tmp_path: Path, optional: bool
) -> None:
    paths, _catalog, content, saves, _packages = package_services(async_session, tmp_path)
    # A required edge targets a licensed sound; an optional one is refused even
    # for a portable sound, because only built-in effects may declare it.
    rules = [{"glob": "**", **_RULE}] if optional else [{"glob": "sfx/**", "distribution": "non-portable", **_RULE}]
    _inventory(paths.included_root, *rules, {"glob": "**", **_RULE})
    _sound(paths.included_root)
    source = ROOT / "content/included" / EFFECT
    document = json.loads((source / "sweat_drop.json").read_text(encoding="utf-8"))
    document["content_id"] = "local:avatar-effect:copy"
    edge: dict[str, Any] = {"ref": SOUND, "content_type": "sound_effect", "alias": "on-apply"}
    if optional:
        edge["optional"] = True
    document["dependencies"] = [edge]
    document["definition"]["soundAlias"] = "on-apply"
    owner = "package-owner"
    try:
        await content.rescan(user_id=owner)
        with pytest.raises(ContentConflictError) as refused:
            await saves.save_descriptor(
                user_id=owner,
                kind=ContentKind.AVATAR_EFFECT,
                entry_name="Copy",
                descriptor=json.dumps(document).encode(),
                companion_files={"sweat_drop.png": (source / "sweat_drop.png").read_bytes()},
                operation_id=f"save-licensed-sound-{optional}",
                catalog_item_id=None,
                expected_revision=None,
            )
        expected = "content_optional_dependency" if optional else "content_non_portable_dependency"
        assert refused.value.code == expected
        assert not list((paths.local_root / "vfx").rglob("*.json"))
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()
