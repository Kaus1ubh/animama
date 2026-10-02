"""Link fixtures for file-safety tests.

Symbolic links need Developer Mode or elevation on Windows. Junctions are
Windows directory links that need no privilege, so directory-link tests use
them there and always run.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest


def require_symlinks(directory: Path) -> None:
    """Skip the calling test when this account cannot create symbolic links."""

    probe = directory / ".symlink-probe"
    try:
        probe.symlink_to(directory, target_is_directory=True)
    except OSError:
        pytest.skip("this account cannot create symbolic links")
    probe.unlink()


def link_directory(link: Path, target: Path) -> None:
    """Make ``link`` a directory link to ``target``: a junction on Windows."""

    if sys.platform == "win32":
        import _winapi

        _winapi.CreateJunction(str(target), str(link))  # type: ignore[attr-defined]
    else:
        link.symlink_to(target, target_is_directory=True)
