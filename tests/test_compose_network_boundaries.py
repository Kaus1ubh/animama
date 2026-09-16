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


def test_only_fastapi_publishes_a_default_application_port() -> None:
    services = _compose()["services"]

    assert services["animama-server"]["ports"] == ["127.0.0.1:${WEB_SERVER_PORT:-8000}:8000"]
    for private_service, service in services.items():
        if private_service not in {"animama-server", "pgadmin", "dozzle"}:
            assert not service.get("ports"), private_service


@lru_cache
def _rendered_compose(profiles: tuple[str, ...] = ("*",), development: bool = False) -> dict:
    environment = os.environ.copy()
    environment["COMPOSE_PROFILES"] = ",".join(profiles)
    environment.pop("COMPOSE_FILE", None)
    files = ["-f", "docker-compose.yml"]
    if development:
        files += ["-f", "docker-compose.development.yml"]
    # The boundary test needs the rendered graph, never its environment values.
    result = subprocess.run(
        ["docker", "compose", *files, "config", "--format", "json"],
        cwd=REPO_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def test_rendered_compose_enforces_the_local_publication_boundary() -> None:
    validate_local_compose_document(_rendered_compose())


@pytest.mark.parametrize("profiles", [(), ("dev-tools",), ("voice",), ("*",)])
def test_development_override_publishes_only_vite_and_keeps_fastapi_private(profiles: tuple[str, ...]) -> None:
    document = _rendered_compose(profiles, development=True)
    validate_local_compose_document(document)
    services = document["services"]
    assert not services["animama-server"].get("ports")
    assert services["animama-server"]["build"]["target"] == "animama-server-development"
    assert services["animama-server"]["environment"]["ANIMAMA_WEB_ROOT"] == ""
    expected = {"web"}
    if "dev-tools" in profiles or "*" in profiles:
        expected |= {"pgadmin", "dozzle"}
    assert {name for name, service in services.items() if service.get("ports")} == expected


def test_production_graph_serves_built_assets_without_source_mount_or_node_services() -> None:
    services = _rendered_compose(())["services"]
    assert "web" not in services and "web-deps-init" not in services
    api = services["animama-server"]
    assert api["build"]["target"] == "animama-server"
    assert api["environment"]["ANIMAMA_WEB_ROOT"] == "/opt/animama/web"
    assert not any(volume["target"] == "/app" for volume in api["volumes"])


def test_development_cannot_republish_api_or_choose_another_proxy_target() -> None:
    document = deepcopy(_rendered_compose(development=True))
    document["services"]["animama-server"]["ports"] = [
        {"host_ip": "127.0.0.1", "target": 8000, "published": "8000", "protocol": "tcp"}
    ]
    with pytest.raises(ComposeBoundaryError, match="must remain private"):
        validate_local_compose_document(document)
    del document["services"]["animama-server"]["ports"]
    document["services"]["web"]["environment"]["ANIMAMA_API_PROXY_TARGET"] = "http://hostile.invalid"
    with pytest.raises(ComposeBoundaryError, match="fixed private Compose API origin"):
        validate_local_compose_document(document)


def test_rendered_boundary_rejects_a_private_service_port() -> None:
    document = deepcopy(_rendered_compose())
    document["services"]["postgres"]["ports"] = [
        {"host_ip": "127.0.0.1", "target": 5432, "published": "8000", "protocol": "tcp"}
    ]
    with pytest.raises(ComposeBoundaryError, match="postgres must remain private"):
        validate_local_compose_document(document)


def test_rendered_boundary_rejects_a_broad_application_mapping() -> None:
    document = deepcopy(_rendered_compose())
    document["services"]["animama-server"]["ports"][0]["host_ip"] = "0.0.0.0"
    with pytest.raises(ComposeBoundaryError, match="pinned to 127.0.0.1"):
        validate_local_compose_document(document)


@pytest.mark.parametrize("profiles", [(), ("dev-tools",), ("voice",), ("voice", "dev-tools"), ("*",)])
def test_tools_are_explicit_loopback_publications(profiles: tuple[str, ...]) -> None:
    document = _rendered_compose(profiles)
    validate_local_compose_document(document)
    services = document["services"]
    expected = {"animama-server"}
    if "dev-tools" in profiles or "*" in profiles:
        expected |= {"pgadmin", "dozzle"}
    assert {name for name, service in services.items() if service.get("ports")} == expected
    assert ("pgadmin" in services) == ("pgadmin" in expected)
    assert ("dozzle" in services) == ("dozzle" in expected)


@pytest.mark.parametrize("service", ["animama-server", "pgadmin", "dozzle"])
@pytest.mark.parametrize("host", [None, "", "0.0.0.0", "192.168.1.10", "::", "::1"])
def test_every_publication_requires_literal_ipv4_loopback(service: str, host: str | None) -> None:
    document = deepcopy(_rendered_compose())
    document["services"][service]["ports"][0]["host_ip"] = host
    with pytest.raises(ComposeBoundaryError, match="pinned to 127.0.0.1"):
        validate_local_compose_document(document)


@pytest.mark.parametrize("service", ["animama-server", "pgadmin", "dozzle"])
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


@pytest.mark.parametrize("service", ["animama-server", "pgadmin", "dozzle"])
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


@pytest.mark.parametrize("service", ["postgres", "parakeet"])
def test_other_infrastructure_cannot_be_published(service: str) -> None:
    document = deepcopy(_rendered_compose())
    document["services"][service]["ports"] = deepcopy(document["services"]["dozzle"]["ports"])
    with pytest.raises(ComposeBoundaryError, match="must remain private"):
        validate_local_compose_document(document)


@pytest.mark.parametrize("service", ["animama-server", "pgadmin", "dozzle", "postgres"])
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
    port = int(document["services"]["animama-server"]["ports"][0]["published"])
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
    tmp_path: Path, args: list[str], variables: dict[str, str] | None = None, *, build_mode: str | None = "production"
) -> tuple[subprocess.CompletedProcess[str], list[dict], Path]:
    """Run real reset/preflight against stubbed Compose, never Docker or repository data."""

    workspace = tmp_path / "animama"
    scripts = workspace / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(REPO_ROOT / "reset.sh", workspace / "reset.sh")
    for name in ("validate_local_compose.py",):
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
        "build_mode": os.environ.get("ANIMAMA_WEB_BUILD_MODE"), "compose_file": os.environ.get("COMPOSE_FILE")
    }) + "\n")
