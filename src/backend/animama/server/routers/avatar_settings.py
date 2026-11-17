"""The local composition's per-owner Avatar settings: wind and ambient forces, and materials.

Only the local composition stores these settings, so these routes are local
(``product_http.inventory``); the shared typed Avatar routes live in
``animama.product_http.routes.typed_content``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from animama.app.contracts.avatar_settings import AvatarSettingsState, AvatarSettingsUpdate
from animama.app.services.avatar_settings_service import AvatarSettingsService
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import ProductContent, ReadContent, WriteContent
from animama.product_http.routes.content import raise_content_mutation
from animama.server.deps import get_current_principal

router = APIRouter(tags=["typed-content"])


def _settings(content: ProductContent) -> AvatarSettingsService:
    """The composition's settings store; its absence is reported rather than defaulted."""

    if content.avatar_settings is None:
        raise HTTPException(status_code=503, detail={"code": "avatar_settings_unavailable"})
    return content.avatar_settings


@router.get(
    "/v1/avatar-content/{item_id}/settings",
    response_model=AvatarSettingsState,
    operation_id="get_avatar_settings",
)
async def get_avatar_settings(
    item_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: ReadContent,
) -> AvatarSettingsState:
    """Return the caller's effective settings for a current admitted Avatar.

    Each setting reports ``stored`` with the caller's saved value, or
    ``default`` with ``automatic``. Local and Included Avatars behave alike.
    An unknown, invalid, non-Avatar or another owner's item returns 404.
    """

    settings = _settings(content)
    try:
        return await settings.get(user_id=user.id, item_id=item_id)
    except Exception as exc:
        raise_content_mutation(exc)


@router.put(
    "/v1/avatar-content/{item_id}/settings",
    response_model=AvatarSettingsState,
    operation_id="save_avatar_settings",
)
async def save_avatar_settings(
    item_id: str,
    body: AvatarSettingsUpdate,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: WriteContent,
) -> AvatarSettingsState:
    """Change the caller's settings for one Avatar and return the effective result.

    An omitted field keeps its stored value; ``automatic`` or ``null`` clears
    it. Saving never writes Avatar files or changes the Avatar's revision.
    """

    settings = _settings(content)
    try:
        return await settings.save(user_id=user.id, item_id=item_id, update=body)
    except Exception as exc:
        raise_content_mutation(exc)


__all__ = ["router"]
