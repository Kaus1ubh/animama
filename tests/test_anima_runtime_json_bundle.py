"""Optional JSON aggregation retains exact-file authority and fault isolation."""

from __future__ import annotations

import gzip
import hashlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services.anima_runtime_service import RuntimeFileAuthorization, RuntimeSnapshotError, _runtime_response
from animama.domain.content_catalog import ContentSource
from animama.domain.request_principal import RequestPrincipal
from animama.domain.runtime_json_bundle import select_runtime_json_members
from animama.product_http.ports import install_product_ports
from animama.product_http.principal import get_current_principal
from animama.product_http.routes import anima_runtime
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime
from tests.local_http_client import local_client


def _catalog(count: int = 3, size: int = 20) -> dict[str, Any]:
    members = [
        {"file_ref": f"file-{index:03}", "role": "sequence", "media_type": "application/json", "size_bytes": size}
        for index in range(count)
    ]
    return {
        "avatar": {"runtime_root_id": "avatar", "files": [members[0]]},
        "gestures": [{"files": members[1:]}],
        "content_descriptor": {"members": members, "roots": [{"root_id": "avatar", "member_refs": ["file-000"]}]},
    }


def test_selection_excludes_essential_control_binary_and_unprojected_files() -> None:
    catalog = _catalog(8)
    members = catalog["content_descriptor"]["members"]
    members[3]["role"] = "descriptor"
    members[4]["role"] = "meta"
    members[5]["media_type"] = "model/gltf-binary"
    catalog["content_descriptor"]["roots"][0]["member_refs"].append(members[6]["file_ref"])
    catalog["gestures"][0]["files"] = members[1:7]
    assert [member["file_ref"] for member in select_runtime_json_members(catalog)] == ["file-001", "file-002"]
    catalog["content_descriptor"]["members"].reverse()
    assert [member["file_ref"] for member in select_runtime_json_members(catalog)] == ["file-001", "file-002"]


def test_selection_bounds_and_issuance_do_not_mutate_persisted_catalog() -> None:
    assert select_runtime_json_members(_catalog(2)) == []
    assert len(select_runtime_json_members(_catalog(300))) == 256
    assert len(select_runtime_json_members(_catalog(20, 256 * 1024))) == 8
    assert select_runtime_json_members(_catalog(3, 256 * 1024 + 1)) == []
    catalog = _catalog()
    issued = _runtime_response(
        catalog, anima_id="anima", effective_revision="revision", lease_expires_at=datetime.now(UTC)
    )
    assert issued["json_bundle"]["file_refs"] == ["file-001", "file-002"]
    assert issued["json_bundle"]["total_bytes"] == 40
    assert "json_bundle" not in catalog


@pytest.fixture
def bundle_http(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> SimpleNamespace:
    app = FastAPI()
    app.include_router(anima_runtime.router)
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    app.state.local_runtime_paths = paths
    state = SimpleNamespace(
        app=app,
        owner="owner",
        expires=datetime.now(UTC) + timedelta(hours=1),
        session=SimpleNamespace(commit=AsyncMock()),
        catalog_service=SimpleNamespace(mark_scan_required=AsyncMock()),
        opens=0,
        queries=0,
        raw=[b"{}", '{\r\n "name": "é🙂", "value": 1.00 }\n'.encode(), b'{"tracks": []}\n'],
        catalog=_catalog(),
        denied_ref=None,
        paths=[],
    )
    authorizations = {}
    for member, raw in zip(state.catalog["content_descriptor"]["members"], state.raw, strict=True):
        relative = f"{member['file_ref']}.json"
        path = paths.local_root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        state.paths.append(path)
        member["sha256"] = hashlib.sha256(raw).hexdigest()
        member["size_bytes"] = len(raw)
        authorizations[member["file_ref"]] = RuntimeFileAuthorization(
            item_id=member["file_ref"],
            source=ContentSource.LOCAL,
            relative_path=relative,
            role="sequence",
            media_type="application/json",
            size_bytes=len(raw),
            sha256=member["sha256"],
        )
    state.authorizations = authorizations

    class Runtime:
        def __init__(self, _session):  # noqa: ANN001
            self.catalog = state.catalog_service
            self.session = state.session

        async def get_snapshot(self, *, user_id: str, anima_id: str, revision: str):  # noqa: ANN202
            if (user_id, anima_id, revision) != ("owner", "anima", "revision"):
                return None
            return SimpleNamespace(catalog=state.catalog, expires_at=state.expires)

        async def authorize_files(self, *, file_refs: list[str], **_kwargs):  # noqa: ANN003, ANN202
            state.queries += 1
            return {
                ref: RuntimeSnapshotError("runtime_file_changed_remount_required")
                if ref == state.denied_ref
                else authorizations[ref]
                for ref in file_refs
            }

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id=state.owner)

    class Ports:
        """Serve the fake runtime and the real local store as the owner's content."""

        store = FilesystemContentStore(
            included_root=paths.included_root,
            included_sources=paths.included_sources,
            local_root=paths.local_root,
            operations_root=paths.operations_root,
        )

        @asynccontextmanager
        async def write_session(self, principal: RequestPrincipal) -> AsyncIterator[Any]:
            yield state.session

        read_session = write_session

        @asynccontextmanager
        async def content(self, session: Any, principal: RequestPrincipal) -> AsyncIterator[Any]:
            yield SimpleNamespace(runtime=Runtime(session), store=self.store)

    original_open = FilesystemContentStore.open_verified_file

    def opened(self, **kwargs):  # noqa: ANN001, ANN003, ANN202
        state.opens += 1
        return original_open(self, **kwargs)

    app.dependency_overrides[get_current_principal] = principal
    install_product_ports(app, Ports())  # type: ignore[arg-type]
    monkeypatch.setattr(FilesystemContentStore, "open_verified_file", opened)
    return state


