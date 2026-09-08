from __future__ import annotations

import uuid

from sqlalchemy import delete

from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.content_access_policy import ContentAccessPolicy
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
    ScannedContentEntry,
    ScannedContentFile,
)
from animama.orm.content_catalog import ORMContentCatalogItem


def _entry(locator: str) -> ScannedContentEntry:
    return ScannedContentEntry(
        source=ContentSource.LOCAL,
        kind=ContentKind.GESTURE,
        relative_locator=locator,
        display_name="Wave",
        status=ContentStatus.VALID,
        revision_sha256="a" * 64,
        files=(ScannedContentFile(locator, "primary", "model/gltf-binary", 16, "b" * 64),),
    )


def test_mutation_policy_never_treats_path_placement_as_ownership() -> None:
    entry = CatalogContentEntry(
        id="item",
        source=ContentSource.LOCAL,
        scope=ContentScope.OWNER,
        owner_user_id="owner-a",
        kind=ContentKind.GESTURE,
        relative_locator="gestures/wave.vrma",
        display_name="Wave",
        status=ContentStatus.VALID,
        revision_sha256="a" * 64,
        files=(),
    )

    assert ContentAccessPolicy.can_mutate(entry=entry, user_id="owner-a")
    assert not ContentAccessPolicy.can_mutate(entry=entry, user_id="owner-b")


async def test_catalog_hides_owner_files_but_exposes_network_shared_files(async_session) -> None:  # noqa: ANN001
    token = uuid.uuid4().hex
    owned_locator = f"gestures/{token}-owned.vrma"
    shared_locator = f"gestures/{token}-shared.vrma"
    repository = SQLAlchemyContentCatalog(async_session)
    owned = await repository.reconcile_source(
        source=ContentSource.LOCAL,
        entries=[_entry(owned_locator)],
        new_item_scope=ContentScope.OWNER,
        new_item_owner_user_id="owner-a",
    )
    items = await repository.reconcile_source(
        source=ContentSource.LOCAL,
        entries=[_entry(owned_locator), _entry(shared_locator)],
        new_item_scope=ContentScope.INSTALLATION_SHARED,
        new_item_owner_user_id=None,
    )
    owned_item = next(item for item in items if item.relative_locator == owned_locator)
    shared_item = next(item for item in items if item.relative_locator == shared_locator)

    visible_to_other = await repository.list_visible(user_id="owner-b")
    assert shared_item.id in {item.id for item in visible_to_other}
    assert owned_item.id not in {item.id for item in visible_to_other}
    assert await repository.get_visible_file(file_ref=owned_item.files[0].file_ref, user_id="owner-b") is None
    assert await repository.get_visible_file(file_ref=shared_item.files[0].file_ref, user_id="owner-b") is not None

    await async_session.execute(
        delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([item.id for item in owned + items]))
    )
    await async_session.commit()
