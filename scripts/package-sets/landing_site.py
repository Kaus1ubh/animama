"""Closed landing-site archives: the static animama.ai site a package set ships.

The archive reuses the application's bounded regular-file tar reader and size
limits. Its ``site-manifest.json`` lists every file once; the archive holds
exactly those files and the manifest.
"""

from __future__ import annotations

import re
from pathlib import Path

from application import (
    MAX_FILE,
    MAX_FILES,
    MIMES,
    TEXT_SUFFIXES,
    closed,
    inspect_archive,
    positive_int,
    read_json,
    safe_path,
)
from package_set import HEX40, HEX64, SEMVER, canonical, matches

SITE = "animama-landing"
SITE_MANIFEST = "site-manifest.json"
REQUIRED = ("index.html", "_headers", "notices.txt", "robots.txt")
# The landing build names every file under assets/ by its content hash; every
# other path keeps its name across releases and must revalidate.
IMMUTABLE_PREFIX = "assets/"
SITE_MIMES = {
    **MIMES,
    ".xml": "application/xml",
    ".vrm": "model/gltf-binary",
}
HEADERS_MIME = "text/plain; charset=utf-8"
SITE_TEXT_SUFFIXES = TEXT_SUFFIXES | {".xml"}
STAGE_ROUTES = (b"/__preview/media/", b"/__stage/", b"/@fs/")
# The verifier cannot know the producer's checkout or home folder, so it
# rejects the absolute path forms a build machine would leak: a `file:` URL, a
# Unix root folder or a Windows user folder, with plain or JSON-escaped (`\/`,
# `\\`) separators. A Unix marker that follows a letter, digit or one of
# `_.~%-\` is part of a URL or relative path, except after an escaped newline,
# carriage return or tab (`\n`, `\r`, `\t`). The contract documents this exact
# pattern; keep the two in step.
LOCAL_PATH = re.compile(
    rb"(?i:file):(?:\\?/){2}"
    rb"|(?:(?<![A-Za-z0-9_.~%\\-])|(?<=\\[nrt]))\\?/"
    rb"(?:Users|home|root|tmp|private|var\\?/folders|Volumes|mnt|opt)\\?/"
    rb"|(?<![A-Za-z0-9_])[A-Za-z]:(?:\\{1,2}|/)(?i:users)(?:\\{1,2}|/)"
)


def site_mime(path):
    """Explicit MIME policy; `_headers` is host configuration with no suffix."""
    if path == "_headers":
        return HEADERS_MIME
    try:
        return SITE_MIMES[Path(path).suffix.lower()]
    except KeyError as error:
        raise ValueError(f"Unreviewed site file type: {path}") from error


def site_cache(path):
    return "immutable" if path.startswith(IMMUTABLE_PREFIX) else "revalidate"


def site_text(name):
    return name == "_headers" or Path(name).suffix.lower() in SITE_TEXT_SUFFIXES


def verify_site(path, source, version, *, source_tree):
    """Verify a site archive against its set's source and version; return its manifest."""
    try:
        files, texts = inspect_archive(path, root=SITE, manifest=SITE_MANIFEST, is_text=site_text)
    except ValueError as error:
        # The shared intake words its errors for the application archive.
        raise ValueError(f"Invalid landing site archive: {error}") from error
    if any(name.lower().endswith(".map") for name in files):
        raise ValueError("Site archive contains a source map")
    payload = texts.get(SITE_MANIFEST, b"")
    site = read_json(payload)
    closed(
        site,
        {
            "schema_version",
            "site",
            "site_version",
            "source_commit",
            "source_tree",
            "entry_document",
            "headers_sha256",
            "files",
        },
        "site manifest",
    )
    if (
        type(site["schema_version"]) is not int
        or site["schema_version"] != 1
        or payload != canonical(site)
        or site["site"] != SITE
        or not matches(SEMVER, site["site_version"])
        or site["site_version"] != version
        or not matches(HEX40, site["source_commit"])
        or site["source_commit"] != source
        or not matches(HEX40, site["source_tree"])
        or site["source_tree"] != source_tree
        or site["entry_document"] != "index.html"
        or not matches(HEX64, site["headers_sha256"])
    ):
        raise ValueError("Site version/source/entry mismatch")
    if not isinstance(site["files"], list) or not 1 <= len(site["files"]) < MAX_FILES:
        raise ValueError("Invalid site file inventory")
    inventory = {}
    for entry in site["files"]:
        closed(entry, {"path", "sha256", "size", "mime_type", "cache"}, "site file")
        name = safe_path(entry["path"])
        if name in inventory or name == SITE_MANIFEST or entry["mime_type"] != site_mime(name):
            raise ValueError("Duplicate site file, manifest self-reference or incorrect MIME")
        if (
            not positive_int(entry["size"], MAX_FILE)
            or not matches(HEX64, entry["sha256"])
            or entry["cache"] != site_cache(name)
        ):
            raise ValueError(f"Invalid site file hash/size/cache: {name}")
        if files.get(name) != {"sha256": entry["sha256"], "size": entry["size"]}:
            raise ValueError(f"Site file integrity mismatch: {name}")
        inventory[name] = entry
    if set(files) != set(inventory) | {SITE_MANIFEST}:
        raise ValueError("Archive and site inventories differ")
    if missing := [name for name in REQUIRED if name not in inventory]:
        raise ValueError(f"Site is missing required files: {', '.join(missing)}")
    if inventory["_headers"]["sha256"] != site["headers_sha256"]:
        raise ValueError("Site headers digest mismatch")
    for name, data in texts.items():
        if name == SITE_MANIFEST:
            continue
        if any(route in data for route in STAGE_ROUTES):
            raise ValueError(f"Stage server route in site file: {name}")
        if LOCAL_PATH.search(data):
            raise ValueError(f"Local path in site file: {name}")
    return site
