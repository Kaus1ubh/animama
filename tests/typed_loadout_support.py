from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from sqlalchemy import delete

from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.avatar import ORMAvatar
from animama.orm.content_catalog import ORMContentCatalogItem


@dataclass(frozen=True, slots=True)
class LoadoutFixture:
    user_id: str
    anima_id: str
    avatar_id: str
    suffix: str


async def create_loadout_fixture(session) -> LoadoutFixture:  # noqa: ANN001
    suffix = uuid4().hex
    fixture = LoadoutFixture(
        user_id=f"loadout-user-{suffix}",
        anima_id=f"loadout-anima-{suffix}",
        avatar_id=f"loadout-avatar-{suffix}",
        suffix=suffix,
    )
    session.add(
        ORMAvatar(
            id=fixture.avatar_id,
            name=f"Loadout Avatar {suffix}",
            file_path="/test/loadout-avatar.vrm",
            identity="Typed loadout test Avatar",
        )
    )
    await session.flush()
    session.add(
        ORMAnima(
            id=fixture.anima_id,
            user_id=fixture.user_id,
            avatar_id=fixture.avatar_id,
        )
    )
    await session.flush()
    session.add(
        ORMAnimaLoadout(
            anima_id=fixture.anima_id,
            owner_user_id=fixture.user_id,
            revision=1,
            starter_catalog_version=1,
        )
    )
    await session.commit()
    return fixture


async def add_typed_item(
    session,  # noqa: ANN001
    fixture: LoadoutFixture,
    *,
    kind: str,
    name: str,
    metadata: dict[str, Any],
) -> ORMContentCatalogItem:
    item_id = f"{kind}-{uuid4().hex}"
    logical_key = str(metadata.get("content_id") or f"local:{kind}:{item_id}")
    descriptor_suffix = ".meta.json" if kind in {"gesture", "reaction"} else ".json"
    item = ORMContentCatalogItem(
        id=item_id,
        source="local",
        scope="owner",
        owner_user_id=fixture.user_id,
        kind=kind,
        relative_locator=f"{kind.replace('_', '-')}/{item_id}",
        descriptor_relative_path=(f"{kind.replace('_', '-')}/{item_id}/{item_id}{descriptor_suffix}"),
        logical_key=logical_key,
        display_name=name,
        status="valid",
        revision_sha256=(uuid4().hex * 2),
        content_metadata={
            "schema_version": 1,
            "content_type": kind,
            "content_id": logical_key,
            "name": name,
            **metadata,
        },
        diagnostics=[],
        provenance={},
    )
    session.add(item)
    await session.commit()
    return item


def catalog_source(item: ORMContentCatalogItem) -> dict[str, object]:
    return {
        "type": "catalog",
        "catalog_item_id": item.id,
        "source": item.source,
        "logical_key": item.logical_key,
    }


async def cleanup_loadout_fixture(session, fixture: LoadoutFixture) -> None:  # noqa: ANN001
    await session.execute(delete(ORMAnima).where(ORMAnima.id == fixture.anima_id))
    await session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == fixture.user_id))
    await session.execute(delete(ORMAvatar).where(ORMAvatar.id == fixture.avatar_id))
    await session.commit()
