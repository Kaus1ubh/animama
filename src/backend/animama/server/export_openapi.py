"""Export the local FastAPI schema without starting the application runtime."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from collections.abc import Sequence
from pathlib import Path

from animama.server.app import app


def export_openapi(output_path: Path) -> None:
    """Atomically write deterministic OpenAPI JSON to ``output_path``.

    Importing the FastAPI application registers its startup hooks but does not
    execute them. This keeps client generation independent from a running local
    stack, installation bootstrap and private desktop credentials.
    """

    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = (
        json.dumps(
            app.openapi(),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        + b"\n"
    )

    file_descriptor, temporary_name = tempfile.mkstemp(
        dir=output_path.parent,
        prefix=f".{output_path.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, output_path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def main(argv: Sequence[str] | None = None) -> int:
    """Run the bounded local-schema exporter."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Explicit JSON destination used by the local web-client generator.",
    )
    args = parser.parse_args(argv)
    export_openapi(args.output)
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through the CLI test
    raise SystemExit(main())


__all__ = ["export_openapi", "main"]
