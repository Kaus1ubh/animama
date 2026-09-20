"""Immutable export inputs, portable path validation and manifest verification.

This module performs no remote operations. The private export manifest records
all source dispositions; candidate provenance contains only public identifiers.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import tempfile
import unicodedata
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "classification_audit", Path(__file__).with_name("audit-classification.py")
)
classification = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(classification)

HASH = re.compile(r"[0-9a-f]{64}\Z")
COMMIT = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
MODES = {"100644", "100755"}
ACTIVE = {"public", "cloud"}
PROVENANCE_FILE = "SPLIT_PROVENANCE.md"
SECRET_PATTERNS = (
    re.compile(rb"ANIMAMA_SPLIT_SECRET_CANARY_[A-Z0-9]{24,}"),
    re.compile(rb"-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"),
    re.compile(rb"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b"),
)
PRIVATE_PREFIXES = (
    "scripts/repository-boundary/templates/cloud/",
    "scripts/repository-boundary/pin-upstream.py",
    "services/identity/",
    "services/discover/",
    "services/discover-api/",
    "services/hosted/",
    "services/hosted-api/",
    "services/hosted-demo/",
    "services/hosted_demo/",
    "services/workers/",
    "apps/account-web/",
    "apps/animama-web/",
    "apps/discover-web/",
    "apps/hosted-bff/",
    "apps/hosted-web/",
    "apps/animama-demo/",
    "packages/cloud-contract-adapters/",
    "packages/policy/",
    "deploy/",
    "infra/",
    "upstream/",
)


def canonical(value: object) -> bytes:
    """Stable JSON bytes; timestamps, absolute paths and host metadata are absent."""
    return (json.dumps(value, sort_keys=True, ensure_ascii=True, indent=2) + "\n").encode()


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def portable_path(value: object) -> str:
    """Reject traversal and names that alias or cannot be represented on common hosts."""
    if not classification.valid_path(value):
        raise ValueError(f"Invalid export path: {value!r}")
    for part in value.split("/"):
        stem = part.split(".", 1)[0].upper()
        if (
            any(ord(c) < 32 or ord(c) == 127 or c in '<>:"|?*' for c in part)
            or part.endswith((".", " "))
            or any(0xD800 <= ord(c) <= 0xDFFF for c in part)
            or stem
            in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
        ):
            raise ValueError(f"Nonportable export path: {value!r}")
    return value


def assert_path_set(paths: list[str]) -> None:
    """Check file/directory collisions, including Unicode and case-folded ancestors."""
    aliases: dict[str, str] = {}
    files: set[str] = set()
    directories: set[str] = set()
    for path in sorted(paths):
        portable_path(path)
        parts = path.split("/")
        for count in range(1, len(parts) + 1):
            prefix = "/".join(parts[:count])
            key = unicodedata.normalize("NFC", prefix).casefold()
            if key in aliases and aliases[key] != prefix:
                raise ValueError(f"Case/Unicode collision: {aliases[key]!r} and {prefix!r}")
            aliases[key] = prefix
            if count < len(parts):
                if key in files:
                    raise ValueError(f"File/directory collision: {prefix!r}")
                directories.add(key)
            else:
                if key in files or key in directories:
                    raise ValueError(f"Duplicate target or file/directory collision: {path!r}")
                files.add(key)


def safe_active_path(path: str, owner: str, allowed_paths: set[str] | frozenset[str] = frozenset()) -> None:
    """Never export runtime state even when an ownership rule accidentally admits it."""
    portable_path(path)
    folded = path.casefold()
    if owner == "public" and folded.startswith(PRIVATE_PREFIXES):
        raise ValueError(f"Cloud-only input cannot enter public output: {path!r}")
    parts = path.lower().split("/")
    if any((part == ".env" or part.startswith(".env.")) and part != ".env.example" for part in parts) or parts[
        -1
    ].endswith((".pem", ".key", ".p12", ".pfx", ".sqlite", ".sqlite3", ".db", ".log")):
        raise ValueError(f"Credential or runtime-state path cannot be exported: {path!r}")
    if path in allowed_paths:
        return
    prohibited = {
        ".git",
        ".ssh",
        ".aws",
        ".gnupg",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        "dist",
        "build",
        "logs",
        ".cache",
    }
    if (
        set(parts) & prohibited
        or any(part == ".env" or part.startswith(".env.") for part in parts)
        or path.startswith(("data/", "content/local/", ".animama-stacks/"))
    ):
        raise ValueError(f"Runtime, credential or generated-state path cannot be exported: {path!r}")


def check_secret(payload: bytes, path: str) -> None:
    """Fail without printing secret bytes; full pinned scanner runs are separate gates."""
    if any(pattern.search(payload) for pattern in SECRET_PATTERNS):
        raise ValueError(f"Secret/key canary detected in export input: {path!r}")


class Git:
    """Read one repository while ignoring inherited redirection to another index/tree."""

    def __init__(self, root: Path, *, inherit_objects: bool = True):
        self.root = root.resolve()
        removed = {"GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"}
        if not inherit_objects:
            removed.update({"GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"})
        self.env = {key: value for key, value in os.environ.items() if key not in removed}
        if Path(os.fsdecode(self.run("rev-parse", "--show-toplevel")).strip()).resolve() != self.root:
            raise ValueError("--root must name the source repository root")

    def run(self, *args: str, data: bytes | None = None, env: dict | None = None) -> bytes:
        result = subprocess.run(["git", *args], cwd=self.root, env=env or self.env, input=data, capture_output=True)
        if result.returncode:
            # Git failures may mention private remotes/config; callers need the operation, not those values.
            raise ValueError(f"Git operation failed: {args[0]}")
        return result.stdout

    def source_commit(self, explicit: str | None) -> str:
        if explicit is not None and not COMMIT.fullmatch(explicit):
            raise ValueError("--source-commit must be a full immutable commit object ID")
        if explicit is None and self.run("status", "--porcelain=v1", "-z", "--untracked-files=all"):
            raise ValueError("Dirty source requires an explicit --source-commit; working-tree bytes are never exported")
        commit = self.run("rev-parse", "--verify", (explicit or "HEAD") + "^{commit}").decode().strip()
        if explicit is not None and commit != explicit:
            raise ValueError("--source-commit must identify the commit directly")
        return commit

    def entries(self, commit: str) -> dict:
        result = {}
        for item in self.run("ls-tree", "-r", "-z", commit).split(b"\0"):
            if not item:
                continue
            metadata, encoded = item.split(b"\t", 1)
            mode, kind, oid = metadata.decode().split()
            path = os.fsdecode(encoded)
            portable_path(path)
            if kind != "blob" or mode not in MODES:
                raise ValueError(f"Source symlinks and submodules are unsupported: {path!r}")
            result[path] = {"mode": mode, "oid": oid}
        return result

    def lfs_paths(self, commit: str, entries: dict) -> set[str]:
        # A disposable index reads .gitattributes from the chosen commit, never the live index.
        with tempfile.TemporaryDirectory(prefix="animama-export-index-") as directory:
            env = dict(self.env, GIT_INDEX_FILE=str(Path(directory) / "index"))
            self.run("read-tree", commit, env=env)
            raw = self.run(
                "check-attr",
                "--cached",
                "-z",
                "--stdin",
                "filter",
                data=b"".join(os.fsencode(p) + b"\0" for p in entries),
                env=env,
            ).split(b"\0")
        return {os.fsdecode(raw[i]) for i in range(0, len(raw) - 1, 3) if raw[i + 2] == b"lfs"}

    def lfs_store(self) -> Path:
        result = subprocess.run(["git", "lfs", "env"], cwd=self.root, env=self.env, capture_output=True)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if line.startswith(b"LocalMediaDir="):
                    return Path(os.fsdecode(line.split(b"=", 1)[1])).resolve()
        path = Path(os.fsdecode(self.run("rev-parse", "--git-path", "lfs/objects")).strip())
        return (self.root / path).resolve()


class Blobs:
    """Batch immutable Git blob reads; LFS payloads are streamed separately."""

    def __init__(self, git: Git):
        self.process = subprocess.Popen(
            ["git", "cat-file", "--batch"],
            cwd=git.root,
            env=git.env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        self.cache: dict[str, bytes] = {}

    def read(self, oid: str) -> bytes:
        if oid not in self.cache:
            self.process.stdin.write(oid.encode() + b"\n")
            self.process.stdin.flush()
            header = self.process.stdout.readline().decode().strip().split()
            if len(header) != 3 or header[1] != "blob":
                raise ValueError("Missing committed blob")
            payload = self.process.stdout.read(int(header[2]))
            if len(payload) != int(header[2]) or self.process.stdout.read(1) != b"\n":
                raise ValueError("Truncated committed blob")
            self.cache[oid] = payload
        return self.cache[oid]

    def close(self) -> None:
        self.process.stdin.close()
        self.process.stdout.close()
        self.process.wait()


def pointer(payload: bytes, path: str) -> dict | None:
    if not payload.startswith(classification.LFS_HEADER):
        return None
    match = re.fullmatch(
        rb"version https://git-lfs.github.com/spec/v1\noid sha256:([0-9a-f]{64})\nsize ([0-9]+)\n?", payload
    )
    if not match:
        raise ValueError(f"Unsupported or malformed committed LFS pointer: {path!r}")
    return {"oid": match[1].decode(), "size": int(match[2])}


def file_identity(path: Path, *, secret_path: str | None = None) -> tuple[str, int]:
    """Hash regular bytes, rejecting symlinks and streaming secret checks with overlap."""
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f"Expected regular materialized file: {path.name!r}")
    digest, size, previous = hashlib.sha256(), 0, b""
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
            size += len(block)
            if secret_path is not None:
                check_secret(previous + block, secret_path)
                previous = block[-1024:]
    return digest.hexdigest(), size


def validate_provenance(
    git: Git, blobs: Blobs, document: dict, entries: dict, identities: dict, source_manifest: dict
) -> None:
    """Validate source evidence against committed bytes and verified LFS objects."""
    if document.get("schema_version") != 1 or document.get("source_commit") != source_manifest.get("source_commit"):
        raise ValueError("Source provenance version/commit does not match the classification manifest")
    baseline = document.get("source_commit")
    if not isinstance(baseline, str) or not COMMIT.fullmatch(baseline):
        raise ValueError("Provenance baseline must be an immutable commit ID")
    original = git.entries(baseline)
    evidence_ids = set()
    evidence = document.get("evidence")
    if not isinstance(evidence, list):
        raise ValueError("Provenance evidence must be an array")
    for item in evidence:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("id"), str)
            or not item["id"]
            or item["id"] in evidence_ids
        ):
            raise ValueError("Missing or duplicate provenance evidence")
        evidence_ids.add(item["id"])
        for field in ("source", "revision", "license", "unresolved_decision"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                raise ValueError(f"Provenance evidence requires {field}")
        if not isinstance(item.get("required_notices"), list) or not all(
            isinstance(v, str) for v in item["required_notices"]
        ):
            raise ValueError("Provenance evidence requires required_notices")
        hashes = item.get("path_sha256")
        if not isinstance(hashes, dict) or not hashes:
            raise ValueError("Provenance evidence requires tracked input hashes")
        for path, expected in hashes.items():
            if path not in identities or identities[path]["sha256"] != expected:
                raise ValueError(f"Stale or missing provenance evidence: {path!r}")
            if original.get(path) != entries[path]:
                raise ValueError(f"Evidence changed since provenance baseline: {path!r}")
    records = document.get("files")
    if not isinstance(records, list):
        raise ValueError("Provenance files must be an array")
    seen = set()
    for record in records:
        if not isinstance(record, dict) or record.get("path") not in entries or record["path"] in seen:
            raise ValueError("Duplicate, missing or stale provenance file")
        path = record["path"]
        seen.add(path)
        if record.get("publication_status") not in classification.PUBLICATION_STATUSES:
            raise ValueError(f"Invalid publication status: {path!r}")
        refs = record.get("evidence_ids")
        if (
            not isinstance(refs, list)
            or not refs
            or any(not isinstance(ref, str) or ref not in evidence_ids for ref in refs)
        ):
            raise ValueError(f"Missing or unknown provenance evidence: {path!r}")
        expected = identities[path]
        if (
            record.get("sha256") != expected["sha256"]
            or record.get("git_blob_oid") != entries[path]["oid"]
            or original.get(path) != entries[path]
        ):
            raise ValueError(f"Provenance payload changed: {path!r}")
        if expected.get("lfs_oid"):
            if record.get("lfs_oid") != expected["lfs_oid"] or record.get("lfs_size") != expected["size"]:
                raise ValueError(f"Stale provenance LFS identity: {path!r}")
        elif "lfs_oid" in record or "lfs_size" in record:
            raise ValueError(f"Unexpected provenance LFS identity: {path!r}")
    required = classification.required_provenance_paths(entries, [p for p, i in identities.items() if "lfs_oid" in i])
    if required - seen:
        raise ValueError(f"Missing provenance records: {sorted(required - seen)!r}")


def core_record(record: dict) -> dict:
    return {field: record[field] for field in ("path", "sha256", "size", "mode")}


def tree_digest(records: list[dict]) -> str:
    return sha256(canonical([core_record(record) for record in sorted(records, key=lambda value: value["path"])]))


def valid_records(records: object) -> dict[str, dict]:
    if not isinstance(records, list) or not records:
        raise ValueError("Export file manifest must be a nonempty array")
    paths = []
    for record in records:
        if (
            not isinstance(record, dict)
            or not isinstance(record.get("sha256"), str)
            or not HASH.fullmatch(record["sha256"])
            or type(record.get("size")) is not int
            or record["size"] < 0
            or record.get("mode") not in MODES
        ):
            raise ValueError("Invalid export file identity")
        paths.append(portable_path(record.get("path")))
    assert_path_set(paths)
    return {record["path"]: dict(record) for record in records}


def verify_tree(root: Path, expected: dict[str, dict], source_commit: str) -> None:
    """Verify exact bytes/modes and permit only a genuine independent root .git directory."""
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Candidate root must be a real directory")
    actual = set()
    expected_directories = {
        parent.as_posix() for path in expected for parent in Path(path).parents if str(parent) != "."
    }
    for parent, directories, files in os.walk(root, followlinks=False):
        base = Path(parent)
        if base == root and ".git" in directories:
            admin = root / ".git"
            if admin.is_symlink() or (admin / "commondir").exists() or (admin / "objects/info/alternates").exists():
                raise ValueError("Candidate Git metadata must be independent of source repositories")
            candidate = Git(root, inherit_objects=False)
            common = Path(os.fsdecode(candidate.run("rev-parse", "--git-common-dir")).strip())
            if (root / common).resolve() != admin.resolve():
                raise ValueError("Candidate Git metadata points outside its root")
            inherited = subprocess.run(
                ["git", "cat-file", "-e", source_commit + "^{commit}"], cwd=root, env=candidate.env, capture_output=True
            )
            if inherited.returncode == 0:
                raise ValueError("Candidate contains original source history")
            directories.remove(".git")
        for name in directories:
            if (base / name).is_symlink():
                raise ValueError("Candidate contains a symlink directory")
            if (base / name).relative_to(root).as_posix() not in expected_directories:
                raise ValueError("Candidate contains an unexpected directory")
        for name in files:
            path = base / name
            relative = path.relative_to(root).as_posix()
            portable_path(relative)
            if path.is_symlink() or relative not in expected:
                raise ValueError(f"Unexpected candidate file or symlink: {relative!r}")
            actual.add(relative)
            record = expected[relative]
            digest, size = file_identity(path, secret_path=relative)
            mode = "100755" if path.stat().st_mode & 0o111 else "100644"
            if (digest, size, mode) != (record["sha256"], record["size"], record["mode"]):
                raise ValueError(f"Candidate file differs from its manifest: {relative!r}")
    if actual != set(expected):
        raise ValueError(f"Missing candidate files: {sorted(set(expected) - actual)!r}")


def verify_export(manifest_path: Path, public: Path, cloud: Path, generated_layers: list[Path] | None = None) -> dict:
    payload = manifest_path.read_bytes()
    checksum = manifest_path.with_suffix(manifest_path.suffix + ".sha256")
    if checksum.exists() and checksum.read_text() != f"{sha256(payload)}  {manifest_path.name}\n":
        raise ValueError("Export manifest checksum differs")
    document = json.loads(payload)
    if document.get("schema_version") != 1 or document.get("kind") != "repository-export":
        raise ValueError("Unsupported export manifest")
    source = document.get("source_commit")
    if not isinstance(source, str) or not COMMIT.fullmatch(source):
        raise ValueError("Export manifest requires immutable source_commit")
    exports = document.get("exports", {})
    expected = {}
    for owner in sorted(ACTIVE):
        records = exports.get(owner, {}).get("files")
        expected[owner] = valid_records(records)
        if tree_digest(records) != exports[owner].get("tree_sha256"):
            raise ValueError(f"Invalid base tree digest for {owner}")
    changed = set()
    for layer_path in generated_layers or []:
        layer = json.loads(layer_path.read_bytes())
        owner = layer.get("owner")
        if (
            layer.get("schema_version") != 1
            or layer.get("kind") != "generated-export-layer"
            or owner not in ACTIVE
            or layer.get("base_tree_sha256") != exports[owner]["tree_sha256"]
        ):
            raise ValueError("Generated layer does not bind the verified base tree")
        for path, record in valid_records(layer.get("files")).items():
            if (owner, path) in changed:
                raise ValueError("Multiple generated layers change the same path")
            changed.add((owner, path))
            safe_active_path(path, owner)
            original = expected[owner].get(path)
            if record.get("operation") == "add":
                if original is not None or "base_sha256" in record:
                    raise ValueError("Generated add collides with the base tree")
            elif record.get("operation") == "replace":
                if original is None or record.get("base_sha256") != original["sha256"]:
                    raise ValueError("Generated replacement does not bind original bytes")
            else:
                raise ValueError("Generated layer only supports declared add/replace operations")
            expected[owner][path] = record
    for owner, root in (("public", public), ("cloud", cloud)):
        assert_path_set(list(expected[owner]))
        verify_tree(root, expected[owner], source)
    return {
        "source_commit": source,
        "public_files": len(expected["public"]),
        "cloud_files": len(expected["cloud"]),
        "generated_files": len(changed),
        "verified": True,
    }
