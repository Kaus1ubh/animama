"""WebP derivatives of Included effect art and their licence lookup (#655)."""

from __future__ import annotations

import hashlib
import io
import json
import math
import subprocess
from pathlib import Path
from typing import Any, cast

import PIL
import pytest
from PIL import Image, features

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services.content_portability import licensing_path, parse_inventory_derivatives
from animama.domain.content_catalog import ContentSource
from animama.runtime.included_derivatives import (
    WEBP_METHOD,
    WEBP_QUALITY,
    IncludedDerivativeError,
    convert_included_tree,
)
from animama.runtime.starter_content import starter_inventory

REPO = Path(__file__).resolve().parents[1]
FALLBACK = {"glob": "**/*", "license_id": "LicenseRef-fallback", "provenance": "Fallback rule"}
RULES = [
    {"glob": "vfx/avatar/mark/mark.png", "license_id": "LicenseRef-mark-art", "provenance": "Mark art"},
    {"glob": "vfx/avatar/**/*", "license_id": "LicenseRef-avatar-folder", "provenance": "Avatar folder"},
    {"glob": "vfx/particle/**/*", "license_id": "LicenseRef-particle-folder", "provenance": "Particle folder"},
    {"glob": "vfx/scene/**/*.png", "license_id": "LicenseRef-scene-art", "provenance": "Scene art"},
    {"glob": "vfx/scene/**/*", "license_id": "LicenseRef-scene-folder", "provenance": "Scene folder"},
    FALLBACK,
]


def _art(size: int = 64) -> bytes:
    """Smooth RGBA art whose transparent half keeps a saturated edge-bleed colour."""

    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    assert pixels is not None
    for y in range(size):
        for x in range(size):
            if x < size // 2:
                pixels[x, y] = (255, 0, 0, 0)
            else:
                value = int(127 + 127 * math.sin(x / 5) * math.cos(y / 7))
                pixels[x, y] = (value, 255 - value, (x * 4) % 256, 128 + int(127 * math.sin((x + y) / 9)))
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def _patterned() -> bytes:
    """Regular patterned art that PNG stores smaller than lossy WebP."""

    image = Image.new("RGBA", (64, 64))
    pixels = image.load()
    assert pixels is not None
    for y in range(64):
        for x in range(64):
            pixels[x, y] = ((x * 37 + y * 11) % 256, (x * 5 + y * 29) % 256, (x * y) % 256, 128 + (x + y) % 128)
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def _write(root: Path, relative: str, data: bytes | dict[str, Any]) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json.dumps(data, indent=2).encode() + b"\n" if isinstance(data, dict) else data)


def _avatar_effect(image: str, *, attachment: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "content_type": "avatar_effect",
        "files": [{"path": image, "role": "image"}],
        "definition": {
            "schema": "animama/avatar-effect/2",
            "attachment": attachment or {"kind": "landmark"},
            "art": {"image": image},
        },
    }


def _source_tree(root: Path) -> list[str]:
    _write(root, "licenses/inventory.json", {"schema_version": 1, "rules": RULES})
    _write(root, "vfx/avatar/mark/mark.json", _avatar_effect("mark.png"))
    _write(root, "vfx/avatar/mark/mark.png", _art())
    _write(root, "vfx/avatar/flat/flat.json", _avatar_effect("flat.png"))
    _write(root, "vfx/avatar/flat/flat.png", _patterned())
    _write(
        root,
        "vfx/avatar/skin/skin.json",
        _avatar_effect("skin.png", attachment={"kind": "face_surface", "area": "full", "part": "face_skin"}),
    )
    _write(root, "vfx/avatar/skin/skin.png", _art())
    _write(
        root,
        "vfx/particle/quark/sparks/sparks.json",
        {
            "content_type": "particle_effect",
            "files": [
                {"path": "particle.json", "role": "manifest"},
                {"path": "textures/spark.png", "role": "texture"},
            ],
        },
    )
    _write(
        root,
        "vfx/particle/quark/sparks/particle.json",
        {
            "images": [{"uuid": "spark-png-image", "url": "textures/spark.png"}],
            "textures": [{"name": "spark.png", "image": "spark-png-image"}],
        },
    )
    _write(root, "vfx/particle/quark/sparks/textures/spark.png", _art(32))
    # Library art no descriptor lists ships as a web asset, not as content.
    _write(root, "vfx/particle/particle-vfx/textures/library.png", _art(32))
    _write(
        root,
        "vfx/scene/drift/drift.json",
        {
            "content_type": "scene_effect",
            "files": [{"path": "leaf.png", "role": "image"}],
            "definition": {"marquee": {"items": [{"image": "leaf.png", "label": "leaf.png note"}]}},
        },
    )
    _write(root, "vfx/scene/drift/leaf.png", _art(48))
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file())


