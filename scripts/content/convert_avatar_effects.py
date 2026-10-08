"""Convert Avatar Effect descriptors from ``animama/avatar-effect/1`` to ``/2``.

Usage (from the repository root)::

    uv run python scripts/content/convert_avatar_effects.py <folder-or-descriptor> [...]
    uv run python scripts/content/convert_avatar_effects.py --write content/included/vfx/avatar

Without ``--write`` the command is a dry run that lists what would change. It
reads every ``*.json`` descriptor whose ``content_type`` is ``avatar_effect``
beneath the given paths and rewrites only its ``definition``; every other
descriptor field and every image stay as they are, so content IDs are kept.
Already converted descriptors are left untouched. Use it for descriptor folders
such as Included content. Local library content converts automatically at
startup or on Rescan, or with ``uv run python -m animama.server.content_cli``.
It does not convert content packages: a package's manifest, sizes and digests
cover its original bytes, so convert the source content and export it again.

Exit status: 0 when every descriptor converted (or needed nothing), 1 when any
descriptor failed, 2 for usage errors.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from animama.app.services.avatar_effect_conversion import (
    convert_avatar_effect_definition,
    mirrors_offset_differently,
)
from animama.domain.content_documents import ContentDocumentError


def _descriptors(paths: list[Path]) -> list[Path]:
    found: set[Path] = set()
    for path in paths:
        if path.is_file():
            found.add(path)
        elif path.is_dir():
            found.update(candidate for candidate in path.rglob("*.json") if candidate.is_file())
        else:
            raise FileNotFoundError(path)
    return sorted(found)


def main(argv: list[str] | None = None) -> int:
    """Convert or report each Avatar Effect descriptor below the given paths."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", type=Path, help="descriptor files or folders to search")
    parser.add_argument("--write", action="store_true", help="rewrite descriptors (default: dry run)")
    args = parser.parse_args(argv)
    try:
        descriptors = _descriptors(args.paths)
    except FileNotFoundError as exc:
        print(f"Path not found: {exc}", file=sys.stderr)
        return 2

    converted = unchanged = failed = 0
    for path in descriptors:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            print(f"skip {path}: unreadable JSON ({type(exc).__name__})", file=sys.stderr)
            continue
        if not isinstance(payload, dict) or payload.get("content_type") != "avatar_effect":
            continue
        try:
            definition = convert_avatar_effect_definition(payload.get("definition"))
        except ContentDocumentError as exc:
            failed += 1
            print(f"FAIL {path}: {exc.field or 'definition'}: {exc}", file=sys.stderr)
            continue
        if definition == payload.get("definition"):
            unchanged += 1
            continue
        converted += 1
        if mirrors_offset_differently(payload.get("definition")):
            print(f"note {path}: the mirrored eye now mirrors its offset.x (avatar_effect_offset_mirrored)")
        payload["definition"] = definition
        if args.write:
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"converted {path}")
        else:
            print(f"would convert {path}")
    mode = "converted" if args.write else "to convert"
    print(f"{converted} {mode}, {unchanged} already /2, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
