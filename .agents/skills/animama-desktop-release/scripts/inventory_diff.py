"""Summarize how a staged license inventory differs from the last reviewed one.

The redistribution review is a human decision about the exact staged
`runtime/licenses/inventory.json`. This prints the facts that decision needs:
component, license and notice changes, staged content and model assets, file
license assignments, source locks and any other changed section. It reads two
inventories and writes Markdown to stdout; it approves nothing.

Usage: python3 -I inventory_diff.py <reviewed-inventory.json> <staged-inventory.json>
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

UNCLEAR_LICENSES = {None, "", "NOASSERTION", "UNKNOWN", "SEE-NOTICE"}
# Sections compared in detail below; any other top-level key is compared whole.
DETAILED = {"records", "source_assets", "files", "source_locks"}


def load(path: str) -> tuple[dict, str]:
    data = Path(path).read_bytes()
    return json.loads(data), hashlib.sha256(data).hexdigest()


def identity(record: dict) -> str:
    """Pair a versioned component across versions by its name."""
    return f"name:{record.get('name')}" if record.get("version") else record["id"]


def label(record: dict) -> str:
    version = f" {record['version']}" if record.get("version") else ""
    return f"`{record['id']}` ({record.get('name', '')}{version}, {record.get('license', '?')})"


def compare(a: dict, b: dict) -> list[str]:
    notes = []
    if a.get("version") != b.get("version"):
        notes.append(f"version {a.get('version')} → {b.get('version')}")
    if a.get("license") != b.get("license"):
        notes.append(f"license {a.get('license')} → {b.get('license')}")
    if a.get("notice_sha256") != b.get("notice_sha256"):
        notes.append("notices changed")
    other = sorted(
        key
        for key in set(a) | set(b)
        if key not in {"id", "version", "license", "notice_sha256", "notice_count"} and a.get(key) != b.get(key)
    )
    if other:
        notes.append(f"{', '.join(other)} changed")
    return notes


def diff_records(old: list[dict], new: list[dict]) -> tuple[list, list, list]:
    before = {r["id"]: r for r in old}
    after = {r["id"]: r for r in new}
    added, removed = set(after) - set(before), set(before) - set(after)
    changed = [(after[k], notes) for k in set(before) & set(after) if (notes := compare(before[k], after[k]))]
    # A component present once on each side under a new version is one change.
    for name in {identity(after[k]) for k in added} & {identity(before[k]) for k in removed}:
        new_ids = [k for k in added if identity(after[k]) == name]
        old_ids = [k for k in removed if identity(before[k]) == name]
        if len(new_ids) == len(old_ids) == 1:
            changed.append((after[new_ids[0]], compare(before[old_ids[0]], after[new_ids[0]])))
            added.discard(new_ids[0])
            removed.discard(old_ids[0])
    changed.sort(key=lambda item: item[0]["id"])
    return (
        [after[k] for k in sorted(added)],
        [before[k] for k in sorted(removed)],
        changed,
    )


def diff_paths(old: list[dict], new: list[dict], field: str) -> tuple[list, list, list]:
    before = {item["path"]: item.get(field) for item in old}
    after = {item["path"]: item.get(field) for item in new}
    return (
        sorted(set(after) - set(before)),
        sorted(set(before) - set(after)),
        sorted(p for p in set(before) & set(after) if before[p] != after[p]),
    )


def by_folder(paths: list[str]) -> str:
    counts = Counter("/".join(p.split("/")[:3]) for p in paths)
    return ", ".join(f"`{folder}` {n}" for folder, n in sorted(counts.items()))


def bullets(lines: list[str]) -> str:
    return "\n".join(f"- {line}" for line in lines) or "None."


def main(old_path: str, new_path: str) -> int:
    (old, old_sha), (new, new_sha) = load(old_path), load(new_path)
    print(f"Baseline inventory SHA-256: `{old_sha}`")
    print(f"Staged inventory SHA-256: `{new_sha}`\n")

    added, removed, changed = diff_records(old.get("records", []), new.get("records", []))
    unclear = [r for r in new.get("records", []) if r.get("license") in UNCLEAR_LICENSES]
    assets = diff_paths(old.get("source_assets", []), new.get("source_assets", []), "sha256")
    files = diff_paths(old.get("files", []), new.get("files", []), "license_refs")
    old_locks, new_locks = old.get("source_locks", {}), new.get("source_locks", {})
    locks = sorted(k for k in set(old_locks) | set(new_locks) if old_locks.get(k) != new_locks.get(k))
    sections = sorted(k for k in (set(old) | set(new)) - DETAILED if old.get(k) != new.get(k))

    print(f"## Components: {len(added)} added, {len(removed)} removed, {len(changed)} changed\n")
    print("### Added\n\n" + bullets([label(r) for r in added]) + "\n")
    print("### Removed\n\n" + bullets([label(r) for r in removed]) + "\n")
    print("### Changed\n\n" + bullets([f"{label(r)}: {', '.join(n)}" for r, n in changed]) + "\n")
    print(f"## Unclear licenses ({len(unclear)})\n\n" + bullets([label(r) for r in unclear]) + "\n")
    print("## Staged content and model assets\n")
    for title, paths in (("Added", assets[0]), ("Removed", assets[1]), ("Changed bytes", assets[2])):
        print(f"- {title}: {len(paths)}" + (f" ({by_folder(paths)})" if paths else ""))
    print("\n## File license assignments\n")
    for title, paths in (("Added", files[0]), ("Removed", files[1]), ("Changed license references", files[2])):
        print(f"- {title}: {len(paths)}" + (f" ({by_folder(paths)})" if paths else ""))
    print("\n## Source locks changed\n\n" + bullets([f"`{k}`" for k in locks]) + "\n")
    print("## Other changed sections\n\n" + bullets([f"`{k}`" for k in sections]) + "\n")

    reported = added or removed or changed or any(assets) or any(files) or locks or sections
    if old_sha != new_sha and not reported:
        print("**Warning:** the hashes differ but no compared section changed; inspect the raw JSON.\n")

    print("## Details\n")
    for title, paths in (("Added assets", assets[0]), ("Removed assets", assets[1]), ("Changed assets", assets[2])):
        print(f"### {title}\n\n" + bullets([f"`{p}`" for p in paths]) + "\n")
    print("### Changed file license references\n\n" + bullets([f"`{p}`" for p in files[2]]))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2]))
