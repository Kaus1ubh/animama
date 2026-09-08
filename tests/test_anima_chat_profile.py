from __future__ import annotations

import json
from dataclasses import dataclass
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from animama.adapters.repositories.sqlalchemy.anima_chat_profile_repo import (
    SQLAlchemyAnimaChatProfileRepository,
)
from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.app.anima_creation_contract import CreateAnimaRequest
from animama.app.services import AnimaChatProfileService
from animama.domain import AnimaChatProfile, ModelProvider
from animama.domain.request_principal import RequestPrincipal
from animama.orm import (
    ORMAnima,
    ORMAnimaChatProfile,
    ORMAnimaLoadout,
    ORMMemoryEntry,
    ORMMemoryEntryVersion,
)
from animama.orm.base import Base
from animama.server.routers.anima import update_anima_chat_profile
from animama.server.schemas.anima import PyAnimaChatProfileUpdateRequest
from tests.anima_creation_service_support import anima_creation_fixture


@dataclass
class _FakeUnitOfWork:
    commits: int = 0
    rollbacks: int = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


def _suffix() -> str:
    return uuid4().hex


def _model_provider(
    *,
    suffix: str,
    provider_type: str | None = None,
    model: str | None = None,
    active: bool = True,
) -> ModelProvider:
    provider = provider_type or f"Provider{suffix}"
    model_name = model or f"model-{suffix}"
    return ModelProvider(
        id=f"{provider}:{model_name}",
        provider_type=provider,
        model=model_name,
        model_label=model_name,
        provider_label=provider,
        active=active,
    )


async def _store_provider(async_session, provider: ModelProvider) -> ModelProvider:
    stored = await SQLAlchemyModelProviderRepository(async_session).upsert_many([provider])
    await async_session.flush()
    return stored[0]


async def _store_anima(async_session, *, anima_id: str, metadata: dict | None = None) -> None:
    async_session.add(
        ORMAnima(
            id=anima_id,
            user_id="user-1",
            metadata_=metadata or {},
        )
    )
    await async_session.flush()


def test_anima_chat_profile_orm_metadata_is_registered() -> None:
    assert ORMAnimaChatProfile.__tablename__ == "anima_chat_profiles"
    assert "anima_chat_profiles" in Base.metadata.tables

    table = Base.metadata.tables["anima_chat_profiles"]
    assert table.c.anima_id.primary_key
    assert table.c.default_model_provider_id.nullable is False
    assert "metadata" in table.c
    assert "created_at" in table.c
    assert "updated_at" in table.c


@pytest.mark.asyncio
async def test_mapper_and_orm_round_trip_for_explicit_profile(async_session) -> None:
    suffix = _suffix()
    anima_id = f"anima-{suffix}"
    provider = await _store_provider(async_session, _model_provider(suffix=suffix))
    await _store_anima(async_session, anima_id=anima_id)
    repo = SQLAlchemyAnimaChatProfileRepository(async_session)

    stored = await repo.upsert(
        AnimaChatProfile(
            anima_id=anima_id,
            default_model_provider_id=provider.id,
            metadata={"source": "explicit", "nested": {"keep": True}},
        )
    )
    await async_session.commit()
    fetched = await repo.get(anima_id)

    assert stored.anima_id == anima_id
    assert fetched is not None
    assert fetched.default_model_provider_id == provider.id
    assert fetched.metadata == {"source": "explicit", "nested": {"keep": True}}
    assert fetched.created_at is not None
    assert fetched.updated_at is not None


@pytest.mark.asyncio
async def test_service_returns_explicit_profile(async_session) -> None:
    suffix = _suffix()
    anima_id = f"anima-{suffix}"
    explicit_provider = await _store_provider(async_session, _model_provider(suffix=f"{suffix}a"))
    await _store_anima(async_session, anima_id=anima_id)
    profile_repo = SQLAlchemyAnimaChatProfileRepository(async_session)
    await profile_repo.upsert(
        AnimaChatProfile(
            anima_id=anima_id,
            default_model_provider_id=explicit_provider.id,
            metadata={"source": "explicit"},
        )
    )
    service = AnimaChatProfileService(
        profiles=profile_repo,
        model_providers=SQLAlchemyModelProviderRepository(async_session),
    )

    resolved = await service.resolve_for_anima(anima_id)

    assert resolved is not None
    assert resolved.default_model_provider_id == explicit_provider.id
    assert resolved.metadata == {"source": "explicit"}


@pytest.mark.asyncio
async def test_service_returns_none_without_explicit_profile(async_session) -> None:
    suffix = _suffix()
    anima_id = f"anima-{suffix}"
    await _store_anima(async_session, anima_id=anima_id)
    service = AnimaChatProfileService(
        profiles=SQLAlchemyAnimaChatProfileRepository(async_session),
        model_providers=SQLAlchemyModelProviderRepository(async_session),
    )

    resolved = await service.resolve_for_anima(anima_id)

    assert resolved is None


