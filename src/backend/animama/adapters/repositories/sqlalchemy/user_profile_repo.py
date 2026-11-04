"""SQLAlchemy repository for private local profiles."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.mappers.user_profile_map import (
    apply_user_profile_to_orm,
    user_profile_domain_to_orm,
    user_profile_orm_to_domain,
)
from animama.app.ports.user_profile_port import (
    UserProfileRepository,
    UserProfileRepositoryConflictError,
    UserProfileRepositoryConsistencyError,
)
from animama.domain.user_profile import UserProfile
from animama.orm.user_profile import ORMUserProfile


class SQLAlchemyUserProfileRepository(UserProfileRepository):
    """Persist profile and claim changes in the caller-owned transaction."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_profile(self, user_id: str, *, for_update: bool = False) -> UserProfile | None:
        stmt = select(ORMUserProfile).where(
            ORMUserProfile.user_id == user_id,
        )
        if for_update:
            stmt = stmt.with_for_update()
        result = await self._session.execute(stmt)
        orm = result.scalar_one_or_none()
        return user_profile_orm_to_domain(orm) if orm is not None else None

    async def create_profile(self, profile: UserProfile) -> UserProfile:
        orm_profile = user_profile_domain_to_orm(profile)
        self._session.add(orm_profile)
        try:
            await self._session.flush()
        except IntegrityError as exc:
            raise UserProfileRepositoryConflictError from exc
        await self._session.refresh(orm_profile)
        return user_profile_orm_to_domain(orm_profile)

    async def update_profile(self, profile: UserProfile) -> UserProfile:
        orm = await self._session.get(ORMUserProfile, profile.user_id)
        if orm is None:
            raise UserProfileRepositoryConsistencyError("User Profile disappeared during update")
        apply_user_profile_to_orm(orm, profile)
        await self._session.flush()
        await self._session.refresh(orm)
        return user_profile_orm_to_domain(orm)


__all__ = ["SQLAlchemyUserProfileRepository"]
