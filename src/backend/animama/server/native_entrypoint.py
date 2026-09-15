"""Loopback-only entrypoint for running the local FastAPI service natively."""

from __future__ import annotations

import os

from animama.local.http.server import serve
from animama.server.config import Settings
from animama.server.local_runtime import validate_local_bindings


def main() -> None:
    """Start the local application only after validating its native bind address."""

    runtime_settings = Settings()
    validate_local_bindings(runtime_settings)
    port = int(os.getenv("ANIMAMA_LOCAL_API_PORT", "3000"))
    if not 1 <= port <= 65535:
        raise ValueError("Native application port must be from 1 to 65535")
    serve(
        "animama.server.app:app",
        host=runtime_settings.animama_local_bind_host,
        port=port,
        reload=True,
    )


if __name__ == "__main__":  # pragma: no cover - executable entrypoint
    main()
