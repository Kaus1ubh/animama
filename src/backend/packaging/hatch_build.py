"""Reject stale shared catalog copies before producing distributable artifacts."""

import runpy
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    """Validate generated package resources against their single canonical source."""

    def initialize(self, version, build_data):  # noqa: ANN001
        root = Path(self.root)
        check = runpy.run_path(str(root / "src/backend/packaging/shared_catalogs.py"))["sync_catalogs"]
        check(root)
