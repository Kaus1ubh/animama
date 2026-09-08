from __future__ import annotations

import json
import re
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import func, select, update

from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.anima_creation_contract import EnsureAnimaStartersRequest
from animama.app.ports.anima_creation_port import StarterReceipt
from animama.app.services import anima_starter_service
from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.app.services.anima_starter_service import STARTER_ANIMA_SPECS, AnimaStarterService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.starter_loadout_policy import starter_loadout_policy
from animama.domain.anima import Anima
from animama.domain.anima_chat_profile import AnimaChatProfile
from animama.domain.anima_creation_error import AnimaCreationError
from animama.domain.anima_definition import DEFAULT_ANIMA_VOICE_ID
from animama.domain.avatar import Avatar
from animama.domain.request_principal import RequestPrincipal
from animama.domain.settings import AnimaSettings
from animama.orm import ORMAnima, ORMAnimaCreationReceipt, ORMAnimaSettings, ORMAnimaStarterReceipt, ORMMemoryEntry
from animama.server.routers.anima import list_animas
from tests.anima_creation_service_support import anima_creation_fixture

REQUEST = EnsureAnimaStartersRequest(schema_version=1, repairs=[])


async def legacy_anima(session, fixture, spec, *, profile: bool = True):
    """Reproduce pre-cutover persisted evidence without retaining a retired API.

    Real Version 1 identity history is essential to the adoption check. A later
    customized value must never become a new source of historical provenance.
    """

    service = fixture.service(session)
    avatar = await service.uow.avatars.get(spec.legacy_avatar_id)
    if avatar is None:
        avatar = await service.uow.avatars.create(
            Avatar(
                id=spec.legacy_avatar_id,
                name=f"Legacy {spec.display_name} {uuid4().hex}",
                identity=spec.identity_markdown,
                file_path=f"/shared/{spec.avatar_locator}",
                private=False,
            )
        )
        fixture.extra_avatar_ids.add(avatar.id)
    anima = Anima(
        id=f"legacy-{uuid4().hex}",
        user_id=fixture.owner,
        display_name=avatar.name,
        avatar=avatar,
        profile_picture_url=spec.legacy_profile_url if profile else None,
    )
    stored = await service.uow.animas.create(anima)
    await MemoryEntryService(
        memory_entries=service.uow.memory_entries,
        animas=service.uow.animas,
        uow=service.uow,
        commit_on_write=False,
    ).initialize_anima_identity(
        user_id=fixture.owner,
        anima_id=anima.id,
        content=avatar.identity,
        description=f"Initial identity of {avatar.name}",
        metadata={
            "anima_id": anima.id,
            "source": {"type": "avatar_identity_seed", "avatar_id": avatar.id, "avatar_name": avatar.name},
        },
    )
    await service.uow.settings.upsert(
        AnimaSettings(
            user_id=fixture.owner,
            anima_id=anima.id,
            preferences={"speech": {"elevenlabs": {"primary_voice": {"voice_id": "legacy_voice"}}}},
        )
    )
    await service.uow.chat_profiles.upsert(
        AnimaChatProfile(anima_id=anima.id, default_model_provider_id=fixture.provider)
    )
    await session.commit()
    return stored


async def mark_legacy(session, fixture):
    repository = fixture.service(session).receipts
    for spec in STARTER_ANIMA_SPECS:
        await repository.save_starter(
            user_id=fixture.owner, receipt=StarterReceipt(spec.id, 1, "legacy_unresolved", None, [])
        )
    await session.commit()


@pytest.mark.parametrize("spec", [spec for spec in STARTER_ANIMA_SPECS if spec.version == 1])
def test_original_starter_identity_is_exact_backend_owned_seed_text(spec):
    seed = (Path(__file__).parents[1] / "alembic/seeds/02-seed-avatars.sql").read_text()
    match = re.search(re.escape(f"('{spec.legacy_avatar_id}'") + r".*?\$\$(.*?)\$\$", seed, re.S)
    assert match and spec.identity_markdown == match.group(1).replace("\r\n", "\n").replace("\r", "\n")


