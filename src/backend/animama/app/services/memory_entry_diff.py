"""Shared unified-diff formatting for current and historical memory changes."""

from __future__ import annotations

import difflib


def build_memory_unified_diff(
    *,
    old_path: str | None,
    new_path: str | None,
    old_content: str | None,
    new_content: str | None,
) -> str:
    """Return a deterministic unified diff for two memory-file snapshots."""

    before = [] if old_content is None else old_content.splitlines(keepends=True)
    after = [] if new_content is None else new_content.splitlines(keepends=True)
    fromfile = "/dev/null" if old_path is None else f"a/{old_path}"
    tofile = "/dev/null" if new_path is None else f"b/{new_path}"
    return "".join(difflib.unified_diff(before, after, fromfile=fromfile, tofile=tofile))


__all__ = ["build_memory_unified_diff"]
