"""Portable Animas read saved authority and preserve explicit equipment only."""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.domain.content_catalog import ContentConflictError
from animama.orm import ORMAnima, ORMAnimaSettings, ORMAvatar, ORMMemoryEntry, ORMMemoryEntryVersion
from animama.orm.content_catalog import ORMAnimaContentBinding, ORMContentCatalogItem
from animama.orm.model_provider import ORMModelProvider
from tests.anima_creation_support import creation_fixture
from tests.typed_loadout_support import LoadoutFixture, add_typed_item


@pytest_asyncio.fixture
async def saved_anima(async_session):
    fixture = await creation_fixture(async_session)
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(
        user_id=fixture.user_id, spec=replace(fixture.spec, idle_style=None), uow=uow
    )
    await uow.commit()
    try:
        yield fixture, anima
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMAnima).where(ORMAnima.user_id == fixture.user_id))
        await async_session.execute(
            delete(ORMMemoryEntryVersion).where(ORMMemoryEntryVersion.user_id == fixture.user_id)
        )
        await async_session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.user_id == fixture.user_id))
        await async_session.execute(delete(ORMAvatar).where(ORMAvatar.user_id == fixture.user_id))
        assert fixture.spec.idle_style is not None
        assert fixture.spec.profile is not None
        assert fixture.spec.background is not None
        ids = [
            fixture.spec.avatar.id,
            fixture.spec.idle_style.id,
            fixture.spec.profile.source.id,
            fixture.spec.background.source.id,
        ]
        await async_session.execute(
            delete(ORMContentCatalogItem).where(
                ORMContentCatalogItem.id.in_(ids) | (ORMContentCatalogItem.owner_user_id == fixture.user_id)
            )
        )
        await async_session.execute(delete(ORMModelProvider).where(ORMModelProvider.id == fixture.provider_id))
        await async_session.commit()


def portable_fixture():
    from animama.app.contracts.portable_anima import PortableAnima
    from animama.domain.content_catalog import (
        CatalogContentEntry,
        CatalogContentFile,
        ContentKind,
        ContentScope,
        ContentSource,
        ContentStatus,
    )
    from animama.domain.emotions import TRACKED_EMOTIONS

    definition = PortableAnima.model_validate(
        {
            "display_name": "Reviewed",
            "identity_markdown": "# Only reviewed identity",
            "avatar": "model",
            "gestures": [],
            "reactions": {emotion: {str(level): None for level in (1, 2, 3)} for emotion in TRACKED_EMOTIONS},
            "idle_style": None,
            "appearance": {"profile": None, "background": None},
        }
    )
    avatar = CatalogContentEntry(
        id="model",
        source=ContentSource.LOCAL,
        scope=ContentScope.OWNER,
        owner_user_id="sender",
        kind=ContentKind.AVATAR,
        relative_locator="avatar/model",
        display_name="Avatar",
        status=ContentStatus.VALID,
        revision_sha256="a" * 64,
        metadata={
            "schema_version": 1,
            "content_type": "avatar",
            "name": "Avatar",
            "model_role": "model",
            "compatibility": {},
        },
        files=(
            CatalogContentFile(
                "model-file",
                "model",
                ContentSource.LOCAL,
                "avatar/model/model.vrm",
                "model",
                "model/gltf-binary",
                20,
                "a" * 64,
            ),
        ),
    )
    return definition, {"model": avatar}


@pytest.mark.parametrize("change", ["name", "name_type", "identity", "cell", "extra", "unsafe_ref"])
def test_portable_definition_has_strict_bounded_complete_allowlist(change):
    from pydantic import ValidationError

    from animama.app.contracts.portable_anima import PortableAnima

    definition, _ = portable_fixture()
    raw = definition.model_dump()
    if change == "name":
        raw["display_name"] = "x" * 41
    elif change == "name_type":
        raw["display_name"] = 12
    elif change == "identity":
        raw["identity_markdown"] = "é" * (16 * 1024 + 1)
    elif change == "cell":
        del raw["reactions"]["joy"]["3"]
    elif change == "extra":
        raw["owner_user_id"] = "private-owner"
    else:
        raw["avatar"] = "../source"
    with pytest.raises(ValidationError):
        PortableAnima.model_validate(raw)


