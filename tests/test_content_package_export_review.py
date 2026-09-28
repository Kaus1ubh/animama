"""Selection is cheap; export review freezes portable bytes independently of edits."""

from __future__ import annotations

import asyncio
import json
import re
import threading
import wave
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from zipfile import ZipFile

import pytest
from sqlalchemy import delete, update

from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.anima_creation_contract import CreateAnimaRequest
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_export import ContentPackageExportService, _download_filename
from animama.app.services.content_package_service import ContentPackageService
from animama.app.services.content_package_staging import PackageStageService
from animama.app.services.typed_content_service import TypedContentAdmissionError
from animama.domain.content_catalog import ContentConflictError
from animama.orm.anima import ORMAnima
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.anima_creation_service_support import anima_creation_fixture, image_bytes, vrm, write_file, write_json
from tests.content_package_helpers import package_services, save_wave, vrma
from tests.test_content_package_v3_archive import sound_package, write_package


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("Test Companion", "Test Companion-20260924-235958Z.zip"),
        ("旅の友 / A", "旅の友 - A-20260924-235958Z.zip"),
        ("Élodie Ray", "Élodie Ray-20260924-235958Z.zip"),
        (" ", "content-20260924-235958Z.zip"),
    ],
)
def test_download_filename_preserves_safe_names_with_a_utc_zip_timestamp(
    monkeypatch: pytest.MonkeyPatch, label: str, expected: str
) -> None:
    now = datetime(2026, 9, 24, 23, 59, 58, tzinfo=UTC)
    monkeypatch.setattr("animama.app.services.content_package_export.datetime", SimpleNamespace(now=lambda _: now))
    assert _download_filename(label) == expected


