"""Close the existing Included starter/catalog resolver into non-static artifact bytes."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from application import closed, positive_int, read_json, safe_path
from package_set import HEX40, HEX64, canonical, matches, sha

SEED_MANIFEST = "catalog-seed/manifest.json"


def verify_catalog_seed(record, files, texts, source, tree=None):
    """Bind the entire seed separately from public browser resources."""
    closed(record, {"manifest", "sha256", "size"}, "catalog seed record")
    if (
        record["manifest"] != SEED_MANIFEST
        or not matches(HEX64, record["sha256"])
        or not positive_int(record["size"], 4 * 1024**2)
        or files.get(SEED_MANIFEST)
        != {
            "sha256": record["sha256"],
            "size": record["size"],
        }
    ):
        raise ValueError("Catalog seed manifest integrity mismatch")
    payload = texts[SEED_MANIFEST]
    seed = read_json(payload)
    closed(
        seed,
        {"schema_version", "artifact", "source_commit", "source_tree", "inventory", "files", "notices"},
        "catalog seed manifest",
    )
    if (
        payload != canonical(seed)
        or type(seed["schema_version"]) is not int
        or seed["schema_version"] != 1
        or seed["artifact"] != "animama-included-content"
        or seed["source_commit"] != source
        or not matches(HEX40, seed["source_tree"])
        or tree is not None
        and seed["source_tree"] != tree
    ):
        raise ValueError("Catalog seed source/schema mismatch")
    if not isinstance(seed["files"], list) or not 1 <= len(seed["files"]) <= 4096:
        raise ValueError("Invalid catalog seed inventory")
    names = set()
    for entry in seed["files"]:
        closed(entry, {"path", "sha256", "size_bytes"}, "catalog seed file")
        name = safe_path(entry["path"])
        if (
            not name.startswith(("included/", "notices/"))
            or name in names
            or not positive_int(entry["size_bytes"], 256 * 1024**2)
            or not isinstance(entry["sha256"], str)
            or not HEX64.fullmatch(entry["sha256"])
            or files.get("catalog-seed/" + name) != {"sha256": entry["sha256"], "size": entry["size_bytes"]}
        ):
            raise ValueError("Catalog seed file integrity mismatch")
        names.add(name)
    if (
        not isinstance(seed["notices"], list)
        or not seed["notices"]
        or any(not isinstance(name, str) for name in seed["notices"])
        or len(seed["notices"]) != len(set(seed["notices"]))
        or any(name not in names or not name.startswith("notices/") for name in seed["notices"])
    ):
        raise ValueError("Catalog seed notices missing")
    inventory = seed["inventory"]
    closed(inventory, {"id", "schema", "starter_pack", "starters", "entries", "files", "excluded"}, "starter inventory")
    expected_id = sha(
        json.dumps(
            {key: value for key, value in inventory.items() if key != "id"}, sort_keys=True, separators=(",", ":")
        ).encode()
    )
    if (
        inventory["schema"] != "animama-starter-content/1"
        or inventory["id"] != expected_id
        or not isinstance(inventory["starters"], list)
        or len(inventory["starters"]) != 2
        or any(not isinstance(starter, dict) or starter.get("diagnostics") for starter in inventory["starters"])
        or not isinstance(inventory["files"], list)
        or not 1 <= len(inventory["files"]) <= 4096
    ):
        raise ValueError("Incomplete or inconsistent starter inventory")
    resolved = set()
    for entry in inventory["files"]:
        if not isinstance(entry, dict) or not {"path", "sha256", "size_bytes", "license"} <= entry.keys():
            raise ValueError("Invalid starter inventory file")
        name = "included/" + safe_path(entry["path"])
        if (
            name in resolved
            or name not in names
            or files["catalog-seed/" + name]
            != {
                "sha256": entry["sha256"],
                "size": entry["size_bytes"],
            }
        ):
            raise ValueError("Starter inventory differs from seed bytes")
        if (
            not isinstance(entry["license"], dict)
            or not entry["license"].get("license_id")
            or not entry["license"].get("provenance")
        ):
            raise ValueError("Catalog seed has no per-file permission provenance")
        resolved.add(name)
    if {name for name in names if name.startswith("included/")} != resolved | {"included/licenses/inventory.json"}:
        raise ValueError("Unresolved Included seed file")
    return {SEED_MANIFEST} | {"catalog-seed/" + name for name in names}, seed


def prepare_seed(source: Path, output: Path, source_record: dict):
    """Reuse the public resolver on the exact tracked snapshot, never a private fixture."""
    from animama.runtime.starter_content import starter_inventory

    included = source / "content/included"
    allowed = {path.relative_to(included).as_posix() for path in included.rglob("*") if path.is_file()}
    inventory = starter_inventory(included, allowed_paths=allowed)
    paths = [("included/" + item["path"], included / item["path"]) for item in inventory["files"]]
    paths.append(("included/licenses/inventory.json", included / "licenses/inventory.json"))
    paths.extend(
        ("notices/" + path.relative_to(source / "licenses").as_posix(), path)
        for path in sorted((source / "licenses").rglob("*"))
        if path.is_file()
    )
    paths.append(("notices/LICENSE", source / "LICENSE"))
    output.mkdir(parents=True, exist_ok=False)
    files = []
    for name, path in paths:
        safe_path(name)
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(source.resolve()):
            raise ValueError("Catalog seed source must be regular snapshot bytes")
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        files.append({"path": name, "sha256": sha(destination.read_bytes()), "size_bytes": destination.stat().st_size})
    manifest = {
        "schema_version": 1,
        "artifact": "animama-included-content",
        "source_commit": source_record["commit"],
        "source_tree": source_record["tree"],
        "inventory": inventory,
        "files": sorted(files, key=lambda f: f["path"]),
        "notices": sorted(name for name, _ in paths if name.startswith("notices/")),
    }
    (output / "manifest.json").write_bytes(canonical(manifest))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-record", type=Path, required=True)
    args = parser.parse_args()
    prepare_seed(args.source, args.output, json.loads(args.source_record.read_bytes()))
