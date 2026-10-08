"""The single reviewed Uvicorn configuration used by local launchers."""

from __future__ import annotations

from pathlib import Path

import uvicorn
from fastapi import FastAPI

from animama.local.http.protocol import LocalH11Protocol

# Development reload follows backend Python only. Watching the whole checkout
# also scans frontend dependencies, content roots and journey output.
BACKEND_RELOAD_DIRS = (str(Path(__file__).resolve().parents[2]),)


def serve(application: FastAPI | str, *, host: str, port: int, reload: bool = False) -> None:
    """Bind only the caller's explicit address with the reviewed transport guards."""
    uvicorn.run(
        application,
        host=host,
        port=port,
        reload=reload,
        reload_dirs=list(BACKEND_RELOAD_DIRS) if reload else None,
        http=LocalH11Protocol,
        ws="websockets",
        proxy_headers=False,
        timeout_keep_alive=5,
        timeout_graceful_shutdown=15,
        log_level="info",
        access_log=False,
    )
