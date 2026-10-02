from __future__ import annotations

import ipaddress
import json
import os
import re
import stat
import uuid
from dataclasses import dataclass
from pathlib import Path

from animama.domain.content_sources import IncludedContentSource
from animama.server.config import Settings
from animama.utils.files import is_link, path_is_link

CONTENT_TYPE_DIRECTORIES: tuple[str, ...] = (
    "avatars",
    "gestures",
    "pose-clips",
    "reactions",
    "vfx/particle",
    "vfx/avatar",
    "vfx/scene",
    "sfx",
    "idle-styles",
    "music",
    "appearances",
    "voices",
    "animas",
)


class LocalRuntimeConfigurationError(RuntimeError):
    """Raised when a self-hosted storage or exposure invariant is unsafe."""


@dataclass(frozen=True, slots=True)
class LocalRuntimePaths:
    """Resolved local content and private-data directories used by services."""

    content_root: Path
    included_root: Path
    local_root: Path
    included_type_roots: tuple[Path, ...]
    local_type_roots: tuple[Path, ...]
    included_licenses_root: Path
    data_root: Path
    user_files_root: Path
    data_staging_root: Path
    uploads_staging_root: Path
    imports_staging_root: Path
    exports_staging_root: Path
    data_internal_root: Path
    operations_root: Path
    runtime_root: Path
    derivatives_root: Path
    reconciliation_root: Path
    included_sources: tuple[IncludedContentSource, ...] = ()


def is_loopback_host(host: str) -> bool:
    """Return whether a publish host is explicitly limited to loopback."""

    normalized = host.strip().lower()
    if normalized.startswith("[") and normalized.endswith("]"):
        normalized = normalized[1:-1]
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def validate_local_bindings(settings: Settings) -> None:
    """Reject a non-loopback bind for the supported native FastAPI launcher."""

    if not is_loopback_host(settings.animama_local_bind_host):
        raise LocalRuntimeConfigurationError(
            "ANIMAMA_LOCAL_BIND_HOST must stay on loopback; "
            "use an operator-owned TLS and authentication boundary for remote access"
        )


def resolve_local_runtime_paths(settings: Settings) -> LocalRuntimePaths:
    """Build the fixed directory contract beneath the two configured roots."""

    content_root = settings.animama_content_root.resolve(strict=False)
    data_root = settings.animama_data_root.resolve(strict=False)
    local_root = (settings.animama_local_content_root or content_root / "local").resolve(strict=False)
    if local_root == data_root or local_root in data_root.parents or data_root in local_root.parents:
        raise LocalRuntimeConfigurationError("Local content and private data roots must be disjoint")
    sources = _included_sources(settings, local_root=local_root, data_root=data_root)
    included_root = sources[0].root if sources else content_root / "included"
    data_staging_root = data_root / "staging"
    data_internal_root = data_root / "internal"
    return LocalRuntimePaths(
        content_root=content_root,
        included_root=included_root,
        local_root=local_root,
        included_type_roots=tuple(included_root / relative for relative in CONTENT_TYPE_DIRECTORIES),
        local_type_roots=tuple(local_root / relative for relative in CONTENT_TYPE_DIRECTORIES),
        included_licenses_root=included_root / "licenses",
        data_root=data_root,
        user_files_root=data_root / "user-files",
        data_staging_root=data_staging_root,
        uploads_staging_root=data_staging_root / "uploads",
        imports_staging_root=data_staging_root / "imports",
        exports_staging_root=data_staging_root / "exports",
        data_internal_root=data_internal_root,
        operations_root=data_internal_root / "operations",
        runtime_root=data_internal_root / "runtime",
        derivatives_root=data_internal_root / "derivatives",
        reconciliation_root=data_internal_root / "reconciliation",
        included_sources=sources,
    )


