"""Single-transaction SQL retry locks, receipts, and conservative legacy evidence."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from sqlalchemy import or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.ports.anima_creation_port import CreationReceipt, StarterReceipt
from animama.orm.anima import ORMAnima
from animama.orm.anima_creation import ORMAnimaCreationReceipt, ORMAnimaStarterReceipt
from animama.orm.memory_entry import ORMMemoryEntryVersion

CREATE_OPERATION = "live_anima_create_v1"


class SQLAlchemyAnimaCreationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def lock_operation(self, *, user_id: str, operation: str, key: str) -> None:
        """Reserve absent keys without ever committing a pending receipt.

        Transaction-scoped PostgreSQL locks serialize contenders, including the
        gap before insertion. The composite receipt PK is the durable authority.
        Hash collisions only serialize unrelated requests; they cannot share data.
        """

        value = hashlib.sha256(f"{len(user_id)}:{user_id}:{operation}:{key}".encode()).digest()
        lock_id = int.from_bytes(value[:8], "big", signed=True)
        await self._session.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": lock_id})

    async def receipt(self, *, user_id: str, key: str) -> CreationReceipt | None:
        row = await self._session.get(ORMAnimaCreationReceipt, (user_id, CREATE_OPERATION, key), populate_existing=True)
        return (
            CreationReceipt(row.spec_sha256, row.anima_id, dict(row.result), row.deleted_at is not None)
            if row
            else None
        )

    async def save_receipt(self, *, user_id: str, key: str, receipt: CreationReceipt) -> None:
        self._session.add(
            ORMAnimaCreationReceipt(
                owner_user_id=user_id,
                operation=CREATE_OPERATION,
                idempotency_key=key,
                spec_sha256=receipt.spec_sha256,
                anima_id=receipt.anima_id,
                result=receipt.result,
            )
        )
        await self._session.flush()

    async def starter(self, *, user_id: str, starter_id: str) -> StarterReceipt | None:
        row = await self._session.get(ORMAnimaStarterReceipt, (user_id, starter_id), populate_existing=True)
        return (
            StarterReceipt(row.starter_id, row.spec_version, row.state, row.anima_id, list(row.diagnostics))
            if row
            else None
        )

    async def save_starter(self, *, user_id: str, receipt: StarterReceipt) -> None:
        row = await self._session.get(ORMAnimaStarterReceipt, (user_id, receipt.starter_id), populate_existing=True)
        if row is None:
            row = ORMAnimaStarterReceipt(owner_user_id=user_id, starter_id=receipt.starter_id)
            self._session.add(row)
        row.spec_version = receipt.spec_version
        row.state = receipt.state
        row.anima_id = receipt.anima_id
        row.diagnostics = receipt.diagnostics
        if receipt.state == "deleted":
            row.deleted_at = datetime.now(timezone.utc)
        await self._session.flush()

    async def mapped_starter(self, *, user_id: str, anima_id: str) -> str | None:
        return await self._session.scalar(
            select(ORMAnimaStarterReceipt.starter_id).where(
                ORMAnimaStarterReceipt.owner_user_id == user_id,
                ORMAnimaStarterReceipt.anima_id == anima_id,
            )
        )

    async def legacy_candidates(self, *, user_id: str, avatar_id: str, profile_url: str) -> tuple[list[str], bool]:
        """Prove the original seed from Version 1, preserving all later owner edits."""

        rows = (
            await self._session.execute(
                select(ORMAnima.id, ORMAnima.avatar_id, ORMAnima.profile_picture_url).where(
                    ORMAnima.user_id == user_id,
                    or_(ORMAnima.avatar_id == avatar_id, ORMAnima.profile_picture_url == profile_url),
                )
            )
        ).all()
        if not rows:
            return [], False
        history = list(
            (
                await self._session.scalars(
                    select(ORMMemoryEntryVersion).where(
                        ORMMemoryEntryVersion.user_id == user_id,
                        ORMMemoryEntryVersion.anima_id.in_([row.id for row in rows]),
                        ORMMemoryEntryVersion.normalized_path == "identity.md",
                        ORMMemoryEntryVersion.type == "file",
                        ORMMemoryEntryVersion.version == 1,
                        ORMMemoryEntryVersion.operation == "create",
                    )
                )
            ).all()
        )
        proven = set()
        for version in history:
            source = (version.metadata_ or {}).get("source", {})
            if (
                isinstance(source, dict)
                and source.get("type") == "avatar_identity_seed"
                and source.get("avatar_id") == avatar_id
                and (version.content or "").strip()
            ):
                proven.add(version.anima_id)
        matches = [
            row.id
            for row in rows
            if row.avatar_id == avatar_id and row.profile_picture_url == profile_url and row.id in proven
        ]
        return sorted(matches), len(matches) != len(rows)

    async def tombstone_anima(self, *, anima_id: str) -> None:
        """Run under the Anima deletion lock in that same transaction."""

        now = datetime.now(timezone.utc)
        await self._session.execute(
            update(ORMAnimaCreationReceipt).where(ORMAnimaCreationReceipt.anima_id == anima_id).values(deleted_at=now)
        )
        await self._session.execute(
            update(ORMAnimaStarterReceipt)
            .where(ORMAnimaStarterReceipt.anima_id == anima_id)
            .values(state="deleted", deleted_at=now, updated_at=now)
        )