@pytest.mark.parametrize("mounted_included", [False, True])
async def test_fresh_starters_retry_preserve_customization_and_deletion(
    async_session, tmp_path, monkeypatch, mounted_included
):
    async with anima_creation_fixture(
        async_session, tmp_path, full_starter=True, mounted_included=mounted_included
    ) as fixture:
        service = AnimaStarterService(fixture.service(async_session))
        first = await service.ensure(user_id=fixture.owner, request=REQUEST)
        assert first["complete"] is True
        assert [value["outcome"] for value in first["starters"]] == ["created", "created"]
        ids = [value["anima_id"] for value in first["starters"]]
        versions = [value["spec_version"] for value in first["starters"]]
        avatar_ids = []
        for anima_id, spec in zip(ids, STARTER_ANIMA_SPECS, strict=True):
            anima = await async_session.get(ORMAnima, anima_id)
            avatar_ids.append(anima.avatar_id)
            assert anima.display_name == spec.display_name
            avatar = await service.uow.avatars.get(anima.avatar_id)
            assert avatar.file_path.endswith(spec.avatar_locator)
            identity = await async_session.scalar(select(ORMMemoryEntry).where(ORMMemoryEntry.anima_id == anima_id))
            assert identity.content == spec.identity_markdown
            settings = await async_session.scalar(select(ORMAnimaSettings).where(ORMAnimaSettings.anima_id == anima_id))
            assert settings.preferences["speech"]["elevenlabs"]["primary_voice"]["voice_id"] == DEFAULT_ANIMA_VOICE_ID
            loadout = await AnimaLoadoutService(async_session).read_model(user_id=fixture.owner, anima_id=anima_id)
            assert len(loadout.gestures) == len(starter_loadout_policy()["gestures"])
            assert all(cell.source is not None for cell in loadout.reactions)
        # Launch uses the API's creation order, not names or recent updates.
        listed = json.loads((await list_animas(session=async_session, user=RequestPrincipal(id=fixture.owner))).body)
        assert [anima["id"] for anima in listed] == ids
        assert listed[0]["display_name"] == "Annie"
        await async_session.execute(
            update(ORMAnima).where(ORMAnima.id == ids[0]).values(display_name="My customized Annie")
        )
        await async_session.commit()
        listed = json.loads((await list_animas(session=async_session, user=RequestPrincipal(id=fixture.owner))).body)
        assert [anima["id"] for anima in listed] == ids
        await SQLAlchemyAnimaRepository(async_session).delete(ids[1])
        await async_session.commit()
        monkeypatch.setattr(
            anima_starter_service,
            "STARTER_ANIMA_SPECS",
            tuple(
                replace(spec, version=spec.version + 1, avatar_locator="avatars/next-unavailable.vrm")
                for spec in STARTER_ANIMA_SPECS
            ),
        )
        replay = await service.ensure(user_id=fixture.owner, request=REQUEST)
        assert [value["anima_id"] for value in replay["starters"]] == ids
        assert [value["outcome"] for value in replay["starters"]] == ["existing", "deleted"]
        assert [value["spec_version"] for value in replay["starters"]] == versions
        assert replay["complete"] is True
        assert (await async_session.get(ORMAnima, ids[0], populate_existing=True)).display_name == "My customized Annie"
        assert (await async_session.get(ORMAnima, ids[0])).avatar_id == avatar_ids[0]


async def test_fresh_signup_reuses_seeded_avatar_rows_without_lazy_io(async_session, tmp_path):
    """A real installation has legacy Included Avatar rows before its first signup."""

    async with anima_creation_fixture(async_session, tmp_path, full_starter=True) as fixture:
        creation = fixture.service(async_session)
        for spec in STARTER_ANIMA_SPECS:
            avatar = await creation.uow.avatars.create(
                Avatar(
                    id=f"seeded-{uuid4().hex}",
                    name=f"Seeded {spec.display_name} {uuid4().hex}",
                    file_path=f"/shared/{spec.avatar_locator}",
                    private=False,
                )
            )
            fixture.extra_avatar_ids.add(avatar.id)
        await async_session.commit()
        result = await AnimaStarterService(creation).ensure(user_id=fixture.owner, request=REQUEST)
        assert result["complete"] is True
        assert [value["outcome"] for value in result["starters"]] == ["created", "created"]
        again = await AnimaStarterService(creation).ensure(user_id=fixture.owner, request=REQUEST)
        assert [value["anima_id"] for value in again["starters"]] == [value["anima_id"] for value in result["starters"]]


