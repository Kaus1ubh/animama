"""Filesystem watcher that invalidates catalog state but never admits bytes."""

from __future__ import annotations

import os
from collections import defaultdict
from collections.abc import Awaitable, Callable
from pathlib import Path

from watchfiles import awatch

from animama.domain.content_catalog import ContentSource

type _PathSignature = tuple[int, int, int, int, int]
_NOT_TRACKED = object()


class ContentWatcher:
    """Translate real host-file mutations into catalog reconciliation signals.

    Some host watcher implementations report a file after it was merely opened
    for reading.  Catalog and runtime delivery read many files, so forwarding
    those notifications would create an invalidation/rescan loop.  The watcher
    therefore tracks durable file metadata while deliberately ignoring access
    time.  Admission remains the scanner's responsibility.
    """

    def __init__(self, *, included_root: Path, local_root: Path, watch_included: bool = True) -> None:
        self._roots = {
            ContentSource.INCLUDED: included_root.resolve(strict=False),
            ContentSource.LOCAL: local_root.resolve(strict=False),
        }
        if not watch_included:
            del self._roots[ContentSource.INCLUDED]
        self._signatures: dict[Path, _PathSignature] = {}
        self._prime_signatures()

    @staticmethod
    def _signature(path: Path) -> _PathSignature | None:
        """Return metadata changed by durable mutations, never by plain reads."""

        try:
            stat = path.lstat()
        except OSError:
            return None
        return (
            stat.st_mode,
            stat.st_size,
            stat.st_mtime_ns,
            stat.st_ctime_ns,
            stat.st_ino,
        )

    def _prime_signatures(self) -> None:
        """Snapshot both readable roots without following user-created links."""

        for root in self._roots.values():
            if not root.is_dir():
                continue
            for directory, directory_names, file_names in os.walk(root, followlinks=False):
                parent = Path(directory)
                for name in (*directory_names, *file_names):
                    path = (parent / name).absolute()
                    signature = self._signature(path)
                    if signature is not None:
                        self._signatures[path] = signature

    def _classify_changed_path(self, changed_path: str) -> tuple[ContentSource, str] | None:
        """Classify lexically so a new symlink cannot redirect watcher bookkeeping."""

        candidate = Path(changed_path).absolute()
        for source, root in self._roots.items():
            try:
                relative = candidate.relative_to(root)
            except ValueError:
                continue
            if relative.parts and all(part not in {"", ".", ".."} for part in relative.parts):
                return source, relative.as_posix()
        return None

    def _record_if_changed(self, changed_path: str) -> tuple[ContentSource, str] | None:
        """Return a classified mutation, or ``None`` for access-only noise."""

        classified = self._classify_changed_path(changed_path)
        if classified is None:
            return None

        path = Path(changed_path).absolute()
        previous = self._signatures.get(path, _NOT_TRACKED)
        current = self._signature(path)
        if previous is _NOT_TRACKED and current is None:
            # A short-lived temporary file can be gone before a batched watcher
            # notification is consumed.  It cannot affect the readable library.
            return None
        if previous == current:
            return None
        if current is None:
            self._signatures.pop(path, None)
        else:
            self._signatures[path] = current
        return classified

    async def run(
        self,
        on_change: Callable[[ContentSource, tuple[str, ...]], Awaitable[None]],
    ) -> None:
        """Watch continuously until the containing task is cancelled."""

        async for changes in awatch(*self._roots.values(), recursive=True):
            changed_by_source: dict[ContentSource, set[str]] = defaultdict(set)
            for _, changed_path in changes:
                classified = self._record_if_changed(changed_path)
                if classified is not None:
                    source, relative_path = classified
                    changed_by_source[source].add(relative_path)
            for source, relative_paths in changed_by_source.items():
                await on_change(source, tuple(sorted(relative_paths)))


__all__ = ["ContentWatcher"]
