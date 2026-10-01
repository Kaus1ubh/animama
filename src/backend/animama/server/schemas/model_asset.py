"""Model-asset install state; URLs of the release host are never exposed."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from animama.domain.model_assets import AssetFailureReason, AssetState

# Client-chosen lease identifiers, for example a UUID per loaded model.
LEASE_ID_PATTERN = r"^[A-Za-z0-9_-]{8,128}$"


class PyModelAssetState(BaseModel):
    id: str
    status: Literal["not_installed", "downloading", "installed", "failed"]
    # Total bytes of every file in the asset.
    size_bytes: int
    # Free space a fresh install needs before it starts (size plus headroom).
    required_free_bytes: int
    # A single file's media type; null for a multi-file set.
    media_type: str | None
    license_ref: str
    # Files in the asset (1 for a single file) and how many are verified so far.
    files_total: int
    files_verified: int
    # The installed version: a set's manifest digest or a file's digest; null until installed.
    version: str | None = None
    # Assets that must be installed before this one can be.
    requires: list[str] = Field(default_factory=list)
    bytes_downloaded: int | None = None
    total_bytes: int | None = None
    reason: AssetFailureReason | None = None
    # Same-origin bytes of an installed single-file asset; sets are served by their consumer's mount.
    content_url: str | None = None

    @classmethod
    def from_state(cls, state: AssetState) -> PyModelAssetState:
        asset = state.asset
        installed = state.status == "installed"
        return cls(
            id=asset.id,
            status=state.status,
            size_bytes=asset.size,
            required_free_bytes=asset.required_free_bytes,
            media_type=asset.media_type,
            license_ref=asset.license_ref,
            files_total=len(asset.files),
            files_verified=state.files_verified,
            version=asset.version if installed else None,
            requires=list(asset.requires),
            bytes_downloaded=state.bytes_downloaded,
            total_bytes=state.total_bytes,
            reason=state.reason,
            content_url=f"/v1/model-assets/{asset.id}/content" if installed and not asset.is_set else None,
        )


class PyModelAssetList(BaseModel):
    assets: list[PyModelAssetState]
    # Free bytes in the installation store; null when it cannot be measured.
    free_bytes: int | None


class PyModelAssetLeaseRequest(BaseModel):
    lease_id: str = Field(pattern=LEASE_ID_PATTERN)


class PyModelAssetLease(BaseModel):
    """A live use lease; renew it before ``expires_at`` while the asset is loaded."""

    asset_id: str
    lease_id: str
    ttl_seconds: float
    expires_at: datetime


__all__ = [
    "LEASE_ID_PATTERN",
    "PyModelAssetLease",
    "PyModelAssetLeaseRequest",
    "PyModelAssetList",
    "PyModelAssetState",
]
