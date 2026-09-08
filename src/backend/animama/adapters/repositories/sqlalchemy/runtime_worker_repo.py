"""Bounded worker liveness and lease renewal for the optional document process."""

from datetime import datetime, timezone

from sqlalchemy import delete, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from animama.orm.runtime_worker import ORMRuntimeWorkerHeartbeat
from animama.orm.user_file_processing_job import ORMUserFileProcessingJob


async def record_document_heartbeat(session: AsyncSession, *, instance_id: str, worker_id: str) -> None:
    """A live worker renews only its own running jobs; finished jobs stay finished."""

    now = datetime.now(timezone.utc)
    statement = insert(ORMRuntimeWorkerHeartbeat).values(
        kind="document-processing", instance_id=instance_id, heartbeat_at=now
    )
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[ORMRuntimeWorkerHeartbeat.kind],
            set_={"instance_id": instance_id, "heartbeat_at": now},
        )
    )
    await session.execute(
        update(ORMUserFileProcessingJob)
        .where(ORMUserFileProcessingJob.status == "running", ORMUserFileProcessingJob.locked_by == worker_id)
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
