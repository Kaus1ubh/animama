from __future__ import annotations

import asyncio
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import func, select, update

from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.app.anima_creation_contract import AnimaSpec, CreateAnimaRequest, canonical_spec_hash
from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.app.services.anima_runtime_service import AnimaRuntimeService
from animama.domain.anima_creation_error import AnimaCreationError
from animama.domain.anima_definition import DEFAULT_ANIMA_VOICE_ID
from animama.domain.request_principal import RequestPrincipal
from animama.orm import (
    ORMAnima,
    ORMAnimaChatProfile,
    ORMAnimaCreationReceipt,
    ORMAnimaDefinitionRevision,
    ORMAnimaSettings,
    ORMChat,
    ORMMemoryEntry,
    ORMMemoryEntryVersion,
    ORMModelProvider,
)
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.server.deps import get_current_principal
from tests.anima_creation_service_support import anima_creation_fixture, vrm


async def test_direct_creation_is_exact_atomic_and_has_no_runtime_or_provider(async_session, tmp_path, monkeypatch):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:

        async def no_runtime(*args, **kwargs):
            pytest.fail("Creation must not issue runtime")

        monkeypatch.setattr(AnimaRuntimeService, "issue", no_runtime)
        monkeypatch.setattr("animama.server.elevenlabs_service.validate_elevenlabs_voice_profile", no_runtime)
        monkeypatch.setattr("animama.server.model_clients.get_model_client_registry", no_runtime)
        service = fixture.service(async_session)
        result = await service.create(user_id=fixture.owner, request=fixture.request(actions=True))
        anima = await async_session.get(ORMAnima, result["anima_id"])
        assert anima.display_name == "Test  Companion"
        assert anima.aggregate_revision == 1 and anima.identity_status == "ready"
        assert all(value == 0 for value in anima.emotional_state.values())
        identity = await async_session.scalar(select(ORMMemoryEntry).where(ORMMemoryEntry.anima_id == anima.id))
        assert identity.content == "# Test\n\nKeep two spaces.  \n"
        assert identity.version == 1 and identity.kind == "anima_identity"
        assert (
            await async_session.scalar(
                select(func.count())
                .select_from(ORMMemoryEntryVersion)
                .where(ORMMemoryEntryVersion.anima_id == anima.id)
            )
            == 1
        )
        assert await async_session.get(ORMAnimaDefinitionRevision, (anima.id, 1)) is not None
        settings = await async_session.scalar(select(ORMAnimaSettings).where(ORMAnimaSettings.anima_id == anima.id))
        assert settings.preferences["speech"]["elevenlabs"]["primary_voice"]["voice_id"] == DEFAULT_ANIMA_VOICE_ID
        assert (await async_session.get(ORMAnimaChatProfile, anima.id)).default_model_provider_id == fixture.provider
        assert (
            await async_session.scalar(select(func.count()).select_from(ORMChat).where(ORMChat.anima_id == anima.id))
            == 0
        )
        loadout = await AnimaLoadoutService(async_session).read_model(user_id=fixture.owner, anima_id=anima.id)
        assert [gesture.semantic_key for gesture in loadout.gestures] == ["wave"]
        nonempty = [(cell.emotion, cell.intensity) for cell in loadout.reactions if cell.source is not None]
        assert sorted(nonempty) == [("joy", 1), ("sadness", 3)]
        assert result["aggregate_revision"] == result["identity_version"] == result["loadout_revision"] == 1


async def test_empty_actions_stay_empty_and_included_avatar_works(async_session, tmp_path):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        result = await fixture.service(async_session).create(
            user_id=fixture.owner, request=fixture.request(avatar="included-avatar")
        )
        loadout = await AnimaLoadoutService(async_session).read_model(
            user_id=fixture.owner, anima_id=result["anima_id"]
        )
        assert loadout.gestures == ()
        assert all(cell.source is None for cell in loadout.reactions)
        assert {issue["code"] for issue in result["warnings"]} == {
            "no_gestures_selected",
            "no_reactions_selected",
            "profile_portrait_unavailable",
        }


