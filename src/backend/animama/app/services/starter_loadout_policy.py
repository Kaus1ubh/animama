"""Immutable backend starter policy, resolved by the stored version."""

from __future__ import annotations

import hashlib
import json
from importlib.resources import files
from typing import Any, cast

from animama.domain.anima_loadout import REACTION_POOL_LIMIT, AnimaLoadoutError, reaction_cell_key


def starter_loadout_policy(version: int = 1) -> dict[str, Any]:
    """Return a fresh parsed policy, never a mutable global default for old Animas."""

    if type(version) is not int or version != 1:
        raise ValueError("Unsupported starter loadout version")
    return cast(
        dict[str, Any],
        json.loads(files("animama.resources").joinpath(f"starter-loadout.v{version}.json").read_text(encoding="utf-8")),
    )


def starter_reaction_pools(version: int = 1) -> dict[str, tuple[str, ...]]:
    """Return each cell's starter Reaction content IDs in policy order, keyed ``<emotion>-<intensity>``.

    The policy lists one ``reactions`` entry per pool member; a cell with no
    entry starts empty. Raises ``ValueError`` for an invalid cell, a Reaction
    repeated in one cell, or more than ``REACTION_POOL_LIMIT`` members.
    """

    pools: dict[str, list[str]] = {}
    for raw in starter_loadout_policy(version)["reactions"]:
        try:
            cell = reaction_cell_key(raw.get("emotion"), raw.get("intensity"))
        except AnimaLoadoutError as exc:
            raise ValueError(f"Invalid starter Reaction cell: {raw!r}") from exc
        content_id = str(raw["content_id"])
        members = pools.setdefault(cell, [])
        if content_id in members or len(members) >= REACTION_POOL_LIMIT:
            raise ValueError(f"Starter Reaction pool {cell} repeats a Reaction or exceeds {REACTION_POOL_LIMIT}")
        members.append(content_id)
    return {cell: tuple(members) for cell, members in pools.items()}


def starter_pack_identity(version: int = 1) -> dict[str, Any]:
    policy = starter_loadout_policy(version)
    encoded = json.dumps(policy, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return {"id": policy["id"], "version": policy["version"], "revision_sha256": hashlib.sha256(encoded).hexdigest()}
