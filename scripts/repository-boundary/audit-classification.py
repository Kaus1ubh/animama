#!/usr/bin/env python3
"""Check explicit source ownership and per-file provenance against the Git index.

This is a read-only inventory audit, not an exporter or publication
approval. Python 3.11+ and Git are required; Git LFS itself is not required.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import stat
import subprocess
import sys
import tomllib
from collections import Counter
from pathlib import Path, PurePosixPath

OWNERS = {"public", "cloud", "archive", "excluded-generated"}
PUBLICATION_STATUSES = {"review-pending", "blocked", "approved"}
LFS_HEADER = b"version https://git-lfs.github.com/spec/v1\n"
# Broad coverage selects records for individual review; it never assigns rights
# or repository ownership. Extend this list when introducing another vendor tree.
PROVENANCE_PREFIXES = (
    "content/",
    "src/frontend/web/public/",
    "parakeet-tdt-0.6b-v2/",
    ".agents/skills/",
    "observability/",
    "src/backend/animama/examples/",
    "src/frontend/web/src/lib/speech/pocket/core/",
    "src/frontend/web/src/lib/speech/pocket/audio/",
)
PROVENANCE_PATHS = {"src/frontend/web/src/lib/speech/pocket/index.js"}
PROVENANCE_SUFFIXES = (
    ".onnx", ".wasm", ".bin", ".model", ".vrm", ".vrma", ".glb", ".gltf",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".icns",
    ".mp3", ".wav", ".ogg", ".mp4", ".webm", ".woff", ".woff2", ".ttf", ".otf",
    ".tga", ".unitypackage", ".ani", ".cur", ".npy", ".npz", ".safetensors",
    ".fbx", ".blend", ".zip", ".tar", ".gz", ".7z",
)


def command(root: Path, *args: str, data: bytes | None = None) -> bytes:
    """Run Git without shell expansion, preserving NUL-delimited filenames."""
    result = subprocess.run(["git", *args], cwd=root, input=data, capture_output=True, check=False)
    if result.returncode:
        raise ValueError(f"git {' '.join(args)} failed: {os.fsdecode(result.stderr).strip()}")
    return result.stdout


def valid_path(path: object) -> bool:
    """Require an exact canonical repository-relative path, not a pattern."""
    return (
        isinstance(path, str)
        and bool(path)
        and "\0" not in path
        and "\\" not in path
        and not PurePosixPath(path).is_absolute()
        and str(PurePosixPath(path)) == path
        and all(part not in {".", "..", ".git"} for part in path.split("/"))
    )


def nul_paths(data: bytes) -> list[str]:
    """Reject truncated or ambiguous input rather than treating lines as paths."""
    if data and not data.endswith(b"\0"):
        raise ValueError("Path input must be NUL-terminated (use git ls-files -z)")
    paths = [os.fsdecode(item) for item in data.split(b"\0")[:-1]] if data else []
    if len(paths) != len(set(paths)):
        raise ValueError("Duplicate tracked path in input")
    if any(not valid_path(path) for path in paths):
        raise ValueError("Invalid repository-relative path in input")
    return paths


def index_entries(root: Path) -> dict[str, dict[str, str]]:
    """Enumerate every tracked entry, including files matching ignore rules."""
    entries = {}
    for item in command(root, "ls-files", "--stage", "-z").split(b"\0"):
        if not item:
            continue
        metadata, encoded_path = item.split(b"\t", 1)
        mode, oid, stage = metadata.decode("ascii").split()
        path = os.fsdecode(encoded_path)
        if stage != "0" or path in entries:
            raise ValueError(f"Resolve index conflicts before auditing: {path!r}")
        if not valid_path(path):
            raise ValueError(f"Invalid tracked path: {path!r}")
        entries[path] = {"mode": mode, "oid": oid}
    return entries


def commit_entries(root: Path, revision: str) -> dict[str, str]:
    """Read immutable baseline blob identities without decoding filenames as lines."""
    result = {}
    for item in command(root, "ls-tree", "-r", "-z", revision).split(b"\0"):
        if item:
            metadata, path = item.split(b"\t", 1)
            result[os.fsdecode(path)] = metadata.split()[2].decode("ascii")
    return result


def lfs_pointers(root: Path, entries: dict) -> dict[str, dict]:
    """Read index pointers, including ones outside current LFS attributes.

