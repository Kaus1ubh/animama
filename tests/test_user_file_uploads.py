from __future__ import annotations

from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.services.user_file_service import UserFileService
from animama.domain.request_principal import RequestPrincipal
from animama.domain.user_file import (
    STATUS_ABORTED,
    STATUS_DELETE_PENDING,
    STATUS_DELETED,
    STATUS_PENDING_UPLOAD,
    STATUS_UPLOADED,
    UserFile,
)
from animama.domain.user_file_processing import UserFileProcessingInfo
from animama.product_http.uploads import SpooledUpload
from animama.server.config import settings
from animama.server.routers import user_files as user_files_router
from animama.server.schemas.user_file import PyUserFileUploadInitRequest


class _FakeUserFileRepository:
    def __init__(self, files: list[UserFile] | None = None) -> None:
        self.files: dict[str, UserFile] = {user_file.id: user_file for user_file in files or []}

    async def create_user_file(self, user_file: UserFile) -> UserFile:
        self.files[user_file.id] = user_file
        return user_file

    async def get_user_file(
        self,
        *,
        user_id: str,
        file_id: str,
        include_deleted: bool = False,
    ) -> UserFile | None:
        user_file = self.files.get(file_id)
        if user_file is None or user_file.user_id != user_id:
            return None
        if not include_deleted and user_file.status == STATUS_DELETED:
            return None
        return user_file

    async def get_user_file_for_update(
        self,
        *,
        user_id: str,
        file_id: str,
        include_deleted: bool = False,
    ) -> UserFile | None:
        return await self.get_user_file(user_id=user_id, file_id=file_id, include_deleted=include_deleted)

    async def list_user_files(self, *, user_id: str) -> list[UserFile]:
        files = [
            user_file
            for user_file in self.files.values()
            if user_file.user_id == user_id and user_file.status != STATUS_DELETED
        ]
        return sorted(files, key=lambda user_file: user_file.created_at or datetime.min, reverse=True)

    async def update_user_file(self, user_file: UserFile) -> UserFile:
        self.files[user_file.id] = user_file
        return user_file


class _FakeUnitOfWork:
    def __init__(self) -> None:
        self.commit_calls = 0
        self.rollback_calls = 0

    async def commit(self) -> None:
        self.commit_calls += 1

    async def rollback(self) -> None:
        self.rollback_calls += 1


class _FakeProcessingService:
    def __init__(self) -> None:
        self.deleted_chunks: list[tuple[str, str]] = []

    async def list_processing_info(self, *, user_id: str, file_ids: list[str]) -> dict[str, UserFileProcessingInfo]:
        return {file_id: UserFileProcessingInfo(file_id=file_id, chunk_count=0) for file_id in file_ids}

    async def delete_chunks_for_file(self, *, user_id: str, file_id: str) -> None:
        self.deleted_chunks.append((user_id, file_id))


def _user(user_id: str = "user-1") -> RequestPrincipal:
    return RequestPrincipal(id=user_id)


def _file(
    file_id: str = "file-1",
    *,
    user_id: str = "user-1",
    status: str = STATUS_PENDING_UPLOAD,
    declared_size_bytes: int = 12,
    created_at: datetime | None = None,
) -> UserFile:
    return UserFile(
        id=file_id,
        user_id=user_id,
        storage_locator=f"user-files/{user_id}/{file_id}/original",
        original_filename=f"{file_id}.txt",
        normalized_extension=".txt",
        declared_content_type="text/plain",
        declared_size_bytes=declared_size_bytes,
        status=status,
        upload_expires_at=datetime.now(UTC) + timedelta(minutes=10),
        metadata={},
        created_at=created_at,
    )


def _patch_service(monkeypatch: pytest.MonkeyPatch, repo: _FakeUserFileRepository, uow: _FakeUnitOfWork) -> None:
    monkeypatch.setattr(
        user_files_router,
        "_service",
        lambda _session: UserFileService(user_files=repo, uow=uow),
    )
    monkeypatch.setattr(user_files_router, "_processing_service", lambda _session: _FakeProcessingService())


