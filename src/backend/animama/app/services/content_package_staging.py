"""Private, restart-safe package byte staging; this module never installs content.

Locks live outside disposable stage directories. The owner lock serializes quota
changes across both roots; stage locks remain held by callers across async work.
All lock attempts are nonblocking so request handlers never wait on the event loop.
"""

from __future__ import annotations

import errno
import hashlib
import os
import re
import shutil
import sys
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, BinaryIO

# Reexports preserve existing local staging callers.
from animama.app.contracts.content_package_staging import (
    PartAck as PartAck,
    PartReceipt as PartReceipt,
    StageKind as StageKind,
    StageLimits as StageLimits,
    StageRecord as StageRecord,
    StageState as StageState,
)
from animama.domain.content_catalog import ContentConflictError
from animama.utils.files import path_is_link, replace, sync_directory

_ID = re.compile(r"^[0-9a-f]{32}$")
_OWNER = re.compile(r"^[0-9a-f]{64}$")
_TEMP_RECORD = re.compile(r"^\.record-[0-9a-f]{32}\.tmp$")
_RECORD_LIMIT = 16 * 1024 * 1024
_PROTECTED = {"committing", "recovery_needed"}


def _write_record(path: Path, record: StageRecord) -> None:
    payload = record.model_dump_json().encode()
    if len(payload) > _RECORD_LIMIT:
        raise ContentConflictError("package_stage_metadata_too_large")
    temporary = path.parent / f".record-{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("xb") as handle:
            os.chmod(temporary, 0o600)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


