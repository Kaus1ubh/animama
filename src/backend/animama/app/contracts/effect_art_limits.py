"""Hard limits for Particle Effect textures and Scene Effect images.

Textures and Scene art are untrusted input from creator uploads, Local content
and Portable packages. The backend checks these limits at Save and package
import; the frontend checks the same values before decoding, and the runtime
loaders check them again. ``src/frontend/web/src/lib/content/fixtures/
effect-art-limits.json`` records the values for the parity tests.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EffectArtLimits:
    """Limits for one kind of effect image."""

    max_bytes: int
    """Bytes of one image file."""
    max_dimension: int
    """Longest side, in pixels."""
    max_pixels: int
    """Decoded pixels of one image."""
    max_count: int
    """Images per effect."""
    max_total_bytes: int
    """Bytes of all images in one effect."""
    max_grid: int | None = None
    """Sprite-sheet tiles per axis, for kinds that use sheets."""


PARTICLE_TEXTURE_LIMITS = EffectArtLimits(
    max_bytes=4 * 1024 * 1024,
    max_dimension=2048,
    max_pixels=2048 * 2048,
    max_count=16,
    max_total_bytes=32 * 1024 * 1024,
    max_grid=16,
)

SCENE_IMAGE_LIMITS = EffectArtLimits(
    max_bytes=8 * 1024 * 1024,
    max_dimension=4096,
    max_pixels=4096 * 4096,
    max_count=16,
    max_total_bytes=32 * 1024 * 1024,
)
