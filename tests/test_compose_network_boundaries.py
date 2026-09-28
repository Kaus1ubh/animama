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
from typing import Any
from unittest.mock import MagicMock

import pytest
import yaml

from scripts.validate_local_compose import ComposeBoundaryError, check_available_ports, validate_local_compose_document

REPO_ROOT = Path(__file__).resolve().parents[1]


def _compose() -> dict[str, Any]:
    document = yaml.safe_load((REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    return document


def _environment_names(service: dict[str, Any]) -> set[str]:
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
def _rendered_compose(profiles: tuple[str, ...] = ("*",), development: bool = False) -> dict[str, Any]:
    environment = os.environ.copy()
    environment["COMPOSE_PROFILES"] = ",".join(profiles)
    environment["ANIMAMA_PARAKEET_MODEL_DIR"] = "/verified-test-models/parakeet/version"
    environment["ANIMAMA_BROWSER_MODEL_DIR"] = "/verified-test-models/browser/version"
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
    document = json.loads(result.stdout)
    assert isinstance(document, dict)
    return document


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
    assert services["animama-server"]["environment"]["ANIMAMA_BACKEND_RELOAD"] == "1"
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
    assert "ANIMAMA_BACKEND_RELOAD" not in api["environment"]
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
) -> tuple[subprocess.CompletedProcess[str], list[dict[str, Any]], Path]:
    """Run real reset/preflight against stubbed Compose, never Docker or repository data."""

    workspace = tmp_path / "animama"
    scripts = workspace / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(REPO_ROOT / "reset.sh", workspace / "reset.sh")
    for name in ("validate_local_compose.py", "local-stack-state-common.sh"):
        shutil.copyfile(REPO_ROOT / "scripts" / name, scripts / name)
    for name in ("docker-compose.yml", "docker-compose.development.yml"):
        shutil.copyfile(REPO_ROOT / name, workspace / name)
    model_scripts = scripts / "models"
    model_scripts.mkdir(exist_ok=True)
    (model_scripts / "parakeet.py").write_text(
        "import os, sys\n"
        "root = sys.argv[sys.argv.index('--root') + 1] if '--root' in sys.argv else '/default-model-store'\n"
        "if sys.argv[1] == 'root':\n"
        "    print(root)\n"
        "    sys.exit(0)\n"
        "if os.environ.get('ANIMAMA_TEST_MODEL_MISSING'):\n"
        "    print('Missing models; run python3 scripts/models/parakeet.py acquire', file=sys.stderr)\n"
        "    sys.exit(2)\n"
        "if os.environ.get('ANIMAMA_TEST_MODEL_CORRUPT'):\n"
        "    print('Size or SHA-256 mismatch', file=sys.stderr)\n"
        "    sys.exit(1)\n"
        "print(root + '/parakeet-tdt-0.6b-v2/verified-version')\n"
    )
    (model_scripts / "browser_speech.py").write_text(
        (model_scripts / "parakeet.py")
        .read_text()
        .replace("parakeet-tdt-0.6b-v2", "browser-speech")
        .replace("parakeet.py", "browser_speech.py")
        .replace("ANIMAMA_TEST_MODEL_MISSING", "ANIMAMA_TEST_BROWSER_MODEL_MISSING")
        .replace("ANIMAMA_TEST_MODEL_CORRUPT", "ANIMAMA_TEST_BROWSER_MODEL_CORRUPT")
    )
    commands = tmp_path / "commands.jsonl"
    commands.write_text("")
    docker = tmp_path / "docker"
    docker.write_text(
        f"#!{sys.executable}\n"
        + r"""
import json, os, sys
args = sys.argv[1:]
# Only plain key=value fixture files; real Compose interpolation has separate coverage.
values = {}
for filename in os.environ.get("COMPOSE_ENV_FILES", "").split(","):
    if filename:
        with open(filename) as source:
            values.update(line.rstrip("\n").split("=", 1) for line in source if "=" in line)
values.update(os.environ)
with open(os.environ["ANIMAMA_TEST_COMMANDS"], "a") as output:
    output.write(json.dumps({
        "args": args, "profiles": os.environ.get("COMPOSE_PROFILES", ""),
        "build_mode": os.environ.get("ANIMAMA_WEB_BUILD_MODE"), "compose_file": os.environ.get("COMPOSE_FILE"),
        "selected_files": os.environ.get("COMPOSE_ENV_FILES"),
        "parakeet_stt_enabled": os.environ.get("ANIMAMA_PARAKEET_STT_ENABLED"),
        "fixture_credentials_preserved": all(values.get(key) == expected for key, expected in (
            ("POSTGRES_PASSWORD", "fixture-postgres-secret"), ("OPENAI_API_KEY", "fixture-provider-secret"))),
        "host_credentials_absent": all(key not in os.environ for key in ("POSTGRES_PASSWORD", "OPENAI_API_KEY"))
    }) + "\n")
if "config" in args and os.environ.get("ANIMAMA_TEST_CONFIG_FAIL"):
    sys.exit(9)
if "--environment" in args:
    print("COMPOSE_PROFILES=" + os.environ.get("ANIMAMA_TEST_DOTENV_PROFILES", ""))
    print("ANIMAMA_WEB_BUILD_MODE=" + os.environ.get("ANIMAMA_TEST_DOTENV_BUILD_MODE", "development"))
    print("ANIMAMA_MODEL_ROOT=" + os.environ.get("ANIMAMA_TEST_DOTENV_MODEL_ROOT", ""))
    for key, value in values.items():
        print(key + "=" + value)
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
        if not key.startswith(("ANIMAMA_", "COMPOSE_", "PGADMIN_", "DOZZLE_", "POSTGRES_", "OPENAI_"))
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
    assert sum("config" in command["args"] for command in commands[:down]) == 4
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
    probe = next(
        command["args"]
        for command in commands
        if "exec" in command["args"] and "python" in command["args"] and "-c" in command["args"]
    )
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
    assert scripts["dev"].startswith(
        "pnpm --dir .. poses:check && pnpm --dir .. packages:build && pnpm routes:generate && vite"
    )


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


@pytest.mark.parametrize("development", [False, True])
def test_models_use_the_same_verified_read_only_bind_without_host_creation(development: bool) -> None:
    services = _rendered_compose(development=development)["services"]
    targets = {"animama-server": "/opt/animama/web/__client-parakeet-models"}
    if development:
        targets["web"] = "/app/parakeet-tdt-0.6b-v2"
    for service, target in targets.items():
        mount = next(volume for volume in services[service]["volumes"] if volume["target"] == target)
        assert mount["source"] == "/verified-test-models/parakeet/version"
        assert mount["type"] == "bind"
        assert mount["read_only"] is True
        assert mount["bind"].get("create_host_path", False) is False


@pytest.mark.parametrize("model_root", ["/default-model-store", "/shared/model store"])
def test_reset_records_verified_version_and_ignores_stale_derived_path(tmp_path: Path, model_root: str) -> None:
    variables = {"ANIMAMA_PARAKEET_MODEL_DIR": "/stale/version"}
    if model_root != "/default-model-store":
        variables["ANIMAMA_MODEL_ROOT"] = model_root
    result, _, workspace = _run_reset(tmp_path, [], variables)
    assert result.returncode == 0, result.stderr
    record = workspace / ".animama-stack.env"
    resolved = subprocess.run(
        [
            "bash",
            "-c",
            'source "$1"; printf "%s\n%s" "$ANIMAMA_MODEL_ROOT" "$ANIMAMA_PARAKEET_MODEL_DIR"',
            "test",
            str(record),
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    assert resolved == [model_root, model_root + "/parakeet-tdt-0.6b-v2/verified-version"]


def test_reset_reads_model_root_from_dotenv_selector(tmp_path: Path) -> None:
    result, _, workspace = _run_reset(tmp_path, [], {"ANIMAMA_TEST_DOTENV_MODEL_ROOT": "/dotenv-model-store"})
    assert result.returncode == 0, result.stderr
    assert "export ANIMAMA_MODEL_ROOT=/dotenv-model-store" in (workspace / ".animama-stack.env").read_text()


def test_missing_parakeet_models_start_without_dictation(tmp_path: Path) -> None:
    result, commands, workspace = _run_reset(tmp_path, [], {"ANIMAMA_TEST_MODEL_MISSING": "1"})
    assert result.returncode == 0, result.stderr
    assert "parakeet.py acquire" in result.stderr
    started = [command for command in commands if "up" in command["args"]]
    assert started
    assert all(command["parakeet_stt_enabled"] == "false" for command in started)
    record = (workspace / ".animama-stack.env").read_text()
    assert "export ANIMAMA_PARAKEET_MODEL_DIR=''" in record
    assert "export ANIMAMA_BROWSER_MODEL_DIR=/default-model-store/browser-speech/verified-version" in record


def test_missing_browser_models_start_without_browser_speech(tmp_path: Path) -> None:
    result, commands, workspace = _run_reset(tmp_path, [], {"ANIMAMA_TEST_BROWSER_MODEL_MISSING": "1"})
    assert result.returncode == 0, result.stderr
    assert "browser_speech.py acquire" in result.stderr
    assert all(command["parakeet_stt_enabled"] is None for command in commands)
    record = (workspace / ".animama-stack.env").read_text()
    assert "export ANIMAMA_BROWSER_MODEL_DIR=''" in record
    assert "export ANIMAMA_PARAKEET_MODEL_DIR=/default-model-store/parakeet-tdt-0.6b-v2/verified-version" in record


@pytest.mark.parametrize(
    ("variable", "script"),
    [("ANIMAMA_TEST_MODEL_CORRUPT", "parakeet.py"), ("ANIMAMA_TEST_BROWSER_MODEL_CORRUPT", "browser_speech.py")],
)
def test_unverifiable_models_prevent_all_reset_mutations_even_with_purge(
    tmp_path: Path, variable: str, script: str
) -> None:
    result, commands, workspace = _run_reset(tmp_path, ["--purge"], {variable: "1"})
    assert result.returncode != 0
    assert f"{script} verify" in result.stderr
    assert all("config" in command["args"] for command in commands)
    assert not (workspace / ".animama-stack.env").exists()
    assert not (workspace / "data").exists()
    assert not (workspace / "content").exists()


def test_browser_models_are_readonly_build_and_dev_inputs() -> None:
    base = _rendered_compose(())["services"]["animama-server"]
    assert base["build"]["additional_contexts"]["browser_models"] == "/verified-test-models/browser/version"
    assert not any(v["target"] == "/opt/animama/browser-models" for v in base["volumes"])
    web = _rendered_compose(development=True)["services"]["web"]
    mount = next(v for v in web["volumes"] if v["target"] == "/opt/animama/browser-models")
    assert mount["read_only"] is True
    assert mount["bind"].get("create_host_path", False) is False


def test_old_stack_record_can_render_management_without_browser_cache() -> None:
    environment = {k: v for k, v in os.environ.items() if k not in {"COMPOSE_FILE", "ANIMAMA_BROWSER_MODEL_DIR"}}
    environment["ANIMAMA_PARAKEET_MODEL_DIR"] = "/recorded/parakeet/version"
    rendered = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            "docker-compose.yml",
            "-f",
            "docker-compose.development.yml",
            "config",
            "--format",
            "json",
        ],
        cwd=REPO_ROOT,
        env=environment,
        text=True,
        capture_output=True,
        check=True,
    )
    graph = json.loads(rendered.stdout)
    mount = next(v for v in graph["services"]["web"]["volumes"] if v["target"] == "/opt/animama/browser-models")
    assert mount["source"] == str(REPO_ROOT / "models/browser-speech")
    assert mount["read_only"] is True
    assert mount["bind"].get("create_host_path", False) is False


def test_built_self_host_downloads_the_webgpu_encoder_instead_of_mounting_it() -> None:
    server = _rendered_compose(())["services"]["animama-server"]
    # Built self-host installs the encoder in the app into its data root; only
    # development stacks mount an operator-provided set.
    assert not any("parakeet-webgpu" in v["target"] for v in server["volumes"])
    data = next(v for v in server["volumes"] if v["target"] == "/var/lib/animama/data")
    assert data.get("read_only", False) is False
    assert not (REPO_ROOT / "models/parakeet-tdt-0.6b-v2-webgpu/encoder-model.fp16.onnx").exists()


def test_optional_webgpu_encoder_is_a_dev_only_readonly_mount_with_a_notices_fallback() -> None:
    base = _rendered_compose(())["services"]
    assert not any(
        v["target"] == "/app/parakeet-tdt-0.6b-v2-webgpu" for s in base.values() for v in s.get("volumes", [])
    )
    environment = {
        k: v for k, v in os.environ.items() if k not in {"COMPOSE_FILE", "ANIMAMA_PARAKEET_WEBGPU_MODEL_DIR"}
    }
    environment["ANIMAMA_PARAKEET_MODEL_DIR"] = "/recorded/parakeet/version"
    rendered = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            "docker-compose.yml",
            "-f",
            "docker-compose.development.yml",
            "config",
            "--format",
            "json",
        ],
        cwd=REPO_ROOT,
        env=environment,
        text=True,
        capture_output=True,
        check=True,
    )
    web = json.loads(rendered.stdout)["services"]["web"]
    mount = next(v for v in web["volumes"] if v["target"] == "/app/parakeet-tdt-0.6b-v2-webgpu")
    # Without an acquired set, the checked-in notices directory keeps Compose valid.
    assert mount["source"] == str(REPO_ROOT / "models/parakeet-tdt-0.6b-v2-webgpu")
    assert mount["read_only"] is True
    assert mount["bind"].get("create_host_path", False) is False
    assert web["environment"]["VITE_CLIENT_PARAKEET_WEBGPU_MODEL_DIR"] == "/app/parakeet-tdt-0.6b-v2-webgpu"


@pytest.mark.parametrize("development", [False, True])
@pytest.mark.parametrize("configured", [False, True])
def test_compose_forwards_auxiliary_controls_and_openai_endpoint(
    tmp_path: Path, development: bool, configured: bool
) -> None:
    """Selected dotenv controls must reach both modes without changing defaults."""

    expected = {
        "ANIMAMA_CHAT_TITLE_GENERATION_ENABLED": "false" if configured else "true",
        "ANIMAMA_CHAT_COMPACTION_ENABLED": "false" if configured else "true",
        "OPENAI_BASE_URL": "https://approved-relay.example.invalid/v1" if configured else "",
    }
    selection = tmp_path / "nonsecret.env"
    selection.write_text("".join(f"{key}={value}\n" for key, value in expected.items()) if configured else "")
    environment = {
        "PATH": os.environ["PATH"],
        "HOME": os.environ["HOME"],
        "COMPOSE_ENV_FILES": str(selection),
        "ANIMAMA_PARAKEET_MODEL_DIR": "/verified-test-models/parakeet/version",
        "ANIMAMA_BROWSER_MODEL_DIR": "/verified-test-models/browser/version",
    }
    files = ["-f", "docker-compose.yml"]
    if development:
        files += ["-f", "docker-compose.development.yml"]
    rendered = subprocess.run(
        ["docker", "compose", *files, "config", "--format", "json"],
        cwd=REPO_ROOT,
        env=environment,
        capture_output=True,
        text=True,
    )
    assert rendered.returncode == 0, "Selected nonsecret configuration must render"
    effective = json.loads(rendered.stdout)["services"]["animama-server"]["environment"]
    assert {key: effective[key] for key in expected} == expected


@pytest.mark.parametrize("project", ["animama-env-fixture", "custom-project"])
def test_reset_selected_files_preserve_credentials_and_resume_in_a_clean_terminal(tmp_path: Path, project: str) -> None:
    shared = tmp_path / "shared config" / "dev-secrets.env"
    shared.parent.mkdir()
    shared.write_text("POSTGRES_PASSWORD=fixture-postgres-secret\nOPENAI_API_KEY=fixture-provider-secret\n")
    shared.chmod(0o600)
    workspace = tmp_path / "animama"
    workspace.mkdir()
    included = tmp_path / "included content"
    included.mkdir()
    (workspace / ".env").write_text(
        f"COMPOSE_PROJECT_NAME={project}\nWEB_SERVER_PORT=9180\n"
        "APP_HOST=fixture.localhost\nANIMAMA_WEB_BUILD_MODE=production\n"
        "POSTGRES_USER=fixture_owner\nPOSTGRES_DB=fixture_db\n"
        f"ANIMAMA_INCLUDED_CONTENT_HOST_PATH={included}\n"
        "ANIMAMA_CHAT_TITLE_GENERATION_MODEL=gpt-5.6-luna\n"
        "ANIMAMA_CHAT_TITLE_GENERATION_PROVIDER=OpenAIResponsesHTTPAgent\n"
        "ANIMAMA_CHAT_TITLE_GENERATION_REASONING_EFFORT=none\n"
    )
    selection = "../shared config/dev-secrets.env,.env"
    result, commands, workspace = _run_reset(tmp_path, [], {"COMPOSE_ENV_FILES": selection}, build_mode=None)
    assert result.returncode == 0, result.stderr
    assert "http://fixture.localhost:9180" in result.stdout
    assert all(command["fixture_credentials_preserved"] for command in commands)
    assert all(command["host_credentials_absent"] for command in commands)
    record = workspace / ".animama-stack.env"
    record_text = record.read_text()
    for value in ("fixture-postgres-secret", "fixture-provider-secret", "POSTGRES_PASSWORD", "OPENAI_API_KEY"):
        assert value not in record_text + result.stdout + result.stderr
    expected_files = f"{shared},{workspace / '.env'}"
    assert all(command["selected_files"] == expected_files for command in commands)
    # A new terminal has no credentials or stack variables, and can resume even
    # from another cwd. This runs actual Compose config only, never the daemon.
    clean = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"]}
    resumed = subprocess.run(
        ["bash", "-c", 'source "$1"; docker compose config --format json', "bash", str(record)],
        cwd=tmp_path,
        env=clean,
        capture_output=True,
        text=True,
    )
    assert resumed.returncode == 0, "Recorded selection must render in a new terminal"
    graph = json.loads(resumed.stdout)
    assert graph["name"] == project
    postgres = graph["services"]["postgres"]["environment"]
    assert postgres["POSTGRES_PASSWORD"] == "fixture-postgres-secret"
    assert postgres["POSTGRES_USER"] == "fixture_owner"
    assert postgres["POSTGRES_DB"] == "fixture_db"
    server = graph["services"]["animama-server"]
    assert server["environment"]["OPENAI_API_KEY"] == "fixture-provider-secret"
    assert server["environment"]["ANIMAMA_PUBLIC_ORIGIN"] == "http://fixture.localhost:9180"
    for suffix, expected in (
        ("MODEL", "gpt-5.6-luna"),
        ("PROVIDER", "OpenAIResponsesHTTPAgent"),
        ("REASONING_EFFORT", "none"),
    ):
        assert server["environment"]["ANIMAMA_CHAT_TITLE_GENERATION_" + suffix] == expected
    assert next(mount for mount in server["volumes"] if mount["target"] == "/var/lib/animama/content/included")[
        "source"
    ] == str(included)


@pytest.mark.parametrize("mismatch", ["project", "checkout"])
def test_reset_rejects_sourced_other_stack_before_any_mutation(tmp_path: Path, mismatch: str) -> None:
    workspace = tmp_path / "animama"
    variables = {
        "ANIMAMA_STACK_REPO_ROOT": str(workspace if mismatch == "project" else tmp_path / "other"),
        "COMPOSE_PROJECT_NAME": "animama-old",
    }
    result, commands, workspace = _run_reset(tmp_path, ["--name", "new"], variables)
    assert result.returncode != 0
    assert "sourced stack belongs to another" in result.stderr
    assert not commands
    assert not (workspace / ".animama-stack.env").exists()


@pytest.mark.parametrize("project", [None, "custom-project"])
def test_reset_record_replaces_a_previous_terminal_project(tmp_path: Path, project: str | None) -> None:
    variables = {"COMPOSE_PROJECT_NAME": project} if project else {}
    result, _, workspace = _run_reset(tmp_path, [], variables)
    assert result.returncode == 0, result.stderr
    record = workspace / ".animama-stack.env"
    # Simulate sourcing this stack after working on another project. Both the
    # Compose identity and filesystem roots must now belong to this record.
    env = {"PATH": os.environ["PATH"], "COMPOSE_PROJECT_NAME": "animama-other-task"}
    resumed = subprocess.run(
        [
            "bash",
            "-e",
            "-c",
            'source "$1"; source "$2"; animama_state_configure ""; '
            'printf "%s\\n" "$COMPOSE_PROJECT_NAME" "$ANIMAMA_STATE_PROJECT" "$ANIMAMA_STATE_LOCAL_ROOT"',
            "bash",
            str(record),
            str(workspace / "scripts/local-stack-state-common.sh"),
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    assert resumed.returncode == 0, resumed.stderr
    local_root = workspace / ".animama-stacks" / project / "content/local" if project else workspace / "content/local"
    assert resumed.stdout.splitlines() == [project or "animama", project or "animama", str(local_root)]
