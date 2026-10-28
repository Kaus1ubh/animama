"""Repository protocol for memory-manager runs, messages, and approvals."""

from __future__ import annotations

from typing import Protocol

from animama.domain.memory_manager import (
    MemoryManagerApproval,
    MemoryManagerMessage,
    MemoryManagerRun,
)


class MemoryManagerRepositoryConflictError(Exception):
    """Raised when storage detects a memory-manager uniqueness conflict."""

    def __init__(self, *, constraint_name: str | None = None) -> None:
        super().__init__(constraint_name or "Memory manager repository conflict")
        self.constraint_name = constraint_name


class MemoryManagerRepository(Protocol):
    """Persistence operations for the manual memory-manager workflow."""

    async def create_run(self, run: MemoryManagerRun) -> MemoryManagerRun:
        raise NotImplementedError

    async def get_run(self, *, user_id: str, run_id: str) -> MemoryManagerRun | None:
        raise NotImplementedError

    async def get_run_for_update(self, *, user_id: str, run_id: str) -> MemoryManagerRun | None:
        raise NotImplementedError

    async def list_open_runs(self, *, user_id: str) -> list[MemoryManagerRun]:
        """List the owner-started runs that are active or waiting for approval."""

        raise NotImplementedError

    async def list_open_runs_for_update(self, *, user_id: str) -> list[MemoryManagerRun]:
        """Lock and list the owner-started open runs."""

        raise NotImplementedError

    async def list_open_automatic_runs(self, *, user_id: str, for_update: bool = False) -> list[MemoryManagerRun]:
        """List the backend-started runs that are still open, optionally locking them."""

        raise NotImplementedError

    async def update_run(self, run: MemoryManagerRun) -> MemoryManagerRun:
        raise NotImplementedError

    async def create_message(self, message: MemoryManagerMessage) -> MemoryManagerMessage:
        raise NotImplementedError

    async def list_messages(self, *, user_id: str, run_id: str) -> list[MemoryManagerMessage]:
        raise NotImplementedError

    async def create_approval(self, approval: MemoryManagerApproval) -> MemoryManagerApproval:
        raise NotImplementedError

    async def get_approval(self, *, user_id: str, approval_id: str) -> MemoryManagerApproval | None:
        raise NotImplementedError

    async def get_approval_for_update(
        self,
        *,
        user_id: str,
        approval_id: str,
    ) -> MemoryManagerApproval | None:
        raise NotImplementedError

    async def update_approval(self, approval: MemoryManagerApproval) -> MemoryManagerApproval:
        raise NotImplementedError

    async def list_approvals(self, *, user_id: str, run_id: str) -> list[MemoryManagerApproval]:
        raise NotImplementedError

    async def list_approvals_for_update(
        self,
        *,
        user_id: str,
        run_id: str,
    ) -> list[MemoryManagerApproval]:
        raise NotImplementedError

    async def get_latest_approved_approval_for_entry(
        self,
        *,
        user_id: str,
        target_entry_id: str,
        for_update: bool = False,
    ) -> MemoryManagerApproval | None:
        raise NotImplementedError


__all__ = ["MemoryManagerRepository", "MemoryManagerRepositoryConflictError"]
