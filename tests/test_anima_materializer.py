from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from typing import TypeVar
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_presentation_repo import SQLAlchemyAnimaPresentationRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.chat.memory_context import DirectChatMemoryContextError, DirectChatMemoryContextService
from animama.app.services.anima_presentation_service import AnimaPresentationService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.memory_entry_service import (
    MemoryEntryConflictError,
    MemoryEntryProtectedError,
    MemoryEntryService,
    MemoryEntryValidationError,
)
from animama.domain.anima_definition import (
    ANIMA_MEMORIES_TEMPLATE,
    DEFAULT_ANIMA_VOICE_ID,
    AnimaDefinitionError,
    normalize_display_name,
    normalize_identity,
)
from animama.domain.anima_loadout import AnimaLoadoutError
from animama.domain.content_catalog import ContentConflictError, ContentKind
from animama.domain.request_principal import RequestPrincipal
from animama.orm import (
    ORMAnima,
    ORMAnimaDefinitionRevision,
    ORMAnimaLoadout,
    ORMAnimaRuntimeSnapshot,
    ORMAnimaSettings,
    ORMAvatar,
    ORMChat,
    ORMMemoryEntry,
    ORMMemoryEntryVersion,
)
from animama.orm.content_catalog import ORMContentCatalogDependency, ORMContentCatalogItem
from animama.orm.model_provider import ORMModelProvider
from animama.product_http.ports import install_product_ports
from animama.product_http.routes.memory import router as memory_router
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers.anima import patch_anima, router as anima_router
from animama.server.routers.avatar import delete_avatar
from animama.server.schemas.anima import PyAnimaUpdate, PyAnimaUpdateRequest
from tests.anima_creation_support import creation_fixture
from tests.local_http_client import local_client
from tests.product_http_support import SessionPorts

_T = TypeVar("_T")


def _required(value: _T | None) -> _T:
    """Assert the fixture lookup succeeded before inspecting its typed value."""
    assert value is not None
    return value


def memory_service(uow: SQLAlchemyAnimaAggregateUnitOfWork) -> MemoryEntryService:
    return MemoryEntryService(memory_entries=uow.memory_entries, animas=uow.animas, uow=uow)


@pytest_asyncio.fixture
async def creation(async_session):
    """Retire only this fixture's rows, including confirmed Included sources.

    The shared test database intentionally keeps commits visible to concurrent
    sessions; other catalog tests must not inherit our live binding references.
    """

    fixture = await creation_fixture(async_session)
    try:
        yield fixture
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMAnima).where(ORMAnima.user_id == fixture.user_id))
        await async_session.execute(
            delete(ORMMemoryEntryVersion).where(ORMMemoryEntryVersion.user_id == fixture.user_id)
        )
        await async_session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.user_id == fixture.user_id))
        await async_session.execute(delete(ORMAvatar).where(ORMAvatar.user_id == fixture.user_id))
        source_ids = [
            fixture.spec.avatar.id,
            _required(fixture.spec.idle_style).id,
            _required(fixture.spec.profile).source.id,
            _required(fixture.spec.background).source.id,
        ]
        await async_session.execute(
            delete(ORMContentCatalogItem).where(
                or_(
                    ORMContentCatalogItem.id.in_(source_ids),
                    ORMContentCatalogItem.owner_user_id == fixture.user_id,
                )
            )
        )
        await async_session.execute(delete(ORMModelProvider).where(ORMModelProvider.id == fixture.provider_id))
        await async_session.commit()


@pytest.mark.parametrize("name", ["", "   ", "x" * 41, "bad\tname", "bad\x7fname", "bad\ud800", "\nname"])
def test_display_name_rejects_invalid_text(name: str) -> None:
    with pytest.raises(AnimaDefinitionError):
        normalize_display_name(name)


def test_definition_normalization_preserves_meaningful_whitespace() -> None:
    assert normalize_display_name("  Ren  Ée  ") == "Ren  Ée"
    assert normalize_identity("  # Identity\r\nText  \r") == "  # Identity\nText  \n"
    assert normalize_identity("é" * (16 * 1024)) == "é" * (16 * 1024)
    for invalid in ("  \n", "bad\x00text", "bad\ud800", "é" * (16 * 1024 + 1)):
        with pytest.raises(AnimaDefinitionError):
            normalize_identity(invalid)
    with pytest.raises(AnimaDefinitionError, match="too_large"):
        normalize_identity("abcd", max_bytes=3)
    assert PyAnimaUpdate(display_name=" " + "a" * 40 + " ").display_name == "a" * 40
    with pytest.raises(ValueError):
        PyAnimaUpdate(display_name="a" * 41)


