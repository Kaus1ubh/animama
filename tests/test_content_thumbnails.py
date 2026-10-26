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


def _png_header_only(width: int, height: int) -> bytes:
    """A tiny PNG that declares a huge canvas, as a decompression bomb does."""
    import struct
    import zlib

    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"")) + chunk(b"IEND", b"")


@pytest.mark.parametrize(
    ("side", "reason"),
    # 64 million pixels: under Pillow's bomb warning, over Animama's budget.
    [(8_000, "image_pixel_budget"), (12_000, "unsupported_image_format")],
)
def test_an_oversized_canvas_is_refused_from_its_header(side: int, reason: str) -> None:
    file = _verified(_png_header_only(side, side))
    with pytest.raises(ContentThumbnailError) as refused:
        thumbnail_file(file)
    # Refused from the declared size, before Pillow allocates the canvas.
    assert getattr(refused.value.__cause__, "reason", None) == reason
    assert file.handle.closed


def _jpeg(width: int, height: int, exif: bytes | None = None) -> bytes:
    output = BytesIO()
    image = Image.linear_gradient("L").resize((width, height)).convert("RGB")
    image.save(output, format="JPEG", quality=80, **({"exif": exif} if exif else {}))
    return output.getvalue()


def test_a_source_that_would_decode_beyond_the_budget_is_refused_but_a_large_jpeg_decodes_small(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from animama.app.services import content_thumbnails

    # A JPEG decodes at a reduced scale (2048 px at one eighth is 256 px); a PNG cannot.
    monkeypatch.setattr(content_thumbnails, "THUMBNAIL_MAX_DECODED_PIXELS", 300 * 300)
    png = _verified(_png(512, 512, (4, 5, 6, 255)))
    with pytest.raises(ContentThumbnailError) as refused:
        thumbnail_file(png)
    assert getattr(refused.value.__cause__, "reason", None) == "image_pixel_budget"
    assert png.handle.closed
    jpeg = thumbnail_file(_verified(_jpeg(2048, 2048), "image/jpeg"))
    with Image.open(jpeg.handle) as image:
        assert image.size == (THUMBNAIL_EDGE, THUMBNAIL_EDGE)


def test_exif_orientation_is_applied_after_shrinking() -> None:
    exif = Image.Exif()
    exif[0x0112] = 6  # Rotate 90 degrees clockwise to display.
    thumbnail = thumbnail_file(_verified(_jpeg(1024, 512, exif.tobytes()), "image/jpeg"))
    with Image.open(thumbnail.handle) as image:
        assert image.size == (THUMBNAIL_EDGE // 2, THUMBNAIL_EDGE)


def test_no_more_than_the_decode_slots_decode_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    import threading
    import time

    from animama.app.services import content_thumbnails
    from animama.app.services.content_image import derive_image_thumbnail as real

    active, peak, lock = 0, 0, threading.Lock()

    def counted(**kwargs):  # noqa: ANN003, ANN202
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.05)
        try:
            return real(**kwargs)
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr("animama.app.services.content_thumbnails.derive_image_thumbnail", counted)
    sources = [_png(300, 300, (index, 1, 2, 255)) for index in range(8)]
    threads = [threading.Thread(target=thumbnail_file, args=(_verified(source),)) for source in sources]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert peak == content_thumbnails.THUMBNAIL_DECODE_SLOTS


def test_small_sources_are_not_held_in_the_thumbnail_cache() -> None:
    from animama.app.services import content_thumbnails

    small = _png(32, 32, (9, 9, 9, 255))
    thumbnail_file(_verified(small))
    assert content_thumbnails._cache.get(hashlib.sha256(small).hexdigest()) is None


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
