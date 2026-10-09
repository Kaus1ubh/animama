"""Bounded, closed hosted application archives; no extraction of unverified paths."""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import shutil
import tarfile
import tempfile
from contextlib import contextmanager
from pathlib import Path

from package_set import HEX40, HEX64, SEMVER, canonical, file_sha, matches, sha

APP = "animama-hosted-web"
TEMPLATE_BASE = "/__animama_resource_template__/"
MAX_ARCHIVE = 1024 * 1024 * 1024
MAX_TOTAL = 2 * MAX_ARCHIVE
MAX_FILE = 256 * 1024 * 1024
MAX_FILES = 4096
MAX_MANIFEST = 4 * 1024 * 1024
MAX_TEXT = 16 * 1024 * 1024
MAX_TEXT_TOTAL = 64 * 1024 * 1024
MAX_PAX_BYTES = 1024
MIMES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".onnx": "application/octet-stream",
    ".npy": "application/octet-stream",
    ".model": "application/octet-stream",
    ".bin": "application/octet-stream",
    ".safetensors": "application/octet-stream",
}
TEXT_SUFFIXES = {".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".md"}


def mime(path):
    """Explicit browser MIME policy, never platform-dependent MIME guessing."""
    try:
        return MIMES[Path(path).suffix.lower()]
    except KeyError as error:
        raise ValueError(f"Unreviewed application file type: {path}") from error


def safe_path(path):
    if (
        not isinstance(path, str)
        or len(path) > 512
        or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_./=-]*", path)
        or any(p in {"", ".", ".."} for p in path.split("/"))
    ):
        raise ValueError("Unsafe application path")
    return path


