"""Application service for account-owned user file upload metadata."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any
from uuid import uuid4

from animama.domain.user_file import (
    STATUS_ABORTED,
    STATUS_DELETE_PENDING,
    STATUS_DELETED,
    STATUS_FAILED,
    STATUS_PENDING_UPLOAD,
    STATUS_UPLOADED,
    UserFile,
)
from animama.logging import get_logger

from ..ports.uow_port import UnitOfWork
from ..ports.user_file_port import UserFileRepository

ALLOWED_USER_FILE_EXTENSIONS = frozenset(
    {
        ".txt",
        ".md",
        ".rst",
        ".org",
        ".json",
        ".csv",
        ".tsv",
        ".html",
        ".htm",
        ".xml",
        ".pdf",
        ".docx",
        ".pptx",
        ".xlsx",
    }
)

BLOCKED_USER_FILE_EXTENSIONS = frozenset(
    {
        ".7z",
        ".app",
        ".bat",
        ".bin",
        ".bz2",
        ".cmd",
        ".com",
        ".dmg",
        ".docm",
        ".exe",
        ".gz",
        ".iso",
        ".jar",
        ".js",
        ".msi",
        ".pptm",
        ".ps1",
        ".py",
        ".rar",
        ".scr",
        ".sh",
        ".tar",
        ".vb",
        ".vbs",
        ".xlsm",
        ".zip",
    }
)

DEFAULT_UPLOAD_CONTENT_TYPE = "application/octet-stream"
MAX_ORIGINAL_FILENAME_LENGTH = 255
MAX_DECLARED_CONTENT_TYPE_LENGTH = 255


class UserFileServiceError(Exception):
    """Base error raised by the user-file service."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class UserFileValidationError(UserFileServiceError):
    """Raised when a user-file request fails validation."""


class UserFileNotFoundError(UserFileServiceError):
    """Raised when a user-owned file cannot be found."""


class UserFileConflictError(UserFileServiceError):
    """Raised when a file is in the wrong lifecycle state for an operation."""


class UserFileGoneError(UserFileServiceError):
    """Raised when an upload has expired."""


@dataclass(frozen=True, slots=True)
class ValidatedUserFileUpload:
    """Normalized upload request values used before local byte streaming."""

    original_filename: str
    normalized_extension: str
    declared_content_type: str
    declared_size_bytes: int


def new_user_file_id() -> str:
    """Return an opaque user-file identifier."""

    return f"file-{uuid4().hex}"


def validate_user_file_upload_request(
    *,
    filename: str,
    content_type: str | None,
    size_bytes: int,
    max_upload_bytes: int,
) -> ValidatedUserFileUpload:
    """Validate and normalize client-provided upload initialization metadata."""

    original_filename = _normalize_original_filename(filename)
    normalized_extension = PurePosixPath(original_filename).suffix.lower()
    if normalized_extension in BLOCKED_USER_FILE_EXTENSIONS or normalized_extension not in ALLOWED_USER_FILE_EXTENSIONS:
        raise UserFileValidationError("Unsupported file extension")

    if size_bytes <= 0:
        raise UserFileValidationError("File size must be positive")
    if size_bytes > max_upload_bytes:
        raise UserFileValidationError(f"File upload exceeds the {max_upload_bytes} byte limit")

    declared_content_type = (content_type or "").strip() or DEFAULT_UPLOAD_CONTENT_TYPE
    if len(declared_content_type) > MAX_DECLARED_CONTENT_TYPE_LENGTH or any(
        char in {"\r", "\n"} for char in declared_content_type
    ):
        raise UserFileValidationError("Invalid content type")

    return ValidatedUserFileUpload(
        original_filename=original_filename,
        normalized_extension=normalized_extension,
        declared_content_type=declared_content_type,
        declared_size_bytes=size_bytes,
    )


def _normalize_original_filename(filename: str) -> str:
    normalized = (filename or "").strip().replace("\\", "/")
    if not normalized:
        raise UserFileValidationError("Filename is required")

    original_filename = PurePosixPath(normalized).name.strip()
    if original_filename in {"", ".", ".."}:
        raise UserFileValidationError("Filename is required")
    if len(original_filename) > MAX_ORIGINAL_FILENAME_LENGTH:
        raise UserFileValidationError(f"Filename must be {MAX_ORIGINAL_FILENAME_LENGTH} characters or fewer")
    if any(ord(char) < 32 or ord(char) == 127 for char in original_filename):
        raise UserFileValidationError("Filename contains unsupported characters")
    return original_filename


