from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class Avatar:
    """Avatar: VRM avatar model available for animas."""

    id: str
    name: str
    file_path: str
    identity: str = ""
    user_id: str | None = None
    model_type: str = "vrm"
    animation_profile: str | None = None
    private: bool = False
    created_by_id: str | None = None
    last_updated_by_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    catalog_item_id: str | None = None
    presentation_revision: int = 1


__all__ = ["Avatar"]
