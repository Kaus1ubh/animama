"""Library-sized previews of registered content images.

Effect art is often a large flipbook sheet or texture, while the Library shows it
in a 40-pixel tile. ``thumbnail_file`` re-encodes a raster image as WebP no larger
than ``THUMBNAIL_EDGE`` on either side, so a Library page downloads kilobytes per
card instead of the full art. Thumbnails are cached in process by the source's
SHA-256, so the cache is content-addressed and is consulted only after the caller
has authorized and verified the source file.
"""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from io import BytesIO

from PIL import Image

from animama.domain.content_catalog import VerifiedContentFile

# Twice the largest tile the Library draws, for high-density displays.
THUMBNAIL_EDGE = 128
THUMBNAIL_MEDIA_TYPE = "image/webp"
_WEBP_QUALITY = 80
_RASTER_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
# Vector art is already small and scales without loss.
_PASSTHROUGH_TYPES = frozenset({"image/svg+xml"})
# Roughly 1,500 thumbnails; an entry of ``None`` records a source already small enough.
_CACHE_MAX_BYTES = 8 * 1024 * 1024


class ContentThumbnailError(ValueError):
    """The registered file is not an image Animama can preview at thumbnail size."""


class _ThumbnailCache:
    """Least-recently-used thumbnails bounded by their total encoded size."""

    def __init__(self, max_bytes: int) -> None:
        self._max_bytes = max_bytes
        self._entries: OrderedDict[str, bytes | None] = OrderedDict()
        self._size = 0
        self._lock = threading.Lock()

    def get(self, sha256: str) -> tuple[bool, bytes | None]:
        with self._lock:
            if sha256 not in self._entries:
                return False, None
            self._entries.move_to_end(sha256)
            return True, self._entries[sha256]

    def put(self, sha256: str, data: bytes | None) -> None:
        with self._lock:
            if sha256 in self._entries:
                return
            self._entries[sha256] = data
            self._size += len(data or b"")
            while self._size > self._max_bytes:
                _, evicted = self._entries.popitem(last=False)
                self._size -= len(evicted or b"")


_cache = _ThumbnailCache(_CACHE_MAX_BYTES)


def _encode(file: VerifiedContentFile) -> bytes | None:
    """Return WebP thumbnail bytes, or ``None`` when the source already fits."""

    try:
        with Image.open(file.handle) as image:
            if image.width <= THUMBNAIL_EDGE and image.height <= THUMBNAIL_EDGE:
                return None
            # Animated sources contribute their first frame, which ``open`` selects.
            has_alpha = image.mode in {"RGBA", "LA", "PA"} or "transparency" in image.info
            frame = image.convert("RGBA" if has_alpha else "RGB")
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ContentThumbnailError("registered image could not be decoded") from exc
    frame.thumbnail((THUMBNAIL_EDGE, THUMBNAIL_EDGE), Image.Resampling.LANCZOS)
    output = BytesIO()
    frame.save(output, format="WEBP", quality=_WEBP_QUALITY, method=4)
    return output.getvalue()


def thumbnail_file(file: VerifiedContentFile) -> VerifiedContentFile:
    """Return ``file`` as a Library-sized image, taking ownership of its handle.

    Vector images and rasters already within ``THUMBNAIL_EDGE`` come back unchanged;
    larger rasters come back as an in-memory WebP whose digest is its ETag. Blocks on
    image decoding, so callers run it in a worker thread.
    """

    if file.media_type in _PASSTHROUGH_TYPES:
        return file
    if file.media_type not in _RASTER_TYPES:
        file.handle.close()
        raise ContentThumbnailError(f"{file.media_type} has no thumbnail")
    found, data = _cache.get(file.sha256)
    if not found:
        try:
            data = _encode(file)
        except ContentThumbnailError:
            file.handle.close()
            raise
        _cache.put(file.sha256, data)
    if data is None:
        file.handle.seek(0)
        return file
    file.handle.close()
    return VerifiedContentFile(
        handle=BytesIO(data),
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        media_type=THUMBNAIL_MEDIA_TYPE,
    )


__all__ = ["THUMBNAIL_EDGE", "ContentThumbnailError", "thumbnail_file"]
