"""Scene Effects saved with a Twemoji item outlive the removal of Twemoji.

Animama no longer provides Twemoji (R11): the creator offers its own sticker
set instead, and there is no automatic conversion. A Local Scene Effect that
still contains an ``emoji`` item stays valid, plays without the item, and
carries a ``scene_emoji_item_removed`` diagnostic per item, so Content Health
lists it and its creator asks for a replacement. Save, package import and
Portable export refuse such an item by name.
"""

from __future__ import annotations

import copy
import hashlib
import json
import shutil
import uuid
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete

from animama.adapters.content_store import FilesystemContentStore
from animama.app.contracts.content_package import portable_revision
from animama.app.services import content_package_capabilities
from animama.app.services.content_package_capabilities import (
    SUPPORTED_CAPABILITIES,
    derive_document_capabilities,
    validate_declared_capabilities,
)
from animama.domain.content_catalog import (
    SCENE_EMOJI_ITEM_REMOVED,
    CatalogContentEntry,
    ContentConflictError,
    ContentKind,
    ContentSource,
    ContentStatus,
)
from animama.domain.content_documents import ContentDocumentError
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services
from tests.test_content_package_capabilities import _document
from tests.test_content_package_v3_archive import inspector, write_package
from tests.test_scene_effect_limits import ALL_LAYERS

OWNER = "scene-emoji-owner"
REPOSITORY = Path(__file__).parents[1]
EMOJI = {"id": "sparkle", "kind": "emoji", "label": "Sparkles", "emoji": "✨", "provider": "twemoji"}


def _definition(*, marquee: list[dict[str, Any]] | None = None, scatter: list[dict[str, Any]] | None = None):
    """A background with a marquee and one scatter layer holding ``marquee``/``scatter`` items."""

    definition = {
        key: copy.deepcopy(value)
        for key, value in ALL_LAYERS.items()
        if key not in {"gradient", "tile", "screen", "scatters", "flash"}
    }
    definition["marquee"]["enabled"] = True
    definition["marquee"]["items"] = copy.deepcopy(marquee if marquee is not None else [EMOJI])
    layer = copy.deepcopy(ALL_LAYERS["scatters"][1])
    layer["items"] = copy.deepcopy(scatter if scatter is not None else [{**EMOJI, "id": "star", "emoji": "⭐"}])
    definition["scatters"] = [layer]
    return definition


def _descriptor(definition: dict[str, Any], *, name: str = "Old sparkles") -> dict[str, Any]:
    return {
        "schema_version": 1,
        "content_type": "scene_effect",
        "name": name,
        "definition": definition,
        "files": [],
    }


def _write_scene(root: Path, definition: dict[str, Any]) -> None:
    folder = root / "vfx/scene/old-sparkles"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "old-sparkles.json").write_text(json.dumps(_descriptor(definition)))


def _store(tmp_path: Path) -> FilesystemContentStore:
    for name in ("included", "local", "operations"):
        (tmp_path / name).mkdir(exist_ok=True)
    return FilesystemContentStore(
        included_root=tmp_path / "included", local_root=tmp_path / "local", operations_root=tmp_path / "operations"
    )


def test_twemoji_capabilities_and_allowlist_are_gone() -> None:
    assert not any(capability.startswith("animama/twemoji/") for capability in SUPPORTED_CAPABILITIES)
    assert not hasattr(content_package_capabilities, "BUILTIN_EMOJI")


def test_a_package_declaring_twemoji_is_refused_by_name() -> None:
    with pytest.raises(ContentDocumentError) as refused:
        validate_declared_capabilities(["animama/scene-effect/1", "animama/twemoji/14.0.2/2728"])
    assert refused.value.code == SCENE_EMOJI_ITEM_REMOVED
    assert "Twemoji" in str(refused.value)


@pytest.mark.parametrize(
    ("definition", "field"),
    [
        (_definition(scatter=[]), "marquee.items.0"),
        (_definition(marquee=[]), "scatters.0.items.0"),
    ],
)
def test_package_data_with_an_emoji_item_is_refused_by_name(definition: dict[str, Any], field: str) -> None:
    """Package import and export derive capabilities from the definition."""

    with pytest.raises(ContentDocumentError) as refused:
        derive_document_capabilities(_document("scene_effect", definition=definition))
    assert refused.value.code == SCENE_EMOJI_ITEM_REMOVED
    assert refused.value.field == field


