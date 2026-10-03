"""Avatar upload cleanup worker.

Run with:
    uv run python -m animama.workers.avatar_upload_cleanup
"""

from __future__ import annotations

import asyncio
import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from animama.logging_config import get_logger
from animama.server.avatar_uploads import (
    STATUS_ABORTED,
    STATUS_CLEANUP_PENDING,
    STATUS_EXPIRED,
    STATUS_PENDING,
    list_uploads_for_cleanup,
    set_upload_status,
    utcnow,
)
from animama.server.config import settings
from animama.server.user_file_storage import delete_private_file
from animama.workers.shutdown import install_shutdown_handlers

log = get_logger("avatar-upload.cleanup")


class AvatarUploadCleanupWorker:
    def __init__(
        self,
        *,
        database_url: str,
        interval_seconds: int,
        batch_size: int,
    ) -> None:
        self._database_url = database_url
        self._interval_seconds = interval_seconds
        self._batch_size = batch_size
        self._running = False
        self._stopped = asyncio.Event()
        self._session_factory: async_sessionmaker[AsyncSession] | None = None

    async def start(self) -> None:
        engine = create_async_engine(self._database_url, echo=False)
        self._session_factory = async_sessionmaker(engine, expire_on_commit=False)
        self._running = True
        log.info(
            "Avatar upload cleanup worker started",
            interval_seconds=self._interval_seconds,
            batch_size=self._batch_size,
        )
        try:
            await self._run_loop()
        finally:
            await engine.dispose()

    async def stop(self) -> None:
        self._running = False
        self._stopped.set()
        log.info("Avatar upload cleanup worker stopping")

    async def _run_loop(self) -> None:
        while self._running:
            try:
                await self._cleanup_once()
                await self._wait_for_next_cleanup()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                log.error("Avatar upload cleanup loop failed", error=str(exc))
                await self._wait_for_next_cleanup()

    async def _wait_for_next_cleanup(self) -> None:
        """Wake promptly on shutdown without cancelling an in-flight cleanup commit."""

        try:
            await asyncio.wait_for(self._stopped.wait(), timeout=self._interval_seconds)
        except TimeoutError:
            pass

    async def _cleanup_once(self) -> None:
        if self._session_factory is None:
            return

        async with self._session_factory() as session:
            uploads = await list_uploads_for_cleanup(
                session,
                now=utcnow(),
                limit=self._batch_size,
            )
            if not uploads:
                return

            for upload in uploads:
                deleted = delete_private_file(upload.storage_locator)
                if upload.status == STATUS_PENDING and upload.expires_at <= utcnow():
                    set_upload_status(
                        upload,
                        status=STATUS_EXPIRED if deleted else STATUS_CLEANUP_PENDING,
                        last_error=None if deleted else "Expired upload cleanup will retry",
                    )
                else:
                    set_upload_status(
                        upload,
                        status=STATUS_ABORTED if deleted else STATUS_CLEANUP_PENDING,
                        last_error=None if deleted else "Avatar upload cleanup will retry",
                    )

            await session.commit()


async def main() -> None:
    database_url = os.getenv("ANIMAMA_DATABASE_URL", settings.animama_database_url)
    worker = AvatarUploadCleanupWorker(
        database_url=database_url,
        interval_seconds=settings.avatar_upload_cleanup_interval_seconds,
        batch_size=settings.avatar_upload_cleanup_batch_size,
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
