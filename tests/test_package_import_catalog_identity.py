"""Import admission allocates new identities even for exact bytes of a missing item."""

from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import delete

from animama.domain.content_catalog import ContentConflictError
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services, save_wave


async def test_planned_import_identity_never_resurrects_missing_equal_bytes(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths, catalog, content, saves, _packages = package_services(async_session, tmp_path)
    try:
        original = (await save_wave(saves)).item
        payload = paths.local_root / original.relative_locator
        payload.rename(payload.with_name("imported.vrma"))
        metadata = payload.with_suffix(".meta.json")
        metadata.unlink()
        imported_id = str(uuid4())
        await content.rescan(
            user_id="package-owner",
            include_included=False,
            planned_item_ids={"gestures/imported.vrma": imported_id},
        )
        current = await catalog.get_by_locator(source=original.source, relative_locator="gestures/imported.vrma")
        assert current is not None and current.id == imported_id
        old = await catalog.get_visible_item(item_id=original.id, user_id="package-owner")
        assert old is not None and old.status.value == "missing"
        with pytest.raises(ContentConflictError, match="package_destination_changed"):
            await content.rescan(
                user_id="package-owner",
                include_included=False,
                planned_item_ids={"gestures/imported.vrma": str(uuid4())},
            )
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()
