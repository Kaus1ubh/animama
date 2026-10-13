"""Stage, publish and abort an owner's Pocket voice catalog uploads.

An upload is recorded first, its bytes are written to the composition's private
storage, and finalize validates them and saves a normal readable Local
``voices/`` content file. Retrying finalize returns the saved file.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import BinaryIO
from uuid import uuid4

from animama.app.ports.content_catalog import ContentCatalog
from animama.app.ports.content_store import ContentStore
from animama.app.ports.private_file_storage import PrivateFileStorage
from animama.app.ports.uow_port import UnitOfWork
from animama.app.ports.voice_catalog_upload_port import VoiceCatalogUploadRepository
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import definition_for_kind
from animama.app.services.content_save_service import readable_entry_name
from animama.app.services.pocket_voice_catalog import validate_pocket_voice_catalog_bytes
from animama.domain.content_catalog import ContentConflictError, ContentKind, ContentSource, ContentStatus, SavedContent
from animama.domain.staged_upload import (
    STATUS_ABORTED,
    STATUS_CLEANUP_PENDING,
    STATUS_EXPIRED,
    STATUS_FINALIZED,
    STATUS_PENDING,
    VoiceCatalogUpload,
)


class VoiceCatalogUploadError(Exception):
    """A voice catalog upload request the service refuses; ``detail`` is the public body."""

    def __init__(self, detail: str | dict[str, str]) -> None:
        super().__init__(str(detail))
        self.detail = detail


class VoiceCatalogUploadInvalidError(VoiceCatalogUploadError):
    """The upload request itself is invalid (file type or size)."""


class VoiceCatalogUploadNotFoundError(VoiceCatalogUploadError):
    """No upload with that ID belongs to the caller."""


class VoiceCatalogUploadStateError(VoiceCatalogUploadError):
    """The upload is not in a state that allows the operation."""


class VoiceCatalogUploadExpiredError(VoiceCatalogUploadError):
    """The pending upload passed its expiry."""


class VoiceCatalogBytesInvalidError(VoiceCatalogUploadError):
    """The uploaded bytes are not a valid Pocket voice catalog."""


class VoiceCatalogStorageError(VoiceCatalogUploadError):
    """Private storage could not keep the uploaded bytes."""


class VoiceCatalogSaveConflictError(VoiceCatalogUploadError):
    """The content catalog refused to save the voice catalog file."""


_NOT_FOUND = "Voice catalog upload not found"


class VoiceCatalogUploadService:
    """One owner's voice catalog uploads over a session and the composition's private storage."""

    def __init__(
        self,
        *,
        uploads: VoiceCatalogUploadRepository,
        private_files: PrivateFileStorage,
        uow: UnitOfWork,
        max_upload_bytes: int,
        upload_ttl_seconds: int,
    ) -> None:
        self._uploads = uploads
        self._private_files = private_files
        self._uow = uow
        self._max_upload_bytes = max_upload_bytes
        self._upload_ttl_seconds = upload_ttl_seconds

    async def initiate(
        self, *, user_id: str, filename: str | None, size_bytes: int, content_type: str | None
    ) -> VoiceCatalogUpload:
        """Record a pending ``.bin`` upload whose bytes the owner sends next."""

        filename = (filename or "").strip()
        if not filename or not filename.lower().endswith(".bin"):
            raise VoiceCatalogUploadInvalidError("Only .bin uploads are supported")
        if size_bytes > self._max_upload_bytes:
            raise VoiceCatalogUploadInvalidError(
                f"Pocket voice catalog upload exceeds the {self._max_upload_bytes} byte limit"
            )
        upload = await self._uploads.create_pending(
            user_id=user_id,
            storage_locator=f"staging/voice-catalogs/{user_id}/{uuid4().hex}.bin",
            original_filename=filename,
            declared_content_type=(content_type or "").strip() or "application/octet-stream",
            declared_size_bytes=size_bytes,
            expires_at=datetime.now(UTC) + timedelta(seconds=max(1, self._upload_ttl_seconds)),
        )
        await self._uow.commit()
        return upload

    async def pending_upload(self, *, user_id: str, upload_id: str) -> VoiceCatalogUpload:
        """Return the owner's upload that may still receive its bytes."""

        upload = await self._uploads.get_owned(upload_id=upload_id, user_id=user_id)
        if upload is None:
            raise VoiceCatalogUploadNotFoundError(_NOT_FOUND)
        if upload.status != STATUS_PENDING:
            raise VoiceCatalogUploadStateError("Voice catalog upload is not pending")
        if upload.expires_at <= datetime.now(UTC):
            raise VoiceCatalogUploadExpiredError("Voice catalog upload expired")
        return upload

    def store_bytes(self, upload: VoiceCatalogUpload, content: BinaryIO, *, size_bytes: int) -> None:
        """Keep the uploaded bytes in private storage under the upload's locator."""

        if not self._private_files.put_stream(upload.storage_locator, content, content_length=size_bytes):
            raise VoiceCatalogStorageError({"code": "voice_catalog_local_write_failed"})

    async def finalize(
        self,
        *,
        user_id: str,
        upload_id: str,
        content: ContentCatalogService,
        catalog: ContentCatalog,
        store: ContentStore,
    ) -> SavedContent:
        """Validate the staged bytes and save them as the owner's Local voice catalog.

        A retry after success returns the saved file.
        """

        upload = await self._uploads.get_owned(upload_id=upload_id, user_id=user_id)
        if upload is None:
            raise VoiceCatalogUploadNotFoundError(_NOT_FOUND)
        logical_key = f"local:voice:{upload.id}"
        await content.rescan(user_id=user_id, include_included=False)
        existing = await catalog.get_by_logical_key(source=ContentSource.LOCAL, logical_key=logical_key)
        if existing is not None and existing.status is ContentStatus.VALID:
            return SavedContent(upload.id, existing)
        if upload.status != STATUS_PENDING:
            raise VoiceCatalogUploadStateError("Voice catalog upload is not pending")
        try:
            with self._private_files.open_bounded(
                upload.storage_locator, expected_size_bytes=upload.declared_size_bytes
            ) as staged:
                payload = staged.stream.read()
        except Exception as exc:
            raise VoiceCatalogUploadStateError("Voice catalog bytes are unavailable") from exc
        try:
            parsed = validate_pocket_voice_catalog_bytes(payload)
        except ValueError as exc:
            raise VoiceCatalogBytesInvalidError({"code": "voice_catalog_invalid", "reason": str(exc)}) from exc
        entry_name = readable_entry_name(PurePosixPath(upload.original_filename).stem)
        relative_locator = f"{definition_for_kind(ContentKind.VOICE).directory}/{entry_name}.bin"
        collision = await catalog.get_by_locator(source=ContentSource.LOCAL, relative_locator=relative_locator)
        if collision is not None and collision.logical_key != logical_key:
            relative_locator = f"voices/{entry_name}-{upload.id[-8:]}.bin"
        metadata = json.dumps(
            {
                "schema_version": 1,
                "id": logical_key,
                "display_name": PurePosixPath(upload.original_filename).stem,
                "content_type": "voice",
                "voices": sorted(parsed),
            },
            indent=2,
            sort_keys=True,
        ).encode()
        try:
            store.save_standalone(
                kind=ContentKind.VOICE,
                relative_locator=relative_locator,
                payload=payload,
                metadata_sidecar=metadata,
                operation_id=f"voice:{upload.id}",
            )
            await content.rescan(user_id=user_id, include_included=False)
            saved = await catalog.get_by_logical_key(source=ContentSource.LOCAL, logical_key=logical_key)
            if saved is None or saved.status is not ContentStatus.VALID:
                raise ContentConflictError("saved_voice_catalog_invalid")
            if saved.owner_user_id is None:
                saved = await catalog.assign_creator_owner(item_id=saved.id, user_id=user_id)
        except ContentConflictError as exc:
            raise VoiceCatalogSaveConflictError({"code": exc.code}) from exc
        await self._uploads.set_status(upload_id=upload.id, user_id=user_id, status=STATUS_FINALIZED)
        await self._uow.commit()
        if not self._private_files.delete(upload.storage_locator):
            # The finalized record keeps the locator and this error. The cleanup
            # worker does not select finalized rows, so the bytes stay in staging.
            await self._uploads.set_status(
                upload_id=upload.id, user_id=user_id, status=STATUS_FINALIZED, last_error="cleanup_pending"
            )
            await self._uow.commit()
        return SavedContent(upload.id, saved)

    async def abort(self, *, user_id: str, upload_id: str) -> None:
        """Discard a pending upload and its bytes; aborting twice is a no-op."""

        upload = await self._uploads.get_owned(upload_id=upload_id, user_id=user_id)
        if upload is None:
            raise VoiceCatalogUploadNotFoundError(_NOT_FOUND)
        if upload.status == STATUS_FINALIZED:
            raise VoiceCatalogUploadStateError("Voice catalog upload already finalized")
        if upload.status in {STATUS_ABORTED, STATUS_EXPIRED}:
            return
        deleted = self._private_files.delete(upload.storage_locator)
        await self._uploads.set_status(
            upload_id=upload.id,
            user_id=user_id,
            status=STATUS_ABORTED if deleted else STATUS_CLEANUP_PENDING,
            last_error=None if deleted else "Abort cleanup will retry",
        )
        await self._uow.commit()


__all__ = [
    "VoiceCatalogBytesInvalidError",
    "VoiceCatalogSaveConflictError",
    "VoiceCatalogStorageError",
    "VoiceCatalogUploadError",
    "VoiceCatalogUploadExpiredError",
    "VoiceCatalogUploadInvalidError",
    "VoiceCatalogUploadNotFoundError",
    "VoiceCatalogUploadService",
    "VoiceCatalogUploadStateError",
]
