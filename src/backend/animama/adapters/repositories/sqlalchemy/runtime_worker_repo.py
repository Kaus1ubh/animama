"""Liveness and lease renewal for the server's upload processor.

The heartbeat row keeps its ``document-processing`` kind, which the runtime
capability reads to report the processor's state.
"""

from datetime import UTC, datetime

from sqlalchemy import delete, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from animama.orm.runtime_worker import ORMRuntimeWorkerHeartbeat
from animama.orm.user_file_processing_job import ORMUserFileProcessingJob


async def record_document_heartbeat(
    session: AsyncSession, *, instance_id: str, worker_id: str, job_id: str | None
) -> None:
    """Record the processor's liveness and renew the lease of the job it is working on.

    Only ``job_id`` is renewed, and only while this worker still holds it: a job
    the processor left behind (say, when recording its outcome failed) lets its
    lease expire, so it is claimed again instead of staying at Processing.
    """

    now = datetime.now(UTC)
    statement = insert(ORMRuntimeWorkerHeartbeat).values(
        kind="document-processing", instance_id=instance_id, heartbeat_at=now
    )
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[ORMRuntimeWorkerHeartbeat.kind],
            set_={"instance_id": instance_id, "heartbeat_at": now},
        )
    )
    if job_id is not None:
        await session.execute(
            update(ORMUserFileProcessingJob)
            .where(
                ORMUserFileProcessingJob.id == job_id,
                ORMUserFileProcessingJob.status == "running",
                ORMUserFileProcessingJob.locked_by == worker_id,
            )
            .values(locked_at=now)
        )
    await session.commit()


async def clear_document_heartbeat(session: AsyncSession, *, instance_id: str) -> None:
    """An older worker cannot clear the liveness of its replacement."""

    await session.execute(
        delete(ORMRuntimeWorkerHeartbeat).where(
            ORMRuntimeWorkerHeartbeat.kind == "document-processing",
            ORMRuntimeWorkerHeartbeat.instance_id == instance_id,
        )
    )
    await session.commit()
