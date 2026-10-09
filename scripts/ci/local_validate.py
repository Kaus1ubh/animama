#!/usr/bin/env python3
"""Run expensive pre-push checks in a fresh exact-source local Linux container.

Receipts describe owner-reviewable local evidence, not independent CI attestation.
Only tracked files and locally cached, hash-verified LFS objects enter the clone.
No application credentials, existing environments, or package outputs are copied.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from local_receipt import canonical_receipt_digest, receipt_comment_body

ROOT = Path(__file__).resolve().parents[2]
HEX40 = re.compile(r"[0-9a-f]{40}")
VERSIONS = {"python": "3.12.13", "node": "24.15.0", "pnpm": "10.33.0", "uv": "0.11.28"}


def capture(command: list[str], cwd: Path) -> str:
    """Read small command results; never log the caller's environment."""
    return subprocess.check_output(command, cwd=cwd, text=True).strip()


def git(source: Path, *args: str) -> str:
    return capture(["git", *args], source)


def prepare_output(output: Path, source: Path) -> None:
    """Refuse reuse, symlinks and output inside any candidate source checkout."""
    if output.is_symlink() or output.resolve().is_relative_to(source.resolve()):
        raise ValueError("Output must be an empty external directory, not a symlink or source child")
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("Output directory must be empty; use a new directory for every attempt")


def exact_commit(source: Path, commit: str) -> str:
    """Only full existing commit identities are accepted, never moving refs."""
    if not HEX40.fullmatch(commit) or git(source, "rev-parse", f"{commit}^{{commit}}") != commit:
        raise ValueError("Commit and baseline must be full existing commit SHA values")
    return commit


