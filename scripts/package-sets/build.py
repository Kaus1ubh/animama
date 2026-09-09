#!/usr/bin/env python3
"""Build an exact tracked source snapshot into an immutable local package set."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from package_set import HEX40, canonical, compare, file_record, identity, metadata, sha, verify

TOOL_ROOT = Path(__file__).resolve().parents[2]


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def clean_env():
    """Build processes never inherit app, Cloud, R2 or GitHub credentials."""
    allowed = {"PATH", "HOME", "TMPDIR", "UV_CACHE_DIR", "PLAYWRIGHT_BROWSERS_PATH", "SYSTEMROOT"}
    env = {k: v for k, v in os.environ.items() if k in allowed}
    env.update(
        UV_NO_CONFIG="1",
        NPM_CONFIG_USERCONFIG=os.devnull,
        UV_LINK_MODE="copy",
        PYTHONNOUSERSITE="1",
        PYTHONHASHSEED="0",
        TZ="UTC",
        CI="true",
    )
    return env


def snapshot(source, commit, destination, allow_dirty=False):
    """Copy tracked materialized bytes only; no ignored state or source links."""
    if not HEX40.fullmatch(commit) or git(source, "rev-parse", "HEAD") != commit:
        raise ValueError("Source HEAD must match full immutable commit")
    status = git(source, "status", "--porcelain", "--untracked-files=all")
    if status and not allow_dirty:
        raise ValueError("Dirty release source is forbidden")
    if allow_dirty and (os.environ.get("CI") or os.environ.get("ANIMAMA_RELEASE_BUILD")):
        raise ValueError("--allow-dirty is forbidden in CI/release builds")
    if status:
        print("WARNING: DIRTY DEVELOPMENT SNAPSHOT; NOT ELIGIBLE FOR CI OR R2 PROMOTION", flush=True)
    rows = []
    listing = subprocess.check_output(["git", "-C", str(source), "ls-files", "-s", "-z"]).decode().split("\0")
    for item in filter(None, listing):
        meta, name = item.split("\t", 1)
        mode, blob_oid, stage = meta.split()
        if stage != "0" or mode not in {"100644", "100755"}:
            raise ValueError(f"Unmerged, symlink or submodule source: {name}")
        p = source / name
        if not p.exists() and allow_dirty:
            continue
        if p.is_symlink() or not p.resolve().is_relative_to(source.resolve()):
            raise ValueError("Source escapes checkout")
        data = p.read_bytes()
        if data.startswith(b"version https://git-lfs.github.com/spec/v1\n"):
            raise ValueError(f"Unhydrated LFS input: {name}")
        if not status:
            actual_blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
            if actual_blob != blob_oid:
                pointer = subprocess.check_output(["git", "-C", str(source), "cat-file", "blob", blob_oid])
                expected_pointer = (
                    f"version https://git-lfs.github.com/spec/v1\noid sha256:{sha(data)}\nsize {len(data)}\n".encode()
                )
                if pointer != expected_pointer:
                    raise ValueError(f"Source bytes differ from exact Git commit: {name}")
        out = destination / name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        out.chmod(0o755 if mode == "100755" else 0o644)
        rows.append({"path": name, "mode": mode, "sha256": sha(data)})
    if (
        git(source, "rev-parse", "HEAD") != commit
        or git(source, "status", "--porcelain", "--untracked-files=all") != status
    ):
        raise ValueError("Source changed during snapshot")
    return {
        "commit": commit,
        "tree": git(source, "rev-parse", "HEAD^{tree}"),
        "dirty": bool(status),
        "snapshot_sha256": sha(canonical(rows)),
        "source_date_epoch": int(git(source, "show", "-s", "--format=%ct", commit)),
    }


def run(command, cwd, env):
    subprocess.run(command, cwd=cwd, env=env, check=True)


def build(source, commit, output, allow_dirty=False):
    source, output = source.resolve(), output.resolve()
    if output.is_relative_to(source) or output.exists():
        raise ValueError("Output must be a new directory outside the source checkout")
    with tempfile.TemporaryDirectory(prefix="animama-package-build-") as temp:
        root = Path(temp) / "source"
        root.mkdir()
        source_record = snapshot(source, commit, root, allow_dirty)
        env = clean_env()
        env["SOURCE_DATE_EPOCH"] = str(source_record["source_date_epoch"])
        stage = Path(temp) / "set"
        stage.mkdir()
        run(["uv", "sync", "--frozen", "--python", "3.12.13", "--extra", "server"], root, env)
        run(["pnpm", "install", "--frozen-lockfile", "--package-import-method=copy"], root / "src/frontend", env)
        run(
            [
                "uv",
                "build",
                "--wheel",
                "--build-constraints",
                str(TOOL_ROOT / "scripts/package-sets/build-constraints.txt"),
                "--out-dir",
                str(stage),
            ],
            root,
            env,
        )
        run(["pnpm", "packages:pack", "--destination", str(stage)], root / "src/frontend", env)
        run(
            [
                str(root / ".venv/bin/python"),
                "-m",
                "animama.server.export_openapi",
                "--output",
                str(stage / "openapi.json"),
            ],
            root,
            env,
        )
        versions = json.loads((root / "contracts/versions.json").read_text())["contracts"]
        shutil.copyfile(root / "contracts/runtime-owner/schema.json", stage / "runtime-owner.schema.json")
        contracts = [
            file_record(stage, r["file"], kind="contract", name=n, version=r["version"])
            for n, r in sorted(versions.items())
        ]
        packages = [
            file_record(stage, p.name, **metadata(p)) for p in sorted(stage.iterdir()) if p.suffix in {".whl", ".tgz"}
        ]
        inputs = {n: sha((root / n).read_bytes()) for n in ["uv.lock", "src/frontend/pnpm-lock.yaml", "pyproject.toml"]}
        # The producer may package an older exact commit; its own reviewed recipe
        # and contract-policy bytes are separately fingerprinted, never implicit.
        recipe = {
            p.relative_to(TOOL_ROOT).as_posix(): sha(p.read_bytes())
            for p in [
                Path(__file__),
                Path(__file__).with_name("package_set.py"),
                Path(__file__).with_name("build-constraints.txt"),
                TOOL_ROOT / "contracts/versions.json",
                TOOL_ROOT / "contracts/runtime-owner/schema.json",
            ]
        }
        manifest = {
            "schema_version": 1,
            "source": source_record,
            "build": {
                "inputs": inputs,
                "recipe": recipe,
                "python": "3.12.13",
                "uv": git_version("uv"),
                "node": git_version("node"),
                "pnpm": git_version("pnpm"),
            },
            "packages": packages,
            "contracts": contracts,
        }
        (stage / "manifest.json").write_bytes(canonical(manifest))
        (stage / "SHA256SUMS").write_text(
            "".join(f"{r['sha256']}  {r['file']}\n" for r in sorted(packages + contracts, key=lambda r: r["file"]))
        )
        # uv creates a distribution-directory ignore marker; it is not an artifact.
        marker = stage / ".gitignore"
        if marker.exists():
            if marker.read_text().strip() != "*":
                raise ValueError("Unexpected distribution ignore marker")
            marker.unlink()
        verify(stage)
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(stage, output)
    print(identity(manifest), flush=True)
    return manifest


def git_version(command):
    return subprocess.check_output([command, "--version"], text=True).strip()


def validate(directory, work):
    """Record only checks actually run against the exact finished set."""
    m = verify(directory)
    checker = TOOL_ROOT / "scripts/repository-boundary/check-packed-artifacts.py"
    run([sys.executable, str(checker), str(directory), "--work-dir", str(work)], TOOL_ROOT, clean_env())
    # These actual schema fixtures run independently of any private implementation.
    owner = json.loads((directory / "runtime-owner.schema.json").read_text())
    if owner["required"] != ["id"] or owner["properties"]["id"]["type"] != "string":
        raise ValueError("RuntimeOwner fixture contract changed")
    schema = json.loads((directory / "openapi.json").read_text())
    if "/v1/chats" not in schema["paths"]:
        raise ValueError("OpenAPI fixture missing chats API")
    receipt = {
        "schema_version": 1,
        "manifest_sha256": sha(canonical(m)),
        "checks": [
            "isolated-python-consumer",
            "isolated-npm-consumer",
            "browser-product-fixtures",
            "contract-fixtures",
        ],
        "passed": True,
    }
    (directory / "validation.json").write_bytes(canonical(receipt))
    return receipt


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build")
    b.add_argument("--source", type=Path, required=True)
    b.add_argument("--commit", required=True)
    b.add_argument("--output", type=Path, required=True)
    b.add_argument("--allow-dirty", action="store_true")
    v = sub.add_parser("validate")
    v.add_argument("directory", type=Path)
    v.add_argument("--work-dir", type=Path, required=True)
    c = sub.add_parser("compare")
    c.add_argument("old", type=Path)
    c.add_argument("new", type=Path)
    a = p.parse_args()
    try:
        if a.command == "build":
            build(a.source, a.commit, a.output, a.allow_dirty)
        elif a.command == "validate":
            print(json.dumps(validate(a.directory, a.work_dir)))
        else:
            compare(a.old, a.new)
            print("Compatibility policy passed")
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as e:
        p.exit(1, f"Package set rejected: {e}\n")


if __name__ == "__main__":
    main()