@pytest.mark.parametrize(
    "implementation,config",
    [
        ("vrma", {"loop": True}),
        ("anima_clip", {"loop_type": "repeat"}),
        ("anima_clip", {"blend_mode": "normal"}),
        ("vrma", {"base_pose": "local-secret-ref"}),
        ("vrma", {"runtime_reference_map": {"effect": "sender-id"}}),
        ("vrma", {"time_scale": float("inf")}),
        ("vrma", {"loop_count": True}),
        ("vrma", {"time_scale": -1}),
    ],
)
def test_binding_configuration_rejects_inapplicable_and_unbounded_values(implementation, config):
    from animama.app.services.portable_anima_service import validate_binding_configuration
    from animama.domain.content_catalog import ContentKind
    from animama.domain.content_documents import ActionImplementationV1, GestureDocumentV1

    document = GestureDocumentV1(
        kind=ContentKind.GESTURE, name="Gesture", implementation=ActionImplementationV1(implementation)
    )
    with pytest.raises(ContentConflictError, match="package_anima_binding_config"):
        validate_binding_configuration(document, config)


def test_reaction_unsupported_overrides_do_not_silently_disappear():
    from animama.app.services.portable_anima_service import validate_binding_configuration
    from animama.domain.content_catalog import ContentKind
    from animama.domain.content_documents import ReactionDocumentV1

    with pytest.raises(ContentConflictError, match="package_anima_binding_config_unsupported"):
        validate_binding_configuration(
            ReactionDocumentV1(kind=ContentKind.REACTION, name="Reaction"), {"time_scale": 2}
        )


@pytest.mark.parametrize("budget", ["entries", "bytes", "config", "audio"])
def test_whole_anima_runtime_budget_applies_to_validated_package_union(budget):
    from animama.app.services.portable_anima_service import validate_package_anima_runtime
    from animama.domain.content_catalog import ContentKind

    definition, entries = portable_fixture()
    avatar = entries["model"]
    if budget == "entries":
        entries.update({str(index): replace(avatar, id=str(index)) for index in range(500)})
    elif budget == "bytes":
        entries["model"] = replace(avatar, files=(replace(avatar.files[0], size_bytes=512 * 1024 * 1024 + 1),))
    elif budget == "config":
        entries["model"] = replace(
            avatar, metadata={**avatar.metadata, "compatibility": {"details": "x" * (512 * 1024)}}
        )
    else:
        entries["sfx"] = replace(
            avatar,
            id="sfx",
            kind=ContentKind.SOUND_EFFECT,
            metadata={
                "schema_version": 1,
                "content_type": "sound_effect",
                "name": "Long sound",
                "duration_seconds": 301,
                "codec": "wav",
            },
        )
    with pytest.raises(ContentConflictError, match="runtime_.*budget"):
        validate_package_anima_runtime(definition, entries)


def test_rewrite_touches_equipment_references_only_and_requires_complete_mapping():
    from animama.app.services.portable_anima_service import rewrite_portable_anima

    definition, _ = portable_fixture()
    definition.identity_markdown = "model belongs in this reviewed identity text"
    with pytest.raises(ContentConflictError, match="package_anima_reference_missing"):
        rewrite_portable_anima(definition, {})
    rewritten = rewrite_portable_anima(definition, {"model": "receiver-model"})
    assert rewritten.avatar == "receiver-model"
    assert rewritten.identity_markdown == definition.identity_markdown


def source_service(session, **kwargs):
    return AnimaPackageSourceService(
        sources=SQLAlchemyAnimaPackageSourceRepository(session), catalog=SQLAlchemyContentCatalog(session), **kwargs
    )