@pytest.mark.asyncio
async def test_init_user_file_upload_returns_authenticated_local_put_and_file_id(monkeypatch) -> None:
    expires_at = datetime(2026, 6, 9, 12, 0, tzinfo=UTC)
    repo = _FakeUserFileRepository()
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)

    monkeypatch.setattr(user_files_router, "new_user_file_id", lambda: "file-fixed")
    monkeypatch.setattr(user_files_router, "private_upload_expires_at", lambda: expires_at)

    response = await user_files_router.init_user_file_upload(
        PyUserFileUploadInitRequest(
            filename="notes.TXT",
            content_type="text/plain",
            size_bytes=12,
        ),
        session=AsyncSession(),
        user=_user(),
    )

    assert response.method == "PUT"
    assert response.file_id == "file-fixed"
    assert response.headers == {"Content-Type": "text/plain"}
    assert response.expires_at == expires_at
    assert response.upload_url == "/v1/files/file-fixed/content"
    assert repo.files["file-fixed"].storage_locator == "user-files/user-1/file-fixed/original"
    assert repo.files["file-fixed"].original_filename == "notes.TXT"
    assert repo.files["file-fixed"].normalized_extension == ".txt"
    assert repo.files["file-fixed"].status == STATUS_PENDING_UPLOAD
    assert uow.commit_calls == 1


@pytest.mark.asyncio
async def test_init_user_file_upload_rejects_unsupported_extension() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await user_files_router.init_user_file_upload(
            PyUserFileUploadInitRequest(filename="run.sh", content_type="text/x-shellscript", size_bytes=12),
            session=AsyncSession(),
            user=_user(),
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Unsupported file extension"


@pytest.mark.parametrize("filename", ["paper.pdf", "brief.docx", "deck.pptx", "sheet.xlsx"])
@pytest.mark.asyncio
async def test_init_user_file_upload_accepts_phase_2_rich_extensions(monkeypatch, filename: str) -> None:
    expires_at = datetime(2026, 6, 9, 12, 0, tzinfo=UTC)
    repo = _FakeUserFileRepository()
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)

    monkeypatch.setattr(user_files_router, "new_user_file_id", lambda: "file-fixed")
    monkeypatch.setattr(user_files_router, "private_upload_expires_at", lambda: expires_at)

    response = await user_files_router.init_user_file_upload(
        PyUserFileUploadInitRequest(filename=filename, content_type=None, size_bytes=12),
        session=AsyncSession(),
        user=_user(),
    )

    assert response.file_id == "file-fixed"
    assert repo.files["file-fixed"].normalized_extension == f".{filename.rsplit('.', 1)[1]}"