async def test_partial_ensure_commits_first_and_retry_only_finishes_second(async_session, tmp_path, monkeypatch):
    async with anima_creation_fixture(async_session, tmp_path, full_starter=True) as fixture:
        creation = fixture.service(async_session)
        service = AnimaStarterService(creation)
        original = creation.materializer.materialize

        async def fail_second(*args, **kwargs):
            if kwargs["spec"].display_name == "Caitlyn":
                raise RuntimeError("temporary second-starter failure")
            return await original(*args, **kwargs)

        monkeypatch.setattr(creation.materializer, "materialize", fail_second)
        with pytest.raises(RuntimeError, match="second-starter"):
            await service.ensure(user_id=fixture.owner, request=REQUEST)
        assert (
            await async_session.scalar(
                select(func.count()).select_from(ORMAnima).where(ORMAnima.user_id == fixture.owner)
            )
            == 1
        )
        first_id = await async_session.scalar(select(ORMAnima.id).where(ORMAnima.user_id == fixture.owner))
        assert (
            await async_session.scalar(
                select(func.count())
                .select_from(ORMAnimaCreationReceipt)
                .where(ORMAnimaCreationReceipt.owner_user_id == fixture.owner)
            )
            == 1
        )
        monkeypatch.setattr(creation.materializer, "materialize", original)
        result = await service.ensure(user_id=fixture.owner, request=REQUEST)
        assert result["starters"][0]["anima_id"] == first_id
        assert [value["outcome"] for value in result["starters"]] == ["existing", "created"]


async def test_unambiguous_legacy_adoption_preserves_identity_voice_and_history(async_session, tmp_path):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        await mark_legacy(async_session, fixture)
        created = [await legacy_anima(async_session, fixture, spec) for spec in STARTER_ANIMA_SPECS]
        await async_session.execute(
            update(ORMAnima).where(ORMAnima.id == created[0].id).values(display_name="Custom live name")
        )
        await async_session.execute(
            update(ORMMemoryEntry)
            .where(ORMMemoryEntry.anima_id == created[0].id)
            .values(content="# Owner customization", version=2)
        )
        await async_session.commit()
        result = await AnimaStarterService(fixture.service(async_session)).ensure(
            user_id=fixture.owner, request=REQUEST
        )
        assert [value["outcome"] for value in result["starters"]] == ["adopted", "adopted"]
        assert [value["anima_id"] for value in result["starters"]] == [value.id for value in created]
        assert (
            await async_session.get(ORMAnima, created[0].id, populate_existing=True)
        ).display_name == "Custom live name"
        identity = await async_session.scalar(select(ORMMemoryEntry).where(ORMMemoryEntry.anima_id == created[0].id))
        assert identity.content == "# Owner customization" and identity.version == 2
        settings = await async_session.scalar(
            select(ORMAnimaSettings).where(ORMAnimaSettings.anima_id == created[0].id)
        )
        assert settings.preferences["speech"]["elevenlabs"]["primary_voice"]["voice_id"] == "legacy_voice"


@pytest.mark.parametrize("signature", ["absent", "partial", "ambiguous"])
async def test_legacy_uncertainty_never_automatically_recreates(async_session, tmp_path, signature):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        await mark_legacy(async_session, fixture)
        if signature != "absent":
            await legacy_anima(async_session, fixture, STARTER_ANIMA_SPECS[0], profile=signature != "partial")
        if signature == "ambiguous":
            await legacy_anima(async_session, fixture, STARTER_ANIMA_SPECS[0])
        count = await async_session.scalar(
            select(func.count()).select_from(ORMAnima).where(ORMAnima.user_id == fixture.owner)
        )
        service = AnimaStarterService(fixture.service(async_session))
        result = await service.ensure(user_id=fixture.owner, request=REQUEST)
        assert result["complete"] is False
        assert all(value["outcome"] == "repair_required" for value in result["starters"])
        assert result == await service.ensure(user_id=fixture.owner, request=REQUEST)
        assert (
            await async_session.scalar(
                select(func.count()).select_from(ORMAnima).where(ORMAnima.user_id == fixture.owner)
            )
            == count
        )