def test_scan_admits_a_local_scene_with_emoji_items_and_names_each(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _write_scene(tmp_path / "local", _definition())
    [entry] = store.scan(ContentSource.LOCAL)
    assert entry.status is ContentStatus.VALID
    assert [diagnostic.code for diagnostic in entry.diagnostics] == [SCENE_EMOJI_ITEM_REMOVED] * 2
    messages = [diagnostic.message for diagnostic in entry.diagnostics]
    assert "marquee.items.0" in messages[0] and "Sparkles" in messages[0]
    assert "scatters.0.items.0" in messages[1]


def test_an_emoji_item_does_not_hide_other_definition_errors(tmp_path: Path) -> None:
    store = _store(tmp_path)
    definition = _definition()
    definition["marquee"]["itemSize"] = 100_000
    _write_scene(tmp_path / "local", definition)
    [entry] = store.scan(ContentSource.LOCAL)
    assert entry.status is ContentStatus.INVALID
    codes = {diagnostic.code for diagnostic in entry.diagnostics}
    assert codes == {SCENE_EMOJI_ITEM_REMOVED, "scene_definition_invalid"}


def test_an_emoji_only_scatter_layer_keeps_later_layers_named_by_their_index(tmp_path: Path) -> None:
    """Diagnostics name scatter layers as the creator and Save do, emoji-only ones counted."""

    store = _store(tmp_path)
    definition = _definition(marquee=[])
    invalid = copy.deepcopy(definition["scatters"][0])
    invalid["items"] = []
    definition["scatters"].append(invalid)
    _write_scene(tmp_path / "local", definition)
    [entry] = store.scan(ContentSource.LOCAL)
    assert entry.status is ContentStatus.INVALID
    [emoji, refused] = entry.diagnostics
    assert emoji.code == SCENE_EMOJI_ITEM_REMOVED
    assert "scatters.0.items.0" in emoji.message
    assert refused.code == "scene_definition_invalid"
    assert "scatters.1.items" in refused.message


def test_an_included_scene_with_an_emoji_item_is_invalid(tmp_path: Path) -> None:
    """Only Local content saved before the removal outlives it."""

    store = _store(tmp_path)
    licenses = tmp_path / "included/licenses"
    licenses.mkdir(parents=True)
    shutil.copy(REPOSITORY / "content/included/licenses/inventory.json", licenses / "inventory.json")
    _write_scene(tmp_path / "included", _definition())
    [entry] = store.scan(ContentSource.INCLUDED)
    assert entry.status is ContentStatus.INVALID
    assert SCENE_EMOJI_ITEM_REMOVED in {diagnostic.code for diagnostic in entry.diagnostics}


@pytest.fixture
async def _cleanup(async_session):
    yield
    await async_session.rollback()
    await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == OWNER))
    await async_session.commit()


async def _scene(catalog: Any) -> CatalogContentEntry:
    scene: CatalogContentEntry
    [scene] = [item for item in await catalog.list_visible(user_id=OWNER) if item.kind is ContentKind.SCENE_EFFECT]
    return scene


@pytest.mark.usefixtures("_cleanup")
async def test_save_refuses_an_emoji_item_by_field(async_session, tmp_path) -> None:
    _, catalog, _, saves, _ = package_services(async_session, tmp_path)
    with pytest.raises(ContentConflictError) as refused:
        await saves.save_descriptor(
            user_id=OWNER,
            kind=ContentKind.SCENE_EFFECT,
            entry_name="Old sparkles",
            descriptor=json.dumps(_descriptor(_definition(marquee=[]))).encode(),
            companion_files={},
            operation_id=str(uuid.uuid4()),
            catalog_item_id=None,
            expected_revision=None,
        )
    assert refused.value.code == "saved_content_invalid"
    assert refused.value.field == "scatters.0.items.0"
    assert not [item for item in await catalog.list_visible(user_id=OWNER) if item.kind is ContentKind.SCENE_EFFECT]


