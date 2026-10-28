"""Measure what one content catalog read costs the API process, as a 200 and as a 304.

Content Health polls ``GET /v1/content/catalog`` every 15 seconds, so an unchanged
catalog should cost little more than its validator. This starts a disposable
PostgreSQL container (the test suite's image, through testcontainers), reconciles a
copy of this checkout's Included content, and serves the route in-process through the
local composition. It reports, per read, wall time and this process's CPU time (the
server's work plus a small in-process client) and the SQL statements executed.

Run it from the repository root with Docker available:

    uv run --no-sync python scripts/content/catalog_poll_benchmark.py --reads 200

To compare revisions, run it in a checkout of each one; the database and content are
rebuilt every time.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import shutil
import statistics
import sys
import tempfile
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

REPOSITORY = Path(__file__).resolve().parents[2]
OWNER = "benchmark-owner"


def summary(name: str, wall: list[float], cpu: list[float], statements: list[int]) -> str:
    """One result line: wall and CPU milliseconds per read (p50/p95), and SQL statements."""

    def milliseconds(values: list[float], quantile: int) -> float:
        return statistics.quantiles(values, n=100, method="inclusive")[quantile - 1] * 1000

    return (
        f"{name}: wall p50 {milliseconds(wall, 50):.1f} ms, p95 {milliseconds(wall, 95):.1f} ms; "
        f"CPU p50 {milliseconds(cpu, 50):.1f} ms, p95 {milliseconds(cpu, 95):.1f} ms; "
        f"SQL statements {statistics.median(statements):.0f}"
    )


async def measure(
    reads: int, read: Callable[[], Awaitable[Any]], counted: list[int]
) -> tuple[list[float], list[float], list[int]]:
    """Time ``reads`` calls of ``read`` after a short warm-up."""

    for _ in range(5):
        await read()
    wall: list[float] = []
    cpu: list[float] = []
    statements: list[int] = []
    for _ in range(reads):
        counted[0] = 0
        started_wall, started_cpu = time.perf_counter(), time.process_time()
        await read()
        wall.append(time.perf_counter() - started_wall)
        cpu.append(time.process_time() - started_cpu)
        statements.append(counted[0])
    return wall, cpu, statements


async def run(reads: int, root: Path) -> None:
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import event
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from testcontainers.postgres import PostgresContainer

    import animama
    import animama.local.installation_model  # noqa: F401 (local schema registration)
    import animama.orm  # noqa: F401 (shared schema registration)
    from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
    from animama.app.services.content_catalog_service import ContentCatalogService
    from animama.domain.request_principal import RequestPrincipal
    from animama.orm.base import Base
    from animama.product_http.ports import install_product_ports
    from animama.product_http.principal import get_current_principal
    from animama.product_http.routes import content
    from animama.server.config import Settings
    from animama.server.local_runtime import initialize_local_runtime, local_content_store
    from animama.server.product_ports import LocalProductPorts

    print(f"Backend source: {Path(animama.__file__).parent}")
    # A copy, so creating the runtime's type directories never touches the checkout.
    shutil.copytree(REPOSITORY / "content" / "included", root / "content" / "included")
    settings = Settings(animama_content_root=root / "content", animama_data_root=root / "data")
    paths = initialize_local_runtime(settings)

    with PostgresContainer(image="pgvector/pgvector:pg16") as container:
        url = container.get_connection_url().replace("postgresql+psycopg2://", "postgresql+asyncpg://")
        # Pooled with a pre-ping, as the local composition's engine is by default.
        engine = create_async_engine(url, pool_pre_ping=True)
        try:
            async with engine.begin() as connection:
                await connection.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
                await connection.run_sync(Base.metadata.create_all)
            sessions = async_sessionmaker(engine, expire_on_commit=False)
            async with sessions() as session:
                service = ContentCatalogService(
                    store=local_content_store(paths), catalog=SQLAlchemyContentCatalog(session)
                )
                scanned = await service.rescan(user_id=OWNER)
            print(f"Visible catalog entries: {len(scanned.items)}")

            counted = [0]

            def count(*_: object) -> None:
                counted[0] += 1

            event.listen(engine.sync_engine, "before_cursor_execute", count)

            app = FastAPI()
            app.state.session_factory = sessions
            app.state.local_runtime_paths = paths
            app.state.runtime_settings = settings
            install_product_ports(app, LocalProductPorts(app))
            app.include_router(content.router)

            async def owner() -> RequestPrincipal:
                return RequestPrincipal(id=OWNER)

            app.dependency_overrides[get_current_principal] = owner

            @asynccontextmanager
            async def client() -> AsyncIterator[AsyncClient]:
                async with AsyncClient(transport=ASGITransport(app=app), base_url="http://bench") as value:
                    yield value

            async with client() as http:
                first = await http.get("/v1/content/catalog", headers={"Accept-Encoding": "gzip"})
                first.raise_for_status()
                etag = first.headers["etag"]
                print(f"Body: {len(first.content)} bytes JSON, {first.headers['content-length']} bytes gzip")

                async def full() -> None:
                    response = await http.get("/v1/content/catalog", headers={"Accept-Encoding": "gzip"})
                    assert response.status_code == 200, response.status_code

                async def unchanged() -> None:
                    response = await http.get(
                        "/v1/content/catalog", headers={"Accept-Encoding": "gzip", "If-None-Match": etag}
                    )
                    assert response.status_code == 304, response.status_code

                print(summary("200", *await measure(reads, full, counted)))
                print(summary("304", *await measure(reads, unchanged, counted)))
        finally:
            await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reads", type=int, default=100, help="measured reads of each kind (default 100)")
    args = parser.parse_args()
    logging.getLogger("testcontainers").setLevel(logging.WARNING)
    sys.path.insert(0, str(REPOSITORY / "src" / "backend"))
    with tempfile.TemporaryDirectory(prefix="catalog-benchmark-") as root:
        asyncio.run(run(args.reads, Path(root)))


if __name__ == "__main__":
    main()