@pytest.mark.asyncio
@pytest.mark.parametrize("voice_id", [None, "validated-local-voice"])
async def test_materializer_owns_no_commit_provider_or_runtime_and_seeds_exact_defaults(
    async_session, monkeypatch, voice_id, creation
) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    provider_call = AsyncMock(side_effect=AssertionError("Creation must not contact a provider"))
    runtime_call = AsyncMock(side_effect=AssertionError("Runtime must be prepared after commit"))
    monkeypatch.setattr("animama.server.elevenlabs_service.validate_elevenlabs_voice_profile", provider_call)
    monkeypatch.setattr("animama.app.services.anima_runtime_service.AnimaRuntimeService.issue", runtime_call)
    commit = AsyncMock(side_effect=AssertionError("Materializer must not commit"))
    monkeypatch.setattr(uow, "commit", commit)
    spec = replace(fixture.spec, voice_profile={"primary_voice": {"voice_id": voice_id}}) if voice_id else fixture.spec
    anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=spec, uow=uow)
    assert async_session.in_transaction()
    observer = async_sessionmaker(async_session.bind, expire_on_commit=False)
    async with observer() as other:
        assert await other.get(ORMAnima, anima.id) is None
    await async_session.commit()

    assert anima.display_name == "My  Companion"
    assert anima.aggregate_revision == 1
    assert anima.identity_status == "ready"
    assert anima.user_id == fixture.user_id
    assert anima.archive_id is None
    assert len(anima.emotional_state) == 24 and set(anima.emotional_state.values()) == {0}
    identity = await memory_service(uow).get_entry_by_path(
        user_id=fixture.user_id, anima_id=anima.id, path="identity.md"
    )
    assert identity.content == "# My identity\n\nKeep two spaces.  \n"
    assert identity.version == identity.aggregate_revision == 1
    history = await async_session.scalar(
        select(ORMMemoryEntryVersion).where(ORMMemoryEntryVersion.entry_id == identity.id)
    )
    audit = await async_session.get(ORMAnimaDefinitionRevision, (anima.id, 1))
    assert audit.identity_entry_id == identity.id and audit.identity_version == history.version == 1
    assert not hasattr(audit, "identity")
    memories = await memory_service(uow).get_entry_by_path(
        user_id=fixture.user_id, anima_id=anima.id, path="MEMORIES.md"
    )
    assert (memories.content, memories.kind, memories.version) == (ANIMA_MEMORIES_TEMPLATE, "anima_memories", 1)
    assert memories.description == "Shared history with the user"
    assert memories.aggregate_revision is None
    settings = await async_session.get(ORMAnimaSettings, (fixture.user_id, anima.id))
    assert settings.preferences["speech"]["elevenlabs"]["primary_voice"]["voice_id"] == (
        voice_id or DEFAULT_ANIMA_VOICE_ID
    )
    assert settings.theme is None and settings.background is None and settings.favorited is False
    # Memory/emotion flags are inherited from App Settings until overridden.
    assert "memory" not in settings.preferences and "emotion" not in settings.preferences
    assert (_required(await uow.chat_profiles.get(anima.id))).default_model_provider_id == fixture.provider_id
    loadout = await uow.loadouts.read_model(user_id=fixture.user_id, anima_id=anima.id)
    assert loadout.revision == loadout.aggregate_revision == 1
    assert loadout.gestures == () and len(loadout.reactions) == 72
    assert all(cell.state == "empty" for cell in loadout.reactions)
    assert loadout.voice_source is None
    assert _required(loadout.idle_style.source).catalog_item_id == spec.idle_style.id
    assert {entry.use for entry in loadout.appearances} == {"profile", "background"}
    assert (
        await async_session.scalar(select(func.count()).select_from(ORMChat).where(ORMChat.anima_id == anima.id)) == 0
    )
    assert (
        await async_session.scalar(
            select(func.count())
            .select_from(ORMAnimaRuntimeSnapshot)
            .where(ORMAnimaRuntimeSnapshot.anima_id == anima.id)
        )
        == 0
    )
    provider_call.assert_not_called()
    runtime_call.assert_not_called()
    commit.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_stage", ["identity", "settings", "loadout", "audit"])
