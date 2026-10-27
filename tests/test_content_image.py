from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image, ImageDraw, ImageSequence

from animama.app.services.content_file_validation import ContentFileInvalidError as ContentFileInvalidError
from animama.app.services.content_image import (
    CANONICAL_IMAGE_MAX_DIMENSION,
    canonicalize_avatar_portrait,
    canonicalize_image_stream,
)


def _encoded(
    image: Image.Image,
    format_name: str,
    **options: object,
) -> bytes:
    output = BytesIO()
    image.save(output, format=format_name, **options)
    return output.getvalue()


def _pixel(image: Image.Image, xy: tuple[int, int]) -> tuple[int, ...]:
    """Return a multi-band pixel; Pillow types getpixel() for every image mode."""
    pixel = image.getpixel(xy)
    assert isinstance(pixel, tuple)
    return pixel


@pytest.mark.parametrize(
    ("format_name", "extension", "mode"),
    [
        ("JPEG", "jpg", "RGB"),
        ("JPEG", "jpeg", "CMYK"),
        ("PNG", "png", "P"),
        ("WEBP", "webp", "RGBA"),
    ],
)
def test_static_sources_become_stripped_bounded_webp(
    format_name: str,
    extension: str,
    mode: str,
) -> None:
    if mode == "P":
        source = Image.new("P", (12, 8))
        source.putpalette([255, 0, 0, 0, 0, 0] + [0] * 762)
        source.info["transparency"] = 1
        source.putpixel((11, 7), 1)
    elif mode == "CMYK":
        source = Image.new(mode, (12, 8), (0, 255, 255, 0))
    else:
        source = Image.new(mode, (12, 8), (255, 0, 0, 128) if mode == "RGBA" else (255, 0, 0))
    content = _encoded(source, format_name, comment=b"private metadata")

    result = canonicalize_image_stream(
        extension=extension,
        content=BytesIO(content),
    )

    assert result.width == 12
    assert result.height == 8
    assert result.source_frame_count == 1
    assert result.has_alpha is (mode in {"P", "RGBA"})
    with Image.open(BytesIO(result.content)) as canonical:
        assert canonical.format == "WEBP"
        assert canonical.size == (12, 8)
        assert not canonical.getexif()
        assert "icc_profile" not in canonical.info
        assert "comment" not in canonical.info
        red, green, blue, alpha = _pixel(canonical.convert("RGBA"), (0, 0))
        assert abs(red - 255) <= 12
        assert green <= 12
        assert blue <= 12
        expected_alpha = 128 if mode == "RGBA" else 255
        assert abs(alpha - expected_alpha) <= 3
        if mode == "P":
            assert _pixel(canonical.convert("RGBA"), (11, 7))[3] <= 3


def test_large_image_resizes_without_upscaling() -> None:
    source = Image.new("RGB", (5000, 2500), (30, 60, 90))
    result = canonicalize_image_stream(
        extension="png",
        content=BytesIO(_encoded(source, "PNG")),
    )

    assert result.width == CANONICAL_IMAGE_MAX_DIMENSION
    assert result.height == 2048
    assert result.warnings == ("image_resized_to_runtime_limit",)


def test_exif_orientation_is_applied_before_metadata_is_removed() -> None:
    source = Image.new("RGB", (10, 20), "red")
    exif = source.getexif()
    exif[274] = 6

    result = canonicalize_image_stream(
        extension="jpg",
        content=BytesIO(_encoded(source, "JPEG", exif=exif)),
    )

    assert (result.source_width, result.source_height) == (10, 20)
    assert (result.width, result.height) == (20, 10)
    with Image.open(BytesIO(result.content)) as canonical:
        assert not canonical.getexif()


def test_mpo_selects_primary_picture_and_warns() -> None:
    primary = Image.new("RGB", (8, 6), "red")
    secondary = Image.new("RGB", (8, 6), "blue")
    source = _encoded(
        primary,
        "MPO",
        save_all=True,
        append_images=[secondary],
    )

    result = canonicalize_image_stream(
        extension="jpg",
        content=BytesIO(source),
    )

    assert result.source_container == "mpo"
    assert result.source_frame_count == 2
    assert result.warnings == ("multi_picture_primary_frame_selected",)
    with Image.open(BytesIO(result.content)) as canonical:
        red, green, blue = _pixel(canonical.convert("RGB"), (0, 0))
        assert red > 200
        assert green < 50
        assert blue < 50


@pytest.mark.parametrize("format_name,extension", [("PNG", "png"), ("WEBP", "webp")])
def test_animated_png_and_webp_are_rejected(
    format_name: str,
    extension: str,
) -> None:
    frames = [Image.new("RGBA", (4, 4), color) for color in ("red", "blue")]
    source = _encoded(
        frames[0],
        format_name,
        save_all=True,
        append_images=frames[1:],
        duration=100,
        loop=0,
    )
    assert len(list(ImageSequence.Iterator(Image.open(BytesIO(source))))) == 2

    with pytest.raises(ContentFileInvalidError) as caught:
        canonicalize_image_stream(
            extension=extension,
            content=BytesIO(source),
        )

    assert caught.value.reason == "animated_image_unsupported"


def test_renamed_decoder_format_is_rejected() -> None:
    source = _encoded(Image.new("RGB", (4, 4), "red"), "GIF")

    with pytest.raises(ContentFileInvalidError) as caught:
        canonicalize_image_stream(
            extension="png",
            content=BytesIO(source),
        )

    assert caught.value.reason == "unsupported_image_format"


def test_avatar_portrait_preserves_transparency_and_is_metadata_free() -> None:
    source = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    ImageDraw.Draw(source).rectangle((300, 180, 723, 859), fill=(80, 120, 210, 220))
    exif = source.getexif()
    exif[270] = "private"
    content = _encoded(source, "WEBP", lossless=True, exif=exif)

    result = canonicalize_avatar_portrait(content=BytesIO(content))

    assert (result.source_width, result.source_height) == (1024, 1024)
    assert (result.width, result.height) == (512, 512)
    assert len(result.content) <= 256 * 1024
    with Image.open(BytesIO(result.content)) as canonical:
        assert canonical.format == "WEBP"
        assert canonical.mode == "RGBA"
        assert canonical.size == (512, 512)
        assert not canonical.getexif()
        assert _pixel(canonical, (0, 0))[3] <= 3
        assert abs(_pixel(canonical, (512 // 2, 512 // 2))[3] - 220) <= 8


@pytest.mark.parametrize(
    ("source", "reason"),
    [
        (Image.new("RGBA", (1024, 1024), (0, 0, 0, 0)), "avatar_portrait_transparent"),
        (Image.new("RGB", (1024, 1024), "white"), "avatar_portrait_blank"),
        (
            Image.effect_noise((1024, 1024), 100).convert("RGB"),
            "avatar_portrait_background_opaque",
        ),
        # The renderer-version-1 capture size is no longer admitted.
        (Image.new("RGB", (512, 512), "red"), "avatar_portrait_dimensions"),
    ],
)
def test_avatar_portrait_rejects_unusable_sources(source: Image.Image, reason: str) -> None:
    with pytest.raises(ContentFileInvalidError) as caught:
        canonicalize_avatar_portrait(
            content=BytesIO(_encoded(source, "WEBP", lossless=True)),
        )

    assert caught.value.reason == reason
