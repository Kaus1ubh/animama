"""Durable file compensation for catalog-coordinated Local content mutations.

The catalog's operation receipt decides commit after a crash. Journals never
grant replay authority. Backups live beside Local bytes so promotion and restore
remain same-filesystem operations even when private data uses another volume.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import uuid
from pathlib import Path, PurePosixPath
from typing import Any

from animama.app.ports.content_store import ContentMutationJournal
from animama.domain.content_catalog import ContentConflictError, ContentPathError

_DIGEST = re.compile(r"^[a-f0-9]{64}$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_BACKUPS = ".animama-mutations"
_MAX_JOURNAL_BYTES = 8 * 1024 * 1024
_MAX_CHANGES = 20_000


def sync_directory(directory: Path) -> None:
    """Persist directory-entry changes, including rename and unlink."""

    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def relative_path(relative: str) -> PurePosixPath:
    """Validate journal paths independently from later manual filesystem changes."""

    parts = PurePosixPath(relative)
    if (
        not relative
        or "\\" in relative
        or "\x00" in relative
        or parts.is_absolute()
        or parts.as_posix() != relative
        or any(part in {".", ".."} for part in parts.parts)
    ):
        raise ContentPathError("mutation path is not a canonical relative path")
    return parts


def safe_path(root: Path, relative: str, *, create_parents: bool = False) -> Path:
    """Resolve canonical root-relative paths without following any symlink."""

    parts = relative_path(relative)
    if create_parents:
        missing: list[Path] = []
        ancestor = root
        while not ancestor.exists():
            missing.append(ancestor)
            ancestor = ancestor.parent
        if not stat.S_ISDIR(ancestor.lstat().st_mode):
            raise ContentPathError("mutation root contains an unsafe directory")
        for directory in reversed(missing):
            directory.mkdir(mode=0o700)
            sync_directory(directory.parent)
    cursor = root
    for part in (None, *parts.parts[:-1]):
        if part is not None:
            cursor /= part
        try:
            metadata = cursor.lstat()
        except FileNotFoundError:
            if not create_parents:
                continue
            cursor.mkdir(mode=0o700)
            sync_directory(cursor.parent)
            metadata = cursor.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            raise ContentPathError("mutation path contains an unsafe directory")
    return root.joinpath(*parts.parts)


def fingerprint(path: Path) -> dict[str, Any] | None:
    """Hash one unchanged ordinary file; links never authorize recovery."""

    try:
        before = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise ContentPathError("mutation target must be an ordinary non-linked file")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        opened = os.fstat(handle.fileno())
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ContentConflictError("content_recovery_conflict")
        hasher = hashlib.sha256()
        while chunk := handle.read(1024 * 1024):
            hasher.update(chunk)
        digest = hasher.hexdigest()
        after = os.fstat(handle.fileno())
    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
        after.st_size,
        after.st_mtime_ns,
        after.st_ctime_ns,
    ):
        raise ContentConflictError("content_recovery_conflict")
    return {"sha256": digest, "size": after.st_size, "mode": stat.S_IMODE(after.st_mode)}


def copy_file(source: Path, destination: Path, expected: dict[str, Any]) -> None:
    """Copy to an exclusive file and verify it before it can become recovery authority."""

    source_descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        target_descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except BaseException:
        os.close(source_descriptor)
        raise
    with os.fdopen(source_descriptor, "rb") as incoming, os.fdopen(target_descriptor, "wb") as outgoing:
        while chunk := incoming.read(1024 * 1024):
            outgoing.write(chunk)
        outgoing.flush()
        os.fchmod(outgoing.fileno(), expected["mode"])
        os.fsync(outgoing.fileno())
    if fingerprint(destination) != expected:
        raise ContentConflictError("content_recovery_conflict")
    sync_directory(destination.parent)


class MutationJournal:
    """Own reversible file writes and retain all evidence when compensation conflicts."""

    def __init__(self, *, local_root: Path, operations_root: Path, payload: dict[str, Any]) -> None:
        self.local_root = local_root
        self.operations_root = operations_root
        self.payload = payload
        self.identity = ContentMutationJournal(
            **{key: payload[key] for key in ("journal_id", "operation_id", "user_id", "request_digest")}
        )

    @property
    def path(self) -> Path:
        return safe_path(self.operations_root, f"mutation-{self.identity.journal_id}.json", create_parents=True)

    def backup(self, index: int, *, create_parents: bool = False) -> Path:
        """Keep originals in a private, deterministic directory adjacent to Local."""

        return safe_path(
            self.local_root,
            f"{_BACKUPS}/{self.identity.journal_id}/{index}.original",
            create_parents=create_parents,
        )

    def temporary(self, name: str, *, directory: bool = False) -> Path:
        """Record private staging custody before creation, including incomplete streams."""

        if Path(name).name != name or not name:
            raise ContentPathError("invalid mutation staging name")
        relative = f"{_BACKUPS}/{self.identity.journal_id}/{uuid.uuid4().hex}-{name}"
        self.payload.setdefault("temporary", []).append({"path": relative, "directory": directory})
        self.persist()
        return safe_path(self.local_root, relative, create_parents=True)

    @staticmethod
    def remove_temporary(path: Path) -> None:
        """Remove only regular private staging bytes; preserve unsafe evidence."""

        try:
            metadata = path.lstat()
        except FileNotFoundError:
            return
        if stat.S_ISDIR(metadata.st_mode):
            for child in path.iterdir():
                MutationJournal.remove_temporary(child)
            path.rmdir()
        else:
            fingerprint(path)
            path.unlink()

    def persist(self) -> None:
        """Publish the journal before changing any corresponding destination."""

        encoded = json.dumps(self.payload, sort_keys=True, separators=(",", ":")).encode()
        if len(encoded) > _MAX_JOURNAL_BYTES:
            raise ContentConflictError("content_mutation_too_large")
        destination = self.path
        temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            if destination.exists():
                fingerprint(destination)
            os.replace(temporary, destination)
            sync_directory(destination.parent)
        finally:
            temporary.unlink(missing_ok=True)

    def replace(self, staged: Path | None, destination: Path) -> None:
        """Journal an original and intended file before an atomic replace or unlink."""

        if self.payload["status"] != "active":
            raise ContentConflictError("content_mutation_not_active")
        relative = destination.relative_to(self.local_root).as_posix()
        if PurePosixPath(relative).parts[0] == _BACKUPS:
            raise ContentPathError("mutation cannot modify its recovery storage")
        destination = safe_path(self.local_root, relative, create_parents=True)
        before = fingerprint(destination)
        after = fingerprint(staged) if staged is not None else None
        if staged is not None and after is None:
            raise ContentPathError("mutation staged file is missing")
        changes = self.payload["changes"]
        if len(changes) >= _MAX_CHANGES:
            raise ContentConflictError("content_mutation_too_large")
        if any(change["path"] == relative for change in changes):
            raise ContentConflictError("content_mutation_destination_repeated")
        index = len(changes)
        changes.append({"path": relative, "before": before, "after": after})
        self.persist()
        if before is not None:
            copy_file(destination, self.backup(index, create_parents=True), before)
        if fingerprint(destination) != before:
            raise ContentConflictError("content_recovery_conflict")
        if staged is None:
            destination.unlink(missing_ok=True)
        else:
            os.replace(staged, destination)
        sync_directory(destination.parent)

    def finish(self, *, commit: bool) -> None:
        """Restore only recognized bytes; DB-committed mutations only discard backups."""

        changes = self.payload["changes"]
        if not commit and self.payload["status"] != "rolled_back":
            # Check the entire rollback before touching any destination. A later
            # manual edit preserves both current bytes and every original backup.
            try:
                for index in reversed(range(len(changes))):
                    change = changes[index]
                    destination = safe_path(self.local_root, change["path"])
                    current = fingerprint(destination)
                    if current not in (change["after"], change["before"]):
                        raise ContentConflictError("content_recovery_conflict")
                    if (
                        current != change["before"]
                        and change["before"] is not None
                        and fingerprint(self.backup(index)) != change["before"]
                    ):
                        raise ContentConflictError("content_recovery_conflict")
            except (ContentPathError, ContentConflictError) as exc:
                self.payload["status"] = "conflict"
                self.persist()
                raise ContentConflictError("content_recovery_conflict") from exc
            for index in reversed(range(len(changes))):
                change = changes[index]
                destination = safe_path(self.local_root, change["path"], create_parents=True)
                if fingerprint(destination) == change["before"]:
                    continue
                # Recheck after preflight, since a manual writer does not hold
                # the application's database lock.
                if fingerprint(destination) != change["after"]:
                    self.payload["status"] = "conflict"
                    self.persist()
                    raise ContentConflictError("content_recovery_conflict")
                if change["before"] is None:
                    destination.unlink(missing_ok=True)
                else:
                    temporary = destination.with_name(f".animama-restore-{uuid.uuid4().hex}")
                    try:
                        copy_file(self.backup(index), temporary, change["before"])
                        # Copying a large backup can outlast a manual edit. Check
                        # again immediately before publishing restored bytes.
                        if fingerprint(destination) != change["after"]:
                            self.payload["status"] = "conflict"
                            self.persist()
                            raise ContentConflictError("content_recovery_conflict")
                        os.replace(temporary, destination)
                    finally:
                        temporary.unlink(missing_ok=True)
                sync_directory(destination.parent)
        self.payload["status"] = "committed" if commit else "rolled_back"
        self.persist()
        # A terminal journal survives a crash during cleanup. Original files
        # remain until every restoration is durable.
        for index in range(len(changes)):
            backup = self.backup(index)
            backup.unlink(missing_ok=True)
        for temporary in self.payload.get("temporary", []):
            self.remove_temporary(safe_path(self.local_root, temporary["path"]))
        backup_root = self.backup(0).parent
        if backup_root.exists():
            sync_directory(backup_root)
            backup_root.rmdir()
            sync_directory(backup_root.parent)
        self.path.unlink()
        sync_directory(self.operations_root)


def create_journal(
    *, local_root: Path, operations_root: Path, operation_id: str, user_id: str, request_digest: str
) -> MutationJournal:
    """Create owner-scoped recovery identity, never interpreting a journal as replay success."""

    if (
        not _IDENTIFIER.fullmatch(operation_id)
        or not user_id
        or len(user_id) > 256
        or not _DIGEST.fullmatch(request_digest)
    ):
        raise ContentPathError("invalid content mutation identity")
    journal_id = hashlib.sha256(json.dumps([user_id, operation_id], separators=(",", ":")).encode()).hexdigest()
    journal = MutationJournal(
        local_root=local_root,
        operations_root=operations_root,
        payload={
            "schema": 1,
            "journal_id": journal_id,
            "operation_id": operation_id,
            "user_id": user_id,
            "request_digest": request_digest,
            "status": "active",
            "changes": [],
        },
    )
    if journal.path.exists():
        raise ContentConflictError("content_mutation_recovery_required")
    journal.persist()
    return journal


def read_journals(*, local_root: Path, operations_root: Path) -> tuple[MutationJournal, ...]:
    """Read bounded journals; malformed recovery evidence fails closed."""

    if not operations_root.exists():
        return ()
    journals = []
    for path in sorted(operations_root.glob("mutation-*.json")):
        try:
            checked = safe_path(operations_root, path.name)
            metadata = fingerprint(checked)
            if metadata is None or metadata["size"] > _MAX_JOURNAL_BYTES:
                raise ValueError()
            payload = json.loads(checked.read_text(encoding="utf-8"))
            identity = hashlib.sha256(
                json.dumps([payload["user_id"], payload["operation_id"]], separators=(",", ":")).encode()
            ).hexdigest()
            if payload["schema"] != 1 or payload["journal_id"] != identity or path.name != f"mutation-{identity}.json":
                raise ValueError()
            if (
                not isinstance(payload["user_id"], str)
                or not _IDENTIFIER.fullmatch(payload["operation_id"])
                or not _DIGEST.fullmatch(payload["request_digest"])
            ):
                raise ValueError()
            if payload["status"] not in {"active", "conflict", "committed", "rolled_back"}:
                raise ValueError()
            if not isinstance(payload["changes"], list) or len(payload["changes"]) > _MAX_CHANGES:
                raise ValueError()
            for change in payload["changes"]:
                relative_path(change["path"])
                if PurePosixPath(change["path"]).parts[0] == _BACKUPS:
                    raise ValueError()
                for state in (change["before"], change["after"]):
                    if state is not None and (
                        not _DIGEST.fullmatch(state["sha256"])
                        or type(state["size"]) is not int
                        or state["size"] < 0
                        or type(state["mode"]) is not int
                        or not 0 <= state["mode"] <= 0o7777
                    ):
                        raise ValueError()
            temporary = payload.get("temporary", [])
            if not isinstance(temporary, list) or len(temporary) > _MAX_CHANGES:
                raise ValueError()
            for item in temporary:
                parts = relative_path(item["path"])
                if (
                    len(parts.parts) != 3
                    or parts.parts[:2] != (_BACKUPS, identity)
                    or not re.fullmatch(r"[a-f0-9]{32}-.+", parts.name)
                    or type(item["directory"]) is not bool
                ):
                    raise ValueError()
            journals.append(MutationJournal(local_root=local_root, operations_root=operations_root, payload=payload))
        except (OSError, ValueError, TypeError, KeyError, ContentPathError) as exc:
            raise ContentConflictError("content_mutation_journal_invalid") from exc
    return tuple(journals)
