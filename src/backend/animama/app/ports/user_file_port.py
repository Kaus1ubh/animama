"""Repository protocol for account-owned user files."""

from __future__ import annotations

from typing import Protocol

from ...domain.user_file import UserFile


class UserFileRepository(Protocol):
    """Persistence operations for user-owned upload metadata."""

    async def create_user_file(self, user_file: UserFile) -> UserFile:
        raise NotImplementedError

    async def get_user_file(
        self,
        *,
        user_id: str,
        file_id: str,
        include_deleted: bool = False,
    ) -> UserFile | None:
        raise NotImplementedError

    async def get_user_file_for_update(
        self,
        *,
        user_id: str,
        file_id: str,
        include_deleted: bool = False,
    ) -> UserFile | None:
        raise NotImplementedError

    async def list_user_files(self, *, user_id: str) -> list[UserFile]:
        raise NotImplementedError

    async def update_user_file(self, user_file: UserFile) -> UserFile:
        raise NotImplementedError


__all__ = ["UserFileRepository"]
