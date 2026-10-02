"""Portable no-follow opens, directory syncs and replace retries for local stores."""

from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

import pytest

from animama.local.http.assets import _open_regular
from animama.utils import files
from tests.filesystem_links import link_directory, require_symlinks


def test_open_no_follow_reads_and_creates_regular_files(tmp_path: Path) -> None:
    existing = tmp_path / "existing.json"
    existing.write_bytes(b"{}")
    descriptor = files.open_no_follow(existing, os.O_RDONLY)
    with os.fdopen(descriptor, "rb") as handle:
        assert handle.read() == b"{}"
    created = files.open_no_follow(tmp_path / "new.tmp", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(created)
    assert (tmp_path / "new.tmp").is_file()


def test_open_no_follow_refuses_a_final_link(tmp_path: Path) -> None:
    require_symlinks(tmp_path)
    target = tmp_path / "target.json"
    target.write_bytes(b"{}")
    (tmp_path / "link.json").symlink_to(target)
    with pytest.raises(OSError):
        files.open_no_follow(tmp_path / "link.json", os.O_RDONLY)


def test_path_is_link_reports_directory_links_and_absent_paths(tmp_path: Path) -> None:
    (tmp_path / "real").mkdir()
    link_directory(tmp_path / "linked", tmp_path / "real")

    assert files.path_is_link(tmp_path / "linked")
    assert not files.path_is_link(tmp_path / "real")
    assert not files.path_is_link(tmp_path / "missing")
    with pytest.raises(OSError):
        files.open_no_follow(tmp_path / "linked", os.O_RDONLY)


def test_replace_retries_only_a_windows_sharing_violation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[int] = []

    def blocked_twice(source: Path, destination: Path) -> None:
        attempts.append(1)
        if len(attempts) < 3:
            raise PermissionError(13, "sharing violation")

    monkeypatch.setattr("os.replace", blocked_twice)
    monkeypatch.setattr("time.sleep", lambda _seconds: None)
    monkeypatch.setattr("animama.utils.files.WINDOWS", True)
    files.replace(tmp_path / "a", tmp_path / "b")
    assert len(attempts) == 3

    attempts.clear()
    monkeypatch.setattr("animama.utils.files.WINDOWS", False)
    with pytest.raises(PermissionError):
        files.replace(tmp_path / "a", tmp_path / "b")
    assert len(attempts) == 1


@pytest.mark.skipif(sys.platform != "win32", reason="Windows sharing semantics")
def test_replace_waits_for_a_reader_that_blocks_deletion(tmp_path: Path) -> None:
    # Python opens files without delete sharing, as antivirus scanners often do.
    destination = tmp_path / "manifest.json"
    destination.write_bytes(b"old")
    source = tmp_path / "manifest.json.tmp"
    source.write_bytes(b"new")
    reader = destination.open("rb")
    threading.Timer(0.3, reader.close).start()
    files.replace(source, destination)
    assert destination.read_bytes() == b"new"


def test_assets_refuse_a_directory_link_inside_the_root(tmp_path: Path) -> None:
    root = tmp_path / "web"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (outside / "app.js").write_bytes(b"secret")
    link_directory(root / "assets", outside)
    with pytest.raises((OSError, ValueError)):
        _open_regular(root.resolve(), "assets/app.js")


@pytest.mark.skipif(sys.platform != "win32", reason="Windows resolves paths through the open handle")
def test_final_path_names_the_opened_file(tmp_path: Path) -> None:
    target = tmp_path / "wave.vrma"
    target.write_bytes(b"glTF")
    descriptor = files.open_no_follow(target, os.O_RDONLY)
    try:
        assert os.path.normcase(files.final_path(descriptor)) == os.path.normcase(target.resolve())
    finally:
        os.close(descriptor)


@pytest.mark.skipif(sys.platform != "win32", reason="8.3 short names are a Windows alias")
def test_assets_refuse_a_short_name_alias_for_a_hidden_folder(tmp_path: Path) -> None:
    import ctypes

    root = tmp_path.resolve() / "web"
    (root / ".vite").mkdir(parents=True)
    (root / ".vite" / "manifest.json").write_bytes(b"{}")
    buffer = ctypes.create_unicode_buffer(512)
    ctypes.windll.kernel32.GetShortPathNameW(str(root / ".vite"), buffer, len(buffer))  # type: ignore[attr-defined]
    alias = Path(buffer.value).name
    if not alias or alias == ".vite":
        pytest.skip("this volume does not create 8.3 short names")
    with pytest.raises(ValueError):
        _open_regular(root, f"{alias}/manifest.json")
