"""Conservative, pure CI selection and fail-closed aggregate policy."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import PurePosixPath

from browser_tests import GROUPS

PLAN_KEYS = {"schema_version", "mode", "reason", "required", "skipped"}
BASE = {"checkout", "ci-policy-tests", "select"}
COMMON = {"uv", "uv-sync", "rg-setup", "audit"}
PYTHON = {"backend-format", "backend-lint", "backend-types"}
FRONTEND = {
    "node",
    "pnpm-setup",
    "pnpm-store",
    "pnpm-install",
    "frontend-prepare",
    "frontend-lint",
    "frontend-types",
    "desktop-types",
    "packages-types",
    "harness-types",
    "sdk-freshness",
}
FULL = (
    COMMON
    | PYTHON
    | FRONTEND
    | {
        "hydrate",
        "browser-install",
        "model-inputs",
        "repository-imports",
        "repository-dependencies",
        "lfs-integrity",
        "backend-tests",
        "tooling-tests",
        "harness-unit",
        "harness-scripts",
        "sdk-tests",
        "packages-tests",
        "web-tests",
        "browser-tests",
        "desktop-tests",
        "web-build",
        "browser-smoke",
        "package-build",
        "package-consumers",
        "compose-check",
        "baseline-checkout",
        "package-compat",
        "workspace-reclaim",
        "package-artifacts",
    }
)
# Action timings are available in the job API; every command has a hashed receipt.
UNTIMED = {"checkout", "select", "uv", "node", "baseline-checkout", "package-artifacts"}
# Expensive work an ordinary run skips unless its own inputs changed; promotion
# runs execute all of it. The browser groups keep their step: the runner
# receives the selected groups.
SUITES = {
    "promotion": {
        "package-build",
        "package-consumers",
        "workspace-reclaim",
        "baseline-checkout",
        "package-compat",
        "package-artifacts",
    },
    "browser-hosted": set(),
    "browser-tooling": set(),
}
SUITE_REASONS = {
    "promotion": "No packaging or consumer script changed; package build, installed and whole-application "
    "consumers, baseline comparison and set upload run on promotion runs",
    "browser-hosted": "No hosted-screen input changed; the hosted screens run on promotion runs",
    "browser-tooling": "No effect or animation tooling input changed; the tooling renders run on promotion runs",
}
PROFILES = {
    "full": FULL,
    # An ordinary PR or main run with recorded skips; never promotion-complete.
    "selective": FULL,
    "docs": COMMON | {"docs-tests"},
    "backend": COMMON | PYTHON | {"accountless-guards"},
    "web": COMMON | FRONTEND | {"accountless-guards"},
    "deferred": set(),
    "unchanged": set(),
    "reused": set(),
}
LOCAL_CHECKS = {"backend": {"backend-full"}, "web": {"frontend-source", "browser-smoke"}}
PR_ACTIONS = {
    "opened",
    "synchronize",
    "reopened",
    "ready_for_review",
    "converted_to_draft",
    "labeled",
    "unlabeled",
    "edited",
}
SHARED_TESTS = {
    "test_accountless_repository_boundaries.py",
    "test_compose_network_boundaries.py",
    "test_desktop_runtime_packaging.py",
    "test_included_content_integrity.py",
    "test_model_store.py",
    "test_browser_model_store.py",
    "test_webgpu_model_store.py",
    "test_generate_synthetic_docs.py",
}


def _required(mode: str, skipped: Iterable[str] = ()) -> list[str]:
    omitted = set().union(*(SUITES[suite] for suite in skipped))
    return sorted((BASE | PROFILES[mode]) - omitted)


def _plan(mode: str, reason: str, skipped: Iterable[str] = ()) -> dict[str, object]:
    rows = [{"suite": suite, "reason": SUITE_REASONS[suite]} for suite in sorted(skipped)]
    return {
        "schema_version": 3,
        "mode": mode,
        "reason": reason,
        "required": _required(mode, skipped),
        "skipped": rows,
    }


def _path(value: object) -> bool:
    return (
        isinstance(value, str)
        and bool(value)
        and not value.startswith("/")
        and "\\" not in value
        and all(part not in {"", ".", ".."} for part in value.split("/"))
        and not any(ord(char) < 32 for char in value)
    )


def _area(path: str, excluded: set[str]) -> str | None:
    p = PurePosixPath(path)
    if path in excluded or p.name in {"AGENTS.md", "SKILL.md", "PLANS.md"}:
        return None
    # docs/safety is bundled into the web app (Safety page and dialog), so it is
    # a frontend build input rather than documentation-only.
    if path.startswith("docs/safety/"):
        return None
    if path.startswith("docs/") and p.suffix == ".md":
        return "docs"
    if p.parent == PurePosixPath("tests") and p.name.startswith("test_") and p.suffix == ".py":
        if p.name not in SHARED_TESTS and not any(word in p.stem for word in ("support", "helper", "fixture")):
            return "backend"
    # Pure formatting helpers are the initial bounded backend production allowlist.
    if path == "src/backend/animama/app/services/memory_entry_diff.py":
        return "backend"
    # ui/ also contains persistence, runtime and settings code. Admit only
    # reviewed presentation primitives; new paths and new dependencies stay full.
    if p.parent == PurePosixPath("src/frontend/web/src/ui/components") and p.name in {
        "button.tsx",
        "card.tsx",
        "checkbox.tsx",
        "input.tsx",
        "label.tsx",
        "textarea.tsx",
        "radio-group.tsx",
        "switch.tsx",
    }:
        return "web"

    return None


def classify(changes: object, excluded_paths: Iterable[str] = ()) -> str:
    """Only modified, known homogeneous areas can reduce execution."""
    if not isinstance(changes, list) or not changes or isinstance(excluded_paths, str | bytes):
        return "full"
    try:
        excluded = set(excluded_paths)
    except (TypeError, ValueError):
        return "full"
    if any(not _path(path) for path in excluded):
        return "full"
    areas = set()
    for change in changes:
        if not isinstance(change, dict) or set(change) != {"status", "old_path", "path"}:
            return "full"
        if change["status"] != "M" or change["old_path"] is not None or not _path(change["path"]):
            return "full"
        area = _area(change["path"], excluded)
        if area is None:
            return "full"
        areas.add(area)
    return areas.pop() if len(areas) == 1 else "full"


ALL_SUITES = frozenset(SUITES)
PROMOTION = frozenset({"promotion"})
TOOLING = frozenset({"browser-tooling"})
HOSTED = frozenset({"browser-hosted"})
NONE: frozenset[str] = frozenset()
# Ordinary PR runs and main pushes run each suite only when its own inputs
# changed. Promotion runs (manual dispatch, release callers, the weekly
# checkpoint and PRs labelled ci:full) run every suite. Product code, content,
# documentation and unrecognized paths therefore select none: the owner
# accepted (2026-10-14, #503) that packaging, authoring-tool and hosted-screen
# regressions they cause surface on the next promotion run. Changes to how
# checks run, which dependencies resolve or what every browser test loads
# still select every suite.
EVERYTHING_PREFIXES = (
    ".github/",
    "scripts/ci/",
    "src/frontend/patches/",
    "src/frontend/web/vite-plugins/",
    # The Vite configuration verifies and serves these speech model inputs.
    "models/",
    "scripts/models/",
)
EVERYTHING_FILES = {
    "uv.lock",
    "pyproject.toml",
    "src/frontend/package.json",
    "src/frontend/pnpm-lock.yaml",
    "src/frontend/pnpm-workspace.yaml",
    "src/frontend/web/package.json",
    "src/frontend/web/vite.config.ts",
    # Read by the Vite configuration as well as the hosted build.
    "src/frontend/desktop/package.json",
}
# The promotion suite's own packaging and consumer scripts.
PROMOTION_PREFIXES = ("scripts/package-sets/", "scripts/repository-boundary/")
# Preview-session modules that only the authoring tools load.
TOOLING_PREFIXES = ("src/frontend/web/src/lib/avatar/motion-authoring/preview/",)
# The hosted composition and the fixtures its browser files mount.
HOSTED_PREFIXES = (
    "src/frontend/web/tests/fixtures/hosted-composition/",
    "src/frontend/web/tests/fixtures/retained-screens/",
    "src/frontend/web/src/app/hosted-runtime/",
)
HOSTED_FILES = {"src/frontend/web/src/main.hosted.tsx"}
WEB_SCRIPTS = "src/frontend/web/scripts/"


def _web_script_suites(name: str) -> frozenset[str]:
    """Web scripts are tooling and tests; each browser file selects its own group."""
    if name.endswith(".browser.test.mjs"):
        stem = name.split("/")[-1].removesuffix(".browser.test.mjs")
        return TOOLING if stem in GROUPS["tooling"] else HOSTED if stem in GROUPS["hosted"] else NONE
    if name.endswith(".test.mjs"):
        return NONE
    if name.startswith("fixtures/"):
        # Shared browser setup; the whole-application consumer also copies
        # fixtures/hosted-workflows-http.mjs.
        return ALL_SUITES
    # The animation and effect tools, their preview pages and renderer stages.
    if name.startswith(("animation", "effect")):
        return TOOLING
    return NONE


def _path_suites(path: str) -> frozenset[str]:
    if path in EVERYTHING_FILES or path.startswith(EVERYTHING_PREFIXES):
        return ALL_SUITES
    if path.startswith(WEB_SCRIPTS):
        return _web_script_suites(path.removeprefix(WEB_SCRIPTS))
    if path.startswith(PROMOTION_PREFIXES):
        return PROMOTION
    if path.startswith(TOOLING_PREFIXES):
        return TOOLING
    if path in HOSTED_FILES or path.startswith(HOSTED_PREFIXES):
        return HOSTED
    # The backend, web app, packages, content, contracts, docs, tests and
    # unrecognized paths: promotion runs cover their packaging and browser groups.
    return NONE


def select_suites(changes: object, excluded_paths: Iterable[str] = ()) -> set[str]:
    """Suites whose own inputs an ordinary run changed; uncertainty selects every suite."""
    if not isinstance(changes, list) or not changes or isinstance(excluded_paths, str | bytes):
        return set(ALL_SUITES)
    try:
        excluded = set(excluded_paths)
    except (TypeError, ValueError):
        return set(ALL_SUITES)
    if any(not _path(path) for path in excluded):
        return set(ALL_SUITES)
    selected: set[str] = set()
    for change in changes:
        if not isinstance(change, dict) or set(change) != {"status", "old_path", "path"}:
            return set(ALL_SUITES)
        for path in (change["old_path"], change["path"]):
            if path is None and change["path"] is not None:
                continue
            if not _path(path) or path in excluded:
                return set(ALL_SUITES)
            selected |= _path_suites(path)
    return selected


def choose_plan(
    event_name: str,
    event: Mapping[str, object],
    changes: list[dict[str, object]] | None,
    diff_error: str | None = None,
    reusable: bool = False,
    excluded_paths: Iterable[str] = (),
    local_reviewed: bool = False,
    periodic_unchanged: bool = False,
    hosted_verified: bool = False,
    special_paths: Iterable[str] | None = None,
) -> dict[str, object]:
    """A reviewed local assertion reduces routine work, never high-risk/full requests."""
    if reusable or not isinstance(event_name, str) or event_name not in {"pull_request", "push", "schedule"}:
        return _plan("full", "Manual, release and unknown callers require full validation")
    if event_name == "schedule":
        return _plan(
            "unchanged" if periodic_unchanged is True else "full",
            "Weekly main checkpoint: unchanged" if periodic_unchanged is True else "Weekly full main checkpoint",
        )
    if not isinstance(event, Mapping):
        return _plan("full", "Malformed event")
    if event_name == "push" and event.get("ref") != "refs/heads/main":
        return _plan("full", "Only main pushes can reduce hosted validation")
    if event_name == "pull_request":
        pr = event.get("pull_request")
        if (
            not isinstance(event.get("action"), str)
            or event["action"] not in PR_ACTIONS
            or not isinstance(pr, Mapping)
            or type(pr.get("draft")) is not bool
        ):
            return _plan("full", "Malformed PR action or draft metadata")
        labels = pr.get("labels")
        if not isinstance(labels, list) or any(
            not isinstance(label, Mapping) or not isinstance(label.get("name"), str) for label in labels
        ):
            return _plan("full", "Malformed PR labels")
        if any(label["name"] == "ci:full" for label in labels):
            return _plan("full", "Persistent ci:full requests full validation")
        if pr["draft"]:
            return _plan("deferred", "Draft deferral is not acceptance")
    if diff_error is not None:
        return _plan("full", "Complete changed-file discovery unavailable")
    if event_name == "push" and hosted_verified is True:
        return _plan("reused", "Verified full hosted PR validation covers this exact merged result and baseline")
    area = classify(changes, excluded_paths)
    if area == "docs":
        return _plan("docs", "Existing eligible documentation: independent focused hosted checks")
    if area in LOCAL_CHECKS and local_reviewed is True:
        return _plan(area, "Owner-reviewed exact local evidence; hosted result covers only selected checks")
    if event_name in {"pull_request", "push"}:
        # An ordinary PR run or main push: promotion runs (ci:full, manual,
        # release and the weekly checkpoint) returned above. Callers pass only
        # special files here; changed imports do not alter suite inputs.
        special = excluded_paths if special_paths is None else special_paths
        skipped = ALL_SUITES - select_suites(changes, special)
        if skipped:
            return _plan("selective", "Ordinary run; unselected suites run on promotion runs", skipped)
    return _plan("full", "Validation, dependency, browser-harness or uncertain inputs select every suite")


def _skipped_suites(rows: object) -> list[str] | None:
    """Return the recorded suites only for a sorted, unique, explained list."""
    if not isinstance(rows, list):
        return None
    suites = []
    for row in rows:
        if (
            not isinstance(row, dict)
            or set(row) != {"suite", "reason"}
            or row["suite"] not in SUITES
            or not isinstance(row["reason"], str)
            or not row["reason"].strip()
        ):
            return None
        suites.append(row["suite"])
    return suites if suites == sorted(set(suites)) else None


def evaluate(plan: object, steps: object) -> dict[str, object]:
    """Failed, absent or unexpected skips cannot be hidden by a successful final step."""

    def fail(reason: str) -> dict[str, object]:
        return {"success": False, "reason": reason}

    if not isinstance(plan, dict) or set(plan) != PLAN_KEYS:
        return fail("Malformed plan fields")
    mode = plan.get("mode")
    if (
        type(plan.get("schema_version")) is not int
        or plan["schema_version"] != 3
        or not isinstance(mode, str)
        or mode not in PROFILES
        or not isinstance(plan.get("reason"), str)
        or not plan["reason"].strip()
    ):
        return fail("Malformed or inconsistent required-step plan")
    skipped = _skipped_suites(plan.get("skipped"))
    if skipped is None or bool(skipped) != (mode == "selective") or plan.get("required") != _required(mode, skipped):
        return fail("Malformed or inconsistent required-step plan")
    if not isinstance(steps, dict):
        return fail("Missing step results")
    for name in set().union(*(SUITES[suite] for suite in skipped)):
        step = steps.get(name)
        if step is not None and (not isinstance(step, dict) or step.get("outcome") != "skipped"):
            return fail(f"Step ran although its suite was skipped: {name}")
    for name in plan["required"]:
        step = steps.get(name)
        if not isinstance(step, dict) or step.get("outcome") != "success" or step.get("conclusion") != "success":
            return fail(f"Required step did not succeed: {name}")
    for name, step in steps.items():
        if (
            not isinstance(step, dict)
            or not isinstance(step.get("outcome"), str)
            or not isinstance(step.get("conclusion"), str)
            or step["outcome"] not in {"success", "skipped"}
            or step["conclusion"] not in {"success", "skipped"}
        ):
            return fail(f"Unexpected failed/cancelled result: {name}")
    if mode == "deferred":
        return fail("Draft deferral is not acceptance")
    return {"success": True, "reason": "All selected hosted checks passed; consult selection for deferred coverage"}
