"""Repository protocol for user-file processing jobs, chunks, and search."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from animama.domain.user_file import UserFile
from animama.domain.user_file_processing import (
    ClaimedUserFileProcessingJob,
    UserFileChunkDraft,
    UserFileProcessingInfo,
    UserFileProcessingJob,
    UserFileReadableChunk,
    UserFileSearchResult,
)


class UserFileProcessingRepository(Protocol):
    """Persistence operations for file processing queues and chunk search."""

    async def get_user_file(self, *, user_id: str, file_id: str, include_deleted: bool = False) -> UserFile | None:
        raise NotImplementedError

    async def list_processing_info(
        self,
        *,
        user_id: str,
        file_ids: list[str],
    ) -> dict[str, UserFileProcessingInfo]:
        raise NotImplementedError

    async def count_chunks(self, *, user_id: str, file_id: str) -> int:
        raise NotImplementedError

    async def read_chunks(
        self,
        *,
        user_id: str,
        file_id: str,
        start_chunk: int,
        limit: int,
    ) -> list[UserFileReadableChunk]:
        """Read one searchable file's chunks in source order."""

        raise NotImplementedError

    async def get_reusable_job(self, *, user_id: str, file_id: str) -> UserFileProcessingJob | None:
        raise NotImplementedError

    async def get_latest_job(self, *, user_id: str, file_id: str) -> UserFileProcessingJob | None:
        raise NotImplementedError

    async def create_processing_job(
        self,
        *,
        job: UserFileProcessingJob,
        set_file_processing: bool = True,
    ) -> UserFileProcessingJob:
        raise NotImplementedError

    async def claim_next_job(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        now: datetime,
        limit_file_id: str | None = None,
    ) -> ClaimedUserFileProcessingJob | None:
        raise NotImplementedError

    async def replace_chunks_and_mark_success(
        self,
        *,
        job_id: str,
        user_id: str,
        file_id: str,
        sha256: str,
        chunks: list[UserFileChunkDraft],
        file_status: str,
        processing_metadata: dict,
        file_metadata_updates: dict | None = None,
        processed_at: datetime,
    ) -> UserFileProcessingJob:
        raise NotImplementedError

    async def reuse_processed_file(
        self,
        *,
        job_id: str,
        user_id: str,
        file_id: str,
        sha256: str,
        processed_at: datetime,
    ) -> UserFileProcessingJob | None:
        """Clone a same-user ready file's processed result when its digest matches."""

        raise NotImplementedError

    async def mark_job_failure(
        self,
        *,
        job_id: str,
        user_id: str,
        file_id: str,
        error: str,
        now: datetime,
        retry_delay_seconds: int,
    ) -> UserFileProcessingJob:
        raise NotImplementedError

    async def delete_chunks_for_file(self, *, user_id: str, file_id: str) -> None:
        raise NotImplementedError

    async def keyword_search(
        self,
        *,
        user_id: str,
        query: str,
        limit: int,
        file_ids: list[str] | None = None,
    ) -> list[UserFileSearchResult]:
        raise NotImplementedError

    async def semantic_search(
        self,
        *,
        user_id: str,
        embedding: list[float],
        limit: int,
        file_ids: list[str] | None = None,
    ) -> list[UserFileSearchResult]:
        raise NotImplementedError


__all__ = ["UserFileProcessingRepository"]
