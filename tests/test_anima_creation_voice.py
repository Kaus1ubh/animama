"""Creation stores explicit speech choices in the same aggregate transaction."""

from __future__ import annotations

import hashlib
import json

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from animama.app.anima_creation_contract import CreateAnimaRequest, canonical_spec_hash
from animama.orm import ORMAnimaSettings
from tests.anima_creation_service_support import anima_creation_fixture


@pytest.mark.parametrize("provider", ["pocket_tts", "elevenlabs"])
async def test_creation_keeps_both_provider_choices(async_session, tmp_path, provider):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        body = fixture.request().model_dump()
        body["voice"] = {
            "provider": provider,
            "pocket": {"type": "preset", "voice_id": "azelma"},
            "elevenlabs_voice_id": "my-eleven-voice",
        }
        request = CreateAnimaRequest.model_validate(body)
        result = await fixture.service(async_session).create(user_id=fixture.owner, request=request)
        settings = await async_session.scalar(
            select(ORMAnimaSettings).where(ORMAnimaSettings.anima_id == result["anima_id"])
        )
        assert settings.preferences["speech"] == {
            "tts_provider": provider,
            "tts_pocket_anima_voice": "azelma",
            "tts_pocket_anima_custom_voice_available": False,
            "elevenlabs": {"primary_voice": {"voice_id": "my-eleven-voice"}},
        }
        assert result["loadout_revision"] == 1


async def test_legacy_voice_omission_preserves_receipt_hash(async_session, tmp_path):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        spec = fixture.request().spec()
        original = spec.model_dump(exclude={"voice"})
        expected = hashlib.sha256(
            json.dumps(original, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
        assert canonical_spec_hash(spec) == expected


async def test_elevenlabs_requires_a_voice_id(async_session, tmp_path):
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        body = fixture.request().model_dump()
        body["voice"] = {
            "provider": "elevenlabs",
            "pocket": {"type": "preset", "voice_id": "eve"},
            "elevenlabs_voice_id": None,
        }
        with pytest.raises(ValidationError, match="ElevenLabs voice ID"):
            CreateAnimaRequest.model_validate(body)


async def saved_clone(fixture, session):
    from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
    from animama.app.services.content_catalog_service import ContentCatalogService
    from animama.domain.content_catalog import ContentKind
    from tests.test_pocket_voice_content import clone_document, source_audio, voice_catalog

    fixture.store().save_descriptor_entry(
        kind=ContentKind.VOICE,
        relative_locator="voices/narrator",
        descriptor=json.dumps(clone_document()).encode(),
        companion_files={"original.wav": source_audio(), "voice.bin": voice_catalog()},
        operation_id="creation-clone",
    )
    result = await ContentCatalogService(catalog=SQLAlchemyContentCatalog(session), store=fixture.store()).rescan(
        user_id=fixture.owner, include_included=False
    )
    return next(item for item in result.items if item.kind is ContentKind.VOICE)


@pytest.mark.parametrize("provider", ["pocket_tts", "elevenlabs"])
async def test_creation_binds_shared_clone_at_revision_one(async_session, tmp_path, provider):
    from animama.app.services.anima_loadout_service import AnimaLoadoutService

    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        clone = await saved_clone(fixture, async_session)
        body = fixture.request().model_dump()
        body["voice"] = {
            "provider": provider,
            "pocket": {"type": "clone", "source": {"item_id": clone.id, "revision_sha256": clone.revision_sha256}},
            "elevenlabs_voice_id": "saved-eleven",
        }
        body["expected_source_revisions"][clone.id] = {"kind": "voice", "revision_sha256": clone.revision_sha256}
        request = CreateAnimaRequest.model_validate(body)
        result = await fixture.service(async_session).create(user_id=fixture.owner, request=request)
        loadout = await AnimaLoadoutService(async_session).read_model(
            user_id=fixture.owner, anima_id=result["anima_id"]
        )
        assert loadout.revision == 1
        assert loadout.voice_source is not None
        assert loadout.voice_source.catalog_item_id == clone.id
        replay = await fixture.service(async_session).create(user_id=fixture.owner, request=request)
        assert replay["anima_id"] == result["anima_id"] and replay["idempotent_replay"]
        assert (fixture.paths.local_root / "voices/narrator/original.wav").exists()


@pytest.mark.parametrize("change", ["stale", "foreign", "preset"])
async def test_invalid_voice_prevents_the_whole_creation(async_session, tmp_path, change):
    from sqlalchemy import func, update

    from animama.domain.anima_creation_error import AnimaCreationError
    from animama.orm import ORMAnima
    from animama.orm.content_catalog import ORMContentCatalogItem

    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        clone = await saved_clone(fixture, async_session)
        body = fixture.request().model_dump()
        body["voice"] = {
            "provider": "pocket_tts",
            "pocket": {"type": "clone", "source": {"item_id": clone.id, "revision_sha256": clone.revision_sha256}},
            "elevenlabs_voice_id": None,
        }
        body["expected_source_revisions"][clone.id] = {"kind": "voice", "revision_sha256": clone.revision_sha256}
        if change == "stale":
            body["voice"]["pocket"]["source"]["revision_sha256"] = "f" * 64
        elif change == "foreign":
            other = await fixture.add_owner(async_session)
            await async_session.execute(
                update(ORMContentCatalogItem).where(ORMContentCatalogItem.id == clone.id).values(owner_user_id=other)
            )
            await async_session.commit()
        else:
            body["voice"]["pocket"] = {"type": "preset", "voice_id": "unknown"}
            del body["expected_source_revisions"][clone.id]
        with pytest.raises(AnimaCreationError):
            await fixture.service(async_session).create(
                user_id=fixture.owner, request=CreateAnimaRequest.model_validate(body)
            )
        assert (
            await async_session.scalar(
                select(func.count()).select_from(ORMAnima).where(ORMAnima.user_id == fixture.owner)
            )
            == 0
        )


async def test_clone_creation_rollback_keeps_library_but_no_anima(async_session, tmp_path, monkeypatch):
    from sqlalchemy import func

    from animama.orm import ORMAnima, ORMAnimaCreationReceipt

    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        clone = await saved_clone(fixture, async_session)
        body = fixture.request().model_dump()
        body["voice"] = {
            "provider": "pocket_tts",
            "pocket": {"type": "clone", "source": {"item_id": clone.id, "revision_sha256": clone.revision_sha256}},
            "elevenlabs_voice_id": None,
        }
        body["expected_source_revisions"][clone.id] = {"kind": "voice", "revision_sha256": clone.revision_sha256}
        service = fixture.service(async_session)

        async def fail_after_loadout(**kwargs):
            raise RuntimeError("creation-audit-failed")

        monkeypatch.setattr(service.uow.animas, "record_definition_revision", fail_after_loadout)
        with pytest.raises(RuntimeError, match="creation-audit-failed"):
            await service.create(user_id=fixture.owner, request=CreateAnimaRequest.model_validate(body))
        for model, column in [
            (ORMAnima, ORMAnima.user_id),
            (ORMAnimaSettings, ORMAnimaSettings.user_id),
            (ORMAnimaCreationReceipt, ORMAnimaCreationReceipt.owner_user_id),
        ]:
            assert (
                await async_session.scalar(select(func.count()).select_from(model).where(column == fixture.owner)) == 0
            )
        assert (fixture.paths.local_root / "voices/narrator/original.wav").exists()
