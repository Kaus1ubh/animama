"""Resolve both actual Included starters from artifact-only bytes in an installed wheel."""

import hashlib
import json
import sys
from pathlib import Path

from animama.runtime.starter_content import starter_inventory

root = Path(sys.argv[1]).resolve(strict=True)
manifest = json.loads((root / "manifest.json").read_bytes())
paths = {entry["path"] for entry in manifest["files"]}
actual = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
assert actual == paths | {"manifest.json"}
for entry in manifest["files"]:
    path = root / entry["path"]
    assert not path.is_symlink() and path.resolve().is_relative_to(root)
    data = path.read_bytes()
    assert len(data) == entry["size_bytes"] and hashlib.sha256(data).hexdigest() == entry["sha256"]
allowed = {name.removeprefix("included/") for name in paths if name.startswith("included/")}
resolved = starter_inventory(root / "included", allowed_paths=allowed)
assert resolved == manifest["inventory"]
assert len(resolved["starters"]) == 2 and all(not starter["diagnostics"] for starter in resolved["starters"])
assert {starter["id"] for starter in resolved["starters"]} == {"starter:annie", "starter:andrew"}
assert not [name for name in sys.modules if name.startswith(("animama.local", "animama.server"))]
print(
    json.dumps(
        {
            "result": "passed",
            "source_commit": manifest["source_commit"],
            "inventory_id": resolved["id"],
            "entries": len(resolved["entries"]),
            "included_files": len(resolved["files"]),
            "complete_starters": 2,
            "local_server_imports": 0,
        }
    )
)
