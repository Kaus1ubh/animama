from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import TIMESTAMP, CheckConstraint, ForeignKey, Index, String, Text, text as sa_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMMemoryManagerRun(SqlalchemyBase, TimestampMixin):
    """Durable user-invoked memory-manager chat run."""

    __tablename__ = "memory_manager_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'waiting_approval', 'completed', 'failed')",
            name="memory_manager_runs_status_valid",
        ),
        CheckConstraint(
            "kind IN ('general', 'episode_processing')",
            name="memory_manager_runs_kind_valid",
        ),
        Index("ix_memory_manager_runs_user_status_created", "user_id", "status", "created_at"),
        Index(
            "uq_memory_manager_runs_user_open",
            "user_id",
            unique=True,
            postgresql_where=sa_text("status IN ('active', 'waiting_approval')"),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active", server_default="active")
    kind: Mapped[str] = mapped_column(String, nullable=False, default="general", server_default="general")
    task_state: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    model_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String, nullable=True)
    openai_previous_response_id: Mapped[str | None] = mapped_column(String, nullable=True)
    serialized_agent_state: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=sa_text("'{}'::jsonb"),
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        default=dict,
        server_default=sa_text("'{}'::jsonb"),
    )
    completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=False), nullable=True)


class ORMMemoryManagerMessage(SqlalchemyBase):
    """Visible message in a memory-manager chat run."""

    __tablename__ = "memory_manager_messages"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant', 'system')", name="memory_manager_messages_role_valid"),
        CheckConstraint("length(content) > 0", name="memory_manager_messages_content_non_empty"),
        Index("ix_memory_manager_messages_run_created", "run_id", "created_at"),
        Index("ix_memory_manager_messages_user_run_created", "user_id", "run_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("memory_manager_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        default=dict,
        server_default=sa_text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
    )


class ORMMemoryManagerApproval(SqlalchemyBase, TimestampMixin):
    """Persisted approval state for one proposed memory-manager file operation."""

    __tablename__ = "memory_manager_approvals"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="memory_manager_approvals_status_valid",
        ),
        CheckConstraint(
            "operation IN ('create', 'update', 'delete')",
            name="memory_manager_approvals_operation_valid",
        ),
        CheckConstraint("length(target_path) > 0", name="memory_manager_approvals_target_path_non_empty"),
        CheckConstraint(
            "applied_version IS NULL OR applied_version >= 1",
            name="memory_manager_approvals_applied_version_positive",
        ),
        CheckConstraint(
            "undo_version IS NULL OR undo_version >= 1",
            name="memory_manager_approvals_undo_version_positive",
        ),
        CheckConstraint(
            "(undone_at IS NULL AND undo_version IS NULL) OR (undone_at IS NOT NULL AND undo_version IS NOT NULL)",
            name="memory_manager_approvals_undo_fields_consistent",
        ),
        CheckConstraint(
            "undo_version IS NULL OR (status = 'approved' AND applied_version IS NOT NULL)",
            name="memory_manager_approvals_undo_requires_application",
        ),
        Index("ix_memory_manager_approvals_user_status_created", "user_id", "status", "created_at"),
        Index("ix_memory_manager_approvals_run_status_created", "run_id", "status", "created_at"),
        Index(
            "ix_memory_manager_approvals_user_target_applied",
            "user_id",
            "target_entry_id",
            "applied_version",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("memory_manager_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending", server_default="pending")
    operation: Mapped[str] = mapped_column(String, nullable=False)
    target_path: Mapped[str] = mapped_column(String(512), nullable=False)
    target_entry_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    expected_version: Mapped[int | None] = mapped_column(nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    old_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    old_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    unified_diff: Mapped[str] = mapped_column(Text, nullable=False)
    operation_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=sa_text("'{}'::jsonb"),
    )
    decision_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    applied_version: Mapped[int | None] = mapped_column(nullable=True)
    undone_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=False), nullable=True)
    undo_version: Mapped[int | None] = mapped_column(nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=False), nullable=True)


MemoryManagerRun = ORMMemoryManagerRun
MemoryManagerMessage = ORMMemoryManagerMessage
MemoryManagerApproval = ORMMemoryManagerApproval

__all__ = [
    "MemoryManagerApproval",
    "MemoryManagerMessage",
    "MemoryManagerRun",
    "ORMMemoryManagerApproval",
    "ORMMemoryManagerMessage",
    "ORMMemoryManagerRun",
]
