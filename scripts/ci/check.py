#!/usr/bin/env python3
"""Time one existing check without hiding its output, exit status or command."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("id")
    parser.add_argument("--cwd", default=".")
    if "--" not in sys.argv:
        parser.error("Separate the check command with --")
    separator = sys.argv.index("--")
    args = parser.parse_args(sys.argv[1:separator])
    command = sys.argv[separator + 1 :]
    if not re.fullmatch(r"[a-z][a-z0-9-]*", args.id) or not command:
        parser.error("A fixed check id and a command are required")
    output = Path(os.environ.get("CI_RESULTS_DIR", str(Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "checks")))
    output.mkdir(parents=True, exist_ok=True)
    log = output / f"{args.id}.log"
    started = time.time()
    code = 1
    try:
        with log.open("wb") as target:
            with subprocess.Popen(command, cwd=args.cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as child:
                assert child.stdout is not None
                for data in iter(child.stdout.read1, b""):
                    target.write(data)
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                code = child.wait()
    finally:
        receipt = {
            "id": args.id,
            "command": command,
            "cwd": args.cwd,
            "started_at": started,
            "duration_seconds": round(time.time() - started, 3),
            "exit_code": code,
            "status": "passed" if code == 0 else "failed",
            "log_sha256": hashlib.sha256(log.read_bytes()).hexdigest() if log.exists() else None,
        }
        (output / f"{args.id}.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return code if code >= 0 else 128 - code


if __name__ == "__main__":
    raise SystemExit(main())