def clone_exact(source: Path, commit: str, destination: Path) -> None:
    """Make independent Git storage, then hydrate only referenced local LFS data."""
    env = os.environ | {"GIT_LFS_SKIP_SMUDGE": "1"}
    subprocess.run(
        ["git", "clone", "--no-hardlinks", "--no-checkout", str(source), str(destination)],
        env=env,
        check=True,
    )
    subprocess.run(["git", "checkout", "--detach", commit], cwd=destination, env=env, check=True)
    # The clone owns its .git, avoiding worktree metadata or host-path dependencies
    # inside Docker. It cannot fetch private inputs or credentials from the origin.
    subprocess.run(["git", "remote", "remove", "origin"], cwd=destination, check=True)
    media = next(
        line.removeprefix("LocalMediaDir=")
        for line in git(source, "lfs", "env").splitlines()
        if line.startswith("LocalMediaDir=")
    )
    for record in git(destination, "lfs", "ls-files", "--long").splitlines():
        oid = record.split(" ", 1)[0]
        if not re.fullmatch(r"[0-9a-f]{64}", oid):
            raise ValueError("Malformed LFS object identity")
        original = Path(media) / oid[:2] / oid[2:4] / oid
        if not original.is_file() or hashlib.sha256(original.read_bytes()).hexdigest() != oid:
            raise ValueError(f"Missing or corrupt local LFS object {oid}; fetch it explicitly before retrying")
        target = destination / ".git/lfs/objects" / oid[:2] / oid[2:4] / oid
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
    subprocess.run(["git", "lfs", "checkout"], cwd=destination, check=True)
    subprocess.run(["git", "lfs", "fsck"], cwd=destination, check=True)
    if git(destination, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Exact source clone unexpectedly contains changes")


def commands(profile: str, source: Path, output: Path, commit: str, baseline: str) -> list[tuple[str, Path, list[str]]]:
    """Keep independent packaging and baseline builds outside prepared source outputs."""
    package = ["uv", "run", "--no-sync", "python", "scripts/package-sets/build.py"]
    checks = []
    if profile in {"backend", "full"}:
        checks.append(("backend-full", source, ["make", "check-test"]))
    if profile in {"web", "full"}:
        checks += [
            (
                "frontend-source",
                source / "src/frontend",
                [
                    "pnpm",
                    "ci:source",
                    "--receipt",
                    str(output / "frontend-source.json"),
                ],
            ),
            (
                "browser-smoke",
                source,
                [
                    "uv",
                    "run",
                    "--no-sync",
                    "python",
                    "src/frontend/scripts/e2e/run-accountless-smoke.py",
                    "--pg-bin",
                    "/usr/lib/postgresql/16/bin",
                    "--evidence",
                    str(output / "browser-smoke"),
                ],
            ),
        ]
    if profile == "full":
        checks += [
            (
                "package-build",
                source,
                package
                + [
                    "build",
                    "--source",
                    str(source),
                    "--commit",
                    commit,
                    "--output",
                    str(output / "packages"),
                ],
            ),
            (
                "isolated-consumers",
                source,
                package
                + [
                    "validate",
                    str(output / "packages"),
                    "--work-dir",
                    str(output / "consumers"),
                ],
            ),
            (
                "release-completed-environments",
                source,
                [
                    sys.executable,
                    "-c",
                    "import shutil,sys; from pathlib import Path; "
                    "[(shutil.rmtree(path),print('Removed completed environment:',path)) "
                    "for path in map(Path,sys.argv[1:]) if path.is_dir()]",
                    str(source / "src/frontend/node_modules"),
                    str(output / "consumers/frontend/node_modules"),
                    str(output / "consumers/backend/.venv"),
                ],
            ),
            # The baseline builds with the speech set its own manifest pins,
            # acquired into the same isolated store as the candidate's.
            ("baseline-models", source, package + ["models", "--source", str(output / "baseline")]),
            (
                "baseline-build",
                source,
                package
                + [
                    "build",
                    "--source",
                    str(output / "baseline"),
                    "--commit",
                    baseline,
                    "--output",
                    str(output / "baseline-packages"),
                ],
            ),
            (
                "compatibility",
                source,
                package
                + [
                    "compare",
                    str(output / "baseline-packages"),
                    str(output / "packages"),
                ],
            ),
        ]
    checks.append(
        (
            "source-integrity",
            source,
            [
                sys.executable,
                "-c",
                "import subprocess; result=subprocess.check_output("
                "['git','status','--porcelain','--untracked-files=all'],text=True); "
                "print(result); raise SystemExit(bool(result))",
            ],
        )
    )
    return checks


def run_check(identifier: str, cwd: Path, command: list[str], output: Path, timeout: int = 3600) -> dict:
    """Persist each command's result and duration; failures cannot become receipts of success."""
    log = output / "logs" / f"{identifier}.log"
    log.parent.mkdir(exist_ok=True)
    started = time.monotonic()
    command = ["env", "--chdir", str(cwd), *command]
    print(f"{identifier}: {shlex.join(command)}", flush=True)
    error = None
    with log.open("wb") as stream:
        process = subprocess.Popen(command, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as exc:
            error = str(exc)
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=10)
            code = 124
    result = {
        "id": identifier,
        "status": "passed" if code == 0 else "failed",
        "command": command,
        "duration_seconds": round(time.monotonic() - started, 3),
        "log_sha256": hashlib.sha256(log.read_bytes()).hexdigest(),
    }
    if error:
        print(error, file=sys.stderr)
    print(f"{identifier}: {result['status']} ({result['duration_seconds']} seconds)", flush=True)
    return result


def worker(args: argparse.Namespace) -> int:
    """Run within the pinned image using the candidate's own checked-in recipe."""
    if platform.system() != "Linux" or not Path("/.dockerenv").exists():
        raise ValueError("Worker requires the isolated local Linux container")
    source, output = args.output / "source", args.output
    actual = {
        "python": platform.python_version(),
        "node": capture(["node", "--version"], source).removeprefix("v"),
        "pnpm": capture(["pnpm", "--version"], source),
        "uv": capture(["uv", "--version"], source).split()[1],
    }
    if actual != VERSIONS or git(source, "rev-parse", "HEAD") != args.commit:
        raise ValueError("Toolchain or exact source differs from the required local contract")
    receipt = {
        "schema_version": 1,
        "policy": "local-first-v1",
        "source_commit": args.commit,
        "source_tree": git(source, "rev-parse", "HEAD^{tree}"),
        "baseline": args.baseline,
        "completed_at": None,
        "environment": {"os": "Linux", "architecture": platform.machine(), **actual, "isolated": True, "frozen": True},
        "checks": [],
        "limitations": [
            "Owner-reviewed local evidence; GitHub has not independently rerun these checks.",
            "Local Debian Linux uses a host bind mount; Ubuntu CI OS and filesystem behavior may differ.",
            "Docker architecture is recorded; native macOS and Windows desktop acceptance is not performed.",
            "Browser smoke uses redistributable synthetic content and does not prove real starter animations.",
            "Paid provider calls, signing and release publication are not performed.",
        ],
    }
    if args.profile != "full":
        omitted = {
            "backend": "frontend source, rendered browser smoke, packaging, isolated consumers and compatibility",
            "web": "backend suite, independent packaging, isolated consumers and compatibility",
        }
        receipt["limitations"].append(f"Not run by {args.profile} profile: {omitted[args.profile]}.")
    planned = [
        ("frozen-python-install", source, ["uv", "sync", "--frozen", "--python", "3.12.13", "--extra", "server"])
    ]
    if args.profile in {"web", "full"}:
        # Keep downloaded, manifest-verified inputs outside the exact source.
        # The browser smoke forwards this root into its isolated child servers.
        os.environ["ANIMAMA_MODEL_ROOT"] = str(output / "models")
        planned += [
            (
                f"{model}-{operation}",
                source,
                [sys.executable, f"scripts/models/{model}.py", operation, "--root", str(output / "models")],
            )
            for model in ("parakeet", "browser_speech")
            for operation in ("acquire", "verify")
        ]
        planned += [
            ("frozen-frontend-install", source / "src/frontend", ["pnpm", "install", "--frozen-lockfile"]),
            ("browser-install", source / "src/frontend", ["pnpm", "exec", "playwright", "install", "chromium"]),
        ]
    planned += commands(args.profile, source, output, args.commit, args.baseline)
    path = output / "local-validation.json"
    code = 0
    for identifier, cwd, command in planned:
        result = run_check(identifier, cwd, command, output)
        receipt["checks"].append(result)
        if result["status"] != "passed":
            code = 1
        receipt["completed_at"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        (output / "progress.json").write_text(json.dumps(receipt, indent=2) + "\n")
        if code:
            break
    path.write_text(json.dumps(receipt, indent=2) + "\n")
    if code == 0:
        (output / "receipt-comment.md").write_text(receipt_comment_body(receipt) + "\n")
        (output / "receipt-sha256.txt").write_text(canonical_receipt_digest(receipt) + "\n")
    return code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--profile", required=True, choices=("backend", "web", "full"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    args.output = args.output.absolute()
    if args.worker:
        return worker(args)
    if os.getuid() == 0:
        raise ValueError("Run as a non-root local user so isolated PostgreSQL can own its data")
    socket = Path("/var/run/docker.sock")
    if not socket.is_socket():
        raise ValueError("Local validation requires a Docker daemon socket at /var/run/docker.sock")
    exact_commit(ROOT, args.commit)
    exact_commit(ROOT, args.baseline)
    prepare_output(args.output, ROOT)
    clone_exact(ROOT, args.commit, args.output / "source")
    if args.profile == "full":
        clone_exact(ROOT, args.baseline, args.output / "baseline")
    image = "animama-local-validation:" + args.commit[:12]
    context = args.output / "empty-build-context"
    context.mkdir()
    build = [
        "docker",
        "build",
        "--build-arg",
        f"LOCAL_UID={os.getuid()}",
        "--tag",
        image,
        "--file",
        str(args.output / "source/scripts/ci/local-validation.Dockerfile"),
        str(context),
    ]
    # An empty build context cannot leak checkout bytes or local credentials.
    subprocess.run(build, check=True)
    image_id = capture(["docker", "image", "inspect", image, "--format", "{{.Id}}"], ROOT)
    command = [
        "docker",
        "run",
        "--rm",
        "--init",
        "--group-add",
        str(socket.stat().st_gid),
        "--add-host",
        "host.docker.internal:host-gateway",
        "--volume",
        f"{args.output}:{args.output}",
        "--volume",
        "/var/run/docker.sock:/var/run/docker.sock",
        "--env",
        f"HOME={args.output}/home",
        "--env",
        "TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal",
        "--env",
        "UV_NO_SYNC=1",
        "--env",
        "ANIMAMA_RUN_LIVE_TESTS=0",
        "--env",
        "CI=true",
        "--env",
        "UV_LINK_MODE=copy",
        "--env",
        "PYTHONNOUSERSITE=1",
        "--env",
        "NPM_CONFIG_USERCONFIG=/dev/null",
        "--workdir",
        str(args.output / "source"),
        image_id,
        "uv",
        "run",
        "--no-project",
        "--python",
        "3.12.13",
        "python",
        "scripts/ci/local_validate.py",
        "--worker",
        "--commit",
        args.commit,
        "--baseline",
        args.baseline,
        "--profile",
        args.profile,
        "--output",
        str(args.output),
    ]
    (args.output / "home").mkdir()
    (args.output / "invocation.json").write_text(
        json.dumps(
            {
                "source_commit": args.commit,
                "baseline": args.baseline,
                "profile": args.profile,
                "image_id": image_id,
                "command": command,
                "build_command": build,
            },
            indent=2,
        )
        + "\n"
    )
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, subprocess.CalledProcessError, OSError) as exc:
        print(f"Local validation failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
