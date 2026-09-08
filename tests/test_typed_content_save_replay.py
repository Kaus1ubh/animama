"""HTTP Save responses use the completed result rather than the mutable catalog."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

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
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers import content, typed_content


def _entry(kind: ContentKind, *, item_id: str) -> CatalogContentEntry:
    """Build an admitted standalone snapshot with an identifiable original file."""

    suffix, role, media_type = {
        ContentKind.GESTURE: ("vrma", "animation", "model/gltf-binary"),
        ContentKind.AVATAR: ("vrm", "model", "model/gltf-binary"),
        ContentKind.APPEARANCE: ("webp", "image", "image/webp"),
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


def _app(monkeypatch: pytest.MonkeyPatch, saved: CatalogContentEntry, live: _LiveTypedCatalog) -> FastAPI:
    """Exercise real HTTP parsing and response projection with no database I/O."""

    app = FastAPI()
    app.include_router(typed_content.router)

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id="replay-owner")

    async def session() -> AsyncIterator[None]:
        yield None

    app.dependency_overrides[get_current_principal] = principal
    app.dependency_overrides[get_async_session] = session
    save = _CompletedSave(saved)
    monkeypatch.setattr(content, "_save_service", lambda request, session: save)
    monkeypatch.setattr(typed_content, "_save_service", lambda request, session: save)
    monkeypatch.setattr(typed_content, "_typed_service", lambda request, session: live)
    return app


@pytest.mark.parametrize("later_change", ["edited", "deleted"])
@pytest.mark.parametrize("portrait", [False, True], ids=["gesture", "avatar-portrait"])
async def test_save_replay_returns_original_typed_snapshot_after_catalog_change(
    monkeypatch: pytest.MonkeyPatch, later_change: str, portrait: bool
) -> None:
    original = _entry(ContentKind.APPEARANCE if portrait else ContentKind.GESTURE, item_id="saved-item")
    avatar = _entry(ContentKind.AVATAR, item_id="avatar-item")
    live = _LiveTypedCatalog({original.id: original, avatar.id: avatar})
    app = _app(monkeypatch, original, live)
    route = "/v1/avatar-content/avatar-item/portrait" if portrait else "/v1/gestures/Original"
    current_route = f"/v1/appearance-content/{original.id}" if portrait else f"/v1/gestures/{original.id}"
    form = {"operation_id": "completed-save"}
    if portrait:
        form.update(entry_name="Original", expected_avatar_revision="a" * 64)
    upload_field = "file" if portrait else "files"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
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
