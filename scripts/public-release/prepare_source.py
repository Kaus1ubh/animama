#!/usr/bin/env python3
"""Freeze and verify a history-free, explicitly unapproved source review candidate.

Python 3.11+ is required. Only classified, hash-bound files are copied; Git,
ignored directories and private planning are never recursively exported.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

import tomllib

SCHEMA = "animama-source-preparation/1"
GENERATED = {"SOURCE_CANDIDATE.json", "CONTRIBUTING.md"}


def encode(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_file(root: Path, relative: str) -> Path:
    """Reject traversal, symlinks and private state even in an edited inventory."""
    path = PurePosixPath(relative)
    if (
        not relative
        or path.is_absolute()
        or str(path) != relative
        or "\\" in relative
        or any(c in relative for c in "\x00\n\r")
        or any(part in {"..", ".git", "node_modules", ".venv", ".codex", "plans"} for part in path.parts)
        or path.parts[0] in {"data", "cache", "backups", ".animama", ".animama-stacks"}
        or (path.name.startswith(".env") and path.name != ".env.example")
        or path.name == "PLANS.md"
        or (relative.startswith("content/local/") and relative != "content/local/README.md")
    ):
        raise ValueError(f"Forbidden candidate path: {relative!r}")
    current = root
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"Symlink is not a candidate input: {relative}")
    if not current.is_file():
        raise ValueError(f"Missing ordinary file: {relative}")
    with current.open("rb") as stream:
        if stream.read(44).startswith(b"version https://git-lfs.github.com/spec/v1"):
            raise ValueError(f"Hydrate the LFS input before inventory: {relative}")
    return current


def record(path: Path) -> dict:
    return {
        "sha256": sha256(path),
        "size": path.stat().st_size,
        "mode": "100755" if path.stat().st_mode & stat.S_IXUSR else "100644",
    }


def inventory(source: Path) -> dict:
    """Freeze the reviewed ownership list, not all files present on disk."""
    boundary = tomllib.loads((source / "repository-boundary.toml").read_text())
    paths = []
    for group in boundary["groups"]:
        if group["owner"] != "public":
            raise ValueError("Source preparation requires a public-only ownership inventory")
        paths.extend(group["paths"])
    if len(paths) != len(set(paths)) or GENERATED.intersection(paths):
        raise ValueError("Duplicate or reserved generated path in ownership inventory")
    files = {path: record(safe_file(source, path)) for path in sorted(paths)}
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    return {
        "schema": SCHEMA,
        "purpose": "private-preparation-only",
        "source_base_commit": commit,
        "files": files,
        "release_approved": False,
    }


def write_exclusive(path: Path, value: object) -> None:
    with path.open("xb") as stream:
        stream.write(encode(value))


def assert_outside(source: Path, path: Path) -> None:
    if path == source or source in path.parents or path in source.parents:
        raise ValueError("Output must be outside and disjoint from the source checkout")


def validate_inventory(source: Path, review: dict) -> None:
    if review.get("schema") != SCHEMA or review.get("purpose") != "private-preparation-only":
        raise ValueError("Unsupported preparation inventory")
    if review.get("release_approved") is not False:
        raise ValueError("This tool never produces a release-approved candidate")
    current = inventory(source)
    if review != current:
        raise ValueError("Source changed since inventory; review and freeze a new inventory")


def transform(candidate: Path, review_hash: str, base_commit: str) -> list[str]:
    """Apply the owner's license election only to the isolated review copy."""
    changed = []

    def write(relative: str, payload: bytes) -> None:
        (candidate / relative).write_bytes(payload)
        changed.append(relative)

    source_review = json.loads((candidate / "licenses/source-review.json").read_text())
    if source_review.get("schema") != "animama-source-license-review/1":
        raise ValueError("A prepared per-file source-license review is required")
    inputs = {path.relative_to(candidate).as_posix() for path in candidate.rglob("*") if path.is_file()}
    mapped = [item["path"] for item in source_review["files"]]
    if len(mapped) != len(set(mapped)) or set(mapped) != inputs:
        raise ValueError("Source-license review does not cover the exact input file set")
    for relative in sorted(GENERATED):
        source_review["files"].append(
            {
                "path": relative,
                "candidate_license": "AGPL-3.0-only",
                "basis": "Original candidate documentation; Raymond Van",
                "review": "prepared-not-release-approved",
            }
        )
    write("licenses/source-review.json", encode(source_review))
    write("LICENSE", (candidate / "scripts/public-release/templates/AGPL-3.0-only.txt").read_bytes())
    readme = (candidate / "README.md").read_text()
    marker = "## Copyright and licensing\n"
    if readme.count(marker) != 1:
        raise ValueError("Review the changed README license section before transforming")
    readme = (
        readme.split(marker)[0]
        + marker
        + """
Copyright (c) 2026 Raymond Van.

Project-owned source in this review candidate is licensed AGPL-3.0-only; see
[LICENSE](LICENSE). Third-party assets and code retain their separately recorded
terms in [the source review inventory](licenses/source-review.json). In particular,
the retained PocketTTS assets carry noncommercial restrictions; those restrictions
do not relicense original Animama code or unrelated dependencies.

This is an unpublished preparation candidate, not a verified public release.
See [SOURCE_CANDIDATE.json](SOURCE_CANDIDATE.json) for outstanding release gates.
"""
    )
    write("README.md", readme.encode())
    project = (candidate / "pyproject.toml").read_text()
    if project.count('license = "LicenseRef-Proprietary"') != 1:
        raise ValueError("Unexpected Python license declaration; review before transforming")
    write("pyproject.toml", project.replace('license = "LicenseRef-Proprietary"', 'license = "AGPL-3.0-only"').encode())
    for path in sorted(candidate.rglob("package.json")):
        data = json.loads(path.read_text())
        if data.get("license") == "UNLICENSED":
            data["license"] = "AGPL-3.0-only"
            write(path.relative_to(candidate).as_posix(), encode(data))
    resource = "src/frontend/desktop/runtime/license-sources.json"
    data = json.loads((candidate / resource).read_text())
    own = next(group for group in data["groups"] if group["id"] == "animama")
    own.update(
        license="AGPL-3.0-only",
        source="Original Animama source; see root LICENSE. Third-party exceptions retain their own terms.",
    )
    write(resource, encode(data))
    builder = "src/frontend/desktop/electron-builder.yml"
    text = (candidate / builder).read_text()
    write(
        builder,
        text.replace(
            "Copyright (c) 2026 Raymond Van. All rights reserved.",
            "Copyright (c) 2026 Raymond Van. AGPL-3.0-only; third-party terms apply.",
        ).encode(),
    )
    write(
        "CONTRIBUTING.md",
        b"# Contributing\n\nOutside code contributions are not being accepted initially. This policy does\n"
        b"not restrict rights granted by the source license. Revisit contribution workflow\n"
        b"before accepting external patches. See SECURITY.md for current reporting limits.\n",
    )
    write(
        "SOURCE_CANDIDATE.json",
        encode(
            {
                "schema": SCHEMA,
                "status": "preparation-only-not-release-approved",
                "source_base_commit": base_commit,
                "input_inventory_sha256": review_hash,
                "project_license": "AGPL-3.0-only",
                "copyright_holder": "Raymond Van",
                "history_included": False,
                "release_approved": False,
                "pending": [
                    "Owner review of terms and exact candidate",
                    "User-supplied Mixamo conversion, installation and starter verification",
                    "Monitored private security-reporting route",
                    "Additional planned codebase refinement phases",
                    "Final independent source, dependency, secret and native release acceptance",
                ],
            }
        ),
    )
    # The exported current-file inventory remains useful without private history.
    boundary = candidate / "repository-boundary.toml"
    text = (
        boundary.read_text()
        + '\n[[groups]]\nid = "source-candidate-generated"\nowner = "public"\n'
        + 'rationale = "Candidate-only license and readiness documents."\n'
        + 'paths = ["CONTRIBUTING.md", "SOURCE_CANDIDATE.json"]\n'
    )
    write("repository-boundary.toml", text.encode())
    provenance = "docs/architecture/repository-provenance.json"
    data = json.loads((candidate / provenance).read_text())
    data.pop("local_amendments", None)
    for item in data["files"]:
        if item["path"] in changed:
            payload = (candidate / item["path"]).read_bytes()
            if "lfs_oid" in item:
                raise ValueError("Candidate transformations must not rewrite LFS assets")
            item["sha256"] = hashlib.sha256(payload).hexdigest()
            item["git_blob_oid"] = hashlib.sha1(b"blob " + str(len(payload)).encode() + b"\0" + payload).hexdigest()
    for evidence in data["evidence"]:
        evidence["path_sha256"] = {path: sha256(candidate / path) for path in evidence["path_sha256"]}
    write(provenance, encode(data))
    return sorted(changed)


