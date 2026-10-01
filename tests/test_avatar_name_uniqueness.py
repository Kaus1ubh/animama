"""Avatar names are unique per owner, with ownerless rows forming one namespace."""

from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.avatar_repo import SQLAlchemyAvatarRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.domain.request_principal import RequestPrincipal
from animama.orm.avatar import ORMAvatar
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.server.routers import avatar as avatar_router
from animama.server.schemas.avatar import PyAvatarRegisterRequest, PyAvatarUpdate


@pytest_asyncio.fixture
async def namespace(async_session: AsyncSession) -> AsyncIterator[str]:
    """Yield a unique suffix and remove every row created under it."""

    suffix = uuid4().hex
    try:
        yield suffix
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMAvatar).where(ORMAvatar.name.contains(suffix)))
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.contains(suffix)))
        await async_session.commit()


def _avatar(name: str, *, user_id: str | None) -> ORMAvatar:
    return ORMAvatar(
        id=f"avatar-{uuid4().hex}",
        name=name,
        file_path=f"avatars/{uuid4().hex}.vrm",
        identity="",
        user_id=user_id,
        private=user_id is not None,
    )


async def _catalog_item(
    session: AsyncSession, *, item_id: str, display_name: str, owner: str | None, source: str = "local"
) -> str:
    session.add(
        ORMContentCatalogItem(
            id=item_id,
            source=source,
            scope="owner" if owner else "included",
            owner_user_id=owner,
            kind="avatar",
            relative_locator=f"avatars/{item_id}.vrm",
            display_name=display_name,
            status="valid",
            revision_sha256="a" * 64,
        )
    )
    await session.commit()
    return item_id


async def test_two_owners_may_share_a_name_but_one_owner_may_not(async_session: AsyncSession, namespace: str) -> None:
    name = f"Shared {namespace}"
    async_session.add_all([_avatar(name, user_id=f"a-{namespace}"), _avatar(name, user_id=f"b-{namespace}")])
    await async_session.commit()

    async_session.add(_avatar(name, user_id=f"a-{namespace}"))
    with pytest.raises(IntegrityError, match="uq_avatar_owner_name"):
        await async_session.commit()


async def test_ownerless_avatars_form_one_namespace(async_session: AsyncSession, namespace: str) -> None:
    name = f"Starter {namespace}"
    async_session.add_all([_avatar(name, user_id=None), _avatar(name, user_id=f"owner-{namespace}")])
    await async_session.commit()

    async_session.add(_avatar(name, user_id=None))
    with pytest.raises(IntegrityError, match="uq_avatar_owner_name"):
        await async_session.commit()


async def test_catalog_materialization_suffixes_only_within_the_target_owner(
    async_session: AsyncSession, namespace: str
) -> None:
    owner, other = f"owner-{namespace}", f"other-{namespace}"
    name = f"Model {namespace}"
    async_session.add(_avatar(name, user_id=owner))
    await async_session.commit()
    catalog = SQLAlchemyContentCatalog(async_session)
    repo = SQLAlchemyAvatarRepository(async_session)

    other_item_id = await _catalog_item(async_session, item_id=f"other-{namespace}", display_name=name, owner=other)
    other_item = await catalog.get_visible_item(item_id=other_item_id, user_id=other)
    assert other_item is not None
    other_avatar = await repo.resolve_catalog_avatar(user_id=other, item=other_item)
    assert other_avatar.name == name

    own_item_id = await _catalog_item(async_session, item_id=f"own-{namespace}", display_name=name, owner=owner)
    own_item = await catalog.get_visible_item(item_id=own_item_id, user_id=owner)
    assert own_item is not None
    own_avatar = await repo.resolve_catalog_avatar(user_id=owner, item=own_item)
    assert own_avatar.name == f"{name} ({own_avatar.id})"

    # Included rows are ownerless; a private owner name never forces a suffix.
    included_item_id = await _catalog_item(
        async_session, item_id=f"included-{namespace}", display_name=name, owner=None, source="included"
    )
    included_item = await catalog.get_visible_item(item_id=included_item_id, user_id=owner)
    assert included_item is not None
    included_avatar = await repo.resolve_catalog_avatar(user_id=owner, item=included_item)
    await async_session.commit()
    assert (included_avatar.name, included_avatar.user_id) == (name, None)


async def test_duplicate_register_and_rename_return_conflict(async_session: AsyncSession, namespace: str) -> None:
    owner = RequestPrincipal(id=f"owner-{namespace}")
    name = f"Mine {namespace}"
    first_item = await _catalog_item(async_session, item_id=f"first-{namespace}", display_name="x", owner=owner.id)
    second_item = await _catalog_item(async_session, item_id=f"second-{namespace}", display_name="x", owner=owner.id)

    first = await avatar_router.register_avatar(
        body=PyAvatarRegisterRequest(catalog_item_id=first_item, name=name),
        user=owner,
        session=async_session,
    )
    with pytest.raises(HTTPException) as created:
        await avatar_router.register_avatar(
            body=PyAvatarRegisterRequest(catalog_item_id=second_item, name=name),
            user=owner,
            session=async_session,
        )
    assert created.value.status_code == 409
    assert isinstance(created.value.detail, dict)
    assert created.value.detail == {"code": "avatar_name_conflict"}

    second = await avatar_router.register_avatar(
        body=PyAvatarRegisterRequest(catalog_item_id=second_item, name=f"Other {namespace}"),
        user=owner,
        session=async_session,
    )
    with pytest.raises(HTTPException) as renamed:
        await avatar_router.update_avatar(
            avatar_id=second.id, body=PyAvatarUpdate(name=name), user=owner, session=async_session
        )
    assert renamed.value.status_code == 409
    assert isinstance(renamed.value.detail, dict)
    assert renamed.value.detail == {"code": "avatar_name_conflict"}

    # The failed rename leaves both rows usable and unchanged.
    names = set(await async_session.scalars(select(ORMAvatar.name).where(ORMAvatar.user_id == owner.id)))
    assert names == {first.name, f"Other {namespace}"}
