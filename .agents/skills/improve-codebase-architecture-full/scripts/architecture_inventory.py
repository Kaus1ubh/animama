#!/usr/bin/env python3
"""Account for a whole Git checkout without embedding its source contents.

This helper checks structural coverage and snapshot currency. It cannot establish
that architectural reasoning, evidence, or recommendations are correct.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
KINDS = {"file", "symlink", "submodule", "missing", "other"}
DISPOSITIONS = {"reviewed", "supporting", "excluded", "pending"}
EXAMPLE_LIMIT = 5
PROOF_LIMIT = (
    "This check proves only path accounting and current snapshot agreement; "
    "it does not prove architectural analysis or evidence quality."
)


class InventoryError(Exception):
    """A friendly input, checkout, or filesystem error."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True).encode("utf-8")


def valid_fingerprint(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def git(repo: Path, *args: str, allow_failure: bool = False) -> subprocess.CompletedProcess:
    """Run read-only Git commands without taking optional locks or using fsmonitor."""
    env = dict(os.environ, GIT_OPTIONAL_LOCKS="0")
    try:
        result = subprocess.run(
            ["git", "-c", "core.fsmonitor=false", "-C", str(repo), *args],
            capture_output=True,
            env=env,
            check=False,
        )
    except OSError as exc:
        raise InventoryError(f"Cannot run Git: {exc}") from exc
    if result.returncode and not allow_failure:
        detail = os.fsdecode(result.stderr).strip()[:400]
        raise InventoryError(f"Git {args[0]} failed: {detail or 'no diagnostic available'}")
    return result


def checkout_root(repo: Path) -> Path:
    # Strip exactly the protocol newline; a checkout name may itself end in one.
    result = git(repo, "rev-parse", "--show-toplevel")
    return Path(os.fsdecode(result.stdout.removesuffix(b"\n"))).resolve()


def head_commit(root: Path) -> str | None:
    result = git(root, "rev-parse", "--verify", "--quiet", "HEAD", allow_failure=True)
    if result.returncode == 1:
        return None  # A valid checkout with no first commit yet.
    if result.returncode:
        raise InventoryError("Cannot read the checkout HEAD.")
    return result.stdout.decode("ascii").strip()


def valid_path(value: object, *, prefix: bool = False) -> str:
    """Validate Git-relative names without stripping spaces or unusual characters."""
    if not isinstance(value, str) or not value or "\x00" in value:
        raise InventoryError("Paths must be nonempty repository-relative strings.")
    normalized = value.rstrip("/") if prefix else value
    parts = normalized.removesuffix("/").split("/")
    if not normalized or any(part in {"", ".", ".."} for part in parts):
        raise InventoryError(f"Invalid repository-relative path: {json.dumps(value)}")
    return normalized


def matching_exclusion(path: str, exclusions: list[dict]) -> dict | None:
    for item in exclusions:
        prefix = item["prefix"]
        if path == prefix or path.startswith(prefix + "/"):
            return item
    return None


def checkout_paths(root: Path) -> tuple[list[str], dict[str, list[dict]]]:
    """Include tracked deletions, ignored tracked files, and nonignored new files."""
    output = git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z").stdout
    paths = sorted({valid_path(os.fsdecode(path)) for path in output.split(b"\0") if path})
    gitlinks: dict[str, list[dict]] = {}
    for entry in git(root, "ls-files", "--stage", "-z").stdout.split(b"\0"):
        if not entry:
            continue
        header, path_bytes = entry.split(b"\t", 1)
        mode, oid, stage = header.split(b" ")
        if mode == b"160000":
            path = os.fsdecode(path_bytes)
            gitlinks.setdefault(path, []).append(
                {
                    "commit": oid.decode("ascii"),
                    "stage": int(stage),
                }
            )
    return paths, gitlinks


def checkout_provenance(root: Path, exclusions: list[dict]) -> dict:
    """Record dirty/index provenance, with audit artifacts outside the digest."""
    output = git(
        root,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=all",
    ).stdout
    parts = iter(output.split(b"\0"))
    included, excluded_count = [], 0
    for part in parts:
        if not part:
            continue
        status_code, name = part[:2].decode("ascii"), os.fsdecode(part[3:])
        record = {"status": status_code, "path": name}
        if "R" in status_code or "C" in status_code:
            try:
                record["original_path"] = os.fsdecode(next(parts))
            except StopIteration as exc:
                raise InventoryError("Git returned incomplete rename status.") from exc
        names = [name] + ([record["original_path"]] if "original_path" in record else [])
        if all(matching_exclusion(path, exclusions) for path in names):
            excluded_count += 1
        else:
            included.append(record)
    included.sort(key=lambda record: (record["path"], record["status"]))
    return {
        "dirty": bool(included or excluded_count),
        "in_scope_dirty": bool(included),
        "in_scope_status_count": len(included),
        "excluded_status_count": excluded_count,
        "in_scope_status_sha256": digest(json_bytes(included)),
        "status_entries": included,
    }


def special_entry(path: str, kind: str, state: object, size: int = 0) -> dict:
    return {"path": path, "kind": kind, "bytes": size, "fingerprint": digest(json_bytes(state))}


def ancestor_obstruction(root: Path, path: str) -> dict | None:
    """Do not follow a replacement parent symlink outside the checkout."""
    current = root
    parts = path.removesuffix("/").split("/")
    for part in parts[:-1]:
        current /= part
        try:
            info = current.lstat()
        except FileNotFoundError:
            return {"state": "missing_ancestor"}
        if stat.S_ISLNK(info.st_mode):
            return {
                "state": "symlink_ancestor",
                "ancestor": current.relative_to(root).as_posix(),
                "target_sha256": digest(os.fsencode(os.readlink(current))),
            }
        if not stat.S_ISDIR(info.st_mode):
            return {"state": "nondirectory_ancestor"}
    return None


def submodule_entry(root: Path, path: str, index: list[dict], info: os.stat_result | None) -> dict:
    """Record gitlink and local Git state; never inventory a submodule recursively.

    The status digest detects status-list changes, not every edit within an already
    dirty submodule. A submodule needs its own inventory to establish file currency.
    """
    local = root / path
    state: dict = {"index": index, "checkout_head": None, "state": "missing"}
    if info is not None and stat.S_ISLNK(info.st_mode):
        state.update(state="symlink", target_sha256=digest(os.fsencode(os.readlink(local))))
    elif info is not None and stat.S_ISDIR(info.st_mode):
        # Uninitialized directories may resolve to the parent repository; reject that.
        result = git(local, "rev-parse", "--show-toplevel", allow_failure=True)
        if not result.returncode and Path(os.fsdecode(result.stdout.removesuffix(b"\n"))).resolve() == local.resolve():
            status_output = git(
                local,
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=normal",
                "--ignore-submodules=all",
            ).stdout
            state.update(
                state="initialized",
                checkout_head=head_commit(local),
                dirty=bool(status_output),
                status_sha256=digest(status_output),
            )
        else:
            state["state"] = "uninitialized"
    elif info is not None:
        state["state"] = "not_directory"
    entry = special_entry(path, "submodule", state)
    entry["submodule"] = state
    return entry


def file_entry(root: Path, path: str, gitlinks: dict) -> dict:
    obstruction = ancestor_obstruction(root, path)
    if obstruction:
        kind = "missing" if obstruction["state"] == "missing_ancestor" else "other"
        entry = special_entry(path, kind, obstruction)
        entry["state"] = obstruction["state"]
        return entry
    local = root / path
    try:
        info = local.lstat()
    except FileNotFoundError:
        info = None
    if path in gitlinks:
        return submodule_entry(root, path, gitlinks[path], info)
    if info is None:
        return special_entry(path, "missing", "missing")
    if stat.S_ISLNK(info.st_mode):
        target = os.fsencode(os.readlink(local))
        return {"path": path, "kind": "symlink", "bytes": len(target), "fingerprint": digest(target)}
    if not stat.S_ISREG(info.st_mode):
        entry = special_entry(path, "other", {"mode_type": stat.S_IFMT(info.st_mode)})
        entry["state"] = "nonregular"
        return entry
    hasher = hashlib.sha256()
    fd = os.open(local, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or (before.st_dev, before.st_ino) != (info.st_dev, info.st_ino):
            raise InventoryError(f"File changed while scanning: {json.dumps(path)}; retry.")
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
        after = os.fstat(source.fileno())
    final = local.lstat()

    def signature(item: os.stat_result) -> tuple:
        return item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns, item.st_mode

    if signature(before) != signature(after) or signature(after) != signature(final):
        raise InventoryError(f"File changed while scanning: {json.dumps(path)}; retry.")
    return {
        "path": path,
        "kind": "file",
        "bytes": after.st_size,
        "fingerprint": hasher.hexdigest(),
        "executable": bool(after.st_mode & 0o111),
    }


def collect(root: Path, exclusions: list[dict]) -> dict:
    head = head_commit(root)
    paths, gitlinks = checkout_paths(root)
    provenance = checkout_provenance(root, exclusions)
    files, excluded_paths = [], []
    for path in paths:
        exclusion = matching_exclusion(path, exclusions)
        if exclusion:
            excluded_paths.append({"path": path, **exclusion})
        else:
            files.append(file_entry(root, path, gitlinks))
    if head_commit(root) != head:
        raise InventoryError("HEAD changed while scanning the checkout; retry.")
    return {
        "schema_version": SCHEMA_VERSION,
        "root": str(root),
        "head": head,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "provenance": provenance,
        "scope": "git ls-files --cached --others --exclude-standard -z; whole current checkout",
        "exclusions": exclusions,
        "excluded_paths": excluded_paths,
        "counts": {"discovered": len(paths), "included": len(files), "excluded": len(excluded_paths)},
        "files": files,
        "limitations": [
            "Ignored untracked paths are outside Git enumeration.",
            "Submodules are represented by gitlink, HEAD, and status digest, without recursive file inventory.",
            "Submodule status does not detect every edit within an already dirty submodule.",
            "A snapshot is a point-in-time observation, not a filesystem transaction.",
        ],
    }


def write_snapshot(output: Path, inventory: dict, force: bool) -> None:
    """Publish a fully written file atomically, with no-clobber behavior by default."""
    if os.path.lexists(output) and not force:
        raise InventoryError("Snapshot already exists; use a new output path or --force.")
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".inventory-", suffix=".tmp", dir=output.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as destination:
            json.dump(inventory, destination, ensure_ascii=True, sort_keys=True, indent=2)
            destination.write("\n")
            destination.flush()
            os.fsync(destination.fileno())
        if force:
            os.replace(temporary, output)
        else:
            # An atomic link publishes the complete file without a check/replace race.
            try:
                os.link(temporary, output)
            except FileExistsError as exc:
                raise InventoryError("Snapshot already exists; use a new output path or --force.") from exc
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def snapshot(args: argparse.Namespace) -> int:
    root = checkout_root(Path(args.repo))
    exclusions = []
    for value in args.exclude_prefix:
        prefix = valid_path(value, prefix=True)
        if any(item["prefix"] == prefix for item in exclusions):
            raise InventoryError(f"Duplicate exclusion prefix: {json.dumps(prefix)}")
        exclusions.append({"prefix": prefix, "reason": args.exclude_reason})
    if not args.exclude_reason.strip():
        raise InventoryError("--exclude-reason must not be empty.")
    exclusions.sort(key=lambda item: item["prefix"])
    # Resolve the parent only: --force replaces an output symlink, not its target.
    raw_output = Path(args.output).absolute()
    output = raw_output.parent.resolve() / raw_output.name
    if os.path.lexists(output) and not args.force:
        raise InventoryError("Snapshot already exists; use a new output path or --force.")
    try:
        output_relative = output.relative_to(root).as_posix()
    except ValueError:
        pass
    else:
        if not matching_exclusion(output_relative, exclusions):
            raise InventoryError(
                "Output inside the checkout must be covered by an explicit --exclude-prefix "
                "(usually the audit artifact directory)."
            )
    inventory = collect(root, exclusions)
    write_snapshot(output, inventory, args.force)
    counts = inventory["counts"]
    print(
        f"Snapshot: {counts['included']} paths; {counts['excluded']} explicitly excluded; "
        f"{counts['discovered']} discovered."
    )
    if any(entry["kind"] == "submodule" for entry in inventory["files"]):
        print(
            "Submodules: gitlink/HEAD/status only; edits inside an already dirty submodule "
            "require a separate snapshot to detect."
        )
    print(f"Wrote {json.dumps(str(output))}")
    return 0


def load_inventory(path: Path) -> dict:
    try:
        with path.open(encoding="utf-8") as source:
            data = json.load(source)
    except (ValueError, UnicodeError) as exc:
        raise InventoryError(f"Invalid inventory JSON: {exc}") from exc
    if (
        not isinstance(data, dict)
        or type(data.get("schema_version")) is not int
        or data["schema_version"] != SCHEMA_VERSION
    ):
        raise InventoryError("Inventory must be an object with schema_version 1.")
    if not isinstance(data.get("root"), str) or "\x00" in data["root"] or not Path(data["root"]).is_absolute():
        raise InventoryError("Inventory root must be an absolute checkout path.")
    if "head" not in data or (
        data["head"] is not None
        and (
            not isinstance(data["head"], str)
            or len(data["head"]) not in {40, 64}
            or any(char not in "0123456789abcdef" for char in data["head"])
        )
    ):
        raise InventoryError("Inventory head must be a commit string or null.")
    if not isinstance(data.get("created_at"), str) or not data["created_at"]:
        raise InventoryError("Inventory created_at must be nonempty.")
    provenance = data.get("provenance")
    if not isinstance(provenance, dict) or not isinstance(provenance.get("status_entries"), list):
        raise InventoryError("Inventory must include checkout provenance and status entries.")
    for field in ("dirty", "in_scope_dirty"):
        if type(provenance.get(field)) is not bool:
            raise InventoryError(f"Inventory provenance {field} must be a boolean.")
    for field in ("in_scope_status_count", "excluded_status_count"):
        if type(provenance.get(field)) is not int or provenance[field] < 0:
            raise InventoryError(f"Inventory provenance {field} must be a nonnegative integer.")
    status_paths = set()
    for record in provenance["status_entries"]:
        if not isinstance(record, dict):
            raise InventoryError("Inventory status entries must be objects.")
        path = valid_path(record.get("path"))
        if path in status_paths:
            raise InventoryError("Inventory contains duplicate status paths.")
        status_paths.add(path)
        status_code = record.get("status")
        if (
            not isinstance(status_code, str)
            or len(status_code) != 2
            or any(char not in " MADRCUT?!" for char in status_code)
        ):
            raise InventoryError("Inventory status entries need a two-character Git status.")
        if "R" in status_code or "C" in status_code:
            valid_path(record.get("original_path"))
    if provenance["in_scope_status_count"] != len(status_paths) or provenance["in_scope_dirty"] != bool(status_paths):
        raise InventoryError("Inventory in-scope status counts or dirty state disagree.")
    if provenance["dirty"] != bool(status_paths or provenance["excluded_status_count"]):
        raise InventoryError("Inventory overall dirty state disagrees with status counts.")
    if provenance.get("in_scope_status_sha256") != digest(json_bytes(provenance["status_entries"])):
        raise InventoryError("Inventory status provenance fingerprint is invalid.")
    if not isinstance(data.get("files"), list) or not isinstance(data.get("exclusions"), list):
        raise InventoryError("Inventory files and exclusions must be lists.")
    prefixes = set()
    for exclusion in data["exclusions"]:
        if not isinstance(exclusion, dict):
            raise InventoryError("Each exclusion must be an object.")
        prefix = valid_path(exclusion.get("prefix"), prefix=True)
        if prefix != exclusion["prefix"] or prefix in prefixes:
            raise InventoryError("Inventory exclusion prefixes must be canonical and unique.")
        if not isinstance(exclusion.get("reason"), str) or not exclusion["reason"].strip():
            raise InventoryError("Each exclusion needs a nonempty reason.")
        prefixes.add(prefix)
    paths = set()
    for entry in data["files"]:
        if not isinstance(entry, dict):
            raise InventoryError("Each inventory file must be an object.")
        path = valid_path(entry.get("path"))
        if path in paths or matching_exclusion(path, data["exclusions"]):
            raise InventoryError(f"Duplicate or excluded inventory file: {json.dumps(path)}")
        paths.add(path)
        if not isinstance(entry.get("kind"), str) or entry["kind"] not in KINDS:
            raise InventoryError(f"Invalid kind for {json.dumps(path)}.")
        if type(entry.get("bytes")) is not int or entry["bytes"] < 0:
            raise InventoryError(f"Invalid byte count for {json.dumps(path)}.")
        if entry["kind"] == "file" and type(entry.get("executable")) is not bool:
            raise InventoryError(f"Regular file needs an executable boolean: {json.dumps(path)}.")
        fingerprint = entry.get("fingerprint")
        if not valid_fingerprint(fingerprint):
            raise InventoryError(f"Invalid fingerprint for {json.dumps(path)}.")
    excluded = data.get("excluded_paths")
    if not isinstance(excluded, list):
        raise InventoryError("Inventory must list excluded_paths explicitly.")
    excluded_names = set()
    for entry in excluded:
        if not isinstance(entry, dict):
            raise InventoryError("Excluded paths must be objects.")
        path = valid_path(entry.get("path"))
        match = matching_exclusion(path, data["exclusions"])
        if path in excluded_names or path in paths or not match or entry != {"path": path, **match}:
            raise InventoryError(f"Invalid excluded-path accounting: {json.dumps(path)}")
        excluded_names.add(path)
    expected_counts = {"discovered": len(paths) + len(excluded), "included": len(paths), "excluded": len(excluded)}
    counts = data.get("counts")
    if (
        not isinstance(counts, dict)
        or any(type(value) is not int for value in counts.values())
        or counts != expected_counts
    ):
        raise InventoryError("Inventory counts disagree with included and excluded paths.")
    return data


def load_coverage(path: Path, inventory_paths: set[str]) -> dict[str, dict]:
    records = {}
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except ValueError as exc:
                raise InventoryError(f"Invalid coverage JSON at line {line_number}: {exc}") from exc
            if not isinstance(record, dict):
                raise InventoryError(f"Coverage line {line_number} must be an object.")
            name = valid_path(record.get("path"))
            if name not in inventory_paths:
                raise InventoryError(f"Unknown coverage path at line {line_number}: {json.dumps(name)}")
            if name in records:
                raise InventoryError(f"Duplicate coverage path at line {line_number}: {json.dumps(name)}")
            if not isinstance(record.get("disposition"), str) or record["disposition"] not in DISPOSITIONS:
                raise InventoryError(f"Invalid disposition at coverage line {line_number}.")
            for field in ("unit", "note"):
                if not isinstance(record.get(field), str) or not record[field].strip():
                    raise InventoryError(f"Coverage line {line_number} requires a nonempty {field}.")
            records[name] = record
    return records


def examples(label: str, paths: list[str]) -> None:
    if paths:
        suffix = f" (+{len(paths) - EXAMPLE_LIMIT} more)" if len(paths) > EXAMPLE_LIMIT else ""
        print(f"  {label}: {', '.join(json.dumps(path, ensure_ascii=True) for path in paths[:EXAMPLE_LIMIT])}{suffix}")


def check(args: argparse.Namespace) -> int:
    inventory = load_inventory(Path(args.inventory))
    original = {entry["path"]: entry for entry in inventory["files"]}
    coverage = load_coverage(Path(args.coverage), set(original))
    missing = sorted(set(original) - set(coverage))
    pending = sorted(path for path, record in coverage.items() if record["disposition"] == "pending")
    special = sorted(
        path
        for path, record in coverage.items()
        if original[path]["kind"] != "file" and record["disposition"] == "reviewed"
    )
    root = checkout_root(Path(inventory["root"]))
    if str(root) != inventory["root"]:
        raise InventoryError("Inventory root no longer identifies the same checkout root.")
    fresh = collect(root, inventory["exclusions"])
    current = {entry["path"]: entry for entry in fresh["files"]}
    added = sorted(set(current) - set(original))
    removed = sorted(set(original) - set(current))
    changed = sorted(path for path in set(current) & set(original) if current[path] != original[path])
    head_changed = fresh["head"] != inventory["head"]
    status_changed = fresh["provenance"]["in_scope_status_sha256"] != inventory["provenance"]["in_scope_status_sha256"]
    print(
        f"Coverage: {len(coverage)}/{len(original)} paths; {len(missing)} missing, "
        f"{len(pending)} pending, {len(special)} unresolved special paths."
    )
    print(
        f"Checkout: {len(added)} added, {len(removed)} removed, {len(changed)} changed; "
        f"HEAD {'changed' if head_changed else 'unchanged'}."
    )
    print(
        f"Index/worktree status: {'changed' if status_changed else 'unchanged'}; "
        f"snapshot in-scope dirty={inventory['provenance']['in_scope_dirty']}."
    )
    print(
        f"Explicit exclusions: {len(inventory['excluded_paths'])} paths at snapshot, "
        f"{len(fresh['excluded_paths'])} now; {len(inventory['exclusions'])} prefixes."
    )
    if any(entry["kind"] == "submodule" for entry in fresh["files"]):
        print(
            "Submodules: status agreement cannot prove contents unchanged inside an already dirty submodule; "
            "use separate snapshots."
        )
    for label, paths in (
        ("Missing coverage", missing),
        ("Pending", pending),
        ("Special paths need supporting/excluded", special),
        ("Added", added),
        ("Removed", removed),
        ("Changed", changed),
    ):
        examples(label, paths)
    print(PROOF_LIMIT)
    return int(bool(missing or pending or special or added or removed or changed or head_changed or status_changed))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("snapshot", help="Inventory the entire current Git checkout")
    create.add_argument("--repo", required=True, help="Checkout root or a directory inside it")
    create.add_argument("--output", required=True, help="New JSON snapshot path")
    create.add_argument(
        "--exclude-prefix",
        action="append",
        default=[],
        metavar="PATH",
        help="Explicit repository-relative path or directory prefix (repeatable)",
    )
    create.add_argument(
        "--exclude-reason",
        default="Review artifacts explicitly excluded by --exclude-prefix.",
        help="Reason recorded for every explicit exclusion prefix",
    )
    create.add_argument("--force", action="store_true", help="Atomically replace an existing snapshot")
    create.set_defaults(handler=snapshot)
    verify = commands.add_parser("check", help="Check JSONL coverage and compare the live checkout")
    verify.add_argument("--inventory", required=True)
    verify.add_argument("--coverage", required=True)
    verify.set_defaults(handler=check)
    args = parser.parse_args(argv)
    try:
        return args.handler(args)
    except (InventoryError, OSError, UnicodeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
