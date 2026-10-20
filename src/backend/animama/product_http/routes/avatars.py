"""Logical Avatar routes backed by Included or Local catalog items, shared by every composition (ADR 0021)."""

from __future__ import annotations

from dataclasses import replace
from pathlib import PurePosixPath
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status

from animama.app.contracts.avatar import (
    PyAvatarBuiltinSource,
    PyAvatarCatalogItem,
    PyAvatarCatalogPage,
    PyAvatarCatalogQuery,
    PyAvatarCatalogSource,
    PyAvatarRegisterRequest,
    PyAvatarResponse,
    PyAvatarUpdate,
)
from animama.domain.avatar import Avatar, AvatarNameConflictError
from animama.domain.content_catalog import CatalogContentEntry, ContentKind, ContentSource, ContentStatus
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import ProductRepositories, ReadRepositories, WriteRepositories
from animama.product_http.principal import get_current_principal

# Removed shipped models may retain rows while historical Animas reference them.
_RETIRED_BUILTINS = {
    "avt_caitlyn": "AvatarSample_Y_0.vrm",
    "avt_sample_r2": "AvatarSample_R2.vrm",
    "avt_sample_a1": "AvatarSample_A_1.vrm",
    "avt_sample_y0": "AvatarSample_Y_1.vrm",
    "avt_chibi_1": "AvatarChibi_1.vrm",
    "avt_chibi_2": "AvatarChibi_2.vrm",
    "avt_chibi_3": "AvatarChibi_3.vrm",
    "avt_chibi_4": "AvatarChibi_4.vrm",
}


router = APIRouter(prefix="/v1", tags=["avatars"])


def _response(avatar: Avatar) -> PyAvatarResponse:
    source = (
        PyAvatarCatalogSource(
            avatar_id=avatar.id,
            catalog_item_id=avatar.catalog_item_id,
        )
        if avatar.catalog_item_id
        else PyAvatarBuiltinSource(avatar_id=avatar.id, version=1)
    )
    return PyAvatarResponse(
        id=avatar.id,
        name=avatar.name,
        file_path=avatar.file_path,
        identity=avatar.identity,
        user_id=avatar.user_id,
        model_type=avatar.model_type,
        animation_profile=avatar.animation_profile,
        private=avatar.private,
        created_at=avatar.created_at,
        updated_at=avatar.updated_at,
        catalog_item_id=avatar.catalog_item_id,
        source=source,
        presentation_revision=avatar.presentation_revision,
    )


def _can_read(avatar: Avatar, user_id: str) -> bool:
    return not avatar.private or avatar.user_id == user_id


async def _name_conflict(repositories: ProductRepositories) -> HTTPException:
    """Discard the failed write and report the owner's name collision."""

    await repositories.unit_of_work.rollback()
    return HTTPException(status_code=409, detail={"code": "avatar_name_conflict"})


@router.get("/avatars", response_model=list[PyAvatarResponse])
async def list_avatars(
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    repositories: ReadRepositories,
    include_private: Annotated[bool, Query()] = False,
) -> list[PyAvatarResponse]:
    avatars = await repositories.avatars.list_readable(user.id)
    return [_response(avatar) for avatar in avatars if include_private or not avatar.private]


@router.get("/avatars/{avatar_id}", response_model=PyAvatarResponse)
async def get_avatar(
    avatar_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    repositories: ReadRepositories,
) -> PyAvatarResponse:
    avatar = await repositories.avatars.get(avatar_id)
    if avatar is None or not _can_read(avatar, user.id):
        raise HTTPException(status_code=404, detail={"code": "avatar_not_found"})
    return _response(avatar)


@router.post("/avatars", response_model=PyAvatarResponse, status_code=status.HTTP_201_CREATED)
async def register_avatar(
    body: PyAvatarRegisterRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    repositories: WriteRepositories,
) -> PyAvatarResponse:
    item = await repositories.content_catalog.get_visible_item(
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
    existing = await repositories.avatars.get_by_catalog_item(item.id)
    if existing:
        if existing.user_id != user.id:
            raise HTTPException(status_code=404, detail={"code": "avatar_content_not_found"})
        return _response(existing)
    try:
        avatar = await repositories.avatars.create_owned(
            Avatar(
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
        )
        await repositories.unit_of_work.commit()
    except AvatarNameConflictError as exc:
        raise await _name_conflict(repositories) from exc
    return _response(avatar)


@router.patch("/avatars/{avatar_id}", response_model=PyAvatarResponse)
async def update_avatar(
    avatar_id: str,
    body: PyAvatarUpdate,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    repositories: WriteRepositories,
) -> PyAvatarResponse:
    avatar = await repositories.avatars.get(avatar_id)
    if avatar is None or avatar.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "avatar_not_found"})
    edited = replace(
        avatar,
        name=body.name.strip() if body.name is not None else avatar.name,
        identity=body.identity if body.identity is not None else avatar.identity,
        animation_profile=body.animation_profile if body.animation_profile is not None else avatar.animation_profile,
        last_updated_by_id=user.id,
    )
    try:
        avatar = await repositories.avatars.update_owned(edited)
        await repositories.unit_of_work.commit()
    except AvatarNameConflictError as exc:
        raise await _name_conflict(repositories) from exc
    return _response(avatar)


