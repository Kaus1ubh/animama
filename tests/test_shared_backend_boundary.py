"""Verify shared imports/resources and per-application local dependency wiring."""

from __future__ import annotations

import json
import os
import runpy
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi import Request

ROOT = Path(__file__).resolve().parents[1]


def test_shared_consumer_bootstraps_two_owners_and_streams_without_local_imports(tmp_path):
    environment = dict(os.environ)
    environment["ANIMAMA_LOG_TO_FILE"] = "1"
    environment["ANIMAMA_LOG_DIR"] = str(tmp_path / "must-not-be-created")
    result = subprocess.run(
        [sys.executable, "-I", str(ROOT / "scripts/repository-boundary/consumers/backend.py")],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=True,
    )
    evidence = json.loads(result.stdout)
    assert evidence["owners"] == evidence["chat_turns"] == evidence["catalogs"] == 2
    assert evidence["persisted_messages"] == 4
    assert evidence["local_imports"] == 0
    assert not (tmp_path / "must-not-be-created").exists()


def test_generated_catalog_copies_match_canonical_inputs_and_drift_fails(tmp_path):
    helpers = runpy.run_path(str(ROOT / "src/backend/packaging/shared_catalogs.py"))
    helpers["sync_catalogs"](ROOT)
    for name, relative in helpers["CATALOG_INPUTS"].items():
        canonical = tmp_path / relative
        canonical.parent.mkdir(parents=True, exist_ok=True)
        canonical.write_bytes(b"canonical catalog")
        generated = tmp_path / "src/backend/animama/resources" / name
        generated.parent.mkdir(parents=True, exist_ok=True)
        generated.write_bytes(b"old catalog")
    with pytest.raises(ValueError, match="Generated shared catalog differs"):
        helpers["sync_catalogs"](tmp_path)
    helpers["sync_catalogs"](tmp_path, write=True)
    helpers["sync_catalogs"](tmp_path)


async def test_app_session_factories_are_injected_and_isolated():
    from animama.server.app import create_local_app
    from animama.server.deps import get_async_session, get_async_session_factory

    first_session, second_session = object(), object()

    @asynccontextmanager
    async def first_factory():
        yield first_session

    @asynccontextmanager
    async def second_factory():
        yield second_session

    first = create_local_app(session_factory=first_factory)
    second = create_local_app(session_factory=second_factory)
    assert get_async_session_factory(first) is first_factory
    assert get_async_session_factory(second) is second_factory
    for app, expected in ((first, first_session), (second, second_session)):
        request = Request({"type": "http", "app": app, "headers": []})
        sessions = [session async for session in get_async_session(request)]
        assert sessions == [expected]


async def test_default_apps_keep_their_databases_and_shutdown_separate():
    """Building real SQLAlchemy pools needs no connection to either fixture database."""
    from animama.server.app import create_local_app
    from animama.server.config import Settings
    from animama.server.deps import get_async_session_factory

    first = create_local_app(runtime_settings=Settings(animama_database_url="postgresql+asyncpg://localhost/first"))
    second = create_local_app(runtime_settings=Settings(animama_database_url="postgresql+asyncpg://localhost/second"))
    try:
        first_factory = get_async_session_factory(first)
        second_factory = get_async_session_factory(second)
        assert first_factory is not second_factory
        assert first_factory.kw["bind"] is not second_factory.kw["bind"]
        assert first_factory.kw["bind"].url.database == "first"
        assert second_factory.kw["bind"].url.database == "second"
        await first.router.shutdown()
        assert get_async_session_factory(second) is second_factory
    finally:
        await first.router.shutdown()
        await second.router.shutdown()


def test_local_engine_respects_explicit_app_settings(monkeypatch):
    from animama.local import database
    from animama.server.config import Settings

    calls = []
    monkeypatch.setattr(database, "create_async_engine", lambda url, **kwargs: calls.append((url, kwargs)))
    monkeypatch.setenv("ANIMAMA_DATABASE_URL", "postgresql+asyncpg://ignored/other")
    settings = Settings(animama_database_url="postgresql+asyncpg://explicit/selected", animama_database_pool_size=3)
    database.create_local_engine(settings)
    assert calls[0][0] == "postgresql+asyncpg://explicit/selected"
    assert calls[0][1]["pool_size"] == 3