def _decode(path: Path) -> list[tuple[int, int, int, int]]:
    with Image.open(path) as image:
        return list(cast(tuple[tuple[int, int, int, int], ...], image.convert("RGBA").get_flattened_data()))


def test_converts_effect_art_and_rewrites_every_reference(tmp_path: Path) -> None:
    source = tmp_path / "source"
    paths = _source_tree(source)

    derivatives = convert_included_tree(source, tmp_path / "out", paths)

    out = tmp_path / "out"
    assert sorted(derivatives) == [
        "vfx/avatar/mark/mark.webp",
        "vfx/avatar/skin/skin.webp",
        "vfx/particle/quark/sparks/textures/spark.webp",
        "vfx/scene/drift/leaf.webp",
    ]
    assert derivatives["vfx/avatar/mark/mark.webp"]["path"] == "vfx/avatar/mark/mark.png"
    assert not (out / "vfx/avatar/mark/mark.png").exists()
    for kept in ("vfx/avatar/flat/flat.png", "vfx/particle/particle-vfx/textures/library.png"):
        assert (out / kept).read_bytes() == (source / kept).read_bytes()
    mark = json.loads((out / "vfx/avatar/mark/mark.json").read_text())
    assert mark["files"] == [{"path": "mark.webp", "role": "image"}]
    assert mark["definition"]["art"]["image"] == "mark.webp"
    manifest = json.loads((out / "vfx/particle/quark/sparks/particle.json").read_text())
    assert manifest["images"] == [{"uuid": "spark-png-image", "url": "textures/spark.webp"}]
    assert manifest["textures"] == [{"name": "spark.webp", "image": "spark-png-image"}]
    scene = json.loads((out / "vfx/scene/drift/drift.json").read_text())
    assert scene["definition"]["marquee"]["items"] == [{"image": "leaf.webp", "label": "leaf.png note"}]
    # Files the conversion did not touch keep their exact bytes.
    flat = (out / "vfx/avatar/flat/flat.json").read_bytes()
    assert flat == (source / "vfx/avatar/flat/flat.json").read_bytes()


def test_derivatives_keep_alpha_exact_and_the_edge_bleed(tmp_path: Path) -> None:
    source = tmp_path / "source"
    _source_tree(source)
    convert_included_tree(source, tmp_path / "out", _source_tree(source))

    master = _decode(source / "vfx/avatar/mark/mark.png")
    derived = _decode(tmp_path / "out/vfx/avatar/mark/mark.webp")
    assert max(abs(a[3] - b[3]) for a, b in zip(master, derived, strict=True)) == 0
    hidden = [(pixel[0], pixel[1], pixel[2]) for pixel in derived if pixel[3] == 0]
    assert hidden and sum(abs(r - 255) + g + b for r, g, b in hidden) / len(hidden) < 24
    # UV-laid face-surface art is lossless.
    skin = _decode(tmp_path / "out/vfx/avatar/skin/skin.webp")
    assert skin == _decode(source / "vfx/avatar/skin/skin.png")


def test_conversion_is_reproducible(tmp_path: Path) -> None:
    source = tmp_path / "source"
    paths = _source_tree(source)
    convert_included_tree(source, tmp_path / "a", paths)
    convert_included_tree(source, tmp_path / "b", paths)

    def tree(root: Path) -> dict[str, bytes]:
        return {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob("*") if path.is_file()}

    assert tree(tmp_path / "a") == tree(tmp_path / "b")


def test_the_staged_inventory_records_each_derivative_and_keeps_its_rules(tmp_path: Path) -> None:
    source = tmp_path / "source"
    paths = _source_tree(source)
    derivatives = convert_included_tree(source, tmp_path / "out", paths)

    staged = json.loads((tmp_path / "out/licenses/inventory.json").read_text())
    assert staged["rules"] == RULES
    assert staged["derivatives"] == derivatives
    master = source / "vfx/scene/drift/leaf.png"
    assert derivatives["vfx/scene/drift/leaf.webp"]["size_bytes"] == master.stat().st_size
    assert parse_inventory_derivatives(staged) == {path: record["path"] for path, record in derivatives.items()}
    assert json.loads((source / "licenses/inventory.json").read_text()) == {"schema_version": 1, "rules": RULES}


