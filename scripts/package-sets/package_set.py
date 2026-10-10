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


def matches(pattern, value):
    """Untrusted JSON scalars never reach regex operations as non-strings."""
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def canonical(value) -> bytes:
    """Use one stable representation for all identities."""
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha(path: Path) -> str:
    """Bound producer/consumer memory independently of the artifact size."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def regular(root: Path, name: str) -> Path:
    """Package-set members are flat ordinary files, never links or paths."""
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
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
    return {"file": filename, "sha256": file_sha(p), "size": p.stat().st_size, **fields}


def verify(root: Path) -> dict:
    """Verify every file before validation/transfer. Reject incomplete manifests."""
    payload = regular(root, "manifest.json").read_bytes()
    from application import closed, positive_int, read_json, safe_path, verify_application

    m = read_json(payload)
    schema_version = m.get("schema_version") if isinstance(m, dict) else None
    if payload != canonical(m) or type(schema_version) is not int or schema_version not in {1, 2}:
        raise ValueError("Noncanonical or unsupported package manifest")
    closed(
        m,
        {"schema_version", "source", "build", "packages", "contracts"}
        | ({"applications"} if schema_version == 2 else set()),
        "package manifest",
    )
    source = m["source"]
    closed(source, {"commit", "tree", "dirty", "snapshot_sha256", "source_date_epoch"}, "source")
    if not positive_int(source["source_date_epoch"], 2**63 - 1):
        raise ValueError("Invalid source date epoch")
    if not matches(HEX40, source["commit"]) or not matches(HEX40, source["tree"]):
        raise ValueError("Source requires full immutable commit/tree pins")
    if not isinstance(source["dirty"], bool) or not matches(HEX64, source["snapshot_sha256"]):
        raise ValueError("Missing source snapshot identity")
    build = m["build"]
    closed(build, {"inputs", "recipe", "python", "uv", "node", "pnpm"}, "build")
    closed(build["inputs"], {"uv.lock", "src/frontend/pnpm-lock.yaml", "pyproject.toml"}, "build inputs")
    if not isinstance(build["recipe"], dict) or not 1 <= len(build["recipe"]) <= 64:
        raise ValueError("Invalid build recipe inventory")
    for name, digest in {**build["inputs"], **build["recipe"]}.items():
        safe_path(name)
        if not isinstance(digest, str) or not HEX64.fullmatch(digest):
            raise ValueError("Invalid build input/recipe digest")
    if any(
        not isinstance(build[name], str) or not 1 <= len(build[name]) <= 100
        for name in ("python", "uv", "node", "pnpm")
    ):
        raise ValueError("Invalid build tooling version")
    if (
        not isinstance(m["packages"], list)
        or len(m["packages"]) != 4
        or any(not isinstance(p, dict) or not isinstance(p.get("name"), str) for p in m["packages"])
        or {p["name"] for p in m["packages"]} != PACKAGES
    ):
        raise ValueError("Expected one wheel and three public packages")
    if (
        not isinstance(m["contracts"], list)
        or len(m["contracts"]) != 2
        or any(not isinstance(p, dict) or not isinstance(p.get("name"), str) for p in m["contracts"])
        or {p["name"] for p in m["contracts"]} != {"runtime-owner", "local-http"}
    ):
        raise ValueError("Missing public contract")
    apps = m.get("applications", [])
    if schema_version == 2 and (
        not isinstance(apps, list)
        or len(apps) != 1
        or not isinstance(apps[0], dict)
        or apps[0].get("name") != "animama-hosted-web"
    ):
        raise ValueError("Expected exactly one hosted application")
    records = m["packages"] + m["contracts"] + apps
    if any(not isinstance(r.get("file"), str) for r in records) or len({r["file"] for r in records}) != len(records):
        raise ValueError("Duplicate artifact filename")
    for r in records:
        closed(
            r,
            {"file", "sha256", "size", "kind", "name", "version"}
            | ({"declarations_sha256"} if r.get("kind") == "npm" else set()),
            "artifact record",
        )
        if not positive_int(r["size"], 2 * 1024**3):
            raise ValueError("Invalid artifact size")
        if not matches(SEMVER, r["version"]) or not matches(HEX64, r["sha256"]):
            raise ValueError("Missing or invalid version/digest")
        path = regular(root, r["file"])
        if file_sha(path) != r["sha256"] or path.stat().st_size != r["size"]:
            raise ValueError(f"SHA-256/size mismatch: {r['file']}")
        if r in m["packages"]:
            if any(r.get(k) != v for k, v in metadata(root / r["file"]).items()):
                raise ValueError("Package metadata mismatch")
        elif r in apps:
            if r["kind"] != "application":
                raise ValueError("Invalid application kind")
            verify_application(
                root / r["file"], source["commit"], r["version"], m["contracts"], source_tree=source["tree"]
            )
        elif r["kind"] != "contract":
            raise ValueError("Invalid contract kind")
    expected = "".join(f"{r['sha256']}  {r['file']}\n" for r in sorted(records, key=lambda r: r["file"]))
    if regular(root, "SHA256SUMS").read_text() != expected:
        raise ValueError("Checksum inventory mismatch")
    allowed = {r["file"] for r in records} | {"manifest.json", "SHA256SUMS", "validation.json"}
    if {p.name for p in root.iterdir()} - allowed:
        raise ValueError("Unexpected package-set files")
    return m


def identity(m: dict) -> str:
    scope = "dev" if m["source"]["dirty"] else "sets"
    return f"{scope}/v{m['schema_version']}/{m['source']['commit']}/{sha(canonical(m))}"


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
    if old["schema_version"] > new["schema_version"]:
        raise ValueError("Package format downgrade cannot remove the whole application")
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
    if old.get("applications"):
        before, after = old["applications"][0], new["applications"][0]
        if tuple(map(int, after["version"].split("."))) < tuple(map(int, before["version"].split("."))):
            raise ValueError("Application version rollback")
