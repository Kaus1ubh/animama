"""Upload processing inside the local server process.

One task, started by the application lifespan while processing is enabled,
claims durable jobs one at a time, reads each upload in a bounded child process
(:class:`~animama.adapters.parsers.isolated_user_file_parser.IsolatedUserFileParser`),
chunks and embeds it, and records the result. A heartbeat every few seconds
reports the runner live and renews its job's lease, so a long parse keeps its
claim. A graceful stop returns an unfinished job to the queue without spending
its attempt; after a crash the job is claimed again once its lease expires, and
fails as interrupted if that was its last attempt. Enqueueing wakes the runner
so a new upload starts at once; polling picks up retries.

Every local composition serves from one process. Several processes could each
run a runner safely, since claims use ``SKIP LOCKED``, but they would share one
liveness row: a process whose runner did not renew it last reports ``starting``.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any
from uuid import uuid4

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.content_store.private_file_store import FilesystemPrivateFileStorage, PrivateFileRoots
from animama.adapters.parsers.isolated_user_file_parser import IsolatedUserFileParser
from animama.adapters.repositories.sqlalchemy.runtime_worker_repo import (
    clear_document_heartbeat,
    record_document_heartbeat,
)
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_file_processing_repo import SQLAlchemyUserFileProcessingRepository
from animama.app.ports.private_file_storage import PrivateFileStorage
from animama.app.ports.text_embedder import TextEmbedder
from animama.app.ports.user_file_parser_port import UserFileParseError, UserFileParser
from animama.app.services.user_file_processing_service import (
    UserFileProcessingService,
    is_retryable_processing_failure,
    read_claimed_upload,
)
from animama.domain.user_file_processing import ClaimedUserFileProcessingJob
from animama.logging import get_logger
from animama.server.config import Settings
from animama.server.embeddings import role_embedder
from animama.server.model_roles import ModelRoleSettings
from animama.server.runtime_credentials import runtime_credentials

HEARTBEAT_SECONDS = 5.0
STOP_GRACE_SECONDS = 5.0

EmbedderResolver = Callable[[AsyncSession, str], Awaitable[TextEmbedder | None]]
"""Resolve one file owner's embeddings-role embedder, or ``None`` while embeddings are off."""

_STATE_ATTR = "user_file_processing_runner"
_log = get_logger("server.user_file_processing")


