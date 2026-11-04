"""Complete-Anima exports share only the active encoded Pocket clone."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from zipfile import ZipFile

import pytest
from sqlalchemy import delete, select, update

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.anima_creation_contract import CreateAnimaRequest
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.anima_runtime_service import AnimaRuntimeService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService
from animama.domain.content_catalog import ContentConflictError, ContentKind
from animama.orm.content_catalog import ORMAnimaContentBinding
from animama.orm.settings import ORMAnimaSettings, ORMUserSettings
from animama.server.schemas.runtime_content import PyAnimaRuntime
from tests.anima_creation_service_support import anima_creation_fixture
from tests.content_package_helpers import reviewed_import
from tests.test_anima_creation_voice import saved_clone
from tests.test_pocket_voice_content import source_audio, voice_catalog


@asynccontextmanager
async def voice_package(session, tmp_path: Path):
    """Use real saved clone files, creation bindings, source capture and archives."""
    async with anima_creation_fixture(session, tmp_path) as fixture:
        clone = await saved_clone(fixture, session)
        body = fixture.request().model_dump()
        body["voice"] = {
            "provider": "pocket_tts",
            "pocket": {"type": "clone", "source": {"item_id": clone.id, "revision_sha256": clone.revision_sha256}},
            "elevenlabs_voice_id": "PRIVATE_ELEVENLABS_CHOICE",
        }
        body["expected_source_revisions"][clone.id] = {"kind": "voice", "revision_sha256": clone.revision_sha256}
        created = await fixture.service(session).create(
            user_id=fixture.owner, request=CreateAnimaRequest.model_validate(body)
        )
        catalog = SQLAlchemyContentCatalog(session)
        content = ContentCatalogService(catalog=catalog, store=fixture.store())
        sources = AnimaPackageSourceService(catalog=catalog, sources=SQLAlchemyAnimaPackageSourceRepository(session))
        packages = ContentPackageService(
            content=content,
            exports_root=fixture.paths.exports_staging_root,
            imports_root=fixture.paths.imports_staging_root,
            anima_sources=sources,
            uow=SQLAlchemyAnimaAggregateUnitOfWork(session),
            default_model_provider_id=fixture.provider,
        )
        try:
            yield fixture, clone, created["anima_id"], catalog, sources, packages
        finally:
            await session.rollback()
            await session.execute(delete(ORMUserSettings).where(ORMUserSettings.user_id == fixture.owner))
            await session.commit()


async def prepare(packages, owner: str, anima_id: str):
    summary = await packages.summarize(user_id=owner, anima_id=anima_id)
    review = await packages.prepare_export(user_id=owner, anima_id=anima_id, expected_digest=summary.digest)
    cached = await packages.get_export(user_id=owner, export_id=review.export_id)
    return summary, cached


async def test_active_clone_exports_encoded_catalog_without_original_or_provider_secrets(async_session, tmp_path):
    async with voice_package(async_session, tmp_path) as (fixture, clone, anima_id, catalog, sources, packages):
        source_files = {
            path.name: path.read_bytes() for path in (fixture.paths.local_root / "voices/narrator").iterdir()
        }
        summary, cached = await prepare(packages, fixture.owner, anima_id)
        assert summary.anima is not None and summary.anima.pocket_voice == clone.id
        assert sum(item.kind == "voice" for item in summary.items) == 1
        visible = {item.id: item for item in await catalog.list_visible(user_id=fixture.owner)}
        assert summary.estimated_size_bytes == sum(
            file.size_bytes
            for item in summary.items
            for file in visible[item.item_id].files
            if not (item.kind == "voice" and file.role == "source_sample")
        )
        with ZipFile(cached.path) as archive:
            manifest = json.loads(archive.read("package.json"))
            voice = next(entry for entry in manifest["entries"] if entry["kind"] == "voice")
            assert manifest["anima"]["pocket_voice"] == voice["package_entry_id"]
            assert voice["package_entry_id"] != clone.id
            assert {file["role"] for file in voice["files"]} == {"descriptor", "pocket_voice_catalog"}
            members = {file["role"]: archive.read(file["archive_path"]) for file in voice["files"]}
            assert members["pocket_voice_catalog"] == voice_catalog()
            descriptor = json.loads(members["descriptor"])
            assert descriptor["files"] == [{"path": "voice.bin", "role": "pocket_voice_catalog"}]
            assert descriptor["content_id"] == voice["package_entry_id"]
            assert all("original.wav" not in member for member in archive.namelist())
            assert all(b"PRIVATE_ELEVENLABS_CHOICE" not in archive.read(member) for member in archive.namelist())
        assert source_files == {
            path.name: path.read_bytes() for path in (fixture.paths.local_root / "voices/narrator").iterdir()
        }
        assert source_files["original.wav"] == source_audio()
        await sources.recheck(
            user_id=fixture.owner, snapshot=(await sources.capture(user_id=fixture.owner, anima_id=anima_id)).snapshot
        )


@pytest.mark.parametrize(
    "owner_provider,anima_provider,expected",
    [
        (None, "elevenlabs", False),
        ("pocket_tts", None, True),
        (None, None, False),
        ("pocket_tts", "elevenlabs", False),
        ("pocket_tts", "gemini", False),
    ],
)
async def test_export_follows_effective_provider_but_not_speech_enable(
    async_session, tmp_path, owner_provider, anima_provider, expected
):
    async with voice_package(async_session, tmp_path) as (fixture, clone, anima_id, _, _, packages):
        speech = {"tts_enabled": False}
        if anima_provider is not None:
            speech["tts_provider"] = anima_provider
        await async_session.execute(
            update(ORMAnimaSettings).where(ORMAnimaSettings.anima_id == anima_id).values(preferences={"speech": speech})
        )
        if owner_provider is not None:
            async_session.add(
                ORMUserSettings(user_id=fixture.owner, preferences={"speech": {"tts_provider": owner_provider}})
            )
        await async_session.commit()
        _, cached = await prepare(packages, fixture.owner, anima_id)
        with ZipFile(cached.path) as archive:
            manifest = json.loads(archive.read("package.json"))
            assert bool(manifest["anima"].get("pocket_voice")) is expected
            assert any(entry["kind"] == "voice" for entry in manifest["entries"]) is expected


@pytest.mark.parametrize("scope", ["anima", "owner"])
async def test_provider_change_without_revision_bump_invalidates_review(async_session, tmp_path, scope):
    async with voice_package(async_session, tmp_path) as (fixture, _, anima_id, _, sources, packages):
        if scope == "owner":
            await async_session.execute(
                update(ORMAnimaSettings).where(ORMAnimaSettings.anima_id == anima_id).values(preferences={})
            )
            async_session.add(
                ORMUserSettings(user_id=fixture.owner, preferences={"speech": {"tts_provider": "pocket_tts"}})
            )
            await async_session.commit()
        projection = await sources.capture(user_id=fixture.owner, anima_id=anima_id)
        summary = await packages.summarize(user_id=fixture.owner, anima_id=anima_id)
        model, predicate = (
            (ORMAnimaSettings, ORMAnimaSettings.anima_id == anima_id)
            if scope == "anima"
            else (ORMUserSettings, ORMUserSettings.user_id == fixture.owner)
        )
        await async_session.execute(
            update(model).where(predicate).values(preferences={"speech": {"tts_provider": "elevenlabs"}})
        )
        await async_session.commit()
        with pytest.raises(ContentConflictError, match="package_anima_source_changed"):
            await sources.recheck(user_id=fixture.owner, snapshot=projection.snapshot)
        with pytest.raises(ContentConflictError):
            await packages.prepare_export(user_id=fixture.owner, anima_id=anima_id, expected_digest=summary.digest)


async def test_clone_copy_replay_and_reexport_keep_original_binding_and_recording(async_session, tmp_path):
    async with voice_package(async_session, tmp_path) as (fixture, clone, anima_id, catalog, sources, packages):
        _, cached = await prepare(packages, fixture.owner, anima_id)
        command = await reviewed_import(
            packages, user_id=fixture.owner, archive_path=cached.path, operation_id="voice-copy"
        )
        result = await packages.imports.commit(**command)
        imported = next(item for item in result.items if item.kind is ContentKind.VOICE)
        assert imported.item_id != clone.id and result.anima_id != anima_id
        assert await packages.imports.commit(**command) == result
        original_binding = await async_session.scalar(
            select(ORMAnimaContentBinding).where(
                ORMAnimaContentBinding.anima_id == anima_id, ORMAnimaContentBinding.kind == "voice"
            )
        )
        assert original_binding.catalog_item_id == clone.id
        assert (fixture.paths.local_root / "voices/narrator/original.wav").read_bytes() == source_audio()
        copied = await catalog.get_visible_item(user_id=fixture.owner, item_id=imported.item_id)
        assert copied is not None and {file.role for file in copied.files} == {"descriptor", "pocket_voice_catalog"}
        assert result.anima_id is not None
        settings = await async_session.get(ORMAnimaSettings, (fixture.owner, result.anima_id))
        assert settings is not None and settings.preferences["speech"] == {
            "tts_provider": "pocket_tts",
            "tts_pocket_anima_voice": "eve",
            "tts_pocket_anima_custom_voice_available": False,
            "elevenlabs": {},
        }
        runtime = PyAnimaRuntime.model_validate(
            await AnimaRuntimeService(async_session, store=fixture.store()).issue(
                user_id=fixture.owner, anima_id=result.anima_id
            )
        )
        assert runtime.voice is not None and runtime.voice.name == imported.name
        assert [file.role for file in runtime.voice.files] == ["pocket_voice_catalog"]
        assert runtime.voice.files[0].file_ref == next(
            file.file_ref for file in copied.files if file.role == "pocket_voice_catalog"
        )
        assert runtime.voice.files[0].url.startswith(f"/v1/animas/{result.anima_id}/runtime/revisions/")
        assert not any(diagnostic.slot_key == "voice" for diagnostic in runtime.content_descriptor.diagnostics)
        projection = await sources.capture(user_id=fixture.owner, anima_id=result.anima_id)
        assert projection.definition.pocket_voice == imported.item_id
        # Release the completed import before reserving another bounded stage;
        # the durable receipt still owns replay after its transport bytes expire.
        packages.stages.discard(fixture.owner, command["stage_id"])
        assert await packages.imports.commit(**command) == result
        _, reexported = await prepare(packages, fixture.owner, result.anima_id)
        with ZipFile(reexported.path) as archive:
            manifest = json.loads(archive.read("package.json"))
            voice = next(entry for entry in manifest["entries"] if entry["kind"] == "voice")
            catalog_file = next(file for file in voice["files"] if file["role"] == "pocket_voice_catalog")
            assert archive.read(catalog_file["archive_path"]) == voice_catalog()
