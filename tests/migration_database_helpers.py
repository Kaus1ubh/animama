"""Disposable PostgreSQL for migration tests; never accepts an existing database URL."""

from __future__ import annotations

import os
import socket
import subprocess
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url


@pytest.fixture(scope="module")
def migration_postgres(request: pytest.FixtureRequest, tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    """Use testcontainers normally, or explicitly supplied native PostgreSQL binaries.

    Native execution always creates a new cluster in pytest's temporary directory.
    Only that owned cluster is stopped; user databases and services are never used.
    """
    binary_root = os.environ.get("ANIMAMA_TEST_POSTGRES_BIN")
    if not binary_root:
        yield request.getfixturevalue("db_url")
        return
    binaries = Path(binary_root).resolve()
    root = tmp_path_factory.mktemp("migration-postgres")
    data = root / "pgdata"
    subprocess.run(
        [str(binaries / "initdb"), "-D", str(data), "-U", "postgres", "--auth=trust", "--no-locale", "--encoding=UTF8"],
        check=True,
        capture_output=True,
        text=True,
    )
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    # A port collision fails startup; it never stops another process or retries
    # against an unknown server. Disable Unix sockets to avoid shared directories.
    subprocess.run(
        [
            str(binaries / "pg_ctl"),
            "-D",
            str(data),
            "-l",
            str(root / "postgres.log"),
            "-o",
            f"-h 127.0.0.1 -p {port} -k ''",
            "-w",
            "start",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        yield f"postgresql+asyncpg://postgres@127.0.0.1:{port}/postgres"
    finally:
        subprocess.run(
            [str(binaries / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "stop"],
            check=True,
            capture_output=True,
            text=True,
        )


@pytest.fixture
def migrated_database(migration_postgres: str) -> Iterator[str]:
    """Create a unique database and execute the real Alembic graph in a subprocess."""
    import sys

    url = make_url(migration_postgres).set(drivername="postgresql+psycopg")
    name = "migration_test_" + uuid4().hex
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
    target = url.set(database=name)
    try:
        environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("PG") and key not in {"ANIMAMA_DATABASE_URL", "DATABASE_URL"}
        }
        environment["ANIMAMA_DATABASE_URL"] = target.render_as_string(hide_password=False)
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "src/backend/alembic.ini", "upgrade", "head"],
            cwd=Path(__file__).resolve().parents[1],
            env=environment,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        yield target.set(drivername="postgresql+asyncpg").render_as_string(hide_password=False)
    finally:
        with admin.connect() as connection:
            connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()