def test_a_derivative_resolves_the_licence_and_distribution_of_its_master(tmp_path: Path) -> None:
    source = tmp_path / "source"
    paths = _source_tree(source)
    # A rule that only a derivative's own name would match must never apply to it.
    excluded = {
        "glob": "vfx/scene/**/*.webp",
        "license_id": "LicenseRef-x",
        "provenance": "x",
        "distribution": "excluded",
    }
    _write(source, "licenses/inventory.json", {"schema_version": 1, "rules": [excluded, *RULES]})
    convert_included_tree(source, tmp_path / "out", paths)
    staged = parse_inventory_derivatives(json.loads((tmp_path / "out/licenses/inventory.json").read_text()))

    assert licensing_path("vfx/scene/drift/leaf.webp", staged) == "vfx/scene/drift/leaf.png"
    assert licensing_path("vfx/scene/drift/drift.json", staged) == "vfx/scene/drift/drift.json"

    def provenance(root: Path) -> dict[str, dict[str, Any]]:
        store = FilesystemContentStore(
            included_root=root, local_root=root / ".unused", operations_root=root / ".unused"
        )
        return {entry.relative_locator: dict(entry.provenance) for entry in store.scan(ContentSource.INCLUDED)}

    assert provenance(tmp_path / "out") == provenance(source)


@pytest.mark.parametrize(
    "value",
    [
        [],
        {"vfx/a.webp": "vfx/a.png"},
        {"vfx/a.webp": {"path": 3}},
        {"vfx/a.webp": {"path": "vfx/a.png", "size_bytes": 1}},
        {"vfx/a.webp": {"path": "vfx/a.png", "sha256": "0" * 64, "size_bytes": "1"}},
        {"../a.webp": {"path": "vfx/a.png", "sha256": "0" * 64, "size_bytes": 1}},
    ],
)
def test_malformed_derivative_records_are_rejected(value: object) -> None:
    with pytest.raises(ValueError, match="derivative"):
        parse_inventory_derivatives({"rules": RULES, "derivatives": value})


def test_restricted_art_is_never_converted(tmp_path: Path) -> None:
    source = tmp_path / "source"
    paths = _source_tree(source)
    rules = [{**RULES[0], "distribution": "non-portable"}, *RULES[1:]]
    _write(source, "licenses/inventory.json", {"schema_version": 1, "rules": rules})

    derivatives = convert_included_tree(source, tmp_path / "out", paths)

    assert "vfx/avatar/mark/mark.webp" not in derivatives
    assert (tmp_path / "out/vfx/avatar/mark/mark.png").read_bytes() == (
        source / "vfx/avatar/mark/mark.png"
    ).read_bytes()


def test_a_stale_reference_fails_with_the_file_named(tmp_path: Path) -> None:
    source = tmp_path / "source"
    paths = _source_tree(source)
    document = json.loads((source / "vfx/scene/drift/drift.json").read_text())
    document["definition"]["marquee"]["items"].append({"image": "./leaf.png"})
    _write(source, "vfx/scene/drift/drift.json", document)

    with pytest.raises(IncludedDerivativeError, match=r"vfx/scene/drift/drift\.json.*\./leaf\.png"):
        convert_included_tree(source, tmp_path / "out", paths)


def test_a_bare_name_beside_its_descriptor_is_never_rewritten_to_missing_art(tmp_path: Path) -> None:
    source = tmp_path / "source"
    _source_tree(source)
    _write(
        source,
        "vfx/scene/pair/pair.json",
        {
            "content_type": "scene_effect",
            "files": [{"path": "flat.png", "role": "image"}, {"path": "sub/flat.png", "role": "image"}],
            "definition": {"marquee": {"items": [{"image": "flat.png"}, {"image": "sub/flat.png"}]}},
        },
    )
    _write(source, "vfx/scene/pair/flat.png", _patterned())
    _write(source, "vfx/scene/pair/sub/flat.png", _art())
    paths = sorted(path.relative_to(source).as_posix() for path in source.rglob("*") if path.is_file())

    convert_included_tree(source, tmp_path / "out", paths)

    document = json.loads((tmp_path / "out/vfx/scene/pair/pair.json").read_text())
    assert document["files"] == [{"path": "flat.png", "role": "image"}, {"path": "sub/flat.webp", "role": "image"}]
    assert document["definition"]["marquee"]["items"] == [{"image": "flat.png"}, {"image": "sub/flat.webp"}]
    assert (tmp_path / "out/vfx/scene/pair/flat.png").exists()


@pytest.mark.parametrize("link", ["symlink", "hardlink"])
def test_linked_inputs_are_refused_rather_than_copied_as_files(tmp_path: Path, link: str) -> None:
    source = tmp_path / "source"
    paths = _source_tree(source)
    outside = tmp_path / "outside.txt"
    outside.write_text("not content")
    linked = source / "vfx/scene/drift/notes.txt"
    if link == "symlink":
        linked.symlink_to(outside)
    else:
        linked.hardlink_to(outside)

    with pytest.raises(IncludedDerivativeError, match=r"vfx/scene/drift/notes\.txt"):
        convert_included_tree(source, tmp_path / "out", [*paths, "vfx/scene/drift/notes.txt"])
    assert not (tmp_path / "out").exists()


