#!/usr/bin/env python3
"""Acquire reviewed release inputs before their public model objects exist.

This explicit maintainer command may download pinned upstream files and encode
the selected VCTK voices. It never rehashes approvals, scans or publishes. Normal
application builds continue to require only their already acquired core inputs.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
GENERATED_INPUTS = (
    "scripts/voices/encoded-state-hashes.json",
    "models/browser-speech/manifest.json",
    "models/browser-runtime/manifest.json",
    "models/pocket-tts-voices",
    "src/backend/animama/resources/model-assets.v1.json",
    "src/frontend/web/src/lib/speech/pocket/voice-catalog.ts",
    "src/frontend/desktop/runtime/notices/pocket-tts-attribution.txt",
    "licenses/third-party/code-and-models.json",
)


def reviewed_vctk_sources() -> list[str]:
    """Encode only curated sources with an existing reviewed output hash."""
    voices = json.loads((REPOSITORY / "scripts/voices/selection.json").read_text())["voices"]
    sources = sorted({voice["source"] for voice in voices if voice["source"].startswith("vctk-")})
    hashes = json.loads((REPOSITORY / "scripts/voices/encoded-state-hashes.json").read_text())
    if not sources or any(
        not re.fullmatch(r"vctk-[ps]\d+", source) or not re.fullmatch(r"[a-f0-9]{64}", hashes.get(source, ""))
        for source in sources
    ):
        raise ValueError("Every selected VCTK source must already have a reviewed encoded-state hash")
    return sources


def acquire_release_inputs(*, root: Path, work: Path, import_voices: Path | None = None) -> None:
    """Populate the verified model store, stopping if regeneration changes tracked inputs."""
    for directory in (root, work, import_voices):
        if directory is not None and not directory.is_absolute():
            raise ValueError("Model root, work directory and optional voice import must be absolute")
    environment = {**os.environ, "ANIMAMA_MODEL_ROOT": str(root)}

    def run(*command: str, capture: bool = False) -> str:
        result = subprocess.run(
            list(command), cwd=REPOSITORY, env=environment, check=True, text=True, capture_output=capture
        )
        return result.stdout.strip() if capture else ""

    # A producer may rewrite derived files only when its output matches reviewed HEAD.
    # Check first as well, so existing user edits cannot be mistaken for generated drift.
    run("git", "diff", "--quiet", "HEAD", "--", *GENERATED_INPUTS)
    for script, arguments in (
        ("parakeet", ("--source", "upstream")),
        ("parakeet_webgpu", ()),
        ("browser_speech", ()),
        ("pocket_cloning", ("--source", "upstream")),
    ):
        run(sys.executable, f"scripts/models/{script}.py", "acquire", *arguments)
    if import_voices is None:
        sources = reviewed_vctk_sources()
        core = run(sys.executable, "scripts/models/browser_speech.py", "path", capture=True)
        if not Path(core).is_absolute():
            raise ValueError("The verified browser-core path must be absolute")
        voice_command = ("scripts/voices/voices.py", "--work-dir", str(work))
        run(sys.executable, *voice_command, "fetch")
        run("uv", "run", "--locked", "--script", *voice_command, "encode", "--only", *sources)
        run(sys.executable, *voice_command, "release", "--model-inputs", core)
        run("git", "diff", "--quiet", "HEAD", "--", *GENERATED_INPUTS)
        import_voices = work / "import-voice-set"
    # An existing producer inventory follows the same pinned size/hash verification.
    run(sys.executable, "scripts/models/pocket_voices.py", "acquire", "--offline", "--import-from", str(import_voices))


def main(argv: list[str] | None = None) -> int:
    """Keep release-only downloads explicit and failures fatal to candidate construction."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path, help="absolute shared model store")
    parser.add_argument("--work-dir", required=True, type=Path, help="absolute untracked voice producer work directory")
    parser.add_argument("--import-voices", type=Path, help="existing complete voice-set inventory; skips encoding")
    args = parser.parse_args(argv)
    try:
        acquire_release_inputs(root=args.root, work=args.work_dir, import_voices=args.import_voices)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        message = str(error) if isinstance(error, ValueError) else "A verified input command failed; review its output."
        print(f"Release model inputs failed: {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
