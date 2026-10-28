"""The disposable benchmark database memory runs write to (plan decision D4).

Memory chats, recall chats and Memory Manager runs use chat's real
repositories and services, so they need a real PostgreSQL database: episode
search is PostgreSQL full-text search, and the memory, chat and Memory Manager
repositories are SQLAlchemy code. A benchmark run creates its own database
next to the application's, in the same server, with every application table
(as the test suite builds its databases), and drops it when the run ends. The
application database is never opened for writes. Every create and drop
refuses a name without the ``animama_benchmark_`` prefix, and ``cleanup``
drops only such leftovers that no session is using.
"""

from __future__ import annotations

import re
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from ..core.inputs import EvalInputError

__all__ = [
    "BENCHMARK_DATABASE_PREFIX",
    "benchmark_database",
    "benchmark_database_name",
    "drop_leftover_databases",
    "japanese_search_probe",
]

BENCHMARK_DATABASE_PREFIX = "animama_benchmark_"
_NAME = re.compile(rf"^{BENCHMARK_DATABASE_PREFIX}[a-z0-9_]{{1,40}}$")
_OBJECT_IN_USE = "55006"
"""PostgreSQL's SQLSTATE for a database another session is connected to."""


def benchmark_database_name(label: str, *, now: datetime | None = None) -> str:
    """A fresh database name for one run: the prefix, ``label`` shortened, the UTC time and a random suffix.

    ``label`` (the run directory's name) keeps only lowercase letters, digits and underscores.
    """

    short = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:16].strip("_") or "run"
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%dt%H%M%S")
    name = f"{BENCHMARK_DATABASE_PREFIX}{short}_{stamp}_{secrets.token_hex(3)}"
    _require_benchmark_name(name)
    return name


def _require_benchmark_name(name: str) -> None:
    if not _NAME.fullmatch(name):
        raise EvalInputError(f"Refusing database {name!r}: benchmark databases are named {BENCHMARK_DATABASE_PREFIX}*")


def _admin_url(application_url: str | URL) -> URL:
    """The server's maintenance database, reached with the application's credentials."""

    return make_url(application_url).set(database="postgres")


@asynccontextmanager
async def _admin(application_url: str | URL) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(_admin_url(application_url), poolclass=NullPool, isolation_level="AUTOCOMMIT")
    try:
        yield engine
    finally:
        await engine.dispose()


@asynccontextmanager
async def benchmark_database(application_url: str | URL, name: str) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Create ``name`` with every application table, yield its session factory, and drop it afterwards.

    The drop runs on error and on cancellation too; ``cleanup`` removes a
    database a killed process left behind.
    """

    _require_benchmark_name(name)
    async with _admin(application_url) as admin, admin.connect() as connection:
        try:
            await connection.execute(text(f'CREATE DATABASE "{name}"'))
        except DBAPIError as exc:
            # The server's message can name the database but never the URL or its credentials.
            raise EvalInputError(f"Could not create the benchmark database {name}: {exc.orig}") from exc
    engine = create_async_engine(make_url(application_url).set(database=name), poolclass=NullPool)
    try:
        async with engine.begin() as connection:
            await connection.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
            await connection.run_sync(_create_all)
        # Sessions come and go during a run; one idle connection stays open throughout, so `cleanup`,
        # which drops without FORCE, always finds the database in use and keeps it.
        async with engine.connect():
            yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()
        async with _admin(application_url) as admin, admin.connect() as connection:
            await connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


def _create_all(sync_connection: object) -> None:
    import animama.local.installation_model  # noqa: F401 (local schema registration)
    import animama.orm  # noqa: F401 (shared schema registration)
    from animama.orm.base import Base

    Base.metadata.create_all(bind=sync_connection)  # type: ignore[arg-type]


async def drop_leftover_databases(
    application_url: str | URL, *, prefix: str = BENCHMARK_DATABASE_PREFIX
) -> tuple[list[str], list[str]]:
    """Drop each benchmark database whose name starts with ``prefix``; return those dropped and those in use.

    A database with an open session, such as a running benchmark's, is left
    alone; the application database is never a candidate.
    """

    if not prefix.startswith(BENCHMARK_DATABASE_PREFIX):
        raise EvalInputError(f"Refusing prefix {prefix!r}: benchmark databases are named {BENCHMARK_DATABASE_PREFIX}*")
    application = make_url(application_url).database
    dropped: list[str] = []
    in_use: list[str] = []
    async with _admin(application_url) as admin, admin.connect() as connection:
        rows = await connection.execute(
            text("SELECT datname FROM pg_database WHERE starts_with(datname, :prefix) ORDER BY datname"),
            {"prefix": prefix},
        )
        names = [row[0] for row in rows if _NAME.fullmatch(row[0]) and row[0] != application]
        for name in names:
            try:
                await connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
            except DBAPIError as exc:
                if getattr(exc.orig, "sqlstate", None) != _OBJECT_IN_USE:
                    raise EvalInputError(f"Could not drop the benchmark database {name}: {exc.orig}") from exc
                in_use.append(name)
            else:
                dropped.append(name)
    return dropped, in_use


async def japanese_search_probe(session: AsyncSession) -> dict[str, object]:
    """How chat's memory search, ``to_tsvector('english', …)`` and ``websearch_to_tsquery('english', …)``,
    handles Japanese text. Read-only: it evaluates expressions and touches no table."""

    document = "週末に京都で抹茶を飲みました。"
    queries = ("京都", "抹茶", "週末に京都で抹茶を飲みました。")
    vector = await session.execute(text("SELECT to_tsvector('english', :document)::text"), {"document": document})
    matches = {}
    for query in queries:
        result = await session.execute(
            text("SELECT to_tsvector('english', :document) @@ websearch_to_tsquery('english', :query)"),
            {"document": document, "query": query},
        )
        matches[query] = bool(result.scalar_one())
    return {"document": document, "tsvector": vector.scalar_one(), "matches": matches}
