from __future__ import annotations

import errno
import json
import os
import shutil
import subprocess
import sys
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import yaml

from scripts.validate_local_compose import ComposeBoundaryError, check_available_ports, validate_local_compose_document

REPO_ROOT = Path(__file__).resolve().parents[1]


def _compose() -> dict:
    return yaml.safe_load((REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))


def _environment_names(service: dict) -> set[str]:
    environment = service.get("environment") or {}
    if isinstance(environment, dict):
        return set(environment)
    return {str(item).split("=", 1)[0] for item in environment}


def test_only_hono_publishes_a_default_application_port() -> None:
    services = _compose()["services"]

    assert services["web-server"]["ports"] == ["127.0.0.1:${WEB_SERVER_PORT:-3000}:3000"]
    for private_service, service in services.items():
        if private_service not in {"web-server", "pgadmin", "dozzle"}:
            assert not service.get("ports"), private_service


@lru_cache
def _rendered_compose(profiles: tuple[str, ...] = ("*",)) -> dict:
    environment = os.environ.copy()
    environment["COMPOSE_PROFILES"] = ",".join(profiles)
    # The boundary test needs the rendered graph, never its environment values.
    result = subprocess.run(
        ["docker", "compose", "config", "--format", "json"],
        cwd=REPO_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def test_rendered_compose_enforces_the_local_publication_boundary() -> None:
    validate_local_compose_document(_rendered_compose())


def test_rendered_boundary_rejects_a_private_service_port() -> None:
    document = deepcopy(_rendered_compose())
    document["services"]["animama-server"]["ports"] = [
        {"host_ip": "127.0.0.1", "target": 8000, "published": "8000", "protocol": "tcp"}
    ]
    with pytest.raises(ComposeBoundaryError, match="animama-server must remain private"):
        validate_local_compose_document(document)


def test_rendered_boundary_rejects_a_broad_gateway_mapping() -> None:
    document = deepcopy(_rendered_compose())
    document["services"]["web-server"]["ports"][0]["host_ip"] = "0.0.0.0"
    with pytest.raises(ComposeBoundaryError, match="pinned to 127.0.0.1"):
        validate_local_compose_document(document)


@pytest.mark.parametrize("profiles", [(), ("dev-tools",), ("obs",), ("obs", "dev-tools"), ("*",)])
def test_tools_are_explicit_loopback_publications(profiles: tuple[str, ...]) -> None:
    document = _rendered_compose(profiles)
    validate_local_compose_document(document)
    services = document["services"]
    expected = {"web-server"}
    if "dev-tools" in profiles or "*" in profiles:
        expected |= {"pgadmin", "dozzle"}
    assert {name for name, service in services.items() if service.get("ports")} == expected
    assert ("pgadmin" in services) == ("pgadmin" in expected)
    assert ("dozzle" in services) == ("dozzle" in expected)


@pytest.mark.parametrize("service", ["web-server", "pgadmin", "dozzle"])
@pytest.mark.parametrize("host", [None, "", "0.0.0.0", "192.168.1.10", "::", "::1"])
def test_every_publication_requires_literal_ipv4_loopback(service: str, host: str | None) -> None:
    document = deepcopy(_rendered_compose())
    document["services"][service]["ports"][0]["host_ip"] = host
    with pytest.raises(ComposeBoundaryError, match="pinned to 127.0.0.1"):
        validate_local_compose_document(document)


@pytest.mark.parametrize("service", ["web-server", "pgadmin", "dozzle"])
@pytest.mark.parametrize(
    "field,value",
    [
        ("target", 1234),
        ("protocol", "udp"),
        ("published", "8000-8005"),
        ("published", "0"),
        ("published", "65536"),
        ("published", None),
    ],
)
def test_invalid_publication_shape_is_rejected(service: str, field: str, value: object) -> None:
    document = deepcopy(_rendered_compose())
    document["services"][service]["ports"][0][field] = value
    with pytest.raises(ComposeBoundaryError):
        validate_local_compose_document(document)


@pytest.mark.parametrize("service", ["pgadmin", "dozzle"])
@pytest.mark.parametrize("profiles", [None, [], ["obs"], ["dev-tools", "obs"]])
def test_tools_cannot_escape_their_profile(service: str, profiles: object) -> None:
    document = deepcopy(_rendered_compose())
    document["services"][service]["profiles"] = profiles
    with pytest.raises(ComposeBoundaryError, match="only to the dev-tools profile"):
        validate_local_compose_document(document)


@pytest.mark.parametrize("service", ["web-server", "pgadmin", "dozzle"])
@pytest.mark.parametrize("count", [0, 2])
def test_merged_extra_or_missing_mappings_fail(service: str, count: int) -> None:
    document = deepcopy(_rendered_compose())
    document["services"][service]["ports"] *= count
    with pytest.raises(ComposeBoundaryError, match="exactly one structured port"):
        validate_local_compose_document(document)


def test_duplicate_host_ports_fail() -> None:
    document = deepcopy(_rendered_compose())
    document["services"]["dozzle"]["ports"][0]["published"] = document["services"]["pgadmin"]["ports"][0]["published"]
    with pytest.raises(ComposeBoundaryError, match="duplicate loopback"):
        validate_local_compose_document(document)


@pytest.mark.parametrize("service", ["postgres", "web", "animama-server", "grafana"])
def test_other_infrastructure_cannot_be_published(service: str) -> None:
    document = deepcopy(_rendered_compose())
    document["services"][service]["ports"] = deepcopy(document["services"]["dozzle"]["ports"])
    with pytest.raises(ComposeBoundaryError, match="must remain private"):
        validate_local_compose_document(document)


@pytest.mark.parametrize("service", ["web-server", "pgadmin", "dozzle", "postgres"])
def test_host_networking_is_rejected(service: str) -> None:
    document = deepcopy(_rendered_compose())
    document["services"][service]["network_mode"] = "host"
    with pytest.raises(ComposeBoundaryError, match="must not use host networking"):
        validate_local_compose_document(document)


@pytest.mark.parametrize("owns_port", [False, True])
@pytest.mark.parametrize("encoding", ["array", "lines"])
def test_port_preflight_distinguishes_own_and_foreign_listeners(
    monkeypatch: pytest.MonkeyPatch, owns_port: bool, encoding: str
) -> None:
    document = deepcopy(_rendered_compose(()))
    project = document["name"]
    port = int(document["services"]["web-server"]["ports"][0]["published"])
    containers = [
        {
            "Project": project if owns_port else "another-stack",
            "State": "running",
            "Publishers": [{"URL": "127.0.0.1", "PublishedPort": port, "Protocol": "tcp"}],
        }
    ]
    output = json.dumps(containers) if encoding == "array" else "\n".join(map(json.dumps, containers))
    run = MagicMock(return_value=subprocess.CompletedProcess([], 0, output, ""))
    monkeypatch.setattr("scripts.validate_local_compose.subprocess.run", run)
    probe = MagicMock()
    probe.return_value.__enter__.return_value.bind.side_effect = OSError(errno.EADDRINUSE, "in use")
    monkeypatch.setattr("scripts.validate_local_compose.socket.socket", probe)
    if owns_port:
        check_available_ports(document)
        probe.assert_not_called()
    else:
        with pytest.raises(ComposeBoundaryError, match="occupied outside project"):
            check_available_ports(document)
    assert run.call_args.args[0][:5] == ["docker", "compose", "-p", project, "--profile"]


def test_port_preflight_checks_free_ports_and_fails_closed_without_docker(monkeypatch: pytest.MonkeyPatch) -> None:
    document = _rendered_compose(())
    run = MagicMock(return_value=subprocess.CompletedProcess([], 0, "", ""))
    monkeypatch.setattr("scripts.validate_local_compose.subprocess.run", run)
    probe = MagicMock()
    monkeypatch.setattr("scripts.validate_local_compose.socket.socket", probe)
    check_available_ports(document)
    probe.return_value.__enter__.return_value.bind.assert_called_once()
    run.return_value.returncode = 1
    with pytest.raises(ComposeBoundaryError, match="Docker availability"):
        check_available_ports(document)


def _run_reset(
    tmp_path: Path, args: list[str], variables: dict[str, str] | None = None
) -> tuple[subprocess.CompletedProcess[str], list[dict], Path]:
    """Run real reset/preflight/token code against stubbed Compose, never Docker or repository data."""

    workspace = tmp_path / "animama"
    scripts = workspace / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(REPO_ROOT / "reset.sh", workspace / "reset.sh")
    for name in ("local-gateway-token.sh", "validate_local_compose.py"):
        shutil.copyfile(REPO_ROOT / "scripts" / name, scripts / name)
    commands = tmp_path / "commands.jsonl"
    commands.write_text("")
    docker = tmp_path / "docker"
    docker.write_text(
        f"#!{sys.executable}\n"
        + r"""
import json, os, sys
args = sys.argv[1:]
with open(os.environ["ANIMAMA_TEST_COMMANDS"], "a") as output:
    output.write(json.dumps({
        "args": args, "profiles": os.environ.get("COMPOSE_PROFILES", ""),
        "build_mode": os.environ.get("ANIMAMA_WEB_BUILD_MODE")
    }) + "\n")
if "config" in args and os.environ.get("ANIMAMA_TEST_CONFIG_FAIL"):
    sys.exit(9)
if "--environment" in args:
    print("COMPOSE_PROFILES=" + os.environ.get("ANIMAMA_TEST_DOTENV_PROFILES", ""))
    sys.exit(0)
project = args[args.index("-p") + 1] if "-p" in args else "animama"
all_profiles = "--profile" in args and args[args.index("--profile") + 1] == "*"
selected = os.environ.get("COMPOSE_PROFILES", "").split(",")
port = os.environ.get("WEB_SERVER_PORT", "3000")
origin = os.environ.get("ANIMAMA_PUBLIC_ORIGIN", "http://localhost:" + port)
def mapping(target, published):
    return [{"host_ip": "127.0.0.1", "target": target, "published": published, "protocol": "tcp"}]
services = {
    "web-server": {"ports": mapping(3000, port), "environment": {
        "ANIMAMA_PUBLIC_ORIGIN": origin, "ANIMAMA_PRIVATE_API_ORIGIN": "http://animama-server:8000",
        "ANIMAMA_PRIVATE_VITE_ORIGIN": "http://web:5173"
    }},
    "web": {"environment": {"VITE_WEB_BASE_URL": origin, "VITE_FRONTEND_SERVER_BASE_URL": origin}},
    "postgres": {}, "animama-server": {}
}
if all_profiles or "dev-tools" in selected:
    for name, target, variable, default in [
        ("pgadmin", 80, "PGADMIN_PORT", "5050"), ("dozzle", 8080, "DOZZLE_PORT", "9999")
    ]:
        services[name] = {"profiles": ["dev-tools"], "ports": mapping(target, os.environ.get(variable, default))}
if "config" in args:
    print(json.dumps({"name": project, "services": services}))
elif "ps" in args:
    # Socket availability itself is tested separately; represent our project's listeners.
    publishers = [
        {"URL": "127.0.0.1", "PublishedPort": int(p["published"]), "Protocol": "tcp"}
        for service in services.values() for p in service.get("ports", [])
    ]
    print(json.dumps([{"Project": project, "State": "running", "Publishers": publishers}]))
"""
    )
    docker.chmod(0o755)
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("ANIMAMA_", "COMPOSE_", "PGADMIN_", "DOZZLE_"))
        and key not in {"APP_HOST", "APP_SCHEME", "WEB_SERVER_PORT"}
    }
    environment.update(
        PATH=f"{tmp_path}{os.pathsep}{environment['PATH']}",
        ANIMAMA_TEST_COMMANDS=str(commands),
        ANIMAMA_WEB_BUILD_MODE="production",
    )
    environment.update(variables or {})
    result = subprocess.run(["bash", "reset.sh", *args], cwd=workspace, env=environment, capture_output=True, text=True)
    return result, [json.loads(line) for line in commands.read_text().splitlines()], workspace