async def test_materializer_failure_rolls_back_all_authority_but_not_confirmed_content(
    async_session, monkeypatch, failure_stage, creation
) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    target, method = {
        "identity": (uow.memory_entries, "append_version"),
        "settings": (uow.settings, "upsert"),
        "loadout": (uow.loadouts, "initialize"),
        "audit": (uow.animas, "record_definition_revision"),
    }[failure_stage]
    monkeypatch.setattr(target, method, AsyncMock(side_effect=RuntimeError("injected aggregate failure")))
    with pytest.raises(RuntimeError, match="injected"):
        await fixture.materializer.materialize(user_id=fixture.user_id, spec=fixture.spec, uow=uow)
    await uow.rollback()
    for table, owner_column in (
        (ORMAnima, ORMAnima.user_id),
        (ORMAvatar, ORMAvatar.user_id),
        (ORMMemoryEntry, ORMMemoryEntry.user_id),
        (ORMMemoryEntryVersion, ORMMemoryEntryVersion.user_id),
        (ORMAnimaSettings, ORMAnimaSettings.user_id),
        (ORMAnimaLoadout, ORMAnimaLoadout.owner_user_id),
    ):
        assert (
            await async_session.scalar(select(func.count()).select_from(table).where(owner_column == fixture.user_id))
            == 0
        )
    assert await async_session.get(ORMContentCatalogItem, fixture.spec.avatar.id) is not None


@pytest.mark.asyncio
async def test_live_authority_survives_source_edit_chat_context_and_explicit_identity_revert(
    async_session, creation
) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=fixture.spec, uow=uow)
    await uow.commit()
    memory = memory_service(uow)
    identity = await memory.get_entry_by_path(user_id=fixture.user_id, anima_id=anima.id, path="identity.md")
    await async_session.execute(
        update(ORMAvatar)
        .where(ORMAvatar.id == anima.avatar.id)
        .values(name="Changed template", identity="Changed template identity")
    )
    await async_session.commit()
    context = await DirectChatMemoryContextService(memory_entries=memory, animas=uow.animas).build_context(
        user_id=fixture.user_id,
        anima_id=anima.id,
    )
    assert context.anima_name == anima.display_name
    assert context.anima_identity == identity.content
    assert (_required(await uow.animas.get(anima.id))).aggregate_revision == 1
    presentations = await AnimaPresentationService(
        presentations=SQLAlchemyAnimaPresentationRepository(async_session)
    ).list_owned_presentations(
        user_id=fixture.user_id,
        anima_ids=(anima.id,),
    )
    assert presentations[anima.id].display_name == "My  Companion"
    assert _required(presentations[anima.id].profile_thumbnail).presentation.fit == "contain"
    assert _required(presentations[anima.id].profile_thumbnail).presentation.focal_x == 0.2

    updated = await memory.patch_entry(
        user_id=fixture.user_id,
        entry_id=identity.id,
        expected_version=1,
        expected_aggregate_revision=1,
        content="# Owner edit\r\n",
        content_set=True,
    )
    assert updated.version == updated.aggregate_revision == 2
    with pytest.raises(MemoryEntryConflictError, match="aggregate revision"):
        await memory.patch_entry(
            user_id=fixture.user_id,
            entry_id=identity.id,
            expected_version=2,
            expected_aggregate_revision=1,
            content="stale",
            content_set=True,
        )
    reverted = await memory.revert_entry(
        user_id=fixture.user_id,
        entry_id=identity.id,
        target_version=1,
        expected_version=2,
        expected_aggregate_revision=2,
    )
    assert reverted.content == identity.content
    assert reverted.version == reverted.aggregate_revision == 3
    assert (await uow.loadouts.read_model(user_id=fixture.user_id, anima_id=anima.id)).revision == 1
    audits = list(
        (
            await async_session.scalars(
                select(ORMAnimaDefinitionRevision)
                .where(ORMAnimaDefinitionRevision.anima_id == anima.id)
                .order_by(ORMAnimaDefinitionRevision.aggregate_revision)
            )
        ).all()
    )
    assert [audit.identity_version for audit in audits] == [1, 2, 3]