@pytest.mark.parametrize("filename", ["template.docm", "macro.xlsm", "slides.pptm", "archive.zip", "run.py"])
@pytest.mark.asyncio
async def test_init_user_file_upload_rejects_blocked_extensions(filename: str) -> None:
    with pytest.raises(HTTPException) as exc_info:
        await user_files_router.init_user_file_upload(
            PyUserFileUploadInitRequest(filename=filename, content_type=None, size_bytes=12),
            session=AsyncSession(),
            user=_user(),
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Unsupported file extension"


@pytest.mark.asyncio
async def test_init_user_file_upload_rejects_too_large_file() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await user_files_router.init_user_file_upload(
            PyUserFileUploadInitRequest(
                filename="notes.txt",
                content_type="text/plain",
                size_bytes=settings.anima_user_file_max_upload_bytes + 1,
            ),
            session=AsyncSession(),
            user=_user(),
        )

    assert exc_info.value.status_code == 400
    assert "byte limit" in exc_info.value.detail


@pytest.mark.asyncio
async def test_init_user_file_upload_returns_503_when_local_target_cannot_be_built(monkeypatch) -> None:
    repo = _FakeUserFileRepository()
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)
    monkeypatch.setattr(user_files_router, "private_upload_url", lambda *_args, **_kwargs: None)

    with pytest.raises(HTTPException) as exc_info:
        await user_files_router.init_user_file_upload(
            PyUserFileUploadInitRequest(filename="notes.txt", content_type="text/plain", size_bytes=12),
            session=AsyncSession(),
            user=_user(),
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Failed to initialize upload"


@pytest.mark.asyncio
async def test_upload_user_file_content_promotes_exact_bytes_to_private_storage(monkeypatch) -> None:
    payload = b"hello local!"
    repo = _FakeUserFileRepository([_file(declared_size_bytes=len(payload))])
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)
    captured: dict[str, object] = {}

    async def fake_spool(*_args, **_kwargs) -> SpooledUpload:
        return SpooledUpload(stream=BytesIO(payload), size_bytes=len(payload), sha256="unused")

    def fake_put(locator, content, *, content_type, content_length):
        captured.update(
            locator=locator,
            payload=content.read(),
            content_type=content_type,
            content_length=content_length,
        )
        return True

    monkeypatch.setattr(user_files_router, "spool_bounded_request", fake_spool)
    monkeypatch.setattr(user_files_router, "write_private_file_stream", fake_put)

    response = await user_files_router.upload_user_file_content(
        "file-1",
        request=object(),  # type: ignore[arg-type]
        session=AsyncSession(),
        user=_user(),
    )

    assert response.status_code == 204
    assert captured == {
        "locator": "user-files/user-1/file-1/original",
        "payload": payload,
        "content_type": "text/plain",
        "content_length": len(payload),
    }


@pytest.mark.asyncio
async def test_finalize_user_file_upload_returns_error_when_object_missing(monkeypatch) -> None:
    repo = _FakeUserFileRepository([_file()])
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)
    monkeypatch.setattr(user_files_router, "private_file_metadata", lambda storage_locator: None)
    monkeypatch.setattr(user_files_router, "is_user_file_storage_locator", lambda storage_locator, user_id: True)

    with pytest.raises(HTTPException) as exc_info:
        await user_files_router.finalize_user_file_upload("file-1", session=AsyncSession(), user=_user())

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Uploaded object not found"
    assert repo.files["file-1"].status == STATUS_PENDING_UPLOAD
    assert uow.commit_calls == 0


@pytest.mark.asyncio
async def test_finalize_user_file_upload_rejects_size_mismatch(monkeypatch) -> None:
    repo = _FakeUserFileRepository([_file(declared_size_bytes=12)])
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)
    monkeypatch.setattr(user_files_router, "private_file_metadata", lambda storage_locator: {"ContentLength": 13})
    monkeypatch.setattr(user_files_router, "is_user_file_storage_locator", lambda storage_locator, user_id: True)

    with pytest.raises(HTTPException) as exc_info:
        await user_files_router.finalize_user_file_upload("file-1", session=AsyncSession(), user=_user())

    assert exc_info.value.status_code == 409
    assert repo.files["file-1"].status == "failed"
    assert repo.files["file-1"].last_error == "Uploaded object size does not match declared size"
    assert uow.commit_calls == 1


@pytest.mark.asyncio
async def test_finalize_user_file_upload_updates_status_and_metadata(monkeypatch) -> None:
    repo = _FakeUserFileRepository([_file(declared_size_bytes=12)])
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)
    monkeypatch.setattr(
        user_files_router,
        "private_file_metadata",
        lambda storage_locator: {"ContentLength": 12, "ContentType": "text/plain; charset=utf-8"},
    )
    monkeypatch.setattr(user_files_router, "is_user_file_storage_locator", lambda storage_locator, user_id: True)

    response = await user_files_router.finalize_user_file_upload("file-1", session=AsyncSession(), user=_user())

    assert response.file_id == "file-1"
    assert response.status == STATUS_UPLOADED
    assert response.stored_size_bytes == 12
    assert response.detected_content_type == "text/plain; charset=utf-8"
    assert repo.files["file-1"].status == STATUS_UPLOADED
    assert uow.commit_calls == 1


