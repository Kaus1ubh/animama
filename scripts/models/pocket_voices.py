#!/usr/bin/env python3
"""Explicitly acquire the Animama-hosted Pocket TTS voice set into the shared store.

The set holds the 36 voices the app downloads on demand, plus ATTRIBUTION.md and
README.md. Eve and Azelma belong to the separate core browser-speech set.
Maintainers acquire it to stage
publication (`models:stage`); the app itself installs downloadable voices through
`/v1/model-assets`. Uses the stdlib-only Parakeet storage primitives; verify/path
never contact upstream services.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from http.client import HTTPException
from pathlib import Path

# Script execution supplies this directory on sys.path; test loaders may not.
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_speech  # noqa: E402
import parakeet as store  # noqa: E402

MODEL_ID = "pocket-tts-voices"
DEFAULT_MANIFEST = Path(__file__).resolve().parents[2] / "models" / MODEL_ID / "manifest.json"


def hosted_voices() -> dict[str, str]:
    """Map each hosted voice file name to its source kind, from the curated selection."""
    return {
        f"{voice['id']}.safetensors": "release" if voice["source"].startswith("vctk-") else "huggingface"
        for voice in browser_speech.load_voice_selection()
        if voice["delivery"] == "download" or voice["source"].startswith("vctk-")
    }


def load_manifest(path: Path = DEFAULT_MANIFEST) -> dict:
    """Bind the exact inventory: the hosted voices of the selection plus the local notices."""
    path = Path(path).absolute()
    with store.regular_file(path) as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise store.ModelStoreError("Manifest exceeds 64 KiB")
    try:
        value = json.loads(raw, object_pairs_hook=store.unique_keys)
        if value["schema_version"] != 1 or value["model_id"] != MODEL_ID or value["license"] != "CC-BY-4.0":
            raise ValueError("unsupported schema, model or license")
        voices = hosted_voices()
        if {entry["path"] for entry in value["files"]} != store.NOTICES | set(voices) or len(value["files"]) != len(
            voices
        ) + len(store.NOTICES):
            raise ValueError("expected the notices and exactly the hosted voices of scripts/voices/selection.json")
        for entry in value["files"]:
            name = entry["path"]
            browser_speech.validate_bytes(entry)
            expected = (
                {"local": name}
                if name in store.NOTICES
                else browser_speech.expected_voice_source(name, voices[name], entry["sha256"])
            )
            if entry["source"] != expected:
                raise ValueError(f"unreviewed source for {name}")
    except (KeyError, TypeError, ValueError) as exc:
        raise store.ModelStoreError(f"Invalid Pocket voice set manifest: {exc}") from exc
    value["digest"] = hashlib.sha256(raw).hexdigest()
    value["directory"] = path.parent
    return value


def main(argv: list[str] | None = None) -> int:
    """Print only the verified absolute model directory on success."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("acquire", "verify", "path"))
    parser.add_argument("--root", help="absolute shared model STORE root (overrides ANIMAMA_MODEL_ROOT)")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST, help="local reviewed manifest or fixture")
    parser.add_argument("--offline", action="store_true", help="never access the network (always true for verify/path)")
    parser.add_argument("--import-from", type=Path, help="copy an existing flat inventory after hash validation")
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
        print(f"Pocket voice set setup failed: {detail}", file=sys.stderr)
        print(
            "Run python3 scripts/models/pocket_voices.py acquire [--root ABSOLUTE_STORE_ROOT]. "
            "To reuse existing files, add --offline --import-from DIRECTORY.",
            file=sys.stderr,
        )
        return 2 if isinstance(exc, store.ModelStoreMissing) else 1


if __name__ == "__main__":
    raise SystemExit(main())