def _included_sources(settings: Settings, *, local_root: Path, data_root: Path) -> tuple[IncludedContentSource, ...]:
    """Validate trusted mount configuration before any directory is created."""

    raw = settings.animama_included_content_sources_json
    if raw is None:
        if settings.animama_local_content_root is not None:
            raise LocalRuntimeConfigurationError("Desktop Local root requires an Included source list")
        return ()
    if len(raw) > 32768:
        raise LocalRuntimeConfigurationError("Included source configuration is too large")
    try:
        entries = json.loads(raw)
        if not isinstance(entries, list) or not 1 <= len(entries) <= 8:
            raise ValueError("Expected a bounded Included source list")
        sources: list[IncludedContentSource] = []
        names: set[str] = set()
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) - {"id", "version", "root", "pack_id"}:
                raise ValueError("Unexpected Included source fields")
            identifier, version = entry["id"], entry["version"]
            if not all(
                isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9._-]{1,100}", value)
                for value in (identifier, version)
            ):
                raise ValueError("Invalid Included source identity")
            if identifier in names or (identifier == "core") != (len(sources) == 0):
                raise ValueError("Included sources require one leading core and unique IDs")
            names.add(identifier)
            root = Path(entry["root"])
            if not root.is_absolute() or path_is_link(root):
                raise ValueError("Included source must be an absolute, non-symlink directory")
            resolved = root.resolve(strict=True)
            if resolved != root or not root.is_dir():
                raise ValueError("Included source has a symlinked or missing parent")
            for other in (local_root, data_root, *(source.root for source in sources)):
                if root == other or root in other.parents or other in root.parents:
                    raise ValueError("Included, Local, and private roots must not overlap")
            pack_id = entry.get("pack_id")
            if (identifier == "core" and pack_id is not None) or (
                identifier != "core" and pack_id != "expanded-included-content"
            ):
                raise ValueError("Unknown Included pack identity")
            sources.append(IncludedContentSource(identifier, version, root, pack_id))
        return tuple(sources)
    except (KeyError, TypeError, ValueError, OSError) as exc:
        raise LocalRuntimeConfigurationError("Invalid immutable Included source configuration") from exc


def _assert_directory(path: Path, *, label: str) -> None:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise LocalRuntimeConfigurationError(f"{label} is unavailable: {path}") from exc
    if is_link(metadata) or not stat.S_ISDIR(metadata.st_mode):
        raise LocalRuntimeConfigurationError(f"{label} must be a real directory, not a symlink: {path}")


def _assert_writable(path: Path, *, label: str) -> None:
    probe = path / f".animama-write-probe-{os.getpid()}-{uuid.uuid4().hex}"
    try:
        with probe.open("x", encoding="utf-8") as handle:
            handle.write("ok")
        probe.unlink()
    except OSError as exc:
        try:
            probe.unlink(missing_ok=True)
        except OSError:
            pass
        raise LocalRuntimeConfigurationError(f"{label} is not writable: {path}") from exc


def initialize_local_runtime(settings: Settings) -> LocalRuntimePaths:
    """Create writable skeletons and verify roots before application startup."""

    validate_local_bindings(settings)
    paths = resolve_local_runtime_paths(settings)

    if not paths.included_sources:
        paths.content_root.mkdir(parents=True, exist_ok=True)
        paths.included_root.mkdir(parents=True, exist_ok=True)
    managed_paths = (
        paths.local_root,
        *(paths.included_type_roots if not paths.included_sources else ()),
        *((paths.included_licenses_root,) if not paths.included_sources else ()),
        *paths.local_type_roots,
        paths.data_root,
        paths.user_files_root,
        paths.data_staging_root,
        paths.uploads_staging_root,
        paths.imports_staging_root,
        paths.exports_staging_root,
        paths.data_internal_root,
        paths.operations_root,
        paths.runtime_root,
        paths.derivatives_root,
        paths.reconciliation_root,
    )
    for path in managed_paths:
        path.mkdir(parents=True, exist_ok=True)

    required_directories = (
        *((("content root", paths.content_root),) if not paths.included_sources else ()),
        ("Included content root", paths.included_root),
        ("Local content root", paths.local_root),
        *(
            (f"Included type root {path.relative_to(paths.included_root)}", path)
            for path in paths.included_type_roots
            if not paths.included_sources
        ),
        ("Included licenses root", paths.included_licenses_root),
        *((f"Local type root {path.relative_to(paths.local_root)}", path) for path in paths.local_type_roots),
        ("private data root", paths.data_root),
        ("private user-files root", paths.user_files_root),
        ("private data staging root", paths.data_staging_root),
        ("private uploads staging root", paths.uploads_staging_root),
        ("private imports staging root", paths.imports_staging_root),
        ("private exports staging root", paths.exports_staging_root),
        ("private internal root", paths.data_internal_root),
        ("private operations root", paths.operations_root),
        ("private runtime root", paths.runtime_root),
        ("private derivatives root", paths.derivatives_root),
        ("private reconciliation root", paths.reconciliation_root),
    )
    for label, path in required_directories:
        _assert_directory(path, label=label)

    for source in paths.included_sources:
        _assert_directory(source.root, label="immutable Included source")
        if not os.access(source.root, os.R_OK | os.X_OK):
            raise LocalRuntimeConfigurationError("Immutable Included source is not readable")

    if not os.access(paths.included_root, os.R_OK | os.X_OK):
        raise LocalRuntimeConfigurationError(f"Included content root is not readable: {paths.included_root}")

    _assert_writable(paths.local_root, label="Local content root")
    _assert_writable(paths.data_root, label="private data root")
    return paths