def test_reset_enable_restart_disable_preserves_data_and_preflights_first(tmp_path: Path) -> None:
    result, commands, workspace = _run_reset(tmp_path, ["--profile", "dev-tools"])
    assert result.returncode == 0, result.stderr
    assert "http://localhost:5050" in result.stdout
    assert "http://localhost:9999" in result.stdout
    env_file = workspace / ".animama-stack.env"
    assert "export PGADMIN_PORT=5050" in env_file.read_text()
    token = workspace / "data/internal/gateway/token"
    original_token = token.read_bytes()
    marker = workspace / "data/keep.txt"
    marker.write_text("owned data")
    down = next(i for i, command in enumerate(commands) if "down" in command["args"])
    assert sum("config" in command["args"] for command in commands[:down]) == 3
    assert any("ps" in command["args"] for command in commands[:down])
    assert commands[down]["args"] == ["compose", "--profile", "*", "down", "--remove-orphans"]
    assert all(command["build_mode"] == "production" for command in commands)
    for variables in ({"COMPOSE_PROFILES": "dev-tools"}, {"COMPOSE_PROFILES": ""}, {"COMPOSE_PROFILES": "dev-tools"}):
        result, _, _ = _run_reset(tmp_path, [], variables)
        assert result.returncode == 0, result.stderr
        assert token.read_bytes() == original_token
        assert marker.read_text() == "owned data"
        enabled = bool(variables["COMPOSE_PROFILES"])
        assert ("PGADMIN_PORT" in env_file.read_text()) == enabled
        assert ("DOZZLE_URL" in env_file.read_text()) == enabled
        assert ("http://localhost:9999" in result.stdout) == enabled