@pytest.mark.asyncio
async def test_legacy_long_name_survives_unrelated_identity_edit_until_explicit_rename(async_session, creation) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=fixture.spec, uow=uow)
    await uow.commit()
    legacy_name = "Legacy " + "companion" * 7
    assert 40 < len(legacy_name) <= 120
    await async_session.execute(update(ORMAnima).where(ORMAnima.id == anima.id).values(display_name=legacy_name))
    await async_session.commit()

    memory = memory_service(uow)
    identity = await memory.get_entry_by_path(user_id=fixture.user_id, anima_id=anima.id, path="identity.md")
    updated = await memory.patch_entry(
        user_id=fixture.user_id,
        entry_id=identity.id,
        expected_version=1,
        expected_aggregate_revision=1,
        content="# Still the same companion\n",
        content_set=True,
    )
    current = await uow.animas.get(anima.id)
    assert _required(updated).aggregate_revision == _required(current).aggregate_revision == 2
    assert _required(current).display_name == legacy_name

    with pytest.raises(AnimaDefinitionError, match="display_name_invalid"):
        await uow.animas.record_definition_revision(
            user_id=fixture.user_id,
            anima_id=anima.id,
            expected_revision=2,
            reason="explicit_invalid_legacy_rename",
            display_name=legacy_name,
        )
    renamed = await uow.animas.record_definition_revision(
        user_id=fixture.user_id,
        anima_id=anima.id,
        expected_revision=2,
        reason="explicit_legacy_rename",
        display_name="Renamed companion",
    )
    await uow.commit()
    assert renamed.display_name == "Renamed companion"
    assert renamed.aggregate_revision == 3


@pytest.mark.asyncio
async def test_name_guard_invalidates_reviewed_loadout_without_rewriting_identity(async_session, creation) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=fixture.spec, uow=uow)
    await uow.commit()
    intent = {"operation": "remove", "use": "background"}
    plan = await uow.loadouts.plan(
        user_id=fixture.user_id, anima_id=anima.id, family="appearance", expected_revision=1, intent=intent
    )
    user = RequestPrincipal(id=fixture.user_id)
    response = await patch_anima(
        anima.id,
        PyAnimaUpdateRequest(
            anima=PyAnimaUpdate(display_name="Owner Name"),
            expected_aggregate_revision=1,
        ),
        session=async_session,
        user=user,
    )
    assert json.loads(bytes(response.body))["aggregate_revision"] == 2
    with pytest.raises(HTTPException) as stale:
        await patch_anima(
            anima.id,
            PyAnimaUpdateRequest(
                anima=PyAnimaUpdate(display_name="Stale"),
                expected_aggregate_revision=1,
            ),
            session=async_session,
            user=user,
        )
    assert stale.value.status_code == 409
    with pytest.raises(AnimaLoadoutError, match="plan_stale"):
        await uow.loadouts.commit(
            user_id=fixture.user_id,
            anima_id=anima.id,
            family="appearance",
            expected_revision=1,
            intent=intent,
            plan_digest=plan.digest,
            idempotency_key="stale-equipment",
        )
    await uow.rollback()
    refreshed = await uow.loadouts.plan(
        user_id=fixture.user_id, anima_id=anima.id, family="appearance", expected_revision=1, intent=intent
    )
    result = await uow.loadouts.commit(
        user_id=fixture.user_id,
        anima_id=anima.id,
        family="appearance",
        expected_revision=1,
        intent=intent,
        plan_digest=refreshed.digest,
        idempotency_key="equipment",
    )
    assert result.revision == 2 and result.aggregate_revision == 3
    replay = await uow.loadouts.commit(
        user_id=fixture.user_id,
        anima_id=anima.id,
        family="appearance",
        expected_revision=1,
        intent=intent,
        plan_digest=refreshed.digest,
        idempotency_key="equipment",
    )
    assert replay.idempotent_replay and replay.aggregate_revision == 3
    identity = await memory_service(uow).get_entry_by_path(
        user_id=fixture.user_id, anima_id=anima.id, path="identity.md"
    )
    assert identity.version == 1
    assert [
        entry.use for entry in (await uow.loadouts.read_model(user_id=fixture.user_id, anima_id=anima.id)).appearances
    ] == ["profile"]


