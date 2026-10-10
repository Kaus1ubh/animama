"""Admission limits for Particle Effect textures and Scene Effect images.

Textures and Scene art arrive from creator Saves, Local folders and Portable
packages, and the browser decodes them (and uploads textures to the GPU), so
every path checks them against the shared limits
(``app/contracts/effect_art_limits.py``). Only image headers are read here;
nothing is decoded in full.
"""

from __future__ import annotations

import json
import warnings
from collections.abc import Mapping
from pathlib import Path, PurePosixPath
from typing import Any

from PIL import Image, UnidentifiedImageError

from animama.app.contracts.effect_art_limits import PARTICLE_TEXTURE_LIMITS, SCENE_IMAGE_LIMITS, EffectArtLimits
from animama.domain.content_catalog import ContentDiagnostic
from animama.domain.content_documents import ParticleEffectDocumentV1, SceneEffectDocumentV1

PARTICLE_TEXTURE_LIMIT = "particle_texture_limit"
SCENE_IMAGE_LIMIT = "scene_image_limit"
_IMAGE_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})
_MIB = 1024 * 1024


_TEXT_SUFFIXES = frozenset({".json", ".txt", ".md"})


def emitter_grid_issue(ps: dict[str, Any]) -> str | None:
    """Why one particle system's sprite-sheet grid exceeds the limit, if it does."""

    limit = PARTICLE_TEXTURE_LIMITS.max_grid or 1
    for key in ("uTileCount", "vTileCount"):
        value = ps.get(key, 1)
        if type(value) is not int or not 1 <= value <= limit:
            return f"Sprite sheets have 1 to {limit} tiles in each direction"
    return None


def particle_grid_issue(manifest: Any) -> str | None:
    """Why any emitter of a Quarks manifest exceeds the sprite-sheet grid limit."""

    if not isinstance(manifest, dict):
        return None
    pending = [manifest.get("object")]
    while pending:
        node = pending.pop()
        if not isinstance(node, dict):
            continue
        children = node.get("children")
        if isinstance(children, list):
            pending.extend(children)
        ps = node.get("ps")
        issue = emitter_grid_issue(ps) if isinstance(ps, dict) else None
        if issue:
            return issue
    return None


def _image_issue(path: Path, limits: EffectArtLimits, *, noun: str = "Textures") -> str | None:
    size = path.stat().st_size
    if size > limits.max_bytes:
        return f"{noun} must be at most {limits.max_bytes // _MIB} MiB"
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                image_format = image.format
                width, height = image.size
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        # Pillow refuses huge declared sizes before reading them.
        return f"{noun} must be at most {limits.max_dimension} px on each side"
    except (UnidentifiedImageError, OSError, ValueError):
        return f"{noun} must be PNG, JPEG or WebP images"
    if image_format not in _IMAGE_FORMATS:
        return f"{noun} must be PNG, JPEG or WebP images"
    if max(width, height) > limits.max_dimension or width * height > limits.max_pixels:
        return f"{noun} must be at most {limits.max_dimension} px on each side"
    return None


def _texture_paths(files: Mapping[str, Path]) -> list[str]:
    """Every companion a renderer could load as a texture, whatever its declared role.

    A Quarks image may name any registered file, and the scanner treats
    undeclared companions as textures, so only JSON and text notes are exempt.
    """

    return [relative for relative in files if PurePosixPath(relative).suffix.lower() not in _TEXT_SUFFIXES]


def _manifest_paths(document: ParticleEffectDocumentV1, files: Mapping[str, Path]) -> list[str]:
    if document.files:
        return [file.path for file in document.files if file.role == "manifest" and file.path in files]
    return [relative for relative in files if PurePosixPath(relative).suffix.lower() == ".json"]


def validate_scene_image_files(
    document: SceneEffectDocumentV1, files: Mapping[str, Path]
) -> tuple[ContentDiagnostic, ...]:
    """Check a Scene Effect's images against the limits.

    Every companion except JSON and text notes counts. SVG art is checked for
    bytes here and for content by the SVG validator; raster art also for its
    format and size.
    """

    limits = SCENE_IMAGE_LIMITS
    diagnostics: list[ContentDiagnostic] = []
    images = _texture_paths(files)
    if len(images) > limits.max_count:
        diagnostics.append(
            ContentDiagnostic(SCENE_IMAGE_LIMIT, f"A Scene Effect can carry at most {limits.max_count} images")
        )
    total = 0
    for relative in images:
        path = files[relative]
        size = path.stat().st_size
        total += size
        if PurePosixPath(relative).suffix.lower() == ".svg":
            issue = f"Scene images must be at most {limits.max_bytes // _MIB} MiB" if size > limits.max_bytes else None
        else:
            issue = _image_issue(path, limits, noun="Scene images")
        if issue:
            diagnostics.append(ContentDiagnostic(SCENE_IMAGE_LIMIT, issue, relative))
    if total > limits.max_total_bytes:
        diagnostics.append(
            ContentDiagnostic(
                SCENE_IMAGE_LIMIT,
                f"Images in one Scene Effect must total at most {limits.max_total_bytes // _MIB} MiB",
            )
        )
    return tuple(diagnostics)


def validate_particle_texture_files(
    document: ParticleEffectDocumentV1, files: Mapping[str, Path]
) -> tuple[ContentDiagnostic, ...]:
    """Check a Particle Effect's textures and sprite-sheet grid against the limits."""

    limits = PARTICLE_TEXTURE_LIMITS
    diagnostics: list[ContentDiagnostic] = []
    textures = _texture_paths(files)
    if len(textures) > limits.max_count:
        diagnostics.append(
            ContentDiagnostic(
                PARTICLE_TEXTURE_LIMIT, f"A Particle Effect can carry at most {limits.max_count} textures"
            )
        )
    total = 0
    for relative in textures:
        path = files[relative]
        total += path.stat().st_size
        issue = _image_issue(path, limits)
        if issue:
            diagnostics.append(ContentDiagnostic(PARTICLE_TEXTURE_LIMIT, issue, relative))
    if total > limits.max_total_bytes:
        diagnostics.append(
            ContentDiagnostic(
                PARTICLE_TEXTURE_LIMIT,
                f"Textures in one Particle Effect must total at most {limits.max_total_bytes // _MIB} MiB",
            )
        )
    for relative in _manifest_paths(document, files):
        try:
            manifest = json.loads(files[relative].read_bytes())
        except (OSError, ValueError):
            continue  # The manifest's own checks report unreadable JSON.
        grid_issue = particle_grid_issue(manifest)
        if grid_issue:
            diagnostics.append(ContentDiagnostic(PARTICLE_TEXTURE_LIMIT, grid_issue, relative))
    return tuple(diagnostics)