async def test_explicit_legacy_repairs_are_owned_and_cannot_override_success(async_session, tmp_path, monkeypatch):
    async with anima_creation_fixture(async_session, tmp_path, full_starter=True) as fixture:
        await mark_legacy(async_session, fixture)
        creation = fixture.service(async_session)
        service = AnimaStarterService(creation)
        await service.ensure(user_id=fixture.owner, request=REQUEST)
        candidate = await creation.create(user_id=fixture.owner, request=fixture.request())
        request = EnsureAnimaStartersRequest.model_validate(
            {
                "schema_version": 1,
                "repairs": [
                    {"starter_id": "starter:annie", "action": "adopt", "anima_id": candidate["anima_id"]},
                    {"starter_id": "starter:caitlyn", "action": "create_missing"},
                ],
            }
        )
        result = await service.ensure(user_id=fixture.owner, request=request)
        assert result["complete"] is True
        assert [value["outcome"] for value in result["starters"]] == ["adopted", "created"]
        replay = await service.ensure(user_id=fixture.owner, request=REQUEST)
        assert [value["anima_id"] for value in replay["starters"]] == [
            value["anima_id"] for value in result["starters"]
        ]
        with pytest.raises(AnimaCreationError) as error:
            await service.ensure(user_id=fixture.owner, request=request)
        assert error.value.detail["issues"][0]["code"] == "starter_repair_not_allowed"
        async with AsyncClient(
            transport=ASGITransport(app=fixture.app(async_session, monkeypatch)), base_url="http://test"
        ) as client:
            response = await client.post("/v1/animas/starters:ensure", json=REQUEST.model_dump())
            assert response.status_code == 200, response.text
            assert response.json()["complete"] is True


def test_starter_request_forbids_templates_duplicate_and_unknown_repairs():
    for payload in (
        {"schema_version": 1, "repairs": [], "animas": []},
        {"schema_version": 1, "repairs": [{"starter_id": "starter:other", "action": "create_missing"}]},
        {"schema_version": 1, "repairs": [{"starter_id": "starter:annie", "action": "create_missing"}] * 2},
        {
            "schema_version": 1,
            "repairs": [{"starter_id": "starter:annie", "action": "create_missing", "anima_id": "forbidden"}],
        },
    ):
        with pytest.raises(ValidationError):
            EnsureAnimaStartersRequest.model_validate(payload)


async def test_starter_repair_cannot_adopt_another_owners_companion(async_session, tmp_path):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        other = await fixture.add_owner(async_session)
        creation = fixture.service(async_session)
        foreign = await creation.create(user_id=other, request=fixture.request(avatar="included-avatar"))
        await mark_legacy(async_session, fixture)
        request = EnsureAnimaStartersRequest.model_validate(
            {
                "schema_version": 1,
                "repairs": [{"starter_id": "starter:annie", "action": "adopt", "anima_id": foreign["anima_id"]}],
            }
        )
        with pytest.raises(AnimaCreationError) as error:
            await AnimaStarterService(creation).ensure(user_id=fixture.owner, request=request)
        assert error.value.status == 404
        assert (
            await creation.receipts.starter(user_id=fixture.owner, starter_id="starter:annie")
        ).state == "legacy_unresolved"


async def test_retired_bulk_api_is_absent_and_cannot_write_legacy_receipts(async_session, tmp_path, monkeypatch):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        assert "/v1/animas/bulk" not in app.openapi()["paths"]
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/v1/animas/bulk", json=[{"anima": {"avatar_id": "old"}}])
            assert response.status_code in {404, 405}
        assert (
            await async_session.scalar(
                select(func.count()).select_from(ORMAnima).where(ORMAnima.user_id == fixture.owner)
            )
            == 0
        )
        assert (
            await async_session.scalar(
                select(func.count())
                .select_from(ORMAnimaStarterReceipt)
                .where(ORMAnimaStarterReceipt.owner_user_id == fixture.owner)
            )
            == 0
        )


async def test_real_shipped_included_content_can_materialize_both_starters(async_session, tmp_path):
    """Read real shipped bytes, but create only disposable database companions."""

    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        fixture.paths = replace(fixture.paths, included_root=Path(__file__).parents[1] / "content/included")
        scanned = await ContentCatalogService(
            catalog=SQLAlchemyContentCatalog(async_session),
            store=fixture.store(),
        ).rescan(user_id=fixture.owner)
        fixture.extra_catalog_ids.update(item.id for item in scanned.items)
        result = await AnimaStarterService(fixture.service(async_session)).ensure(
            user_id=fixture.owner, request=REQUEST
        )
        assert result["complete"] is True
        assert [value["outcome"] for value in result["starters"]] == ["created", "created"]
        for value in result["starters"]:
            assert value["diagnostics"] == []
            loadout = await AnimaLoadoutService(async_session).read_model(
                user_id=fixture.owner, anima_id=value["anima_id"]
            )
            assert len(loadout.gestures) == 46 and all(cell.source is not None for cell in loadout.reactions)
