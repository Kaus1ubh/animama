"""Capitalize the built-in memory filenames without rewriting their history.

Revision ID: memory_names_20260920
Revises: baseline_20260908
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "memory_names_20260920"
down_revision: str | None = "baseline_20260908"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _rename(*, profile: str, identity: str) -> None:
    """Change only display spelling; normalized lookup keys and versions stay stable."""

    op.execute(
        sa.text(
            "UPDATE memory_entries SET "
            "name = CASE WHEN anima_id IS NULL THEN :profile ELSE :identity END, "
            "path = CASE WHEN anima_id IS NULL THEN :profile ELSE :identity END "
            "WHERE type = 'file' AND parent_id IS NULL AND deleted_at IS NULL AND "
            "((anima_id IS NULL AND normalized_path = 'profile.md') OR "
            "(anima_id IS NOT NULL AND normalized_path = 'identity.md'))"
        ).bindparams(profile=profile, identity=identity)
    )


def upgrade() -> None:
    """Preserve content, entry IDs, version counters and append-only audit rows."""

    _rename(profile="PROFILE.md", identity="IDENTITY.md")


def downgrade() -> None:
    """Restore the former built-in display spelling without changing file content."""

    _rename(profile="profile.md", identity="identity.md")
