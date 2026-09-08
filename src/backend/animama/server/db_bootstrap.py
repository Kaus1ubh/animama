from __future__ import annotations

import argparse
import json
import os
import time
from collections.abc import Sequence
from pathlib import Path

import psycopg

from animama.runtime.resources import alembic_config, runtime_resource


def _read_required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def _get_sslmode() -> str | None:
    sslmode = os.getenv("PGSSLMODE")
    if sslmode:
        return sslmode
    if os.getenv("PGSSL") == "true":
        return "require"
    return None


def _connect_with_retries(*, timeout_s: int = 120, database_override: str | None = None) -> psycopg.Connection:
    host = _read_required("PGHOST")
    user = _read_required("PGUSER")
    database = database_override or _read_required("PGDATABASE")
    port = int(os.getenv("PGPORT") or "5432")
    password = os.getenv("PGPASSWORD") or None
    sslmode = _get_sslmode()

    deadline = time.time() + timeout_s
    last_err: Exception | None = None

    while time.time() < deadline:
        try:
            kwargs: dict[str, object] = {
                "host": host,
                "port": port,
                "user": user,
                "password": password,
                "dbname": database,
                "connect_timeout": 5,
            }
            if sslmode:
                kwargs["sslmode"] = sslmode

            conn = psycopg.connect(**kwargs)  # type: ignore[arg-type]
        except Exception as exc:  # pragma: no cover - timing/env dependent
            last_err = exc
            time.sleep(2)
            continue
        conn.autocommit = True
        expected_pgdata = os.getenv("ANIMAMA_DESKTOP_PGDATA")
        if expected_pgdata:
            try:
                with conn.cursor() as cur:
                    cur.execute("SHOW data_directory")
                    actual_pgdata = Path(cur.fetchone()[0]).resolve()
                if actual_pgdata != Path(expected_pgdata).resolve():
                    raise RuntimeError("desktop_database_ownership_mismatch")
            except Exception:
                conn.close()
                raise
        return conn

    raise RuntimeError(f"Could not connect to Postgres within {timeout_s}s") from last_err


def _exec_sql_statements(cur: psycopg.Cursor, sql_text: str) -> None:
    # Let PostgreSQL parse comments, quoted literals and statement boundaries.
    # Splitting on ';' corrupts the existing seed comments (and dollar strings).
    # No parameters are supplied: psycopg's simple-query path supports the batch.
    cur.execute(sql_text, prepare=False)


def _run_sql_file(cur: psycopg.Cursor, path: Path) -> None:
    if not path.exists():
        raise RuntimeError(f"SQL file not found: {path}")
    _exec_sql_statements(cur, path.read_text(encoding="utf-8"))


def _database_state(cur: psycopg.Cursor) -> dict[str, object]:
    """Bounded version and owner evidence, with no connection or secret data."""

    cur.execute("SHOW server_version")
    version = cur.fetchone()[0]
    cur.execute("SELECT to_regclass('public.alembic_version')")
    head = None
    if cur.fetchone()[0] is not None:
        cur.execute("SELECT version_num FROM alembic_version")
        row = cur.fetchone()
        head = row[0] if row else None
    cur.execute("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
    row = cur.fetchone()
    vector = row[0] if row else None
    cur.execute("SELECT to_regclass('public.installation_settings')")
    principal = None
    if cur.fetchone()[0] is not None:
        cur.execute("SELECT installation_principal_id FROM installation_settings")
        rows = cur.fetchall()
        if len(rows) != 1 or not rows[0][0]:
            raise RuntimeError("installation_principal_missing")
        principal = rows[0][0]
    return {
        "schema_version": 1,
        "postgresql_version": version,
        "pgvector_version": vector,
        "alembic_head": head,
        "installation_principal_id": principal,
    }


def inspect_database() -> dict[str, object]:
    """Inspect an owned database before deciding whether an upgrade dump is needed."""

    with _connect_with_retries() as conn, conn.cursor() as cur:
        return _database_state(cur)


def provision_desktop_database() -> None:
    """Create only the fixed private desktop database after native initdb."""

    if (
        os.getenv("PGHOST") != "127.0.0.1"
        or os.getenv("PGDATABASE") != "animama"
        or not os.getenv("ANIMAMA_DESKTOP_PGDATA")
    ):
        raise RuntimeError("desktop_database_provision_rejected")
    with _connect_with_retries(database_override="postgres") as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_database WHERE datname = 'animama'")
        if cur.fetchone() is None:
            cur.execute("CREATE DATABASE animama")


def bootstrap_database() -> dict[str, object]:
    """Serialize Alembic and repeatable product seeds, returning version evidence."""

    from alembic import command

    seed_dir = runtime_resource("sql")
    seed_paths = sorted(seed_dir.glob("*.sql"))
    if not seed_paths:
        raise RuntimeError(f"Database seed SQL is missing: {seed_dir}")

    conn = _connect_with_retries()
    try:
        with conn.cursor() as cur:
            # Ensure only one bootstrap runs at a time (across services/tasks).
            lock_key = int(os.getenv("ANIMAMA_DB_BOOTSTRAP_LOCK_KEY") or "593521912")
            cur.execute("SELECT pg_advisory_lock(%s)", (lock_key,))
            before = _database_state(cur)
            # Alembic owns all schema objects, including PostgreSQL extensions.
            # Keep the advisory lock held while Alembic runs so concurrent bootstraps block
            # until migrations and all repeatable seeds complete.
            command.upgrade(alembic_config(), "head")

            # Product defaults can evolve independently of the frozen schema.
            for seed_path in seed_paths:
                _run_sql_file(cur, seed_path)

            result = _database_state(cur)
            result["previous_alembic_head"] = before["alembic_head"]
            result["seed_versions"] = [seed.name for seed in seed_paths]
            cur.execute("SELECT pg_advisory_unlock(%s)", (lock_key,))
            return result
    finally:
        conn.close()


def main(argv: Sequence[str] | None = None) -> None:
    """Run shared bootstrap; quiet mode omits private result JSON from reset logs."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quiet", action="store_true", help="Omit result JSON; failures remain visible")
    args = parser.parse_args(argv)
    result = bootstrap_database()
    if not args.quiet:
        print(json.dumps(result, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
