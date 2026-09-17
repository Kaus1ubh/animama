"""Offline, tiny-byte tests for setup/storage failures; no real model download."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import stat
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from urllib import error, request

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/models/parakeet.py"
spec = importlib.util.spec_from_file_location("parakeet_setup", SCRIPT)
assert spec and spec.loader
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


@pytest.fixture
def inventory(tmp_path):
    """Retain the production schema/sources while replacing large files with bytes."""
    value = json.loads(store.DEFAULT_MANIFEST.read_bytes())
    notice_root = tmp_path / "notices"
    notice_root.mkdir()
    content = {}
    for entry in value["files"]:
        data = (entry["path"] + " fixture\n").encode()
        content[entry["path"]] = data
        entry["size"] = len(data)
        entry["sha256"] = hashlib.sha256(data).hexdigest()
        if "local" in entry["source"]:
            (notice_root / entry["path"]).write_bytes(data)
    path = notice_root / "manifest.json"
    path.write_text(json.dumps(value))
    manifest = store.load_manifest(path)
    calls = []

    def transport(url):
        calls.append(url)
        return io.BytesIO(content[url.rsplit("/", 1)[1]])

    return SimpleNamespace(
        manifest=manifest,
        content=content,
        transport=transport,
        calls=calls,
        root=tmp_path / "store",
        manifest_path=path,
    )


def test_acquire_verify_and_offline_reuse_never_request_metadata(inventory):
    i = inventory
    directory = store.acquire(i.manifest, i.root, transport=i.transport)
    assert len(i.calls) == 5
    assert directory == i.root / store.MODEL_ID / i.manifest["digest"]
    assert store.verify(i.manifest, i.root) == directory
    assert store.acquire(i.manifest, i.root, offline=True, transport=lambda _: pytest.fail("network")) == directory
    assert len(list(directory.iterdir())) == 7
    assert all(not p.stat().st_mode & 0o222 for p in directory.iterdir())


@pytest.mark.parametrize("kind", ["wrong", "truncated", "oversized", "interrupted", "unavailable", "throttled"])
def test_failed_transfer_never_exposes_partial_and_retry_succeeds(inventory, kind):
    i = inventory

    class Interrupted(io.BytesIO):
        def read(self, size=-1):
            raise ConnectionResetError("interrupted")

    def broken(url):
        data = i.content[url.rsplit("/", 1)[1]]
        if kind == "interrupted":
            return Interrupted(data)
        if kind in ("unavailable", "throttled"):
            raise error.HTTPError(url, 404 if kind == "unavailable" else 429, "unavailable", {}, None)
        return io.BytesIO({"wrong": b"x" * len(data), "truncated": data[:-1], "oversized": data + b"x"}[kind])

    with pytest.raises((store.ModelStoreError, OSError)):
        store.acquire(i.manifest, i.root, transport=broken)
    assert not (i.root / store.MODEL_ID / i.manifest["digest"]).exists()
    assert not list((i.root / store.MODEL_ID).glob("*.partial-*"))
    assert store.acquire(i.manifest, i.root, transport=i.transport).is_dir()


def test_existing_corruption_is_not_repaired_or_overwritten(inventory):
    i = inventory
    directory = store.acquire(i.manifest, i.root, transport=i.transport)
    bad = directory / "vocab.txt"
    bad.chmod(0o644)
    bad.write_bytes(b"corrupt")
    with pytest.raises(store.ModelStoreError, match="not changed"):
        store.acquire(i.manifest, i.root, transport=lambda _: pytest.fail("network"))
    assert bad.read_bytes() == b"corrupt"


def test_offline_import_and_subsequent_versions_coexist(inventory, tmp_path):
    i = inventory
    existing = tmp_path / "old-copy"
    existing.mkdir()
    for name, data in i.content.items():
        (existing / name).write_bytes(data)
    first = store.acquire(i.manifest, i.root, offline=True, import_from=existing)
    # A changed manifest gets a separate directory even with identical inventory.
    i.manifest_path.write_text(i.manifest_path.read_text() + "\n")
    second_manifest = store.load_manifest(i.manifest_path)
    second = store.acquire(second_manifest, i.root, offline=True, import_from=existing)
    assert first != second
    assert store.verify_directory(i.manifest, first)
    assert store.verify_directory(second_manifest, second)


def test_offline_missing_fails_without_transport(inventory):
    with pytest.raises(store.ModelStoreError, match="unavailable offline"):
        store.acquire(inventory.manifest, inventory.root, offline=True, transport=lambda _: pytest.fail("network"))


def test_same_version_concurrency_downloads_once(inventory):
    i = inventory
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(store.acquire, i.manifest, i.root, transport=i.transport) for _ in range(2)]
    assert futures[0].result() == futures[1].result()
    assert len(i.calls) == 5


@pytest.mark.parametrize("change", ["traversal", "duplicate", "source", "local", "size"])
def test_manifest_rejects_unsafe_or_unreviewed_inventory(inventory, change):
    i = inventory
    value = json.loads(i.manifest_path.read_text())
    if change == "traversal":
        value["files"][0]["path"] = "../escape"
    elif change == "duplicate":
        value["files"][1] = value["files"][0]
    elif change == "source":
        value["files"][2]["source"]["revision"] = "main"
    elif change == "local":
        value["files"][0]["source"]["local"] = "../../secret"
    else:
        value["files"][0]["size"] = True
    i.manifest_path.write_text(json.dumps(value))
    with pytest.raises(store.ModelStoreError, match="Invalid"):
        store.load_manifest(i.manifest_path)


def symlink_or_skip(link, target, *, directory=False):
    """Windows symlink creation needs Developer Mode; junction coverage never skips."""
    try:
        link.symlink_to(target, target_is_directory=directory)
    except OSError as exc:
        if sys.platform == "win32" and exc.winerror == 1314:
            pytest.skip("Windows symlink privilege unavailable; native junction tests still run")
        raise


def test_symlink_in_inventory_and_store_rejected(inventory, tmp_path):
    i = inventory
    directory = store.acquire(i.manifest, i.root, transport=i.transport)
    entry = next(e for e in i.manifest["files"] if e["path"] == "vocab.txt")
    outside = tmp_path / "outside"
    outside.write_bytes(i.content["vocab.txt"])
    (directory / "vocab.txt").chmod(0o644)
    (directory / "vocab.txt").unlink()
    symlink_or_skip(directory / "vocab.txt", outside)
    with pytest.raises(store.ModelStoreError):
        store.verify_file(directory / "vocab.txt", entry)
    link = tmp_path / "root-link"
    symlink_or_skip(link, i.root, directory=True)
    with pytest.raises(store.ModelStoreError, match="symlink"):
        store.resolve_root(link)


def test_insufficient_space_preserves_existing_versions(inventory, monkeypatch):
    i = inventory
    monkeypatch.setattr(store.shutil, "disk_usage", lambda _: SimpleNamespace(free=0))
    with pytest.raises(store.ModelStoreError, match="Insufficient"):
        store.acquire(i.manifest, i.root, transport=lambda _: pytest.fail("network"))
    assert not list((i.root / store.MODEL_ID).glob("*.partial-*"))


@pytest.mark.parametrize(
    "url",
    [
        "http://huggingface.co/model",
        "https://evil.example/model",
        "https://huggingface.co.evil.example/model",
        "https://token@huggingface.co/model",
        "https://huggingface.co:8080/model",
        "https://huggingface.co/model#fragment",
    ],
)
def test_unreviewed_redirect_rejected(url):
    with pytest.raises(store.ModelStoreError, match="unreviewed"):
        store.validate_url(url)


def test_reviewed_redirect_does_not_forward_headers():
    req = request.Request("https://huggingface.co/model", headers={"Authorization": "secret", "Cookie": "secret"})
    result = store.ReviewedRedirects().redirect_request(
        req, None, 302, "Found", {}, "https://cas-bridge.xethub.hf.co/model?signature=fixture"
    )
    assert result.get_header("Authorization") is None
    assert result.get_header("Cookie") is None
    assert result.get_header("User-agent") == "Animama-model-setup/1"


def test_cli_status_and_root_precedence(inventory, monkeypatch, capsys):
    i = inventory
    monkeypatch.setenv("ANIMAMA_MODEL_ROOT", str(i.root))
    assert store.resolve_root() == i.root
    assert store.resolve_root(i.root.parent / "override") == i.root.parent / "override"
    with pytest.raises(store.ModelStoreError, match="absolute"):
        store.resolve_root("relative")
    args = ["path", "--manifest", str(i.manifest_path), "--offline"]
    assert store.main(args) == 2
    assert "acquire" in capsys.readouterr().err
    store.acquire(i.manifest, i.root, transport=i.transport)
    assert store.main(args) == 0
    assert capsys.readouterr().out.strip() == str(i.root / store.MODEL_ID / i.manifest["digest"])


def test_content_length_rejected_before_read(inventory, tmp_path):
    entry = inventory.manifest["files"][0]

    class WrongLength(io.BytesIO):
        headers = {"Content-Length": "9999999999"}

        def read(self, size=-1):
            pytest.fail("wrong declared length should fail before streaming")

    with pytest.raises(store.ModelStoreError, match="Content-Length"):
        store.copy_verified(WrongLength(), tmp_path / "download", entry)
    assert not (tmp_path / "download").exists()


def test_stream_request_is_bounded_by_expected_size(inventory, tmp_path):
    entry = inventory.manifest["files"][0]

    class Excess(io.BytesIO):
        def read(self, size=-1):
            assert 0 < size <= entry["size"] + 1
            return super().read(size)

    with pytest.raises(store.ModelStoreError, match="Oversized"):
        store.copy_verified(Excess(b"x" * 10000), tmp_path / "download", entry)


@pytest.mark.parametrize("target", ["namespace", "version", "lock"])
def test_managed_symlinks_rejected(inventory, tmp_path, target):
    i = inventory
    i.root.mkdir()
    namespace = i.root / store.MODEL_ID
    external = tmp_path / "outside"
    external.mkdir()
    if target == "namespace":
        symlink_or_skip(namespace, external, directory=True)
    else:
        namespace.mkdir()
        destination = namespace / (i.manifest["digest"] if target == "version" else f".{i.manifest['digest']}.lock")
        symlink_or_skip(destination, external, directory=True)
    with pytest.raises((store.ModelStoreError, OSError)):
        store.acquire(i.manifest, i.root, transport=lambda _: pytest.fail("network"))
    assert not list(external.iterdir())


def test_verify_rejects_unlisted_file(inventory):
    i = inventory
    directory = store.acquire(i.manifest, i.root, transport=i.transport)
    (directory / "unlisted.onnx").write_bytes(b"unexpected")
    with pytest.raises(store.ModelStoreError, match="unexpected model inventory"):
        store.verify(i.manifest, i.root)


def test_lock_timeout_is_actionable(tmp_path):
    lock = tmp_path / "lock"
    with store.acquisition_lock(lock):
        with pytest.raises(store.ModelStoreError, match="Another acquisition"):
            with store.acquisition_lock(lock, timeout=0):
                pytest.fail("a held lock must not be acquired")


def test_reviewed_current_huggingface_cdn_redirect():
    store.validate_url("https://us.aws.cdn.hf.co/xet-bridge-us/model?signature=fixture")
    with pytest.raises(store.ModelStoreError):
        store.validate_url("https://other.aws.cdn.hf.co/model")


def test_duplicate_manifest_keys_rejected(inventory):
    path = inventory.manifest_path
    path.write_text(path.read_text().replace('"schema_version": 1', '"schema_version": 1, "schema_version": 1'))
    with pytest.raises(store.ModelStoreError, match="duplicate manifest key"):
        store.load_manifest(path)


@pytest.mark.parametrize("platform", ["darwin", "linux", "win32"])
def test_platform_default_and_override(inventory, tmp_path, monkeypatch, platform):
    # Native CI also exercises Windows Path semantics; the portable runs check selection.
    monkeypatch.delenv("ANIMAMA_MODEL_ROOT", raising=False)
    monkeypatch.setattr(store.sys, "platform", platform)
    monkeypatch.setattr(store.Path, "home", lambda: tmp_path)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Local AppData"))
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "xdg"))
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")
    expected = {
        "darwin": tmp_path / "Library/Caches/Animama/models",
        "linux": tmp_path / "xdg/animama/models",
        "win32": tmp_path / "Local AppData/Animama/models",
    }
    assert store.resolve_root() == expected[platform]
    monkeypatch.setenv("ANIMAMA_MODEL_ROOT", str(inventory.root))
    assert store.resolve_root() == inventory.root
    assert store.resolve_root(tmp_path / "explicit") == tmp_path / "explicit"


def test_windows_missing_local_app_data_requires_override(tmp_path, monkeypatch):
    monkeypatch.setattr(store.sys, "platform", "win32")
    monkeypatch.delenv("ANIMAMA_MODEL_ROOT", raising=False)
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    with pytest.raises(store.ModelStoreError, match="LOCALAPPDATA"):
        store.resolve_root()
    monkeypatch.setenv("ANIMAMA_MODEL_ROOT", str(tmp_path))
    assert store.resolve_root() == tmp_path


def test_linux_default_ignores_windows_environment(tmp_path, monkeypatch):
    monkeypatch.setattr(store.sys, "platform", "linux")
    monkeypatch.setattr(store.Path, "home", lambda: tmp_path)
    monkeypatch.delenv("ANIMAMA_MODEL_ROOT", raising=False)
    monkeypatch.delenv("XDG_CACHE_HOME", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Windows"))
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")
    assert store.resolve_root() == tmp_path / ".cache/animama/models"


def test_reparse_attribute_rejected_even_without_symlink_mode():
    info = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_file_attributes=0x400)
    assert store.is_link(info)


def test_hardlinked_input_and_lock_rejected(inventory, tmp_path):
    external = tmp_path / "external"
    external.write_bytes(b"untouched")
    alias = tmp_path / "alias"
    os.link(external, alias)
    with pytest.raises(store.ModelStoreError, match="single-link"):
        store.regular_file(alias)
    with pytest.raises(store.ModelStoreError, match="single-link"):
        with store.acquisition_lock(alias):
            pytest.fail("hardlink lock must be rejected")
    assert external.read_bytes() == b"untouched"


def test_binary_reads_preserve_crlf_and_control_z(tmp_path):
    path = tmp_path / "binary"
    data = b"\x00a\r\nb\x1ac\xff"
    path.write_bytes(data)
    with store.regular_file(path) as stream:
        assert stream.read() == data


def test_cleanup_readonly_staging_preserves_other_versions(inventory, monkeypatch):
    i = inventory
    existing = store.acquire(i.manifest, i.root, transport=i.transport)
    i.manifest_path.write_text(i.manifest_path.read_text() + "\n")
    next_manifest = store.load_manifest(i.manifest_path)

    def reject_after_copy(*args):
        raise RuntimeError("failed after all readonly files were staged")

    with monkeypatch.context() as scoped:
        scoped.setattr(store, "verify_directory", reject_after_copy)
        with pytest.raises(RuntimeError, match="readonly"):
            store.acquire(next_manifest, i.root, transport=i.transport)
    assert not list((i.root / store.MODEL_ID).glob("*.partial-*"))
    assert store.verify_directory(i.manifest, existing) == existing


def test_lock_is_exclusive_between_processes_and_released_on_termination(tmp_path):
    lock = tmp_path / "process-lock"
    child = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import runpy,sys,time; from pathlib import Path; "
            "s=runpy.run_path(sys.argv[1]); "
            "lock=s['acquisition_lock'](Path(sys.argv[2])); lock.__enter__(); "
            "print('locked', flush=True); time.sleep(30)",
            str(SCRIPT),
            str(lock),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert child.stdout.readline().strip() == "locked"
        with pytest.raises(store.ModelStoreError, match="Another acquisition"):
            with store.acquisition_lock(lock, timeout=0):
                pytest.fail("another process owns the lock")
    finally:
        child.terminate()
        child.communicate(timeout=10)
    with store.acquisition_lock(lock, timeout=1):
        pass


@pytest.mark.skipif(sys.platform != "win32", reason="requires native Windows junctions")
@pytest.mark.parametrize("target", ["root", "ancestor", "namespace", "version", "import"])
def test_windows_junctions_rejected_without_touching_target(inventory, tmp_path, target):
    i = inventory
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "sentinel"
    sentinel.write_bytes(b"preserve")
    if target == "root":
        link = i.root
    elif target == "ancestor":
        link = tmp_path / "linked-parent"
    elif target == "import":
        link = tmp_path / "linked-import"
    else:
        link = i.root / store.MODEL_ID
        if target == "version":
            link /= i.manifest["digest"]
        link.parent.mkdir(parents=True)
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(outside)], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
    try:
        with pytest.raises(store.ModelStoreError, match="reparse"):
            if target in ("root", "ancestor"):
                store.resolve_root(link if target == "root" else link / "models")
            else:
                store.acquire(i.manifest, i.root, offline=True, import_from=link if target == "import" else None)
        assert sentinel.read_bytes() == b"preserve"
        assert list(outside.iterdir()) == [sentinel]
    finally:
        link.rmdir()


@pytest.mark.skipif(sys.platform != "win32", reason="requires native Windows file sharing")
def test_windows_open_verified_file_cannot_be_replaced(tmp_path):
    path = tmp_path / "model"
    path.write_bytes(b"preserve")
    with store.regular_file(path) as stream:
        with pytest.raises(PermissionError):
            path.unlink()
        with pytest.raises(PermissionError):
            path.write_bytes(b"replace")
        assert stream.read() == b"preserve"
    path.unlink()