if "config" in args and os.environ.get("ANIMAMA_TEST_CONFIG_FAIL"):
    sys.exit(9)
if "--environment" in args:
    print("COMPOSE_PROFILES=" + os.environ.get("ANIMAMA_TEST_DOTENV_PROFILES", ""))
    print("ANIMAMA_WEB_BUILD_MODE=" + os.environ.get("ANIMAMA_TEST_DOTENV_BUILD_MODE", "development"))
    sys.exit(0)
project = args[args.index("-p") + 1] if "-p" in args else "animama"
all_profiles = "--profile" in args and args[args.index("--profile") + 1] == "*"
selected = os.environ.get("COMPOSE_PROFILES", "").split(",")
port = os.environ.get("WEB_SERVER_PORT", "8000")
origin = os.environ.get("ANIMAMA_PUBLIC_ORIGIN", "http://localhost:" + port)
def mapping(target, published):
    return [{"host_ip": "127.0.0.1", "target": target, "published": published, "protocol": "tcp"}]
development = os.environ.get("ANIMAMA_WEB_BUILD_MODE", "development") == "development"
services = {
    "animama-server": {"environment": {
        "ANIMAMA_PUBLIC_ORIGIN": origin, "ANIMAMA_WEB_ROOT": "" if development else "/opt/animama/web"
    }}, "postgres": {}
}
if development:
    services["web"] = {"ports": mapping(5173, port), "environment": {
        "ANIMAMA_PUBLIC_ORIGIN": origin, "VITE_WEB_BASE_URL": origin, "VITE_FRONTEND_SERVER_BASE_URL": origin,
        "ANIMAMA_API_PROXY_TARGET": "http://animama-server:8000", "ANIMAMA_WEB_BUILD_MODE": "development"
    }}
    services["web-deps-init"] = {}