async def test_success_replay_precedes_all_current_checks_and_is_immutable(async_session, tmp_path):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        service = fixture.service(async_session)
        request = fixture.request()
        original = await service.create(user_id=fixture.owner, request=request)
        await async_session.execute(
            update(ORMContentCatalogItem)
            .where(ORMContentCatalogItem.id == request.avatar.item_id)
            .values(status="invalid", revision_sha256="f" * 64)
        )
        await async_session.execute(
            update(ORMModelProvider).where(ORMModelProvider.id == fixture.provider).values(active=False)
        )
        await async_session.execute(
            update(ORMAnima)
            .where(ORMAnima.id == original["anima_id"])
            .values(display_name="Edited", aggregate_revision=7)
        )
        await async_session.commit()
        replay = await fixture.service(async_session, max_identity_bytes=1).create(
            user_id=fixture.owner, request=request
        )
        assert replay == {**original, "idempotent_replay": True}
        assert (
            await async_session.scalar(
                select(func.count()).select_from(ORMAnima).where(ORMAnima.user_id == fixture.owner)
            )
            == 1
        )
        changed = request.model_copy(update={"display_name": "Changed"})
        with pytest.raises(AnimaCreationError) as error:
            await service.create(user_id=fixture.owner, request=changed)
        assert error.value.code == "idempotency_key_reused"
        assert await SQLAlchemyAnimaRepository(async_session).delete(original["anima_id"])
        await async_session.commit()
        with pytest.raises(AnimaCreationError) as error:
            await service.create(user_id=fixture.owner, request=request)
        assert error.value.code == "creation_result_deleted"
        receipt = await async_session.scalar(
            select(ORMAnimaCreationReceipt).where(ORMAnimaCreationReceipt.owner_user_id == fixture.owner)
        )
        assert receipt.deleted_at is not None
        assert "identity_markdown" not in str(receipt.result)


@pytest.mark.parametrize("stage", ["identity", "settings", "loadout", "audit", "receipt", "recheck"])
async def test_failure_rolls_back_aggregate_receipt_and_releases_key(async_session, tmp_path, monkeypatch, stage):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        service = fixture.service(async_session)

        async def fail(*args, **kwargs):
            raise RuntimeError("injected write failure")

        target, method = {
            "identity": (service.uow.memory_entries, "create_entry"),
            "settings": (service.uow.settings, "upsert"),
            "loadout": (service.uow.loadouts, "initialize"),
            "audit": (service.uow.animas, "record_definition_revision"),
            "receipt": (service.receipts, "save_receipt"),
            "recheck": (service.sources, "resolve"),
        }[stage]
        original = getattr(target, method)
        if stage == "recheck":
            calls = 0

            async def recheck(*args, **kwargs):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise RuntimeError("injected write failure")
                return await original(*args, **kwargs)

            monkeypatch.setattr(target, method, recheck)
        else:
            monkeypatch.setattr(target, method, fail)
        with pytest.raises(RuntimeError, match="injected"):
            await service.create(user_id=fixture.owner, request=fixture.request())
        assert (
            await async_session.scalar(
                select(func.count()).select_from(ORMAnima).where(ORMAnima.user_id == fixture.owner)
            )
            == 0
        )
        assert (
            await async_session.scalar(
                select(func.count())
                .select_from(ORMAnimaCreationReceipt)
                .where(ORMAnimaCreationReceipt.owner_user_id == fixture.owner)
            )
            == 0
        )
        assert (
            await async_session.scalar(
                select(func.count()).select_from(ORMMemoryEntry).where(ORMMemoryEntry.user_id == fixture.owner)
            )
            == 0
        )
        monkeypatch.setattr(target, method, original)
        result = await service.create(
            user_id=fixture.owner, request=fixture.request().model_copy(update={"display_name": "Retry after rollback"})
        )
        assert result["idempotent_replay"] is False


