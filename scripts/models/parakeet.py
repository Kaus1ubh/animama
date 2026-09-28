#!/usr/bin/env python3
"""Acquire the reviewed Parakeet inventory explicitly; serving stays offline.

Only the Python standard library is required (macOS/Linux/Windows). A manifest digest
names an immutable complete set. No Hugging Face SDK, credentials or second
weight cache is involved. Interrupted acquisition restarts safely from scratch.
"""

from __future__ import annotations

import argparse
import contextlib
import errno
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
import time
from http.client import HTTPException
from pathlib import Path, PurePosixPath
from typing import BinaryIO
from urllib import error, parse, request

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl

MODEL_ID = "parakeet-tdt-0.6b-v2"
DEFAULT_MANIFEST = Path(__file__).resolve().parents[2] / "models" / MODEL_ID / "manifest.json"
NOTICES = {"README.md", "ATTRIBUTION.md"}
UPSTREAM = {
    "encoder-model.int8.onnx": ("istupakov", "0bbb45a3365852604aef28b538a8f066f4ccaa85"),
    "decoder_joint-model.int8.onnx": ("istupakov", "0bbb45a3365852604aef28b538a8f066f4ccaa85"),
    "nemo128.onnx": ("ysdede", "db4a768f5795e0f508187a34241fbeeef6ebb0d3"),
    "config.json": ("ysdede", "db4a768f5795e0f508187a34241fbeeef6ebb0d3"),
    "vocab.txt": ("ysdede", "db4a768f5795e0f508187a34241fbeeef6ebb0d3"),
}
DOWNLOAD_HOSTS = {
    "huggingface.co",
    "cdn-lfs.huggingface.co",
    "cdn-lfs-us-1.huggingface.co",
    "cdn-lfs-us-1.hf.co",
    "cas-bridge.xethub.hf.co",
    "us.aws.cdn.hf.co",
}
# Animama's own release distribution (the `animama-releases` R2 bucket). Only
# manifest entries with a `release` source may download from it.
RELEASE_HOSTS = {"downloads.animama.ai"}
CHUNK_SIZE = 1024 * 1024


class ModelStoreError(Exception):
    """An actionable setup failure, without signed URLs or credential output."""


class ModelStoreMissing(ModelStoreError):
    """A selected store or version directory has not been acquired (CLI exit 2)."""


def is_link(info: os.stat_result) -> bool:
    """Treat every Windows reparse point, including junctions, as an unsafe link."""
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    )


def reject_link(path: Path) -> None:
    """Check the leaf without resolving a dangling symlink or Windows junction."""
    try:
        info = path.lstat()
    except FileNotFoundError:
        return
    if is_link(info):
        raise ModelStoreError(f"Model path must not be a symlink or reparse point: {path}")


