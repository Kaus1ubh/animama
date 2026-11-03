#!/usr/bin/env python3
"""Check that the per-file source licence review covers exactly the tracked files.

Python 3.11+ is required. The repository is published as it is, so every
tracked file needs exactly one complete entry in `licenses/source-review.json`,
no entry may name a file that is no longer tracked, no licence may still be
pending and no tracked path may be private installation state. Prints each
problem and exits non-zero when there is any.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from collections import Counter
from pathlib import Path, PurePosixPath

SCHEMA = "animama-source-license-review/1"
REVIEW = "licenses/source-review.json"
FIELDS = ("path", "candidate_license", "basis", "copyright", "review")
PRIVATE_ROOTS = {"data", "cache", "backups", ".animama", ".animama-stacks"}
PRIVATE_PARTS = {"node_modules", ".venv", ".codex"}


def tracked_paths(source: Path) -> list[str]:
    output = subprocess.check_output(["git", "ls-files", "-z"], cwd=source)
    return sorted(os.fsdecode(path) for path in output.split(b"\0") if path)


def is_private_state(relative: str) -> bool:
    """Installation data, credentials and owner content never belong in the repository."""
    path = PurePosixPath(relative)
    return (
        path.parts[0] in PRIVATE_ROOTS
        or any(part in PRIVATE_PARTS for part in path.parts)
        or (path.name.startswith(".env") and path.name != ".env.example")
        or (relative.startswith("content/local/") and relative != "content/local/README.md")
    )


def is_text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def is_complete(entry: dict) -> bool:
    """Every field is non-blank text; copyright may also list several holders."""
    copyright_ = entry.get("copyright")
    holders = copyright_ if isinstance(copyright_, list) and copyright_ else [copyright_]
    return all(is_text(entry.get(field)) for field in FIELDS if field != "copyright") and all(map(is_text, holders))


def coverage(source: Path) -> dict[str, list[str]]:
    """Return the problems found, by kind; an empty result means exact coverage."""
    review = json.loads((source / REVIEW).read_text())
    if review.get("schema") != SCHEMA:
        raise ValueError(f"Unsupported source review schema in {REVIEW}")
    tracked = tracked_paths(source)
    entries, malformed = [], []
    for number, entry in enumerate(review["files"], start=1):
        path = entry.get("path") if isinstance(entry, dict) else None
        if not isinstance(path, str) or not path:
            malformed.append(f"(entry {number} has no path)")
            continue
        entries.append(entry)
        if not is_complete(entry):
            malformed.append(path)
    counts = Counter(entry["path"] for entry in entries)
    problems = {
        "malformed": malformed,
        "missing": sorted(set(tracked) - set(counts)),
        "stale": sorted(set(counts) - set(tracked)),
        "duplicate": sorted(path for path, count in counts.items() if count > 1),
        "pending": sorted({entry["path"] for entry in entries if "pending" in str(entry.get("candidate_license", ""))}),
        "private": [path for path in tracked if is_private_state(path)],
    }
    return {kind: paths for kind, paths in problems.items() if paths}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path.cwd(), help="repository root (default: current directory)")
    args = parser.parse_args()
    try:
        problems = coverage(args.source.resolve())
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Source review check failed: {error}\n")
    for kind, paths in problems.items():
        print(f"{kind}: {len(paths)}")
        for path in paths:
            print(f"  {path}")
    if problems:
        parser.exit(1, f"{REVIEW} does not match the tracked files.\n")
    print(f"{REVIEW} covers every tracked file exactly once.")


if __name__ == "__main__":
    main()
