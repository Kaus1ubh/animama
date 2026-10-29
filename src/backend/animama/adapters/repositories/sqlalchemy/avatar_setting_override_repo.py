"""SQLAlchemy storage for owner-scoped per-Avatar settings."""

from __future__ import annotations

from collections.abc import Collection, Mapping

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.ports.avatar_settings import AvatarSettingField, AvatarSettingOverride, AvatarSettingValue
from animama.orm.avatar_setting_override import ORMAvatarSettingOverride


class SQLAlchemyAvatarSettingOverrideRepository:
    """Always filters by the owner; the caller owns the transaction."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_items(
        self, *, owner_user_id: str, avatar_item_ids: Collection[str]
    ) -> dict[str, AvatarSettingOverride]:
        if not avatar_item_ids:
            return {}
        # Plain columns, not ORM entities: writes use Core statements, so a
        # session's identity map could otherwise return values read earlier.
        rows = await self._session.execute(
            select(
                ORMAvatarSettingOverride.avatar_item_id,
                ORMAvatarSettingOverride.spring_mode,
                ORMAvatarSettingOverride.wind_strength,
                ORMAvatarSettingOverride.material_mode,
            ).where(
                ORMAvatarSettingOverride.owner_user_id == owner_user_id,
                ORMAvatarSettingOverride.avatar_item_id.in_(list(avatar_item_ids)),
            )
        )
        return {
            row.avatar_item_id: AvatarSettingOverride(
                avatar_item_id=row.avatar_item_id,
                spring_mode=row.spring_mode,
                wind_strength=row.wind_strength,
                material_mode=row.material_mode,
            )
            for row in rows
        }

    async def update(
        self,
        *,
        owner_user_id: str,
        avatar_item_id: str,
        changes: Mapping[AvatarSettingField, AvatarSettingValue | None],
    ) -> AvatarSettingOverride | None:
        if not changes:
            return (await self.list_for_items(owner_user_id=owner_user_id, avatar_item_ids=[avatar_item_id])).get(
                avatar_item_id
            )
        values: dict[str, AvatarSettingValue | None] = {
            "spring_mode": None,
            "wind_strength": None,
            "material_mode": None,
        }
        for name, value in changes.items():
            values[name] = value
        statement = insert(ORMAvatarSettingOverride).values(
            owner_user_id=owner_user_id, avatar_item_id=avatar_item_id, **values
        )
        # The conflict update sets only the changed columns, so concurrent saves
        # of different settings both survive under the row's unique key.
        row = (
            await self._session.execute(
                statement.on_conflict_do_update(
                    index_elements=[ORMAvatarSettingOverride.owner_user_id, ORMAvatarSettingOverride.avatar_item_id],
                    set_={**{name: statement.excluded[name] for name in changes}, "updated_at": func.now()},
                ).returning(
                    ORMAvatarSettingOverride.spring_mode,
                    ORMAvatarSettingOverride.wind_strength,
                    ORMAvatarSettingOverride.material_mode,
                )
            )
        ).one()
        if row.spring_mode is None and row.wind_strength is None and row.material_mode is None:
            # Every setting is Automatic again: keep no row rather than an empty one.
            await self._session.execute(
                delete(ORMAvatarSettingOverride).where(
                    ORMAvatarSettingOverride.owner_user_id == owner_user_id,
                    ORMAvatarSettingOverride.avatar_item_id == avatar_item_id,
                )
            )
            return None
        return AvatarSettingOverride(
            avatar_item_id=avatar_item_id,
            spring_mode=row.spring_mode,
            wind_strength=row.wind_strength,
            material_mode=row.material_mode,
        )


__all__ = ["SQLAlchemyAvatarSettingOverrideRepository"]