class UserFileProcessingRunner:
    """Process durable upload jobs inside the server, one at a time."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        private_storage: PrivateFileStorage,
        embedder_resolver: EmbedderResolver,
        runtime_settings: Settings,
        parser: UserFileParser | None = None,
        instance_id: str | None = None,
        heartbeat_seconds: float = HEARTBEAT_SECONDS,
        stop_grace_seconds: float = STOP_GRACE_SECONDS,
    ) -> None:
        self._session_factory = session_factory
        self._private_storage = private_storage
        self._embedder_resolver = embedder_resolver
        self._parser = parser or IsolatedUserFileParser(
            timeout_seconds=runtime_settings.anima_user_file_parse_timeout_seconds,
            memory_limit_mb=runtime_settings.anima_user_file_parse_memory_mb,
        )
        self._poll_seconds = max(0.1, runtime_settings.anima_user_file_processing_poll_seconds)
        self._lease_seconds = max(1, runtime_settings.anima_user_file_processing_lease_seconds)
        self._max_attempts = max(1, runtime_settings.anima_user_file_processing_max_attempts)
        self._max_process_bytes = max(1, runtime_settings.anima_user_file_max_process_bytes)
        # Names this runner's leases and liveness row; it is never shown to a browser.
        self._instance_id = instance_id or f"animama-server-{os.getpid()}-{uuid4().hex[:12]}"
        self._heartbeat_seconds = heartbeat_seconds
        self._stop_grace_seconds = stop_grace_seconds
        self._wake = asyncio.Event()
        self._stopping = False
        self._task: asyncio.Task[None] | None = None
        self._heartbeat: asyncio.Task[None] | None = None
        self._current: ClaimedUserFileProcessingJob | None = None

    @property
    def instance_id(self) -> str:
        """The identity this runner's heartbeat and job leases carry."""

        return self._instance_id

    def start(self) -> None:
        """Start the heartbeat and processing tasks on the running event loop."""

        if self._task is None:
            self._stopping = False
            self._heartbeat = asyncio.create_task(self._heartbeat_loop(), name="user-file-processing-heartbeat")
            self._task = asyncio.create_task(self._run(), name="user-file-processing")

    async def stop(self) -> None:
        """Give the current job a short grace period, then cancel it and clear this runner's liveness.

        A cancelled job goes back to the queue at once with its attempt given
        back; if that fails, it is claimed again once its lease expires.
        """

        self._stopping = True
        self._wake.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=self._stop_grace_seconds)
            except TimeoutError:
                unfinished = self._current
                self._task.cancel()
                with suppress(asyncio.CancelledError):
                    await self._task
                if unfinished is not None:
                    await self._release(unfinished)
            self._task = None
        if self._heartbeat is not None:
            self._heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await self._heartbeat
            self._heartbeat = None
            try:
                async with self._session_factory() as session:
                    await clear_document_heartbeat(session, instance_id=self._instance_id)
            except Exception as exc:
                _log.warning("User-file processing liveness was not cleared", error_type=exc.__class__.__name__)

    def wake(self) -> None:
        """Claim the next job now instead of at the next poll, for example after an enqueue."""

        self._wake.set()

    async def process_once(self) -> bool:
        """Claim and process one due job; return whether there was one."""

        async with self._session_factory() as session:
            claimed = await self._service(session).claim_next_job(
                worker_id=self._instance_id,
                lease_seconds=self._lease_seconds,
            )
        if claimed is None:
            return False
        await self._process(claimed)
        return True

    async def _run(self) -> None:
        while not self._stopping:
            # Cleared before claiming, so a wake during this pass starts another one.
            self._wake.clear()
            try:
                processed = await self.process_once()
            except Exception as exc:
                # The database is unavailable or similar; try again at the next poll.
                _log.warning("User-file processing pass failed", error_type=exc.__class__.__name__)
                processed = False
            if not processed and not self._stopping:
                with suppress(TimeoutError):
                    await asyncio.wait_for(self._wake.wait(), timeout=self._poll_seconds)

    async def _heartbeat_loop(self) -> None:
        """Keep the liveness row and this runner's job lease fresh, even during a long parse."""

        while True:
            try:
                async with self._session_factory() as session:
                    await record_document_heartbeat(session, instance_id=self._instance_id, worker_id=self._instance_id)
            except Exception as exc:
                _log.warning("User-file processing heartbeat failed", error_type=exc.__class__.__name__)
            await asyncio.sleep(self._heartbeat_seconds)

    async def _process(self, claimed: ClaimedUserFileProcessingJob) -> None:
        self._current = claimed
        try:
            await self._complete_or_record_failure(claimed)
        finally:
            self._current = None

    async def _complete_or_record_failure(self, claimed: ClaimedUserFileProcessingJob) -> None:
        job = claimed.job
        started = time.perf_counter()
        try:
            # A blocking file read; up to the processing limit, off the event loop.
            payload = await asyncio.to_thread(
                read_claimed_upload,
                self._private_storage,
                claimed,
                max_process_bytes=self._max_process_bytes,
            )
            async with self._session_factory() as session:
                # One set of provider keys for the whole job, even if they change meanwhile.
                with runtime_credentials.pinned():
                    embedder = await self._embedder_for(session, claimed)
                    await self._service(session).complete_claimed_job(
                        claimed=claimed,
                        payload=payload,
                        parser=self._parser,
                        embedder=embedder,
                        max_process_bytes=self._max_process_bytes,
                    )
        except Exception as exc:
            error = str(exc).strip() or exc.__class__.__name__
            retryable = is_retryable_processing_failure(exc)
            _log.warning(
                "User-file processing job failed",
                job_id=job.id,
                file_id=job.file_id,
                user_id=job.user_id,
                extension=claimed.normalized_extension,
                attempts=job.attempts,
                max_attempts=job.max_attempts,
                retryable=retryable,
                error_type=_failure_type(exc),
                error=error,
            )
            async with self._session_factory() as session:
                await self._service(session).record_claimed_job_failure(
                    claimed=claimed, error=error, retryable=retryable
                )
            return
        _log.info(
            "User-file processing job succeeded",
            job_id=job.id,
            file_id=job.file_id,
            user_id=job.user_id,
            duration_seconds=round(time.perf_counter() - started, 3),
        )

    async def _embedder_for(self, session: AsyncSession, claimed: ClaimedUserFileProcessingJob) -> TextEmbedder | None:
        """Resolve the owner's embeddings role; if that fails, the file is still processed for keyword search."""

        try:
            return await self._embedder_resolver(session, claimed.job.user_id)
        except Exception as exc:
            _log.warning(
                "User-file embedding model unavailable",
                job_id=claimed.job.id,
                user_id=claimed.job.user_id,
                error_type=exc.__class__.__name__,
            )
            await session.rollback()
            return None

    async def _release(self, claimed: ClaimedUserFileProcessingJob) -> None:
        """Return a job this runner stopped to the queue, so a restart processes it at once."""

        try:
            async with self._session_factory() as session:
                released = await self._service(session).release_claimed_job(
                    claimed=claimed, worker_id=self._instance_id
                )
        except Exception as exc:
            _log.warning(
                "Stopped user-file job is left to lease recovery",
                job_id=claimed.job.id,
                file_id=claimed.job.file_id,
                error_type=exc.__class__.__name__,
            )
            return
        if released:
            _log.info("Stopped user-file job returned to the queue", job_id=claimed.job.id, file_id=claimed.job.file_id)

    def _service(self, session: AsyncSession) -> UserFileProcessingService:
        return UserFileProcessingService(
            processing=SQLAlchemyUserFileProcessingRepository(session),
            uow=SQLAlchemyUnitOfWork(session),
            max_attempts=self._max_attempts,
        )


