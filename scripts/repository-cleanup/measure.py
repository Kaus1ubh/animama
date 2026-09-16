#!/usr/bin/env python3
"""Measure tracked working-tree inputs with pinned scc and explicit coverage.

No source is modified. Each label creates an exclusive private report directory;
the raw scc batches, per-file hashes, rules and checkout metadata are retained.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

RULES_PATH = Path(__file__).with_name("measurement-rules.json")
METRICS = ("files", "bytes", "counted_files", "lines", "code", "comments", "blank")


def command(args: list[str], root: Path) -> bytes:
    """Run a checked argv command without shell interpretation."""
    return subprocess.run(args, cwd=root, check=True, capture_output=True).stdout


def digest(path: Path) -> str:
    """Hash large model files without loading them into memory."""
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def dump(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n")


def classify(path: str, rules: dict) -> tuple[str, str]:
    """Use ordered, inspectable rules rather than inferring ownership from LOC."""
    p = PurePosixPath(path)
    if path not in rules["included_exceptions"]:
        if any(part in rules["excluded_components"] for part in p.parts):
            return "excluded", "dependency-cache-or-analysis-directory"
        if any(path.startswith(prefix) for prefix in rules["excluded_prefixes"]):
            return "excluded", "build-output-or-local-data"
        if path.endswith(tuple(rules["excluded_suffixes"])):
            return "excluded", "compiled-output"
    for rule in rules["category_rules"]:
        matches = (
            path in rule.get("paths", [])
            or p.name in rule.get("names", [])
            or any(path.startswith(prefix) for prefix in rule.get("prefixes", []))
            or any(part in rule.get("components", []) for part in p.parts[:-1])
            or path.lower().endswith(tuple(rule.get("suffixes", [])))
            or any(fnmatch.fnmatchcase(p.name, pattern) for pattern in rule.get("patterns", []))
        )
        if matches:
            return rule["category"], rule["id"]
    return rules["default_category"], "other-documentation-configuration-or-data"


def subsystem(path: str) -> str:
    """Keep backend areas, frontend workspaces, and all other top trees visible."""
    parts = PurePosixPath(path).parts
    if path.startswith("src/backend/animama/"):
        return "/".join(parts[:4]) if len(parts) > 4 else "src/backend/animama"
    if path.startswith("src/frontend/"):
        return "/".join(parts[:3]) if len(parts) > 3 else "src/frontend"
    if path.startswith("src/backend/"):
        return "/".join(parts[:3]) if len(parts) > 3 else "src/backend"
    return parts[0] if len(parts) > 1 else "(root)"


def aggregate(records: list[dict], key) -> dict:
    result = defaultdict(lambda: dict.fromkeys(METRICS, 0))
    for row in records:
        total = result[key(row)]
        total["files"] += 1
        total["bytes"] += row.get("bytes", 0)
        if row["status"] == "counted":
            total["counted_files"] += 1
            for field in METRICS[3:]:
                total[field] += row[field]
    return dict(sorted(result.items()))


def markdown(report: dict) -> str:
    """Render human-readable totals; asset bytes never count as source lines."""
    text = [
        "# Repository size baseline",
        f"Commit: `{report['git_commit']}`. Tracked inputs: {report['tracked_files']:,}.",
        "scc code lines for docs/config are text metrics, not authored application code. "
        "Assets and binary/LFS-pointer inputs have byte/file counts only. "
        "Directory rows below are disjoint subsystem totals; full parent rollups are in summary.json.",
    ]
    for title, rows in (("Categories", report["by_category"]), ("Subsystems", report["by_subsystem"])):
        table = [
            "| Group | Files | Bytes | Counted files | Lines | Code | Comments | Blank |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            *["| " + name + " | " + " | ".join(f"{row[k]:,}" for k in METRICS) + " |" for name, row in rows.items()],
        ]
        text.extend([f"## {title}", "\n".join(table)])
    text.extend(
        [
            "## Coverage",
            "\n".join(f"- {key}: {value:,}" for key, value in report["coverage"].items()),
            "Untracked files are excluded from LOC. Their status is recorded in metadata.json; "
            "measurement implementation and rules have separate hashes. "
            "The inventory includes tracked files matching ignore rules, including cloud/.",
        ]
    )
    return "\n\n".join(text) + "\n"


def measure(root: Path, output: Path, label: str, binary: Path, rules_path: Path = RULES_PATH) -> Path:
    """Record one immutable measurement; fail clearly on incomplete coverage."""
    root, output, binary = root.resolve(), output.resolve(), binary.resolve()
    if output == root or root in output.parents:
        raise ValueError("Report directory must be outside the repository checkout")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", label):
        raise ValueError("Label must be a simple directory name")
    rules_bytes = rules_path.read_bytes()
    rules = json.loads(rules_bytes)
    version = command([str(binary), "--version"], root).decode().strip()
    if version != f"scc version {rules['scc_version']}":
        raise ValueError(f"Expected scc {rules['scc_version']}; got {version}")
    destination = output / label
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    (destination / "rules.json").write_bytes(rules_bytes)
    (destination / "measure.py").write_bytes(Path(__file__).read_bytes())
    metadata = {
        "started_at": datetime.now(UTC).isoformat(),
        "project_root": str(root),
        "label": label,
        "git_commit": command(["git", "rev-parse", "HEAD"], root).decode().strip(),
        "git_version": command(["git", "--version"], root).decode().strip(),
        "python_version": sys.version,
        "scc_version": version,
        "scc_binary_sha256": digest(binary),
        "scc_binary": str(binary),
        "rules_sha256": hashlib.sha256(rules_bytes).hexdigest(),
        "wrapper_sha256": digest(Path(__file__)),
        "status_before": command(["git", "status", "--porcelain=v1", "-z"], root).decode().split("\0"),
        "invocations": [],
    }
    entries = command(["git", "ls-files", "--stage", "-z"], root)
    (destination / "tracked-index.z").write_bytes(entries)
    for name, args in (
        ("working-tree.patch", ["git", "diff", "--binary"]),
        ("index.patch", ["git", "diff", "--cached", "--binary"]),
    ):
        (destination / name).write_bytes(command(args, root))
    records, pending = [], []
    for entry in entries.split(b"\0"):
        if not entry:
            continue
        index, encoded_path = entry.split(b"\t", 1)
        mode, oid, stage = index.decode().split()
        if stage != "0":
            raise ValueError("Resolve index conflicts before establishing a baseline")
        path = os.fsdecode(encoded_path)
        category, reason = classify(path, rules)
        row = {
            "path": path,
            "category": category,
            "category_rule": reason,
            "subsystem": subsystem(path),
            "index_mode": mode,
            "index_oid": oid,
        }
        records.append(row)
        source = root / path
        if category == "excluded":
            row.update(status="excluded", reason=reason)
            continue
        try:
            info = source.lstat()
            if not stat.S_ISREG(info.st_mode):
                row.update(status="unsupported_entry", reason="symlink-or-submodule-not-followed")
                continue
            row.update(bytes=info.st_size, mtime_ns=info.st_mtime_ns, sha256=digest(source))
            with source.open("rb") as stream:
                head = stream.read(8192)
            if head.startswith(b"version https://git-lfs.github.com/spec/v1\n"):
                row.update(status="lfs_pointer", reason="payload-not-hydrated")
                match = re.search(rb"\nsize (\d+)", head)
                row["lfs_declared_bytes"] = int(match[1]) if match else None
            elif category == "runtime_assets" or b"\0" in head:
                row.update(status="bytes_only", reason="asset-or-binary")
            elif source.name in rules["scc_builtin_excluded_names"]:
                row.update(status="bytes_only", reason="scc-builtin-lockfile-exclusion")
            else:
                row["status"] = "pending"
                pending.append(row)
        except FileNotFoundError:
            row.update(status="missing", reason="tracked-path-absent-from-working-tree")
        except OSError as error:
            row.update(status="unreadable", reason=str(error))
    # Bounded argv batches avoid macOS argument limits and preserve raw tool output.
    for number, start in enumerate(range(0, len(pending), 64)):
        batch = pending[start : start + 64]
        argv = [str(binary), *rules["scc_flags"], "--", *[r["path"] for r in batch]]
        result = subprocess.run(argv, cwd=root, capture_output=True)
        (destination / f"scc-{number:03}.json").write_bytes(result.stdout)
        (destination / f"scc-{number:03}.stderr.log").write_bytes(result.stderr)
        metadata["invocations"].append({"argv": argv, "exit_code": result.returncode})
        if result.returncode:
            for row in batch:
                row.update(status="scan_error", reason=f"scc exited {result.returncode}")
            continue
        found = {}
        for language in json.loads(result.stdout or b"[]"):
            for item in language.get("Files", []):
                found[item["Location"]] = item
        for row in batch:
            item = found.get(row["path"])
            if item is None:
                row.update(status="unreported_by_scc", reason="not-in-tool-output")
            else:
                row.update(
                    status="counted",
                    language=item["Language"],
                    lines=item["Lines"],
                    code=item["Code"],
                    comments=item["Comment"],
                    blank=item["Blank"],
                )
    for row in records:
        if "sha256" not in row:
            continue
        try:
            info = (root / row["path"]).stat()
            if info.st_size != row["bytes"] or info.st_mtime_ns != row["mtime_ns"]:
                row.update(status="changed_during_scan", reason="source-stat-changed")
        except OSError:
            row.update(status="changed_during_scan", reason="source-disappeared")
    coverage = dict(sorted((key, len(value)) for key, value in _group(records, "status").items()))
    directory_rows = []
    for row in records:
        for parent in PurePosixPath(row["path"]).parents:
            directory_rows.append({**row, "directory": str(parent)})
    report = {
        "schema_version": 1,
        "git_commit": metadata["git_commit"],
        "tracked_files": len(records),
        "coverage": coverage,
        "by_category": aggregate(records, lambda r: r["category"]),
        "by_subsystem": aggregate(records, lambda r: r["subsystem"]),
        "by_directory": aggregate(directory_rows, lambda r: r["directory"]),
        "by_language_category": aggregate(records, lambda r: r["category"] + "/" + r.get("language", "not-counted")),
        "by_subsystem_category": aggregate(records, lambda r: r["subsystem"] + "/" + r["category"]),
    }
    metadata.update(
        finished_at=datetime.now(UTC).isoformat(),
        status_after=command(["git", "status", "--porcelain=v1", "-z"], root).decode().split("\0"),
    )
    metadata["checkout_stable"] = (
        entries == command(["git", "ls-files", "--stage", "-z"], root)
        and metadata["git_commit"] == command(["git", "rev-parse", "HEAD"], root).decode().strip()
    )
    dump(destination / "metadata.json", metadata)
    dump(destination / "files.json", records)
    dump(destination / "summary.json", report)
    (destination / "summary.md").write_text(markdown(report))
    gaps = set(coverage) - {"counted", "bytes_only", "excluded"}
    if gaps:
        raise ValueError(f"Incomplete coverage {sorted(gaps)}; inspect {destination / 'files.json'}")
    if not metadata["checkout_stable"]:
        raise ValueError(f"HEAD or index changed during measurement; inspect {destination}")
    return destination


def _group(records: list[dict], key: str) -> dict:
    groups = defaultdict(list)
    for row in records:
        groups[row[key]].append(row)
    return groups


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--scc", default=os.environ.get("SCC_BIN", "scc"))
    args = parser.parse_args()
    binary = shutil.which(args.scc)
    if not binary:
        parser.error("scc not found; install the pinned release or pass --scc /absolute/path/scc")
    root = Path(command(["git", "rev-parse", "--show-toplevel"], Path.cwd()).decode().strip())
    try:
        print(measure(root, args.output_dir, args.label, Path(binary)))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Measurement failed: {error}\n")


if __name__ == "__main__":
    main()
