#!/usr/bin/env python3
"""Inventory tracked Python inputs and preserve Vulture evidence outside Git.

Run with the pinned dev dependency: uv run python scripts/repository-cleanup/
scan-python.py --output-dir /private/path/new-run. This never imports app code.
"""

from __future__ import annotations

import argparse
import ast
import contextlib
import hashlib
import io
import json
import platform
import subprocess
import sys
import time
import tokenize
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import vulture

ROOT = Path(__file__).resolve().parents[2]
WHITELIST = Path(__file__).with_name("vulture-whitelist.py")
DEPENDENCY_PARTS = {".venv", "venv", "node_modules", "__pycache__", ".git", ".mypy_cache", ".pytest_cache"}


def git(*args: str) -> bytes:
    """Read Git inventory without following ignore rules or walking dependencies."""
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def scan(paths: list[Path], destination: Path) -> dict:
    """Capture scanner diagnostics separately from its findings exit status."""
    analyzer = vulture.Vulture()
    stdout, stderr = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        analyzer.scavenge(paths)
        input_exit = int(analyzer.exit_code)
        items = analyzer.get_unused_code(min_confidence=60)
        report_exit = int(analyzer.report(min_confidence=60))
    findings = [
        {
            "path": str(item.filename.relative_to(ROOT)) if item.filename.is_relative_to(ROOT) else str(item.filename),
            "symbol": item.name,
            "kind": item.typ,
            "line": item.first_lineno,
            "last_line": item.last_lineno,
            "confidence": item.confidence,
            "message": item.message,
        }
        for item in items
    ]
    destination.with_suffix(".stdout.txt").write_text(stdout.getvalue())
    destination.with_suffix(".stderr.txt").write_text(stderr.getvalue())
    write_json(destination.with_suffix(".json"), findings)
    return {"finding_count": len(findings), "input_exit": input_exit, "report_exit": report_exit}


def main() -> int:
    started_at = datetime.now(timezone.utc).isoformat()
    started_clock = time.monotonic()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    if vulture.__version__ != "2.16":
        parser.error(f"Expected Vulture 2.16, found {vulture.__version__}")
    output = args.output_dir.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("Evidence must be outside the checkout")
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    head = git("rev-parse", "HEAD").decode().strip()
    index = git("ls-files", "--stage", "-z")
    (output / "tracked-index.z").write_bytes(index)
    paths, inputs, excluded, errors = [], [], [], []
    for entry in index.split(b"\0"):
        if not entry:
            continue
        metadata, name = entry.split(b"\t", 1)
        relative = Path(name.decode())
        if relative.suffix not in {".py", ".spec"}:
            continue
        if DEPENDENCY_PARTS.intersection(relative.parts):
            excluded.append({"path": str(relative), "reason": "dependency/cache directory"})
            continue
        mode, _, stage = metadata.decode().split()
        path = ROOT / relative
        try:
            if mode not in {"100644", "100755"} or stage != "0" or path.is_symlink():
                raise ValueError(f"Unsupported tracked input mode/stage: {mode}/{stage}")
            sha256 = digest(path)
            with tokenize.open(path) as handle:
                ast.parse(handle.read(), filename=str(relative))
            paths.append(path)
            inputs.append({"path": str(relative), "sha256": sha256, "bytes": path.stat().st_size})
        except (OSError, ValueError, SyntaxError, UnicodeError) as error:
            errors.append({"path": str(relative), "error": str(error)})
    # Cleanup tools are explicit configuration inputs independently of Git tracking.
    # The whitelist is excluded from the raw source pass.
    paths = [path for path in paths if path != WHITELIST]
    inputs = [item for item in inputs if item["path"] != str(WHITELIST.relative_to(ROOT))]
    config_inputs = [
        {"path": str(path.relative_to(ROOT)), "sha256": digest(path)} for path in (Path(__file__), WHITELIST)
    ]
    for path in (Path(__file__), WHITELIST):
        (output / path.name).write_bytes(path.read_bytes())
    write_json(
        output / "scope.json",
        {
            "policy": "All tracked .py/.spec working-tree files; ignores do not filter Cloud",
            "inputs": inputs,
            "excluded": excluded,
            "configuration": config_inputs,
            "errors": errors,
        },
    )
    raw = scan(paths, output / "vulture-raw")
    filtered = scan([*paths, WHITELIST], output / "vulture-whitelisted")
    changed = []
    for item in [*inputs, *config_inputs]:
        try:
            if digest(ROOT / item["path"]) != item["sha256"]:
                changed.append(item["path"])
        except OSError as error:
            changed.append(item["path"])
            errors.append({"path": item["path"], "error": f"Post-scan verification: {error}"})
    stable = (
        head == git("rev-parse", "HEAD").decode().strip() and index == git("ls-files", "--stage", "-z") and not changed
    )
    status = 1 if errors or not stable or raw["input_exit"] or filtered["input_exit"] else filtered["report_exit"]
    summary = {
        "started_at": started_at,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": round(time.monotonic() - started_clock, 3),
        "head": head,
        "python": platform.python_version(),
        "vulture": vulture.__version__,
        "command": sys.argv,
        "raw": raw,
        "whitelisted": filtered,
        "input_count": len(inputs),
        "input_counts_by_root": dict(Counter(Path(item["path"]).parts[0] for item in inputs)),
        "errors": errors,
        "changed_inputs": changed,
        "stable_inputs": stable,
        "exit_code": status,
        "limitations": [
            "Vulture matches names globally, not symbol scopes; inspect suppressed-name collisions.",
            "Built-in Vulture library whitelists apply in both passes.",
            "60 percent minimum confidence; no decorator or name ignore overrides.",
            "Untracked source is outside tracked scope; wrapper and whitelist preserved separately.",
            "Findings are evidence for human review, not removal authorization.",
        ],
    }
    write_json(output / "summary.json", summary)
    print(json.dumps(summary, indent=2))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
