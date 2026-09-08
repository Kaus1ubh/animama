"""Schemas for logical Avatars backed by the neutral Content Catalog."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from animama.app.contracts.base import Base


class PyAvatarBase(Base):
    """A logical VRM avatar identity available to Animas."""

    __id_prefix__ = "avt"

    name: str = Field(..., min_length=1, max_length=120)
    file_path: str = Field(..., description="Readable catalog locator for this Avatar")
    identity: str = Field(default="", max_length=20_000)
    user_id: str | None = None
    model_type: str = "vrm"
    animation_profile: str | None = None
    private: bool = False


class PyAvatarCreate(PyAvatarBase):
    id: str = PyAvatarBase.generate_id_field()


class PyAvatarUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    name: str | None = Field(default=None, min_length=1, max_length=120)
    identity: str | None = Field(default=None, max_length=20_000)
    animation_profile: str | None = None


class PyAvatarCatalogSource(BaseModel):
    model_config = {"extra": "forbid"}

    type: Literal["catalog"] = "catalog"
    avatar_id: str = Field(min_length=1)
    catalog_item_id: str = Field(min_length=1)


class PyAvatarBuiltinSource(BaseModel):
    model_config = {"extra": "forbid"}

    type: Literal["builtin"] = "builtin"
    avatar_id: str = Field(min_length=1)
    version: int = Field(default=1, ge=1)


class PyAvatarResponse(BaseModel):
    model_config = {"extra": "forbid"}

    id: str
    name: str
    file_path: str
    identity: str
    user_id: str | None = None
    model_type: str
    animation_profile: str | None = None
    private: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
    catalog_item_id: str | None = None
    source: PyAvatarCatalogSource | PyAvatarBuiltinSource
    presentation_revision: int = 1


class PyAvatarRegisterRequest(BaseModel):
    """Register one valid catalog VRM as a logical Avatar identity."""

    model_config = {"extra": "forbid"}

    catalog_item_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=120)
    identity: str = Field(default="", max_length=20_000)


class PyAvatarCatalogQuery(BaseModel):
    q: str | None = None
    origin: Literal["all", "included", "local"] = "all"
    sort: Literal["relevance", "updated", "name"] = "name"
    limit: int = 50


class PyAvatarCatalogItem(BaseModel):
    avatar_id: str
    catalog_item_id: str | None = None
    name: str
    description: str | None = None
    origin: Literal["included", "local"]
    model_type: str
    preview_url: str | None = None
    source: PyAvatarCatalogSource | PyAvatarBuiltinSource
    updated_at: datetime | None = None


class PyAvatarCatalogPage(BaseModel):
    items: list[PyAvatarCatalogItem]
    next_cursor: str | None = None
    query: PyAvatarCatalogQuery


class PyAvatarUploadInitRequest(BaseModel):
    """Legacy Anima-create staging request retained until that UI is redesigned."""

    filename: str = Field(..., min_length=1)
    content_type: str | None = None
    size_bytes: int = Field(..., gt=0)


class PyAvatarUploadInitResponse(BaseModel):
    upload_id: str
    upload_url: str
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)
    expires_at: datetime


__all__ = [name for name in globals() if name.startswith("PyAvatar")]
