"""Scene SVG admission through the same file store used by creator saves."""

import json
from pathlib import Path

import pytest

from animama.adapters.content_store import FilesystemContentStore
from animama.domain.content_catalog import ContentKind, ContentSource, ContentStatus, ContentValidationError

SOURCE = Path(__file__).parents[1] / "content/included/vfx/scene/scene-vfx-emotion-joy"
_SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">%s</svg>'
SVG_IMAGES = {
    "star.svg": _SVG % b'<path d="M18 0L36 36H0z" fill="#fc0"/>',
    "heart.svg": _SVG % b'<circle cx="18" cy="18" r="16" fill="#f69"/>',
}


def _save(tmp_path: Path, replacement: bytes | None = None) -> FilesystemContentStore:
    """Save an Included background as Local content whose marquee shows two SVG images."""

    (tmp_path / "local").mkdir(exist_ok=True)
    (tmp_path / "operations").mkdir(exist_ok=True)
    store = FilesystemContentStore(
        included_root=tmp_path / "included", local_root=tmp_path / "local", operations_root=tmp_path / "operations"
    )
    document = json.loads((SOURCE / "scene-vfx-emotion-joy.json").read_text())
    document["id"] = "local:scene:svg-joy"
    definition = document["definition"]
    definition.pop("scatters", None)
    definition.pop("tile", None)
    definition["marquee"]["enabled"] = True
    definition["marquee"]["items"] = [
        {"id": Path(name).stem, "kind": "image", "label": Path(name).stem.title(), "image": name} for name in SVG_IMAGES
    ]
    document["files"] = [{"path": name, "role": "image"} for name in SVG_IMAGES]
    files = dict(SVG_IMAGES)
    if replacement is not None:
        files[next(iter(files))] = replacement
    store.save_descriptor_entry(
        kind=ContentKind.SCENE_EFFECT,
        relative_locator="vfx/scene/local-svg-joy",
        descriptor=json.dumps(document).encode(),
        companion_files=files,
    )
    return store


def test_svg_scene_saves_and_reopens_as_local(tmp_path: Path) -> None:
    store = _save(tmp_path)
    entries = store.scan(ContentSource.LOCAL)
    assert len(entries) == 1
    assert entries[0].status is ContentStatus.VALID
    images = [file for file in entries[0].files if file.media_type == "image/svg+xml"]
    assert len(images) == 2


def test_scene_svg_supports_local_gradients_and_shape_references(tmp_path: Path) -> None:
    store = _save(
        tmp_path,
        b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
      <defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient>
      <path id="shape" d="M0 0L36 36"/></defs>
      <use href="#shape" fill="url(#paint)"/>
    </svg>""",
    )
    assert store.scan(ContentSource.LOCAL)[0].status is ContentStatus.VALID


@pytest.mark.parametrize(
    "body",
    [
        "<script>alert(1)</script>",
        '<path onload="alert(1)"/>',
        '<image href="https://example.com/tracker.png"/>',
        '<use href="https://example.com/art.svg#icon"/>',
        '<path fill="url(https://example.com/art.svg#paint)"/>',
        "<style>@import url(https://example.com/style.css);</style>",
        "<foreignObject><div>HTML</div></foreignObject>",
        '<animate attributeName="href" values="https://example.com"/>',
    ],
)
def test_scene_save_rejects_active_or_external_svg(tmp_path: Path, body: str) -> None:
    with pytest.raises(ContentValidationError):
        _save(tmp_path, f'<svg xmlns="http://www.w3.org/2000/svg">{body}</svg>'.encode())


@pytest.mark.parametrize("content", [b"not SVG", b"<svg", b'<!DOCTYPE svg [<!ENTITY x "hello">]><svg>&x;</svg>'])
def test_scene_save_rejects_malformed_svg(tmp_path: Path, content: bytes) -> None:
    with pytest.raises(ContentValidationError):
        _save(tmp_path, content)