@router.delete("/avatars/{avatar_id}", status_code=204)
async def delete_avatar(
    avatar_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    repositories: WriteRepositories,
) -> None:
    avatar = await repositories.avatars.get(avatar_id, for_update=True)
    if avatar is None or avatar.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "avatar_not_found"})
    if await repositories.avatars.is_in_use(avatar_id):
        raise HTTPException(status_code=409, detail={"code": "avatar_in_use"})
    await repositories.avatars.delete(avatar_id)
    await repositories.unit_of_work.commit()


@router.get("/avatar-catalog", response_model=PyAvatarCatalogPage)
async def list_avatar_catalog(
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    repositories: ReadRepositories,
    q: Annotated[str | None, Query()] = None,
    origin: Annotated[str, Query(pattern=r"^(all|included|local)$")] = "all",
    sort: Annotated[str, Query(pattern=r"^(relevance|updated|name)$")] = "name",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> PyAvatarCatalogPage:
    avatars = await repositories.avatars.list_readable(user.id)
    visible = await repositories.content_catalog.list_visible(user_id=user.id)
    valid = [item for item in visible if item.status is ContentStatus.VALID]
    catalog_rows = [item for item in valid if item.kind is ContentKind.AVATAR]
    catalog_by_locator = {item.relative_locator: item for item in catalog_rows}

    def catalog_item(avatar: Avatar) -> CatalogContentEntry | None:
        if avatar.catalog_item_id:
            return next((item for item in catalog_rows if item.id == avatar.catalog_item_id), None)
        return catalog_by_locator.get(f"avatars/{PurePosixPath(avatar.file_path).name}")

    def avatar_origin(avatar: Avatar) -> str:
        item = catalog_item(avatar)
        return "local" if item is not None and item.source is ContentSource.LOCAL else "included"

    # Portrait metadata belongs to the model, independently of Anima loadouts.
    portraits = sorted(
        (
            (item.id, file.file_ref, item.source, item.metadata)
            for item in valid
            if item.kind is ContentKind.APPEARANCE
            for file in item.files
            if file.role == "image"
        ),
        key=lambda portrait: (portrait[0], portrait[1]),
    )
    included_portrait_urls = {
        metadata["avatar_model"]: f"/v1/content/files/{file_ref}"
        for _item_id, file_ref, source, metadata in portraits
        if source is ContentSource.INCLUDED and isinstance(metadata.get("avatar_model"), str)
    }
    exact_portrait_urls = {
        metadata["presentation"]["avatar_item_id"]: f"/v1/content/files/{file_ref}"
        for _item_id, file_ref, _source, metadata in portraits
        if isinstance(metadata.get("presentation"), dict)
        and isinstance(metadata["presentation"].get("avatar_item_id"), str)
    }

    needle = (q or "").strip().casefold()
    selected = [
        avatar
        for avatar in avatars
        if not (
            avatar.catalog_item_id is None
            and not avatar.private
            and avatar.user_id is None
            and avatar.file_path == f"/shared/avatars/{_RETIRED_BUILTINS.get(avatar.id, '')}"
            and catalog_item(avatar) is None
        )
        and (not needle or needle in avatar.name.casefold())
        and (origin == "all" or avatar_origin(avatar) == origin)
    ][:limit]
    items: list[PyAvatarCatalogItem] = []
    for avatar in selected:
        item = catalog_item(avatar)
        source = (
            PyAvatarCatalogSource(avatar_id=avatar.id, catalog_item_id=item.id)
            if item is not None
            else PyAvatarBuiltinSource(avatar_id=avatar.id, version=1)
        )
        items.append(
            PyAvatarCatalogItem(
                avatar_id=avatar.id,
                catalog_item_id=item.id if item is not None else None,
                name=avatar.name,
                origin=avatar_origin(avatar),
                model_type=avatar.model_type,
                preview_url=(exact_portrait_urls.get(item.id) if item is not None else None)
                or (
                    included_portrait_urls.get(PurePosixPath(avatar.file_path).stem)
                    if item is not None and item.source is ContentSource.INCLUDED
                    else None
                ),
                source=source,
                updated_at=avatar.updated_at,
            )
        )
    return PyAvatarCatalogPage(
        items=items,
        next_cursor=None,
        query=PyAvatarCatalogQuery(q=q, origin=origin, sort=sort, limit=limit),
    )


__all__ = ["router"]
