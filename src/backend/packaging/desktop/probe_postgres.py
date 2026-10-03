"""Verify a staged native cluster and frozen migrations in disposable local data.

No Compose services or existing PostgreSQL installation is touched. Connection
credentials are generated for this probe, kept in env/private temp files, and
never placed in process arguments or evidence output.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
import subprocess
import tempfile
from pathlib import Path

import psycopg

_EXE = ".exe" if os.name == "nt" else ""
_PRINCIPAL = "SELECT installation_principal_id FROM installation_settings"


def _run(args: list[str], env: dict[str, str], cwd: Path) -> str:
    result = subprocess.run(args, env=env, cwd=cwd, text=True, capture_output=True, timeout=120)
    if result.returncode:
        # Deliberately omit environment/connection details from build evidence.
        raise RuntimeError(f"{Path(args[0]).name} failed ({result.returncode}): {result.stderr[-5000:]}")
    return result.stdout


def _base_environment(temporary: Path) -> dict[str, str]:
    """A minimal, fixed child environment; Windows tools need SystemRoot and TEMP."""
    if os.name != "nt":
        return {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin"}
    system_root = os.environ["SystemRoot"]
    return {
        "SystemRoot": system_root,
        "PATH": f"{system_root}\\System32;{system_root}",
        "TEMP": str(temporary),
        "TMP": str(temporary),
    }


def probe(runtime: Path, *, postgres_only: bool = False) -> dict[str, object]:
    """Exercise a fresh cluster; `postgres_only` skips the frozen backend's migrations."""

    postgres = runtime / "postgres/bin"

    def tool(name: str) -> str:
        return str(postgres / f"{name}{_EXE}")

    backend = str(runtime / f"backend/animama-runtime{_EXE}")
    with tempfile.TemporaryDirectory(prefix="animama-native-probe-") as raw:
        temporary = Path(raw)
        password = secrets.token_urlsafe(32)
        password_file = temporary / "pg-password"
        password_file.write_text(password + "\n")
        password_file.chmod(0o600)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        env = {
            **_base_environment(temporary),
            "LANG": "C",
            "LC_ALL": "C",
            "PGHOST": "127.0.0.1",
            "PGPORT": str(port),
            "PGUSER": "animama_probe",
            "PGDATABASE": "postgres",
            "PGPASSWORD": password,
            "PGSSLMODE": "disable",
            "ANIMAMA_LOG_TO_FILE": "0",
            "ANIMAMA_LOG_TO_CONSOLE": "0",
        }
        # Installed data lives below the user's profile, whose name may contain
        # spaces and characters outside the Windows ANSI code page.
        pgdata = temporary / "cluster \u30c7\u30fc\u30bf"
        _run(
            [
                tool("initdb"),
                "-D",
                str(pgdata),
                "--no-sync",
                "--encoding=UTF8",
                "--locale=C",
                "--auth=scram-sha-256",
                "--username=animama_probe",
                f"--pwfile={password_file}",
            ],
            env,
            temporary,
        )
        started = False
        server_log = temporary / "postgres.log"
        try:
            # The postmaster inherits pg_ctl's handles on Windows, so captured
            # pipes would never close. pg_ctl writes to a file instead.
            start_args = [tool("pg_ctl"), "-D", str(pgdata), "-l", str(server_log), "-w", "start"]
            pg_ctl_log = temporary / "pg_ctl.log"
            with pg_ctl_log.open("wb") as output:
                start = subprocess.run(
                    [*start_args, "-o", f'-h 127.0.0.1 -p {port} -k ""'],
                    env=env,
                    cwd=temporary,
                    stdin=subprocess.DEVNULL,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    timeout=120,
                )
            if start.returncode:
                details = "".join(
                    log.read_text(errors="replace")[-2500:] for log in (pg_ctl_log, server_log) if log.exists()
                )
                raise RuntimeError(f"pg_ctl start failed ({start.returncode}): {details}")
            started = True
            _run([tool("pg_isready")], env, temporary)
            with psycopg.connect(
                host="127.0.0.1", port=port, user=env["PGUSER"], dbname="postgres", password=password, autocommit=True
            ) as conn:
                conn.execute("CREATE EXTENSION vector")
                conn.execute("CREATE EXTENSION pg_trgm")
                vector = conn.execute("SELECT extversion FROM pg_extension WHERE extname = 'vector'").fetchone()[0]
                distance = conn.execute("SELECT '[1,2,3]'::vector <-> '[1,2,3]'::vector").fetchone()[0]
                assert distance == 0
                head = None
                principal = "postgres-only-probe"
                if not postgres_only:
                    _run([backend, "database", "bootstrap"], env, temporary)
                    principal = conn.execute(_PRINCIPAL).fetchone()[0]
                    _run([backend, "database", "bootstrap"], env, temporary)
                    assert conn.execute(_PRINCIPAL).fetchone()[0] == principal
                    assert not conn.execute(
                        "SELECT tablename FROM pg_tables WHERE schemaname='public' "
                        "AND tablename IN ('user','session','account','jwks')"
                    ).fetchall()
                    head = conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
                # A readable archive header does not prove that a real restore
                # retains owner-scoped rows. Keep test data inside this fresh cluster.
                conn.execute(
                    "CREATE TABLE desktop_recovery_probe "
                    "(id integer PRIMARY KEY, owner_id text NOT NULL, value text NOT NULL)"
                )
                conn.execute(
                    "INSERT INTO desktop_recovery_probe VALUES (1, %s, 'before snapshot'), (2, %s, 'retained row')",
                    (principal, principal),
                )
            dump = temporary / "database.dump"
            _run([tool("pg_dump"), "--format=custom", "--file", str(dump)], env, temporary)
            _run([tool("pg_restore"), "--list", str(dump)], env, temporary)
            with psycopg.connect(
                host="127.0.0.1", port=port, user=env["PGUSER"], dbname="postgres", password=password, autocommit=True
            ) as conn:
                conn.execute("UPDATE desktop_recovery_probe SET value = 'changed after snapshot' WHERE id = 1")
                conn.execute("CREATE DATABASE animama_restore_probe")
            # Restore into a different, newly created database. Never replace
            # an application's live database or modify the original snapshot.
            _run(
                [tool("pg_restore"), "--exit-on-error", "--dbname=animama_restore_probe", str(dump)],
                env,
                temporary,
            )
            with psycopg.connect(
                host="127.0.0.1",
                port=port,
                user=env["PGUSER"],
                dbname="animama_restore_probe",
                password=password,
                autocommit=True,
            ) as conn:
                if not postgres_only:
                    assert conn.execute(_PRINCIPAL).fetchone()[0] == principal
                    assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == head
                assert (
                    conn.execute("SELECT extversion FROM pg_extension WHERE extname = 'vector'").fetchone()[0] == vector
                )
                restored_rows = conn.execute(
                    "SELECT id, owner_id, value FROM desktop_recovery_probe ORDER BY id"
                ).fetchall()
                assert restored_rows == [
                    (1, principal, "before snapshot"),
                    (2, principal, "retained row"),
                ]
            result: dict[str, object] = {
                "pgvector_version": vector,
                "vector_distance": distance,
                "dump_restore_tools": "ok",
                "backup_restore_verified": True,
                "fresh_cluster": True,
            }
            if not postgres_only:
                result |= {"alembic_head": head, "principal_stable_across_bootstrap": True}
            return result
        finally:
            if started:
                _run([tool("pg_ctl"), "-D", str(pgdata), "-m", "fast", "-w", "stop"], env, temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--postgres-only", action="store_true", help="skip the frozen backend's migrations")
    args = parser.parse_args()
    print(json.dumps(probe(args.runtime.resolve(), postgres_only=args.postgres_only), indent=2, sort_keys=True))
