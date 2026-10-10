"""Particle Effect textures are untrusted input held to the shared limits.

Save, the catalog scan and package import all admit a Particle Effect through
the kind's companion-file validation, so the same limits apply to every path.
"""

from __future__ import annotations

import copy
import io
import json
import zlib
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from animama.adapters.content_store import FilesystemContentStore
from animama.app.contracts.effect_art_limits import PARTICLE_TEXTURE_LIMITS
from animama.app.services.content_package_capabilities import derive_file_capabilities
from animama.domain.content_catalog import ContentKind, ContentSource, ContentValidationError
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime
from tests.test_content_package_capabilities import FRONTEND, _document

VALID_MANIFEST: dict[str, Any] = json.loads(
    (FRONTEND / "avatar/particle-vfx/fixtures/compatibility-valid.json").read_text()
)


def _store(tmp_path: Path) -> FilesystemContentStore:
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    return FilesystemContentStore(
        included_root=paths.included_root,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )


def _png(width: int, height: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (width, height), (200, 40, 40, 255)).save(out, format="PNG")
    return out.getvalue()


def _manifest(texture_paths: list[str], *, tiles: int = 1) -> dict[str, Any]:
    manifest = copy.deepcopy(VALID_MANIFEST)
    manifest["images"] = [{"uuid": f"image-{index}", "url": path} for index, path in enumerate(texture_paths)]
    for emitter in manifest["object"]["children"]:
        emitter["ps"]["uTileCount"] = tiles
        emitter["ps"]["vTileCount"] = 1
    return manifest


def _save(
    store: FilesystemContentStore, textures: dict[str, bytes], *, tiles: int = 1, role: str | None = "texture"
) -> None:
    """Save through the store; `role=None` leaves the textures undeclared."""
    descriptor = {
        "schema_version": 1,
        "content_type": "particle_effect",
        "name": "Glyphs",
        "runtime_defaults": {},
        "files": [
            {"path": "particle.json", "role": "manifest"},
            *({"path": path, "role": role} for path in textures if role is not None),
        ],
    }
    store.save_descriptor_entry(
        kind=ContentKind.PARTICLE_EFFECT,
        relative_locator="vfx/particle/quark/glyphs",
        descriptor=json.dumps(descriptor).encode(),
        companion_files={
            "particle.json": json.dumps(_manifest(list(textures), tiles=tiles)).encode(),
            **textures,
        },
    )


def test_a_texture_within_the_limits_saves(tmp_path: Path) -> None:
    _save(_store(tmp_path), {"textures/glyph.png": _png(64, 32)})


def test_a_texture_wider_than_the_limit_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ContentValidationError, match="2048 px"):
        _save(_store(tmp_path), {"textures/wide.png": _png(PARTICLE_TEXTURE_LIMITS.max_dimension + 1, 4)})


def test_a_texture_file_over_the_byte_limit_is_refused(tmp_path: Path) -> None:
    padded = _png(8, 8) + b"\0" * PARTICLE_TEXTURE_LIMITS.max_bytes
    with pytest.raises(ContentValidationError, match="4 MiB"):
        _save(_store(tmp_path), {"textures/heavy.png": padded})


def test_more_textures_than_the_limit_are_refused(tmp_path: Path) -> None:
    textures = {f"textures/t{index}.png": _png(4, 4) for index in range(PARTICLE_TEXTURE_LIMITS.max_count + 1)}
    with pytest.raises(ContentValidationError, match="16 textures"):
        _save(_store(tmp_path), textures)


def test_a_texture_that_is_not_an_image_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ContentValidationError):
        _save(_store(tmp_path), {"textures/fake.png": b"\x89PNG\r\n\x1a\n not really"})


def test_a_sprite_sheet_grid_over_the_limit_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ContentValidationError, match="16 tiles"):
        _save(_store(tmp_path), {"textures/sheet.png": _png(64, 64)}, tiles=(PARTICLE_TEXTURE_LIMITS.max_grid or 0) + 1)


def test_package_validation_refuses_a_sprite_sheet_grid_over_the_limit() -> None:
    document = _document("particle_effect", files=[{"path": "particle.json", "role": "manifest"}])
    manifest = copy.deepcopy(VALID_MANIFEST)
    manifest["object"]["children"][0]["ps"]["uTileCount"] = 17
    with pytest.raises(Exception, match="16 tiles"):
        derive_file_capabilities(document.kind, document, "particle.json", io.BytesIO(json.dumps(manifest).encode()))


@pytest.mark.parametrize("role", ["image", None])
def test_an_oversized_texture_is_refused_whatever_its_declared_role(tmp_path: Path, role: str | None) -> None:
    with pytest.raises(ContentValidationError, match="2048 px"):
        _save(
            _store(tmp_path),
            {"textures/wide.png": _png(PARTICLE_TEXTURE_LIMITS.max_dimension + 1, 4)},
            role=role,
        )


def test_a_huge_declared_size_is_reported_as_the_size_limit(tmp_path: Path) -> None:
    header = io.BytesIO()
    Image.new("RGBA", (1, 1)).save(header, format="PNG")
    png = bytearray(header.getvalue())
    # Rewrite the IHDR size to 30000×30000 (and its CRC) without allocating it.
    png[16:24] = (30000).to_bytes(4, "big") * 2
    png[29:33] = zlib.crc32(bytes(png[12:29])).to_bytes(4, "big")
    with pytest.raises(ContentValidationError, match="2048 px"):
        _save(_store(tmp_path), {"textures/bomb.png": bytes(png)})


def test_the_local_scan_reports_an_oversized_texture(tmp_path: Path) -> None:
    store = _store(tmp_path)
    _save(store, {"textures/glyph.png": _png(16, 16)})
    entry = next(path for path in (tmp_path / "content").rglob("glyph.png"))
    entry.write_bytes(_png(PARTICLE_TEXTURE_LIMITS.max_dimension + 1, 4))
    scanned = [item for item in store.scan(ContentSource.LOCAL) if item.kind is ContentKind.PARTICLE_EFFECT]
    assert [diagnostic.code for item in scanned for diagnostic in item.diagnostics] == ["particle_texture_limit"]