@pytest.mark.asyncio
async def test_list_and_get_user_files_only_return_current_users_files(monkeypatch) -> None:
    repo = _FakeUserFileRepository(
        [
            _file("file-old", user_id="user-1", created_at=datetime(2026, 1, 1)),
            _file("file-new", user_id="user-1", created_at=datetime(2026, 1, 2)),
            _file("file-other", user_id="user-2", created_at=datetime(2026, 1, 3)),
            _file("file-deleted", user_id="user-1", status=STATUS_DELETED, created_at=datetime(2026, 1, 4)),
        ]
    )
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)

    listed = await user_files_router.list_user_files(session=AsyncSession(), user=_user("user-1"))

    assert [item.file_id for item in listed.files] == ["file-new", "file-old"]

    found = await user_files_router.get_user_file("file-new", session=AsyncSession(), user=_user("user-1"))
    assert found.file_id == "file-new"

    with pytest.raises(HTTPException) as exc_info:
        await user_files_router.get_user_file("file-other", session=AsyncSession(), user=_user("user-1"))

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_user_file_marks_deleted_when_object_delete_succeeds(monkeypatch) -> None:
    repo = _FakeUserFileRepository([_file(status=STATUS_UPLOADED)])
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)
    monkeypatch.setattr(user_files_router, "delete_private_file", lambda storage_locator: True)

    response = await user_files_router.delete_user_file("file-1", session=AsyncSession(), user=_user())

    assert response.status_code == 204
    assert repo.files["file-1"].status == STATUS_DELETED
    assert repo.files["file-1"].last_error is None
    assert uow.commit_calls == 1


@pytest.mark.asyncio
async def test_delete_user_file_marks_delete_pending_when_object_delete_fails(monkeypatch) -> None:
    repo = _FakeUserFileRepository([_file(status=STATUS_UPLOADED)])
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)
    monkeypatch.setattr(user_files_router, "delete_private_file", lambda storage_locator: False)

    response = await user_files_router.delete_user_file("file-1", session=AsyncSession(), user=_user())

    assert response.status_code == 204
    assert repo.files["file-1"].status == STATUS_DELETE_PENDING
    assert repo.files["file-1"].last_error == "Delete cleanup will retry"
    assert uow.commit_calls == 1


@pytest.mark.asyncio
async def test_abort_user_file_upload_marks_aborted_when_object_delete_succeeds(monkeypatch) -> None:
    repo = _FakeUserFileRepository([_file(status=STATUS_PENDING_UPLOAD)])
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)
    monkeypatch.setattr(user_files_router, "delete_private_file", lambda storage_locator: True)

    response = await user_files_router.abort_user_file_upload("file-1", session=AsyncSession(), user=_user())

    assert response.status_code == 204
    assert repo.files["file-1"].status == STATUS_ABORTED
    assert repo.files["file-1"].last_error is None
    assert uow.commit_calls == 1


@pytest.mark.asyncio
async def test_abort_user_file_upload_conflicts_when_already_uploaded(monkeypatch) -> None:
    repo = _FakeUserFileRepository([_file(status=STATUS_UPLOADED)])
    uow = _FakeUnitOfWork()
    _patch_service(monkeypatch, repo, uow)
    monkeypatch.setattr(
        user_files_router,
        "delete_private_file",
        lambda storage_locator: pytest.fail("uploaded files should not be deleted through abort"),
    )

    with pytest.raises(HTTPException) as exc_info:
        await user_files_router.abort_user_file_upload("file-1", session=AsyncSession(), user=_user())

    assert exc_info.value.status_code == 409
    assert repo.files["file-1"].status == STATUS_UPLOADED
    assert uow.commit_calls == 0