class _Lock:
    """Advisory lock whose lifetime is the file handle, including process death."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            if sys.platform == "win32":
                import msvcrt

                if os.fstat(self._fd).st_size == 0:
                    os.write(self._fd, b"\0")
                os.lseek(self._fd, 0, os.SEEK_SET)
                msvcrt.locking(self._fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(self._fd)
            self._fd = -1
            if exc.errno in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                raise ContentConflictError("package_stage_active") from exc
            raise

    def close(self) -> None:
        if self._fd >= 0:
            os.close(self._fd)
            self._fd = -1

    def __enter__(self) -> _Lock:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


class PackageStageService:
    """Coordinate private imports and exports without SQL or an installation journal."""

    def __init__(
        self,
        imports_root: Path,
        exports_root: Path,
        *,
        limits: StageLimits | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._roots: dict[StageKind, Path] = {"import": imports_root, "export": exports_root}
        self.limits, self._clock = limits or StageLimits(), clock
        self._locks = imports_root / ".locks"
        for root in self._roots.values():
            root.mkdir(parents=True, exist_ok=True, mode=0o700)

    @staticmethod
    def _owner(user_id: str) -> str:
        return hashlib.sha256(user_id.encode()).hexdigest()

    def _directory(self, user_id: str, stage_id: str, kind: StageKind) -> Path:
        if not _ID.fullmatch(stage_id):
            raise ContentConflictError("package_stage_unavailable")
        return self._roots[kind] / self._owner(user_id) / stage_id

    def _owner_lock(self, owner: str) -> _Lock:
        return _Lock(self._locks / owner / "owner.lock")

    def _stage_lock(self, owner: str, stage_id: str, kind: StageKind) -> _Lock:
        return _Lock(self._locks / owner / f"{kind}-{stage_id}.lock")

    @staticmethod
    def _read(directory: Path) -> StageRecord:
        try:
            if path_is_link(directory):
                raise ValueError("symlink stage")
            with (directory / "record.json").open("rb") as handle:
                payload = handle.read(_RECORD_LIMIT + 1)
            if len(payload) > _RECORD_LIMIT:
                raise ValueError("oversized record")
            return StageRecord.model_validate_json(payload)
        except (OSError, ValueError) as exc:
            raise ContentConflictError("package_stage_unavailable") from exc

    def _records(self, owner: str) -> list[tuple[Path, StageRecord]]:
        records = []
        for kind, root in self._roots.items():
            directory = root / owner
            if directory.exists():
                for child in directory.iterdir():
                    if _ID.fullmatch(child.name) and child.is_dir():
                        if not path_is_link(child) and not (child / "record.json").exists():
                            # Allocation publishes its record before accepting any
                            # payload. Only this empty/temp-only interrupted state
                            # can be reclaimed without a durable reservation.
                            leftovers = tuple(child.iterdir())
                            if all(_TEMP_RECORD.fullmatch(item.name) and item.is_file() for item in leftovers):
                                with self._stage_lock(owner, child.name, kind):
                                    shutil.rmtree(child)
                                    sync_directory(child.parent)
                                continue
                        records.append((child, self._read(child)))
        return records

    def _check_disk(self, directory: Path, required: int) -> None:
        if shutil.disk_usage(directory).free < required:
            raise ContentConflictError("package_stage_disk_full")

    def _admit(self, records: list[tuple[Path, StageRecord]], reserved: int) -> None:
        """Check aggregate reservation before any archive bytes are written."""
        if len(records) >= self.limits.max_stages:
            raise ContentConflictError("package_stage_limit")
        if sum(record.reserved_bytes for _, record in records) + reserved > self.limits.max_total_bytes:
            raise ContentConflictError("package_stage_quota")

    def create_import(self, user_id: str, operation_id: str, filename: str, expected_bytes: int) -> StageRecord:
        record, _ = self._create(user_id, "import", filename, expected_bytes, operation_id)
        return record

    def create_export(self, user_id: str, filename: str, expected_bytes: int) -> StageRecord:
        record, _ = self._create(user_id, "export", filename, expected_bytes, None)
        return record

    def reserve_export(self, user_id: str, filename: str, expected_bytes: int) -> StageLease:
        """Allocate and lock together so acquisition cannot abandon a new export."""
        record, lock = self._create(user_id, "export", filename, expected_bytes, None, leased=True)
        assert lock is not None
        return StageLease(self, self._directory(user_id, record.stage_id, "export"), record, lock)

    def _create(
        self,
        user_id: str,
        kind: StageKind,
        filename: str,
        expected_bytes: int,
        operation_id: str | None,
        *,
        leased: bool = False,
    ) -> tuple[StageRecord, _Lock | None]:
        if not 0 < expected_bytes <= self.limits.max_archive_bytes:
            raise ContentConflictError("package_size_invalid")
        if (
            not filename.lower().endswith(".zip")
            or len(filename) > 255
            or (operation_id is not None and not 0 < len(operation_id) <= 256)
        ):
            raise ContentConflictError("package_stage_input_invalid")
        owner = self._owner(user_id)
        with self._owner_lock(owner):
            self._sweep_owner(owner)
            records = self._records(owner)
            if operation_id is not None:
                for _, old in records:
                    if old.kind == "import" and old.operation_id == operation_id:
                        if old.filename != filename or old.expected_bytes != expected_bytes:
                            raise ContentConflictError("package_operation_conflict")
                        return old, None
            try:
                self._admit(records, expected_bytes)
            except ContentConflictError as exc:
                if exc.code not in {"package_stage_limit", "package_stage_quota"}:
                    raise
                # A browser cannot confirm a completed save. Reuse quota from
                # finished download attempts only when another operation needs it;
                # the stage lock still protects active responses and retries.
                self._sweep_owner(owner, reclaim_downloads=True)
                self._admit(self._records(owner), expected_bytes)
            self._check_disk(self._roots[kind], expected_bytes)
            now = self._clock()
            record = StageRecord(
                stage_id=uuid.uuid4().hex,
                user_id=user_id,
                kind=kind,
                state="uploading" if kind == "import" else "preparing",
                operation_id=operation_id,
                filename=filename,
                expected_bytes=expected_bytes,
                reserved_bytes=expected_bytes,
                created_at=now,
                expires_at=now + timedelta(seconds=self.limits.ttl_seconds),
            )
            directory = self._directory(user_id, record.stage_id, kind)
            directory.mkdir(parents=True, mode=0o700)
            try:
                _write_record(directory / "record.json", record)
                sync_directory(directory.parent)
                lock = self._stage_lock(owner, record.stage_id, kind) if leased else None
            except BaseException:
                shutil.rmtree(directory)
                raise
            return record, lock

    def acquire(
        self, user_id: str, stage_id: str, kind: StageKind = "import", *, allow_expired: bool = False
    ) -> StageLease:
        directory = self._directory(user_id, stage_id, kind)
        with self._owner_lock(self._owner(user_id)):
            self._sweep_owner(self._owner(user_id), exclude=stage_id)
            lock = self._stage_lock(self._owner(user_id), stage_id, kind)
            try:
                record = self._read(directory)
                if record.user_id != user_id or record.kind != kind or record.stage_id != stage_id:
                    raise ContentConflictError("package_stage_unavailable")
                if record.expires_at <= self._clock() and not allow_expired:
                    raise ContentConflictError("package_stage_expired")
                return StageLease(self, directory, record, lock)
            except BaseException:
                lock.close()
                raise

    def status(self, user_id: str, stage_id: str, kind: StageKind = "import") -> tuple[StageRecord, bool]:
        directory = self._directory(user_id, stage_id, kind)
        record = self._read(directory)
        if record.user_id != user_id or record.kind != kind or record.stage_id != stage_id:
            raise ContentConflictError("package_stage_unavailable")
        try:
            with self._stage_lock(self._owner(user_id), stage_id, kind):
                return self._read(directory), False
        except ContentConflictError as exc:
            if exc.code != "package_stage_active":
                raise
            return record, True

    def find_import(self, user_id: str, operation_id: str) -> StageRecord | None:
        with self._owner_lock(self._owner(user_id)):
            return next(
                (record for _, record in self._records(self._owner(user_id)) if record.operation_id == operation_id),
                None,
            )

    def append_part(self, user_id: str, stage_id: str, index: int, source: BinaryIO) -> PartAck:
        with self.acquire(user_id, stage_id) as lease:
            return lease.append_part(index, source)

    def discard(self, user_id: str, stage_id: str, kind: StageKind = "import") -> None:
        with self.acquire(user_id, stage_id, kind, allow_expired=True) as lease:
            lease.discard()

    def _sweep_owner(self, owner: str, *, exclude: str | None = None, reclaim_downloads: bool = False) -> None:
        def eligible(record: StageRecord) -> bool:
            expired = record.expires_at <= self._clock()
            finished_download = reclaim_downloads and record.kind == "export" and record.state == "completed"
            return record.state not in _PROTECTED and (expired or finished_download)

        for directory, record in self._records(owner):
            if record.stage_id == exclude or not eligible(record):
                continue
            try:
                with self._stage_lock(owner, record.stage_id, record.kind):
                    # A finishing worker may have renewed or protected the stage
                    # after our quota snapshot but before releasing this lock.
                    current = self._read(directory)
                    if eligible(current):
                        shutil.rmtree(directory)
                        sync_directory(directory.parent)
            except ContentConflictError as exc:
                if exc.code != "package_stage_active":
                    raise

    def sweep_expired(self, user_id: str | None = None) -> None:
        owners = (
            {self._owner(user_id)}
            if user_id is not None
            else {
                child.name for root in self._roots.values() for child in root.iterdir() if _OWNER.fullmatch(child.name)
            }
        )
        for owner in owners:
            try:
                with self._owner_lock(owner):
                    self._sweep_owner(owner)
            except ContentConflictError as exc:
                if exc.code != "package_stage_active":
                    raise


class StageLease:
    """Exclusive stage ownership. Closing releases the lock, never implicit cancellation."""

    def __init__(self, service: PackageStageService, directory: Path, record: StageRecord, lock: _Lock) -> None:
        self._service, self.directory, self._record, self._lock = service, directory, record, lock
        self.archive_path = directory / "package.zip"
        self.inspection_path = directory / "inspection"
        self._expanding = False

    @property
    def record(self) -> StageRecord:
        return self._record.model_copy(deep=True)

    def __enter__(self) -> StageLease:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self._lock.close()

    def open_archive(self) -> BinaryIO:
        """Open leased bytes; the caller closes its handle before this lease."""
        self._assert_open()
        return self.archive_path.open("rb")

    @contextmanager
    def write_archive(self) -> Iterator[BinaryIO]:
        """Publish archive bytes durably before the caller seals a review."""
        self._assert_open()
        with self.archive_path.open("xb") as handle:
            os.chmod(self.archive_path, 0o600)
            yield handle
            handle.flush()
            os.fsync(handle.fileno())

    def _update(self, **changes: Any) -> StageRecord:
        if self._lock._fd < 0:
            raise RuntimeError("stage lease is closed")
        record = StageRecord.model_validate(self._record.model_dump() | changes)
        _write_record(self.directory / "record.json", record)
        self._record = record.model_copy(deep=True)
        return self.record

    def discard(self) -> None:
        self._assert_open()
        if self._record.state in _PROTECTED:
            raise ContentConflictError("package_stage_active")
        shutil.rmtree(self.directory)
        sync_directory(self.directory.parent)

    def set_state(self, state: StageState) -> StageRecord:
        return self._update(state=state)

    def _assert_open(self) -> None:
        if self._lock._fd < 0:
            raise RuntimeError("stage lease is closed")

    def _refresh(self) -> datetime:
        return self._service._clock() + timedelta(seconds=self._service.limits.ttl_seconds)

    def append_part(self, index: int, source: BinaryIO) -> PartAck:
        """Append one bounded part; persist the fsynced offset before acknowledging it."""
        self._assert_open()
        record = self._record
        if record.kind != "import" or record.state not in {"uploading", "uploaded"}:
            raise ContentConflictError("package_stage_not_uploading")
        if index < 0 or index > len(record.parts):
            raise ContentConflictError("package_part_out_of_order")
        retry = record.parts[index] if index < len(record.parts) else None
        expected = (
            retry.size_bytes
            if retry
            else min(self._service.limits.part_bytes, record.expected_bytes - record.received_bytes)
        )
        if expected <= 0:
            raise ContentConflictError("package_part_out_of_order")
        digest, size = hashlib.sha256(), 0
        self._service._check_disk(self.directory, 0 if retry else expected)
        # A process may die after archive fsync and before the acknowledged record
        # replace. Its unacknowledged tail is never treated as uploaded content.
        mode = "r+b" if self.archive_path.exists() else "w+b"
        with self.archive_path.open(mode) as archive:
            os.chmod(self.archive_path, 0o600)
            archive.seek(0, os.SEEK_END)
            if archive.tell() < record.received_bytes:
                raise ContentConflictError("package_archive_changed")
            archive.truncate(record.received_bytes)
            archive.seek(record.received_bytes)
            try:
                while chunk := source.read(min(1024 * 1024, expected - size + 1)):
                    size += len(chunk)
                    if size > expected:
                        raise ContentConflictError("package_part_size_invalid")
                    digest.update(chunk)
                    if retry is None:
                        archive.write(chunk)
                if size != expected:
                    raise ContentConflictError("package_part_size_invalid")
                sha256 = digest.hexdigest()
                if retry is not None:
                    if sha256 != retry.sha256:
                        raise ContentConflictError("package_part_changed")
                    self._update(expires_at=self._refresh())
                else:
                    archive.flush()
                    os.fsync(archive.fileno())
                    received = record.received_bytes + size
                    receipt = PartReceipt(index=index, offset=record.received_bytes, size_bytes=size, sha256=sha256)
                    self._update(
                        parts=(*record.parts, receipt),
                        received_bytes=received,
                        actual_bytes=received,
                        state="uploaded" if received == record.expected_bytes else "uploading",
                        expires_at=self._refresh(),
                    )
            except BaseException:
                # If replace succeeded but directory fsync failed, retain the
                # published offset. A retry can safely resolve the unknown reply.
                durable = self._service._read(self.directory)
                archive.truncate(durable.received_bytes)
                archive.flush()
                os.fsync(archive.fileno())
                self._record = durable
                raise
        return PartAck(
            stage_id=record.stage_id,
            index=index,
            size_bytes=size,
            sha256=sha256,
            received_bytes=self._record.received_bytes,
            next_part_index=len(self._record.parts),
            complete=self._record.received_bytes == record.expected_bytes,
        )

    def _hash_archive(self) -> tuple[int, str]:
        self._assert_open()
        digest, size = hashlib.sha256(), 0
        try:
            with self.archive_path.open("rb") as archive:
                while chunk := archive.read(1024 * 1024):
                    size += len(chunk)
                    if size > self._service.limits.max_archive_bytes:
                        raise ContentConflictError("package_size_invalid")
                    digest.update(chunk)
        except OSError as exc:
            raise ContentConflictError("package_archive_changed") from exc
        return size, digest.hexdigest()

    def seal_archive(self) -> tuple[int, str]:
        self._assert_open()
        if self._record.archive_sha256 is not None:
            return self.verify_archive()
        if self._record.kind == "import" and self.archive_path.exists():
            with self.archive_path.open("r+b") as archive:
                archive.seek(0, os.SEEK_END)
                if archive.tell() > self._record.received_bytes:
                    archive.truncate(self._record.received_bytes)
                    archive.flush()
                    os.fsync(archive.fileno())
        size, digest = self._hash_archive()
        if self._record.kind == "import" and (
            self._record.received_bytes != self._record.expected_bytes or size != self._record.expected_bytes
        ):
            raise ContentConflictError("package_upload_incomplete")
        if size <= 0:
            raise ContentConflictError("package_upload_incomplete")
        self.ensure_capacity(size)
        self._update(actual_bytes=size, archive_sha256=digest)
        return size, digest

    def verify_archive(self) -> tuple[int, str]:
        size, digest = self._hash_archive()
        if self._record.archive_sha256 != digest or self._record.actual_bytes != size:
            raise ContentConflictError("package_archive_changed")
        return size, digest

    def publish_review(self, review: dict[str, Any], review_digest: str) -> StageRecord:
        if self._record.archive_sha256 is None:
            raise ContentConflictError("package_upload_incomplete")
        if self._record.review is not None:
            if self._record.review != review or self._record.review_digest != review_digest:
                raise ContentConflictError("package_review_changed")
            return self.record
        return self._update(review=review, review_digest=review_digest, state="reviewed", expires_at=self._refresh())

    def renew_review(self, review_digest: str) -> StageRecord:
        if self._record.state != "reviewed" or self._record.review_digest != review_digest:
            raise ContentConflictError("package_review_changed")
        return self._update(expires_at=self._refresh())

    def ensure_capacity(self, size: int) -> None:
        """Reserve archive growth before its bytes reach the filesystem."""
        self._assert_open()
        if size > self._service.limits.max_archive_bytes or size < 0:
            raise ContentConflictError("package_size_invalid")
        if size <= self._record.reserved_bytes:
            return
        service = self._service
        with service._owner_lock(service._owner(self._record.user_id)):
            others = sum(
                record.reserved_bytes
                for _, record in service._records(service._owner(self._record.user_id))
                if record.stage_id != self._record.stage_id
            )
            if others + size > service.limits.max_total_bytes:
                raise ContentConflictError("package_stage_quota")
            service._check_disk(self.directory, size - self._record.reserved_bytes)
            self._update(reserved_bytes=size)

    @contextmanager
    def expansion(self) -> Iterator[Path]:
        """Own one disposable expansion; the archive inspector enforces its byte cap."""
        from animama.app.services.content_package_archive import ContentPackageArchive

        self._assert_open()
        if self._expanding:
            raise ContentConflictError("package_stage_active")
        if self.inspection_path.exists():
            shutil.rmtree(self.inspection_path)
        required = ContentPackageArchive.expanded_size(self.archive_path)
        if required > self._service.limits.max_expanded_bytes:
            raise ContentConflictError("package_expanded_size_invalid")
        self._service._check_disk(self.directory, required)
        self._expanding = True
        try:
            yield self.inspection_path
        finally:
            try:
                if self.inspection_path.exists():
                    shutil.rmtree(self.inspection_path)
            finally:
                self._expanding = False
