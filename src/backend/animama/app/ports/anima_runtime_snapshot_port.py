"""Read access to the runtime revisions issued for an owner's mounted Anima."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol


class RuntimeSnapshotView(Protocol):
    """One issued runtime revision: when its lease ends and the catalog it pins."""

    @property
    def expires_at(self) -> datetime: ...

    @property
    def catalog(self) -> dict[str, Any]: ...


class AnimaRuntimeSnapshotReader(Protocol):
    async def get_snapshot(self, *, user_id: str, anima_id: str, revision: str) -> RuntimeSnapshotView | None:
        """Return the owner's issued revision for the Anima, or ``None``."""
        ...


__all__ = ["AnimaRuntimeSnapshotReader", "RuntimeSnapshotView"]
