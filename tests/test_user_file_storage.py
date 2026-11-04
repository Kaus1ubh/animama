from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path

import pytest

from animama.adapters.content_store.private_file_store import (
    FilesystemPrivateFileStorage,
    PrivateFilePathError,
    PrivateFileSizeMismatchError,
)
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime


def _storage(tmp_path: Path):
    paths = initialize_local_runtime(
        Settings(
            animama_content_root=tmp_path / "content",
            animama_data_root=tmp_path / "data",
        )
    )
    return FilesystemPrivateFileStorage(paths), paths


def test_private_user_file_write_read_and_delete_stay_outside_content(tmp_path: Path) -> None:
    storage, paths = _storage(tmp_path)
    payload = b"private chat attachment"
    locator = "user-files/user-1/file-1/original"

    assert storage.put_stream(locator, BytesIO(payload), content_length=len(payload))
    destination = paths.user_files_root / "user-1/file-1/original"
    assert destination.read_bytes() == payload
    assert list(paths.local_root.rglob("*.*")) == []
    assert storage.head(locator) == {"ContentLength": len(payload)}

    with storage.open_bounded(locator, expected_size_bytes=len(payload)) as opened:
        assert opened.stream.read() == payload
        assert opened.sha256 == hashlib.sha256(payload).hexdigest()

    assert storage.delete(locator)
    assert not destination.exists()
    assert storage.delete(locator)


def test_private_write_is_atomic_when_the_declared_size_is_wrong(tmp_path: Path) -> None:
    storage, paths = _storage(tmp_path)
    locator = "user-files/user-1/file-1/original"
    assert storage.put_stream(locator, BytesIO(b"old"), content_length=3)

    assert not storage.put_stream(locator, BytesIO(b"replacement"), content_length=3)
    assert (paths.user_files_root / "user-1/file-1/original").read_bytes() == b"old"
    assert not list(paths.uploads_staging_root.glob(".upload-*.tmp"))


def test_private_storage_separates_pending_and_internal_compatibility_bytes(tmp_path: Path) -> None:
    storage, paths = _storage(tmp_path)
    staged = "users/user-1/content/item-1/releases/release-1/staged/upload-1.bin"
    verified = "users/user-1/content/item-1/releases/release-1/files/blob-1.bin"

    assert storage.put_stream(staged, BytesIO(b"pending"), content_length=7)
    assert storage.put_stream(verified, BytesIO(b"verified"), content_length=8)

    assert (paths.uploads_staging_root / f"legacy-objects/{staged}").read_bytes() == b"pending"
    assert (paths.reconciliation_root / f"legacy-objects/{verified}").read_bytes() == b"verified"


def test_private_storage_rejects_traversal_and_wrong_size_reads(tmp_path: Path) -> None:
    storage, _ = _storage(tmp_path)
    with pytest.raises(PrivateFilePathError):
        storage.head("user-files/../escape")

    locator = "user-files/user-1/file-1/original"
    assert storage.put_stream(locator, BytesIO(b"1234"), content_length=4)
    with pytest.raises(PrivateFileSizeMismatchError):
        with storage.open_bounded(locator, expected_size_bytes=3):
            pass
