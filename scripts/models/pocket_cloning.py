#!/usr/bin/env python3
"""Explicitly acquire the optional Pocket voice-cloning encoder for producers.

The application installs this encoder through its pinned model-asset catalog.
This maintainer command bootstraps publication from the reviewed upstream or an
explicit offline import. Ordinary builds need only browser_speech.py; verify/path
never access the network.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from http.client import HTTPException
from pathlib import Path

# Script execution supplies this directory on sys.path; test loaders may not.
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
import parakeet as store  # noqa: E402

MODEL_ID = "pocket-tts-voice-cloning"
DEFAULT_MANIFEST = Path(__file__).resolve().parents[2] / "models" / MODEL_ID / "manifest.json"
ENCODER = "mimi_encoder.onnx"
ENCODER_SOURCE = {
    "repository": "KevinAHM/pocket-tts-onnx",
    "revision": "58a6d00cf13d239b6748cb0769f35c580a8f606c",
    "path": f"onnx/english_2026-04/{ENCODER}",
}


def load_manifest(path: Path = DEFAULT_MANIFEST) -> dict:
    """Bind the exact three-file inventory: the pinned Mimi encoder plus local notices."""
    path = Path(path).absolute()
    with store.regular_file(path) as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise store.ModelStoreError("Manifest exceeds 64 KiB")
    try:
        value = json.loads(raw, object_pairs_hook=store.unique_keys)
        if value["schema_version"] != 1 or value["model_id"] != MODEL_ID or value["license"] != "CC-BY-4.0":
            raise ValueError("unsupported schema, model or license")
        entries = value["files"]
        if len(entries) != 3 or {entry["path"] for entry in entries} != store.NOTICES | {ENCODER}:
            raise ValueError("expected the exact three-file Pocket cloning inventory")
        for entry in entries:
            name = entry["path"]
            if type(entry["size"]) is not int or not 0 < entry["size"] < 2**31:
                raise ValueError(f"invalid byte size for {name}")
            if not isinstance(entry["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]):
                raise ValueError(f"invalid SHA-256 for {name}")
            expected = {"local": name} if name in store.NOTICES else ENCODER_SOURCE
            if entry["source"] != expected:
                raise ValueError(f"unreviewed source for {name}")
    except (KeyError, TypeError, ValueError) as exc:
        raise store.ModelStoreError(f"Invalid Pocket cloning model manifest: {exc}") from exc
    value["digest"] = hashlib.sha256(raw).hexdigest()
    value["directory"] = path.parent
    return value


def main(argv: list[str] | None = None) -> int:
    """Print only the verified absolute model directory on success."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("acquire", "verify", "path"))
    parser.add_argument("--source", choices=("upstream",), default="upstream", help="reviewed producer origin")
    parser.add_argument("--root", help="absolute shared model STORE root (overrides ANIMAMA_MODEL_ROOT)")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST, help="local reviewed manifest or fixture")
    parser.add_argument("--offline", action="store_true", help="never access the network (always true for verify/path)")
    parser.add_argument("--import-from", type=Path, help="copy an existing three-file inventory after hash validation")
    args = parser.parse_args(argv)
    if args.import_from and args.operation != "acquire":
        parser.error("--import-from applies only to acquire")
    try:
        root = store.resolve_root(args.root)
        manifest = load_manifest(args.manifest)
        result = (
            store.acquire(manifest, root, offline=args.offline, import_from=args.import_from)
            if args.operation == "acquire"
            else store.verify(manifest, root)
        )
        print(result)
        return 0
    except (store.ModelStoreError, OSError, ValueError, HTTPException) as exc:
        # Never include transport exception text: it can contain signed query URLs.
        detail = (
            str(exc)
            if isinstance(exc, store.ModelStoreError)
            else "Filesystem or transfer failure; check space and access"
        )
        print(f"Pocket cloning setup failed: {detail}", file=sys.stderr)
        print(
            "Run python3 scripts/models/pocket_cloning.py acquire [--root ABSOLUTE_STORE_ROOT] "
            "(optional, about 40 MB). To reuse existing files, add --offline --import-from DIRECTORY.",
            file=sys.stderr,
        )
        return 2 if isinstance(exc, store.ModelStoreMissing) else 1


if __name__ == "__main__":
    raise SystemExit(main())
