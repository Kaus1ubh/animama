"""Immutable backend starter policy, resolved by the stored version."""

from __future__ import annotations

import hashlib
import json
from importlib.resources import files
from typing import Any


def starter_loadout_policy(version: int = 1) -> dict[str, Any]:
    """Return a fresh parsed policy, never a mutable global default for old Animas."""

    if type(version) is not int or version != 1:
        raise ValueError("Unsupported starter loadout version")
    return json.loads(
        files("animama.resources").joinpath(f"starter-loadout.v{version}.json").read_text(encoding="utf-8")
    )


def starter_pack_identity(version: int = 1) -> dict[str, Any]:
    policy = starter_loadout_policy(version)
    encoded = json.dumps(policy, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return {"id": policy["id"], "version": policy["version"], "revision_sha256": hashlib.sha256(encoded).hexdigest()}
