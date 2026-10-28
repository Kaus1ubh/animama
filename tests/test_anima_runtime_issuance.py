"""Issuance and bundle reads against a real database and Local library: results and work per request."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, select

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.anima_runtime_service import AnimaRuntimeService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.runtime_bundle_service import RuntimeBundleService
from animama.domain.anima_loadout import idle_slot_key
from animama.domain.content_catalog import CatalogContentEntry
from animama.domain.runtime_bundles import select_runtime_bundles
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout, ORMAnimaRuntimeSnapshot
from animama.orm.content_catalog import ORMAnimaContentBinding, ORMContentCatalogItem
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime
from tests.anima_creation_service_support import write_json
from tests.content_package_helpers import anima_clip
from tests.statement_counting import counted_statements

GESTURES = ("wave", "nod", "breathe")


@dataclass
class RuntimeFixture:
    owner: str
    anima_id: str
    store: FilesystemContentStore
    root: Path
    items: dict[str, CatalogContentEntry]

    def service(self, session) -> AnimaRuntimeService:  # noqa: ANN001
        return AnimaRuntimeService(session, store=self.store)


@asynccontextmanager
async def runtime_fixture(session, tmp_path: Path) -> AsyncIterator[RuntimeFixture]:  # noqa: ANN001
    """An Anima whose loadout equips two clip Gestures and one Idle Gesture from a scanned Local library."""

    owner = f"issuance-owner-{uuid4().hex}"
    # Local locators are installation-wide, so each fixture uses its own.
    suffix = uuid4().hex[:8]
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    for name in GESTURES:
        locator = f"{name}-{suffix}"
        write_json(
            paths.local_root / f"gestures/{locator}/{locator}.meta.json",
            {
                "schema_version": 1,
                "content_type": "gesture",
                "content_id": f"local:gesture:{locator}",
                "name": name,
                "semantic_key": name,
                "implementation": {"kind": "anima_clip", "file_role": "sequence"},
                "files": [{"path": f"{locator}.json", "role": "sequence"}],
            },
        )
        write_json(
            paths.local_root / f"gestures/{locator}/{locator}.json", anima_clip(clip_id=name, name=name, duration=2)
        )
    store = FilesystemContentStore(
        included_root=paths.included_root, local_root=paths.local_root, operations_root=paths.operations_root
    )
    scanned = await ContentCatalogService(store=store, catalog=SQLAlchemyContentCatalog(session)).rescan(
        user_id=owner, include_included=False
    )
    items = {item.relative_locator.split("/")[1].removesuffix(f"-{suffix}"): item for item in scanned.items}
    anima_id = f"issuance-anima-{uuid4().hex}"
    session.add(ORMAnima(id=anima_id, user_id=owner))
    await session.flush()
    session.add(ORMAnimaLoadout(anima_id=anima_id, owner_user_id=owner, revision=1, starter_catalog_version=1))
    await session.flush()
    for name in ("wave", "nod"):
        session.add(
            ORMAnimaContentBinding(
                id=str(uuid4()),
                anima_id=anima_id,
                slot_key=f"gesture:{name}",
                catalog_item_id=items[name].id,
                kind="gesture",
                config={},
            )
        )
    session.add(
        ORMAnimaContentBinding(
            id=str(uuid4()),
            anima_id=anima_id,
            slot_key=idle_slot_key("default", items["breathe"].id),
            catalog_item_id=items["breathe"].id,
            kind="gesture",
            config={},
        )
    )
    await session.commit()
    try:
        yield RuntimeFixture(owner, anima_id, store, paths.local_root, items)
    finally:
        await session.rollback()
        await session.execute(delete(ORMAnima).where(ORMAnima.id == anima_id))
        await session.execute(
            delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([item.id for item in items.values()]))
        )
        await session.commit()


async def test_issuance_stores_the_bundles_it_advertises(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    async with runtime_fixture(async_session, tmp_path) as fixture:
        issued = await fixture.service(async_session).issue(user_id=fixture.owner, anima_id=fixture.anima_id)
        snapshot = await async_session.scalar(
            select(ORMAnimaRuntimeSnapshot).where(ORMAnimaRuntimeSnapshot.anima_id == fixture.anima_id)
        )
        assert snapshot is not None
        selected = select_runtime_bundles(snapshot.catalog)
        assert len(selected) == 1
        assert [bundle["id"] for bundle in issued["bundles"]] == [bundle.id for bundle in selected]
        stored = snapshot.bundles[selected[0].id]
        assert stored["format"] == selected[0].format
        assert stored["members"] == list(selected[0].members)


async def test_a_bundle_read_loads_only_its_own_members(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    async with runtime_fixture(async_session, tmp_path) as fixture:
        service = fixture.service(async_session)
        issued = await service.issue(user_id=fixture.owner, anima_id=fixture.anima_id)
        [advertised] = issued["bundles"]
        bundles = RuntimeBundleService(service, fixture.store)
        with counted_statements(async_session) as statements:
            read = await bundles.read(
                user_id=fixture.owner,
                anima_id=fixture.anima_id,
                revision=issued["effective_revision"],
                bundle_id=advertised["id"],
            )
        assert read.complete and read.format == "json"
        assert [member["file_ref"] for member in json.loads(read.body)["members"]] == advertised["file_refs"]
        assert len(statements) == 2
        assert not any("anima_runtime_snapshots.catalog" in statement for statement in statements)
