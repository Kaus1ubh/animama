"""Containment-safe storage for private uploads and generated data."""

from __future__ import annotations

import hashlib
import os
import stat
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from tempfile import SpooledTemporaryFile
from typing import BinaryIO, cast

from animama.server.local_runtime import LocalRuntimePaths
from animama.utils.files import is_directory, is_link, open_no_follow, replace


class PrivateFilePathError(ValueError):
    """An opaque private locator violated the configured storage boundary."""


class PrivateFileNotFoundError(Exception):
    """A registered private file is no longer present."""


class PrivateFileReadError(Exception):
    """A private file could not be read completely."""


class PrivateFileSizeMismatchError(Exception):
    """A private file differs from its trusted database size."""

    def __init__(self, *, expected_size_bytes: int, actual_size_bytes: int) -> None:
        super().__init__(f"Expected {expected_size_bytes} bytes, found {actual_size_bytes}")
        self.expected_size_bytes = expected_size_bytes
        self.actual_size_bytes = actual_size_bytes


@dataclass(slots=True)
class VerifiedPrivateFile:
    """Seekable disk-spooled private bytes and their computed digest."""

    stream: BinaryIO
    size_bytes: int
    sha256: str


class FilesystemPrivateFileStorage:
    """Resolve opaque locators into allowlisted private-data roots only."""

    def __init__(self, paths: LocalRuntimePaths) -> None:
        self._paths = paths
        self._areas = {
            "user-files": paths.user_files_root.resolve(strict=False),
            "derivatives": paths.derivatives_root.resolve(strict=False),
            "staging": paths.uploads_staging_root.resolve(strict=False),
            "reconciliation": paths.reconciliation_root.resolve(strict=False),
        }

    @staticmethod
    def _relative(value: str) -> PurePosixPath:
        if not value or "\\" in value or "\x00" in value:
            raise PrivateFilePathError("Private locator is not portable")
        relative = PurePosixPath(value.strip("/"))
        if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
            raise PrivateFilePathError("Private locator contains traversal")
        return relative

    def _path(self, locator: str, *, create_parents: bool = False) -> Path:
        relative = self._relative(locator)
        area = relative.parts[0]
        root = self._areas.get(area)
        if root is None:
            # Persisted creator locators may use the opaque object-key shape.
            # Pending uploads stay in staging; verified
            # compatibility blobs live in rebuildable internal state. Neither
            # location is portable content or exposed as a host path.
            is_pending_creator_upload = "staged" in relative.parts
            root = self._areas["staging" if is_pending_creator_upload else "reconciliation"]
            relative = PurePosixPath("legacy-objects", *relative.parts)
        else:
            relative = PurePosixPath(*relative.parts[1:])
        if not relative.parts:
            raise PrivateFilePathError("Private locator must identify a file")
        destination = root.joinpath(*relative.parts)
        if not destination.resolve(strict=False).is_relative_to(root):
            raise PrivateFilePathError("Private locator escaped its root")
        cursor = root
        for part in relative.parts[:-1]:
            cursor /= part
            try:
                metadata = cursor.lstat()
            except FileNotFoundError:
                if not create_parents:
                    continue
                cursor.mkdir()
                metadata = cursor.lstat()
            if not is_directory(metadata):
                raise PrivateFilePathError("Private locator contains an unsafe directory")
        return destination

    @staticmethod
    def _regular(path: Path) -> os.stat_result:
        try:
            metadata = path.lstat()
        except FileNotFoundError as exc:
            raise PrivateFileNotFoundError from exc
        except OSError as exc:
            raise PrivateFileReadError from exc
        if is_link(metadata) or not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise PrivateFileReadError("Private file is not an ordinary single-link file")
        return metadata

    def put_stream(
        self,
        locator: str,
        content: BinaryIO,
        *,
        content_length: int,
    ) -> bool:
        if content_length < 1:
            return False
        temporary: Path | None = None
        try:
            destination = self._path(locator, create_parents=True)
            temporary = self._paths.uploads_staging_root / f".upload-{uuid.uuid4().hex}.tmp"
            written = 0
            content.seek(0)
            with temporary.open("xb") as handle:
                while chunk := content.read(1024 * 1024):
                    written += len(chunk)
                    if written > content_length:
                        raise PrivateFileSizeMismatchError(
                            expected_size_bytes=content_length,
                            actual_size_bytes=written,
                        )
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            if written != content_length:
                raise PrivateFileSizeMismatchError(
                    expected_size_bytes=content_length,
                    actual_size_bytes=written,
                )
            replace(temporary, destination)
            return True
        except Exception:
            try:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            except OSError:
                pass
            return False

    @contextmanager
    def open_bounded(
        self,
        locator: str,
        *,
        expected_size_bytes: int,
    ) -> Iterator[VerifiedPrivateFile]:
        path = self._path(locator)
        metadata = self._regular(path)
        if metadata.st_size != expected_size_bytes:
            raise PrivateFileSizeMismatchError(
                expected_size_bytes=expected_size_bytes,
                actual_size_bytes=metadata.st_size,
            )
        spool = SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
        digest = hashlib.sha256()
        actual = 0
        try:
            descriptor = open_no_follow(path, os.O_RDONLY)
            with os.fdopen(descriptor, "rb") as source:
                while chunk := source.read(1024 * 1024):
                    actual += len(chunk)
                    if actual > expected_size_bytes:
                        raise PrivateFileSizeMismatchError(
                            expected_size_bytes=expected_size_bytes,
                            actual_size_bytes=actual,
                        )
                    digest.update(chunk)
                    spool.write(chunk)
            if actual != expected_size_bytes:
                raise PrivateFileSizeMismatchError(
                    expected_size_bytes=expected_size_bytes,
                    actual_size_bytes=actual,
                )
            spool.seek(0)
            # Binary-mode spools implement the BinaryIO interface; typeshed models
            # the spool separately from IO despite that runtime contract.
            yield VerifiedPrivateFile(cast(BinaryIO, spool), actual, digest.hexdigest())
        except OSError as exc:
            raise PrivateFileReadError("Private file changed or became unreadable") from exc
        finally:
            spool.close()

    def head(self, locator: str) -> dict[str, object] | None:
        try:
            metadata = self._regular(self._path(locator))
        except PrivateFileNotFoundError:
            return None
        except OSError as exc:
            raise PrivateFileReadError("Private file changed or became unreadable") from exc
        return {"ContentLength": metadata.st_size}

    def read(self, locator: str, *, max_bytes: int | None = None) -> bytes | None:
        try:
            path = self._path(locator)
            metadata = self._regular(path)
            if max_bytes is not None and metadata.st_size > max_bytes:
                raise PrivateFileReadError("Private file exceeds its read bound")
            descriptor = open_no_follow(path, os.O_RDONLY)
            with os.fdopen(descriptor, "rb") as handle:
                payload = handle.read((max_bytes + 1) if max_bytes is not None else -1)
            if max_bytes is not None and len(payload) > max_bytes:
                raise PrivateFileReadError("Private file exceeds its read bound")
            return payload
        except PrivateFileNotFoundError:
            return None

    def delete(self, locator: str) -> bool:
        try:
            path = self._path(locator)
            self._regular(path)
            path.unlink()
            # Remove only empty parents inside the resolved area.
            for parent in path.parents:
                if parent in self._areas.values() or parent == self._paths.uploads_staging_root:
                    break
                try:
                    parent.rmdir()
                except OSError:
                    break
            return True
        except PrivateFileNotFoundError:
            return True
        except (OSError, PrivateFilePathError, PrivateFileReadError):
            return False


__all__ = [
    "FilesystemPrivateFileStorage",
    "PrivateFileNotFoundError",
    "PrivateFilePathError",
    "PrivateFileReadError",
    "PrivateFileSizeMismatchError",
    "VerifiedPrivateFile",
]