def test_an_unreadable_master_fails_with_the_file_named(tmp_path: Path) -> None:
    source = tmp_path / "source"
    paths = _source_tree(source)
    _write(source, "vfx/scene/drift/leaf.png", b"\x89PNG\r\n\x1a\nnot really")

    with pytest.raises(IncludedDerivativeError, match=r"vfx/scene/drift/leaf\.png"):
        convert_included_tree(source, tmp_path / "out", paths)


@pytest.fixture(scope="module")
def converted_included(tmp_path_factory: pytest.TempPathFactory) -> tuple[list[str], dict[str, dict[str, Any]], Path]:
    """The tracked Included tree converted once for the real-tree tests."""

    out = tmp_path_factory.mktemp("included") / "out"
    tracked = subprocess.check_output(["git", "ls-files", "-z", "--", "content/included"], cwd=REPO).decode()
    paths = sorted(name.removeprefix("content/included/") for name in tracked.split("\0") if name)
    return paths, convert_included_tree(REPO / "content/included", out, paths), out


def test_the_included_tree_converts_with_every_licence_and_closure_unchanged(
    converted_included: tuple[list[str], dict[str, dict[str, Any]], Path],
) -> None:
    included = REPO / "content/included"
    paths, derivatives, out = converted_included
    renamed = {record["path"]: derived for derived, record in derivatives.items()}

    source = starter_inventory(included, allowed_paths=set(paths))
    converted = starter_inventory(
        out, allowed_paths={renamed.get(path, path) for path in paths if path != "licenses/inventory.json"}
    )
    assert derivatives, "Included effect art should convert"
    assert all(path.startswith("vfx/") for path in derivatives)
    masters = {row["path"]: row for row in source["files"]}
    rows = {row["path"]: row for row in converted["files"]}
    assert set(rows) == {renamed.get(path, path) for path in masters}
    for path, row in rows.items():
        master = masters[derivatives[path]["path"] if path in derivatives else path]
        assert row["license"] == master["license"], path
        assert row["partition"] == master["partition"], path
        if path in derivatives:
            assert row["derived_from"] == {key: master[key] for key in ("path", "sha256", "size_bytes")}
        else:
            assert "derived_from" not in row
    assert [entry["locator"] for entry in converted["entries"]] == [entry["locator"] for entry in source["entries"]]
    assert converted["starters"] == source["starters"]

    def scanned(root: Path) -> dict[str, dict[str, Any]]:
        store = FilesystemContentStore(
            included_root=root, local_root=root / ".unused", operations_root=root / ".unused"
        )
        return {entry.relative_locator: dict(entry.provenance) for entry in store.scan(ContentSource.INCLUDED)}

    assert scanned(out) == scanned(included)
    shipped = sum(row["size_bytes"] for path, row in rows.items() if path in derivatives)
    masters_size = sum(masters[record["path"]]["size_bytes"] for record in derivatives.values())
    assert shipped < masters_size * 0.5


def test_shipped_copies_of_third_party_textures_record_their_webp_bytes(
    converted_included: tuple[list[str], dict[str, dict[str, Any]], Path],
) -> None:
    """art-particles.json names the WebP bytes that ship for each third-party copy.

    After adding or changing a copy of a recorded texture, regenerate
    ``packaged_derivatives`` from this test's expected entries.
    """

    record = json.loads((REPO / "licenses/third-party/art-particles.json").read_text())
    third_party = {entry["path"]: entry["sha256"] for entry in record["files"]}
    _, derivatives, out = converted_included
    expected = sorted(
        (
            {
                "master": "content/included/" + master["path"],
                "webp": {
                    "path": "content/included/" + path,
                    "sha256": hashlib.sha256((out / path).read_bytes()).hexdigest(),
                    "size_bytes": (out / path).stat().st_size,
                },
            }
            for path, master in derivatives.items()
            if master["sha256"] in third_party.values()
        ),
        key=lambda entry: entry["master"],
    )
    assert expected, "some third-party textures should ship converted"
    recorded = record["packaged_derivatives"]
    assert [{key: value for key, value in entry.items() if key != "copy_of"} for entry in recorded] == expected
    masters = {entry["master"].removeprefix("content/included/"): entry for entry in recorded}
    for derived, master in derivatives.items():
        if master["path"] in masters:
            assert third_party[masters[master["path"]]["copy_of"]] == master["sha256"], derived
    encoder = record["packaged_encoder"]
    assert f"Pillow {PIL.__version__}" in encoder and f"libwebp {features.version('webp')}" in encoder
    assert f"quality {WEBP_QUALITY}" in encoder and f"method {WEBP_METHOD}" in encoder
