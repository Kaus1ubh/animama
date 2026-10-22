"""Ship Included effect art as WebP derivatives of its PNG masters (#655).

Packaging converts a tracked ``content/included`` snapshot into a separate tree:
eligible effect PNGs become WebP, every descriptor string naming one is
rewritten, and the tree's copy of ``licenses/inventory.json`` records each
derivative's master so licence lookup resolves through the master path
(``content_portability.licensing_path``). The masters in Git are never written.
Development and self-host serve the masters directly.
"""

from __future__ import annotations

import fnmatch
import hashlib
import json
import posixpath
import shutil
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image

from animama.app.services.content_portability import INVENTORY_DERIVATIVES_KEY
from animama.runtime.starter_content import regular_content_path

LICENSE_INVENTORY = "licenses/inventory.json"
# Lossy quality for effect art; alpha is always lossless.
WEBP_QUALITY = 90
# libwebp effort 0-6. Method 6 took about 70 times as long as 4 on the Included
# art for 4% smaller files (2026-10-22), so packaging uses 4.
WEBP_METHOD = 4
# Masters kept as PNG after a failed visual check, with the reason. A file also
# stays PNG whenever its WebP is not smaller.
PNG_EXCEPTIONS: dict[str, str] = {}


class IncludedDerivativeError(ValueError):
    """A master cannot be converted or a descriptor would name a missing file."""


def convert_included_tree(source: Path, destination: Path, paths: Iterable[str]) -> dict[str, dict[str, Any]]:
    """Copy ``paths`` from ``source`` into a new ``destination``, converting effect art.

    Returns the derivative record, keyed by derivative path, that is also
    written into the destination's licence inventory.
    """

    paths = sorted(set(paths) - {LICENSE_INVENTORY})
    # Copying would turn a symlink or hard link into an ordinary shipping file,
    # bypassing the scanner's link rejection, so every input must be regular.
    for path in [LICENSE_INVENTORY, *paths]:
        try:
            regular_content_path(source, path)
        except (OSError, ValueError) as exc:
            raise IncludedDerivativeError(f"Cannot convert {path}: {exc}") from exc
    inventory = json.loads((source / LICENSE_INVENTORY).read_text(encoding="utf-8"))
    if INVENTORY_DERIVATIVES_KEY in inventory:
        raise IncludedDerivativeError(f"{LICENSE_INVENTORY} already records derivatives; convert masters only")
    rules = inventory["rules"]
    owned, lossless = _descriptor_art(source, paths)
    candidates = [path for path in paths if path in owned and _eligible(path, rules)]
    with ThreadPoolExecutor() as pool:
        encoded = dict(
            zip(
                candidates,
                pool.map(lambda path: _encode(source, path, lossless=path in lossless), candidates),
                strict=True,
            )
        )
    renames = {
        path: path.removesuffix(".png") + ".webp"
        for path, data in encoded.items()
        if len(data) < (source / path).stat().st_size
    }
    existing = set(paths)
    if clashes := sorted(target for target in renames.values() if target in existing):
        raise IncludedDerivativeError(f"Derivative would replace a tracked file: {clashes[0]}")
    shipped = (existing - renames.keys()) | set(renames.values())
    # Rewrite (and so validate) every descriptor before writing anything.
    documents = {
        path: _rewritten_json(source, path, renames, existing, shipped) for path in paths if path.endswith(".json")
    }

    destination.mkdir(parents=True, exist_ok=False)
    derivatives: dict[str, dict[str, Any]] = {}
    for path in paths:
        if path in renames:
            target = renames[path]
            _write(destination / target, encoded[path])
            master = (source / path).read_bytes()
            derivatives[target] = {
                "path": path,
                "sha256": hashlib.sha256(master).hexdigest(),
                "size_bytes": len(master),
            }
        elif path in documents:
            _write(destination / path, documents[path])
        else:
            (destination / path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / path, destination / path)
    derivatives = dict(sorted(derivatives.items()))
    _write(destination / LICENSE_INVENTORY, _json_bytes({**inventory, INVENTORY_DERIVATIVES_KEY: derivatives}))
    return derivatives