@pytest.mark.asyncio
async def test_required_identity_cannot_bypass_guards_or_be_removed(async_session, creation) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=fixture.spec, uow=uow)
    await uow.commit()
    memory = memory_service(uow)
    identity = await memory.get_entry_by_path(user_id=fixture.user_id, anima_id=anima.id, path="identity.md")
    with pytest.raises(MemoryEntryConflictError, match="Expected aggregate revision"):
        await memory.patch_entry(
            user_id=fixture.user_id, entry_id=identity.id, expected_version=1, content="bypass", content_set=True
        )
    for changes in (
        {"name": "renamed.md", "name_set": True},
        {"parent_id": None, "parent_id_set": True},
        {"kind": None, "kind_set": True},
    ):
        with pytest.raises(MemoryEntryProtectedError):
            await memory.patch_entry(
                user_id=fixture.user_id,
                entry_id=identity.id,
                expected_version=1,
                expected_aggregate_revision=1,
                **changes,
            )
    with pytest.raises(MemoryEntryProtectedError):
        await memory.delete_entry(
            user_id=fixture.user_id, entry_id=identity.id, expected_version=1, allow_system_managed=True
        )
    with pytest.raises(MemoryEntryValidationError):
        await memory.patch_entry(
            user_id=fixture.user_id,
            entry_id=identity.id,
            expected_version=1,
            expected_aggregate_revision=1,
            content="  \n",
            content_set=True,
        )
    with pytest.raises(HTTPException) as retained:
        await delete_avatar(anima.avatar.id, user=RequestPrincipal(id=fixture.user_id), session=async_session)
    assert retained.value.status_code == 409
    await uow.rollback()
    assert (_required(await uow.animas.get(anima.id))).aggregate_revision == 1
    # The ORM cannot bypass retention by nulling the back-reference either.
    with pytest.raises(IntegrityError):
        await uow.avatars.delete(anima.avatar.id)
    await uow.rollback()
    assert (
        _required((_required(await uow.animas.get(_required(anima).id))).avatar).id
        == _required(_required(anima).avatar).id
    )


@pytest.mark.asyncio
async def test_concurrent_identity_writes_have_one_winner(async_session, creation) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=fixture.spec, uow=uow)
    await uow.commit()
    identity = await memory_service(uow).get_entry_by_path(
        user_id=fixture.user_id, anima_id=anima.id, path="identity.md"
    )
    await async_session.rollback()
    factory = async_sessionmaker(async_session.bind, expire_on_commit=False)

    async def edit(content: str):
        async with factory() as session:
            memory = memory_service(SQLAlchemyAnimaAggregateUnitOfWork(session))
            try:
                return await memory.patch_entry(
                    user_id=fixture.user_id,
                    entry_id=identity.id,
                    expected_version=1,
                    expected_aggregate_revision=1,
                    content=content,
                    content_set=True,
                )
            except MemoryEntryConflictError as exc:
                return exc

    results = await asyncio.gather(edit("First edit"), edit("Second edit"))
    assert sum(isinstance(result, MemoryEntryConflictError) for result in results) == 1
    current = await memory_service(uow).get_entry_by_path(
        user_id=fixture.user_id, anima_id=anima.id, path="identity.md"
    )
    assert current.version == current.aggregate_revision == 2


@pytest.mark.asyncio
async def test_missing_identity_has_no_runtime_avatar_fallback(async_session) -> None:
    owner, anima_id = f"owner-{uuid4().hex}", f"anima-{uuid4().hex}"
    async_session.add(ORMAnima(id=anima_id, user_id=owner, display_name="Repair me"))
    await async_session.commit()
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    memory = memory_service(uow)
    context = DirectChatMemoryContextService(memory_entries=memory, animas=uow.animas)
    with pytest.raises(DirectChatMemoryContextError, match="owner must repair"):
        await context.build_context(user_id=owner, anima_id=anima_id)
    repaired = await memory.create_entry(
        user_id=owner,
        anima_id=anima_id,
        type="file",
        name="identity.md",
        content="Owner supplied identity",
        expected_aggregate_revision=1,
    )
    assert repaired.aggregate_revision == 2 and repaired.version == 1
    assert (_required(await uow.animas.get(anima_id))).identity_status == "ready"
    assert (await context.build_context(user_id=owner, anima_id=anima_id)).anima_identity == repaired.content


@pytest.mark.asyncio
async def test_legacy_directory_obstruction_can_be_explicitly_deleted_before_identity_repair(
    async_session, creation
) -> None:
    owner, anima_id, entry_id = creation.user_id, f"repair-{uuid4().hex}", f"directory-{uuid4().hex}"
    async_session.add(ORMAnima(id=anima_id, user_id=owner, display_name="Repair required"))
    async_session.add(
        ORMMemoryEntry(
            id=entry_id,
            user_id=owner,
            anima_id=anima_id,
            type="directory",
            name="identity.md",
            normalized_name="identity.md",
            path="identity.md",
            normalized_path="identity.md",
            version=1,
        )
    )
    await async_session.commit()
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    memory = memory_service(uow)
    # An Anima folder admits only its two root files, so the obstruction cannot
    # be renamed within it, but it is not itself an identity and can be deleted.
    with pytest.raises(MemoryEntryProtectedError):
        await memory.patch_entry(
            user_id=owner, entry_id=entry_id, expected_version=1, name="legacy-identity", name_set=True
        )
    await memory.delete_entry(user_id=owner, entry_id=entry_id, expected_version=1)
    repaired = await memory.create_entry(
        user_id=owner,
        anima_id=anima_id,
        type="file",
        name="identity.md",
        content="Owner supplied repair",
        expected_aggregate_revision=1,
    )
    assert repaired.version == 1 and repaired.aggregate_revision == 2
    assert (_required(await uow.animas.get(anima_id))).identity_status == "ready"