@pytest.mark.parametrize("base", [8200, 8300])
def test_reset_named_ports_are_isolated_without_launching_stacks(tmp_path: Path, base: int) -> None:
    result, commands, workspace = _run_reset(
        tmp_path,
        ["--name", f"tools-{base}", "--base-port", str(base), "--profile", "dev-tools"],
        {"PGADMIN_PORT": "1", "DOZZLE_PORT": "2"},
    )
    assert result.returncode == 0, result.stderr
    generated = (workspace / ".animama-stack.env").read_text()
    assert f"export PGADMIN_PORT={base + 4}" in generated
    assert f"export DOZZLE_PORT={base + 20}" in generated
    assert f"http://animama-tools-{base}.localhost:{base}" in generated
    assert f".animama-stacks/animama-tools-{base}/data" in generated
    assert all(
        command["args"][1:3] == ["-p", f"animama-tools-{base}"]
        for command in commands
        if "--environment" not in command["args"]
    )


def test_reset_preserves_dotenv_profiles_and_custom_ports(tmp_path: Path) -> None:
    result, commands, workspace = _run_reset(
        tmp_path,
        ["--profile", "dev-tools"],
        {"ANIMAMA_TEST_DOTENV_PROFILES": "obs", "PGADMIN_PORT": "15050", "DOZZLE_PORT": "19999"},
    )
    assert result.returncode == 0, result.stderr
    assert "http://localhost:15050" in result.stdout
    assert "http://localhost:19999" in result.stdout
    assert "export COMPOSE_PROFILES=dev-tools\\,obs" in (workspace / ".animama-stack.env").read_text()
    assert all(command["profiles"] == "dev-tools,obs" for command in commands if "--environment" not in command["args"])


