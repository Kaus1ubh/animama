#!/usr/bin/env python3
"""Verify exact candidate contents against a private immutable export manifest."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from export_core import verify_export


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--public", type=Path, required=True)
    parser.add_argument("--cloud", type=Path, required=True)
    parser.add_argument("--generated-layer", type=Path, action="append", default=[])
    args = parser.parse_args()
    try:
        print(json.dumps(verify_export(args.manifest, args.public, args.cloud, args.generated_layer), sort_keys=True))
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"Export verification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
