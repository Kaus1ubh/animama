"""Run the same bounded accountless browser smoke against two owned serving modes.

Requires the locked Python/frontend environments, Chromium and a built web app.
Original synthetic content exercises production bootstrap and installation
persistence. This checks shell/setup rendering, never starter/avatar fidelity.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from contextlib import ExitStack
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[4]
FRONTEND = ROOT / "src/frontend"


def port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_ready(url: str, processes: list[subprocess.Popen[bytes]]) -> None:
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError("Owned application exited; inspect retained logs")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(0.5)
    raise RuntimeError(f"Readiness timed out: {url}")


def stop(process: subprocess.Popen[bytes], grace: float = 5) -> None:
    """Stop the owned session, including descendants after their parent exits."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait(timeout=grace)
        return
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        process.poll()  # Reap the parent while descendants finish graceful shutdown.
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.05)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def run_command(command: list[str], *, cwd: Path, env: dict[str, str], log: BinaryIO, timeout: float = 240) -> None:
    """Bound commands without leaving Chromium/Vite descendants on timeout."""
    child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        returncode = child.wait(timeout=timeout)
    except BaseException:
        stop(child)
        raise
    if returncode:
        stop(child)
        raise subprocess.CalledProcessError(returncode, command)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pg-bin", type=Path, help="Native PostgreSQL/pgvector bin directory; otherwise own a Docker container"
    )
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=False)
    if not (FRONTEND / "web/dist/index.html").is_file():
        raise RuntimeError("Run pnpm build first")
    environment = {
        key: os.environ[key]
        for key in ("PATH", "HOME", "TMPDIR", "LANG", "PLAYWRIGHT_BROWSERS_PATH", "ANIMAMA_MODEL_ROOT")
        if key in os.environ
    }
    environment.update(
        PYTHON_DOTENV_DISABLED="1",
        PYTHONPATH=str(ROOT / "src/backend"),
        OTEL_SDK_DISABLED="true",
        ANIMAMA_LLM_SKIP="1",
        ANIMAMA_LOG_TO_CONSOLE="1",
        ANIMAMA_LOG_TO_FILE="0",
        ANIMAMA_DISABLE_WEBUI_TELEMETRY="true",
        ANIMAMA_USER_FILE_PROCESSING_ENABLED="false",
        ANIMAMA_PARAKEET_STT_ENABLED="false",
    )
    results = []
    for mode in ("built", "development"):
        destination = evidence / mode
        destination.mkdir()
        with tempfile.TemporaryDirectory(prefix="animama-browser-") as temporary, ExitStack() as owned:
            work = Path(temporary)
            for relative in ("content/included", "content/local", "data"):
                (work / relative).mkdir(parents=True)
            env = environment | {"ANIMAMA_CONTENT_ROOT": str(work / "content"), "ANIMAMA_DATA_ROOT": str(work / "data")}
            pgport = port()
            env.update(
                PGHOST="127.0.0.1", PGPORT=str(pgport), PGUSER="postgres", PGDATABASE="postgres", PGPASSWORD="smoke"
            )

            def run(
                command: list[str],
                name: str,
                cwd: Path = work,
                destination: Path = destination,
                env: dict[str, str] = env,
            ) -> None:
                with (destination / name).open("wb") as log:
                    run_command(command, cwd=cwd, env=env, log=log)

            if args.pg_bin:
                binaries = args.pg_bin.resolve()
                run(
                    [
                        str(binaries / "initdb"),
                        "-D",
                        str(work / "pgdata"),
                        "-U",
                        "postgres",
                        "--auth=trust",
                        "--no-locale",
                        "--encoding=UTF8",
                    ],
                    "initdb.log",
                )
                run(
                    [
                        str(binaries / "pg_ctl"),
                        "-D",
                        str(work / "pgdata"),
                        "-l",
                        str(destination / "postgres.log"),
                        "-o",
                        f"-h 127.0.0.1 -p {pgport} -k ''",
                        "-w",
                        "start",
                    ],
                    "postgres-start.log",
                )
                owned.callback(
                    run,
                    [str(binaries / "pg_ctl"), "-D", str(work / "pgdata"), "-m", "fast", "-w", "stop"],
                    "postgres-stop.log",
                )
            else:
                identifier = subprocess.check_output(
                    [
                        "docker",
                        "run",
                        "--detach",
                        "--rm",
                        "-e",
                        "POSTGRES_PASSWORD=smoke",
                        "-p",
                        "127.0.0.1::5432",
                        "pgvector/pgvector:pg16",
                    ],
                    env=env,
                    text=True,
                    timeout=120,
                ).strip()
                owned.callback(run, ["docker", "stop", identifier], "postgres-stop.log")
                mapping = subprocess.check_output(
                    ["docker", "port", identifier, "5432/tcp"], env=env, text=True, timeout=30
                ).strip()
                env["PGPORT"] = mapping.rsplit(":", 1)[1]
            env["ANIMAMA_DATABASE_URL"] = f"postgresql+asyncpg://postgres:smoke@127.0.0.1:{env['PGPORT']}/postgres"
            run(
                [
                    sys.executable,
                    "-c",
                    (
                        "import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); "
                        "from tests.anima_creation_service_support import write_supplied_starter_fixture; "
                        "write_supplied_starter_fixture(Path(sys.argv[2]))"
                    ),
                    str(ROOT),
                    str(work / "content/included"),
                ],
                "fixture.log",
            )
            run([sys.executable, "-m", "animama.server.db_bootstrap", "--quiet"], "bootstrap.log")
            appport, backendport = port(), port()
            origin = f"http://localhost:{appport}"
            env.update(
                ANIMAMA_PUBLIC_ORIGIN=origin,
                ANIMAMA_WEB_ROOT=str(FRONTEND / "web/dist"),
                ANIMAMA_API_PROXY_TARGET=f"http://127.0.0.1:{backendport}",
            )
            launcher = (
                "import uvicorn; uvicorn.run('animama.server.app:app', host='127.0.0.1', port=PORT, access_log=False)"
            ).replace("PORT", str(appport if mode == "built" else backendport))
            processes: list[subprocess.Popen[bytes]] = []

            def start(
                command: list[str],
                name: str,
                cwd: Path,
                destination: Path = destination,
                env: dict[str, str] = env,
                processes: list[subprocess.Popen[bytes]] = processes,
            ) -> None:
                log = owned.enter_context((destination / name).open("wb"))
                child = subprocess.Popen(
                    command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True
                )
                owned.callback(stop, child)
                processes.append(child)

            start([sys.executable, "-c", launcher], "backend.log", work)
            if mode == "development":
                start(
                    [
                        "node",
                        "--input-type=module",
                        "--eval",
                        "import { createServer } from 'vite'; "
                        "const server = await createServer({envFile:false, "
                        f"server:{{host:'127.0.0.1',port:{appport},strictPort:true}}}}); "
                        "await server.listen();",
                    ],
                    "vite.log",
                    FRONTEND / "web",
                )
            wait_ready(origin + "/health", processes)
            run_type = f"smoke-{mode}-{uuid4().hex[:10]}"
            env.update(
                ANIMAMA_E2E_RUN_TYPE=run_type,
                ANIMAMA_E2E_WEB_URL=origin,
                ANIMAMA_E2E_COMPOSE_PROJECT=f"animama-{run_type}",
                ANIMAMA_E2E_LOCAL_CONTENT_ROOT=str(work / "content/local"),
                ANIMAMA_E2E_ALLOW_MUTATIONS="1",
            )
            before = set((ROOT / ".animama-e2e/runs").glob(f"{run_type}-*"))
            try:
                # Structural fixture avatars prove shell/setup only. Real pose
                # playback in the same spec requires the tracked avatar inputs.
                run(
                    [
                        "node",
                        "scripts/run-playwright-e2e.mjs",
                        "accountless-library.spec.ts",
                        "--grep",
                        "accountless Library smoke",
                    ],
                    "browser.log",
                    FRONTEND,
                )
            finally:
                import shutil

                for artifact in set((ROOT / ".animama-e2e/runs").glob(f"{run_type}-*")) - before:
                    shutil.copytree(artifact, destination / artifact.name)
            results.append(
                {
                    "mode": mode,
                    "origin": origin,
                    "passed": True,
                    "fixture": "original synthetic content; production bootstrap",
                }
            )
    (evidence / "summary.json").write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()
