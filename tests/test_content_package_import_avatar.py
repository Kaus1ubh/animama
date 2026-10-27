"""Standalone imported Avatars participate in the logical Library lifecycle."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService, ExportedContentPackage
from animama.domain.content_catalog import ContentConflictError, ContentKind
from animama.domain.request_principal import RequestPrincipal
from animama.orm import ORMAnima, ORMAvatar
from animama.product_http.routes.avatars import list_avatar_catalog
from tests.anima_creation_service_support import (
    AnimaCreationFixture,
    anima_creation_fixture,
    vrm,
    write_file,
    write_json,
)
from tests.content_package_helpers import CONVERTED_AVATAR_EXTENSIONS, reviewed_export, reviewed_import


async def _package(
    session: AsyncSession, fixture: AnimaCreationFixture
) -> tuple[SQLAlchemyContentCatalog, ContentCatalogService, ContentPackageService, ExportedContentPackage]:
    """Use the normal import UoW without creating a source or destination Anima.

    The Local Avatar is read again from the rescan, so a test may replace its file first.
    """
    write_json(
        fixture.paths.local_root / "appearances/picture.meta.json",
        {"name": "Portrait", "presentation": {"avatar_item_id": fixture.items["local-avatar"].id}},
    )
    catalog = SQLAlchemyContentCatalog(session)
    content = ContentCatalogService(catalog=catalog, store=fixture.store())
    scanned = await content.rescan(user_id=fixture.owner)
    avatar = next(item for item in scanned.items if item.id == fixture.items["local-avatar"].id)
    uow = SQLAlchemyAnimaAggregateUnitOfWork(session)
    await uow.avatars.resolve_catalog_avatar(user_id=fixture.owner, item=avatar)
    await session.commit()
    packages = ContentPackageService(
        content=content,
        exports_root=fixture.paths.exports_staging_root,
        imports_root=fixture.paths.imports_staging_root,
        uow=uow,
    )
    exported = await reviewed_export(packages, user_id=fixture.owner, root_item_id=fixture.items["local-avatar"].id)
    return catalog, content, packages, exported


async def test_standalone_avatar_copies_are_listed_with_portraits_and_delete_without_orphans(
    async_session: AsyncSession, tmp_path: Path
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        catalog, content, packages, exported = await _package(async_session, fixture)
        copies = []
        for operation in ("first-avatar", "second-avatar"):
            command = await reviewed_import(
                packages, user_id=fixture.owner, archive_path=exported.path, operation_id=operation
            )
            result = await packages.imports.commit(**command)
            packages.stages.discard(fixture.owner, command["stage_id"])
            assert result.anima_id is None
            copied_id = next(item.item_id for item in result.items if item.kind is ContentKind.AVATAR)
            copied = await catalog.get_visible_item(item_id=copied_id, user_id=fixture.owner)
            assert copied is not None and copied.revision_sha256 is not None
            page = await list_avatar_catalog(
                user=RequestPrincipal(id=fixture.owner),
                repositories=SQLAlchemyProductRepositories(async_session),
                q=copied.display_name,
                origin="local",
                sort="name",
                limit=50,
            )
            match = next((item for item in page.items if item.catalog_item_id == copied_id), None)
            assert match is not None, "Committed standalone Avatar must be discoverable in Library"
            assert match.name == copied.display_name and match.preview_url is not None
            image = await content.open_registered_file(
                file_ref=match.preview_url.rsplit("/", 1)[-1], user_id=fixture.owner
            )
            with image.handle:
                assert image.handle.read() == (fixture.paths.local_root / "appearances/picture.png").read_bytes()
            hidden = await list_avatar_catalog(
                user=RequestPrincipal(id="other-owner"),
                repositories=SQLAlchemyProductRepositories(async_session),
                q=copied.display_name,
                origin="local",
                sort="name",
                limit=50,
            )
            assert all(item.catalog_item_id != copied_id for item in hidden.items)
            assert await packages.imports.commit(**command) == result
            assert (
                len(
                    list(
                        await async_session.scalars(select(ORMAvatar.id).where(ORMAvatar.catalog_item_id == copied_id))
                    )
                )
                == 1
            )
            copies.append((copied, match.avatar_id, command, result))
        first, second = copies
        assert first[0].id != second[0].id and first[1] != second[1]
        assert first[0].logical_key != second[0].logical_key
        await content.delete_item(
            item_id=first[0].id, user_id=fixture.owner, expected_revision=first[0].revision_sha256 or ""
        )
        assert await async_session.get(ORMAvatar, first[1]) is None
        assert await catalog.get_visible_item(item_id=first[0].id, user_id=fixture.owner) is None
        assert await async_session.get(ORMAvatar, second[1]) is not None
        assert await packages.imports.commit(**first[2]) == first[3]
        assert await async_session.get(ORMAvatar, first[1]) is None
        assert (fixture.paths.local_root / second[0].relative_locator).is_file()
        assert (fixture.paths.local_root / fixture.items["local-avatar"].relative_locator).is_file()


@pytest.mark.parametrize("extension", CONVERTED_AVATAR_EXTENSIONS)
async def test_avatar_file_using_a_converter_or_compression_extension_exports_and_imports(
    async_session: AsyncSession, tmp_path: Path, extension: str
) -> None:
    """Converted and optimized Avatars share like any other; their bytes travel unchanged."""
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        original = vrm("Converted avatar", uses=extension)
        write_file(fixture.paths.local_root / "avatars/local-avatar.vrm", original)
        catalog, _content, packages, exported = await _package(async_session, fixture)
        command = await reviewed_import(
            packages, user_id=fixture.owner, archive_path=exported.path, operation_id=f"import-{extension}"
        )
        result = await packages.imports.commit(**command)
        copied_id = next(item.item_id for item in result.items if item.kind is ContentKind.AVATAR)
        copied = await catalog.get_visible_item(item_id=copied_id, user_id=fixture.owner)
        assert copied is not None and copied.id != fixture.items["local-avatar"].id
        assert (fixture.paths.local_root / copied.relative_locator).read_bytes() == original


@pytest.mark.parametrize("after_commit", [False, True])
async def test_standalone_avatar_registration_shares_rollback_and_receipt_replay(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, after_commit: bool
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        catalog, _content, packages, exported = await _package(async_session, fixture)
        command = await reviewed_import(
            packages, user_id=fixture.owner, archive_path=exported.path, operation_id="avatar-commit-fault"
        )
        before = set(await async_session.scalars(select(ORMAvatar.id).where(ORMAvatar.user_id == fixture.owner)))
        before_items = {item.id for item in await catalog.list_visible(user_id=fixture.owner)}
        with monkeypatch.context() as patch:
            commit = async_session.commit
            attempted = False

            async def uncertain_commit() -> None:
                nonlocal attempted
                if attempted:
                    return await commit()
                attempted = True
                if after_commit:
                    await commit()
                raise RuntimeError("unknown commit outcome")

            patch.setattr(async_session, "commit", uncertain_commit)
            if after_commit:
                await packages.imports.commit(**command)
            else:
                with pytest.raises(RuntimeError, match="unknown commit outcome"):
                    await packages.imports.commit(**command)
                assert (
                    set(await async_session.scalars(select(ORMAvatar.id).where(ORMAvatar.user_id == fixture.owner)))
                    == before
                )
                assert {item.id for item in await catalog.list_visible(user_id=fixture.owner)} == before_items
                assert not (fixture.paths.local_root / "avatars/local-avatar-2.vrm").exists()
        completed = await packages.imports.commit(**command)
        assert (
            len(
                set(await async_session.scalars(select(ORMAvatar.id).where(ORMAvatar.user_id == fixture.owner)))
                - before
            )
            == 1
        )
        assert await packages.imports.commit(**command) == completed


async def test_typed_avatar_delete_preserves_live_mapping_and_rolls_back_failed_cleanup(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        catalog, content, packages, exported = await _package(async_session, fixture)
        command = await reviewed_import(
            packages, user_id=fixture.owner, archive_path=exported.path, operation_id="delete-avatar-copy"
        )
        result = await packages.imports.commit(**command)
        copied_id = next(item.item_id for item in result.items if item.kind is ContentKind.AVATAR)
        copied = await catalog.get_visible_item(item_id=copied_id, user_id=fixture.owner)
        assert copied is not None and copied.revision_sha256 is not None
        logical_id = await async_session.scalar(select(ORMAvatar.id).where(ORMAvatar.catalog_item_id == copied_id))
        assert logical_id is not None
        with monkeypatch.context() as patch:

            def failed_delete(**_kwargs: Any) -> None:
                raise OSError("disk unavailable")

            patch.setattr(content.mutations.store, "delete_entry", failed_delete)
            with pytest.raises(OSError, match="disk unavailable"):
                await content.delete_item(
                    item_id=copied.id, user_id=fixture.owner, expected_revision=copied.revision_sha256
                )
        assert await async_session.get(ORMAvatar, logical_id) is not None
        assert (fixture.paths.local_root / copied.relative_locator).is_file()
        async_session.add(
            ORMAnima(id="avatar-keep-live", user_id=fixture.owner, display_name="Keep", avatar_id=logical_id)
        )
        await async_session.commit()
        with pytest.raises(ContentConflictError, match="catalog_item_in_use"):
            await content.delete_item(
                item_id=copied.id, user_id=fixture.owner, expected_revision=copied.revision_sha256
            )
        assert await async_session.get(ORMAvatar, logical_id) is not None