@pytest.mark.asyncio
async def test_avatar_changes_and_stale_chat_writes_preserve_live_definition(async_session, creation) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=fixture.spec, uow=uow)
    await uow.commit()
    replacement_id = f"avatar-source-{uuid4().hex}"
    async_session.add(
        ORMContentCatalogItem(
            id=replacement_id,
            source="local",
            scope="owner",
            owner_user_id=fixture.user_id,
            kind="avatar",
            relative_locator=f"avatar/{replacement_id}",
            logical_key=f"local:avatar:{replacement_id}",
            display_name="Replacement Avatar",
            status="valid",
            revision_sha256="c" * 64,
            content_metadata={
                "schema_version": 1,
                "content_type": "avatar",
                "name": "Replacement Avatar",
                "content_id": f"local:avatar:{replacement_id}",
                "model_role": "model",
                "compatibility": {},
            },
        )
    )
    await uow.commit()
    intent = {"operation": "set", "source": {"type": "catalog", "catalog_item_id": replacement_id}}
    plan = await uow.loadouts.plan(
        user_id=fixture.user_id,
        anima_id=anima.id,
        family="avatar",
        expected_revision=1,
        intent=intent,
    )
    result = await uow.loadouts.commit(
        user_id=fixture.user_id,
        anima_id=anima.id,
        family="avatar",
        expected_revision=1,
        intent=intent,
        plan_digest=plan.digest,
        idempotency_key="replace-avatar",
    )
    assert result.revision == result.aggregate_revision == 2
    current = await uow.animas.get(anima.id)
    assert (
        _required(_required(current).avatar).catalog_item_id == replacement_id
        and _required(_required(current).avatar).id != _required(_required(anima).avatar).id
    )
    assert _required(current).display_name == _required(anima).display_name

    user = RequestPrincipal(id=fixture.user_id)
    response = await patch_anima(
        anima.id,
        PyAnimaUpdateRequest(
            anima=PyAnimaUpdate(avatar_id=None, display_name="My renamed Anima"),
            expected_aggregate_revision=2,
        ),
        session=async_session,
        user=user,
    )
    assert json.loads(bytes(response.body))["aggregate_revision"] == 3
    assert (await uow.loadouts.read_model(user_id=fixture.user_id, anima_id=anima.id)).revision == 3

    # A chat may finish with a pre-edit domain object. Only its runtime state
    # can be persisted; the earlier Avatar/name/definition revision stay stale.
    anima.emotional_state["joy"] = 4
    await uow.animas.update(anima)
    preferences = await uow.settings.get(user_id=fixture.user_id, anima_id=anima.id)
    _required(preferences).favorited = True
    await uow.settings.upsert(_required(preferences))
    profile = await uow.chat_profiles.get(anima.id)
    await uow.chat_profiles.upsert(_required(profile))
    memory = memory_service(uow)
    ordinary = await memory.put_file_by_path(
        user_id=fixture.user_id,
        path="profile.md",
        content="User memory",
    )
    assert ordinary.aggregate_revision is None
    current = await uow.animas.get(anima.id)
    assert _required(current).avatar is None and _required(current).display_name == "My renamed Anima"
    assert _required(current).aggregate_revision == 3 and _required(_required(current).emotional_state)["joy"] == 4
    identity = await memory.get_entry_by_path(user_id=fixture.user_id, anima_id=anima.id, path="identity.md")
    assert identity.version == 1 and identity.aggregate_revision == 3
    assert identity.content == "# My identity\n\nKeep two spaces.  \n"
    assert (
        await async_session.scalar(
            select(func.count())
            .select_from(ORMAnimaDefinitionRevision)
            .where(
                ORMAnimaDefinitionRevision.anima_id == anima.id,
            )
        )
        == 3
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["matrix", "idle", "stale_avatar", "stale_profile", "voice", "model", "owner"])
async def test_invalid_resolved_inputs_leave_no_aggregate(async_session, creation, invalid) -> None:
    fixture = creation
    spec = fixture.spec
    owner = fixture.user_id
    if invalid == "matrix":
        spec = replace(spec, reactions=spec.reactions[:-1])
    elif invalid == "idle":
        spec = replace(spec, idle_style=replace(_required(spec.idle_style), kind=ContentKind.AVATAR))
    elif invalid == "stale_avatar":
        spec = replace(spec, avatar=replace(spec.avatar, revision_sha256="f" * 64))
    elif invalid == "stale_profile":
        spec = replace(
            spec, profile=replace(spec.profile, source=replace(spec.profile.source, revision_sha256="f" * 64))
        )
    elif invalid == "voice":
        spec = replace(spec, voice_profile={"primary_voice": {"voice_id": "unvalidated/url"}})
    elif invalid == "model":
        await async_session.execute(
            update(ORMModelProvider).where(ORMModelProvider.id == fixture.provider_id).values(active=False)
        )
        await async_session.commit()
    else:
        owner = "not-the-content-owner"
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    with pytest.raises((AnimaDefinitionError, AnimaLoadoutError)):
        await fixture.materializer.materialize(user_id=owner, spec=spec, uow=uow)
    await uow.rollback()
    assert await async_session.scalar(select(func.count()).select_from(ORMAnima).where(ORMAnima.user_id == owner)) == 0
    assert await async_session.get(ORMContentCatalogItem, fixture.spec.avatar.id) is not None