def closed(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(f"Closed {label} fields required")


def positive_int(value, maximum):
    return type(value) is int and 0 <= value <= maximum


def read_json(data):
    """Reject duplicate fields before JSON parsing can hide conflicting authority."""

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON field")
            result[key] = value
        return result

    return json.loads(data, object_pairs_hook=pairs)


def read_exact(read, size):
    """Read a previously bounded frame, never a header-declared extension size."""
    data = read(size)
    if len(data) != size:
        raise ValueError("Truncated application tar frame")
    return data


def producer_pax_path(payload):
    """The producer needs exactly one ASCII path record for a name over 100 bytes."""
    record = re.fullmatch(rb"([1-9][0-9]{0,3}) path=([A-Za-z0-9_./=-]+)\n", payload)
    if not record or int(record[1]) != len(payload):
        raise ValueError("Application PAX accepts only one canonical path record")
    name = record[2].decode("ascii")
    if not name.startswith(APP + "/") or len(name) <= tarfile.LENGTH_NAME:
        raise ValueError("Application PAX is only for producer long paths")
    safe_path(name[len(APP) + 1 :])
    return name


def regular_tar_members(read):
    """Flat framing avoids tarfile's allocating and recursive extension parsers."""
    headers, pending_path = 0, None
    while True:
        header = read_exact(read, tarfile.BLOCKSIZE)
        if not any(header):
            if pending_path or any(read_exact(read, tarfile.BLOCKSIZE)):
                raise ValueError("Invalid application tar end")
            padding = 0
            while chunk := read(64 * 1024):
                padding += len(chunk)
                if padding > tarfile.RECORDSIZE or any(chunk):
                    raise ValueError("Unverified bytes after application tar end")
            return
        headers += 1
        if headers > 2 * MAX_FILES:
            raise ValueError("Application archive exceeds bounded raw header count")
        # This decodes only one fixed header; fromtarfile/next would preconsume
        # arbitrary PAX/GNU bodies before exposing a regular member to callers.
        member = tarfile.TarInfo.frombuf(header, "ascii", "strict")
        if member.type == tarfile.XHDTYPE:
            if pending_path or member.name != "././@PaxHeader" or not 0 < member.size <= MAX_PAX_BYTES:
                raise ValueError("Chained, non-producer or oversized application PAX extension")
            pending_path = producer_pax_path(read_exact(read, member.size))
        elif member.type in {tarfile.REGTYPE, tarfile.AREGTYPE}:
            if pending_path:
                if member.name != pending_path[: tarfile.LENGTH_NAME]:
                    raise ValueError("Application PAX path differs from its producer member")
                member.name, pending_path = pending_path, None
            yield member, read
        else:
            # Includes global PAX, GNU long-name/link and sparse extensions.
            # Reject the type before reading even one byte of its declared body.
            raise ValueError("Application tar accepts only regular files and producer path extensions")
        if any(read_exact(read, -member.size % tarfile.BLOCKSIZE)):
            raise ValueError("Nonzero application tar member padding")


@contextmanager
def closed_tar(path):
    """Bound expanded transport before metadata intake; read through gzip CRC/EOF."""
    # A regular file has at most one PAX path header/body, two fixed headers,
    # and block padding. This ceiling counts those bytes, not just file content.
    maximum = MAX_TOTAL + MAX_FILES * (MAX_PAX_BYTES + 3 * tarfile.BLOCKSIZE) + tarfile.RECORDSIZE
    expanded = 0
    try:
        with gzip.open(path, "rb") as compressed:

            def read(size):
                nonlocal expanded
                data = compressed.read(min(size, maximum - expanded + 1))
                expanded += len(data)
                if expanded > maximum:
                    raise ValueError("Application archive exceeds bounded expanded transport")
                return data

            yield regular_tar_members(read)
    except (gzip.BadGzipFile, EOFError, tarfile.TarError) as error:
        raise ValueError("Malformed or truncated application archive") from error


def inspect_archive(path, *, destination=None):
    """Stream bounded regular members; optionally copy only safe paths to staging."""
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_ARCHIVE:
        raise ValueError("Invalid or oversized application archive")
    files, texts, total, text_total = {}, {}, 0, 0
    with closed_tar(path) as tar:
        for member, stream_read in tar:
            prefix = APP + "/"
            if (
                not member.name.startswith(prefix)
                or member.type not in {tarfile.REGTYPE, tarfile.AREGTYPE}
                or set(member.pax_headers) - {"path"}
            ):
                raise ValueError("Application archive accepts only plain regular members")
            name = safe_path(member.name[len(prefix) :])
            if name in files or len(files) >= MAX_FILES or not positive_int(member.size, MAX_FILE):
                raise ValueError("Duplicate, excessive or oversized application member")
            total += member.size
            if total > MAX_TOTAL or (name == "app-manifest.json" and member.size > MAX_MANIFEST):
                raise ValueError("Application archive exceeds bounded inventory")
            digest, length = hashlib.sha256(), 0
            content = bytearray() if Path(name).suffix in TEXT_SUFFIXES else None
            if content is not None:
                text_total += member.size
                if member.size > MAX_TEXT or text_total > MAX_TEXT_TOTAL:
                    raise ValueError("Application text exceeds bounded verifier memory")
            out = None
            if destination:
                target = destination / name
                target.parent.mkdir(parents=True, exist_ok=True)
                out = target.open("xb")
            try:
                while length < member.size:
                    chunk = stream_read(min(1024 * 1024, member.size - length))
                    if not chunk:
                        raise ValueError("Truncated application member")
                    length += len(chunk)
                    if length > member.size:
                        raise ValueError("Application member grew beyond declared size")
                    digest.update(chunk)
                    if content is not None:
                        content.extend(chunk)
                    if out:
                        out.write(chunk)
            finally:
                if out:
                    out.close()
            if length != member.size:
                raise ValueError("Truncated application member")
            files[name] = {"sha256": digest.hexdigest(), "size": length}
            if content is not None:
                texts[name] = bytes(content)
    return files, texts


def verify_application(path, source, version, contracts, *, source_tree=None):
    """Verify before selection, including immutable URL identity and backend bounds."""
    return verified_application_inventory(path, source, version, contracts, source_tree=source_tree)[0]


def verified_application_inventory(path, source, version, contracts, *, source_tree=None):
    """Verify the archive; return its manifest and the member digests that were verified."""
    files, texts = inspect_archive(path)
    payload = texts.get("app-manifest.json", b"")
    app = read_json(payload)
    closed(
        app,
        {
            "schema_version",
            "source_commit",
            "app_version",
            "entry_document",
            "backend_contracts",
            "files",
            "lazy_resources",
            "notices",
            "catalog_seed",
        },
        "application manifest",
    )
    if (
        type(app["schema_version"]) is not int
        or app["schema_version"] != 1
        or payload != canonical(app)
        or not matches(HEX40, app["source_commit"])
        or app["source_commit"] != source
        or not matches(SEMVER, app["app_version"])
        or app["app_version"] != version
        or app["entry_document"] != "index.html"
    ):
        raise ValueError("Application version/source/entry mismatch")
    from catalog_seed import verify_catalog_seed

    seed_paths, _ = verify_catalog_seed(app["catalog_seed"], files, texts, source, source_tree)
    baseline_paths = [name for name in texts if name.endswith("/resource-manifests/browser-runtime.json")]
    if len(baseline_paths) != 1:
        raise ValueError("Missing exact baseline browser runtime inventory")
    baseline = read_json(texts[baseline_paths[0]])
    if (
        not isinstance(baseline, dict)
        or type(baseline.get("schema_version")) is not int
        or baseline.get("schema_version") != 1
        or not isinstance(baseline.get("files"), list)
        or len(baseline["files"]) != 21
    ):
        raise ValueError("Invalid baseline browser runtime inventory")
    closed(app["backend_contracts"], {"runtime-owner", "local-http"}, "backend contracts")
    for contract in contracts:
        bounds = app["backend_contracts"][contract["name"]]
        closed(bounds, {"min_major", "max_major_exclusive"}, "backend major bounds")
        lower, upper = bounds["min_major"], bounds["max_major_exclusive"]
        major = int(contract["version"].split(".")[0])
        if not positive_int(lower, 10000) or not positive_int(upper, 10000) or not lower <= major < upper:
            raise ValueError("Application/backend contract incompatibility")
    if not isinstance(app["files"], list) or not 1 <= len(app["files"]) < MAX_FILES:
        raise ValueError("Invalid application file inventory")
    inventory, template, prefixes = {}, {}, set()
    for entry in app["files"]:
        closed(entry, {"path", "sha256", "size", "mime_type", "cache", "range"}, "application file")
        name = safe_path(entry["path"])
        if name in inventory or name == "app-manifest.json" or entry["mime_type"] != mime(name):
            raise ValueError("Duplicate file, manifest self-reference or incorrect MIME")
        if (
            not positive_int(entry["size"], MAX_FILE)
            or not matches(HEX64, entry["sha256"])
            or type(entry["range"]) is not bool
            or entry["cache"] not in ("revalidate", "immutable")
        ):
            raise ValueError("Invalid file hash/size/range/cache")
        if files.get(name) != {"sha256": entry["sha256"], "size": entry["size"]}:
            raise ValueError(f"Application file integrity mismatch: {name}")
        if name == "index.html":
            if entry["cache"] != "revalidate" or entry["range"]:
                raise ValueError("Entry HTML must revalidate without byte ranges")
            relative = name
        else:
            match = re.fullmatch(r"_animama/static/([a-f0-9]{64})/(.+)", name)
            if not match or entry["cache"] != "immutable":
                raise ValueError("Static files require a digest-bound immutable URL")
            prefixes.add(match[1])
            relative = match[2]
        inventory[name] = entry
        template[relative] = files[name]
    if (
        set(files) != set(inventory) | seed_paths | {"app-manifest.json"}
        or "index.html" not in inventory
        or len(prefixes) != 1
    ):
        raise ValueError("Archive and application inventories differ")
    prefix = "/_animama/static/" + next(iter(prefixes)) + "/"
    runtime_paths = set()
    for asset in baseline["files"]:
        if not isinstance(asset, dict) or not {"path", "sha256", "size"} <= asset.keys():
            raise ValueError("Invalid baseline browser runtime file")
        relative = safe_path(asset["path"])
        name = prefix[1:] + "onnx/" + relative
        if (
            relative in runtime_paths
            or name not in inventory
            or inventory[name]["sha256"] != asset["sha256"]
            or inventory[name]["size"] != asset["size"]
        ):
            raise ValueError("Missing or substituted baseline browser runtime file")
        runtime_paths.add(relative)
    for name, data in texts.items():
        if name == "app-manifest.json" or name in seed_paths:
            continue
        if TEMPLATE_BASE.encode() in data:
            raise ValueError("Unresolved build template URL")
        relative = name.removeprefix(prefix[1:])
        normalized = data.replace(prefix.encode(), TEMPLATE_BASE.encode())
        template[relative] = {"sha256": sha(normalized), "size": len(normalized)}
    if sha(canonical(template)) != next(iter(prefixes)):
        raise ValueError("Immutable resource prefix does not bind emitted template bytes")
    if (
        not isinstance(app["notices"], list)
        or not app["notices"]
        or any(not isinstance(name, str) for name in app["notices"])
        or len(set(app["notices"])) != len(app["notices"])
        or any(name not in inventory or "/notices/" not in name for name in app["notices"])
    ):
        raise ValueError("Missing or invalid application notices")
    if not isinstance(app["lazy_resources"], list) or len(app["lazy_resources"]) > 16:
        raise ValueError("Invalid lazy resource inventory")
    ids = set()
    for resource in app["lazy_resources"]:
        closed(resource, {"id", "version", "manifest", "manifest_sha256", "route_prefix", "notices"}, "lazy resource")
        identifier, digest = resource["id"], resource["manifest_sha256"]
        if (
            not isinstance(identifier, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,79}", identifier)
            or identifier in ids
            or not matches(HEX64, digest)
            or resource["version"] != "sha256-" + digest
            or resource["route_prefix"] != f"/_animama/models/{identifier}/{digest}/"
            or not isinstance(resource["manifest"], str)
            or resource["manifest"] not in inventory
            or inventory[resource["manifest"]]["sha256"] != digest
            or not isinstance(resource["notices"], list)
            or not resource["notices"]
            or any(not isinstance(name, str) for name in resource["notices"])
            or not set(resource["notices"]) <= set(app["notices"])
        ):
            raise ValueError("Invalid or unbound lazy resource descriptor")
        ids.add(identifier)
        model = read_json(texts[resource["manifest"]])
        names = set()
        if (
            not isinstance(model, dict)
            or not isinstance(model.get("files"), list)
            or not 1 <= len(model["files"]) <= MAX_FILES
        ):
            raise ValueError("Invalid lazy model inventory")
        for entry in model["files"]:
            if not isinstance(entry, dict) or not {"path", "size", "sha256"} <= entry.keys():
                raise ValueError("Invalid lazy model file")
            name = safe_path(entry["path"])
            if name in names or not positive_int(entry["size"], MAX_TOTAL) or not matches(HEX64, entry["sha256"]):
                raise ValueError("Unsafe lazy model file inventory")
            names.add(name)
    return app, files


def unpack_application(path, destination, source, version, contracts, *, archive_sha256=None, source_tree=None):
    """All checks precede atomic installation into a new selection directory."""
    before = file_sha(path)
    if archive_sha256 is not None and before != archive_sha256:
        raise ValueError("Application archive differs from selected package-set digest")
    app, verified = verified_application_inventory(path, source, version, contracts, source_tree=source_tree)
    if destination.exists():
        raise ValueError("Application destination must be new")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="app-verified-", dir=destination.parent) as temp:
        stage = Path(temp) / "application"
        stage.mkdir()
        extracted, _ = inspect_archive(path, destination=stage)
        # Bind the installed bytes to the verified pass itself: an archive that
        # changes and changes back between the two reads keeps its file digest.
        if extracted != verified or file_sha(path) != before:
            raise ValueError("Application archive changed during installation")
        shutil.move(stage, destination)
    return app


def resource_prefix(app):
    """Return the one digest-bound static prefix of a verified application manifest."""
    prefixes = {
        match[1]
        for entry in app["files"]
        if (match := re.fullmatch(r"(_animama/static/[a-f0-9]{64}/).+", entry["path"]))
    }
    if len(prefixes) != 1:
        raise ValueError("Application requires exactly one digest-bound resource prefix")
    return prefixes.pop()


def require_distinct_resources(previous, current):
    """Reject an upgrade pair whose applications emit the same resource generation.

    Byte-identical emitted applications share every immutable URL, so selecting
    one after the other exercises no upgrade, old-tab worker or rollback.
    """
    if resource_prefix(previous) == resource_prefix(current):
        raise ValueError(
            "Actual upgrade/rollback requires distinct application resources, but both sets emit "
            f"/{resource_prefix(current)}; validate without --previous-app-set to use the controlled fixture"
        )