@pytest.mark.parametrize(
    "change,code,status",
    [
        ("missing", "anima_creation_source_unavailable", 404),
        ("stale", "anima_creation_sources_stale", 409),
        ("invalid", "anima_creation_invalid", 422),
        ("catalog_missing", "anima_creation_source_unavailable", 404),
        ("scan_required", "anima_creation_sources_stale", 409),
        ("file", "anima_creation_sources_stale", 409),
        ("map_missing", "anima_creation_invalid", 422),
        ("idle_missing", "anima_creation_invalid", 422),
        ("map_extra", "anima_creation_invalid", 422),
        ("map_kind", "anima_creation_invalid", 422),
        ("semantic", "anima_creation_invalid", 422),
        ("policy", "anima_creation_sources_stale", 409),
        ("default_model", "anima_creation_defaults_unavailable", 503),
    ],
)
async def test_sources_fail_closed_without_partial_creation(async_session, tmp_path, change, code, status):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        payload = fixture.request(actions=True).model_dump()
        if change == "missing":
            payload["avatar"]["item_id"] = str(uuid4())
        elif change in {"stale", "invalid", "catalog_missing", "scan_required"}:
            await async_session.execute(
                update(ORMContentCatalogItem)
                .where(ORMContentCatalogItem.id == payload["avatar"]["item_id"])
                .values(
                    **(
                        {"revision_sha256": "f" * 64}
                        if change == "stale"
                        else {"status": "missing" if change == "catalog_missing" else change}
                    )
                )
            )
            await async_session.commit()
        elif change == "file":
            (fixture.paths.local_root / "avatars/local-avatar.vrm").write_bytes(b"changed externally")
        elif change == "map_missing":
            del payload["expected_source_revisions"][fixture.items["gesture"].id]
        elif change == "idle_missing":
            del payload["expected_source_revisions"][fixture.items["idle"].id]
        elif change == "map_extra":
            payload["expected_source_revisions"][str(uuid4())] = {"kind": "avatar", "revision_sha256": "a" * 64}
        elif change == "map_kind":
            payload["expected_source_revisions"][payload["avatar"]["item_id"]]["kind"] = "gesture"
        elif change == "semantic":
            payload["gestures"][0]["semantic_key"] = "different"
        elif change == "policy":
            payload["starter_pack"]["revision_sha256"] = "f" * 64
        elif change == "default_model":
            await async_session.execute(
                update(ORMModelProvider).where(ORMModelProvider.id == fixture.provider).values(active=False)
            )
            await async_session.commit()
        with pytest.raises(AnimaCreationError) as error:
            await fixture.service(async_session).create(
                user_id=fixture.owner, request=CreateAnimaRequest.model_validate(payload)
            )
        assert (error.value.code, error.value.status) == (code, status), error.value.detail
        assert (
            await async_session.scalar(
                select(func.count()).select_from(ORMAnima).where(ORMAnima.user_id == fixture.owner)
            )
            == 0
        )


async def test_concurrent_same_key_creates_exactly_once(async_session, async_session_factory, tmp_path):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        request = fixture.request()

        async def submit():
            async with async_session_factory() as session:
                return await fixture.service(session).create(user_id=fixture.owner, request=request)

        first, second = await asyncio.gather(submit(), submit())
        assert first["anima_id"] == second["anima_id"]
        assert {first["idempotent_replay"], second["idempotent_replay"]} == {True, False}


