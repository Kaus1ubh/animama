"""Container-only application listener; Compose owns loopback publication."""

import os

from animama.local.http.server import serve


def main() -> None:
    """Keep the container bind separate from validated native loopback launchers."""
    serve(
        "animama.server.app:app",
        host="0.0.0.0",
        port=8000,
        reload=os.getenv("ANIMAMA_BACKEND_RELOAD") == "1",
    )


if __name__ == "__main__":  # pragma: no cover - executable entrypoint
    main()
