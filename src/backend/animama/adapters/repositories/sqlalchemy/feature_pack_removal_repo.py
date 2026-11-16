"""Reference and lease checks used before withdrawal and desktop pack removal."""

import hashlib
from datetime import datetime

from sqlalchemy import Select, exists, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.feature_packs import BlockerKind, PackRemovalBlocker
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import ORMAnimaRuntimeSnapshot
from animama.orm.avatar import ORMAvatar
from animama.orm.content_catalog import (
    ORMAnimaContentBinding,
    ORMContentCatalogDependency,
    ORMContentCatalogItem,
    ORMContentPreview,
    ORMContentPreviewFile,
)


def _label(value: str) -> str:
    return "".join(char for char in value if ord(char) >= 32 and ord(char) != 127)[:120]


async def included_source_blockers(
    session: AsyncSession, *, mount_ids: list[str], now: datetime, limit: int = 32
) -> list[PackRemovalBlocker]:
    """Check the references a user preflight and catalog withdrawal share.

    Withdrawal first drops Included items' own edges, which it rebuilds from the
    scan, so for it only Local, binding and lease references remain.
    """

    ids = select(ORMContentCatalogItem.id).where(ORMContentCatalogItem.source_mount_id.in_(mount_ids))
    checks: tuple[tuple[BlockerKind, Select[tuple[str, str]] | Select[tuple[str]]], ...] = (
        (
            "anima_loadout",
            select(ORMAnima.id, ORMAnima.display_name)
            .join(ORMAnimaContentBinding, ORMAnimaContentBinding.anima_id == ORMAnima.id)
            .where(ORMAnimaContentBinding.catalog_item_id.in_(ids))
            .distinct(),
        ),
        ("anima_loadout", select(ORMAvatar.id, ORMAvatar.name).where(ORMAvatar.catalog_item_id.in_(ids))),
        (
            "anima_loadout",
            select(ORMContentCatalogItem.id, ORMContentCatalogItem.display_name)
            .join(ORMContentCatalogDependency, ORMContentCatalogDependency.item_id == ORMContentCatalogItem.id)
            .where(ORMContentCatalogDependency.target_item_id.in_(ids), ORMContentCatalogDependency.item_id.not_in(ids))
            .distinct(),
        ),
        (
            "preview_lease",
            select(ORMContentPreview.id)
            .join(ORMContentPreviewFile)
            .where(ORMContentPreview.expires_at > now, ORMContentPreviewFile.source_mount_id.in_(mount_ids))
            .distinct(),
        ),
        (
            "runtime_lease",
            select(ORMAnimaRuntimeSnapshot.id).where(
                ORMAnimaRuntimeSnapshot.expires_at > now,
                exists(
                    select(ORMContentCatalogItem.id).where(
                        ORMContentCatalogItem.source_mount_id.in_(mount_ids),
                        ORMAnimaRuntimeSnapshot.admitted_item_revisions.has_key(ORMContentCatalogItem.id),
                    )
                ),
            ),
        ),
    )
    blockers = {}
    for kind, query in checks:
        for row in await session.execute(query.order_by(text("1")).limit(limit)):
            identifier = str(row[0])[:128]
            blockers[(kind, identifier)] = PackRemovalBlocker(
                kind, identifier, _label(str(row[1])) if len(row) > 1 else kind.replace("_", " ").capitalize()
            )
    return [blockers[key] for key in sorted(blockers)[:limit]]


async def content_operations_idle(session: AsyncSession) -> bool:
    """Never wait behind a scan/import while presenting it as a safe removal."""

    for source in ("included", "local"):
        key = int.from_bytes(hashlib.sha256(f"content-source:{source}".encode()).digest()[:8], "big", signed=True)
        if not await session.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": key}):
            return False
    return True
