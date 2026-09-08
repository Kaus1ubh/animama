"""Liveness only; this table never grants work or replaces durable job leases."""

from datetime import datetime

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from .sqlalchemy_base import SqlalchemyBase


class ORMRuntimeWorkerHeartbeat(SqlalchemyBase):
    __tablename__ = "runtime_worker_heartbeats"

    kind: Mapped[str] = mapped_column(String(64), primary_key=True)
    instance_id: Mapped[str] = mapped_column(String(128), nullable=False)
    heartbeat_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