async def test_saved_definition_projection_preserves_empties_images_and_privacy(async_session, saved_anima):
    fixture, anima = saved_anima
    await async_session.execute(
        update(ORMAnima).where(ORMAnima.id == anima.id).values(metadata_={"private_history": "NEVER_EXPORT_HISTORY"})
    )
    await async_session.execute(
        update(ORMAvatar).where(ORMAvatar.id == anima.avatar.id).values(identity="NEVER_EXPORT_AVATAR_IDENTITY")
    )
    await async_session.execute(
        update(ORMAnimaSettings)
        .where(ORMAnimaSettings.anima_id == anima.id)
        .values(preferences={"provider": {"credential": "NEVER_EXPORT_CREDENTIAL"}})
    )
    await async_session.execute(
        update(ORMMemoryEntryVersion)
        .where(ORMMemoryEntryVersion.anima_id == anima.id)
        .values(content="NEVER_EXPORT_OLD_IDENTITY")
    )
    await async_session.commit()
    service = source_service(async_session)
    result = await service.capture(user_id=fixture.user_id, anima_id=anima.id)
    definition = result.definition
    assert definition.display_name == "My  Companion"
    assert definition.identity_markdown == "# My identity\n\nKeep two spaces.  \n"
    assert definition.avatar == fixture.spec.avatar.id
    assert definition.idle_style is None and definition.gestures == []
    assert len(definition.reactions) == 24
    assert all(
        set(cells) == {"1", "2", "3"} and all(cell is None for cell in cells.values())
        for cells in definition.reactions.values()
    )
    assert definition.appearance.profile.entry_id == fixture.spec.profile.source.id
    assert definition.appearance.background.entry_id == fixture.spec.background.source.id
    assert definition.appearance.profile.presentation.model_dump() == {
        "fit": "contain",
        "focal_x": 0.2,
        "focal_y": 0.5,
        "zoom": 1.5,
    }
    assert set(result.selected_item_ids) == {
        fixture.spec.avatar.id,
        fixture.spec.profile.source.id,
        fixture.spec.background.source.id,
    }
    encoded = definition.model_dump_json()
    assert fixture.user_id not in encoded and anima.id not in encoded
    assert "NEVER_EXPORT" not in encoded and "provider" not in encoded and "voice" not in encoded
    await service.recheck(user_id=fixture.user_id, snapshot=result.snapshot)


async def test_selected_missing_image_is_an_error_not_an_absence(async_session, saved_anima):
    fixture, anima = saved_anima
    await async_session.execute(
        update(ORMContentCatalogItem)
        .where(ORMContentCatalogItem.id == fixture.spec.profile.source.id)
        .values(status="missing")
    )
    await async_session.commit()
    with pytest.raises(ContentConflictError, match="package_anima_source_unavailable"):
        await source_service(async_session).capture(user_id=fixture.user_id, anima_id=anima.id)


@pytest.mark.parametrize("change", ["name", "identity", "framing", "source", "avatar"])
async def test_snapshot_recheck_detects_current_authority_drift(async_session, saved_anima, change):
    fixture, anima = saved_anima
    service = source_service(async_session)
    result = await service.capture(user_id=fixture.user_id, anima_id=anima.id)
    # Simulate a committed edit while deliberately leaving the aggregate counter
    # unchanged; the raw fence must not trust only the optimistic revision.
    if change == "name":
        await async_session.execute(update(ORMAnima).where(ORMAnima.id == anima.id).values(display_name="Later name"))
    elif change == "identity":
        await async_session.execute(
            update(ORMMemoryEntry)
            .where(ORMMemoryEntry.anima_id == anima.id, ORMMemoryEntry.normalized_path == "identity.md")
            .values(content="# Later identity")
        )
    elif change == "framing":
        await async_session.execute(
            update(ORMAnimaContentBinding)
            .where(ORMAnimaContentBinding.anima_id == anima.id, ORMAnimaContentBinding.slot_key == "appearance:profile")
            .values(config={"zoom": 2})
        )
    elif change == "source":
        await async_session.execute(
            update(ORMContentCatalogItem)
            .where(ORMContentCatalogItem.id == fixture.spec.avatar.id)
            .values(revision_sha256="c" * 64)
        )
    else:
        await async_session.execute(
            update(ORMAvatar).where(ORMAvatar.id == anima.avatar.id).values(presentation_revision=2)
        )
    await async_session.commit()
    with pytest.raises(ContentConflictError, match="package_anima_source_changed"):
        await service.recheck(user_id=fixture.user_id, snapshot=result.snapshot)


async def test_projection_is_owner_scoped_and_enforces_receiving_identity_limit(async_session, saved_anima):
    from animama.domain.anima_definition import AnimaDefinitionError

    fixture, anima = saved_anima
    with pytest.raises(AnimaDefinitionError, match="anima_not_found"):
        await source_service(async_session).capture(user_id="other-owner", anima_id=anima.id)
    with pytest.raises(AnimaDefinitionError, match="anima_identity_too_large"):
        await source_service(async_session, max_identity_bytes=8).capture(user_id=fixture.user_id, anima_id=anima.id)
    with pytest.raises(ContentConflictError, match="package_anima_source_changed"):
        await source_service(async_session).capture(
            user_id=fixture.user_id, anima_id=anima.id, expected_loadout_revision=2
        )


