"""Copy only source-controlled, typed, exact starter/optional file closures.

Effect art ships as WebP derivatives of its tracked PNG masters (#655): the
tracked snapshot is converted into a scratch tree first, and every inventory and
copy below reads that tree.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from animama.app.services.typed_content_service import TypedContentAdmissionError
from animama.runtime.included_derivatives import convert_included_tree
from animama.runtime.starter_content import starter_inventory


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[4]
    included = repo / "content/included"
    tracked = (
        subprocess.check_output(["git", "ls-files", "-z", "--", "content/included"], cwd=repo).decode().split("\0")
    )
    tracked_paths = {path.removeprefix("content/included/") for path in tracked if path}
    with tempfile.TemporaryDirectory(prefix="animama-included-") as scratch:
        converted = Path(scratch) / "included"
        derivatives = convert_included_tree(included, converted, tracked_paths)
        renamed = {record["path"]: derived for derived, record in derivatives.items()}
        allowed = {renamed.get(path, path) for path in tracked_paths}
        stage(included, tracked_paths, converted, allowed, args.output)


def stage(included: Path, tracked: set[str], converted: Path, allowed: set[str], output: Path) -> None:
    """Resolve the starter closure in the converted tree and copy it into ``output``.

    ``tracked`` names the source files; ``allowed`` names them after conversion.
    """

    try:
        inventory = starter_inventory(converted, allowed_paths=allowed)
    except TypedContentAdmissionError as exc:
        output.mkdir(parents=True, exist_ok=True)
        # Diagnostic inspection does not copy ignored inputs into a runtime.
        # In a clean checkout the missing bytes may not exist even for inspection.
        blockers: dict[str, object] = {"code": exc.code, "item": exc.item_id}
        try:
            inspected = starter_inventory(included)
            blockers["required_untracked_files"] = [
                {key: item[key] for key in ("path", "size_bytes", "sha256")}
                for item in inspected["files"]
                if item["partition"] == "core" and item["path"] not in tracked
            ]
        except (TypedContentAdmissionError, ValueError, FileNotFoundError):
            blockers["inspection"] = "Incomplete source closure; supply approved inputs before staging"
        (output / "content-blockers.json").write_text(json.dumps(blockers, indent=2, sort_keys=True) + "\n")
        raise SystemExit(
            f"Required starter closure cannot be staged from tracked distribution inputs: {exc.code} "
            f"({exc.item_id}). Do not trim the starter or silently add ignored assets; "
            "resolve their source/licensing first."
        ) from exc
    roots = {
        "core": output / "runtime/content/included-core",
        "expanded": output / "pack-inputs/expanded-included-content",
    }
    for file in inventory["files"]:
        destination = roots[file["partition"]] / file["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(converted / file["path"], destination)
    for root in roots.values():
        (root / "licenses").mkdir(parents=True, exist_ok=True)
        # The converted copy records each derivative's master for licence lookup.
        shutil.copyfile(converted / "licenses/inventory.json", root / "licenses/inventory.json")
    # Re-resolve the actual staged core, not just the input selection.
    verified = starter_inventory(roots["core"])
    core_entries = {item["locator"] for item in inventory["entries"] if item["partition"] == "core"}
    if core_entries != {item["locator"] for item in verified["entries"]}:
        raise ValueError("Staged core differs from the resolved starter closure")
    (output / "starter-content-inventory.json").write_text(json.dumps(inventory, indent=2, sort_keys=True) + "\n")
    (roots["core"] / "inventory.json").write_text(json.dumps(verified, indent=2, sort_keys=True) + "\n")
    print(f"Starter core: {len(core_entries)} entries; both starter Animas: zero diagnostics")


if __name__ == "__main__":
    main()
