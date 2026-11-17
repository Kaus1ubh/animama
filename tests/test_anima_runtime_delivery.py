"""HTTP representation tests: fresh owner leases, exact gzip bytes, and unchanged private files."""

from __future__ import annotations

import gzip
import hashlib
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services.anima_runtime_service import ISSUE_ATTEMPTS, AnimaRuntimeService, RuntimeSnapshotError
from animama.domain.content_catalog import ContentSource, VerifiedContentFile
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.principal import get_current_principal
from animama.product_http.routes import anima_runtime
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime
from animama.server.product_ports import LocalProductPorts
from tests.local_http_client import local_client
from tests.product_http_support import install_local_ports


@pytest.fixture
def runtime_http(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> SimpleNamespace:
    """Use dependency overrides and the real router/serialization, without a database."""
    app = FastAPI()
    app.include_router(anima_runtime.router)
    app.state.local_runtime_paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    state = SimpleNamespace(app=app, owner="owner", authorized=True, calls=[], expires=datetime(2026, 9, 2, tzinfo=UTC))

    async def principal() -> RequestPrincipal:
        if not state.authorized:
            raise HTTPException(status_code=403)
        return RequestPrincipal(id=state.owner)

    async def prepare(_self, *, user_id: str, anima_id: str):
        state.calls.append((user_id, anima_id))
        if user_id != "owner":
            raise RuntimeSnapshotError("anima_not_found")
        return SimpleNamespace(anima_id=anima_id)

    async def commit(_self, _prepared, *, user_id: str):
        return {
            "loadout_revision": 1,
            "effective_revision": "same-content-revision",
            "lease_expires_at": state.expires,
            "content_descriptor": {"revision": "same-content-revision", "total_bytes": 0},
            "warnings": [{"code": "fixture", "message": "Diagnostic retained in full. " * 100, "scope": "runtime"}],
        }

    app.dependency_overrides[get_current_principal] = principal
    # Runtime services are patched, so no database is reached.
    install_local_ports(app, cast(AsyncSession, SimpleNamespace(commit=AsyncMock())))
    monkeypatch.setattr(AnimaRuntimeService, "prepare", prepare)
    monkeypatch.setattr(AnimaRuntimeService, "commit", commit)
    return state


async def _wire(client: AsyncClient, encoding: str, *, etag: str | None = None):
    headers = {"Accept-Encoding": encoding}
    if etag:
        headers["If-None-Match"] = etag
    async with client.stream("GET", "/v1/animas/anima/runtime", headers=headers) as response:
        body = b"".join([chunk async for chunk in response.aiter_raw()])
        return response, body


async def test_runtime_manifest_compresses_real_wire_bytes_without_changing_json(runtime_http: SimpleNamespace) -> None:
    async with local_client(runtime_http.app) as client:
        identity, raw = await _wire(client, "identity")
        compressed, wire = await _wire(client, "gzip")
        assert identity.status_code == compressed.status_code == 200
        assert "content-encoding" not in identity.headers
        assert compressed.headers["content-encoding"] == "gzip"
        assert gzip.decompress(wire) == raw
        assert len(wire) < len(raw) / 2
        for response, body in [(identity, raw), (compressed, wire)]:
            assert int(response.headers["content-length"]) == len(body)
            assert response.headers["etag"] == f'"{hashlib.sha256(body).hexdigest()}"'
            assert response.headers["vary"] == "Accept-Encoding"
            assert response.headers["cache-control"] == "private, no-cache"
        assert json.loads(raw)["effective_revision"] == "same-content-revision"


@pytest.mark.parametrize(
    ("accepted", "expected"),
    [
        ("", "identity"),
        ("br", "identity"),
        ("gzip;q=0", "identity"),
        ("GZip;q=0.8, br", "gzip"),
        ("*;q=0.5", "gzip"),
        ("gzip;q=0, *;q=1", "identity"),
        ("gzip;q=invalid", "identity"),
        ("gzip;q=2", "identity"),
        ("gzip;q=nan", "identity"),
        ("gzip;q=0.1, identity;q=0.9", "identity"),
        ("gzip;q=1, identity;q=0", "gzip"),
    ],
)
async def test_runtime_manifest_encoding_negotiation(
    runtime_http: SimpleNamespace, accepted: str, expected: str
) -> None:
    async with local_client(runtime_http.app) as client:
        response, body = await _wire(client, accepted)
        assert response.status_code == 200
        assert response.headers.get("content-encoding", "identity") == expected
        assert json.loads(gzip.decompress(body) if expected == "gzip" else body)["catalog_version"] == 4


async def test_manifest_conditional_request_still_issues_fresh_owner_lease(runtime_http: SimpleNamespace) -> None:
    async with local_client(runtime_http.app) as client:
        first, first_wire = await _wire(client, "gzip")
        runtime_http.expires += timedelta(minutes=1)
        second, second_wire = await _wire(client, "gzip", etag=first.headers["etag"])
        assert second.status_code == 200
        assert second.headers["etag"] != first.headers["etag"]
        old, new = (json.loads(gzip.decompress(value)) for value in [first_wire, second_wire])
        assert old["effective_revision"] == new["effective_revision"]
        assert old["lease_expires_at"] != new["lease_expires_at"]
        assert runtime_http.calls == [("owner", "anima"), ("owner", "anima")]

        runtime_http.owner = "other-owner"
        denied, _ = await _wire(client, "gzip", etag=first.headers["etag"])
        assert denied.status_code == 404
        assert "content-encoding" not in denied.headers
        runtime_http.authorized = False
        denied, _ = await _wire(client, "gzip")
        assert denied.status_code == 403
        assert "content-encoding" not in denied.headers


async def test_no_acceptable_manifest_encoding_has_a_bounded_error(runtime_http: SimpleNamespace) -> None:
    async with local_client(runtime_http.app) as client:
        response, body = await _wire(client, "gzip;q=0, identity;q=0")
        assert response.status_code == 406
        assert json.loads(body)["detail"]["code"] == "runtime_encoding_not_acceptable"
        assert runtime_http.calls == []


async def test_runtime_private_file_does_not_use_manifest_compression(
    runtime_http: SimpleNamespace,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = b"exact registered binary bytes" * 100
    digest = hashlib.sha256(body).hexdigest()

    async def authorize(_self, **_kwargs):
        return SimpleNamespace(
            source=ContentSource.LOCAL,
            source_mount_id=None,
            relative_path="file.bin",
            size_bytes=len(body),
            sha256=digest,
            media_type="application/octet-stream",
        )

    monkeypatch.setattr(AnimaRuntimeService, "authorize_file", authorize)
    monkeypatch.setattr(
        FilesystemContentStore,
        "open_verified_file",
        lambda _self, **_kwargs: VerifiedContentFile(BytesIO(body), len(body), digest, "application/octet-stream"),
    )
    async with local_client(runtime_http.app) as client:
        response = await client.get(
            "/v1/animas/anima/runtime/revisions/revision/files/member", headers={"Accept-Encoding": "gzip"}
        )
        assert response.status_code == 200
        assert response.content == body
        assert "content-encoding" not in response.headers
        assert response.headers["etag"] == f'"{digest}"'
        assert int(response.headers["content-length"]) == len(body)
        # The URL names the exact revision and file, so the local policy keeps it a year.
        assert response.headers["cache-control"] == "private, max-age=31536000, immutable"
        assert response.headers["content-security-policy"] == "sandbox; default-src 'none'"


async def test_issuance_prepares_again_while_the_loadout_keeps_changing(
    runtime_http: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def stale(_self, _prepared, *, user_id: str) -> None:
        # The loadout changed after preparation: the commit wrote nothing.
        return None

    monkeypatch.setattr(AnimaRuntimeService, "commit", stale)
    async with local_client(runtime_http.app) as client:
        response, body = await _wire(client, "identity")
    assert response.status_code == 409
    assert json.loads(body)["detail"]["code"] == "snapshot_conflict"
    assert runtime_http.calls == [("owner", "anima")] * ISSUE_ATTEMPTS


async def test_issuance_prepares_on_the_read_session_and_commits_on_the_write_session(
    runtime_http: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
) -> None:
    sessions = {kind: SimpleNamespace(kind=kind, commit=AsyncMock()) for kind in ("read", "write")}
    used: list[tuple[str, str]] = []

    def opener(kind: str):
        @asynccontextmanager
        async def session(_self, _principal):
            used.append(("open", kind))
            yield sessions[kind]
            used.append(("close", kind))

        return session

    monkeypatch.setattr(LocalProductPorts, "read_session", opener("read"))
    monkeypatch.setattr(LocalProductPorts, "write_session", opener("write"))
    prepare, commit = AnimaRuntimeService.prepare, AnimaRuntimeService.commit

    async def recorded_prepare(self, **kwargs):
        used.append(("prepare", self.session.kind))
        return await prepare(self, **kwargs)

    async def recorded_commit(self, prepared, **kwargs):
        used.append(("commit", self.session.kind))
        return await commit(self, prepared, **kwargs)

    monkeypatch.setattr(AnimaRuntimeService, "prepare", recorded_prepare)
    monkeypatch.setattr(AnimaRuntimeService, "commit", recorded_commit)
    async with local_client(runtime_http.app) as client:
        response, _ = await _wire(client, "identity")
    assert response.status_code == 200
    # The write session opens only after the read session that prepared has closed.
    assert used == [
        ("open", "read"),
        ("prepare", "read"),
        ("close", "read"),
        ("open", "write"),
        ("commit", "write"),
        ("close", "write"),
    ]
