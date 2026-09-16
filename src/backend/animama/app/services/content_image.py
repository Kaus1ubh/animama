"""Bounded image-content validation, canonicalization, and thumbnail derivation."""

from __future__ import annotations

import hashlib
import warnings
from dataclasses import dataclass
from io import BytesIO
from typing import BinaryIO, cast

from PIL import Image, ImageOps, ImageStat, UnidentifiedImageError

from .content_file_validation import ContentFileInvalidError, ContentFileValidation

MAX_IMAGE_PIXELS = 40_000_000
MAX_APPEARANCE_SOURCE_BYTES = 16 * 1024 * 1024
MAX_APPEARANCE_DIMENSION = 8192
MAX_IMAGE_DIMENSION = 16_384
CANONICAL_IMAGE_MAX_DIMENSION = 4096
# The canonicalizer serves several product families. Family-specific ready
# policies apply their lower budgets (for example Avatar Effects at 16 MiB).
CANONICAL_IMAGE_MAX_BYTES = 32 * 1024 * 1024
THUMBNAIL_MAX_DIMENSION = 256
THUMBNAIL_MAX_BYTES = 256 * 1024
AVATAR_PORTRAIT_SOURCE_DIMENSION = 512
AVATAR_PORTRAIT_DIMENSION = 256
AVATAR_PORTRAIT_MAX_BYTES = 256 * 1024
_FORMATS_BY_EXTENSION = {
    "png": frozenset({"PNG"}),
    "jpg": frozenset({"JPEG", "MPO"}),
    "jpeg": frozenset({"JPEG", "MPO"}),
    "webp": frozenset({"WEBP"}),
}
_CONTENT_TYPE_BY_FORMAT = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "MPO": "image/jpeg",
    "WEBP": "image/webp",
}
_SOURCE_CONTAINER_BY_FORMAT = {
    "PNG": "png",
    "JPEG": "jpeg",
    "MPO": "mpo",
    "WEBP": "webp",
}


@dataclass(frozen=True, slots=True)
class CanonicalImage:
    """Metadata and stripped static WebP bytes for one accepted source image."""

    content: bytes
    width: int
    height: int
    source_width: int
    source_height: int
    source_container: str
    source_frame_count: int
    has_alpha: bool
    warnings: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DerivedImageThumbnail:
    """Metadata and stripped WebP bytes for one system-owned derivative."""

    content: bytes
    width: int
    height: int
    source_width: int
    source_height: int
    sha256: str


@dataclass(frozen=True, slots=True)
class CanonicalAvatarPortrait:
    """Opaque bounded WebP derived from a browser-generated model portrait."""

    content: bytes
    width: int
    height: int
    source_width: int
    source_height: int
    sha256: str


class _BorrowedImageStream:
    """Expose a seekable stream to Pillow without transferring close ownership."""

    def __init__(self, stream: BinaryIO) -> None:
        self._stream = stream

    def read(self, size: int = -1) -> bytes:
        return self._stream.read(size)

    def readline(self, size: int = -1) -> bytes:
        return self._stream.readline(size)

    def seek(self, offset: int, whence: int = 0) -> int:
        return self._stream.seek(offset, whence)

    def tell(self) -> int:
        return self._stream.tell()

    def close(self) -> None:
        """Let Pillow close its view while preserving the caller-owned stream."""


