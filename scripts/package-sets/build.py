#!/usr/bin/env python3
"""Build an exact tracked source snapshot into an immutable local package set."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from application import APP, mime, safe_path, verify_application
from package_set import HEX40, canonical, compare, file_record, identity, metadata, sha, verify

TOOL_ROOT = Path(__file__).resolve().parents[2]


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def clean_env():
    """Build processes never inherit app, Cloud, R2 or GitHub credentials.

    They inherit the shared model store selection: ``ANIMAMA_MODEL_ROOT`` or the
    platform cache default (``XDG_CACHE_HOME``/``LOCALAPPDATA``) that
    ``scripts/models`` resolves without it. Each source snapshot then resolves
    the content-addressed browser speech set its own manifest names.
    ``ANIMAMA_BROWSER_MODEL_DIR`` names one resolved set, so it is not forwarded:
    a baseline must never build with a candidate's models.
    """
    allowed = {
        "PATH",
        "HOME",
        "TMPDIR",
        "UV_CACHE_DIR",
        "PLAYWRIGHT_BROWSERS_PATH",
        "SYSTEMROOT",
        "ANIMAMA_MODEL_ROOT",
        "XDG_CACHE_HOME",
        "LOCALAPPDATA",
    }
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


# Tracked links here are contributor agent configuration, not build inputs.
AGENT_TOOLING_PREFIXES = (".claude/",)


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
        if stage == "0" and mode == "120000" and name.startswith(AGENT_TOOLING_PREFIXES):
            # Contributor agent configuration links never feed a build; bind the
            # committed link target into the snapshot identity without following it.
            target = subprocess.check_output(["git", "-C", str(source), "cat-file", "blob", blob_oid])
            resolved = os.path.normpath(os.path.join(os.path.dirname(name), target.decode()))
            if target.startswith(b"/") or resolved == ".." or resolved.startswith("../"):
                raise ValueError("Source escapes checkout")
            rows.append({"path": name, "mode": mode, "sha256": sha(target)})
            continue
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


def builds_application(root):
    """Format-2 sources emit the whole hosted application; older ones are library-only."""
    return (root / "src/frontend/scripts/hosted-build-resources.mjs").is_file()


def models(source):
    """Acquire and verify a checkout's own browser speech set in the shared model store.

    This explicit step is the only one that may download models: ``build``
    stays offline and resolves the exact set its snapshot's manifest names. The
    checkout's own script runs, so a baseline gets the set that it pins.
    Library-only sources build no application and need none.
    """
    source = source.resolve()
    if not builds_application(source):
        print("Library-only source: no browser speech models are required", flush=True)
        return
    script = source / "scripts/models/browser_speech.py"
    for operation in ("acquire", "verify"):
        run([sys.executable, str(script), operation], source, clean_env())


def pack_application(built, stage, source, app_version, contracts, catalog_seed):
    """Close the complete emitted inventory and produce a deterministic regular-file tar."""
    build_record = json.loads((built / ".hosted-build.json").read_bytes())
    paths = []
    for path in sorted(built.rglob("*")):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise ValueError("Linked or special application output")
        if path.is_file() and path.name != ".hosted-build.json":
            name = safe_path(path.relative_to(built).as_posix())
            if not (name == "index.html" or name.startswith(build_record["resource_prefix"][1:])):
                raise ValueError("Unversioned application resource")
            paths.append((name, path))
    major_bounds = {
        record["name"]: {
            "min_major": int(record["version"].split(".")[0]),
            "max_major_exclusive": int(record["version"].split(".")[0]) + 1,
        }
        for record in contracts
    }
    seed_manifest = catalog_seed / "manifest.json"
    app_manifest = {
        "schema_version": 1,
        "source_commit": source["commit"],
        "app_version": app_version,
        "entry_document": "index.html",
        "backend_contracts": major_bounds,
        "files": [
            {
                "path": name,
                "sha256": sha(path.read_bytes()),
                "size": path.stat().st_size,
                "mime_type": mime(name),
                "cache": "revalidate" if name == "index.html" else "immutable",
                "range": path.suffix
                in {
                    ".wasm",
                    ".onnx",
                    ".model",
                    ".npy",
                    ".safetensors",
                    ".bin",
                    ".mp3",
                    ".ogg",
                    ".wav",
                    ".mp4",
                    ".webm",
                },
            }
            for name, path in paths
        ],
        "lazy_resources": build_record["lazy_resources"],
        "notices": build_record["notices"],
        "catalog_seed": {
            "manifest": "catalog-seed/manifest.json",
            "sha256": sha(seed_manifest.read_bytes()),
            "size": seed_manifest.stat().st_size,
        },
    }
    filename = f"{APP}-{app_version}.tar.gz"
    # Most bytes are model weights and media that barely compress. Level 1
    # packs the archive in seconds; level 9 took about 90 s for a file 8%
    # smaller, and a full run that rebuilds its baseline packs twice.
    with (
        (stage / filename).open("wb") as stream,
        gzip.GzipFile(
            filename="", mode="wb", fileobj=stream, mtime=source["source_date_epoch"], compresslevel=1
        ) as compressed,
    ):
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as tar:
            import io

            seed_paths = [
                ("catalog-seed/" + path.relative_to(catalog_seed).as_posix(), path)
                for path in sorted(catalog_seed.rglob("*"))
                if path.is_file()
            ]
            for name, path in paths + seed_paths + [("app-manifest.json", None)]:
                info = tarfile.TarInfo(APP + "/" + name)
                data = canonical(app_manifest) if path is None else None
                info.size = len(data) if path is None else path.stat().st_size
                info.mode, info.mtime = 0o644, source["source_date_epoch"]
                if path:
                    with path.open("rb") as payload:
                        tar.addfile(info, payload)
                else:
                    tar.addfile(info, io.BytesIO(data))
    verify_application(stage / filename, source["commit"], app_version, contracts, source_tree=source["tree"])
    return file_record(stage, filename, kind="application", name=APP, version=app_version)


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
        run(["uv", "sync", "--frozen", "--python", "3.12.13"], root, env)
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
        applications = []
        # Pre-format-2 baselines retain their original library-only format. Their
        # source is never silently patched with the current application's code.
        if builds_application(root):
            run(["pnpm", "web:build:hosted"], root / "src/frontend", env)
            seed_record = Path(temp) / "source-record.json"
            seed_record.write_bytes(canonical(source_record))
            seed_output = Path(temp) / "catalog-seed"
            run(
                [
                    str(root / ".venv/bin/python"),
                    str(root / "scripts/package-sets/catalog_seed.py"),
                    "--source",
                    str(root),
                    "--output",
                    str(seed_output),
                    "--source-record",
                    str(seed_record),
                ],
                root,
                env,
            )
            app_version = json.loads((root / "src/frontend/desktop/package.json").read_text())["version"]
            applications = [
                pack_application(
                    root / "src/frontend/web/dist-hosted", stage, source_record, app_version, contracts, seed_output
                )
            ]
        inputs = {n: sha((root / n).read_bytes()) for n in ["uv.lock", "src/frontend/pnpm-lock.yaml", "pyproject.toml"]}
        # The producer may package an older exact commit; its own reviewed recipe
        # and contract-policy bytes are separately fingerprinted, never implicit.
        recipe = {
            p.relative_to(TOOL_ROOT).as_posix(): sha(p.read_bytes())
            for p in [
                Path(__file__),
                Path(__file__).with_name("package_set.py"),
                Path(__file__).with_name("application.py"),
                Path(__file__).with_name("catalog_seed.py"),
                Path(__file__).with_name("build-constraints.txt"),
                TOOL_ROOT / "contracts/versions.json",
                TOOL_ROOT / "contracts/runtime-owner/schema.json",
            ]
        }
        manifest = {
            "schema_version": 2 if applications else 1,
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
        if applications:
            manifest["applications"] = applications
        (stage / "manifest.json").write_bytes(canonical(manifest))
        (stage / "SHA256SUMS").write_text(
            "".join(
                f"{r['sha256']}  {r['file']}\n"
                for r in sorted(packages + contracts + applications, key=lambda r: r["file"])
            )
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


def validate(directory, work, previous_app_set=None, offline=False, pnpm_store=None):
    """Record only checks actually run against the exact finished set."""
    m = verify(directory)
    checker = TOOL_ROOT / "scripts/repository-boundary/check-packed-artifacts.py"
    command = [sys.executable, str(checker), str(directory), "--work-dir", str(work)]
    if previous_app_set:
        command.extend(["--previous-app-set", str(previous_app_set)])
    if offline:
        command.append("--offline")
    if pnpm_store:
        command.extend(["--pnpm-store", str(pnpm_store)])
    run(command, TOOL_ROOT, clean_env())
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
        "consumer_summary_sha256": sha((work / "summary.json").read_bytes()),
        "validation_recipe_sha256": {
            p.relative_to(TOOL_ROOT).as_posix(): sha(p.read_bytes()) for p in [Path(__file__), checker]
        },
    }
    if m.get("applications"):
        summary = json.loads((work / "summary.json").read_bytes())
        receipt["checks"] += [
            "closed-whole-application-archive",
            "isolated-included-seed-consumer",
            "emitted-browser-worker-audio-avatar",
            "immutable-selection-browser-fixture",
        ]
        receipt["whole_application"] = summary["whole_application"]
        receipt["exact_clean_upgrade_rollback"] = summary["whole_application"]["exact_clean_upgrade_rollback"]
        receipt["unperformed"] = ["physical microphone/heard audio", "local production comparison"]
        if not receipt["exact_clean_upgrade_rollback"]:
            receipt["unperformed"].append("upgrade/rollback between two exact clean application source revisions")
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
    mo = sub.add_parser("models", help="acquire and verify a checkout's own browser speech set before build")
    mo.add_argument("--source", type=Path, required=True)
    v = sub.add_parser("validate")
    v.add_argument("directory", type=Path)
    v.add_argument("--work-dir", type=Path, required=True)
    v.add_argument("--previous-app-set", type=Path)
    v.add_argument("--offline", action="store_true")
    v.add_argument("--pnpm-store", type=Path)
    c = sub.add_parser("compare")
    c.add_argument("old", type=Path)
    c.add_argument("new", type=Path)
    a = p.parse_args()
    try:
        if a.command == "build":
            build(a.source, a.commit, a.output, a.allow_dirty)
        elif a.command == "models":
            models(a.source)
        elif a.command == "validate":
            print(json.dumps(validate(a.directory, a.work_dir, a.previous_app_set, a.offline, a.pnpm_store)))
        else:
            compare(a.old, a.new)
            print("Compatibility policy passed")
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as e:
        p.exit(1, f"Package set rejected: {e}\n")


if __name__ == "__main__":
    main()