def prepare(source: Path, review_path: Path, output: Path, receipt: Path) -> dict:
    source = source.resolve()
    output = output.absolute()
    receipt = receipt.absolute()
    assert_outside(source, output.resolve())
    assert_outside(source, receipt.resolve())
    if output.exists() or output.is_symlink() or receipt.exists() or receipt.is_symlink():
        raise ValueError("Candidate and receipt paths must not already exist")
    if output == receipt or output in receipt.parents or receipt in output.parents:
        raise ValueError("Receipt must be outside the candidate")
    review_bytes = review_path.read_bytes()
    review = json.loads(review_bytes)
    validate_inventory(source, review)
    # Prepare privately beside the destination; rename only after all checks pass.
    temporary = Path(tempfile.mkdtemp(prefix=".animama-source-", dir=output.parent))
    try:
        for relative, expected in review["files"].items():
            origin = safe_file(source, relative)
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(origin, target)
            target.chmod(0o755 if expected["mode"] == "100755" else 0o644)
            if record(target) != expected:
                raise ValueError(f"Source changed while copying: {relative}")
        transformations = transform(temporary, hashlib.sha256(review_bytes).hexdigest(), review["source_base_commit"])
        output_files = {
            path.relative_to(temporary).as_posix(): record(path)
            for path in sorted(temporary.rglob("*"))
            if path.is_file()
        }
        result = {
            "schema": SCHEMA,
            "release_approved": False,
            "input_inventory_sha256": hashlib.sha256(review_bytes).hexdigest(),
            "source_base_commit": review["source_base_commit"],
            "transformed_paths": transformations,
            "files": output_files,
            "tree_sha256": hashlib.sha256(encode(output_files)).hexdigest(),
        }
        write_exclusive(receipt, result)
        os.rename(temporary, output)
        return result
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def verify(output: Path, receipt: dict) -> None:
    if receipt.get("schema") != SCHEMA or receipt.get("release_approved") is not False:
        raise ValueError("Unsupported candidate receipt")
    paths = list(output.rglob("*"))
    if any(path.is_symlink() for path in paths):
        raise ValueError("Candidate contains a symlink")
    actual = {
        path.relative_to(output).as_posix(): record(safe_file(output, path.relative_to(output).as_posix()))
        for path in sorted(paths)
        if not path.is_dir()
    }
    if actual != receipt["files"] or hashlib.sha256(encode(actual)).hexdigest() != receipt["tree_sha256"]:
        raise ValueError("Candidate file inventory, modes or bytes differ from its receipt")
    if any(path.name == ".git" for path in paths):
        raise ValueError("Candidate must not contain Git history or metadata")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    inv = sub.add_parser("inventory")
    inv.add_argument("--source", type=Path, required=True)
    inv.add_argument("--out", type=Path, required=True)
    create = sub.add_parser("prepare")
    create.add_argument("--source", type=Path, required=True)
    create.add_argument("--inventory", type=Path, required=True)
    create.add_argument("--out", type=Path, required=True)
    create.add_argument("--receipt", type=Path, required=True)
    check = sub.add_parser("verify")
    check.add_argument("--candidate", type=Path, required=True)
    check.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "inventory":
            assert_outside(args.source.resolve(), args.out.resolve())
            write_exclusive(args.out, inventory(args.source.resolve()))
            print("Frozen classified source inputs. Review before preparing a candidate.")
        elif args.command == "prepare":
            result = prepare(args.source, args.inventory, args.out, args.receipt)
            print(f"Prepared private candidate: {len(result['files'])} files, tree {result['tree_sha256']}")
        else:
            verify(args.candidate, json.loads(args.receipt.read_text()))
            print("Exact candidate matches its preparation receipt. Release approval is still required.")
    except (ValueError, OSError, KeyError, StopIteration) as error:
        parser.exit(1, f"Source preparation failed: {error}\n")


if __name__ == "__main__":
    main()
