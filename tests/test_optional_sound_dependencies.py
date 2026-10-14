"""Built-in effects keep working, silently, when their licensed sound is absent.

An Included Avatar or Scene Effect may declare its sound edge ``optional``. The
Included scan drops an optional edge whose sound isn't installed, so every
consumer sees an ordinary effect without a sound. Local content never declares
optional edges and never depends on non-portable sounds.
"""

from __future__ import annotations

import base64
import hashlib
import json
import shutil
import zlib
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import pytest
from sqlalchemy import delete

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.contracts.content_package import portable_revision
from animama.app.services.content_kind_registry import handler_for_kind
from animama.domain.content_catalog import (
    ContentConflictError,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
)
from animama.domain.content_documents import ContentDocumentError
from animama.domain.content_sources import IncludedContentSource
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.runtime.starter_content import starter_inventory
from tests.anima_creation_service_support import copy_tracked_included, write_json
from tests.content_package_helpers import package_services, reviewed_import
from tests.test_content_audio import _VORBIS_SILENCE_ZLIB_BASE64
from tests.test_content_package_v3_archive import inspector, sound_package, write_package

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
    image = document["definition"]["art"]["image"]
    owner = "package-owner"
    try:
        await content.rescan(user_id=owner)
        with pytest.raises(ContentConflictError) as refused:
            await saves.save_descriptor(
                user_id=owner,
                kind=ContentKind.AVATAR_EFFECT,
                entry_name="Copy",
                descriptor=json.dumps(document).encode(),
                companion_files={image: (source / image).read_bytes()},
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


async def test_unmounting_the_pack_keeps_effects_valid_and_remounting_restores_the_sound(  # noqa: ANN001
    async_session, tmp_path: Path
) -> None:
    core, pack, local = tmp_path / "core", tmp_path / "pack", tmp_path / "local"
    local.mkdir()
    _inventory(core)
    _effect(core)
    _inventory(pack, {"glob": "**", "distribution": "non-portable", **_RULE})
    _sound(pack)
    core_source = IncludedContentSource("core", "v1", core, None)
    pack_source = IncludedContentSource("wow-comedy-sfx", "v1", pack, "wow-comedy-sfx")
    repository = SQLAlchemyContentCatalog(async_session)

    async def reconcile(*sources: IncludedContentSource) -> dict[str, Any]:
        store = FilesystemContentStore(
            included_root=core,
            local_root=local,
            operations_root=tmp_path / "operations",
            included_sources=sources,
            restricted_sha256=frozenset(),
        )
        await repository.lock_source(source=ContentSource.INCLUDED)
        items = await repository.reconcile_source(
            source=ContentSource.INCLUDED,
            entries=store.scan(ContentSource.INCLUDED),
            active_included_mount_ids=store.included_mount_ids,
            new_item_scope=ContentScope.INCLUDED,
            new_item_owner_user_id=None,
        )
        await async_session.commit()
        return _by_locator(items)

    try:
        mounted = await reconcile(core_source, pack_source)
        sound = mounted["sfx/wow-comedy/pop.ogg"]
        assert mounted[EFFECT].dependency_item_ids == (sound.id,)

        # A build without the pack: the effect keeps its identity, stays valid and is silent.
        unmounted = await reconcile(core_source)
        effect = unmounted[EFFECT]
        assert effect.id == mounted[EFFECT].id and effect.status is ContentStatus.VALID
        assert effect.dependencies == () and "sfx/wow-comedy/pop.ogg" not in unmounted

        remounted = await reconcile(core_source, pack_source)
        assert remounted[EFFECT].dependencies == (SOUND,)
        assert remounted[EFFECT].status is ContentStatus.VALID
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_a_kept_optional_sound_exports_as_an_ordinary_edge_and_imports(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths, receiver_catalog, content, _saves, packages = package_services(async_session, tmp_path)
    _inventory(paths.included_root)
    _sound(paths.included_root)
    _effect(paths.included_root)
    owner = "package-owner"
    try:
        items = {item.relative_locator: item for item in (await content.rescan(user_id=owner)).items}
        summary = await packages.summarize(user_id=owner, item_ids=(items[EFFECT].id,))
        assert summary.omitted == ()
        review = await packages.prepare_export(
            user_id=owner, item_ids=(items[EFFECT].id,), expected_digest=summary.digest
        )
        cached = await packages.get_export(user_id=owner, export_id=review.export_id)
        with ZipFile(cached.path) as archive:
            manifest = json.loads(archive.read("package.json"))
            effect_entry = next(entry for entry in manifest["entries"] if entry["kind"] == "avatar_effect")
            [descriptor] = [
                json.loads(archive.read(file["archive_path"]))
                for file in effect_entry["files"]
                if file["role"] == "descriptor"
            ]
        [edge] = descriptor["dependencies"]
        assert "optional" not in edge and descriptor["definition"]["soundAlias"] == edge["alias"]

        command = await reviewed_import(packages, user_id=owner, archive_path=cached.path, operation_id="optional-kept")
        result = await packages.imports.commit(**command)
        imported = next(item for item in result.items if item.kind is ContentKind.AVATAR_EFFECT)
        copy = await receiver_catalog.get_visible_item(item_id=imported.item_id, user_id=owner)
        assert copy.status is ContentStatus.VALID and len(copy.dependency_item_ids) == 1
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


def test_package_inspection_refuses_an_optional_edge(tmp_path: Path) -> None:
    manifest, payloads = sound_package()
    source = ROOT / "content/included" / EFFECT
    descriptor = json.loads((source / "sweat_drop.json").read_text(encoding="utf-8"))
    descriptor.update(
        content_id="effect",
        dependencies=[{"ref": "sound", "content_type": "sound_effect", "alias": "on-apply", "optional": True}],
    )
    descriptor["definition"]["soundAlias"] = "on-apply"
    image = descriptor["definition"]["art"]["image"]
    effect_payloads = {
        "entries/0001/effect.json": json.dumps(descriptor).encode(),
        f"entries/0001/{image}": (source / image).read_bytes(),
    }
    files = [
        {
            "archive_path": archive_path,
            "relative_path": Path(archive_path).name,
            "role": "descriptor" if archive_path.endswith(".json") else "image",
            "ordinal": index,
            "media_type": "application/json" if archive_path.endswith(".json") else "image/png",
            "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        for index, (archive_path, payload) in enumerate(effect_payloads.items(), 1)
    ]
    manifest["entries"].append(
        {
            "package_entry_id": "effect",
            "kind": "avatar_effect",
            "logical_key": "effect",
            "display_name": "Sweat Drop",
            "portable_revision_sha256": portable_revision(files),
            "dependencies": [{"ref": "sound", "content_type": "sound_effect"}],
            "files": files,
        }
    )
    manifest["root_entry_ids"] = ["effect"]
    archive = tmp_path / "optional.zip"
    write_package(archive, manifest, {**payloads, **effect_payloads})

    with pytest.raises(ContentConflictError) as refused:
        inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    assert refused.value.code == "package_optional_dependency" and refused.value.items == ("Sweat Drop",)


async def test_licensed_sound_bytes_cannot_be_saved_as_own_content(  # noqa: ANN001
    async_session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = _vorbis()
    restricted = frozenset({hashlib.sha256(payload).hexdigest()})
    monkeypatch.setattr("animama.adapters.content_store.filesystem_store.manifest_sha256", lambda: restricted)
    _paths, _catalog, _content, saves, _packages = package_services(async_session, tmp_path)
    try:
        with pytest.raises(ContentConflictError) as refused:
            await saves.save_standalone(
                user_id="package-owner",
                kind=ContentKind.SOUND_EFFECT,
                entry_name="Copied",
                filename="copied.ogg",
                payload=payload,
                metadata_sidecar=None,
                operation_id="save-licensed-ogg",
                catalog_item_id=None,
                expected_revision=None,
            )
        assert refused.value.code == "content_non_portable"
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()
