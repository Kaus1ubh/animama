#!/usr/bin/env python3
"""Retain small source-bound CI results separately from short-lived verbose logs."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], text=True).strip()
    steps = json.loads(os.environ["CI_STEPS"])
    # Keep only public outcome/cache metadata. Do not serialize the runner env.
    receipt = {
        "schema_version": 1,
        "source_commit": os.environ["GITHUB_SHA"],
        "source_tree": tree,
        "job": os.environ["CI_JOB"],
        "event": os.environ["GITHUB_EVENT_NAME"],
        "run_id": os.environ["GITHUB_RUN_ID"],
        "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
        "steps": {name: {"outcome": step["outcome"], "conclusion": step["conclusion"]} for name, step in steps.items()},
        "cache": {
            name: {
                key: value
                for key, value in steps.get(name, {}).get("outputs", {}).items()
                if key in {"cache-hit", "cache-key", "python-cache-hit", "python-version", "uv-version"}
            }
            for name in ("uv", "pnpm-cache")
        },
    }
    args.output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