URL = "/v1/animas/anima/runtime/revisions/revision/json-bundle"


async def test_bundle_wire_integrity_revalidation_and_no_lease_renewal(bundle_http: SimpleNamespace) -> None:
    state = bundle_http
    expires = state.expires
    async with local_client(state.app) as client:
        identity = await client.get(URL, headers={"Accept-Encoding": "identity"})
        async with client.stream("GET", URL, headers={"Accept-Encoding": "gzip"}) as compressed:
            wire = b"".join([chunk async for chunk in compressed.aiter_raw()])
        assert gzip.decompress(wire) == identity.content
        assert int(compressed.headers["content-length"]) == len(wire)
        assert compressed.headers["etag"] == f'"{hashlib.sha256(wire).hexdigest()}"'
        assert compressed.headers["etag"] != identity.headers["etag"]
        assert compressed.headers["vary"] == "Accept-Encoding"
        assert identity.headers["cache-control"] == "private, no-cache"
        envelope = identity.json()
        assert [member["text"].encode() for member in envelope["members"]] == state.raw[1:]
        cached = await client.get(URL, headers={"Accept-Encoding": "gzip", "If-None-Match": compressed.headers["etag"]})
        assert cached.status_code == 304
        assert cached.content == b""
        assert state.opens == 6 and state.queries == 3
        assert state.expires == expires
        state.session.commit.assert_not_awaited()


@pytest.mark.parametrize("failure", ["changed", "deleted", "catalog", "invalid_utf8"])
async def test_bad_member_keeps_good_members_and_disables_caching(bundle_http: SimpleNamespace, failure: str) -> None:
    state = bundle_http
    async with local_client(state.app) as client:
        first = await client.get(URL)
        if failure == "deleted":
            state.paths[1].unlink()
        elif failure == "catalog":
            state.denied_ref = "file-001"
        else:
            state.paths[1].write_bytes(b"\xff" if failure == "invalid_utf8" else b"changed")
            if failure == "invalid_utf8":
                # Keep the descriptor/hash consistent so this exercises strict
                # UTF-8 decoding, not merely the already-tested digest rejection.
                digest = hashlib.sha256(b"\xff").hexdigest()
                state.catalog["content_descriptor"]["members"][1].update(size_bytes=1, sha256=digest)
                state.authorizations["file-001"] = replace(
                    state.authorizations["file-001"], size_bytes=1, sha256=digest
                )
        response = await client.get(URL, headers={"If-None-Match": first.headers["etag"]})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert "etag" not in response.headers
        bad, good = response.json()["members"]
        assert bad == {"file_ref": "file-001", "error": "runtime_file_changed_remount_required"}
        assert good["text"].encode() == state.raw[2]
        assert state.catalog_service.mark_scan_required.await_count == (0 if failure == "catalog" else 1)


@pytest.mark.parametrize("failure", ["owner", "expired", "revision"])
async def test_bundle_conditional_request_cannot_bypass_authority(bundle_http: SimpleNamespace, failure: str) -> None:
    state = bundle_http
    async with local_client(state.app) as client:
        first = await client.get(URL)
        url = URL
        if failure == "owner":
            state.owner = "another-owner"
        elif failure == "expired":
            state.expires = datetime.now(UTC) - timedelta(seconds=1)
        else:
            url = URL.replace("/revision/", "/unknown/")
        response = await client.get(url, headers={"If-None-Match": first.headers["etag"]})
        assert response.status_code == (409 if failure == "expired" else 404)
        assert state.opens == 2
