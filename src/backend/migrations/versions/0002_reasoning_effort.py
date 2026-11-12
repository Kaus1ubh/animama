"""Store the composer's reasoning effort on each Anima chat profile.

Revision ID: reasoning_effort_20261112
Revises: baseline_20260908
Create Date: 2026-11-12

NULL means the model's default effort. Adding the column appends it, so a
profile upgraded from the baseline and a fresh database end with the same
schema. Databases created from the briefly edited baseline (development stacks
and desktop 0.1.3 preview profiles) already have the column, so the addition is
conditional. Keep this revision independent of live ORM imports.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "reasoning_effort_20261112"
down_revision: str | None = "baseline_20260908"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE anima_chat_profiles ADD COLUMN IF NOT EXISTS reasoning_effort character varying(16)")


def downgrade() -> None:
    op.execute("ALTER TABLE anima_chat_profiles DROP COLUMN reasoning_effort")
