"""A benchmark run's raw results: one JSON line per turn and a run manifest (D3).

Each finished turn is appended and flushed at once, so a run stopped by its
cap, an error or an interruption keeps every turn it finished. The manifest is
rewritten whole, through a temporary file, at the start and the end of a run.
Raw results hold replies and prompts; they belong in the git-ignored
``.animama-drafts`` folder and never in a tracked report.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

from ..core.inputs import EvalInputError

__all__ = ["MANIFEST", "RUN_SCHEMA", "TURNS", "RunDirectory", "read_turns"]

RUN_SCHEMA = "animama/model-benchmark-run/1"
MANIFEST = "manifest.json"
TURNS = "turns.jsonl"


class RunDirectory:
    """A new, empty directory that one benchmark run writes."""

    def __init__(self, path: Path) -> None:
        if (path / MANIFEST).exists() or (path / TURNS).exists():
            raise EvalInputError(f"{path} already holds a benchmark run; choose a new --output-dir")
        path.mkdir(parents=True, exist_ok=True)
        self.path = path

    def append_turn(self, turn: Mapping[str, Any]) -> None:
        with (self.path / TURNS).open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(turn, ensure_ascii=False, default=str) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def write_manifest(self, manifest: Mapping[str, Any]) -> None:
        temporary = self.path / f".{MANIFEST}.tmp"
        temporary.write_text(json.dumps(manifest, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
        temporary.replace(self.path / MANIFEST)


def read_turns(path: Path) -> Iterator[dict[str, Any]]:
    """Read a run's recorded turns in the order they finished."""

    with (path / TURNS).open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)
