#!/usr/bin/env python3
"""Explicitly acquire pinned Pocket TTS and Smart Turn bytes into the shared store.

Uses the stdlib-only Parakeet storage primitives on Windows, macOS and Linux.
Serving, builds and verify/path operations never contact upstream services.
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

MODEL_ID = "browser-speech"
REPOSITORY = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPOSITORY / "models" / MODEL_ID / "manifest.json"
# Pocket TTS english_2026-04 bundle: INT8 flow LM, FP32 flow head, decoder,
# encoder and text conditioner, plus runtime metadata.
POCKET_BUNDLE = {
    "flow_lm_main_int8.onnx",
    "flow_lm_flow.onnx",
    "mimi_decoder.onnx",
    "mimi_encoder.onnx",
    "text_conditioner.onnx",
    "tokenizer.model",
    "bos_before_voice.npy",
    "bundle.json",
}
POCKET_BUNDLE_REVISION = "58a6d00cf13d239b6748cb0769f35c580a8f606c"
# Core voice states: the `core` voices of the owner-curated selection
# (scripts/voices/selection.json); the others download on demand (pocket_voices.py).
# Kyutai precomputed states come from Hugging Face; self-encoded VCTK states from
# Animama's release host under content-addressed names. Every voice must carry a
# license that permits commercial use.
VOICE_SELECTION = REPOSITORY / "scripts" / "voices" / "selection.json"
POCKET_VOICE_REVISION = "4e1e0a3e611c51c0b4ed8174fc10f32a54644303"
POCKET_VOICE_LICENSES = {"CC-BY-4.0", "CC0-1.0"}  # CC0 is permitted, though every shipped state is CC BY 4.0 today.
# Animama-hosted states use the immutable models/<model-id>/<sha256>/<file> layout.
RELEASE_VOICE_PREFIX = "https://downloads.animama.ai/models/pocket-tts-voices/"
SMART_TURN = "smart-turn-v3.2-cpu.onnx"
NOTICE_NAMES = {"pocket-tts-attribution.txt", "pocket-tts-onnx-license.txt", "smart-turn-bsd-2-clause.txt"}
NOTICE_PATHS = {f"src/frontend/desktop/runtime/notices/{name}" for name in NOTICE_NAMES}


def load_voice_selection(path: Path = VOICE_SELECTION) -> list[dict]:
    """Every curated voice; IDs become file names, so only safe names are accepted."""
    voices = json.loads(path.read_text())["voices"]
    if any(not re.fullmatch(r"[a-z0-9_]{1,64}", voice["id"]) for voice in voices):
        raise ValueError("voice IDs must be lowercase letters, digits or underscores")
    return voices


def shipped_voices(path: Path = VOICE_SELECTION) -> dict[str, str]:
    """Map each core voice file name to its source kind (`huggingface` or `release`)."""
    return {
        f"{voice['id']}.safetensors": "release" if voice["source"].startswith("vctk-") else "huggingface"
        for voice in load_voice_selection(path)
        if voice["delivery"] == "core"
    }


def expected_voice_source(name: str, kind: str, sha256: str) -> dict:
    """The only reviewed source for a voice state."""
    if kind == "release":
        return {"kind": "release", "url": f"{RELEASE_VOICE_PREFIX}{sha256}/{name}"}
    return {
        "repository": "kyutai/pocket-tts-without-voice-cloning",
        "revision": POCKET_VOICE_REVISION,
        "path": f"languages/english_2026-04/embeddings/{name}",
    }


def expected_source(name: str) -> dict:
    """Restrict download ownership, full revisions and paths to reviewed upstreams."""
    if name in POCKET_BUNDLE:
        repository, revision, path = (
            "KevinAHM/pocket-tts-onnx",
            POCKET_BUNDLE_REVISION,
            f"onnx/english_2026-04/{name}",
        )
    elif name == SMART_TURN:
        repository, revision, path = "pipecat-ai/smart-turn-v3", "f766f81d3cfdf7737ac64aad813d91bbfd56bf93", name
    else:
        raise ValueError("unreviewed browser model filename")
    return {"repository": repository, "revision": revision, "path": path}


def validate_bytes(entry: dict) -> None:
    """Validate bounded size and exact SHA-256 declarations."""
    if type(entry["size"]) is not int or not 0 < entry["size"] < 2**31:
        raise ValueError("invalid byte size")
    if not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]):
        raise ValueError("invalid SHA-256")


def load_manifest(path: Path = DEFAULT_MANIFEST) -> dict:
    """Bind the exact payload inventory, original URL layout and retained local notices."""
    with store.regular_file(Path(path).absolute()) as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise store.ModelStoreError("Manifest exceeds 64 KiB")
    try:
        value = json.loads(raw, object_pairs_hook=store.unique_keys)
        if value["schema_version"] != 1 or value["model_id"] != MODEL_ID:
            raise ValueError("unsupported schema or model")
        entries = value["files"]
        voices = shipped_voices()
        expected_names = POCKET_BUNDLE | set(voices) | {SMART_TURN}
        if len(entries) != len(expected_names) or {entry["path"] for entry in entries} != expected_names:
            raise ValueError("expected the exact browser speech inventory: the bundle, Smart Turn and shipped voices")
        for entry in entries:
            name = entry["path"]
            validate_bytes(entry)
            if name in voices:
                group, source = "pocket-tts/voices", expected_voice_source(name, voices[name], entry["sha256"])
                licensed = entry["license"] in POCKET_VOICE_LICENSES
            else:
                group = "smart-turn" if name == SMART_TURN else "pocket-tts"
                source = expected_source(name)
                licensed = entry["license"] == ("BSD-2-Clause" if name == SMART_TURN else "CC-BY-4.0")
            if entry["target"] != f"models/{group}/{name}" or entry["source"] != source:
                raise ValueError(f"unreviewed source or target for {name}")
            if not licensed:
                raise ValueError(f"unexpected license for {name}")
        notices = value["notices"]
        if len(notices) != 3 or {entry["path"] for entry in notices} != NOTICE_PATHS:
            raise ValueError("expected the exact three retained notice paths")
        for entry in notices:
            validate_bytes(entry)
            store.verify_file(REPOSITORY / entry["path"], entry)
    except (KeyError, TypeError, ValueError) as exc:
        raise store.ModelStoreError(f"Invalid browser speech manifest: {exc}") from exc
    value["digest"] = hashlib.sha256(raw).hexdigest()
    return value


def main(argv: list[str] | None = None) -> int:
    """Print the verified directory; --import-from reads the old public/onnx layout."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("acquire", "verify", "path"))
    parser.add_argument("--root", help="absolute shared model STORE root (overrides ANIMAMA_MODEL_ROOT)")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST, help="local reviewed manifest or fixture")
    parser.add_argument("--offline", action="store_true", help="never access the network (always true for verify/path)")
    parser.add_argument(
        "--import-from", type=Path, help="existing public/onnx root with models/pocket-tts and smart-turn"
    )
    args = parser.parse_args(argv)
    if args.import_from and args.operation != "acquire":
        parser.error("--import-from applies only to acquire")
    try:
        root = store.resolve_root(args.root)
        manifest = load_manifest(args.manifest)
        result = (
            store.acquire(manifest, root, offline=args.offline, import_from=args.import_from, import_field="target")
            if args.operation == "acquire"
            else store.verify(manifest, root)
        )
        print(result)
        return 0
    except (store.ModelStoreError, OSError, ValueError, HTTPException) as exc:
        detail = (
            str(exc)
            if isinstance(exc, store.ModelStoreError)
            else "Filesystem or transfer failure; check space and access"
        )
        print(f"Browser speech setup failed: {detail}", file=sys.stderr)
        print(
            "Run python3 scripts/models/browser_speech.py acquire [--root ABSOLUTE_STORE_ROOT]. "
            "To reuse existing files, add --offline --import-from EXISTING_PUBLIC_ONNX_DIRECTORY.",
            file=sys.stderr,
        )
        return 2 if isinstance(exc, store.ModelStoreMissing) else 1


if __name__ == "__main__":
    raise SystemExit(main())