Git's index stores pointers even when working-tree content is hydrated. Batch
object reads avoid loading large non-LFS assets or spawning Git per file.
"""
    oids = sorted({entry["oid"] for entry in entries.values() if entry["mode"] != "160000"})
    if not oids:
        return {}
    sizes = command(root, "cat-file", "--batch-check", data="".join(oid + "\n" for oid in oids).encode())
    small = []
    for line in sizes.splitlines():
        oid, kind, size = line.decode("ascii").split()
        if kind == "blob" and int(size) <= 1024:
            small.append(oid)
    stream = io.BytesIO(command(root, "cat-file", "--batch", data="".join(oid + "\n" for oid in small).encode()))
    pointers = {}
    for _ in small:
        oid, kind, size = stream.readline().decode("ascii").split()
        payload = stream.read(int(size))
        stream.read(1)
        if not payload.startswith(LFS_HEADER):
            continue
        object_ids = re.findall(rb"^oid sha256:([0-9a-f]{64})$", payload, re.MULTILINE)
        byte_sizes = re.findall(rb"^size ([0-9]+)$", payload, re.MULTILINE)
        if len(object_ids) != 1 or len(byte_sizes) != 1:
            raise ValueError(f"Malformed LFS pointer in Git blob {oid}")
        pointers[oid] = {"oid": object_ids[0].decode("ascii"), "size": int(byte_sizes[0])}
    result = {path: pointers[entry["oid"]] for path, entry in entries.items() if entry["oid"] in pointers}
    paths = b"".join(os.fsencode(path) + b"\0" for path in entries)
    attributes = command(root, "check-attr", "--cached", "-z", "--stdin", "filter", data=paths).split(b"\0")
    for position in range(0, len(attributes) - 1, 3):
        path, _attribute, value = attributes[position:position + 3]
        if value == b"lfs" and os.fsdecode(path) not in result:
            raise ValueError(f"Tracked LFS path lacks a valid index pointer: {os.fsdecode(path)!r}")
    return result


def required_provenance_paths(paths, lfs_paths) -> set[str]:
    """Select all assets, known vendor inputs and every LFS path for review."""
    return set(lfs_paths) | {
        path for path in paths
        if path.startswith(PROVENANCE_PREFIXES)
        or path.lower().endswith(PROVENANCE_SUFFIXES)
        or path in PROVENANCE_PATHS
    }


def digest(path: Path) -> str:
    """Hash materialized payloads without loading models into memory."""
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def blob_digest(path: Path, oid: str) -> str:
    """Bind non-LFS materialized bytes to the recorded Git blob as well as SHA-256."""
    blob = hashlib.new("sha1" if len(oid) == 40 else "sha256")
    blob.update(f"blob {path.stat().st_size}\0".encode())
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            blob.update(block)
    return blob.hexdigest()


def ownership(manifest: dict, paths: set[str], errors: list[str]) -> dict[str, str]:
    """Reject gaps, overlaps and stale decisions; there is no default owner."""
    assignments = {}
    group_ids = set()
    groups = manifest.get("groups")
    if not isinstance(groups, list) or not groups:
        errors.append("Manifest groups must be a nonempty array")
        return assignments
    for group in groups:
        if not isinstance(group, dict):
            errors.append("Every ownership group must be a table")
            continue
        group_id, owner = group.get("id"), group.get("owner")
        if not isinstance(group_id, str) or not group_id or group_id in group_ids:
            errors.append(f"Missing or duplicate ownership group id: {group_id!r}")
        else:
            group_ids.add(group_id)
        if owner not in OWNERS:
            errors.append(f"Invalid owner in group {group_id!r}: {owner!r}")
        if not isinstance(group.get("rationale"), str) or not group["rationale"].strip():
            errors.append(f"Group {group_id!r} needs an ownership rationale")
        group_paths = group.get("paths")
        if not isinstance(group_paths, list) or not group_paths:
            errors.append(f"Group {group_id!r} needs nonempty exact paths")
            continue
        for path in group_paths:
            if not valid_path(path):
                errors.append(f"Invalid manifest path in group {group_id!r}: {path!r}")
                continue
            if path in assignments:
                errors.append(f"Overlapping classification: {path!r}")
            assignments[path] = owner
            if path not in paths:
                errors.append(f"Stale classification (not tracked): {path!r}")
    for path in sorted(paths - assignments.keys()):
        errors.append(f"Missing classification: {path!r}")
    # Full execution plans are private planning inputs even when they describe
    # public/local code. Keep this explicit user policy independent of groups.
    for path, owner in sorted(assignments.items()):
        if (path == "PLANS.md" or "plans" in PurePosixPath(path).parts[:-1]) and owner != "cloud":
            errors.append(f"Private planning document must be cloud-owned: {path!r}")
    return assignments


def check_provenance(
    root: Path, provenance: dict, entries: dict, lfs: dict, errors: list[str], *, exported_snapshot: bool = False
) -> int:
    """Check record coverage, evidence references and actual payload identity."""
    if provenance.get("schema_version") != 1:
        errors.append("Provenance schema_version must be 1")
    source_commit = provenance.get("source_commit")
    if not isinstance(source_commit, str) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", source_commit):
        errors.append("Provenance source_commit must be a full Git commit object ID")
        source_entries = {}
    elif exported_snapshot:
        # A clean root deliberately has no monorepo history. Its projected
        # records still bind every current index blob and materialized payload.
        source_entries = None
    else:
        source_entries = commit_entries(root, source_commit)
    evidence_ids = set()
    evidence = provenance.get("evidence")
    if not isinstance(evidence, list):
        errors.append("Provenance evidence must be an array")
        evidence = []
    for item in evidence:
        if not isinstance(item, dict):
            errors.append("Every provenance evidence entry must be an object")
            continue
        evidence_id = item.get("id")
        if not isinstance(evidence_id, str) or not evidence_id or evidence_id in evidence_ids:
            errors.append(f"Missing or duplicate evidence id: {evidence_id!r}")
        else:
            evidence_ids.add(evidence_id)
        for field in ("source", "revision", "license", "unresolved_decision"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                errors.append(f"Evidence {evidence_id!r} requires {field} (use explicit UNKNOWN where needed)")
        notices = item.get("required_notices")
        if not isinstance(notices, list) or any(not isinstance(notice, str) for notice in notices):
            errors.append(f"Evidence {evidence_id!r} requires a required_notices array")
        evidence_hashes = item.get("path_sha256")
        if not isinstance(evidence_hashes, dict) or not evidence_hashes:
            errors.append(f"Evidence {evidence_id!r} needs path_sha256 for its tracked evidence inputs")
            continue
        for path, expected_hash in evidence_hashes.items():
            if not valid_path(path) or path not in entries:
                errors.append(f"Evidence {evidence_id!r} references an invalid or untracked path: {path!r}")
                continue
            if source_entries is not None and source_entries.get(path) != entries[path]["oid"]:
                errors.append(f"Provenance evidence index differs from source commit: {path!r}")
            try:
                source = root / path
                if not stat.S_ISREG(source.lstat().st_mode):
                    errors.append(f"Provenance evidence is not a regular materialized file: {path!r}")
                    continue
                actual_sha = digest(source)
                if actual_sha != expected_hash:
                    errors.append(f"Stale provenance evidence hash: {path!r}")
                if path in lfs:
                    if actual_sha != lfs[path]["oid"] or source.stat().st_size != lfs[path]["size"]:
                        errors.append(f"Provenance evidence LFS payload differs from index pointer: {path!r}")
                elif blob_digest(source, entries[path]["oid"]) != entries[path]["oid"]:
                    errors.append(f"Provenance evidence bytes differ from index blob: {path!r}")
            except OSError as error:
                errors.append(f"Cannot read provenance evidence {path!r}: {error.strerror}")
    files = provenance.get("files")
    if not isinstance(files, list):
        errors.append("Provenance files must be an array")
        return 0
    seen = set()
    for record in files:
        if not isinstance(record, dict) or not valid_path(record.get("path")):
            errors.append("Every provenance record needs an exact repository-relative path")
            continue
        path = record["path"]
        if path in seen:
            errors.append(f"Duplicate provenance record: {path!r}")
        seen.add(path)
        if path not in entries:
            errors.append(f"Stale provenance record (not tracked): {path!r}")
            continue
        if record.get("publication_status") not in PUBLICATION_STATUSES:
            errors.append(f"Invalid publication_status: {path!r}")
        references = record.get("evidence_ids")
        if not isinstance(references, list) or not references or any(
            not isinstance(item, str) or item not in evidence_ids for item in references
        ):
            errors.append(f"Missing or unknown provenance evidence: {path!r}")
        if record.get("git_blob_oid") != entries[path]["oid"]:
            errors.append(f"Stale provenance Git blob: {path!r}")
        if source_entries is not None and source_entries.get(path) != entries[path]["oid"]:
            errors.append(f"Provenance asset index differs from source commit: {path!r}")
        pointer = lfs.get(path)
        if pointer:
            if record.get("lfs_oid") != pointer["oid"] or record.get("lfs_size") != pointer["size"]:
                errors.append(f"Stale provenance LFS identity: {path!r}")
        elif "lfs_oid" in record or "lfs_size" in record:
            errors.append(f"Unexpected LFS identity on non-LFS path: {path!r}")
        source = root / path
        try:
            info = source.lstat()
            if not stat.S_ISREG(info.st_mode) or entries[path]["mode"] not in {"100644", "100755"}:
                errors.append(f"Provenance input is not a regular materialized file: {path!r}")
                continue
            with source.open("rb") as stream:
                is_pointer = stream.read(len(LFS_HEADER)) == LFS_HEADER
            if is_pointer:
                errors.append(f"LFS payload not materialized: {path!r}")
                continue
            actual_sha = digest(source)
            if record.get("sha256") != actual_sha:
                errors.append(f"Stale provenance SHA-256: {path!r}")
            if pointer and (actual_sha != pointer["oid"] or info.st_size != pointer["size"]):
                errors.append(f"Materialized LFS payload differs from index pointer: {path!r}")
            if not pointer and blob_digest(source, entries[path]["oid"]) != entries[path]["oid"]:
                errors.append(f"Materialized non-LFS payload differs from index blob: {path!r}")
        except OSError as error:
            errors.append(f"Cannot read provenance payload {path!r}: {error.strerror}")
    for path in sorted(required_provenance_paths(entries, lfs) - seen):
        errors.append(f"Missing provenance record: {path!r}")
    return len(seen)


def audit(root: Path, manifest_path: Path, input_paths: list[str] | None = None) -> dict:
    """Return deterministic audit evidence or fail with actionable discrepancies."""
    root = root.resolve()
    entries = index_entries(root)
    paths = set(entries)
    errors = []
    if input_paths is not None and (len(input_paths) != len(paths) or set(input_paths) != paths):
        errors.append("--stdin paths must equal the complete Git index; subsets cannot pass the audit")
    with manifest_path.open("rb") as stream:
        manifest = tomllib.load(stream)
    if manifest.get("schema_version") != 1:
        errors.append("Manifest schema_version must be 1")
    mode = manifest.get("mode", "source")
    if mode not in {"source", "exported-snapshot"}:
        errors.append("Unknown classification manifest mode")
    exported_snapshot = mode == "exported-snapshot"
    source_commit = manifest.get("source_commit")
    if not isinstance(source_commit, str) or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", source_commit):
        errors.append("Manifest source_commit must be a full Git commit object ID")
    elif not exported_snapshot:
        command(root, "cat-file", "-e", source_commit + "^{commit}")
    assignments = ownership(manifest, paths, errors)
    if exported_snapshot and set(assignments.values()) != {"public"}:
        errors.append("An exported public snapshot may contain only public ownership groups")
    for path in sorted(paths):
        if not (root / path).exists() and not (root / path).is_symlink():
            errors.append(f"Tracked input absent from working tree: {path!r}")
    lfs = lfs_pointers(root, entries)
    provenance_path = manifest.get("provenance_manifest")
    if not valid_path(provenance_path):
        errors.append("Manifest provenance_manifest must be a repository-relative path")
        provenance_count = 0
    else:
        provenance = json.loads((root / provenance_path).read_text())
        if not isinstance(provenance, dict):
            raise ValueError("Provenance manifest must be a JSON object")
        if provenance.get("source_commit") != source_commit:
            errors.append("Provenance source_commit does not match classification manifest")
        if provenance.get("mode", "source") != mode:
            errors.append("Provenance mode does not match classification manifest")
        if exported_snapshot:
            for field in ("snapshot_id", "source_manifest_sha256"):
                value = manifest.get(field)
                if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
                    errors.append(f"Exported snapshot requires a valid {field}")
                if provenance.get(field) != value:
                    errors.append(f"Provenance {field} does not match classification manifest")
        provenance_count = check_provenance(
            root, provenance, entries, lfs, errors, exported_snapshot=exported_snapshot
        )
    if index_entries(root) != entries:
        errors.append("Git index changed during audit; retry from a stable snapshot")
    if errors:
        raise ValueError("\n".join(errors))
    return {
        "source_commit": source_commit,
        "tracked_paths": len(paths),
        "owners": dict(sorted(Counter(assignments.values()).items())),
        "provenance_files": provenance_count,
        "lfs_paths": len(lfs),
        "lfs_objects": len({pointer["oid"] for pointer in lfs.values()}),
        "publication_approval": False,
    }


def main() -> int:
    """Run the same strict validation with or without a piped Git path list."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--manifest", type=Path, default=Path("repository-boundary.toml"))
    parser.add_argument("--stdin", action="store_true", help="Read the complete git ls-files -z output")
    parser.add_argument("--check", action="store_true", help="Validate only (also the default; never writes files)")
    args = parser.parse_args()
    try:
        paths = nul_paths(sys.stdin.buffer.read()) if args.stdin else None
        result = audit(args.root, args.root / args.manifest, paths)
    except (OSError, ValueError, TypeError) as error:
        print(f"Repository boundary audit failed:\n{error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
