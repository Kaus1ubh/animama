from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Awaitable, Callable

import dotenv
import httpx
import pytest_asyncio

dotenv.load_dotenv()


@pytest_asyncio.fixture
async def wait_for_server_health() -> Callable[..., Awaitable[None]]:
    """Async helper fixture to poll the FastAPI /health endpoint until ready."""

    async def _wait_for_health(base_url: str, *, attempts: int = 15, delay: float = 0.2) -> None:
        health_url = f"{base_url.rstrip('/')}/health"
        last_exc: Exception | None = None
        async with httpx.AsyncClient(timeout=5.0) as client:
            for _ in range(attempts):
                try:
                    response = await client.get(health_url)
                    response.raise_for_status()
                    return
                except Exception as exc:
                    last_exc = exc
                    await asyncio.sleep(delay)
        raise RuntimeError(f"Anima server health check failed for {health_url}") from last_exc

    return _wait_for_health


@pytest_asyncio.fixture
async def anima_server_base_url(
    db_ready: str, wait_for_server_health: Callable[..., Awaitable[None]]
) -> AsyncIterator[str]:
    """Start an in-process FastAPI test server using the testcontainer database.

    This ensures:
    - Tests are isolated and self-contained
    - Server and tests share the same database (enables DB assertions)
    - No manual setup required
    - Tests are repeatable

    The server runs on a random free port to avoid conflicts.
    """
    import socket

    import uvicorn

    # Ensure server uses testcontainer database BEFORE importing the app
    os.environ["ANIMAMA_DATABASE_URL"] = db_ready
    # Disable file logging for test server runs (console-only)
    os.environ.setdefault("ANIMAMA_LOG_TO_FILE", "0")
    # Also disable console logging for server logs in tests
    os.environ.setdefault("ANIMAMA_LOG_TO_CONSOLE", "0")

    from animama.server.app import app

    print(f"Starting in-process test server with testcontainer DB: {db_ready}")

    # Find a free port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        s.listen(1)
        port = s.getsockname()[1]

    # Start server in background using uvicorn

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="error",  # Reduce noise in test output
        access_log=False,
    )
    server = uvicorn.Server(config)

    # Run server in background task
    server_task = asyncio.create_task(server.serve())

    # Wait for server to be ready
    base_url = f"http://127.0.0.1:{port}"
    try:
        await wait_for_server_health(base_url, attempts=30, delay=0.5)
        print(f"✓ Test server started at {base_url}")
    except Exception as e:
        server.should_exit = True
        await server_task
        raise RuntimeError(f"Failed to start test server: {e}") from e

    yield base_url

    # Shutdown server
    print("Shutting down test server...")
    server.should_exit = True
    try:
        await asyncio.wait_for(server_task, timeout=5.0)
    except TimeoutError:
        print("Server shutdown timed out, forcing exit")
    print("✓ Test server shut down")
