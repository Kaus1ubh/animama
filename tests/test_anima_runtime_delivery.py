"""HTTP representation tests: fresh owner leases, exact gzip bytes, and unchanged private files."""

from __future__ import annotations

import gzip
import hashlib
import json
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
from animama.app.services.anima_runtime_service import AnimaRuntimeService, RuntimeSnapshotError
from animama.domain.content_catalog import ContentSource, VerifiedContentFile
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.principal import get_current_principal
from animama.product_http.routes import anima_runtime
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime
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

    async def issue(_self, *, user_id: str, anima_id: str):  # noqa: ANN001, ANN202
        state.calls.append((user_id, anima_id))
        if user_id != "owner":
            raise RuntimeSnapshotError("anima_not_found")
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
    monkeypatch.setattr(AnimaRuntimeService, "issue", issue)
    return state


async def _wire(client: AsyncClient, encoding: str, *, etag: str | None = None):  # noqa: ANN202
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

    async def authorize(_self, **_kwargs):  # noqa: ANN001, ANN003, ANN202
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