def _eligible(path: str, rules: list[dict[str, Any]]) -> bool:
    """Effect PNGs whose licence carries no distribution restriction.

    Restricted bytes are recognised by their digests, so they keep their exact
    master bytes.
    """

    if not path.startswith("vfx/") or not path.endswith(".png") or path in PNG_EXCEPTIONS:
        return False
    rule = next((rule for rule in rules if fnmatch.fnmatchcase(path, rule["glob"])), None)
    return rule is not None and rule.get("distribution") is None


def _descriptor_art(source: Path, paths: list[str]) -> tuple[set[str], set[str]]:
    """Files listed by a content descriptor, and the art laid over a whole UV layout.

    Only a descriptor's own files ship as content; other tracked images (such as
    the Particle creator's texture library) are web assets and stay as they
    are. UV-layout art (whole face-part surfaces) is encoded losslessly, where
    lossy chroma could show at island seams.
    """

    owned: set[str] = set()
    uv_layout: set[str] = set()
    for path in paths:
        if not path.startswith("vfx/") or not path.endswith(".json"):
            continue
        try:
            document = json.loads((source / path).read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if not isinstance(document, dict):
            continue
        directory = posixpath.dirname(path)
        files = document.get("files")
        for item in files if isinstance(files, list) else ():
            if isinstance(item, dict) and isinstance(item.get("path"), str):
                owned.add(posixpath.join(directory, item["path"]))
        definition = document.get("definition")
        if not isinstance(definition, dict):
            continue
        attachment = definition.get("attachment") or {}
        art = definition.get("art") or {}
        if attachment.get("kind") == "face_surface" and attachment.get("area") == "full":
            for key in ("image", "otherEyeImage"):
                if isinstance(art.get(key), str):
                    uv_layout.add(posixpath.join(directory, art[key]))
    return owned, uv_layout


def _encode(source: Path, path: str, *, lossless: bool) -> bytes:
    try:
        with Image.open(source / path) as image:
            image.load()
            rgba = image.convert("RGBA")
        out = BytesIO()
        # ``exact`` keeps RGB under transparent pixels: the edge bleed that keeps
        # filtered and mipmapped art free of dark or light halos.
        rgba.save(
            out,
            "WEBP",
            lossless=lossless,
            quality=100 if lossless else WEBP_QUALITY,
            alpha_quality=100,
            method=WEBP_METHOD,
            exact=True,
        )
    except (OSError, ValueError) as exc:
        raise IncludedDerivativeError(f"Cannot convert {path}: {exc}") from exc
    return out.getvalue()


def _rewritten_json(source: Path, path: str, renames: dict[str, str], existing: set[str], shipped: set[str]) -> bytes:
    """Rewrite strings that name a renamed file; keep untouched JSON byte-identical.

    A rewritten ``files[].path`` must name a file that ships, so a descriptor
    can never point at art the conversion removed.
    """

    raw = (source / path).read_bytes()
    if not renames:
        return raw
    directory = posixpath.dirname(path)
    # Bare names (Quarks ``textures[].name``) match art anywhere beneath the JSON,
    # unless they name a file beside it.
    names = {posixpath.basename(master) for master in renames if master.startswith(directory + "/")}
    changed = False

    def rewrite(value: Any) -> Any:
        nonlocal changed
        if isinstance(value, dict):
            return {key: rewrite(item) for key, item in value.items()}
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        if not isinstance(value, str) or not value.endswith(".png"):
            return value
        joined = posixpath.join(directory, value)
        if joined in renames or ("/" not in value and value in names and joined not in existing):
            changed = True
            return value.removesuffix(".png") + ".webp"
        if posixpath.normpath(posixpath.join(directory, value)) in renames:
            raise IncludedDerivativeError(f"{path} names converted art as {value!r}; use its plain relative path")
        return value

    try:
        document = rewrite(json.loads(raw))
    except json.JSONDecodeError:
        return raw
    if not changed:
        return raw
    files = document.get("files") if isinstance(document, dict) else None
    for item in files if isinstance(files, list) else ():
        named = item.get("path") if isinstance(item, dict) else None
        if isinstance(named, str) and named.endswith(".webp") and posixpath.join(directory, named) not in shipped:
            raise IncludedDerivativeError(f"{path} would list {named!r}, which does not ship")
    return _json_bytes(document)


def _json_bytes(document: Any) -> bytes:
    return (json.dumps(document, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
