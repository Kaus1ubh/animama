"""Fresh publication remains recoverable after each filesystem commit point."""

from __future__ import annotations

import errno
import os
import sys
from pathlib import Path

import pytest

from animama.adapters.content_store import mutations
from animama.domain.content_catalog import ContentConflictError


def journal_at(root: Path) -> mutations.MutationJournal:
    local = root / "local"
    local.mkdir(exist_ok=True)
    return mutations.create_journal(
        local_root=local,
        operations_root=root / "operations",
        operation_id="fresh-import",
        user_id="owner",
        request_digest="a" * 64,
    )


def restarted(journal: mutations.MutationJournal) -> mutations.MutationJournal:
    (reloaded,) = mutations.read_journals(local_root=journal.local_root, operations_root=journal.operations_root)
    return reloaded


def test_restart_after_fresh_file_publication_can_rollback_and_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    journal = journal_at(tmp_path)
    staged = journal.temporary("payload")
    staged.write_bytes(b"original import bytes")
    destination = journal.local_root / "payload.bin"
    original = mutations.publish_new

    def publish_then_stop(source: Path, target: Path) -> None:
        original(source, target)
        raise InterruptedError("process stopped immediately after publication")

    with monkeypatch.context() as patch:
        patch.setattr(mutations, "publish_new", publish_then_stop)
        with pytest.raises(InterruptedError):
            journal.replace(staged, destination, require_new=True)
    assert destination.read_bytes() == b"original import bytes"
    restarted(journal).finish(commit=False)
    assert not destination.exists()
    retry = journal_at(tmp_path)
    retried = retry.temporary("payload")
    retried.write_bytes(b"original import bytes")
    retry.replace(retried, destination, require_new=True)
    restarted(retry).finish(commit=True)
    assert destination.read_bytes() == b"original import bytes"


def test_restart_after_fresh_directory_publication_removes_empty_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    journal = journal_at(tmp_path)
    destination = journal.local_root / "reaction"
    original = mutations.publish_new

    def create_then_stop(source: Path, target: Path) -> None:
        original(source, target)
        raise InterruptedError("process stopped immediately after directory publication")

    with monkeypatch.context() as patch:
        patch.setattr(mutations, "publish_new", create_then_stop)
        with pytest.raises(InterruptedError):
            journal.create_directory(destination)
    assert destination.is_dir()
    restarted(journal).finish(commit=False)
    assert not destination.exists()
    retry = journal_at(tmp_path)
    retry.create_directory(destination)
    restarted(retry).finish(commit=True)
    assert destination.is_dir()


def test_restart_after_private_directory_creation_leaves_no_public_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    journal = journal_at(tmp_path)
    destination = journal.local_root / "reaction"
    original = Path.mkdir

    def create_then_stop(path: Path, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        original(path, *args, **kwargs)
        if path.name.endswith("-directory"):
            raise InterruptedError("process stopped before recording private inode")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "mkdir", create_then_stop)
        with pytest.raises(InterruptedError):
            journal.create_directory(destination)
    restarted(journal).finish(commit=False)
    assert not destination.exists()
    retry = journal_at(tmp_path)
    retry.create_directory(destination)
    restarted(retry).finish(commit=True)
    assert destination.is_dir()


def test_restart_before_fresh_file_publication_only_removes_private_staging(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    journal = journal_at(tmp_path)
    staged = journal.temporary("payload")
    staged.write_bytes(b"import bytes")
    destination = journal.local_root / "payload.bin"

    def stop_before_publication(source: Path, target: Path) -> None:
        raise InterruptedError("process stopped before publication")

    with monkeypatch.context() as patch:
        patch.setattr(mutations, "publish_new", stop_before_publication)
        with pytest.raises(InterruptedError):
            journal.replace(staged, destination, require_new=True)
    restarted(journal).finish(commit=False)
    assert not destination.exists()
    assert not staged.exists()


@pytest.mark.parametrize("manual_change", ["same_bytes_replacement", "unrelated_hardlink", "edit"])
def test_fresh_file_recovery_preserves_manual_changes_and_journal(tmp_path: Path, manual_change: str) -> None:
    journal = journal_at(tmp_path)
    staged = journal.temporary("payload")
    staged.write_bytes(b"original import bytes")
    destination = journal.local_root / "payload.bin"
    journal.replace(staged, destination, require_new=True)
    unrelated = tmp_path / "host-owned.bin"
    if manual_change == "same_bytes_replacement":
        unrelated.write_bytes(destination.read_bytes())
        os.replace(unrelated, destination)
    elif manual_change == "unrelated_hardlink":
        os.link(destination, unrelated)
    else:
        destination.write_bytes(b"manually edited bytes")
    before = destination.read_bytes()
    with pytest.raises(ContentConflictError, match="content_recovery_conflict"):
        restarted(journal).finish(commit=False)
    assert destination.read_bytes() == before
    assert journal.path.exists()
    if manual_change == "unrelated_hardlink":
        assert unrelated.read_bytes() == before


@pytest.mark.parametrize("manual_change", ["replace", "populate"])
def test_fresh_directory_recovery_preserves_host_directory_and_files(tmp_path: Path, manual_change: str) -> None:
    journal = journal_at(tmp_path)
    destination = journal.local_root / "reaction"
    journal.create_directory(destination)
    if manual_change == "replace":
        host_directory = tmp_path / "host-directory"
        host_directory.mkdir()
        destination.rmdir()
        host_directory.rename(destination)
    else:
        (destination / "manual.txt").write_bytes(b"host bytes")
    before = destination.stat()
    restarted(journal).finish(commit=False)
    assert destination.is_dir()
    assert destination.stat().st_ino == before.st_ino
    if manual_change == "populate":
        assert (destination / "manual.txt").read_bytes() == b"host bytes"


@pytest.mark.parametrize("directory", [False, True])
def test_native_exclusive_publication_never_replaces_an_existing_entry(tmp_path: Path, directory: bool) -> None:
    source = tmp_path / "private"
    destination = tmp_path / "public"
    if directory:
        source.mkdir()
        destination.mkdir()
    else:
        source.write_bytes(b"import bytes")
        destination.write_bytes(b"host bytes")
    original = destination.stat()
    with pytest.raises(FileExistsError):
        mutations.publish_new(source, destination)
    assert source.exists()
    assert destination.stat().st_ino == original.st_ino
    if not directory:
        assert destination.read_bytes() == b"host bytes"
    destination.rmdir() if directory else destination.unlink()
    mutations.publish_new(source, destination)
    assert destination.exists()
    assert not source.exists()


def test_exclusive_publication_fails_closed_without_native_support(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "private"
    source.write_bytes(b"import bytes")
    destination = tmp_path / "public"
    monkeypatch.setattr(sys, "platform", "unsupported")
    with pytest.raises(OSError) as error:
        mutations.publish_new(source, destination)
    assert error.value.errno == errno.ENOTSUP
    assert source.read_bytes() == b"import bytes"
    assert not destination.exists()
