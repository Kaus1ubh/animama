"""Logical Avatar routes backed by Included or Local catalog items."""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.domain.content_catalog import ContentKind, ContentSource, ContentStatus
from animama.domain.request_principal import RequestPrincipal
from animama.orm.anima import ORMAnima
from animama.orm.avatar import ORMAvatar
from animama.orm.content_catalog import ORMContentCatalogFile, ORMContentCatalogItem
from animama.server.schemas.avatar import (
    PyAvatarBuiltinSource,
    PyAvatarCatalogItem,
    PyAvatarCatalogPage,
    PyAvatarCatalogQuery,
    PyAvatarCatalogSource,
    PyAvatarRegisterRequest,
    PyAvatarResponse,
    PyAvatarUpdate,
)

from ..deps import get_async_session, get_current_principal

# Removed shipped models may retain rows while historical Animas reference them.
_RETIRED_BUILTINS = {
    "avt_sample_r2": "AvatarSample_R2.vrm",
    "avt_sample_a1": "AvatarSample_A_1.vrm",
    "avt_sample_y0": "AvatarSample_Y_1.vrm",
    "avt_chibi_1": "AvatarChibi_1.vrm",
    "avt_chibi_2": "AvatarChibi_2.vrm",
    "avt_chibi_3": "AvatarChibi_3.vrm",
    "avt_chibi_4": "AvatarChibi_4.vrm",
}


router = APIRouter(prefix="/v1", tags=["avatars"])


def _response(row: ORMAvatar) -> PyAvatarResponse:
    source = (
        PyAvatarCatalogSource(
            avatar_id=row.id,
            catalog_item_id=row.catalog_item_id,
        )
        if row.catalog_item_id
        else PyAvatarBuiltinSource(avatar_id=row.id, version=1)
    )
    return PyAvatarResponse(
        id=row.id,
        name=row.name,
        file_path=row.file_path,
        identity=row.identity,
        user_id=row.user_id,
        model_type=row.model_type,
        animation_profile=row.animation_profile,
        private=row.private,
        created_at=row.created_at,
        updated_at=row.updated_at,
        catalog_item_id=row.catalog_item_id,
        source=source,
        presentation_revision=row.presentation_revision,
    )


def _can_read(row: ORMAvatar, user_id: str) -> bool:
    return not row.private or row.user_id == user_id


@router.get("/avatars", response_model=list[PyAvatarResponse])
async def list_avatars(
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    include_private: Annotated[bool, Query()] = False,
) -> list[PyAvatarResponse]:
    rows = list((await session.execute(select(ORMAvatar).order_by(ORMAvatar.name, ORMAvatar.id))).scalars())
    return [_response(row) for row in rows if _can_read(row, user.id) and (include_private or not row.private)]


