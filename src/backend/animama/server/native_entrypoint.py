"""Loopback-only entrypoint for running the local FastAPI service natively."""

from __future__ import annotations

import os

import uvicorn

from animama.server.config import Settings
from animama.server.local_runtime import validate_local_bindings


def main() -> None:
    """Start the private API only after validating its native bind address."""

    runtime_settings = Settings()
    validate_local_bindings(runtime_settings)
    port = int(os.getenv("ANIMAMA_LOCAL_API_PORT", "8000"))
    uvicorn.run(
        "animama.server.app:app",
        host=runtime_settings.animama_local_bind_host,
        port=port,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":  # pragma: no cover - executable entrypoint
    main()