def windows_file_descriptor(path: Path, *, lock: bool = False) -> int:
    """Open the leaf itself, never a reparse target; transfer handle ownership to CRT.

    Windows has no O_NOFOLLOW. FILE_FLAG_OPEN_REPARSE_POINT plus handle-based
    attribute validation provides the equivalent for files. Refuse delete sharing
    so another process cannot replace a file or the lock while its handle is open.
    """
    import ctypes
    from ctypes import wintypes

    class FileInformation(ctypes.Structure):
        _fields_ = [
            ("attributes", wintypes.DWORD),
            ("creation", wintypes.FILETIME),
            ("access", wintypes.FILETIME),
            ("write", wintypes.FILETIME),
            ("volume", wintypes.DWORD),
            ("size_high", wintypes.DWORD),
            ("size_low", wintypes.DWORD),
            ("links", wintypes.DWORD),
            ("index_high", wintypes.DWORD),
            ("index_low", wintypes.DWORD),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    create.restype = wintypes.HANDLE
    get_info = kernel.GetFileInformationByHandle
    get_info.argtypes = [wintypes.HANDLE, ctypes.POINTER(FileInformation)]
    get_info.restype = wintypes.BOOL
    close = kernel.CloseHandle
    close.argtypes = [wintypes.HANDLE]
    close.restype = wintypes.BOOL
    # GENERIC_READ [+ WRITE], SHARE_READ [+ WRITE], OPEN_EXISTING / OPEN_ALWAYS.
    handle = create(
        str(path), 0xC0000000 if lock else 0x80000000, 3 if lock else 1, None, 4 if lock else 3, 0x00200000, None
    )
    if handle == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        info = FileInformation()
        if not get_info(handle, ctypes.byref(info)):
            raise ctypes.WinError(ctypes.get_last_error())
        if info.attributes & (0x400 | 0x10) or info.links != 1:
            raise ModelStoreError(f"Not an ordinary single-link model file: {path}")
        fd = msvcrt.open_osfhandle(handle, (os.O_RDWR if lock else os.O_RDONLY) | os.O_BINARY)
    except BaseException:
        close(handle)
        raise
    return fd


def safe_file_descriptor(path: Path, *, lock: bool = False) -> int:
    """Use native no-follow opens, then reject special files and hard links."""
    if sys.platform == "win32":
        return windows_file_descriptor(path, lock=lock)
    flags = (os.O_CREAT | os.O_RDWR) if lock else os.O_RDONLY
    fd = os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        os.close(fd)
        raise ModelStoreError(f"Not an ordinary single-link model file: {path}")
    return fd


def regular_file(path: Path) -> BinaryIO:
    """Open a regular binary file without following a leaf link on any platform."""
    try:
        return os.fdopen(safe_file_descriptor(path), "rb")
    except OSError as exc:
        raise ModelStoreError(f"Cannot safely read {path}: {exc.strerror}") from exc


def unique_keys(pairs: list[tuple[str, object]]) -> dict:
    """Reject ambiguous JSON objects instead of silently accepting the last key."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate manifest key: {key}")
        result[key] = value
    return result


def load_manifest(path: Path = DEFAULT_MANIFEST) -> dict:
    """Validate a local manifest; its exact bytes define the version directory."""
    path = Path(path).absolute()
    with regular_file(path) as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise ModelStoreError("Manifest exceeds 64 KiB")
    try:
        value = json.loads(raw, object_pairs_hook=unique_keys)
        if value["schema_version"] != 1 or value["model_id"] != MODEL_ID or value["license"] != "CC-BY-4.0":
            raise ValueError("unsupported schema, model or license")
        entries = value["files"]
        if len(entries) != 7 or {entry["path"] for entry in entries} != NOTICES | set(UPSTREAM):
            raise ValueError("expected the exact seven-file Parakeet inventory")
        for entry in entries:
            name = entry["path"]
            if type(entry["size"]) is not int or not 0 < entry["size"] < 2**31:
                raise ValueError(f"invalid byte size for {name}")
            if not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]):
                raise ValueError(f"invalid SHA-256 for {name}")
            if name in NOTICES:
                expected = {"local": name}
            else:
                owner, revision = UPSTREAM[name]
                expected = {"repository": f"{owner}/{MODEL_ID}-onnx", "revision": revision, "path": name}
            if entry["source"] != expected:
                raise ValueError(f"unreviewed source for {name}")
    except (KeyError, TypeError, ValueError) as exc:
        raise ModelStoreError(f"Invalid model manifest: {exc}") from exc
    value["digest"] = hashlib.sha256(raw).hexdigest()
    value["directory"] = path.parent
    return value


def resolve_root(value: str | Path | None = None) -> Path:
    """Choose an absolute store root; relative overrides are configuration errors."""
    configured = value if value is not None else os.environ.get("ANIMAMA_MODEL_ROOT")
    if configured is None:
        if sys.platform == "win32":
            local = os.environ.get("LOCALAPPDATA")
            if not local:
                raise ModelStoreError("LOCALAPPDATA is unavailable; set ANIMAMA_MODEL_ROOT to an absolute directory")
            cache = Path(local) / "Animama"
        elif sys.platform == "darwin":
            cache = Path.home() / "Library/Caches/Animama"
        else:
            # WSL runs Linux Python and deliberately follows the Linux/XDG default.
            cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "animama"
        configured = cache / "models"
    root = Path(configured).expanduser()
    if not root.is_absolute():
        raise ModelStoreError("ANIMAMA_MODEL_ROOT / --root must be an absolute model store directory")
    reject_link(root)
    if sys.platform == "win32":
        for parent in root.parents:
            reject_link(parent)
    return root.resolve()


def checked_directory(path: Path, *, create: bool = False) -> None:
    """Reject links in the managed namespace, including Windows junctions."""
    reject_link(path)
    if create:
        path.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        raise ModelStoreMissing(f"Model directory is missing: {path}")
    reject_link(path)
    if not path.is_dir():
        raise ModelStoreError(f"Not a model directory: {path}")


def verify_file(path: Path, entry: dict) -> None:
    """Hash every byte and reject truncation, excess bytes and nonregular files."""
    digest = hashlib.sha256()
    size = 0
    with regular_file(path) as stream:
        while chunk := stream.read(min(CHUNK_SIZE, entry["size"] - size + 1)):
            size += len(chunk)
            if size > entry["size"]:
                raise ModelStoreError(f"Oversized model file: {path.name}")
            digest.update(chunk)
    if size != entry["size"] or digest.hexdigest() != entry["sha256"]:
        raise ModelStoreError(f"Size or SHA-256 mismatch: {path.name}")


def verify_directory(manifest: dict, directory: Path) -> Path:
    """Verify the exact manifest inventory, never requesting network metadata."""
    checked_directory(directory)
    if {path.name for path in directory.iterdir()} != {entry["path"] for entry in manifest["files"]}:
        raise ModelStoreError(f"Incomplete or unexpected model inventory: {directory}")
    for entry in manifest["files"]:
        verify_file(directory / entry["path"], entry)
    return directory


def verify(manifest: dict, root: Path) -> Path:
    """Resolve and fully verify one manifest version in an existing store."""
    checked_directory(root)
    checked_directory(root / manifest["model_id"])
    return verify_directory(manifest, root / manifest["model_id"] / manifest["digest"])


def validate_url(url: str, hosts: set[str] = DOWNLOAD_HOSTS) -> None:
    """Allow only reviewed HTTPS download origins, with no URL credentials."""
    parsed = parse.urlsplit(url)
    try:
        allowed = parsed.port in (None, 443)
    except ValueError:
        allowed = False
    if (
        parsed.scheme != "https"
        or parsed.hostname not in hosts
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
        or not allowed
    ):
        raise ModelStoreError("Refusing an unreviewed model download URL or redirect")


class ReviewedRedirects(request.HTTPRedirectHandler):
    """Rebuild redirected requests instead of forwarding headers or credentials."""

    def __init__(self, hosts: set[str] = DOWNLOAD_HOSTS) -> None:
        super().__init__()
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl, self.hosts)
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None:
            redirected.headers.clear()
            redirected.unredirected_hdrs.clear()
            redirected.add_header("User-Agent", "Animama-model-setup/1")
        return redirected


def open_download(url: str, hosts: set[str] = DOWNLOAD_HOSTS):
    """Use anonymous HTTPS without environment proxy credentials or SDK caches."""
    validate_url(url, hosts)
    opener = request.build_opener(request.ProxyHandler({}), ReviewedRedirects(hosts))
    try:
        response = opener.open(request.Request(url, headers={"User-Agent": "Animama-model-setup/1"}), timeout=60)
        try:
            validate_url(response.url, hosts)
            if response.status != 200:
                raise ModelStoreError("Unexpected upstream status; retry explicit acquisition later")
            return response
        except BaseException:
            response.close()
            raise
    except error.HTTPError as exc:
        exc.close()
        raise ModelStoreError(f"Upstream HTTP {exc.code}; check connectivity or retry acquisition later") from exc
    except (error.URLError, TimeoutError, OSError) as exc:
        raise ModelStoreError("Model download failed; check connectivity and retry explicit acquisition") from exc


def copy_verified(stream: BinaryIO, destination: Path, entry: dict) -> None:
    """Bound streaming by expected size and promote only verified bytes."""
    length = getattr(stream, "headers", {}).get("Content-Length")
    if length is not None and length != str(entry["size"]):
        raise ModelStoreError(f"Unexpected upstream Content-Length: {entry['path']}")
    digest = hashlib.sha256()
    size = 0
    with destination.open("xb") as output:
        while chunk := stream.read(min(CHUNK_SIZE, entry["size"] - size + 1)):
            size += len(chunk)
            if size > entry["size"]:
                raise ModelStoreError(f"Oversized download: {entry['path']}")
            output.write(chunk)
            digest.update(chunk)
        if size != entry["size"] or digest.hexdigest() != entry["sha256"]:
            raise ModelStoreError(f"Size or SHA-256 mismatch: {entry['path']}")
        output.flush()
        os.fsync(output.fileno())
    destination.chmod(0o444)


@contextlib.contextmanager
def acquisition_lock(path: Path, timeout: float = 600):
    """A process lock releases on interruption; the inode stays stable for waiters."""
    fd = safe_file_descriptor(path, lock=True)
    locked = False
    try:
        deadline = time.monotonic() + timeout
        while True:
            try:
                if sys.platform == "win32":
                    # CRT locks start at the current file position and may extend
                    # past EOF, so the stable lock file need not contain any data.
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                else:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
                break
            except OSError as exc:
                if exc.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                    raise
                if time.monotonic() >= deadline:
                    raise ModelStoreError("Another acquisition is still running; retry after it finishes") from None
                time.sleep(0.05)
        yield
    finally:
        try:
            if locked and sys.platform == "win32":
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        finally:
            os.close(fd)


def remove_staging(directory: Path) -> None:
    """Remove only this acquisition's flat temporary inventory, including readonly files.

    Do not recurse through unexpected directories or change permissions on links.
    Windows requires clearing the readonly attribute before deleting copied files.
    Published versions never pass through this cleanup path.
    """
    checked_directory(directory)
    for path in directory.iterdir():
        info = path.lstat()
        if is_link(info) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ModelStoreError(f"Unsafe entry in temporary model directory; inspect manually: {path}")
        path.chmod(stat.S_IREAD | stat.S_IWRITE)
        path.unlink()
    directory.rmdir()


def acquire(
    manifest: dict,
    root: Path,
    *,
    offline: bool = False,
    import_from: Path | None = None,
    import_field: str = "path",
    transport=None,
) -> Path:
    """Reuse or atomically assemble a version; never replace an existing version."""
    checked_directory(root, create=True)
    parent = root / manifest["model_id"]
    checked_directory(parent, create=True)
    target = parent / manifest["digest"]
    with acquisition_lock(parent / f".{manifest['digest']}.lock"):
        reject_link(target)
        if target.exists():
            try:
                return verify_directory(manifest, target)
            except ModelStoreError as exc:
                raise ModelStoreError(
                    f"Existing model version is corrupt; it was not changed: {target}. "
                    "Stop its users before manually quarantining/removing that version, then acquire again. "
                    f"Details: {exc}"
                ) from exc
        if offline and import_from is None:
            raise ModelStoreError("Model version is unavailable offline; acquire online or use --offline --import-from")
        if import_from is not None:
            import_from = Path(import_from).absolute()
            checked_directory(import_from)
        required = sum(entry["size"] for entry in manifest["files"])
        if shutil.disk_usage(parent).free < required:
            raise ModelStoreError(f"Insufficient model-store space; need at least {required} free bytes")
        staging = Path(tempfile.mkdtemp(prefix=f".{manifest['digest']}.partial-", dir=parent))
        try:
            for entry in manifest["files"]:
                if import_from is not None:
                    relative = PurePosixPath(entry[import_field])
                    if relative.is_absolute() or any(
                        part in (".", "..") or "\\" in part or ":" in part for part in relative.parts
                    ):
                        raise ModelStoreError("Unsafe model import path")
                    source_path = import_from
                    for part in relative.parts[:-1]:
                        source_path /= part
                        checked_directory(source_path)
                    stream = regular_file(source_path / relative.name)
                elif "local" in entry["source"]:
                    stream = regular_file(manifest["directory"] / entry["path"])
                elif entry["source"].get("kind") == "release":
                    url = entry["source"]["url"]
                    validate_url(url, RELEASE_HOSTS)
                    stream = transport(url) if transport else open_download(url, RELEASE_HOSTS)
                else:
                    source = entry["source"]
                    url = f"https://huggingface.co/{source['repository']}/resolve/{source['revision']}/{source['path']}"
                    stream = (transport or open_download)(url)
                with stream:
                    copy_verified(stream, staging / entry["path"], entry)
            verify_directory(manifest, staging)
            # Same-filesystem rename makes the complete inventory visible in one step.
            staging.rename(target)
            return target
        finally:
            if staging.exists():
                remove_staging(staging)


def main(argv: list[str] | None = None) -> int:
    """Print only the verified absolute model directory on success."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("acquire", "verify", "path"))
    parser.add_argument("--root", help="absolute shared model STORE root (overrides ANIMAMA_MODEL_ROOT)")
    parser.add_argument(
        "--manifest", type=Path, default=DEFAULT_MANIFEST, help="local reviewed manifest or test fixture"
    )
    parser.add_argument("--offline", action="store_true", help="never access the network (always true for verify/path)")
    parser.add_argument("--import-from", type=Path, help="copy an existing seven-file inventory after hash validation")
    args = parser.parse_args(argv)
    if args.import_from and args.operation != "acquire":
        parser.error("--import-from applies only to acquire")
    try:
        root = resolve_root(args.root)
        manifest = load_manifest(args.manifest)
        result = (
            acquire(manifest, root, offline=args.offline, import_from=args.import_from)
            if args.operation == "acquire"
            else verify(manifest, root)
        )
        print(result)
        return 0
    except (ModelStoreError, OSError, ValueError, HTTPException) as exc:
        # Never include transport exception text: it can contain signed query URLs.
        detail = (
            str(exc) if isinstance(exc, ModelStoreError) else "Filesystem or transfer failure; check space and access"
        )
        print(f"Parakeet setup failed: {detail}", file=sys.stderr)
        print(
            "Run python3 scripts/models/parakeet.py acquire [--root ABSOLUTE_STORE_ROOT]. "
            "To reuse existing files without network, add --offline --import-from EXISTING_MODEL_DIRECTORY.",
            file=sys.stderr,
        )
        return 2 if isinstance(exc, ModelStoreMissing) else 1


if __name__ == "__main__":
    raise SystemExit(main())