def _metadata_content_length(object_metadata: dict[str, Any]) -> int | None:
    raw_value = object_metadata.get("ContentLength")
    if isinstance(raw_value, int) and not isinstance(raw_value, bool):
        return raw_value
    return None


def _metadata_content_type(object_metadata: dict[str, Any]) -> str | None:
    raw_value = object_metadata.get("ContentType")
    if isinstance(raw_value, str):
        stripped = raw_value.strip()
        return stripped or None
    return None


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class UserFileService:
    """Coordinate user-file upload lifecycle state over a repository port."""

    def __init__(self, *, user_files: UserFileRepository, uow: UnitOfWork) -> None:
        self._user_files = user_files
        self._uow = uow
        self._log = get_logger("app.services.user_file")

    async def create_pending_upload(
        self,
        *,
        file_id: str,
        user_id: str,
        storage_locator: str,
        validated: ValidatedUserFileUpload,
        upload_expires_at: datetime,
    ) -> UserFile:
        self._log.info("UserFileService.create_pending_upload", file_id=file_id, user_id=user_id)
        user_file = UserFile(
            id=file_id,
            user_id=user_id,
            storage_locator=storage_locator,
            original_filename=validated.original_filename,
            normalized_extension=validated.normalized_extension,
            declared_content_type=validated.declared_content_type,
            declared_size_bytes=validated.declared_size_bytes,
            status=STATUS_PENDING_UPLOAD,
            upload_expires_at=upload_expires_at,
            metadata={},
        )
        created = await self._user_files.create_user_file(user_file)
        await self._uow.commit()
        return created

    async def list_user_files(self, *, user_id: str) -> list[UserFile]:
        self._log.info("UserFileService.list_user_files", user_id=user_id)
        return await self._user_files.list_user_files(user_id=user_id)

    async def get_user_file(self, *, user_id: str, file_id: str) -> UserFile:
        self._log.info("UserFileService.get_user_file", file_id=file_id, user_id=user_id)
        user_file = await self._user_files.get_user_file(user_id=user_id, file_id=file_id)
        if user_file is None:
            raise UserFileNotFoundError("File not found")
        return user_file

    async def get_file_for_delete(self, *, user_id: str, file_id: str) -> UserFile:
        self._log.info("UserFileService.get_file_for_delete", file_id=file_id, user_id=user_id)
        user_file = await self._user_files.get_user_file_for_update(user_id=user_id, file_id=file_id)
        if user_file is None:
            raise UserFileNotFoundError("File not found")
        return user_file

    async def get_file_for_abort(self, *, user_id: str, file_id: str) -> UserFile:
        self._log.info("UserFileService.get_file_for_abort", file_id=file_id, user_id=user_id)
        user_file = await self._user_files.get_user_file_for_update(
            user_id=user_id,
            file_id=file_id,
            include_deleted=True,
        )
        if user_file is None or user_file.status == STATUS_DELETED:
            raise UserFileNotFoundError("File upload not found")
        if user_file.status == STATUS_UPLOADED:
            raise UserFileConflictError("File upload already finalized")
        return user_file

    async def finalize_upload(
        self,
        *,
        user_id: str,
        file_id: str,
        object_metadata: dict[str, Any] | None,
        object_key_is_valid: bool,
        max_upload_bytes: int,
        now: datetime | None = None,
    ) -> UserFile:
        self._log.info("UserFileService.finalize_upload", file_id=file_id, user_id=user_id)
        user_file = await self._user_files.get_user_file_for_update(user_id=user_id, file_id=file_id)
        if user_file is None:
            raise UserFileNotFoundError("File upload not found")
        if user_file.status != STATUS_PENDING_UPLOAD:
            raise UserFileConflictError("File upload is not pending")

        if user_file.upload_expires_at is None:
            await self._mark_failed(user_file, "Upload expiration is missing")
            raise UserFileConflictError("File upload is invalid")

        resolved_now = _as_aware_utc(now or _utcnow())
        if _as_aware_utc(user_file.upload_expires_at) <= resolved_now:
            await self._mark_failed(user_file, "Upload expired")
            raise UserFileGoneError("File upload expired")

        if not object_key_is_valid:
            await self._mark_failed(user_file, "Invalid object key")
            raise UserFileValidationError("Invalid file upload")

        if object_metadata is None:
            raise UserFileConflictError("Uploaded object not found")

        content_length = _metadata_content_length(object_metadata)
        if content_length is None:
            await self._mark_failed(user_file, "Uploaded object size is unavailable")
            raise UserFileConflictError("Uploaded object size is unavailable")
        if content_length <= 0:
            await self._mark_failed(user_file, "Uploaded object is empty")
            raise UserFileValidationError("Uploaded file is empty")
        if content_length > max_upload_bytes:
            await self._mark_failed(user_file, f"Uploaded object exceeds the {max_upload_bytes} byte limit")
            raise UserFileValidationError(f"Uploaded file exceeds the {max_upload_bytes} byte limit")
        if content_length != user_file.declared_size_bytes:
            await self._mark_failed(user_file, "Uploaded object size does not match declared size")
            raise UserFileConflictError("Uploaded object size does not match declared size")

        user_file.status = STATUS_UPLOADED
        user_file.stored_size_bytes = content_length
        user_file.detected_content_type = _metadata_content_type(object_metadata) or user_file.declared_content_type
        user_file.last_error = None
        updated = await self._user_files.update_user_file(user_file)
        await self._uow.commit()
        return updated

    async def mark_file_delete_result(
        self,
        *,
        user_id: str,
        file_id: str,
        object_deleted: bool,
        delete_error: str = "Delete cleanup will retry",
    ) -> UserFile:
        self._log.info(
            "UserFileService.mark_file_delete_result",
            file_id=file_id,
            user_id=user_id,
            object_deleted=object_deleted,
        )
        user_file = await self._user_files.get_user_file_for_update(
            user_id=user_id,
            file_id=file_id,
            include_deleted=True,
        )
        if user_file is None:
            raise UserFileNotFoundError("File not found")

        user_file.status = STATUS_DELETED if object_deleted else STATUS_DELETE_PENDING
        user_file.last_error = None if object_deleted else delete_error
        updated = await self._user_files.update_user_file(user_file)
        await self._uow.commit()
        return updated

    async def mark_upload_abort_result(
        self,
        *,
        user_id: str,
        file_id: str,
        object_deleted: bool,
        delete_error: str = "Abort cleanup will retry",
    ) -> UserFile:
        self._log.info(
            "UserFileService.mark_upload_abort_result",
            file_id=file_id,
            user_id=user_id,
            object_deleted=object_deleted,
        )
        user_file = await self._user_files.get_user_file_for_update(
            user_id=user_id,
            file_id=file_id,
            include_deleted=True,
        )
        if user_file is None or user_file.status == STATUS_DELETED:
            raise UserFileNotFoundError("File upload not found")
        if user_file.status == STATUS_UPLOADED:
            raise UserFileConflictError("File upload already finalized")
        if user_file.status in {STATUS_ABORTED, STATUS_DELETE_PENDING}:
            return user_file

        user_file.status = STATUS_ABORTED if object_deleted else STATUS_DELETE_PENDING
        user_file.last_error = None if object_deleted else delete_error
        updated = await self._user_files.update_user_file(user_file)
        await self._uow.commit()
        return updated

    async def _mark_failed(self, user_file: UserFile, last_error: str) -> UserFile:
        user_file.status = STATUS_FAILED
        user_file.last_error = last_error
        updated = await self._user_files.update_user_file(user_file)
        await self._uow.commit()
        return updated


__all__ = [
    "ALLOWED_USER_FILE_EXTENSIONS",
    "BLOCKED_USER_FILE_EXTENSIONS",
    "DEFAULT_UPLOAD_CONTENT_TYPE",
    "MAX_DECLARED_CONTENT_TYPE_LENGTH",
    "MAX_ORIGINAL_FILENAME_LENGTH",
    "UserFileConflictError",
    "UserFileGoneError",
    "UserFileNotFoundError",
    "UserFileService",
    "UserFileServiceError",
    "UserFileValidationError",
    "ValidatedUserFileUpload",
    "new_user_file_id",
    "validate_user_file_upload_request",
]