else:
    services["animama-server"]["ports"] = mapping(8000, port)
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
    )
    if build_mode is not None:
        environment["ANIMAMA_WEB_BUILD_MODE"] = build_mode
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
    assert not token.exists()
    token.parent.mkdir(parents=True)
    token.write_bytes(b"retired-token-must-not-rotate")
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


@pytest.mark.parametrize("document_type", ["text/html", "application/json"])
def test_built_readiness_requests_html_navigation_and_checks_document_type(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, document_type: str
) -> None:
    result, commands, _ = _run_reset(tmp_path, [])
    assert result.returncode == 0, result.stderr
    probe = next(command["args"] for command in commands if "exec" in command["args"] and "-c" in command["args"])
    code = probe[probe.index("-c") + 1]
    monkeypatch.setenv("ANIMAMA_PUBLIC_ORIGIN", "http://localhost:8400")
    observed = []

    def urlopen(request, *, timeout):
        # The actual production responder requires a navigation Accept header;
        # an API-shaped 200 must not make the document readiness check pass.
        expected_type = "application/json" if request.full_url.endswith("/health") else "text/html"
        assert request.get_header("Host") == "localhost:8400"
        assert request.get_header("Accept") == expected_type
        assert timeout == 2
        observed.append(request.full_url)
        response = MagicMock()
        response.status = 200
        response.headers.get_content_type.return_value = (
            "application/json" if request.full_url.endswith("/health") else document_type
        )
        response.__enter__.return_value = response
        return response

    monkeypatch.setattr("urllib.request.urlopen", urlopen)
    if document_type == "text/html":
        exec(code, {})
    else:
        with pytest.raises(SystemExit):
            exec(code, {})
    assert observed == ["http://127.0.0.1:8000/health", "http://127.0.0.1:8000/"]


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
        {"ANIMAMA_TEST_DOTENV_PROFILES": "voice", "PGADMIN_PORT": "15050", "DOZZLE_PORT": "19999"},
    )
    assert result.returncode == 0, result.stderr
    assert "http://localhost:15050" in result.stdout
    assert "http://localhost:19999" in result.stdout
    assert "export COMPOSE_PROFILES=dev-tools\\,voice" in (workspace / ".animama-stack.env").read_text()
    assert all(
        command["profiles"] == "dev-tools,voice" for command in commands if "--environment" not in command["args"]
    )


@pytest.mark.parametrize("mode", ["development", "production"])
def test_reset_selects_and_persists_the_exact_graph_from_dotenv(tmp_path: Path, mode: str) -> None:
    result, commands, workspace = _run_reset(tmp_path, [], {"ANIMAMA_TEST_DOTENV_BUILD_MODE": mode}, build_mode=None)
    assert result.returncode == 0, result.stderr
    expected = str(workspace / "docker-compose.yml")
    if mode == "development":
        expected += ":" + str(workspace / "docker-compose.development.yml")
    assert all(command["compose_file"] == expected for command in commands if "--environment" not in command["args"])
    generated = (workspace / ".animama-stack.env").read_text()
    assert f"export ANIMAMA_WEB_BUILD_MODE={mode}" in generated
    assert f"export COMPOSE_FILE={expected}" in generated
    assert "INTERNAL_TOKEN" not in generated
    assert not (workspace / "data/internal/gateway/token").exists()


