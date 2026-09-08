from __future__ import annotations

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TOKEN_HELPER = REPO_ROOT / "scripts" / "local-gateway-token.sh"


def _run_token_helper(action: str, token_path: Path) -> None:
    subprocess.run(
        [
            "bash",
            "-c",
            'source "$1"; "animama_gateway_token_$2" "$3"',
            "bash",
            str(TOKEN_HELPER),
            action,
            str(token_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def test_gateway_token_is_reused_then_rotated_without_output(tmp_path: Path) -> None:
    token_path = tmp_path / "runtime" / "gateway" / "token"

    _run_token_helper("prepare", token_path)
    initial = token_path.read_text(encoding="utf-8")
    assert len(initial.strip()) == 64
    assert token_path.stat().st_mode & 0o777 == 0o600

    _run_token_helper("prepare", token_path)
    assert token_path.read_text(encoding="utf-8") == initial

    _run_token_helper("rotate", token_path)
    assert token_path.read_text(encoding="utf-8") != initial
    assert token_path.stat().st_mode & 0o777 == 0o600


def test_backup_omits_replaceable_gateway_token_and_restore_rotates_it() -> None:
    backup = (REPO_ROOT / "scripts" / "backup-local.sh").read_text(encoding="utf-8")
    restore = (REPO_ROOT / "scripts" / "restore-local.sh").read_text(encoding="utf-8")

    assert "--exclude='./internal/gateway/token'" in backup
    assert "ANIMAMA_BACKUP_EXCLUDED=content-included,browser-cache,model-cache,secrets,gateway-token" in backup
    assert 'animama_gateway_token_rotate "${ANIMAMA_STATE_DATA_ROOT}/internal/gateway/token"' in restore
    assert 'content_cli' in restore
    assert 'replacement_started" = false' in restore
