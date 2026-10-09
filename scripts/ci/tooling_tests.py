#!/usr/bin/env python3
"""Run every CI and release tooling suite; a required suite that is empty fails.

Hosted full validation and the local full profile run this same file. The Node
suites are the emitted-application harness's own unit tests: they need only
Node, not installed packages or a browser.
"""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PYTHON_SUITES = ("scripts/package-sets", "scripts/public-release", "scripts/repository-boundary")
NODE_SUITES = ("scripts/repository-boundary/consumers/hosted-app",)


def python_suite(directory: str) -> None:
    """Discover and run one unittest directory, as its README documents."""
    suite = unittest.TestLoader().discover(str(ROOT / directory), pattern="test_*.py")
    count = suite.countTestCases()
    print(f"{directory}: collected {count} tests", flush=True)
    if count == 0:
        raise SystemExit(f"Required suite collected no tests: {directory}")
    if not unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(suite).wasSuccessful():
        raise SystemExit(1)


def node_suite(directory: str) -> None:
    """Run one directory's *.test.mjs files with Node's built-in test runner."""
    tests = sorted(path.relative_to(ROOT).as_posix() for path in (ROOT / directory).glob("*.test.mjs"))
    print(f"{directory}: collected {len(tests)} Node test files", flush=True)
    if not tests:
        raise SystemExit(f"Required suite collected no tests: {directory}")
    if subprocess.run(["node", "--test", *tests], cwd=ROOT, check=False).returncode:
        raise SystemExit(1)


def main() -> int:
    for directory in PYTHON_SUITES:
        python_suite(directory)
    for directory in NODE_SUITES:
        node_suite(directory)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