def validate_appearance_image_stream(
    *,
    extension: str,
    content: BinaryIO,
    size_bytes: int,
    declared_content_type: str | None = None,
) -> ContentFileValidation:
    """Decode a bounded still Appearance image; never trust a MIME declaration."""

    if not 0 < size_bytes <= MAX_APPEARANCE_SOURCE_BYTES:
        raise ContentFileInvalidError(field="file", reason="appearance_image_size_limit")
    image, source_format, width, height, frames = _open_bounded_image(extension=extension, content=content)
    try:
        if frames != 1 or source_format == "MPO":
            raise ContentFileInvalidError(field="file", reason="animated_image_unsupported")
        if max(width, height) > MAX_APPEARANCE_DIMENSION:
            raise ContentFileInvalidError(field="file", reason="image_pixel_budget")
        detected = _CONTENT_TYPE_BY_FORMAT[source_format]
        if declared_content_type is not None and declared_content_type.split(";", 1)[0].strip().lower() != detected:
            raise ContentFileInvalidError(field="file", reason="image_media_type_mismatch")
        image.load()
    except ContentFileInvalidError:
        raise
    except (EOFError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ContentFileInvalidError(field="file", reason="invalid_image") from exc
    finally:
        image.close()
    return ContentFileValidation(detected, {"width": width, "height": height, "frame_count": frames})


def validate_image_stream(
    *,
    extension: str,
    content: BinaryIO,
) -> ContentFileValidation:
    """Decode one supported still source and return bounded detected metadata."""

    image, source_format, source_width, source_height, frame_count = _open_bounded_image(
        extension=extension,
        content=content,
    )
    try:
        _require_supported_frame_policy(source_format, frame_count)
        image.seek(0)
        image.load()
    except ContentFileInvalidError:
        raise
    except (EOFError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ContentFileInvalidError(field="file", reason="invalid_image") from exc
    finally:
        image.close()
    return ContentFileValidation(
        _CONTENT_TYPE_BY_FORMAT[source_format],
        {
            "width": source_width,
            "height": source_height,
            "format": _SOURCE_CONTAINER_BY_FORMAT[source_format],
            "frame_count": frame_count,
        },
    )


def canonicalize_image_stream(
    *,
    extension: str,
    content: BinaryIO,
) -> CanonicalImage:
    """Decode an allowed static source and produce one bounded metadata-free WebP."""

    image, source_format, source_width, source_height, frame_count = _open_bounded_image(
        extension=extension,
        content=content,
    )
    stripped: Image.Image | None = None
    oriented: Image.Image | None = None
    try:
        _require_supported_frame_policy(source_format, frame_count)
        image.seek(0)
        image.load()
        has_alpha = "A" in image.getbands() or "transparency" in image.info
        oriented = ImageOps.exif_transpose(image)
        oriented_size = oriented.size
        oriented.thumbnail(
            (CANONICAL_IMAGE_MAX_DIMENSION, CANONICAL_IMAGE_MAX_DIMENSION),
            Image.Resampling.LANCZOS,
        )
        mode = "RGBA" if has_alpha else "RGB"
        stripped = Image.new(mode, oriented.size)
        stripped.paste(oriented.convert(mode))
        encoded = _encode_bounded_webp(
            stripped,
            maximum_bytes=CANONICAL_IMAGE_MAX_BYTES,
        )
        width, height = stripped.size
    except ContentFileInvalidError:
        raise
    except (EOFError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ContentFileInvalidError(field="file", reason="invalid_image") from exc
    finally:
        if stripped is not None:
            stripped.close()
        if oriented is not None:
            oriented.close()
        image.close()

    result_warnings: list[str] = []
    if source_format == "MPO" and frame_count > 1:
        result_warnings.append("multi_picture_primary_frame_selected")
    if (width, height) != oriented_size:
        result_warnings.append("image_resized_to_runtime_limit")
    return CanonicalImage(
        content=encoded,
        width=width,
        height=height,
        source_width=source_width,
        source_height=source_height,
        source_container=_SOURCE_CONTAINER_BY_FORMAT[source_format],
        source_frame_count=frame_count,
        has_alpha=has_alpha,
        warnings=tuple(result_warnings),
    )


def derive_image_thumbnail(
    *,
    extension: str,
    content: BinaryIO,
) -> DerivedImageThumbnail:
    """Resize a canonical static image without upscaling and encode it as WebP."""

    image, source_format, source_width, source_height, frame_count = _open_bounded_image(
        extension=extension,
        content=content,
    )
    stripped: Image.Image | None = None
    try:
        _require_supported_frame_policy(source_format, frame_count)
        image.seek(0)
        image.load()
        oriented = ImageOps.exif_transpose(image)
        oriented.thumbnail(
            (THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION),
            Image.Resampling.LANCZOS,
        )
        has_alpha = "A" in oriented.getbands() or "transparency" in oriented.info
        mode = "RGBA" if has_alpha else "RGB"
        stripped = Image.new(mode, oriented.size)
        stripped.paste(oriented.convert(mode))
        encoded = _encode_bounded_webp(
            stripped,
            maximum_bytes=THUMBNAIL_MAX_BYTES,
        )
        width, height = stripped.size
        oriented.close()
    except ContentFileInvalidError:
        raise
    except (EOFError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ContentFileInvalidError(field="file", reason="invalid_image") from exc
    finally:
        if stripped is not None:
            stripped.close()
        image.close()
    return DerivedImageThumbnail(
        content=encoded,
        width=width,
        height=height,
        source_width=source_width,
        source_height=source_height,
        sha256=hashlib.sha256(encoded).hexdigest(),
    )


def canonicalize_avatar_portrait(*, content: BinaryIO) -> CanonicalAvatarPortrait:
    """Validate one 512-square static WebP and normalize it for navigation UI."""

    image, source_format, source_width, source_height, frame_count = _open_bounded_image(
        extension="webp",
        content=content,
    )
    oriented: Image.Image | None = None
    rgba: Image.Image | None = None
    resized: Image.Image | None = None
    try:
        _require_supported_frame_policy(source_format, frame_count)
        if (source_width, source_height) != (
            AVATAR_PORTRAIT_SOURCE_DIMENSION,
            AVATAR_PORTRAIT_SOURCE_DIMENSION,
        ):
            raise ContentFileInvalidError(field="file", reason="avatar_portrait_dimensions")
        image.seek(0)
        image.load()
        oriented = ImageOps.exif_transpose(image)
        rgba = oriented.convert("RGBA")
        alpha_histogram = rgba.getchannel("A").histogram()
        visible_pixels = sum(alpha_histogram[16:])
        if visible_pixels < max(64, source_width * source_height // 100):
            raise ContentFileInvalidError(field="file", reason="avatar_portrait_transparent")

        if max(ImageStat.Stat(rgba).var) < 4:
            raise ContentFileInvalidError(field="file", reason="avatar_portrait_blank")
        transparent_pixels = sum(alpha_histogram[:240])
        if transparent_pixels < max(64, source_width * source_height // 100):
            raise ContentFileInvalidError(
                field="file",
                reason="avatar_portrait_background_opaque",
            )

        resized = rgba.resize(
            (AVATAR_PORTRAIT_DIMENSION, AVATAR_PORTRAIT_DIMENSION),
            Image.Resampling.LANCZOS,
        )
        encoded = _encode_bounded_webp(
            resized,
            maximum_bytes=AVATAR_PORTRAIT_MAX_BYTES,
        )
    except ContentFileInvalidError:
        raise
    except (EOFError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ContentFileInvalidError(field="file", reason="invalid_image") from exc
    finally:
        if resized is not None:
            resized.close()
        if rgba is not None:
            rgba.close()
        if oriented is not None:
            oriented.close()
        image.close()

    return CanonicalAvatarPortrait(
        content=encoded,
        width=AVATAR_PORTRAIT_DIMENSION,
        height=AVATAR_PORTRAIT_DIMENSION,
        source_width=source_width,
        source_height=source_height,
        sha256=hashlib.sha256(encoded).hexdigest(),
    )


def _open_bounded_image(
    *,
    extension: str,
    content: BinaryIO,
) -> tuple[Image.Image, str, int, int, int]:
    normalized_extension = extension.lower().lstrip(".")
    allowed_formats = _FORMATS_BY_EXTENSION.get(normalized_extension)
    if allowed_formats is None:
        raise ContentFileInvalidError(field="file", reason="unsupported_image_format")
    content.seek(0)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            # Pillow reads the seek/read/tell interface; it never owns this stream.
            image = Image.open(cast(BinaryIO, _BorrowedImageStream(content)))
            source_format = image.format or ""
            width, height = image.size
            frame_count = int(getattr(image, "n_frames", 1))
    except (
        UnidentifiedImageError,
        EOFError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as exc:
        raise ContentFileInvalidError(field="file", reason="unsupported_image_format") from exc
    if source_format not in allowed_formats:
        image.close()
        raise ContentFileInvalidError(field="file", reason="unsupported_image_format")
    if (
        width < 1
        or height < 1
        or width > MAX_IMAGE_DIMENSION
        or height > MAX_IMAGE_DIMENSION
        or width * height > MAX_IMAGE_PIXELS
    ):
        image.close()
        raise ContentFileInvalidError(field="file", reason="image_pixel_budget")
    if frame_count < 1:
        image.close()
        raise ContentFileInvalidError(field="file", reason="invalid_image")
    return image, source_format, width, height, frame_count


def _require_supported_frame_policy(source_format: str, frame_count: int) -> None:
    if source_format in {"PNG", "WEBP"} and frame_count != 1:
        raise ContentFileInvalidError(field="file", reason="animated_image_unsupported")


def _encode_bounded_webp(
    image: Image.Image,
    *,
    maximum_bytes: int,
) -> bytes:
    """Use one explicit encoder ladder so the pinned Pillow build is repeatable."""

    for quality in (90, 82, 74, 66, 58, 50, 42, 34):
        output = BytesIO()
        image.save(
            output,
            format="WEBP",
            quality=quality,
            alpha_quality=100,
            method=6,
            exact=True,
            lossless=False,
            exif=b"",
            icc_profile=None,
            xmp=b"",
        )
        encoded = output.getvalue()
        if 0 < len(encoded) <= maximum_bytes:
            return encoded
    raise ContentFileInvalidError(field="file", reason="canonical_image_size_limit")


__all__ = [
    "AVATAR_PORTRAIT_DIMENSION",
    "AVATAR_PORTRAIT_MAX_BYTES",
    "AVATAR_PORTRAIT_SOURCE_DIMENSION",
    "CANONICAL_IMAGE_MAX_BYTES",
    "CANONICAL_IMAGE_MAX_DIMENSION",
    "CanonicalAvatarPortrait",
    "CanonicalImage",
    "DerivedImageThumbnail",
    "MAX_IMAGE_DIMENSION",
    "MAX_IMAGE_PIXELS",
    "THUMBNAIL_MAX_BYTES",
    "THUMBNAIL_MAX_DIMENSION",
    "canonicalize_avatar_portrait",
    "canonicalize_image_stream",
    "derive_image_thumbnail",
    "validate_image_stream",
]