@pytest.mark.asyncio
async def test_set_default_model_provider_validates_active_provider_and_upserts(async_session) -> None:
    suffix = _suffix()
    anima_id = f"anima-{suffix}"
    active_provider = await _store_provider(async_session, _model_provider(suffix=f"{suffix}a"))
    inactive_provider = await _store_provider(async_session, _model_provider(suffix=f"{suffix}b", active=False))
    await _store_anima(async_session, anima_id=anima_id)
    uow = _FakeUnitOfWork()
    service = AnimaChatProfileService(
        profiles=SQLAlchemyAnimaChatProfileRepository(async_session),
        model_providers=SQLAlchemyModelProviderRepository(async_session),
        uow=uow,
    )

    with pytest.raises(ValueError):
        await service.set_default_model_provider(
            anima_id=anima_id,
            model_provider_id=f"missing-provider-{suffix}",
        )
    with pytest.raises(ValueError):
        await service.set_default_model_provider(
            anima_id=anima_id,
            model_provider_id=inactive_provider.id,
        )

    stored = await service.set_default_model_provider(
        anima_id=anima_id,
        model_provider_id=active_provider.id,
        metadata_patch={"source": "explicit"},
    )
    updated = await service.set_default_model_provider(
        anima_id=anima_id,
        model_provider_id=active_provider.id,
        metadata_patch={"voice": {"enabled": True}},
    )
    row = await async_session.scalar(select(ORMAnimaChatProfile).where(ORMAnimaChatProfile.anima_id == anima_id))

    assert uow.commits == 2
    assert stored.default_model_provider_id == active_provider.id
    assert updated.metadata == {"source": "explicit", "voice": {"enabled": True}}
    assert row is not None
    assert row.default_model_provider_id == active_provider.id
    assert row.metadata_ == {"source": "explicit", "voice": {"enabled": True}}


@pytest.mark.asyncio
async def test_set_default_model_provider_without_uow_does_not_commit(async_session) -> None:
    suffix = _suffix()
    anima_id = f"anima-{suffix}"
    provider = await _store_provider(async_session, _model_provider(suffix=suffix))
    await _store_anima(async_session, anima_id=anima_id)
    service = AnimaChatProfileService(
        profiles=SQLAlchemyAnimaChatProfileRepository(async_session),
        model_providers=SQLAlchemyModelProviderRepository(async_session),
    )

    stored = await service.set_default_model_provider(
        anima_id=anima_id,
        model_provider_id=provider.id,
    )

    assert stored.default_model_provider_id == provider.id
    assert async_session.in_transaction()


@pytest.mark.asyncio
async def test_direct_creation_seeds_chat_profile_and_one_identity_history(async_session, tmp_path) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        request = fixture.request()
        result = await fixture.service(async_session).create(user_id=fixture.owner, request=request)
        anima_id = result["anima_id"]
        profile = await async_session.get(ORMAnimaChatProfile, anima_id)
        anima = await async_session.get(ORMAnima, anima_id)
        identity = await async_session.scalar(
            select(ORMMemoryEntry).where(ORMMemoryEntry.anima_id == anima_id, ORMMemoryEntry.path == "identity.md")
        )
        history = await async_session.scalar(
            select(ORMMemoryEntryVersion).where(ORMMemoryEntryVersion.entry_id == identity.id)
        )
        assert profile.default_model_provider_id == fixture.provider
        assert "runtime_graph" not in anima.metadata_
        assert "chat_runtime" not in anima.metadata_
        assert identity.content == request.identity_markdown
        assert identity.kind == "anima_identity" and identity.version == 1
        assert history.version == 1 and history.operation == "create"
        assert identity.metadata_ == {}
        assert (await async_session.get(ORMAnimaLoadout, anima_id)).revision == 1


def test_creation_schema_excludes_legacy_templates_and_client_model_choice() -> None:
    schema = CreateAnimaRequest.model_json_schema()
    for field in (
        "agents",
        "helpers",
        "graph",
        "anima",
        "anima_id",
        "avatar_source",
        "model_provider_id",
        "elevenlabs_voice_profile",
    ):
        assert field not in schema["properties"]
    assert schema["properties"]["avatar"]
    assert schema["properties"]["display_name"]
    assert schema["properties"]["identity_markdown"]


@pytest.mark.asyncio
async def test_update_anima_chat_profile_validates_ownership_and_active_provider(async_session) -> None:
    anima_id = f"anima-{_suffix()}"
    inactive_provider = await _store_provider(async_session, _model_provider(suffix="inactive", active=False))
    active_provider = await _store_provider(async_session, _model_provider(suffix="active"))
    await _store_anima(async_session, anima_id=anima_id)
    await async_session.commit()

    with pytest.raises(HTTPException) as inactive_exc:
        await update_anima_chat_profile(
            anima_id,
            PyAnimaChatProfileUpdateRequest(default_model_provider_id=inactive_provider.id),
            session=async_session,
            user=RequestPrincipal(id="user-1"),
        )
    assert inactive_exc.value.status_code == 400

    response = await update_anima_chat_profile(
        anima_id,
        PyAnimaChatProfileUpdateRequest(default_model_provider_id=active_provider.id),
        session=async_session,
        user=RequestPrincipal(id="user-1"),
    )
    payload = json.loads(response.body)

    assert payload["id"] == anima_id
    assert payload["chat_profile"]["default_model_provider_id"] == active_provider.id
    assert payload["chat_profile"]["metadata"]["source"] == "anima_chat_profile_update"

    with pytest.raises(HTTPException) as ownership_exc:
        await update_anima_chat_profile(
            anima_id,
            PyAnimaChatProfileUpdateRequest(default_model_provider_id=active_provider.id),
            session=async_session,
            user=RequestPrincipal(id="user-2"),
        )
    assert ownership_exc.value.status_code == 404