@pytest.mark.parametrize(
    "variables,args",
    [
        ({"PGADMIN_PORT": "3000"}, []),
        ({"DOZZLE_PORT": "65536"}, []),
        ({}, ["--base-port", "65530"]),
        ({"ANIMAMA_TEST_CONFIG_FAIL": "1"}, []),
    ],
)
def test_reset_invalid_configuration_never_stops_stack(
    tmp_path: Path, variables: dict[str, str], args: list[str]
) -> None:
    result, commands, workspace = _run_reset(tmp_path, ["--profile", "dev-tools", *args], variables)
    assert result.returncode != 0
    assert not any(set(command["args"]) & {"down", "up", "run", "exec", "rm"} for command in commands)
    assert not (workspace / ".animama-stack.env").exists()
    assert not (workspace / "data").exists()


def test_gateway_and_fastapi_share_only_the_private_token_file() -> None:
    services = _compose()["services"]
    gateway = services["web-server"]
    backend = services["animama-server"]

    gateway_mounts = gateway.get("volumes") or []
    assert any(
        isinstance(mount, dict)
        and mount.get("source") == "${ANIMAMA_INTERNAL_TOKEN_HOST_PATH:-./data/internal/gateway/token}"
        and mount.get("target") == "/run/animama/gateway-token"
        and mount.get("read_only") is True
        for mount in gateway_mounts
    )
    assert "ANIMAMA_INTERNAL_TOKEN_FILE" in _environment_names(gateway)
    assert "ANIMAMA_INTERNAL_TOKEN_FILE" in _environment_names(backend)

    obsolete = {
        "ANIMAMA_DEPLOYMENT_TRUST_MODE",
        "ANIMAMA_INFRASTRUCTURE_BIND_HOST",
        "ANIMAMA_JWKS_URL",
        "ANIMAMA_PUBLISHED_BIND_HOST",
        "BETTER_AUTH_SECRET",
        "BETTER_AUTH_URL",
        "SEED_TOKEN",
        "SERVICE_API_KEY",
    }
    assert not (_environment_names(gateway) & obsolete)
    assert not (_environment_names(backend) & obsolete)


