from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import FastAPI
from PIL import Image
from sqlalchemy import delete

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_thumbnails import THUMBNAIL_EDGE, ContentThumbnailError, thumbnail_file
from animama.domain.content_catalog import VerifiedContentFile
from animama.domain.request_principal import RequestPrincipal
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.product_http.routes.content import router
from animama.server.config import Settings
from animama.server.deps import get_current_principal
from animama.server.local_runtime import initialize_local_runtime
from tests.local_http_client import local_client
from tests.product_http_support import install_local_ports


def _png(width: int, height: int, color: tuple[int, int, int, int] = (200, 40, 90, 128)) -> bytes:
    output = BytesIO()
    Image.new("RGBA", (width, height), color).save(output, format="PNG")
    return output.getvalue()


def _verified(data: bytes, media_type: str = "image/png") -> VerifiedContentFile:
    return VerifiedContentFile(BytesIO(data), len(data), hashlib.sha256(data).hexdigest(), media_type)


def test_a_large_sheet_becomes_a_small_webp_that_keeps_its_shape_and_alpha() -> None:
    source = _png(1024, 256)
    thumbnail = thumbnail_file(_verified(source))
    data = thumbnail.handle.read()

    assert thumbnail.media_type == "image/webp"
    assert thumbnail.size_bytes == len(data) < len(source)
    assert thumbnail.sha256 == hashlib.sha256(data).hexdigest()
    with Image.open(BytesIO(data)) as image:
        assert image.size == (THUMBNAIL_EDGE, THUMBNAIL_EDGE // 4)
        assert image.mode == "RGBA"


def test_a_repeated_source_reuses_the_same_thumbnail_bytes() -> None:
    source = _png(400, 400, (1, 2, 3, 255))
    first = thumbnail_file(_verified(source))
    second = thumbnail_file(_verified(source))

    assert first.sha256 == second.sha256
    assert first.handle.read() == second.handle.read()


def test_small_rasters_and_vector_art_are_returned_unchanged() -> None:
    small = _png(THUMBNAIL_EDGE, 64)
    kept = thumbnail_file(_verified(small))
    assert kept.media_type == "image/png"
    assert kept.handle.read() == small

    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"/>'
    assert thumbnail_file(_verified(svg, "image/svg+xml")).handle.read() == svg


@pytest.mark.parametrize(
    ("data", "media_type"),
    [(b"RIFF....WAVEfmt ", "audio/wav"), (b"\x89PNG\r\n\x1a\nnot really", "image/png")],
)
def test_non_images_and_undecodable_images_are_refused(data: bytes, media_type: str) -> None:
    file = _verified(data, media_type)
    with pytest.raises(ContentThumbnailError):
        thumbnail_file(file)
    assert file.handle.closed


async def test_library_thumbnails_and_catalog_polls_are_cheap_over_http(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    art = _png(900, 600)
    (paths.local_root / "appearances").mkdir(parents=True, exist_ok=True)
    (paths.local_root / "appearances/backdrop.png").write_bytes(art)
    service = ContentCatalogService(
        store=FilesystemContentStore(
            included_root=paths.included_root,
            local_root=paths.local_root,
            operations_root=paths.operations_root,
        ),
        catalog=SQLAlchemyContentCatalog(async_session),
    )
    result = await service.rescan(user_id="owner-a", include_included=False)
    item = next(entry for entry in result.items if entry.relative_locator == "appearances/backdrop.png")
    file_ref = item.files[0].file_ref

    app = FastAPI()
    app.include_router(router)
    app.state.local_runtime_paths = paths

    async def override_user() -> RequestPrincipal:
        return RequestPrincipal(id="owner-a")

    app.dependency_overrides[get_current_principal] = override_user
    install_local_ports(app, async_session)
    client = local_client(app)
    try:
        original = await client.get(f"/v1/content/files/{file_ref}")
        assert original.content == art

        thumbnail = await client.get(f"/v1/content/files/{file_ref}", params={"variant": "thumbnail"})
        assert thumbnail.status_code == 200
        assert thumbnail.headers["content-type"] == "image/webp"
        assert thumbnail.headers["cache-control"] == "private, no-cache"
        assert len(thumbnail.content) < len(art)
        with Image.open(BytesIO(thumbnail.content)) as image:
            assert image.size == (THUMBNAIL_EDGE, 85)
        revalidated = await client.get(
            f"/v1/content/files/{file_ref}",
            params={"variant": "thumbnail"},
            headers={"If-None-Match": thumbnail.headers["etag"]},
        )
        assert revalidated.status_code == 304

        unknown = await client.get(f"/v1/content/files/{file_ref}", params={"variant": "poster"})
        assert unknown.status_code == 422

        catalog = await client.get("/v1/content/catalog", headers={"Accept-Encoding": "gzip"})
        assert catalog.status_code == 200
        assert catalog.headers["content-encoding"] == "gzip"
        assert catalog.headers["cache-control"] == "private, no-cache"
        assert any(entry["item_id"] == item.id for entry in catalog.json()["items"])
        unchanged = await client.get(
            "/v1/content/catalog",
            headers={"Accept-Encoding": "gzip", "If-None-Match": catalog.headers["etag"]},
        )
        assert unchanged.status_code == 304
        assert unchanged.content == b""
    finally:
        await client.aclose()
        await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id == item.id))
        await async_session.commit()
