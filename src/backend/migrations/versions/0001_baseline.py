"""Clean accountless local database baseline.

Revision ID: baseline_20260908
Revises:
Create Date: 2026-09-08

The companion SQL artifact is frozen at the schema released in desktop 0.1.2:
installed profiles carry this revision, so editing it would change their schema
without a migration. Change the schema with a new revision instead; the SQL
file's own header predates the freeze. Keep initialization independent of live
ORM imports.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "baseline_20260908"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STATEMENT_SEPARATOR = "\n\n-- animama-statement --\n\n"
_BASELINE_TABLES = (
    "anima",
    "anima_chat_profiles",
    "anima_content_bindings",
    "anima_creation_receipts",
    "anima_definition_revisions",
    "anima_loadout_diagnostics",
    "anima_loadout_mutation_receipts",
    "anima_loadouts",
    "anima_runtime_snapshots",
    "anima_settings",
    "anima_starter_receipts",
    "archive_passages",
    "archives",
    "avatar",
    "avatar_face_part_overrides",
    "avatar_setting_overrides",
    "avatar_upload",
    "chat_compactions",
    "chat_messages",
    "chats",
    "content_catalog_dependencies",
    "content_catalog_files",
    "content_catalog_items",
    "content_mutation_receipts",
    "content_preview_files",
    "content_previews",
    "installation_settings",
    "memory_entries",
    "memory_entry_versions",
    "memory_episode_items",
    "memory_manager_approvals",
    "memory_manager_messages",
    "memory_manager_runs",
    "model_connections",
    "model_providers",
    "passage_tags",
    "runtime_worker_heartbeats",
    "tags",
    "user_file",
    "user_file_chunk",
    "user_file_processing_job",
    "user_profiles",
    "user_settings",
    "web_search_settings",
)


def _baseline_statements() -> list[str]:
    sql_path = Path(__file__).with_name("0001_baseline.sql")
    return [statement.strip() for statement in sql_path.read_text(encoding="utf-8").split(_STATEMENT_SEPARATOR)]


def upgrade() -> None:
    """Create the exact schema captured in the baseline SQL artifact."""

    for statement in _baseline_statements():
        if statement:
            op.execute(statement)

    # A fresh database gets its own owner; repeated upgrade at head is a no-op.
    op.execute(
        sa.text(
            "INSERT INTO installation_settings (id, installation_principal_id) VALUES (1, :principal_id)"
        ).bindparams(principal_id=str(uuid4()))
    )


def downgrade() -> None:
    """Drop only tables owned by the baseline."""

    for table_name in reversed(_BASELINE_TABLES):
        op.execute(f'DROP TABLE IF EXISTS "{table_name}" CASCADE')