def test_reset_writes_only_the_public_origin_not_the_gateway_secret() -> None:
    reset_script = (REPO_ROOT / "reset.sh").read_text(encoding="utf-8")

    assert "write_env_var ANIMAMA_PUBLIC_ORIGIN" in reset_script
    assert "write_env_var ANIMAMA_INTERNAL_TOKEN_HOST_PATH" in reset_script
    assert "write_env_var ANIMAMA_INTERNAL_TOKEN\n" not in reset_script
    assert "seed-codex-browser-user" not in reset_script
    assert "--skip-codex-user" not in reset_script
    assert "validate_local_compose.py" in reset_script


def _run_web_launcher(
    tmp_path: Path, *, mode: str | None, fail_build: bool = False
) -> tuple[subprocess.CompletedProcess[str], list[str]]:
    """Exercise the real launcher without starting servers or installing packages."""

    commands = tmp_path / "commands.txt"
    pnpm = tmp_path / "pnpm"
    pnpm.write_text(
        "#!/bin/sh\n"
        'printf "%s|%s|%s\\n" "$NODE_ENV" "$VITE_APP_ENV" "$*" >> "$ANIMAMA_TEST_WEB_COMMANDS"\n'
        'if [ "$ANIMAMA_TEST_FAIL_WEB_BUILD" = 1 ] && [ "$3" = build ]; then exit 9; fi\n',
        encoding="utf-8",
    )
    pnpm.chmod(0o755)
    environment = os.environ.copy()
    environment.update(
        PATH=f"{tmp_path}{os.pathsep}{environment['PATH']}",
        NODE_ENV="development",
        VITE_APP_ENV="development",
        ANIMAMA_TEST_WEB_COMMANDS=str(commands),
        ANIMAMA_TEST_FAIL_WEB_BUILD="1" if fail_build else "0",
    )
    environment.pop("ANIMAMA_WEB_BUILD_MODE", None)
    if mode is not None:
        environment["ANIMAMA_WEB_BUILD_MODE"] = mode
    result = subprocess.run(
        ["sh", "scripts/start-compose-web.sh"],
        cwd=REPO_ROOT / "src/frontend",
        env=environment,
        capture_output=True,
        text=True,
    )
    return result, commands.read_text().splitlines() if commands.exists() else []


@pytest.mark.parametrize("mode", [None, "development", "production"])
def test_web_launcher_selects_the_build_and_private_server(tmp_path: Path, mode: str | None) -> None:
    result, commands = _run_web_launcher(tmp_path, mode=mode)

    assert result.returncode == 0, result.stderr
    expected_mode = mode or "development"
    prefix = f"{expected_mode}|{expected_mode}|--filter animama-web "
    if mode == "production":
        assert commands == [
            prefix + "build",
            prefix + "exec vite preview --host 0.0.0.0 --port 5173 --strictPort",
        ]
    else:
        assert commands == [prefix + "dev --host 0.0.0.0 --port 5173 --strictPort"]
        # The workspace dev command must prepare the shared package artifacts
        # and route tree before opening Vite's private listener.
        scripts = json.loads((REPO_ROOT / "src/frontend/web/package.json").read_text())["scripts"]
        assert scripts["dev"].startswith("pnpm --dir .. packages:build && pnpm routes:generate && vite")


def test_web_launcher_does_not_serve_stale_output_after_build_failure(tmp_path: Path) -> None:
    result, commands = _run_web_launcher(tmp_path, mode="production", fail_build=True)

    assert result.returncode == 9
    assert commands == ["production|production|--filter animama-web build"]


def test_web_launcher_rejects_invalid_build_modes(tmp_path: Path) -> None:
    result, commands = _run_web_launcher(tmp_path, mode="invalid")

    assert result.returncode == 2
    assert "must be development or production" in result.stderr
    assert commands == []
