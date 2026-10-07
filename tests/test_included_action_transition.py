"""Immutable legacy Actions retain their consumed behavior in Local copies."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from sqlalchemy import delete, select

from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
from animama.app.services.content_transition_service import ContentTransitionService
from animama.app.services.typed_content_service import TypedContentService
from animama.domain.content_catalog import ContentKind, ContentSource, ContentStatus
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMAnimaContentBinding, ORMContentCatalogItem
from tests.content_package_helpers import package_services
from tests.test_action_clip_transition import _write_fixture
from tests.typed_loadout_support import cleanup_loadout_fixture, create_loadout_fixture


def _included_fixture(content, paths) -> None:  # noqa: ANN001
    _write_fixture(content)
    for path in paths.local_root.rglob("*.json"):
        value = json.loads(path.read_bytes())
        value["provenance"] = {"creator": "Animama transition fixture", "license": "CC0"}
        if value.get("schema") == "animaPoseClip/1.0":
            value["loop"] = False
        path.write_text(json.dumps(value))
    for child in paths.local_root.iterdir():
        if child.is_dir() and any(child.rglob("*.json")):
            shutil.copytree(child, paths.included_root / child.name, dirs_exist_ok=True)
            shutil.rmtree(child)
    style = {
        "schema_version": 2,
        "content_type": "idle_style",
        "content_id": "local:idle-style:included-consumer",
        "name": "Included consumer",
        "default_pool": ["local:gesture:owned"],
        "cells": {},
        "dependencies": [{"ref": "local:gesture:owned", "content_type": "gesture"}],
        "provenance": {"creator": "Animama transition fixture", "license": "CC0"},
    }
    for source in ("local", "included"):
        root = paths.local_root if source == "local" else paths.included_root
        folder = root / "idle-styles" / f"{source}-consumer"
        folder.mkdir(parents=True)
        (folder / f"{source}-consumer.json").write_text(
            json.dumps({**style, "content_id": f"{source}:idle-style:consumer"})
        )


def _bytes(root: Path) -> dict[str, bytes]:
    return {str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()}


@pytest.mark.parametrize("interrupt", [False, True])
async def test_included_actions_styles_and_bindings_convert_together_and_survive_restart(
    async_session, tmp_path, interrupt: bool
) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    _included_fixture(content, paths)
    try:
        await content.rescan(user_id=fixture.user_id)
        visible = await catalog.list_visible(user_id=fixture.user_id)
        included = {
            item.kind: item
            for item in visible
            if item.source is ContentSource.INCLUDED
            and item.kind in {ContentKind.GESTURE, ContentKind.REACTION, ContentKind.IDLE_STYLE}
        }
        local_style = next(
            item for item in visible if item.kind is ContentKind.IDLE_STYLE and item.source is ContentSource.LOCAL
        )
        assert all(item.status is ContentStatus.VALID for item in visible)
        for kind, slot in (
            (ContentKind.GESTURE, "gesture:authored-selector"),
            (ContentKind.REACTION, "reaction:joy-2"),
            (ContentKind.IDLE_STYLE, "idle-style"),
        ):
            async_session.add(
                ORMAnimaContentBinding(
                    id=f"{fixture.suffix}-{kind.value}",
                    anima_id=fixture.anima_id,
                    kind=kind.value,
                    slot_key=slot,
                    catalog_item_id=included[kind].id,
                    config={"weight": 0.4} if kind is not ContentKind.IDLE_STYLE else {},
                )
            )
        await async_session.commit()
        immutable = _bytes(paths.included_root)
        local_before = _bytes(paths.local_root)

        class Interrupted(SQLAlchemyContentTransitionBindings):
            async def replace_content(self, **kwargs):  # noqa: ANN003, ANN202
                await super().replace_content(**kwargs)
                raise RuntimeError("interrupt after Included binding remap")

        if interrupt:
            with pytest.raises(RuntimeError, match="interrupt after Included binding remap"):
                await ContentTransitionService(content=content, bindings=Interrupted(async_session)).transition(
                    user_id=fixture.user_id
                )
            assert _bytes(paths.included_root) == immutable
            assert _bytes(paths.local_root) == local_before
            root = await async_session.get(ORMAnimaLoadout, fixture.anima_id, populate_existing=True)
            assert root.revision == 1
        _, catalog, content, _, _ = package_services(async_session, tmp_path)
        service = ContentTransitionService(content=content, bindings=SQLAlchemyContentTransitionBindings(async_session))
        await service.transition(user_id=fixture.user_id)
        bindings = list(
            (
                await async_session.scalars(
                    select(ORMAnimaContentBinding).where(ORMAnimaContentBinding.anima_id == fixture.anima_id)
                )
            ).all()
        )
        assert len(bindings) == 3
        converted = {}
        for binding in bindings:
            value = await catalog.get_visible_item(item_id=binding.catalog_item_id, user_id=fixture.user_id)
            assert value.source is ContentSource.LOCAL
            assert value.status is ContentStatus.VALID
            assert binding.id == f"{fixture.suffix}-{binding.kind}"
            assert binding.config == ({"weight": 0.4} if binding.kind != "idle_style" else {})
            converted[binding.kind] = value
        assert converted["gesture"].metadata["semantic_key"] == "authored-selector"
        assert converted["reaction"].metadata["placement_hint"] == {"emotion": "joy", "intensity": 2}
        assert converted["idle_style"].metadata["default_pool"] == [converted["gesture"].logical_key]
        preserved_style = await catalog.get_visible_item(item_id=local_style.id, user_id=fixture.user_id)
        assert preserved_style.metadata["default_pool"] == [converted["gesture"].logical_key]
        assert (await async_session.get(ORMAnimaLoadout, fixture.anima_id, populate_existing=True)).revision == 2
        assert _bytes(paths.included_root) == immutable
        assert list(paths.operations_root.rglob("*.original"))
        selectable = await TypedContentService(catalog=catalog, content=content).list_kind(
            user_id=fixture.user_id, kind=ContentKind.IDLE_STYLE
        )
        assert all(item.item.id != included[ContentKind.IDLE_STYLE].id for item in selectable)
        gesture = converted["gesture"]
        descriptor = paths.local_root / gesture.relative_locator / (Path(gesture.relative_locator).name + ".meta.json")
        edited = json.loads(descriptor.read_bytes())
        edited["name"] = "Later local edit"
        descriptor.write_text(json.dumps(edited))
        await service.transition(user_id=fixture.user_id)
        assert (
            await catalog.get_visible_item(item_id=gesture.id, user_id=fixture.user_id)
        ).display_name == "Later local edit"
        assert (await async_session.get(ORMAnimaLoadout, fixture.anima_id, populate_existing=True)).revision == 2
        assert _bytes(paths.included_root) == immutable
        # A later Included source addition must not cause existing completed
        # copies (including the user's edit) to be republished or duplicated.
        folder = paths.included_root / "reactions/later"
        folder.mkdir()
        later = json.loads((paths.included_root / "reactions/owned/owned.meta.json").read_bytes())
        later["content_id"] = "included:reaction:later"
        later["name"] = "Later Included Action"
        (folder / "later.meta.json").write_text(json.dumps(later))
        await service.transition(user_id=fixture.user_id)
        assert (
            await catalog.get_visible_item(item_id=gesture.id, user_id=fixture.user_id)
        ).display_name == "Later local edit"
        local_reactions = [
            item
            for item in await catalog.list_visible(user_id=fixture.user_id)
            if item.source is ContentSource.LOCAL and item.kind is ContentKind.REACTION
        ]
        assert len(local_reactions) == 2
        assert (await async_session.get(ORMAnimaLoadout, fixture.anima_id, populate_existing=True)).revision == 2
    finally:
        await async_session.rollback()
        await cleanup_loadout_fixture(async_session, fixture)
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.source == "included"))
        await async_session.commit()


@pytest.mark.parametrize("delete_completed_copy", [False, True], ids=["edited-copy", "deleted-copy"])
async def test_later_styles_and_consumers_respect_completed_action_copy(
    async_session, tmp_path, delete_completed_copy: bool
) -> None:  # noqa: ANN001
    """A prior checkpoint remains authoritative for consumers added on later scans."""
    fixture = await create_loadout_fixture(async_session)
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    _included_fixture(content, paths)
    # Complete the Action conversion before either new Style or binding exists.
    for root in (paths.local_root, paths.included_root):
        shutil.rmtree(root / "idle-styles")
    try:
        service = ContentTransitionService(content=content, bindings=SQLAlchemyContentTransitionBindings(async_session))
        await service.transition(user_id=fixture.user_id)
        visible = await catalog.list_visible(user_id=fixture.user_id)
        original = next(
            item for item in visible if item.kind is ContentKind.GESTURE and item.source is ContentSource.INCLUDED
        )
        completed = next(
            item for item in visible if item.kind is ContentKind.GESTURE and item.source is ContentSource.LOCAL
        )
        descriptor = (
            paths.local_root / completed.relative_locator / (Path(completed.relative_locator).name + ".meta.json")
        )
        edited = json.loads(descriptor.read_bytes())
        edited["name"] = "Owner's later Action edit"
        edited["config"]["time_scale"] = 1.5
        descriptor.write_text(json.dumps(edited))
        edited_bytes = _bytes(descriptor.parent)
        if delete_completed_copy:
            shutil.rmtree(descriptor.parent)

        style = {
            "schema_version": 2,
            "content_type": "idle_style",
            "name": "Later Style",
            "default_pool": [original.logical_key],
            "cells": {"joy": {"2": {"mode": "pool", "gestures": [original.logical_key]}}},
            "dependencies": [{"ref": original.logical_key, "content_type": "gesture"}],
            "provenance": {"creator": "Animama transition fixture", "license": "CC0"},
        }
        for source, root in (("local", paths.local_root), ("included", paths.included_root)):
            folder = root / "idle-styles" / "later-consumer"
            folder.mkdir(parents=True)
            (folder / "later-consumer.json").write_text(
                json.dumps({**style, "content_id": f"{source}:idle-style:later-consumer"})
            )
        await content.rescan(user_id=fixture.user_id)
        styles = {
            item.source: item
            for item in await catalog.list_visible(user_id=fixture.user_id)
            if item.kind is ContentKind.IDLE_STYLE
        }
        for kind, slot, item in (
            (ContentKind.GESTURE, "gesture:authored-selector", original),
            (ContentKind.IDLE_STYLE, "idle-style", styles[ContentSource.INCLUDED]),
        ):
            async_session.add(
                ORMAnimaContentBinding(
                    id=f"{fixture.suffix}-{kind.value}",
                    anima_id=fixture.anima_id,
                    kind=kind.value,
                    slot_key=slot,
                    catalog_item_id=item.id,
                    config={"weight": 0.4} if kind is ContentKind.GESTURE else {},
                )
            )
        await async_session.commit()
        immutable = _bytes(paths.included_root)
        local_before = _bytes(paths.local_root)
        completed_state = None

        # Each pass starts fresh services, as startup would, over the same files
        # and receipts. A completed retry must not republish content or bindings.
        for _ in range(2):
            _, catalog, content, _, _ = package_services(async_session, tmp_path)
            await ContentTransitionService(
                content=content, bindings=SQLAlchemyContentTransitionBindings(async_session)
            ).transition(user_id=fixture.user_id)
            visible = await catalog.list_visible(user_id=fixture.user_id)
            by_id = {item.id: item for item in visible}
            bindings = {
                binding.kind: binding
                for binding in (
                    await async_session.scalars(
                        select(ORMAnimaContentBinding)
                        .where(ORMAnimaContentBinding.anima_id == fixture.anima_id)
                        .execution_options(populate_existing=True)
                    )
                ).all()
            }
            assert set(bindings) == {"gesture", "idle_style"}
            for kind, binding in bindings.items():
                assert binding.id == f"{fixture.suffix}-{kind}"
                assert binding.config == ({"weight": 0.4} if kind == "gesture" else {})
            assert _bytes(paths.included_root) == immutable
            typed = TypedContentService(catalog=catalog, content=content)
            selectable = await typed.list_kind(user_id=fixture.user_id, kind=ContentKind.IDLE_STYLE)
            revision = (await async_session.get(ORMAnimaLoadout, fixture.anima_id, populate_existing=True)).revision

            if delete_completed_copy:
                assert not descriptor.parent.exists()
                assert _bytes(paths.local_root) == local_before
                assert not selectable
                for source in styles.values():
                    unavailable = by_id[source.id]
                    assert unavailable.status is ContentStatus.INVALID
                    assert unavailable.diagnostics
                    assert all(diagnostic.code and diagnostic.message for diagnostic in unavailable.diagnostics)
                    assert all(str(tmp_path) not in diagnostic.message for diagnostic in unavailable.diagnostics)
                assert bindings["gesture"].catalog_item_id == original.id
                assert bindings["idle_style"].catalog_item_id == styles[ContentSource.INCLUDED].id
                assert revision == 1
            else:
                assert _bytes(descriptor.parent) == edited_bytes
                assert by_id[completed.id].display_name == "Owner's later Action edit"
                assert by_id[completed.id].metadata["config"]["time_scale"] == 1.5
                assert bindings["gesture"].catalog_item_id == completed.id
                copied_style = by_id[bindings["idle_style"].catalog_item_id]
                assert copied_style.source is ContentSource.LOCAL
                assert copied_style.id != styles[ContentSource.INCLUDED].id
                local_style = by_id[styles[ContentSource.LOCAL].id]
                assert local_style.relative_locator == styles[ContentSource.LOCAL].relative_locator
                assert local_style.logical_key == styles[ContentSource.LOCAL].logical_key
                for converted in (local_style, copied_style):
                    assert converted.status is ContentStatus.VALID
                    assert converted.metadata["default_pool"] == [completed.logical_key]
                    assert converted.metadata["cells"]["joy"]["2"]["gestures"] == [completed.logical_key]
                    assert converted.dependency_item_ids == (completed.id,)
                assert {item.item.id for item in selectable} == {local_style.id, copied_style.id}
                assert (
                    len(
                        [
                            item
                            for item in visible
                            if item.source is ContentSource.LOCAL and item.kind is ContentKind.GESTURE
                        ]
                    )
                    == 1
                )
                assert revision == 2
            state = (_bytes(paths.local_root), {kind: binding.catalog_item_id for kind, binding in bindings.items()})
            if completed_state is not None:
                assert state == completed_state
            completed_state = state
    finally:
        await async_session.rollback()
        await cleanup_loadout_fixture(async_session, fixture)
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.source == "included"))
        await async_session.commit()


async def test_non_portable_included_actions_are_never_copied_into_local(async_session, tmp_path) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    _included_fixture(content, paths)
    (paths.included_root / "licenses").mkdir(exist_ok=True)
    (paths.included_root / "licenses/inventory.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "rules": [
                    {"glob": "**", "creator": "Fixture", "license_id": "Fixture", "distribution": "non-portable"}
                ],
            }
        )
    )
    try:
        local_before = _bytes(paths.local_root)
        service = ContentTransitionService(content=content, bindings=SQLAlchemyContentTransitionBindings(async_session))
        await service.transition(user_id=fixture.user_id)
        visible = await catalog.list_visible(user_id=fixture.user_id)
        assert {item.kind for item in visible if item.source is ContentSource.INCLUDED} >= {
            ContentKind.GESTURE,
            ContentKind.REACTION,
        }
        assert not [
            item
            for item in visible
            if item.source is ContentSource.LOCAL and item.kind in {ContentKind.GESTURE, ContentKind.REACTION}
        ]
        assert _bytes(paths.local_root) == local_before
    finally:
        await async_session.rollback()
        await cleanup_loadout_fixture(async_session, fixture)
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.source == "included"))
        await async_session.commit()


async def test_portable_actions_never_copy_a_non_portable_clip_into_local(async_session, tmp_path) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    _included_fixture(content, paths)
    (paths.included_root / "licenses").mkdir(exist_ok=True)
    rule = {"creator": "Fixture", "license_id": "Fixture"}
    (paths.included_root / "licenses/inventory.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "rules": [{"glob": "pose-clips/**", "distribution": "non-portable", **rule}, {"glob": "**", **rule}],
            }
        )
    )
    try:
        local_before = _bytes(paths.local_root)
        service = ContentTransitionService(content=content, bindings=SQLAlchemyContentTransitionBindings(async_session))
        await service.transition(user_id=fixture.user_id)
        visible = await catalog.list_visible(user_id=fixture.user_id)
        included_actions = [
            item
            for item in visible
            if item.source is ContentSource.INCLUDED and item.kind in {ContentKind.GESTURE, ContentKind.REACTION}
        ]
        assert included_actions and all(item.provenance.get("distribution") is None for item in included_actions)
        # Skipped, not invalidated: the source stays usable as it was.
        assert all(item.status is ContentStatus.VALID and not item.diagnostics for item in included_actions)
        assert not [
            item
            for item in visible
            if item.source is ContentSource.LOCAL and item.kind in {ContentKind.GESTURE, ContentKind.REACTION}
        ]
        assert _bytes(paths.local_root) == local_before
    finally:
        await async_session.rollback()
        await cleanup_loadout_fixture(async_session, fixture)
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.source == "included"))
        await async_session.commit()