@router.get("/avatars/{avatar_id}", response_model=PyAvatarResponse)
async def get_avatar(
    avatar_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyAvatarResponse:
    row = await session.get(ORMAvatar, avatar_id)
    if row is None or not _can_read(row, user.id):
        raise HTTPException(status_code=404, detail={"code": "avatar_not_found"})
    return _response(row)


@router.post("/avatars", response_model=PyAvatarResponse, status_code=status.HTTP_201_CREATED)
async def register_avatar(
    body: PyAvatarRegisterRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyAvatarResponse:
    item = await SQLAlchemyContentCatalog(session).get_visible_item(
        item_id=body.catalog_item_id,
        user_id=user.id,
    )
    if (
        item is None
        or item.kind is not ContentKind.AVATAR
        or item.source is not ContentSource.LOCAL
        or item.status is not ContentStatus.VALID
    ):
        raise HTTPException(status_code=404, detail={"code": "avatar_content_not_found"})
    existing = (
        await session.execute(select(ORMAvatar).where(ORMAvatar.catalog_item_id == item.id))
    ).scalar_one_or_none()
    if existing:
        if existing.user_id != user.id:
            raise HTTPException(status_code=404, detail={"code": "avatar_content_not_found"})
        return _response(existing)
    row = ORMAvatar(
        id=f"avatar-{uuid4().hex}",
        name=body.name.strip(),
        file_path=item.relative_locator,
        identity=body.identity,
        user_id=user.id,
        model_type="vrm",
        private=True,
        catalog_item_id=item.id,
        presentation_revision=1,
        created_by_id=user.id,
        last_updated_by_id=user.id,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _response(row)


@router.patch("/avatars/{avatar_id}", response_model=PyAvatarResponse)
async def update_avatar(
    avatar_id: str,
    body: PyAvatarUpdate,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyAvatarResponse:
    row = await session.get(ORMAvatar, avatar_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "avatar_not_found"})
    if body.name is not None:
        row.name = body.name.strip()
    if body.identity is not None:
        row.identity = body.identity
    if body.animation_profile is not None:
        row.animation_profile = body.animation_profile
    row.last_updated_by_id = user.id
    await session.commit()
    await session.refresh(row)
    return _response(row)


@router.delete("/avatars/{avatar_id}", status_code=204)
async def delete_avatar(
    avatar_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> None:
    row = await session.get(ORMAvatar, avatar_id, with_for_update=True, populate_existing=True)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "avatar_not_found"})
    in_use = (
        await session.execute(select(ORMAnima.id).where(ORMAnima.avatar_id == avatar_id).limit(1))
    ).scalar_one_or_none()
    if in_use:
        raise HTTPException(status_code=409, detail={"code": "avatar_in_use"})
    await session.delete(row)
    await session.commit()


@router.get("/avatar-catalog", response_model=PyAvatarCatalogPage)
async def list_avatar_catalog(
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    q: Annotated[str | None, Query()] = None,
    origin: Annotated[str, Query(pattern=r"^(all|included|local)$")] = "all",
    sort: Annotated[str, Query(pattern=r"^(relevance|updated|name)$")] = "name",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> PyAvatarCatalogPage:
    rows = list((await session.execute(select(ORMAvatar).order_by(ORMAvatar.name, ORMAvatar.id))).scalars())
    catalog_rows = list(
        (
            await session.execute(
                select(ORMContentCatalogItem).where(
                    ORMContentCatalogItem.kind == "avatar",
                    ORMContentCatalogItem.status == "valid",
                    or_(
                        ORMContentCatalogItem.scope.in_({"included", "installation_shared"}),
                        ORMContentCatalogItem.owner_user_id == user.id,
                    ),
                )
            )
        ).scalars()
    )
    catalog_by_locator = {item.relative_locator: item for item in catalog_rows}

    def catalog_item(row: ORMAvatar) -> ORMContentCatalogItem | None:
        if row.catalog_item_id:
            return next((item for item in catalog_rows if item.id == row.catalog_item_id), None)
        return catalog_by_locator.get(f"avatars/{PurePosixPath(row.file_path).name}")

    def row_origin(row: ORMAvatar) -> str:
        item = catalog_item(row)
        return "local" if item is not None and item.source == "local" else "included"

    # Portrait metadata belongs to the model, independently of Anima loadouts.
    portraits = (
        await session.execute(
            select(ORMContentCatalogItem.source, ORMContentCatalogItem.content_metadata, ORMContentCatalogFile.file_ref)
            .join(ORMContentCatalogFile, ORMContentCatalogFile.item_id == ORMContentCatalogItem.id)
            .where(
                or_(
                    ORMContentCatalogItem.scope.in_({"included", "installation_shared"}),
                    ORMContentCatalogItem.owner_user_id == user.id,
                ),
                ORMContentCatalogItem.kind == "appearance",
                ORMContentCatalogItem.status == "valid",
                ORMContentCatalogFile.role == "image",
            )
            .order_by(ORMContentCatalogItem.id, ORMContentCatalogFile.file_ref)
        )
    ).all()
    included_portrait_urls = {
        metadata["avatar_model"]: f"/v1/content/files/{file_ref}"
        for source, metadata, file_ref in portraits
        if source == "included" and isinstance(metadata.get("avatar_model"), str)
    }
    exact_portrait_urls = {
        metadata["presentation"]["avatar_item_id"]: f"/v1/content/files/{file_ref}"
        for _source, metadata, file_ref in portraits
        if isinstance(metadata.get("presentation"), dict)
        and isinstance(metadata["presentation"].get("avatar_item_id"), str)
    }

    needle = (q or "").strip().casefold()
    selected = [
        row
        for row in rows
        if _can_read(row, user.id)
        and not (
            row.catalog_item_id is None
            and not row.private
            and row.user_id is None
            and row.file_path == f"/shared/avatars/{_RETIRED_BUILTINS.get(row.id, '')}"
            and catalog_item(row) is None
        )
        and (not needle or needle in row.name.casefold())
        and (origin == "all" or row_origin(row) == origin)
    ][:limit]
    items: list[PyAvatarCatalogItem] = []
    for row in selected:
        item = catalog_item(row)
        source = (
            PyAvatarCatalogSource(avatar_id=row.id, catalog_item_id=item.id)
            if item is not None
            else PyAvatarBuiltinSource(avatar_id=row.id, version=1)
        )
        items.append(
            PyAvatarCatalogItem(
                avatar_id=row.id,
                catalog_item_id=item.id if item is not None else None,
                name=row.name,
                origin=row_origin(row),
                model_type=row.model_type,
                preview_url=(exact_portrait_urls.get(item.id) if item is not None else None)
                or (
                    included_portrait_urls.get(PurePosixPath(row.file_path).stem)
                    if item is not None and item.source == "included"
                    else None
                ),
                source=source,
                updated_at=row.updated_at,
            )
        )
    return PyAvatarCatalogPage(
        items=items,
        next_cursor=None,
        query=PyAvatarCatalogQuery(q=q, origin=origin, sort=sort, limit=limit),
    )


__all__ = ["router"]