@pytest.mark.asyncio
async def test_null_appearance_does_not_inherit_background_or_profile(async_session, creation) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(
        user_id=fixture.user_id,
        spec=replace(fixture.spec, profile=None, background=None),
        uow=uow,
    )
    await uow.commit()
    assert (await uow.loadouts.read_model(user_id=fixture.user_id, anima_id=anima.id)).appearances == ()
    presentation = await AnimaPresentationService(
        presentations=SQLAlchemyAnimaPresentationRepository(async_session)
    ).list_owned_presentations(
        user_id=fixture.user_id,
        anima_ids=(anima.id,),
    )
    assert presentation[anima.id].profile_thumbnail is None


async def test_resolved_binding_configuration_survives_materialization(async_session, creation) -> None:
    from animama.domain.anima_creation import ResolvedGestureSelection, ResolvedReactionSelection
    from animama.orm.content_catalog import ORMAnimaContentBinding
    from tests.typed_loadout_support import LoadoutFixture, add_typed_item

    fixture = creation
    catalog = SQLAlchemyContentCatalog(async_session)
    sources = {}
    for kind in ("gesture", "reaction"):
        row = await add_typed_item(
            async_session,
            LoadoutFixture(fixture.user_id, "", "", ""),
            kind=kind,
            name=f"Configured {kind}",
            metadata={
                **({"semantic_key": "configured"} if kind == "gesture" else {}),
                "implementation": {"kind": "anima_clip", "file_role": "sequence"},
            },
        )
        sources[kind] = _required(await catalog.get_visible_item(user_id=fixture.user_id, item_id=row.id))
    spec = replace(
        fixture.spec,
        gestures=(ResolvedGestureSelection(sources["gesture"], {"time_scale": 0.5, "loop": True}),),
        reactions=tuple(
            ResolvedReactionSelection(cell.emotion, cell.intensity, sources["reaction"], {"weight": 0.75})
            if cell.emotion == "joy" and cell.intensity == 2
            else cell
            for cell in fixture.spec.reactions
        ),
    )
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=spec, uow=uow)
    rows = list(
        (
            await async_session.scalars(
                select(ORMAnimaContentBinding).where(ORMAnimaContentBinding.anima_id == anima.id)
            )
        ).all()
    )
    by_slot = {row.slot_key: row.config for row in rows}
    assert by_slot["gesture:configured"] == {"time_scale": 0.5, "loop": True}
    assert by_slot["reaction:joy-2"] == {"weight": 0.75}
    await uow.rollback()


