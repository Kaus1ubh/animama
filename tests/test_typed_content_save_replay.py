"""HTTP Save responses use the completed result rather than the mutable catalog."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI

from animama.app.services.typed_content_service import TypedCatalogItem, TypedContentService
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentKind,
    ContentNotFoundError,
    ContentScope,
    ContentSource,
    ContentStatus,
    SavedContent,
)
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import install_product_ports
from animama.product_http.principal import get_current_principal
from animama.product_http.routes import typed_content
from tests.local_http_client import local_client


def _entry(kind: ContentKind, *, item_id: str) -> CatalogContentEntry:
    """Build an admitted standalone snapshot with an identifiable original file."""

    suffix, role, media_type = {
        ContentKind.GESTURE: ("vrma", "animation", "model/gltf-binary"),
        ContentKind.AVATAR: ("vrm", "model", "model/gltf-binary"),
        ContentKind.APPEARANCE: ("webp", "image", "image/webp"),
        ContentKind.POSE_CLIP: ("json", "pose_clip", "application/json"),
        ContentKind.MUSIC_TRACK: ("mp3", "audio", "audio/mpeg"),
    }[kind]
    locator = f"{kind.value}/{item_id}.{suffix}"
    return CatalogContentEntry(
        id=item_id,
        source=ContentSource.LOCAL,
        scope=ContentScope.OWNER,
        owner_user_id="replay-owner",
        kind=kind,
        relative_locator=locator,
        display_name="Original",
        status=ContentStatus.VALID,
        revision_sha256="a" * 64,
        logical_key=f"local:{kind.value}:{item_id}",
        metadata={"content_type": kind.value, "name": "Original"},
        files=(
            CatalogContentFile(
                file_ref=f"{item_id}-original-file",
                item_id=item_id,
                source=ContentSource.LOCAL,
                relative_path=locator,
                role=role,
                media_type=media_type,
                size_bytes=14,
                sha256="b" * 64,
            ),
        ),
    )


class _CompletedSave:
    """Stand in for an owned mutation that replays its durable result snapshot."""

    def __init__(self, item: CatalogContentEntry) -> None:
        self.item = item

    async def save_standalone_stream(self, **kwargs: Any) -> SavedContent:
        return SavedContent(operation_id=kwargs["operation_id"], item=self.item)


class _LiveTypedCatalog:
    """Keep later catalog changes independent of the completed Save result."""

    def __init__(self, items: dict[str, CatalogContentEntry]) -> None:
        self.items = items

    async def get(self, *, user_id: str, kind: ContentKind, item_id: str) -> TypedCatalogItem:
        item = self.items.get(item_id)
        if item is None or item.kind is not kind or item.owner_user_id != user_id:
            raise ContentNotFoundError("The current item no longer exists")
        return TypedContentService.parse(item)


class _StandInPorts:
    """Serve the stand-ins as the owner's content, with no sessions or database I/O."""

    def __init__(self, saves: _CompletedSave, typed: _LiveTypedCatalog) -> None:
        self._content = SimpleNamespace(saves=saves, typed=typed)

    @asynccontextmanager
    async def read_session(self, principal: RequestPrincipal) -> AsyncIterator[None]:
        yield None

    write_session = read_session

    @asynccontextmanager
    async def content(self, session: None, principal: RequestPrincipal) -> AsyncIterator[SimpleNamespace]:
        yield self._content


def _app(saved: CatalogContentEntry, live: _LiveTypedCatalog) -> FastAPI:
    """Exercise real HTTP parsing and response projection with no database I/O."""

    app = FastAPI()
    app.include_router(typed_content.router)

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id="replay-owner")

    app.dependency_overrides[get_current_principal] = principal
    install_product_ports(app, _StandInPorts(_CompletedSave(saved), live))  # type: ignore[arg-type]
    return app


@pytest.mark.parametrize("later_change", ["edited", "deleted"])
@pytest.mark.parametrize("portrait", [False, True], ids=["gesture", "avatar-portrait"])
async def test_save_replay_returns_original_typed_snapshot_after_catalog_change(
    later_change: str, portrait: bool
) -> None:
    original = _entry(ContentKind.APPEARANCE if portrait else ContentKind.GESTURE, item_id="saved-item")
    avatar = _entry(ContentKind.AVATAR, item_id="avatar-item")
    live = _LiveTypedCatalog({original.id: original, avatar.id: avatar})
    app = _app(original, live)
    route = "/v1/avatar-content/avatar-item/portrait" if portrait else "/v1/gestures/Original"
    current_route = f"/v1/appearance-content/{original.id}" if portrait else f"/v1/gestures/{original.id}"
    form = {"operation_id": "completed-save"}
    if portrait:
        form.update(entry_name="Original", expected_avatar_revision="a" * 64)
    upload_field = "file" if portrait else "files"

    async with local_client(app) as client:
        first = await client.put(route, data=form, files={upload_field: ("source.webp", b"original bytes")})
        assert first.status_code == 200, first.text
        original_response = first.json()
        assert original_response["name"] == "Original"
        assert original_response["revision_sha256"] == "a" * 64
        assert "operation_id" not in original_response

        if later_change == "edited":
            live.items[original.id] = replace(
                original,
                display_name="Later edit",
                metadata={**original.metadata, "name": "Later edit"},
                revision_sha256="c" * 64,
            )
        else:
            del live.items[original.id]

        current = await client.get(current_route)
        assert current.status_code == (200 if later_change == "edited" else 404), current.text
        if later_change == "edited":
            assert current.json()["name"] == "Later edit"
            assert current.json()["revision_sha256"] == "c" * 64

        replay = await client.put(route, data=form, files={upload_field: ("source.webp", b"original bytes")})
        assert replay.status_code == 200, replay.text
        assert replay.json() == original_response


@pytest.mark.parametrize(
    "kind,family", [(ContentKind.POSE_CLIP, "pose-clips"), (ContentKind.MUSIC_TRACK, "music-tracks")]
)
async def test_retired_family_hidden_put_replays_without_public_read_routes(kind, family):
    original = _entry(kind, item_id="saved-retired-item")
    if kind is ContentKind.POSE_CLIP:
        original = replace(original, metadata={**original.metadata, "schema": "animaPoseClip/1.0"})
    application = _app(original, _LiveTypedCatalog({}))
    async with local_client(application) as client:
        result = await client.put(
            f"/v1/{family}/Original",
            data={"operation_id": "completed-save"},
            files={"files": ("original.bin", b"original bytes")},
        )
        assert result.status_code == 200, result.text
        assert result.json()["kind"] == kind.value
        assert result.json()["revision_sha256"] == "a" * 64
        assert (await client.get(f"/v1/{family}")).status_code == 404
        assert (await client.get(f"/v1/{family}/{original.id}")).status_code == 405
    assert not any(family in path for path in application.openapi()["paths"])
