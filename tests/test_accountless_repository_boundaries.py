"""Repository guards for the accountless local composition."""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _source_files(root: Path, suffixes: tuple[str, ...]) -> Iterable[Path]:
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in suffixes:
            continue
        relative = path.relative_to(REPO_ROOT).as_posix()
        if any(part in relative for part in ("/node_modules/", "/dist/", "/__pycache__/")):
            continue
        if ".test." in path.name or path.name.startswith("test_"):
            continue
        if relative.startswith("src/frontend/packages/runtime-contracts/src/generated/"):
            continue
        yield path


def _matches(files: Iterable[Path], patterns: dict[str, re.Pattern[str]]) -> list[str]:
    violations: list[str] = []
    for path in files:
        source = path.read_text(encoding="utf-8")
        for label, pattern in patterns.items():
            if pattern.search(source):
                violations.append(f"{path.relative_to(REPO_ROOT).as_posix()}: {label}")
    return violations


def test_active_local_code_has_no_credential_era_auth_or_security_mode_switch() -> None:
    """Prevent an account or deployment mode from returning to the local build."""

    files = [
        *_source_files(REPO_ROOT / "src/backend/animama", (".py",)),
        *_source_files(REPO_ROOT / "src/frontend/server/src", (".ts", ".tsx")),
        *_source_files(REPO_ROOT / "src/frontend/web/src", (".ts", ".tsx")),
        *_source_files(REPO_ROOT / "src/frontend/packages", (".ts", ".tsx")),
        *_source_files(REPO_ROOT / "tests/loadtest", (".py",)),
        REPO_ROOT / "docker-compose.yml",
        REPO_ROOT / "reset.sh",
        REPO_ROOT / "src/frontend/server/package.json",
        REPO_ROOT / "src/frontend/web/package.json",
    ]
    patterns = {
        "local Better Auth": re.compile(r"better-auth|BetterAuth|BETTER_AUTH|/api/auth/"),
        "test-user authentication bypass": re.compile(r"X-Test-User|ANIMAMA_AUTH_BYPASS"),
        "retired authenticated-network mode": re.compile(r"authenticated_network|loopback_single_user"),
        "security-changing composition mode": re.compile(
            r"\b(?:ANIMAMA_MODE|DEPLOYMENT_MODE)\b|\bhosted\s*=\s*true\b",
            re.IGNORECASE,
        ),
    }
    assert _matches(files, patterns) == []


def test_browser_and_load_tools_have_no_direct_fastapi_or_bearer_path() -> None:
    """Browser-shaped callers must use same-origin Hono without bearer state."""

    browser_files = [
        *_source_files(REPO_ROOT / "src/frontend/web/src", (".ts", ".tsx")),
        *_source_files(REPO_ROOT / "src/frontend/packages", (".ts", ".tsx")),
        *_source_files(REPO_ROOT / "src/frontend/server/src", (".ts", ".tsx")),
        *_source_files(REPO_ROOT / "tests/loadtest", (".py",)),
    ]
    patterns = {
        "direct FastAPI loopback URL": re.compile(r"https?://(?:localhost|127\.0\.0\.1):8000"),
        "browser API-origin configuration": re.compile(
            r"VITE_ANIMAMA_API|NEXT_PUBLIC_ANIMAMA_API|ANIMAMA_SERVER_BASE_URL"
        ),
        "bearer credential": re.compile(r"\bBearer\s+", re.IGNORECASE),
    }
    assert _matches(browser_files, patterns) == []

    authorization_violations: list[str] = []
    authored_browser_files = [
        *_source_files(REPO_ROOT / "src/frontend/web/src", (".ts", ".tsx")),
        *_source_files(REPO_ROOT / "src/frontend/packages", (".ts", ".tsx")),
    ]
    for path in authored_browser_files:
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if "authorization" not in line.lower():
                continue
            if re.search(r"\.delete\(\s*[\"']authorization[\"']\s*\)", line, re.IGNORECASE):
                continue
            authorization_violations.append(f"{path.relative_to(REPO_ROOT).as_posix()}:{line_number}")
    assert authorization_violations == []


def test_python_route_tests_do_not_restore_header_authentication_fixtures() -> None:
    """Route-unit ownership uses dependency overrides, never magic headers."""

    files = [path for path in (REPO_ROOT / "tests").glob("test_*.py") if path.name != Path(__file__).name]
    assert (
        _matches(
            files,
            {
                "test-user authentication header": re.compile(r"X-Test-User|ANIMAMA_AUTH_BYPASS"),
                "browser bearer fixture": re.compile(r"[\"']Authorization[\"']\s*:|\bBearer\s+"),
            },
        )
        == []
    )


def test_shared_backend_layers_do_not_import_local_server_composition() -> None:
    """Shared domain and application code receive adapters instead of local globals."""

    files = [
        *_source_files(REPO_ROOT / "src/backend/animama/app", (".py",)),
        *_source_files(REPO_ROOT / "src/backend/animama/domain", (".py",)),
    ]
    assert (
        _matches(
            files,
            {"local server import": re.compile(r"^(?:from|import)\s+animama\.server\b", re.MULTILINE)},
        )
        == []
    )

    shared_services = _source_files(REPO_ROOT / "src/backend/animama/app/services", (".py",))
    assert (
        _matches(
            shared_services,
            {
                "installation singleton dependency": re.compile(
                    r"installation_settings|ORMInstallationSettings|InstallationPrincipalService"
                )
            },
        )
        == []
    )