@pytest.mark.asyncio
async def test_identity_http_edits_and_revert_share_the_owned_aggregate_guard(async_session, creation) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=fixture.spec, uow=uow)
    await uow.commit()
    identity = await memory_service(uow).get_entry_by_path(
        user_id=fixture.user_id, anima_id=anima.id, path="identity.md"
    )
    app = FastAPI()
    app.include_router(anima_router)
    app.include_router(memory_router)
    owner = RequestPrincipal(id=fixture.user_id)

    async def user():
        return owner

    async def session():
        yield async_session

    app.dependency_overrides[get_current_principal] = user
    app.dependency_overrides[get_async_session] = session
    # Shared memory routes take the same test session through the ports.
    install_product_ports(app, SessionPorts(async_session))
    async with local_client(app) as client:
        path = f"/v1/memory/entries/{identity.id}"
        initial = await client.get(path)
        assert initial.status_code == 200 and initial.json()["aggregate_revision"] == 1
        unguarded = await client.patch(path, json={"expected_version": 1, "content": "Unguarded"})
        assert unguarded.status_code == 409
        renamed = await client.patch(
            f"/v1/animas/{anima.id}",
            json={
                "anima": {"display_name": "Renamed"},
                "expected_aggregate_revision": 1,
            },
        )
        assert renamed.status_code == 200 and renamed.json()["aggregate_revision"] == 2
        stale = await client.patch(
            path, json={"expected_version": 1, "expected_aggregate_revision": 1, "content": "Stale"}
        )
        assert stale.status_code == 409
        edited = await client.patch(
            path, json={"expected_version": 1, "expected_aggregate_revision": 2, "content": "Owner edit\r\n"}
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["version"] == 2 and edited.json()["aggregate_revision"] == 3
        assert edited.json()["content"] == "Owner edit\n"
        stale_revert = await client.post(
            f"{path}:revert", json={"target_version": 1, "expected_version": 2, "expected_aggregate_revision": 2}
        )
        assert stale_revert.status_code == 409
        reverted = await client.post(
            f"{path}:revert", json={"target_version": 1, "expected_version": 2, "expected_aggregate_revision": 3}
        )
        assert reverted.status_code == 200, reverted.text
        assert reverted.json()["version"] == 3 and reverted.json()["aggregate_revision"] == 4
        assert reverted.json()["content"] == identity.content
        protected = await client.delete(path, params={"expected_version": 3})
        assert protected.status_code == 403
        await uow.rollback()
        owner = RequestPrincipal(id="foreign-owner")
        assert (await client.get(path)).status_code == 404
        foreign_patch = await client.patch(
            f"/v1/animas/{anima.id}",
            json={
                "anima": {"display_name": "Foreign"},
                "expected_aggregate_revision": 4,
            },
        )
        assert foreign_patch.status_code == 404


@pytest.mark.asyncio
async def test_reference_retention_precedes_filesystem_delete_and_missing_content_does_not_rewrite_identity(
    async_session,
    creation,
) -> None:
    fixture = creation
    uow = SQLAlchemyAnimaAggregateUnitOfWork(async_session)
    anima = await fixture.materializer.materialize(user_id=fixture.user_id, spec=fixture.spec, uow=uow)
    # Also retain supports reached by a catalog dependency, without a direct binding.
    async_session.add(
        ORMContentCatalogDependency(
            item_id=fixture.spec.profile.source.id,
            ordinal=1,
            declared_ref=fixture.spec.background.source.logical_key,
            target_item_id=fixture.spec.background.source.id,
        )
    )
    await uow.commit()
    intent = {"operation": "remove", "use": "background"}
    plan = await uow.loadouts.plan(
        user_id=fixture.user_id, anima_id=anima.id, family="appearance", expected_revision=1, intent=intent
    )
    await uow.loadouts.commit(
        user_id=fixture.user_id,
        anima_id=anima.id,
        family="appearance",
        expected_revision=1,
        intent=intent,
        plan_digest=plan.digest,
        idempotency_key="remove-background",
    )
    store = Mock(owner_id=None)  # Model the explicitly unbound local store contract.
    store.pending_mutations.return_value = ()
    catalog = SQLAlchemyContentCatalog(async_session)
    service = ContentCatalogService(store=store, catalog=catalog)
    for source in (fixture.spec.avatar, fixture.spec.profile.source, fixture.spec.background.source):
        with pytest.raises(ContentConflictError, match="catalog_item_in_use"):
            await service.delete_item(
                item_id=source.id, user_id=fixture.user_id, expected_revision=source.revision_sha256
            )
        await uow.rollback()
    store.delete_entry.assert_not_called()
    await async_session.execute(
        update(ORMContentCatalogItem).where(ORMContentCatalogItem.id == fixture.spec.avatar.id).values(status="missing")
    )
    await uow.commit()
    current = await uow.animas.get(anima.id)
    assert (
        _required(current).display_name == _required(anima).display_name and _required(current).aggregate_revision == 2
    )
    memory = memory_service(uow)
    identity = await memory.get_entry_by_path(user_id=fixture.user_id, anima_id=anima.id, path="identity.md")
    assert identity.version == 1
    context = await DirectChatMemoryContextService(memory_entries=memory, animas=uow.animas).build_context(
        user_id=fixture.user_id, anima_id=anima.id
    )
    assert context.anima_identity == identity.content and context.anima_name == anima.display_name