async def test_http_schema_ownership_options_preview_and_replay(async_session, tmp_path, monkeypatch):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            options = await client.get("/v1/animas/creation-options")
            assert options.status_code == 200, options.text
            assert options.json()["limits"]["display_name_max_characters"] == 40
            assert options.json()["counts"]["recommended_reaction_cells"] == 72
            assert options.json()["default_idle"]["source"]["item_id"] == fixture.items["idle"].id
            preview = await client.post(f"/v1/avatar-content/{fixture.items['local-avatar'].id}:preview")
            assert preview.status_code == 200, preview.text
            assert set(preview.json()["expected_source_revisions"]) == {fixture.items["local-avatar"].id}
            spec = fixture.request().model_dump()
            invalid = await client.post(
                "/v1/animas", json={**spec, "user_id": "victim", "metadata": {"anything": "secret"}}
            )
            assert invalid.status_code == 422
            assert set(invalid.json()["detail"]) == {"code", "message", "retryable", "issues"}
            assert "secret" not in invalid.text
            validation = await client.post(
                "/v1/animas:validate", json={key: value for key, value in spec.items() if key != "idempotency_key"}
            )
            assert validation.status_code == 200, validation.text
            assert validation.json()["spec"]["appearance"] == {"profile": None, "background": None}
            assert (
                await async_session.scalar(
                    select(func.count())
                    .select_from(ORMAnimaCreationReceipt)
                    .where(ORMAnimaCreationReceipt.owner_user_id == fixture.owner)
                )
                == 0
            )
            original = await client.post("/v1/animas", json=spec)
            replay = await client.post("/v1/animas", json=spec)
            assert original.status_code == 201, original.text
            assert replay.status_code == 200 and replay.json()["anima_id"] == original.json()["anima_id"]
            assert (await client.post("/v1/animas", json={"anima": {"avatar_id": "old"}})).status_code == 422
            assert app.openapi()["components"]["schemas"]["CreateAnimaRequest"]["properties"]["display_name"][
                "maxLength"
            ] == 40

            async def unauthorized():
                raise HTTPException(401, "not logged in")

            app.dependency_overrides[get_current_principal] = unauthorized
            assert (await client.post("/v1/animas", json=spec)).status_code == 401


async def test_canonical_hash_and_strict_schema(async_session, tmp_path):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        original = fixture.request(actions=True).model_dump()
        original["appearance"]["profile"] = {
            "source": original["avatar"],
            "presentation": {"fit": "cover", "focal_x": 1, "focal_y": 0, "zoom": 1},
        }
        alternate = deepcopy(original)
        alternate["display_name"] = " Test  Companion "
        alternate["identity_markdown"] = alternate["identity_markdown"].replace("\n", "\r\n")
        alternate["appearance"]["profile"]["presentation"].update({"focal_x": 1.0, "focal_y": 0.0, "zoom": 1.0})
        alternate["idempotency_key"] = "another-key"
        assert canonical_spec_hash(CreateAnimaRequest.model_validate(original).spec()) == canonical_spec_hash(
            CreateAnimaRequest.model_validate(alternate).spec()
        )
        cases = []
        for key, value in (
            ("schema_version", True),
            ("schema_version", "1"),
            ("schema_version", 1.0),
            ("display_name", "\nBad"),
            ("display_name", "x" * 41),
            ("identity_markdown", "é" * 16385),
            ("identity_markdown", " \n "),
            ("identity_markdown", "\0"),
            ("idempotency_key", "../bad"),
            ("avatar", {"item_id": "/host/path", "revision_sha256": "a" * 64}),
        ):
            cases.append({**original, key: value})
        missing = deepcopy(original)
        del missing["reactions"]["joy"]["1"]
        cases.append(missing)
        duplicate = deepcopy(original)
        duplicate["gestures"] *= 2
        cases.append(duplicate)
        for value in (float("nan"), float("inf"), True, "0.5", -1, 2):
            invalid = deepcopy(original)
            invalid["appearance"]["profile"]["presentation"]["focal_x"] = value
            cases.append(invalid)
        for key, value in (("url", "https://untrusted.test/file"), ("metadata", {"arbitrary": True})):
            invalid = deepcopy(original)
            invalid["avatar"][key] = value
            cases.append(invalid)
        for payload in cases:
            with pytest.raises(ValidationError):
                CreateAnimaRequest.model_validate(payload)


