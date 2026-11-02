"""Summarize how a staged license inventory differs from an earlier one.

The redistribution review is a human decision about the exact staged
`runtime/licenses/inventory.json`. This prints the facts that decision needs:
added, removed and re-versioned components, license and notice changes, and
source-lock changes. It reads two inventories and writes Markdown to stdout;
it approves nothing.

Usage: python3 -I inventory_diff.py <reviewed-inventory.json> <staged-inventory.json>
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


def load(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def identity(record_id: str) -> str:
    """Key a record by package identity, so a version bump is one change."""
    head, sep, _version = record_id.rpartition("@")
    # Scoped npm names start with "@"; only strip a trailing version.
    return head if sep and head and not head.endswith(":") else record_id


def records(inventory: dict) -> dict[str, dict]:
    return {r["id"]: r for r in inventory.get("records", [])}


def compare(a: dict, b: dict) -> list[str]:
    notes = []
    if a.get("version") != b.get("version"):
        notes.append(f"version {a.get('version')} → {b.get('version')}")
    if a.get("license") != b.get("license"):
        notes.append(f"license {a.get('license')} → {b.get('license')}")
    if a.get("notice_sha256") != b.get("notice_sha256"):
        notes.append("notices changed")
    if a.get("source") != b.get("source") and not notes:
        notes.append("source changed")
    return notes


def label(record: dict) -> str:
    version = f" {record['version']}" if record.get("version") else ""
    return f"`{record['id']}` ({record.get('name', '')}{version}, {record.get('license', '?')})"


def main(old_path: str, new_path: str) -> int:
    old, new = load(old_path), load(new_path)
    before, after = records(old), records(new)
    added = set(after) - set(before)
    removed = set(before) - set(after)
    changed = []
    for key in sorted(set(before) & set(after)):
        if notes := compare(before[key], after[key]):
            changed.append((after[key], notes))
    # A package present once on each side under a new version is one change.
    for name in {identity(k) for k in added} & {identity(k) for k in removed}:
        new_ids = [k for k in added if identity(k) == name]
        old_ids = [k for k in removed if identity(k) == name]
        if len(new_ids) == len(old_ids) == 1:
            changed.append((after[new_ids[0]], compare(before[old_ids[0]], after[new_ids[0]])))
            added.discard(new_ids[0])
            removed.discard(old_ids[0])
    added, removed = sorted(added), sorted(removed)
    changed.sort(key=lambda item: item[0]["id"])

    digest = hashlib.sha256(Path(new_path).read_bytes()).hexdigest()
    print(f"Staged inventory SHA-256: `{digest}`\n")
    print(f"Records: {len(before)} → {len(after)}\n")
    for title, keys, side in (("Added", added, after), ("Removed", removed, before)):
        print(f"## {title} ({len(keys)})\n")
        print("\n".join(f"- {label(side[k])}" for k in keys) or "None.")
        print()
    print(f"## Changed ({len(changed)})\n")
    print("\n".join(f"- {label(r)}: {', '.join(n)}" for r, n in changed) or "None.")
    print()
    unclear = [r for r in after.values() if r.get("license") in (None, "", "NOASSERTION", "UNKNOWN")]
    print(f"## Unclear licenses ({len(unclear)})\n")
    print("\n".join(f"- {label(r)}" for r in unclear) or "None.")
    print()
    locks = sorted(
        name
        for name in set(old.get("source_locks", {})) | set(new.get("source_locks", {}))
        if old.get("source_locks", {}).get(name) != new.get("source_locks", {}).get(name)
    )
    print(f"## Source locks changed ({len(locks)})\n")
    print("\n".join(f"- `{name}`" for name in locks) or "None.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2]))
