"""State tooling must use the selected graph and preserve backup compatibility."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("mode", ["development", "production"])
def test_state_commands_select_the_same_graph_as_reset(tmp_path: Path, mode: str) -> None:
    docker = tmp_path / "docker"
    docker.write_text(
        "#!/usr/bin/env python3\nimport json, os, sys\n"
        'print(json.dumps({"files": os.environ["COMPOSE_FILE"], "args": sys.argv[1:]}))\n',
    )
    docker.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "ANIMAMA_WEB_BUILD_MODE": mode,
        "ANIMAMA_PARAKEET_MODEL_DIR": "/verified/models",
    }
    env.pop("COMPOSE_FILE", None)
    result = subprocess.run(
        [
            "bash",
            "-c",
            'source "$1"; animama_state_configure p3; animama_state_compose ps',
            "bash",
            str(REPO_ROOT / "scripts/local-stack-state-common.sh"),
        ],
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    actual = json.loads(result.stdout)
    expected = str(REPO_ROOT / "docker-compose.yml")
    if mode == "development":
        expected += ":" + str(REPO_ROOT / "docker-compose.development.yml")
    assert actual == {"files": expected, "args": ["compose", "-p", "animama-p3", "ps"]}


def test_state_commands_preserve_the_recorded_graph(tmp_path: Path) -> None:
    docker = tmp_path / "docker"
    docker.write_text('#!/usr/bin/env bash\nprintf "%s" "$COMPOSE_FILE"\n')
    docker.chmod(0o755)
    recorded = "/fixture/base.yml:/fixture/development.yml"
    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "COMPOSE_FILE": recorded,
        "ANIMAMA_PARAKEET_MODEL_DIR": "/verified/models",
        "ANIMAMA_WEB_BUILD_MODE": "production",
    }
    result = subprocess.run(
        [
            "bash",
            "-c",
            'source "$1"; animama_state_configure p3; animama_state_compose ps',
            "bash",
            str(REPO_ROOT / "scripts/local-stack-state-common.sh"),
        ],
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    assert result.stdout == recorded


def test_backup_keeps_legacy_exclusions_without_recreating_gateway_credentials() -> None:
    backup = (REPO_ROOT / "scripts/backup-local.sh").read_text()
    restore = (REPO_ROOT / "scripts/restore-local.sh").read_text()
    assert "--exclude='./internal/gateway/token'" in backup
    assert "ANIMAMA_BACKUP_EXCLUDED=content-included,browser-cache,model-cache,secrets,gateway-token" in backup
    assert "gateway_token" not in restore
    assert "local-gateway-token.sh" not in restore
    assert "content_cli" in restore
    assert 'replacement_started" = false' in restore


@pytest.mark.parametrize("explicit_empty", [False, True])
def test_state_commands_match_reset_empty_selector_rules(tmp_path: Path, explicit_empty: bool) -> None:
    docker = tmp_path / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        'if [[ "$*" == *"config --environment"* ]]; then\n'
        '  printf "ANIMAMA_WEB_BUILD_MODE=\\n"\n'
        "else\n"
        '  printf "%s" "$COMPOSE_FILE"\n'
        "fi\n"
    )
    docker.chmod(0o755)
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "ANIMAMA_PARAKEET_MODEL_DIR": "/verified/models"}
    env.pop("COMPOSE_FILE", None)
    env.pop("ANIMAMA_WEB_BUILD_MODE", None)
    if explicit_empty:
        env["ANIMAMA_WEB_BUILD_MODE"] = ""
    result = subprocess.run(
        [
            "bash",
            "-c",
            'source "$1"; animama_state_configure p3; animama_state_compose ps',
            "bash",
            str(REPO_ROOT / "scripts/local-stack-state-common.sh"),
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    if explicit_empty:
        assert result.returncode == 2
        assert "must be development or production" in result.stderr
    else:
        assert result.returncode == 0
        assert result.stdout.endswith("/docker-compose.development.yml")


@pytest.mark.parametrize("selector", ["default", "environment", "dotenv"])
def test_state_commands_resolve_missing_model_record_offline(tmp_path: Path, selector: str) -> None:
    scripts = tmp_path / "scripts"
    (scripts / "models").mkdir(parents=True)
    helper = scripts / "local-stack-state-common.sh"
    helper.write_text((REPO_ROOT / "scripts/local-stack-state-common.sh").read_text())
    (scripts / "models/parakeet.py").write_text(
        "import sys\n"
        "assert sys.argv[1] == 'path'\n"
        "root = sys.argv[sys.argv.index('--root') + 1] if '--root' in sys.argv else '/default-model-store'\n"
        "print(root + '/parakeet-tdt-0.6b-v2/verified-version')\n"
    )
    docker = tmp_path / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        'if [[ "$*" == *"config --environment"* ]]; then\n'
        '  printf "ANIMAMA_MODEL_ROOT=%s\\n" "$TEST_DOTENV_ROOT"\n'
        "else\n"
        '  printf "%s" "$ANIMAMA_PARAKEET_MODEL_DIR"\n'
        "fi\n"
    )
    docker.chmod(0o755)
    environment = {key: value for key, value in os.environ.items() if not key.startswith(("ANIMAMA_", "COMPOSE_"))}
    environment.update(PATH=f"{tmp_path}:{os.environ['PATH']}", ANIMAMA_WEB_BUILD_MODE="production")
    root = "/default-model-store"
    if selector == "environment":
        root = "/environment models"
        environment["ANIMAMA_MODEL_ROOT"] = root
    if selector == "dotenv":
        root = "/dotenv models"
        environment["TEST_DOTENV_ROOT"] = root
    result = subprocess.run(
        ["bash", "-c", 'source "$1"; animama_state_configure p2; animama_state_compose ps', "bash", str(helper)],
        env=environment,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout == root + "/parakeet-tdt-0.6b-v2/verified-version"
