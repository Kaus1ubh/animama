import hashlib
import json
import uuid
from contextlib import contextmanager
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util import CommandError

ROOT = Path(__file__).parents[1]
BASELINE_MIGRATION = ROOT / "alembic" / "versions" / "0001_baseline.py"
BASELINE_SQL = ROOT / "alembic" / "versions" / "0001_baseline.sql"
BASELINE_SHA256 = "2ed6465982b50258523a486bd454832b38090a579349f4c54cd34e3e7eaccb87"


def test_frozen_baseline_does_not_import_live_metadata() -> None:
    migration = BASELINE_MIGRATION.read_text(encoding="utf-8")
    assert "animama.orm" not in migration
    assert "Base.metadata" not in migration
    assert "create_all" not in migration
    assert "0001_baseline.sql" in migration


def test_frozen_baseline_artifact_has_the_reviewed_schema_fingerprint() -> None:
    baseline = BASELINE_SQL.read_bytes()
    assert hashlib.sha256(baseline).hexdigest() == BASELINE_SHA256
    sql = baseline.decode("utf-8")
    assert "CREATE EXTENSION IF NOT EXISTS vector" in sql
    assert sql.count("CREATE TABLE ") == 40


def test_current_schema_is_the_single_root_and_head() -> None:
    scripts = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    assert scripts.get_heads() == ["memory_names_20260920"]
    revisions = list(scripts.walk_revisions())
    assert len(revisions) == 2
    assert revisions[0].down_revision == "baseline_20260908"
    assert revisions[1].down_revision is None


def test_fresh_database_migrates_to_head(db_url: str, monkeypatch) -> None:  # noqa: ANN001
    """Create the current schema directly, with independent installation owners."""

    base_url = make_url(db_url.replace("+asyncpg", "+psycopg"))
    schema = f"migration_fresh_{uuid.uuid4().hex}"
    admin_engine = create_engine(base_url)
    with admin_engine.begin() as connection:
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')

    migration_url = base_url.update_query_dict({"options": f"-csearch_path={schema},public"})
    rendered_url = migration_url.render_as_string(hide_password=False)
    monkeypatch.setenv("ANIMAMA_DATABASE_URL", rendered_url)
    config = Config(str(ROOT / "alembic.ini"))
    second_schema = f"migration_fresh_{uuid.uuid4().hex}"
    with admin_engine.begin() as connection:
        connection.exec_driver_sql(f'CREATE SCHEMA "{second_schema}"')
    try:
        command.upgrade(config, "head")
        engine = create_engine(migration_url)
        try:
            tables = set(inspect(engine).get_table_names())
            assert "installation_settings" in tables
            assert "content_catalog_items" in tables
            assert "anima_content_bindings" in tables
            assert "anima_runtime_snapshots" in tables
            assert "runtime_worker_heartbeats" in tables
            assert "content_mutation_receipts" in tables
            assert "anima_definition_revisions" in tables
            assert "anima_loadout_diagnostics" in tables
            anima_columns = {column["name"]: column for column in inspect(engine).get_columns("anima")}
            assert anima_columns["display_name"]["nullable"] is False
            assert anima_columns["aggregate_revision"]["nullable"] is False
            avatar_fk = next(
                fk for fk in inspect(engine).get_foreign_keys("anima") if fk["constrained_columns"] == ["avatar_id"]
            )
            assert avatar_fk["options"]["ondelete"] == "RESTRICT"
            binding_indexes = {index["name"]: index for index in inspect(engine).get_indexes("anima_content_bindings")}
            for name in ("uq_anima_music_autoplay", "uq_anima_music_catalog_item"):
                assert binding_indexes[name]["unique"]
                assert binding_indexes[name]["dialect_options"]["postgresql_where"]
            assert {
                "user",
                "session",
                "account",
                "verification",
                "jwks",
                "apikey",
                "username_claims",
                "content_items",
                "content_releases",
                "content_blobs",
                "local_content_catalog_items",
                "anima_local_content_bindings",
                "anima_runtime_file_memberships",
            }.isdisjoint(tables)
            snapshot_columns = {column["name"] for column in inspect(engine).get_columns("anima_runtime_snapshots")}
            assert "admitted_item_revisions" in snapshot_columns
            assert {column["name"] for column in inspect(engine).get_columns("user_profiles")} == {
                "user_id",
                "display_name",
                "created_at",
                "updated_at",
            }
            principal_column = next(
                column
                for column in inspect(engine).get_columns("installation_settings")
                if column["name"] == "installation_principal_id"
            )
            assert principal_column["nullable"] is False
            assert all(
                foreign_key.get("referred_table") != "user"
                for table_name in tables
                for foreign_key in inspect(engine).get_foreign_keys(table_name)
            )
            with engine.connect() as connection:
                assert connection.execute(text("SELECT id FROM installation_settings")).scalar_one() == 1
                first_principal = connection.execute(
                    text("SELECT installation_principal_id FROM installation_settings")
                ).scalar_one()
                assert uuid.UUID(first_principal).version == 4
                assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "memory_names_20260920"
            command.upgrade(config, "head")
            with engine.connect() as connection:
                assert connection.execute(
                    text("SELECT installation_principal_id FROM installation_settings")
                ).scalars().all() == [first_principal]
        finally:
            engine.dispose()

        second_url = base_url.update_query_dict({"options": f"-csearch_path={second_schema},public"})
        monkeypatch.setenv("ANIMAMA_DATABASE_URL", second_url.render_as_string(hide_password=False))
        command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
        second_engine = create_engine(second_url)
        try:
            with second_engine.connect() as connection:
                second_principal = connection.execute(
                    text("SELECT installation_principal_id FROM installation_settings")
                ).scalar_one()
            assert uuid.UUID(second_principal).version == 4
            assert second_principal != first_principal
        finally:
            second_engine.dispose()
    finally:
        with admin_engine.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            connection.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{second_schema}" CASCADE')
        admin_engine.dispose()