def _failure_type(error: BaseException) -> str:
    """Name a failure for logs: a parse names its own failure, never the file's content."""

    if isinstance(error, UserFileParseError) and error.error_type:
        return error.error_type
    return error.__class__.__name__


def start_user_file_processing(
    app: Any,
    *,
    session_factory: async_sessionmaker[AsyncSession],
    paths: PrivateFileRoots,
    runtime_settings: Settings,
) -> UserFileProcessingRunner | None:
    """Start the app's processing runner over its private upload files, unless processing is off."""

    if not runtime_settings.animama_user_file_processing_enabled:
        return None
    roles = ModelRoleSettings.for_app(app)

    async def owner_embedder(session: AsyncSession, user_id: str) -> TextEmbedder | None:
        return await role_embedder(session, user_id, roles)

    runner = UserFileProcessingRunner(
        session_factory,
        private_storage=FilesystemPrivateFileStorage(paths),
        embedder_resolver=owner_embedder,
        runtime_settings=runtime_settings,
    )
    setattr(app.state, _STATE_ATTR, runner)
    runner.start()
    return runner


async def stop_user_file_processing(app: Any) -> None:
    runner = get_user_file_processing_runner(app)
    if runner is not None:
        await runner.stop()


def get_user_file_processing_runner(app: Any) -> UserFileProcessingRunner | None:
    runner = getattr(app.state, _STATE_ATTR, None)
    return runner if isinstance(runner, UserFileProcessingRunner) else None


def request_user_file_processing_runner(request: Request) -> UserFileProcessingRunner | None:
    """FastAPI dependency: the requesting app's processing runner, if it runs one."""

    return get_user_file_processing_runner(request.app)


__all__ = [
    "EmbedderResolver",
    "UserFileProcessingRunner",
    "get_user_file_processing_runner",
    "request_user_file_processing_runner",
    "start_user_file_processing",
    "stop_user_file_processing",
]
