"""User-file processing worker.

Run with:
    uv run --extra file-worker python -m animama.workers.user_file_processing
"""

from __future__ import annotations

import asyncio
import inspect
import os
import socket
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from animama.adapters.content_store.private_file_store import FilesystemPrivateFileStorage
from animama.adapters.parsers.docling_user_file_parser import DoclingUserFileParser
from animama.adapters.repositories.sqlalchemy.runtime_worker_repo import (
    clear_document_heartbeat,
    record_document_heartbeat,
)
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_file_processing_repo import SQLAlchemyUserFileProcessingRepository
from animama.app.ports.private_file_storage import PrivateFileStorage
from animama.app.ports.text_embedder import TextEmbedder
from animama.app.services.user_file_processing_service import UserFileProcessingService
from animama.domain.user_file_processing import ClaimedUserFileProcessingJob
from animama.logging_config import get_logger
from animama.server.config import settings
from animama.server.local_runtime import initialize_local_runtime
from animama.workers.shutdown import install_shutdown_handlers

log = get_logger("user-file.processing-worker")

EmbedderResolver = Callable[[AsyncSession, str], Awaitable[TextEmbedder | None]]
"""Resolve the embeddings-role embedder for one file owner."""


class UserFileProcessingWorker:
    """Poll Postgres for file processing jobs and execute them in this process."""

    def __init__(
        self,
        *,
        database_url: str,
        worker_id: str,
        poll_seconds: float,
        batch_size: int,
        lease_seconds: int,
        max_attempts: int,
        max_process_bytes: int,
        parser: Any | None = None,
        embedder_resolver: EmbedderResolver | None = None,
        object_loader: Callable[[str | None], bytes | None] | None = None,
        private_storage: PrivateFileStorage | None = None,
        warm_docling: bool = settings.anima_user_file_docling_warmup,
        instance_id: str | None = None,
    ) -> None:
        self._database_url = database_url
        self._worker_id = worker_id
        self._instance_id = instance_id or worker_id
        self._poll_seconds = max(0.1, poll_seconds)
        self._batch_size = max(1, batch_size)
        self._lease_seconds = max(1, lease_seconds)
        self._max_attempts = max(1, max_attempts)
        self._max_process_bytes = max(1, max_process_bytes)
        self._parser = parser or DoclingUserFileParser(
            timeout_seconds=settings.anima_user_file_docling_timeout_seconds,
            enable_ocr=settings.anima_user_file_docling_enable_ocr,
            do_table_structure=settings.anima_user_file_docling_do_table_structure,
            accelerator=settings.anima_user_file_docling_accelerator,
            num_threads=settings.anima_user_file_docling_num_threads,
            table_mode=settings.anima_user_file_docling_table_mode,
            chunk_max_tokens=settings.anima_user_file_chunk_max_tokens,
            tokenizer_model=settings.anima_user_file_chunk_tokenizer_model,
            artifacts_path=settings.animama_docling_artifacts_path,
        )
        self._embedder_resolver = embedder_resolver or _role_embedder
        self._object_loader = object_loader
        self._private_storage = private_storage
        if self._object_loader is None and self._private_storage is None:
            self._private_storage = FilesystemPrivateFileStorage(initialize_local_runtime(settings))
        self._warm_docling = warm_docling
        self._running = False
        self._stop_event = asyncio.Event()
        self._session_factory: async_sessionmaker[AsyncSession] | None = None

    async def start(self) -> None:
        engine = create_async_engine(self._database_url, echo=False)
        self._session_factory = async_sessionmaker(engine, expire_on_commit=False)
        self._running = not self._stop_event.is_set()
        heartbeat = asyncio.create_task(self._heartbeat_loop())
        log.info(
            "User-file processing worker started",
            worker_id=self._worker_id,
            poll_seconds=self._poll_seconds,
            batch_size=self._batch_size,
            lease_seconds=self._lease_seconds,
            max_attempts=self._max_attempts,
            max_process_bytes=self._max_process_bytes,
            docling_warmup=self._warm_docling,
        )
        try:
            if self._warm_docling and self._running:
                await self._warm_parser()
            await self._run_loop()
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat
            with suppress(Exception):
                async with self._session_factory() as session:
                    await clear_document_heartbeat(session, instance_id=self._instance_id)
            await engine.dispose()

    async def stop(self) -> None:
        self._running = False
        self._stop_event.set()
        log.info("User-file processing worker stopping", worker_id=self._worker_id)

    async def _run_loop(self) -> None:
        while self._running:
            try:
                processed = await self.process_once()
                if processed == 0:
                    await self._wait_for_stop(self._poll_seconds)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                log.error("User-file processing loop failed", error=str(exc))
                await self._wait_for_stop(self._poll_seconds)

    async def _wait_for_stop(self, seconds: float) -> None:
        """Wake immediately on shutdown instead of claiming another batch."""

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(self._stop_event.wait(), timeout=seconds)

    async def _heartbeat_loop(self) -> None:
        """Keep liveness and running leases fresh even during a long parser call."""

        while not self._stop_event.is_set():
            try:
                if self._session_factory is not None:
                    async with self._session_factory() as session:
                        await record_document_heartbeat(
                            session, instance_id=self._instance_id, worker_id=self._worker_id
                        )
            except Exception as exc:
                log.warning("Document worker heartbeat failed", error_type=type(exc).__name__)
            await self._wait_for_stop(5)

    async def process_once(self) -> int:
        """Process up to the configured batch size and return jobs attempted."""

        if self._session_factory is None:
            return 0

        processed = 0
        for _ in range(self._batch_size):
            if self._stop_event.is_set():
                break
            claimed = await self._claim_one()
            if claimed is None:
                break
            processed += 1
            await self._process_claimed(claimed)
        return processed

    async def _claim_one(self) -> ClaimedUserFileProcessingJob | None:
        if self._session_factory is None:
            return None
        async with self._session_factory() as session:
            service = _service(session, max_attempts=self._max_attempts)
            return await service.claim_next_job(
                worker_id=self._worker_id,
                lease_seconds=self._lease_seconds,
            )

    async def _process_claimed(self, claimed: ClaimedUserFileProcessingJob) -> None:
        if self._session_factory is None:
            return

        try:
            read_started = time.perf_counter()
            log.info(
                "User-file local read started",
                job_id=claimed.job.id,
                file_id=claimed.job.file_id,
                user_id=claimed.job.user_id,
                storage_locator=claimed.storage_locator,
            )
            payload = self._load_payload(claimed)
            log.info(
                "User-file local read finished",
                job_id=claimed.job.id,
                file_id=claimed.job.file_id,
                user_id=claimed.job.user_id,
                found=payload is not None,
                byte_count=len(payload) if payload is not None else None,
                duration_seconds=round(time.perf_counter() - read_started, 3),
            )
            async with self._session_factory() as session:
                embedder = await self._embedder_for(session, claimed)
                service = _service(session, max_attempts=self._max_attempts)
                await service.complete_claimed_job(
                    claimed=claimed,
                    payload=payload,
                    parser=self._parser,
                    embedder=embedder,
                    max_process_bytes=self._max_process_bytes,
                )
            log.info(
                "User-file processing job succeeded",
                job_id=claimed.job.id,
                file_id=claimed.job.file_id,
                user_id=claimed.job.user_id,
            )
        except Exception as exc:
            error = str(exc).strip() or exc.__class__.__name__
            log.warning(
                "User-file processing job failed",
                job_id=claimed.job.id,
                file_id=claimed.job.file_id,
                user_id=claimed.job.user_id,
                attempts=claimed.job.attempts,
                max_attempts=claimed.job.max_attempts,
                error=error,
            )
            async with self._session_factory() as session:
                service = _service(session, max_attempts=self._max_attempts)
                await service.record_claimed_job_failure(claimed=claimed, error=error)

    async def _embedder_for(self, session: AsyncSession, claimed: ClaimedUserFileProcessingJob) -> TextEmbedder | None:
        """Resolve the file owner's embeddings role for this job.

        A resolution failure processes the file without vectors; re-embedding
        adds them once the role resolves again.
        """

        try:
            return await self._embedder_resolver(session, claimed.job.user_id)
        except Exception as exc:
            log.warning(
                "User-file embedding model unavailable",
                job_id=claimed.job.id,
                user_id=claimed.job.user_id,
                error_type=exc.__class__.__name__,
            )
            await session.rollback()
            return None

    def _load_payload(self, claimed: ClaimedUserFileProcessingJob) -> bytes | None:
        """Read exact local private bytes through the storage port.

        ``object_loader`` remains as a test seam while production workers use
        the containment-safe filesystem adapter.
        """

        if self._object_loader is not None:
            return self._object_loader(claimed.storage_locator)
        if self._private_storage is None:  # Defensive: constructor establishes this invariant.
            return None
        expected_size = claimed.stored_size_bytes or claimed.declared_size_bytes
        try:
            with self._private_storage.open_bounded(
                claimed.storage_locator,
                expected_size_bytes=expected_size,
            ) as stored:
                # The service needs only one byte beyond the limit to produce
                # its ordinary oversized-file failure without retaining an
                # arbitrarily large private document in worker memory.
                return stored.stream.read(self._max_process_bytes + 1)
        except Exception as exc:
            log.warning(
                "User-file local read failed",
                file_id=claimed.job.file_id,
                error=exc.__class__.__name__,
            )
            return None

    async def _warm_parser(self) -> None:
        warm_up = getattr(self._parser, "warm_up", None)
        if warm_up is None:
            return

        started = time.perf_counter()
        log.info("User-file parser warmup started", worker_id=self._worker_id)
        try:
            result = warm_up()
            if inspect.isawaitable(result):
                await result
            log.info(
                "User-file parser warmup finished",
                worker_id=self._worker_id,
                duration_seconds=round(time.perf_counter() - started, 3),
            )
        except Exception as exc:
            log.warning(
                "User-file parser warmup failed",
                worker_id=self._worker_id,
                duration_seconds=round(time.perf_counter() - started, 3),
                error=str(exc),
            )