def test_invalid_build_mode_fails_before_any_stack_change(tmp_path: Path) -> None:
    result, commands, workspace = _run_reset(tmp_path, [], build_mode="invalid")
    assert result.returncode == 2
    assert not any(set(command["args"]) & {"up", "down", "run", "exec"} for command in commands)
    assert not (workspace / ".animama-stack.env").exists()


@pytest.mark.parametrize(
    "variables,args",
    [
        ({"PGADMIN_PORT": "8000"}, []),
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


def test_retired_gateway_credentials_and_services_are_absent_from_both_graphs() -> None:
    for development in (False, True):
        document = _rendered_compose(development=development)
        assert "web-server" not in document["services"]
        for service in document["services"].values():
            assert not any(
                "INTERNAL_TOKEN" in name or "PRIVATE_VITE_ORIGIN" in name for name in _environment_names(service)
            )
            assert "gateway-token" not in json.dumps(service.get("volumes", []))


def test_reset_persists_the_selected_graph_without_gateway_credentials() -> None:
    reset_script = (REPO_ROOT / "reset.sh").read_text(encoding="utf-8")
    assert "write_env_var ANIMAMA_PUBLIC_ORIGIN" in reset_script
    assert "write_env_var COMPOSE_FILE" in reset_script
    assert "write_env_var ANIMAMA_WEB_BUILD_MODE" in reset_script
    assert "INTERNAL_TOKEN" not in reset_script
    assert "local-gateway-token" not in reset_script
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


@pytest.mark.parametrize("mode", [None, "development"])
def test_web_launcher_runs_only_the_development_server(tmp_path: Path, mode: str | None) -> None:
    result, commands = _run_web_launcher(tmp_path, mode=mode)
    assert result.returncode == 0, result.stderr
    assert commands == ["development|development|--filter animama-web dev --host 0.0.0.0 --port 5173 --strictPort"]
    scripts = json.loads((REPO_ROOT / "src/frontend/web/package.json").read_text())["scripts"]
    assert scripts["dev"].startswith("pnpm --dir .. packages:build && pnpm routes:generate && vite")


@pytest.mark.parametrize("mode", ["production", "invalid"])
def test_web_launcher_never_serves_a_production_preview_or_invalid_mode(tmp_path: Path, mode: str) -> None:
    result, commands = _run_web_launcher(tmp_path, mode=mode)
    assert result.returncode == 2
    assert "requires ANIMAMA_WEB_BUILD_MODE=development" in result.stderr
    assert commands == []


@pytest.mark.parametrize("selection", ["cli", "environment", "dotenv"])
def test_retired_obs_profile_fails_before_stack_changes(tmp_path: Path, selection: str) -> None:
    args = ["--profile", "obs"] if selection == "cli" else []
    variables = {"COMPOSE_PROFILES": "dev-tools,obs"} if selection == "environment" else {}
    if selection == "dotenv":
        variables["ANIMAMA_TEST_DOTENV_PROFILES"] = "obs"
    result, commands, workspace = _run_reset(tmp_path, args, variables)
    assert result.returncode == 2
    assert "obs profile has been retired" in result.stderr
    assert all("--environment" in command["args"] for command in commands)
    assert not (workspace / ".animama-stack.env").exists()


def test_retired_observability_has_no_active_compose_wiring() -> None:
    document = _compose()
    assert not any("obs" in service.get("profiles", []) for service in document["services"].values())
    assert not {"grafana-data", "minio-data", "tempo-data", "loki-data"}.intersection(document["volumes"])


def test_explicit_purge_leaves_retired_observability_volumes_untouched(tmp_path: Path) -> None:
    result, commands, _ = _run_reset(tmp_path, ["--name", "retired-obs", "--purge"])
    assert result.returncode == 0, result.stderr
    removals = [command["args"] for command in commands if command["args"][:2] == ["volume", "rm"]]
    assert removals == [["volume", "rm", "animama-retired-obs_postgres-data", "animama-retired-obs_pgadmin-data"]]