@contextmanager
def migration_schema(db_url: str, monkeypatch: pytest.MonkeyPatch):
    """Keep baseline and failure probes in their own disposable schema."""

    base_url = make_url(db_url.replace("+asyncpg", "+psycopg"))
    schema = f"migration_constraint_{uuid.uuid4().hex}"
    admin = create_engine(base_url)
    with admin.begin() as connection:
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    url = base_url.update_query_dict({"options": f"-csearch_path={schema},public"})
    monkeypatch.setenv("ANIMAMA_DATABASE_URL", url.render_as_string(hide_password=False))
    engine = create_engine(url)
    try:
        yield Config(str(ROOT / "alembic.ini")), engine
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        admin.dispose()


@pytest.mark.parametrize("old_revision", ["0001", "0013_content_mutation_receipts"])
def test_old_revision_is_rejected_without_adopting_or_changing_data(
    db_url: str, monkeypatch: pytest.MonkeyPatch, old_revision: str
) -> None:
    with migration_schema(db_url, monkeypatch) as (config, engine):
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE alembic_version (version_num varchar(32) NOT NULL PRIMARY KEY)"))
            connection.execute(text("INSERT INTO alembic_version VALUES (:revision)"), {"revision": old_revision})
            connection.execute(text("CREATE TABLE sentinel (value text NOT NULL)"))
            connection.execute(text("INSERT INTO sentinel VALUES ('preserve me')"))
        with pytest.raises(CommandError, match="Can't locate revision"):
            command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == old_revision
            assert connection.scalar(text("SELECT value FROM sentinel")) == "preserve me"
            schema = connection.scalar(text("SELECT current_schema()"))
        assert set(inspect(engine).get_table_names(schema=schema)) == {"alembic_version", "sentinel"}


