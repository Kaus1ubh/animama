"""Stable CLI for the frozen local backend. Credentials travel only via env."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import stat
import sys
from collections.abc import Sequence
from pathlib import Path

FEATURE_UNAVAILABLE = 69


def delegate_document_worker() -> int:
    """Exec only the fixed helper that main has inventoried and OS-verified.

    Recheck containment and the executable digest across the process boundary;
    an absent pack never falls back to importing optional parsers in core.
    """

    executable = os.environ.get("ANIMAMA_DOCUMENT_WORKER_EXECUTABLE")
    root = os.environ.get("ANIMAMA_DOCUMENT_WORKER_ROOT")
    digest = os.environ.get("ANIMAMA_DOCUMENT_WORKER_EXECUTABLE_SHA256")
    if not executable or not root or not digest:
        print(json.dumps({"code": "feature_unavailable", "feature": "document-processing"}))
        return FEATURE_UNAVAILABLE
    base = Path(root)
    candidate = Path(executable)
    expected = base / "Animama Document Worker.app/Contents/MacOS/animama-document-worker"
    if (
        sys.platform != "darwin"
        or not base.is_absolute()
        or candidate != expected
        or candidate.resolve(strict=True) != candidate
    ):
        raise RuntimeError("document_worker_path_invalid")
    metadata = candidate.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_size > 128 * 1024 * 1024:
        raise RuntimeError("document_worker_path_invalid")
    with candidate.open("rb") as file:
        hasher = hashlib.sha256()
        for block in iter(lambda: file.read(1024 * 1024), b""):
            hasher.update(block)
        actual = hasher.hexdigest()
    if actual != digest:
        raise RuntimeError("document_worker_digest_invalid")
    environment = dict(os.environ)
    # A separately frozen application must not adopt the parent's PyInstaller
    # extraction metadata or runtime search path.
    environment["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    os.execve(candidate, [str(candidate)], environment)
    return 0  # pragma: no cover - exec replaces this process


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(prog="animama-runtime", description=__doc__)
    command.add_argument("--version", action="version", version="animama-runtime 0.1.0")
    commands = command.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="Serve the installation's loopback application")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, required=True)
    database = commands.add_parser("database").add_subparsers(dest="operation", required=True)
    database.add_parser("bootstrap", help="Apply packaged schema and installation resources")
    database.add_parser("inspect", help="Report owned database versions and installation principal")
    database.add_parser("provision", help="Create the fixed private desktop database after initdb")
    content = commands.add_parser("content").add_subparsers(dest="operation", required=True)
    content.add_parser("rescan", help="Reconcile content for the generated installation owner")
    content.add_parser("audit", help="Audit the starter closure at ANIMAMA_DESKTOP_INCLUDED_ROOT")
    worker = commands.add_parser("worker").add_subparsers(dest="operation", required=True)
    worker.add_parser("avatar-cleanup")
    worker.add_parser("user-files")
    commands.add_parser("audit-resources", help="Verify frozen resources without credentials or a database")
    commands.add_parser(
        "parse-upload",
        help="Read one uploaded file from standard input within limits (started by the server)",
    )
    return command


async def _rescan() -> None:
    from animama.local.database import LocalDatabase
    from animama.local.installation_principal import InstallationPrincipalService
    from animama.local.installation_repository import (
        SQLAlchemyInstallationSettingsRepository,
    )
    from animama.server.config import Settings
    from animama.server.content_startup import rescan_content_once
    from animama.server.local_runtime import initialize_local_runtime

    runtime_settings = Settings()
    paths = initialize_local_runtime(runtime_settings)
    database = LocalDatabase(runtime_settings)
    try:
        factory = database.session_factory()
        async with factory() as session:
            principal = await InstallationPrincipalService(
                SQLAlchemyInstallationSettingsRepository(session)
            ).require_principal()
        await rescan_content_once(paths, owner_id=principal, session_factory=factory)
    finally:
        await database.close()


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "serve":
        # Load keys into the runtime store and drop them from the environment
        # before any provider SDK is imported: the ElevenLabs client captures
        # ELEVENLABS_API_KEY as a default argument at import.
        from animama.server.runtime_credentials import scrub_credential_environment

        scrub_credential_environment()
        from animama.server.local_runtime import is_loopback_host

        if not is_loopback_host(args.host) or not 1 <= args.port <= 65535:
            parser().error("serve requires a loopback host and a port from 1 to 65535")
        os.environ["ANIMAMA_LOCAL_BIND_HOST"] = args.host
        from urllib.parse import urlsplit

        from animama.local.http.server import serve
        from animama.server.app import create_local_app
        from animama.server.config import Settings
        from animama.server.local_http import local_http_config

        runtime_settings = Settings()
        http = local_http_config(runtime_settings)
        origin = urlsplit(http.public_origin)
        if (
            http.desktop is None
            or runtime_settings.animama_web_root is None
            or origin.scheme != "http"
            or origin.hostname != args.host
            or (origin.port or 80) != args.port
            or not os.environ.get("ANIMAMA_PROCESS_START_TOKEN")
        ):
            parser().error("serve requires the owned desktop origin, built assets and paired launch credentials")
        serve(
            create_local_app(runtime_settings=runtime_settings),
            host=args.host,
            port=args.port,
            reload=False,
        )
    elif args.command == "database":
        from animama.server.db_bootstrap import bootstrap_database, inspect_database, provision_desktop_database

        if args.operation == "provision":
            provision_desktop_database()
            print(json.dumps({"schema_version": 1, "database_provisioned": True}))
        else:
            result = bootstrap_database() if args.operation == "bootstrap" else inspect_database()
            print(json.dumps(result, sort_keys=True))
    elif args.command == "content" and args.operation == "rescan":
        asyncio.run(_rescan())
    elif args.command == "content":
        from animama.runtime.starter_content import starter_inventory

        root = os.environ.get("ANIMAMA_DESKTOP_INCLUDED_ROOT")
        if not root:
            parser().error("content audit requires ANIMAMA_DESKTOP_INCLUDED_ROOT")
        print(json.dumps(starter_inventory(Path(root)), indent=2, sort_keys=True))
    elif args.command == "worker" and args.operation == "avatar-cleanup":
        from animama.workers.avatar_upload_cleanup import main as cleanup

        asyncio.run(cleanup())
    elif args.command == "worker":
        return delegate_document_worker()
    elif args.command == "parse-upload":
        # Parser code is imported only inside the child, after it installs its guards.
        from animama.adapters.parsers.parse_child import run_parse_child

        return run_parse_child()
    else:
        from animama.runtime.resources import print_resource_audit

        print_resource_audit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