@pytest.mark.parametrize(
    "implementation,config",
    [
        ("vrma", {"loop_type": "pingpong", "loop_count": 2, "time_scale": 0.5, "blend_mode": "additive"}),
        (
            "anima_clip",
            {
                "loop": True,
                "loop_count": 2,
                "duration_seconds": 3.0,
                "weight": 0.4,
                "emotion_weights": {"joy": {"1": 2.0}},
            },
        ),
    ],
)
async def test_configuration_and_image_roles_round_trip_through_portable_definition(
    async_session, saved_anima, implementation, config
):
    from animama.app.services.portable_anima_service import resolve_portable_anima, rewrite_portable_anima

    fixture, anima = saved_anima
    gesture = await add_typed_item(
        async_session,
        LoadoutFixture(fixture.user_id, "", "", ""),
        kind="gesture",
        name="Configured",
        metadata={
            "semantic_key": "configured",
            "implementation": {
                "kind": implementation,
                "file_role": "animation" if implementation == "vrma" else "sequence",
            },
        },
    )
    async_session.add(
        ORMAnimaContentBinding(
            id=str(uuid4()),
            anima_id=anima.id,
            slot_key="gesture:configured",
            kind="gesture",
            catalog_item_id=gesture.id,
            config=config,
        )
    )
    # Reuse one image in two roles with distinct framing.
    await async_session.execute(
        update(ORMAnimaContentBinding)
        .where(ORMAnimaContentBinding.anima_id == anima.id, ORMAnimaContentBinding.slot_key == "appearance:background")
        .values(catalog_item_id=fixture.spec.profile.source.id, config={"zoom": 2})
    )
    await async_session.commit()
    service = source_service(async_session)
    projection = await service.capture(user_id=fixture.user_id, anima_id=anima.id)
    mapping = {item_id: f"package-{index}" for index, item_id in enumerate(projection.selected_item_ids)}
    portable = rewrite_portable_anima(projection.definition, mapping)
    assert portable.gestures[0].config == config
    assert portable.appearance.profile is not None
    assert portable.appearance.background is not None
    assert portable.appearance.profile.entry_id == portable.appearance.background.entry_id
    assert len(portable.entry_references()) == 3
    catalog = SQLAlchemyContentCatalog(async_session)
    entries = {
        mapping[item.id]: item for item in await catalog.list_visible(user_id=fixture.user_id) if item.id in mapping
    }
    resolved = resolve_portable_anima(portable, entries)
    created = await fixture.materializer.materialize(
        user_id=fixture.user_id, spec=resolved, uow=SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    )
    binding = await async_session.scalar(
        select(ORMAnimaContentBinding).where(
            ORMAnimaContentBinding.anima_id == created.id, ORMAnimaContentBinding.kind == "gesture"
        )
    )
    assert binding.config == config
    assert created.id != anima.id and created.aggregate_revision == 1


async def test_effective_starters_and_arbitrary_reaction_cell_are_frozen(async_session, saved_anima, monkeypatch):
    from animama.orm.anima_loadout import ORMAnimaLoadout

    fixture, anima = saved_anima
    policy: dict[str, list[dict[str, Any]]] = {"gestures": [], "reactions": []}
    included_ids = []
    try:
        for kind in ("gesture", "reaction"):
            semantic = f"portable-{kind}-{uuid4().hex}"
            key = f"builtin:{kind}:{semantic}"
            row = await add_typed_item(
                async_session,
                LoadoutFixture(fixture.user_id, "", "", ""),
                kind=kind,
                name="Starter",
                metadata={
                    "content_id": key,
                    **({"semantic_key": semantic} if kind == "gesture" else {}),
                    "implementation": {"kind": "anima_clip", "file_role": "sequence"},
                },
            )
            await async_session.execute(
                update(ORMContentCatalogItem)
                .where(ORMContentCatalogItem.id == row.id)
                .values(source="included", scope="included", owner_user_id=None)
            )
            included_ids.append(row.id)
            policy[kind + "s"].append(
                {"content_id": key, "version": 1, **({"emotion": "joy", "intensity": 3} if kind == "reaction" else {})}
            )
        await async_session.execute(
            update(ORMAnimaLoadout).where(ORMAnimaLoadout.anima_id == anima.id).values(starter_exclusions=[])
        )
        await async_session.commit()
        monkeypatch.setattr(
            "animama.app.services.anima_package_source_service.starter_loadout_policy", lambda version: policy
        )
        projection = await source_service(async_session).capture(user_id=fixture.user_id, anima_id=anima.id)
        assert projection.definition.gestures[0].entry_id == included_ids[0]
        assert projection.definition.reactions["joy"]["3"].entry_id == included_ids[1]
        assert (
            sum(cell is not None for cells in projection.definition.reactions.values() for cell in cells.values()) == 1
        )
    finally:
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_(included_ids)))
        await async_session.commit()