def test_fresh_creation_receipts_are_owner_scoped_and_survive_absent_animas(
    db_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The frozen SQL must enforce receipts without resurrecting account tables."""

    with migration_schema(db_url, monkeypatch) as (config, engine):
        command.upgrade(config, "head")
        insert = text(
            "INSERT INTO anima_creation_receipts "
            "(owner_user_id, operation, idempotency_key, spec_sha256, anima_id, result) "
            "VALUES (:owner, :operation, 'key', :sha, 'detached-result-id', CAST(:result AS jsonb))"
        )
        values = {"owner": "owner", "operation": "live_anima_create_v1", "sha": "a" * 64, "result": "{}"}
        with engine.begin() as connection:
            assert connection.scalar(text("SELECT count(*) FROM anima_starter_receipts")) == 0
            connection.execute(insert, values)
            connection.execute(insert, {**values, "owner": "other-owner"})
        # Operation identity and bounded object results are database invariants.
        for changes in (
            {},
            {"operation": "invalid"},
            {"owner": "third", "result": "[]"},
            {"owner": "oversized", "result": json.dumps({"payload": "x" * 65536})},
        ):
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(insert, {**values, **changes})
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO anima_starter_receipts (owner_user_id, starter_id, spec_version, state) "
                    "VALUES ('owner', 'starter:annie', 1, 'ready')"
                )
            )
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM anima_creation_receipts")) == 2
            assert connection.scalar(text("SELECT count(*) FROM anima_starter_receipts")) == 0


def test_memory_filename_upgrade_preserves_content_history_and_lookup_keys(
    db_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Capitalization changes current root files, leaving audit rows and other scopes intact."""

    with migration_schema(db_url, monkeypatch) as (config, engine):
        command.upgrade(config, "baseline_20260908")
        rows = [
            ("profile", None, "profile.md", "user_profile"),
            ("identity", "anima-1", "identity.md", None),
            ("user-identity", None, "identity.md", None),
            ("anima-profile", "anima-1", "profile.md", None),
            ("other-file", None, "notes.md", None),
        ]
        with engine.begin() as connection:
            for entry_id, anima_id, path, kind in rows:
                connection.execute(
                    text(
                        "INSERT INTO memory_entries "
                        "(id, user_id, anima_id, type, name, normalized_name, path, normalized_path, "
                        "content, content_sha256, size_bytes, version, kind, metadata) "
                        "VALUES (:id, 'owner', :anima, 'file', :path, :path, :path, :path, "
                        "'Keep this content', :sha, 17, 1, :kind, CAST(:metadata AS jsonb))"
                    ),
                    {
                        "id": entry_id,
                        "anima": anima_id,
                        "path": path,
                        "kind": kind,
                        "sha": hashlib.sha256(b"Keep this content").hexdigest(),
                        "metadata": json.dumps({"installation_bootstrap": {"managed_entry_version": 1}}),
                    },
                )
            connection.execute(
                text(
                    "INSERT INTO memory_entry_versions "
                    "(entry_id, user_id, anima_id, type, name, normalized_name, path, normalized_path, "
                    "content, content_sha256, size_bytes, version, kind, metadata, operation) "
                    "SELECT id, user_id, anima_id, type, name, normalized_name, path, normalized_path, "
                    "content, content_sha256, size_bytes, version, kind, metadata, 'create' FROM memory_entries"
                )
            )
            before = connection.execute(text("SELECT * FROM memory_entries ORDER BY id")).mappings().all()
            history = connection.execute(text("SELECT * FROM memory_entry_versions ORDER BY id")).mappings().all()
            owner = connection.scalar(text("SELECT installation_principal_id FROM installation_settings"))
        command.upgrade(config, "head")
        with engine.connect() as connection:
            after = connection.execute(text("SELECT * FROM memory_entries ORDER BY id")).mappings().all()
            for old, new in zip(before, after, strict=True):
                expected_path = {"profile": "PROFILE.md", "identity": "IDENTITY.md"}.get(old["id"], old["path"])
                assert new["name"] == new["path"] == expected_path
                # The generated search vector can follow the display-name change.
                assert {k: v for k, v in old.items() if k not in {"name", "path", "search_vector"}} == {
                    k: v for k, v in new.items() if k not in {"name", "path", "search_vector"}
                }
                for spelling in (expected_path, expected_path.lower()):
                    found = connection.scalar(
                        text(
                            "SELECT id FROM memory_entries WHERE user_id = 'owner' "
                            "AND anima_id IS NOT DISTINCT FROM :anima AND normalized_path = :path"
                        ),
                        {"anima": new["anima_id"], "path": spelling.casefold()},
                    )
                    assert found == old["id"]
            assert (
                connection.execute(text("SELECT * FROM memory_entry_versions ORDER BY id")).mappings().all() == history
            )
            assert connection.scalar(text("SELECT installation_principal_id FROM installation_settings")) == owner
        command.downgrade(config, "baseline_20260908")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT * FROM memory_entries ORDER BY id")).mappings().all() == before
            assert (
                connection.execute(text("SELECT * FROM memory_entry_versions ORDER BY id")).mappings().all() == history
            )