@pytest.mark.usefixtures("_cleanup")
async def test_a_local_scene_with_emoji_stays_valid_until_replaced(async_session, tmp_path) -> None:
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    _write_scene(paths.local_root, _definition())
    await content.rescan(user_id=OWNER)
    scene = await _scene(catalog)
    assert scene.status is ContentStatus.VALID
    assert [diagnostic.code for diagnostic in scene.diagnostics] == [SCENE_EMOJI_ITEM_REMOVED] * 2

    # Portable export names it until its creator replaces the items.
    with pytest.raises(ContentConflictError) as refused:
        await packages.summarize(user_id=OWNER, item_ids=(scene.id,))
    assert refused.value.code == SCENE_EMOJI_ITEM_REMOVED
    assert refused.value.items == ("Old sparkles",)

    # Saving it without the emoji items (and the scatter layer they filled)
    # clears the diagnostics.
    repaired = _definition(marquee=[])
    del repaired["scatters"]
    saved = await saves.save_descriptor(
        user_id=OWNER,
        kind=ContentKind.SCENE_EFFECT,
        entry_name="Old sparkles",
        descriptor=json.dumps(_descriptor(repaired)).encode(),
        companion_files={},
        operation_id=str(uuid.uuid4()),
        catalog_item_id=scene.id,
        expected_revision=scene.revision_sha256,
    )
    assert saved.item.status is ContentStatus.VALID
    assert saved.item.diagnostics == ()


def _scene_archive(tmp_path: Path, definition: dict[str, Any], *, capabilities: list[str]) -> Path:
    """A Portable package holding one Scene Effect with ``definition``."""

    payload = json.dumps({**_descriptor(definition), "content_id": "scene", "dependencies": []}).encode()
    archive_path = "entries/scene/old-sparkles.json"
    files = [
        {
            "archive_path": archive_path,
            "relative_path": "old-sparkles.json",
            "role": "descriptor",
            "ordinal": 1,
            "media_type": "application/json",
            "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
    ]
    manifest = {
        "schema": "animama-content-package/3",
        "kind": "content",
        "root_entry_ids": ["scene"],
        "entries": [
            {
                "package_entry_id": "scene",
                "kind": "scene_effect",
                "logical_key": "scene",
                "display_name": "Old sparkles",
                "portable_revision_sha256": portable_revision(files),
                "dependencies": [],
                "files": files,
            }
        ],
        "avatar_portraits": [],
        "capabilities": capabilities,
    }
    archive = tmp_path / "old-sparkles.zip"
    write_package(archive, manifest, {archive_path: payload})
    return archive


def _without_scatters(definition: dict[str, Any]) -> dict[str, Any]:
    del definition["scatters"]
    return definition


def test_package_import_accepts_the_scene_without_emoji_items(tmp_path: Path) -> None:
    """The archive the refusals below start from imports once its emoji items are gone."""

    archive = _scene_archive(
        tmp_path, _without_scatters(_definition(marquee=[])), capabilities=["animama/scene-effect/1"]
    )
    assert set(inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection").entries) == {"scene"}


@pytest.mark.parametrize(
    ("definition", "capabilities"),
    [
        (_without_scatters(_definition()), ["animama/scene-effect/1"]),
        (_definition(marquee=[]), ["animama/scene-effect/1"]),
        (
            _without_scatters(_definition(marquee=[])),
            ["animama/scene-effect/1", "animama/twemoji/14.0.2/2728"],
        ),
    ],
    ids=["marquee-emoji", "scatter-emoji", "declares-twemoji"],
)
def test_package_import_refuses_emoji_by_name(
    tmp_path: Path, definition: dict[str, Any], capabilities: list[str]
) -> None:
    archive = _scene_archive(tmp_path, definition, capabilities=capabilities)
    with pytest.raises(ContentConflictError) as refused:
        inspector(tmp_path).inspect(archive, destination=tmp_path / "inspection")
    assert refused.value.code == SCENE_EMOJI_ITEM_REMOVED
    assert not (tmp_path / "inspection").exists()
