from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import HTTPException

from animama.domain.avatar import Avatar
from animama.domain.request_principal import RequestPrincipal
from animama.orm.avatar import ORMAvatar
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.server import avatar_access as avatar_access_module
from animama.server.routers import avatar as avatar_router


class _StubAvatarRepository:
    def __init__(self, avatar_by_id: dict[str, Avatar | None]) -> None:
        self.avatar_by_id = avatar_by_id

    async def get(self, avatar_id: str) -> Avatar | None:
        return self.avatar_by_id.get(avatar_id)

    async def list(self, **_kwargs) -> list[Avatar]:
        return [avatar for avatar in self.avatar_by_id.values() if avatar is not None]


@pytest.mark.asyncio
async def test_validate_avatar_access_allows_public_avatar(monkeypatch) -> None:
    avatar = Avatar(
        id="avt_sample_r1",
        name="Avatar Sample R1",
        file_path="/shared/avatars/AvatarSample_R1.vrm",
        private=False,
    )

    monkeypatch.setattr(
        avatar_access_module,
        "SQLAlchemyAvatarRepository",
        lambda session: _StubAvatarRepository({avatar.id: avatar}),
    )

    await avatar_access_module.validate_avatar_access(
        "avt_sample_r1",
        session=object(),
        user=RequestPrincipal(id="user-1"),
    )


@pytest.mark.asyncio
async def test_validate_avatar_access_rejects_unknown_avatar(monkeypatch) -> None:
    monkeypatch.setattr(
        avatar_access_module,
        "SQLAlchemyAvatarRepository",
        lambda session: _StubAvatarRepository({}),
    )

    with pytest.raises(HTTPException) as exc_info:
        await avatar_access_module.validate_avatar_access(
            "missing-avatar",
            session=object(),
            user=RequestPrincipal(id="user-1"),
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Avatar not found: missing-avatar"


@pytest.mark.asyncio
async def test_validate_avatar_access_rejects_other_users_private_avatar(monkeypatch) -> None:
    avatar = Avatar(
        id="avt_private",
        name="Private Avatar",
        file_path="/vrm/private.vrm",
        user_id="user-2",
        private=True,
    )

    monkeypatch.setattr(
        avatar_access_module,
        "SQLAlchemyAvatarRepository",
        lambda session: _StubAvatarRepository({avatar.id: avatar}),
    )

    with pytest.raises(HTTPException) as exc_info:
        await avatar_access_module.validate_avatar_access(
            "avt_private",
            session=object(),
            user=RequestPrincipal(id="user-1"),
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Access denied"


@pytest.mark.asyncio
async def test_validate_avatar_access_allows_clearing_avatar(monkeypatch) -> None:
    def _unexpected_repo(_session: object) -> _StubAvatarRepository:
        raise AssertionError("repository lookup should not run when avatar_id is empty")

    monkeypatch.setattr(
        avatar_access_module,
        "SQLAlchemyAvatarRepository",
        _unexpected_repo,
    )

    await avatar_access_module.validate_avatar_access(
        None,
        session=object(),
        user=RequestPrincipal(id="user-1"),
    )


@pytest.mark.asyncio
async def test_avatar_catalog_projects_product_rows_and_filters_origin(async_session) -> None:
    suffix = uuid4().hex
    user_id = f"user-{suffix}"
    catalog_item_id = f"content-{suffix}"
    public_id = f"public-{suffix}"
    owned_id = f"owned-{suffix}"
    async_session.add(
        ORMContentCatalogItem(
            id=catalog_item_id,
            source="local",
            scope="owner",
            owner_user_id=user_id,
            kind="avatar",
            relative_locator=f"avatars/{suffix}.vrm",
            display_name="My Avatar",
            status="valid",
            revision_sha256="a" * 64,
        )
    )
    await async_session.flush()
    async_session.add_all(
        [
            ORMAvatar(
                id=public_id,
                name=f"Starter {suffix}",
                file_path="avatars/starter.vrm",
                identity="",
                private=False,
            ),
            ORMAvatar(
                id=owned_id,
                name=f"My Avatar {suffix}",
                file_path=f"avatars/{suffix}.vrm",
                identity="",
                user_id=user_id,
                private=True,
                catalog_item_id=catalog_item_id,
            ),
        ]
    )
    await async_session.commit()

    try:
        page = await avatar_router.list_avatar_catalog(
            session=async_session,
            user=RequestPrincipal(id=user_id),
            q=None,
            origin="local",
            sort="name",
            limit=50,
        )

        assert [(row.avatar_id, row.origin) for row in page.items] == [(owned_id, "local")]
        assert page.items[0].source.model_dump() == {
            "type": "catalog",
            "avatar_id": owned_id,
            "catalog_item_id": catalog_item_id,
        }
        assert page.next_cursor is None
    finally:
        await async_session.delete(await async_session.get(ORMAvatar, public_id))
        await async_session.delete(await async_session.get(ORMAvatar, owned_id))
        await async_session.flush()
        await async_session.delete(await async_session.get(ORMContentCatalogItem, catalog_item_id))
        await async_session.commit()