@pytest.mark.parametrize("direction", ["import", "export"])
async def test_small_package_review_uses_its_actual_expansion_on_low_disk(
    async_session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, direction: str
) -> None:  # noqa: ANN001
    paths, _catalog, _content, saves, packages = package_services(async_session, tmp_path)
    monkeypatch.setattr(
        "animama.app.services.content_package_staging.shutil.disk_usage",
        lambda _: SimpleNamespace(free=64 * 1024**2),
    )
    try:
        if direction == "export":
            saved = await save_wave(saves)
            summary = await packages.summarize(user_id="package-owner", item_ids=(saved.item.id,))
            review = await packages.prepare_export(
                user_id="package-owner", item_ids=(saved.item.id,), expected_digest=summary.digest
            )
        else:
            archive = tmp_path / "tiny.zip"
            manifest, payloads = sound_package()
            write_package(archive, manifest, payloads)
            stage = packages.stages.create_import(
                "package-owner", "low-disk-import", archive.name, archive.stat().st_size
            )
            with archive.open("rb") as source:
                packages.stages.append_part("package-owner", stage.stage_id, 0, source)
            review = await packages.imports.review(user_id="package-owner", stage_id=stage.stage_id)
        assert review.size_bytes < 64 * 1024**2
        assert not list(paths.imports_staging_root.rglob("inspection"))
        assert not list(paths.exports_staging_root.rglob("inspection"))
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_export_summary_and_review_freeze_portable_bytes(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths, _catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        sidecar = paths.local_root / "gestures/friendly-wave.meta.json"
        source = json.loads(sidecar.read_bytes())
        source["provenance"]["private_history_marker"] = "PRIVATE-IDENTITY-HISTORY-123"
        sidecar.write_text(json.dumps(source))
        await content.rescan(user_id="package-owner", include_included=False)
        summary = await packages.summarize(user_id="package-owner", item_ids=(saved.item.id,))
        assert summary.selected_count == 1
        assert summary.required_count == 0
        assert not list(paths.exports_staging_root.rglob("*.zip"))

        review = await packages.prepare_export(
            user_id="package-owner", item_ids=(saved.item.id,), expected_digest=summary.digest
        )
        assert re.fullmatch(r"content-\d{8}-\d{6}Z\.zip", review.filename)
        cached = await packages.get_export(user_id="package-owner", export_id=review.export_id)
        before = cached.path.read_bytes()
        with ZipFile(cached.path) as archive:
            manifest = json.loads(archive.read("package.json"))
            assert manifest["schema"] == "animama-content-package/3"
            assert manifest["kind"] == "content"
            assert len(manifest["root_entry_ids"]) == 1
            assert manifest["root_entry_ids"][0] == manifest["entries"][0]["package_entry_id"]
            payloads = [archive.read(name) for name in archive.namelist() if name.endswith(".json")]
            assert all(b"PRIVATE-IDENTITY-HISTORY-123" not in payload for payload in payloads)
            assert all(saved.item.id.encode() not in payload for payload in payloads)
        (paths.local_root / "gestures/friendly-wave.vrma").write_bytes(vrma("later edit"))
        await content.rescan(user_id="package-owner", include_included=False)
        retained = await packages.get_export(user_id="package-owner", export_id=review.export_id)
        assert retained.path.read_bytes() == before
        assert retained.filename == review.filename
        with pytest.raises(ContentConflictError, match="package_export_source_changed"):
            await packages.prepare_export(
                user_id="package-owner", item_ids=(saved.item.id,), expected_digest=summary.digest
            )
        with pytest.raises(ContentConflictError, match="package_export_unavailable"):
            await packages.get_export(user_id="different-owner", export_id=review.export_id)
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


@pytest.mark.parametrize("change", ["expired", "changed"])
async def test_cached_download_never_regenerates_an_expired_or_changed_archive(
    async_session, tmp_path: Path, change: str
) -> None:  # noqa: ANN001
    paths, _catalog, _content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        summary = await packages.summarize(user_id="package-owner", item_ids=(saved.item.id,))
        review = await packages.prepare_export(
            user_id="package-owner", item_ids=(saved.item.id,), expected_digest=summary.digest
        )
        cache = await packages.get_export(user_id="package-owner", export_id=review.export_id)
        if change == "expired":
            record = cache.path.with_name("record.json")
            value = json.loads(record.read_bytes())
            value["expires_at"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
            record.write_text(json.dumps(value))
        else:
            cache.path.write_bytes(b"Changed cache")
        before = cache.path.read_bytes()
        with pytest.raises(ContentConflictError, match=f"package_export_{change}"):
            await packages.get_export(user_id="package-owner", export_id=review.export_id)
        assert cache.path.read_bytes() == before
        assert len(list(paths.exports_staging_root.rglob("*.zip"))) == 1
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_overlapping_selected_roots_share_one_support_and_count_selected_once(
    async_session, tmp_path: Path
) -> None:  # noqa: ANN001
    paths, _catalog, content, _saves, packages = package_services(async_session, tmp_path)
    audio = BytesIO()
    with wave.open(audio, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b"\x01\x00" * 800)
    write_file(paths.local_root / "sfx/chime.wav", audio.getvalue())
    write_json(paths.local_root / "sfx/chime.meta.json", {"name": "Chime", "content_id": "local:sound:chime"})
    for name in ("wave", "hello"):
        write_file(paths.local_root / f"gestures/{name}.vrma", vrma(name))
        write_json(
            paths.local_root / f"gestures/{name}.meta.json",
            {
                "name": name,
                "content_id": name,
                "semantic_key": name,
                "dependencies": [{"ref": "local:sound:chime", "content_type": "sound_effect"}],
            },
        )
    try:
        scanned = await content.rescan(user_id="package-owner")
        by_name = {item.display_name: item for item in scanned.items}
        roots = tuple(by_name[name].id for name in ("wave", "hello"))
        summary = await packages.summarize(user_id="package-owner", item_ids=roots)
        assert (summary.selected_count, summary.required_count) == (2, 1)
        reviewed = await packages.prepare_export(
            user_id="package-owner", item_ids=roots, expected_digest=summary.digest
        )
        assert len(reviewed.manifest.entries) == 3
        assert len({edge.ref for entry in reviewed.manifest.entries for edge in entry.dependencies}) == 1
        cached = await packages.get_export(user_id="package-owner", export_id=reviewed.export_id)
        with ZipFile(cached.path) as archive:
            for entry in reviewed.manifest.entries:
                if entry.kind.value == "gesture":
                    descriptor = next(file for file in entry.files if file.role == "metadata")
                    document = json.loads(archive.read(descriptor.archive_path))
                    assert document["semantic_key"] == document["name"] == entry.display_name
        all_roots = (*roots, by_name["Chime"].id)
        summary = await packages.summarize(user_id="package-owner", item_ids=all_roots)
        assert (summary.selected_count, summary.required_count) == (3, 0)
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


@pytest.mark.parametrize("alias", [None, "chime"])
async def test_export_rewrites_normalized_clip_event_selectors(
    async_session, tmp_path: Path, alias: str | None
) -> None:  # noqa: ANN001
    paths, _catalog, content, _saves, packages = package_services(async_session, tmp_path)
    audio = BytesIO()
    with wave.open(audio, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b"\x01\x00" * 800)
    write_file(paths.local_root / "sfx/chime.wav", audio.getvalue())
    write_json(paths.local_root / "sfx/chime.meta.json", {"name": "Chime", "content_id": "local:sound:chime"})
    dependency = {"ref": "local:sound:chime", "content_type": "sound_effect"}
    if alias:
        dependency["alias"] = alias
    write_json(
        paths.local_root / "gestures/wave/wave.meta.json",
        {
            "schema_version": 1,
            "content_type": "gesture",
            "content_id": "local:gesture:wave",
            "name": "Wave",
            "semantic_key": "wave",
            "implementation": {"kind": "anima_clip", "file_role": "sequence"},
            "files": [{"path": "wave.json", "role": "sequence"}],
            "dependencies": [dependency],
        },
    )
    write_json(
        paths.local_root / "gestures/wave/wave.json",
        {
            "schema": "animaPoseClip/1.0",
            "id": "wave",
            "name": "Wave",
            "duration": 1,
            "poses": {},
            "poseKeyframes": [],
            "events": [{"id": "sound", "kind": "sfx", "time": 0, "cueId": f"\ufeff {alias or dependency['ref']} "}],
        },
    )
    try:
        scanned = await content.rescan(user_id="package-owner")
        root = next(item for item in scanned.items if item.display_name == "Wave")
        summary = await packages.summarize(user_id="package-owner", item_ids=(root.id,))
        review = await packages.prepare_export(
            user_id="package-owner", item_ids=(root.id,), expected_digest=summary.digest
        )
        cached = await packages.get_export(user_id="package-owner", export_id=review.export_id)
        action = next(entry for entry in review.manifest.entries if entry.kind.value == "gesture")
        sequence = next(member for member in action.files if member.role == "sequence")
        with ZipFile(cached.path) as archive:
            clip = json.loads(archive.read(sequence.archive_path))
        assert clip["events"][0]["cueId"] == (alias or action.dependencies[0].ref)
        assert clip["name"] == "Wave"
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_avatar_default_portrait_is_automatic_and_broken_association_blocks_review(
    async_session, tmp_path: Path
) -> None:  # noqa: ANN001
    paths, _catalog, content, _saves, packages = package_services(async_session, tmp_path)
    write_file(paths.local_root / "avatars/companion.vrm", vrm())
    write_json(
        paths.local_root / "avatars/companion.meta.json", {"name": "Companion", "content_id": "local:avatar:companion"}
    )
    try:
        avatar = (await content.rescan(user_id="package-owner")).items[0]
        without = await packages.summarize(user_id="package-owner", item_ids=(avatar.id,))
        assert without.required_count == 0
        portrait_path = paths.local_root / "appearances/portrait.png"
        write_file(portrait_path, image_bytes())
        write_json(
            paths.local_root / "appearances/portrait.meta.json",
            {
                "name": "Portrait",
                "content_id": "local:appearance:portrait",
                "avatar_model": "sender-model",
                "presentation": {"avatar_item_id": avatar.id},
            },
        )
        await content.rescan(user_id="package-owner")
        with pytest.raises(ContentConflictError, match="package_export_source_changed"):
            await packages.prepare_export(
                user_id="package-owner", item_ids=(avatar.id,), expected_digest=without.digest
            )
        summary = await packages.summarize(user_id="package-owner", item_ids=(avatar.id,))
        assert summary.required_count == 1
        review = await packages.prepare_export(
            user_id="package-owner", item_ids=(avatar.id,), expected_digest=summary.digest
        )
        assert len(review.manifest.avatar_portraits) == 1
        assert len(review.manifest.entries) == 2
        cached = await packages.get_export(user_id="package-owner", export_id=review.export_id)
        with ZipFile(cached.path) as archive:
            assert all(
                avatar.id.encode() not in archive.read(name) for name in archive.namelist() if name.endswith(".json")
            )
        portrait_path.write_bytes(b"broken image")
        await content.rescan(user_id="package-owner")
        with pytest.raises(TypedContentAdmissionError, match="source_invalid|typed_document_invalid"):
            await packages.summarize(user_id="package-owner", item_ids=(avatar.id,))
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


@pytest.mark.parametrize("display_name", ["Test Companion", "旅の友 / A"])
async def test_complete_anima_export_keeps_explicit_empties_and_independent_shared_image(
    async_session, tmp_path: Path, display_name: str
) -> None:  # noqa: ANN001
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        request = fixture.request(avatar="included-avatar").model_dump()
        request["display_name"] = display_name
        picture = fixture.items["image"]
        for role, fit in (("profile", "contain"), ("background", "cover")):
            request["appearance"][role] = {
                "source": {"item_id": picture.id, "revision_sha256": picture.revision_sha256},
                "presentation": {"fit": fit, "focal_x": 0.3, "focal_y": 0.7, "zoom": 1.5},
            }
        request["expected_source_revisions"][picture.id] = {
            "kind": "appearance",
            "revision_sha256": picture.revision_sha256,
        }
        created = await fixture.service(async_session).create(
            user_id=fixture.owner, request=CreateAnimaRequest.model_validate(request)
        )
        anima_id = created["anima_id"]
        await async_session.execute(
            update(ORMAnima)
            .where(ORMAnima.id == anima_id)
            .values(
                metadata_={
                    "chats": "PRIVATE-CHAT-SENTINEL",
                    "credentials": "PRIVATE-CREDENTIAL-SENTINEL",
                    "identity_history": "PRIVATE-HISTORY-SENTINEL",
                }
            )
        )
        await async_session.commit()
        write_file(fixture.paths.operations_root / "private-attachment.txt", b"PRIVATE-ATTACHMENT-SENTINEL")
        catalog = SQLAlchemyContentCatalog(async_session)
        content = ContentCatalogService(catalog=catalog, store=fixture.store())
        packages = ContentPackageService(
            content=content,
            exports_root=fixture.paths.exports_staging_root,
            anima_sources=AnimaPackageSourceService(
                catalog=catalog, sources=SQLAlchemyAnimaPackageSourceRepository(async_session)
            ),
        )
        summary = await packages.summarize(user_id=fixture.owner, anima_id=anima_id)
        review = await packages.prepare_export(user_id=fixture.owner, anima_id=anima_id, expected_digest=summary.digest)
        cached = await packages.get_export(user_id=fixture.owner, export_id=review.export_id)
        with ZipFile(cached.path) as archive:
            manifest = json.loads(archive.read("package.json"))
            definition = manifest["anima"]
            assert definition["display_name"] == display_name
            assert "/" not in review.filename and "\\" not in review.filename
            expected_name = display_name.replace("/", "-")
            assert re.fullmatch(rf"{re.escape(expected_name)}-\d{{8}}-\d{{6}}Z\.zip", review.filename)
            assert manifest["kind"] == "anima" and manifest["root_entry_ids"] == []
            assert len(manifest["entries"]) == 2  # One model, one image shared by both independent roles.
            assert definition["idle_style"] is None and definition["gestures"] == []
            assert sum(len(cells) for cells in definition["reactions"].values()) == 72
            assert all(value is None for cells in definition["reactions"].values() for value in cells.values())
            assert definition["identity_markdown"] == request["identity_markdown"]
            profile, background = definition["appearance"]["profile"], definition["appearance"]["background"]
            assert profile["entry_id"] == background["entry_id"]
            assert profile["presentation"]["fit"] == "contain" and background["presentation"]["fit"] == "cover"
            assert manifest["avatar_portraits"] == []
            for name in archive.namelist():
                payload = archive.read(name)
                assert b"PRIVATE-" not in payload
                assert fixture.owner.encode() not in payload and anima_id.encode() not in payload
                assert fixture.provider.encode() not in payload


@pytest.mark.parametrize("change", ["bytes", "new_portrait"])
async def test_drift_during_capture_rejects_review_and_removes_its_cache(
    async_session, tmp_path: Path, monkeypatch, change: str
) -> None:  # noqa: ANN001
    paths, _catalog, content, _saves, packages = package_services(async_session, tmp_path)
    write_file(paths.local_root / "avatars/companion.vrm", vrm())
    write_json(
        paths.local_root / "avatars/companion.meta.json", {"name": "Companion", "content_id": "local:avatar:companion"}
    )
    try:
        avatar = (await content.rescan(user_id="package-owner")).items[0]
        summary = await packages.summarize(user_id="package-owner", item_ids=(avatar.id,))
        original = ContentPackageExportService._write

        def mutate_after_capture(service, selection, destination):  # noqa: ANN001, ANN202
            result = original(service, selection, destination)
            if change == "bytes":
                write_file(paths.local_root / "avatars/companion.vrm", vrm("changed during capture"))
            else:
                write_file(paths.local_root / "appearances/new-portrait.png", image_bytes())
                write_json(
                    paths.local_root / "appearances/new-portrait.meta.json",
                    {
                        "name": "New portrait",
                        "content_id": "local:appearance:new-portrait",
                        "presentation": {"avatar_item_id": avatar.id},
                    },
                )
            return result

        monkeypatch.setattr(ContentPackageExportService, "_write", mutate_after_capture)
        with pytest.raises(ContentConflictError, match="package_export_source_changed"):
            await packages.prepare_export(
                user_id="package-owner", item_ids=(avatar.id,), expected_digest=summary.digest
            )
        assert not list(paths.exports_staging_root.rglob("*.zip"))
        assert not list(paths.exports_staging_root.rglob("record.json"))
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_export_reserves_real_zip_growth_and_download_excludes_expiry_cleanup(
    async_session, tmp_path: Path
) -> None:  # noqa: ANN001
    paths, _catalog, content, saves, _packages = package_services(async_session, tmp_path)
    now = datetime(2026, 9, 24, tzinfo=UTC)
    stages = PackageStageService(paths.imports_staging_root, paths.exports_staging_root, clock=lambda: now)
    exports = ContentPackageExportService(content=content, exports_root=paths.exports_staging_root, stages=stages)
    try:
        saved = await save_wave(saves)
        stages.create_import("package-owner", "pending-import", "pending.zip", 10)
        summary = await exports.summarize(user_id="package-owner", item_ids=(saved.item.id,))
        review = await exports.prepare(
            user_id="package-owner", item_ids=(saved.item.id,), expected_digest=summary.digest
        )
        record, active = stages.status("package-owner", review.export_id, "export")
        assert not active
        assert record.reserved_bytes >= review.size_bytes > summary.estimated_size_bytes
        with pytest.raises(ContentConflictError, match="package_stage_limit"):
            await exports.prepare(user_id="package-owner", item_ids=(saved.item.id,), expected_digest=summary.digest)
        download = await exports.download(user_id="package-owner", export_id=review.export_id)
        try:
            now += timedelta(minutes=31)
            stages.sweep_expired()
            assert stages.status("package-owner", review.export_id, "export")[1]
            assert len(download.handle.read()) == review.size_bytes
            with pytest.raises(ContentConflictError, match="package_stage_active"):
                stages.discard("package-owner", review.export_id, "export")
        finally:
            download.close()
        stages.sweep_expired()
        with pytest.raises(ContentConflictError, match="package_export_unavailable"):
            await exports.download(user_id="package-owner", export_id=review.export_id)
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_interrupted_response_keeps_the_same_download_retryable(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    _paths, _catalog, _content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        summary = await packages.summarize(user_id="package-owner", item_ids=(saved.item.id,))
        review = await packages.prepare_export(
            user_id="package-owner", item_ids=(saved.item.id,), expected_digest=summary.digest
        )
        partial = await packages.exports.download(user_id="package-owner", export_id=review.export_id)
        assert partial.handle.read(1)
        partial.close(reclaimable=True)
        retried = await packages.exports.download(user_id="package-owner", export_id=review.export_id)
        try:
            assert len(retried.handle.read()) == review.size_bytes
            assert retried.review.package_sha256 == review.package_sha256
        finally:
            retried.close(reclaimable=True)
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_cancelled_download_open_closes_completed_handle_and_releases_stage(
    async_session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:  # noqa: ANN001
    paths, _catalog, content, saves, _packages = package_services(async_session, tmp_path)
    stages = PackageStageService(paths.imports_staging_root, paths.exports_staging_root)
    exports = ContentPackageExportService(content=content, exports_root=paths.exports_staging_root, stages=stages)
    started, release = threading.Event(), threading.Event()
    held = []
    try:
        saved = await save_wave(saves)
        summary = await exports.summarize(user_id="package-owner", item_ids=(saved.item.id,))
        review = await exports.prepare(
            user_id="package-owner", item_ids=(saved.item.id,), expected_digest=summary.digest
        )
        original = exports._open_download

        def delayed_open(user_id: str, export_id: str):  # noqa: ANN202
            result = original(user_id, export_id)
            held.append(result)
            started.set()
            assert release.wait(10)
            return result

        monkeypatch.setattr(exports, "_open_download", delayed_open)
        pending = asyncio.create_task(exports.download(user_id="package-owner", export_id=review.export_id))
        assert await asyncio.to_thread(started.wait, 10)
        pending.cancel()
        await asyncio.sleep(0)
        pending.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await pending
        assert held[0].handle.closed
        stages.discard("package-owner", review.export_id, "export")
        assert not list(paths.exports_staging_root.rglob("package.zip"))
    finally:
        release.set()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()
