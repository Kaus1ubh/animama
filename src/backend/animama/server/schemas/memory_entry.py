from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PyMemoryEntryHeader(BaseModel):
    id: str
    parent_id: str | None = None
    anima_id: str | None = None
    scope: Literal["user", "anima"]
    type: Literal["file", "directory"]
    name: str
    path: str
    kind: str | None = None
    description: str | None = None
    version: int
    size_bytes: int | None = None
    content_sha256: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PyMemoryEntryResponse(PyMemoryEntryHeader):
    content: str | None = None
    aggregate_revision: int | None = Field(None, ge=1, description="Definition revision for Anima identity writes.")


class PyMemoryEntryListResponse(BaseModel):
    parent_id: str | None = None
    recursive: bool = False
    entries: list[PyMemoryEntryHeader] = Field(default_factory=list)


class PyAnimaIdentityItem(BaseModel):
    """One owned Anima and its content-free identity header, in creation order."""

    anima_id: str
    display_name: str
    aggregate_revision: int = Field(..., ge=1)
    identity_status: Literal["ready", "repair_required"]
    created_at: datetime | None = None
    entry: PyMemoryEntryHeader | None = Field(
        None, description="Live IDENTITY.md header, or null when the identity needs explicit repair."
    )


class PyAnimaIdentityListResponse(BaseModel):
    identities: list[PyAnimaIdentityItem] = Field(default_factory=list)


class PyMemoryEntryVersionFieldChange(BaseModel):
    old: str | None = None
    new: str | None = None


class PyMemoryEntryVersionSummary(BaseModel):
    entry_id: str
    parent_id: str | None = None
    anima_id: str | None = None
    scope: Literal["user", "anima"]
    type: Literal["file", "directory"]
    name: str
    path: str
    kind: str | None = None
    description: str | None = None
    version: int
    operation: Literal["create", "update", "move", "delete", "undo", "revert"]
    size_bytes: int | None = None
    content_sha256: str | None = None
    change_metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    deleted_at: datetime | None = None


class PyMemoryEntryVersionDetail(PyMemoryEntryVersionSummary):
    content: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    previous_version: int = Field(..., ge=0)
    unified_diff: str
    path_change: PyMemoryEntryVersionFieldChange | None = None
    description_change: PyMemoryEntryVersionFieldChange | None = None


class PyMemoryEntryVersionListResponse(BaseModel):
    entry_id: str
    versions: list[PyMemoryEntryVersionSummary] = Field(default_factory=list)
    next_before_version: int | None = None


class PyMemoryEntryCreateRequest(BaseModel):
    expected_aggregate_revision: int | None = Field(None, ge=1)
    parent_id: str | None = None
    anima_id: str | None = None
    type: Literal["file", "directory"]
    name: str
    content: str | None = None
    kind: str | None = None
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    expected_version: int | None = Field(default=0, ge=0)
    create_parents: bool = False


class PyMemoryEntryPatchRequest(BaseModel):
    expected_aggregate_revision: int | None = Field(None, ge=1)
    expected_version: int = Field(..., ge=0)
    content: str | None = None
    kind: str | None = None
    description: str | None = None
    metadata: dict[str, Any] | None = None
    name: str | None = None
    parent_id: str | None = None


class PyMemoryEntryRevertRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_version: int = Field(..., ge=1)
    expected_version: int = Field(..., ge=1)
    expected_aggregate_revision: int | None = Field(None, ge=1)


class PySearchMemoryFilesDebugRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(..., min_length=1, max_length=2048)

    @field_validator("query", mode="before")
    @classmethod
    def trim_query(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("query must not be blank")
        return normalized


class PySearchMemoryFileDebugResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    description: str | None = None
    snippet: str


class PySearchMemoryFilesDebugResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    memory_results: list[PySearchMemoryFileDebugResult] = Field(default_factory=list)


__all__ = [
    "PyMemoryEntryCreateRequest",
    "PyMemoryEntryListResponse",
    "PyMemoryEntryPatchRequest",
    "PyMemoryEntryRevertRequest",
    "PyMemoryEntryResponse",
    "PyMemoryEntryHeader",
    "PyMemoryEntryVersionDetail",
    "PyMemoryEntryVersionFieldChange",
    "PyMemoryEntryVersionListResponse",
    "PyMemoryEntryVersionSummary",
    "PySearchMemoryFileDebugResult",
    "PySearchMemoryFilesDebugRequest",
    "PySearchMemoryFilesDebugResponse",
]
