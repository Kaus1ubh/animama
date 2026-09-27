"""Model-asset install state; URLs of the release host are never exposed."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from animama.domain.model_assets import AssetFailureReason, AssetState


class PyModelAssetState(BaseModel):
    id: str
    status: Literal["not_installed", "downloading", "installed", "failed"]
    size_bytes: int
    # Free space an install needs before it starts (size plus headroom).
    required_free_bytes: int
    media_type: str
    license_ref: str
    bytes_downloaded: int | None = None
    total_bytes: int | None = None
    reason: AssetFailureReason | None = None
    content_url: str | None = None

    @classmethod
    def from_state(cls, state: AssetState) -> PyModelAssetState:
        asset = state.asset
        return cls(
            id=asset.id,
            status=state.status,
            size_bytes=asset.size,
            required_free_bytes=asset.required_free_bytes,
            media_type=asset.media_type,
            license_ref=asset.license_ref,
            bytes_downloaded=state.bytes_downloaded,
            total_bytes=state.total_bytes,
            reason=state.reason,
            content_url=f"/v1/model-assets/{asset.id}/content" if state.status == "installed" else None,
        )


class PyModelAssetList(BaseModel):
    assets: list[PyModelAssetState]
    # Free bytes in the installation store; null when it cannot be measured.
    free_bytes: int | None


__all__ = ["PyModelAssetList", "PyModelAssetState"]
