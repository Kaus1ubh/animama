"""Immutable Included mounts are custody boundaries, not creator identities."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class IncludedContentSource:
    """One supervisor-declared read-only source and its exact installed version."""

    id: str
    version: str
    root: Path
    pack_id: str | None = None

    @property
    def mount_id(self) -> str:
        """Persist a version-qualified key, never an absolute host path."""

        return f"{self.id}@{self.version}"
