"""Public package-set format, hashing and conservative compatibility policy.

This module knows nothing about private storage or Cloud implementation. The
manifest hash addresses the complete source/build/package/contract identity.
"""

from __future__ import annotations

import hashlib
import json
import re
import tarfile
import zipfile
from email.parser import Parser
from pathlib import Path

PACKAGES = {"animama-backend", "@animama/runtime-contracts", "@animama/product-ui", "@animama/discover-client"}
HEX40 = re.compile(r"[0-9a-f]{40}")
HEX64 = re.compile(r"[0-9a-f]{64}")
SEMVER = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")


def canonical(value) -> bytes:
    """Use one stable representation for all identities."""
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def regular(root: Path, name: str) -> Path:
    """Package-set members are flat ordinary files, never links or paths."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise ValueError("Artifact must have a plain filename")
    p = root / name
    if p.is_symlink() or not p.is_file() or p.resolve().parent != root.resolve():
        raise ValueError(f"Artifact must be a regular file: {name}")
    return p


def metadata(path: Path) -> dict:
    """Read identity and public declarations without executing package code."""
    if path.name.endswith(".whl"):
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if n.endswith(".dist-info/METADATA")]
            if len(names) != 1:
                raise ValueError("Expected one wheel metadata record")
            m = Parser().parsestr(z.read(names[0]).decode())
            return {"kind": "python", "name": m["Name"], "version": m["Version"]}
    with tarfile.open(path, "r:gz") as t:
        m = json.load(t.extractfile("package/package.json"))
        declarations = {
            n.name: sha(t.extractfile(n).read()) for n in t.getmembers() if n.isfile() and n.name.endswith(".d.ts")
        }
        if not declarations:
            raise ValueError("npm artifact has no declarations")
        return {
            "kind": "npm",
            "name": m["name"],
            "version": m["version"],
            "declarations_sha256": sha(canonical(declarations)),
        }


def file_record(root: Path, filename: str, **fields) -> dict:
    p = regular(root, filename)
    return {"file": filename, "sha256": sha(p.read_bytes()), "size": p.stat().st_size, **fields}


def verify(root: Path) -> dict:
    """Verify every file before validation/transfer. Reject incomplete manifests."""
    payload = regular(root, "manifest.json").read_bytes()
    m = json.loads(payload)
    if payload != canonical(m) or m.get("schema_version") != 1:
        raise ValueError("Noncanonical or unsupported package manifest")
    source = m["source"]
    if not HEX40.fullmatch(source["commit"]) or not HEX40.fullmatch(source["tree"]):
        raise ValueError("Source requires full immutable commit/tree pins")
    if not isinstance(source["dirty"], bool) or not HEX64.fullmatch(source["snapshot_sha256"]):
        raise ValueError("Missing source snapshot identity")
    if {p["name"] for p in m["packages"]} != PACKAGES or len(m["packages"]) != 4:
        raise ValueError("Expected one wheel and three public packages")
    if len(m["contracts"]) != 2 or {p["name"] for p in m["contracts"]} != {"runtime-owner", "local-http"}:
        raise ValueError("Missing public contract")
    records = m["packages"] + m["contracts"]
    if len({r["file"] for r in records}) != len(records):
        raise ValueError("Duplicate artifact filename")
    for r in records:
        if not SEMVER.fullmatch(r["version"]) or not HEX64.fullmatch(r["sha256"]):
            raise ValueError("Missing or invalid version/digest")
        data = regular(root, r["file"]).read_bytes()
        if sha(data) != r["sha256"] or len(data) != r["size"]:
            raise ValueError(f"SHA-256/size mismatch: {r['file']}")
        if r in m["packages"]:
            if any(r.get(k) != v for k, v in metadata(root / r["file"]).items()):
                raise ValueError("Package metadata mismatch")
    expected = "".join(f"{r['sha256']}  {r['file']}\n" for r in sorted(records, key=lambda r: r["file"]))
    if regular(root, "SHA256SUMS").read_text() != expected:
        raise ValueError("Checksum inventory mismatch")
    allowed = {r["file"] for r in records} | {"manifest.json", "SHA256SUMS", "validation.json"}
    if {p.name for p in root.iterdir()} - allowed:
        raise ValueError("Unexpected package-set files")
    return m


def identity(m: dict) -> str:
    scope = "dev" if m["source"]["dirty"] else "sets"
    return f"{scope}/v1/{m['source']['commit']}/{sha(canonical(m))}"


def semantic(value):
    """Ignore documentation-only schema edits for compatibility classification."""
    if isinstance(value, dict):
        return {k: semantic(v) for k, v in value.items() if k not in {"description", "title", "examples", "example"}}
    if isinstance(value, list):
        return [semantic(v) for v in value]
    return value


def compare(old_root: Path, new_root: Path) -> None:
    """Fail conservatively: structural schemas need a major; declarations a version bump.

    This intentionally treats some additive schema changes as major until an
    explicit compatibility rule is implemented. Descriptive changes are harmless.
    """
    old, new = verify(old_root), verify(new_root)
    for kind in ("packages", "contracts"):
        after = {r["name"]: r for r in new[kind]}
        for a in old[kind]:
            b = after[a["name"]]
            av, bv = tuple(map(int, a["version"].split("."))), tuple(map(int, b["version"].split(".")))
            if bv < av:
                raise ValueError(f"Contract version rollback: {a['name']}")
            if kind == "contracts":
                changed = semantic(json.loads((old_root / a["file"]).read_text())) != semantic(
                    json.loads((new_root / b["file"]).read_text())
                )
                if changed and bv[0] <= av[0]:
                    raise ValueError(f"Structural contract change requires major version: {a['name']}")
            elif a.get("declarations_sha256") != b.get("declarations_sha256") and bv <= av:
                raise ValueError(f"Changed declarations require package version bump: {a['name']}")