def _service(session: AsyncSession, *, max_attempts: int) -> UserFileProcessingService:
    return UserFileProcessingService(
        processing=SQLAlchemyUserFileProcessingRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        max_attempts=max_attempts,
    )


async def _role_embedder(session: AsyncSession, user_id: str) -> TextEmbedder | None:
    from animama.server.embeddings import role_embedder
    from animama.server.model_roles import ModelRoleSettings

    # The document worker serves the local installation, whose owner assigns roles.
    return await role_embedder(session, user_id, ModelRoleSettings(owner_roles_enabled=True, app_settings=settings))


async def main() -> None:
    if not settings.animama_user_file_processing_enabled:
        raise RuntimeError("file_processing_unavailable")
    database_url = os.getenv("ANIMAMA_DATABASE_URL", settings.animama_database_url)
    worker_id = os.getenv("ANIMAMA_USER_FILE_WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"
    worker = UserFileProcessingWorker(
        database_url=database_url,
        worker_id=worker_id,
        poll_seconds=settings.anima_user_file_processing_poll_seconds,
        batch_size=settings.anima_user_file_processing_batch_size,
        lease_seconds=settings.anima_user_file_processing_lease_seconds,
        max_attempts=settings.anima_user_file_processing_max_attempts,
        max_process_bytes=settings.anima_user_file_max_process_bytes,
        instance_id=settings.animama_document_worker_instance_id,
    )

    def handle_signal() -> None:
        asyncio.create_task(worker.stop())

    install_shutdown_handlers(asyncio.get_running_loop(), handle_signal)

    try:
        await worker.start()
    finally:
        await worker.stop()


if __name__ == "__main__":
    asyncio.run(main())