async def test_idempotency_and_hidden_sources_are_owner_scoped(async_session, tmp_path, monkeypatch):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        other = await fixture.add_owner(async_session)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            spec = fixture.request(avatar="included-avatar").model_dump()
            first = await client.post("/v1/animas", json=spec)
            assert first.status_code == 201, first.text

            async def other_user():
                return RequestPrincipal(id=other)

            app.dependency_overrides[get_current_principal] = other_user
            second = await client.post("/v1/animas", json=spec)
            assert second.status_code == 201, second.text
            assert second.json()["anima_id"] != first.json()["anima_id"]
            hidden = await client.post("/v1/animas", json=fixture.request(key="hidden-source").model_dump())
            assert hidden.status_code == 404, hidden.text
            assert "current_revision_sha256" not in hidden.text and fixture.owner not in hidden.text
            assert fixture.items["local-avatar"].relative_locator not in hidden.text


@pytest.mark.parametrize(
    "change,status",
    [
        (None, 201),
        ("missing_revision", 422),
        ("stale", 409),
        ("invalid", 422),
        ("scan_required", 409),
        ("hidden", 404),
        ("bytes", 409),
    ],
)
async def test_exact_dependency_closure_and_action_attribution(async_session, tmp_path, monkeypatch, change, status):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        await fixture.add_action_support(async_session)
        support = fixture.items["sound"]
        payload = fixture.request(actions=True).model_dump()
        payload["expected_source_revisions"][support.id] = {
            "kind": "sound_effect",
            "revision_sha256": support.revision_sha256,
        }
        if change == "missing_revision":
            del payload["expected_source_revisions"][support.id]
        elif change in {"stale", "invalid", "hidden", "scan_required"}:
            values = {"revision_sha256": "f" * 64} if change == "stale" else {"status": change}
            if change == "hidden":
                other = await fixture.add_owner(async_session)
                values = {"scope": "owner", "owner_user_id": other}
            await async_session.execute(
                update(ORMContentCatalogItem).where(ORMContentCatalogItem.id == support.id).values(**values)
            )
            await async_session.commit()
        elif change == "bytes":
            (fixture.paths.local_root / "sfx/chime.wav").write_bytes(b"changed on host")
        app = fixture.app(async_session, monkeypatch)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            if change is None:
                preview = await client.post(f"/v1/gestures/{fixture.items['gesture'].id}:preview")
                assert preview.status_code == 200, preview.text
                assert set(preview.json()["expected_source_revisions"]) == {fixture.items["gesture"].id, support.id}
            result = await client.post("/v1/animas", json=payload)
            assert result.status_code == status, result.text
            if change is not None:
                issue = result.json()["detail"]["issues"][0]
                assert issue["declaring_action_item_id"] == fixture.items["gesture"].id
                if change == "hidden":
                    assert "current_revision_sha256" not in result.text


async def test_physical_drift_after_receipt_write_rolls_back_everything(async_session, tmp_path, monkeypatch):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        service = fixture.service(async_session)
        original = service.receipts.save_receipt

        async def write_then_drift(*args, **kwargs):
            await original(*args, **kwargs)
            (fixture.paths.local_root / "avatars/local-avatar.vrm").write_bytes(vrm("host changed after receipt"))

        monkeypatch.setattr(service.receipts, "save_receipt", write_then_drift)
        with pytest.raises(AnimaCreationError) as error:
            await service.create(user_id=fixture.owner, request=fixture.request())
        assert error.value.status == 409 and error.value.detail["retryable"]
        assert not list(await async_session.scalars(select(ORMAnima).where(ORMAnima.user_id == fixture.owner)))
        assert not list(
            await async_session.scalars(
                select(ORMAnimaCreationReceipt).where(ORMAnimaCreationReceipt.owner_user_id == fixture.owner)
            )
        )


async def test_validation_respects_smaller_installation_identity_limit(async_session, tmp_path):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        spec = AnimaSpec.model_validate(fixture.request().spec().model_dump())
        with pytest.raises(AnimaCreationError) as error:
            await fixture.service(async_session, max_identity_bytes=3).validate(user_id=fixture.owner, spec=spec)
        assert error.value.status == 422 and error.value.detail["issues"][0]["path"] == "/identity_markdown"
