"""Owner-admitted package operations expose review facts, never staging paths."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from animama.app.contracts.content_package import MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES
from animama.app.contracts.content_package_import import ReviewedPackageImport

OperationId = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")]
Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class _PackageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class PackageSelectionRequest(_PackageRequest):
    item_ids: list[Annotated[str, Field(min_length=1, max_length=128)]] = Field(
        default_factory=list, max_length=MAX_PACKAGE_FILES
    )
    anima_id: Annotated[str, Field(min_length=1, max_length=128)] | None = None

    @model_validator(mode="after")
    def one_selection(self) -> Self:
        if bool(self.item_ids) == bool(self.anima_id) or len(set(self.item_ids)) != len(self.item_ids):
            raise ValueError("Select content items or one Anima")
        return self


class PackageExportRequest(PackageSelectionRequest):
    expected_digest: Digest


class PackageImportCreateRequest(_PackageRequest):
    operation_id: OperationId
    filename: str = Field(min_length=1, max_length=255)
    expected_size_bytes: int = Field(gt=0, le=MAX_PACKAGE_BYTES)


class PackageImportCommitRequest(_PackageRequest):
    operation_id: OperationId
    review_digest: Digest


class PackageStageStatus(BaseModel):
    """Private records are projected explicitly so internal destinations stay private."""

    model_config = ConfigDict(extra="forbid")
    stage_id: str
    operation_id: str
    filename: str
    state: str
    active: bool
    expected_size_bytes: int
    received_bytes: int
    next_part_index: int
    part_size_bytes: int
    expires_at: datetime
    review: ReviewedPackageImport | None = None
