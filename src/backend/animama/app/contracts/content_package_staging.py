"""Portable package stage metadata; adapters own storage, locks and expiry."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

StageKind = Literal["import", "export"]
StageState = Literal[
    "uploading", "uploaded", "preparing", "reviewed", "committing", "recovery_needed", "completed", "failed"
]


@dataclass(frozen=True)
class StageLimits:
    """Aggregate reservations concern archives; expansion has its own disk bound."""

    max_stages: int = 2
    max_total_bytes: int = 8 * 1024**3
    max_archive_bytes: int = 4 * 1024**3
    max_expanded_bytes: int = 4 * 1024**3
    part_bytes: int = 8 * 1024**2
    ttl_seconds: int = 1800


class _RecordModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PartReceipt(_RecordModel):
    index: int
    offset: int
    size_bytes: int
    sha256: str


class PartAck(_RecordModel):
    stage_id: str
    index: int
    size_bytes: int
    sha256: str
    received_bytes: int
    next_part_index: int
    complete: bool


class StageRecord(_RecordModel):
    """Private durable facts. HTTP must project these rather than expose review plans."""

    version: Literal[1] = 1
    stage_id: str
    user_id: str
    kind: StageKind
    state: StageState
    operation_id: str | None = None
    filename: str
    expected_bytes: int = Field(ge=0)
    reserved_bytes: int = Field(ge=0)
    actual_bytes: int = Field(default=0, ge=0)
    received_bytes: int = Field(default=0, ge=0)
    parts: tuple[PartReceipt, ...] = ()
    archive_sha256: str | None = None
    review_digest: str | None = None
    review: dict[str, Any] | None = None
    created_at: datetime
    expires_at: datetime
