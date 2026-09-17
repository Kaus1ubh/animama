"""Conservative, pure CI selection and fail-closed aggregate policy."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import PurePosixPath

PLAN_KEYS = {"schema_version", "mode", "backend", "portable", "reason"}
PROFILES = {
    "full": ("full", True),
    "docs": ("docs", False),
    "backend": ("full", False),
    "frontend": ("guards", True),
    "deferred": ("none", False),
}
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
    "test_generate_synthetic_docs.py",
}
JOBS = {"validation-plan", "backend-static-tests", "portable-product", "model-store-windows"}


def _plan(mode: str, reason: str) -> dict[str, object]:
    backend, portable = PROFILES[mode]
    return {"schema_version": 1, "mode": mode, "backend": backend, "portable": portable, "reason": reason}


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
    if path.startswith("docs/") and p.suffix == ".md":
        return "docs"
    if p.parent == PurePosixPath("tests") and p.name.startswith("test_") and p.suffix == ".py":
        if p.name not in SHARED_TESTS and not any(word in p.stem for word in ("support", "helper", "fixture")):
            return "backend"
    if p.suffix in {".ts", ".tsx", ".cts", ".css"}:
        if any(word in part.lower() for part in p.parts for word in ("generated", "vendor", "catalog", "routetree")):
            return None
        if path.startswith("src/frontend/web/src/"):
            return "web"
        if path.startswith("src/frontend/desktop/src/"):
            return "desktop"
    return None


def choose_plan(
    event_name: str,
    event: Mapping[str, object],
    changes: list[dict[str, object]] | None,
    diff_error: str | None = None,
    reusable: bool = False,
    excluded_paths: Iterable[str] = (),
) -> dict[str, object]:
    """Select reduced coverage only for complete, recognized PR input."""
    if reusable or event_name != "pull_request":
        return _plan("full", "Non-PR and reusable callers require full validation")
    if not isinstance(event, Mapping) or not isinstance(event.get("action"), str) or event["action"] not in PR_ACTIONS:
        return _plan("full", "Missing or unsupported PR action")
    pr = event.get("pull_request")
    if not isinstance(pr, Mapping) or type(pr.get("draft")) is not bool:
        return _plan("full", "Malformed PR draft metadata")
    labels = pr.get("labels")
    if not isinstance(labels, list) or any(
        not isinstance(label, Mapping) or not isinstance(label.get("name"), str) for label in labels
    ):
        return _plan("full", "Malformed PR labels")
    if any(label["name"] == "ci:full" for label in labels):
        return _plan("full", "Persistent ci:full label requests full validation")
    if pr["draft"]:
        return _plan("deferred", "Draft validation deferred; this is not merge acceptance")
    if diff_error is not None or not isinstance(changes, list) or not changes:
        return _plan("full", "Changed-file discovery failed or returned an empty diff")
    if isinstance(excluded_paths, str | bytes):
        return _plan("full", "Malformed provenance exclusion paths")
    try:
        excluded = set(excluded_paths)
    except (TypeError, ValueError):
        return _plan("full", "Malformed provenance exclusion paths")
    if any(not _path(path) for path in excluded):
        return _plan("full", "Malformed provenance exclusion paths")
    areas = set()
    for change in changes:
        if not isinstance(change, dict) or set(change) != {"status", "old_path", "path"}:
            return _plan("full", "Malformed changed-file record")
        if change["status"] != "M" or change["old_path"] is not None or not _path(change["path"]):
            return _plan("full", "Additions, deletions, renames or ambiguous paths require full validation")
        area = _area(change["path"], excluded)
        if area is None:
            return _plan("full", "Cross-cutting or unknown changed path")
        areas.add(area)
    if len(areas) != 1:
        return _plan("full", "Mixed changed areas require full validation")
    area = areas.pop()
    return _plan("frontend" if area in {"web", "desktop"} else area, f"Only existing {area} files modified")


def evaluate(plan: object, needs: object) -> dict[str, object]:
    """Accept only a valid plan and successful results for every required job."""

    def fail(reason: str) -> dict[str, object]:
        return {"success": False, "reason": reason}

    if not isinstance(plan, dict) or set(plan) != PLAN_KEYS:
        return fail("Malformed plan fields")
    mode = plan.get("mode")
    if (
        type(plan.get("schema_version")) is not int
        or plan["schema_version"] != 1
        or not isinstance(mode, str)
        or mode not in PROFILES
        or type(plan.get("portable")) is not bool
        or not isinstance(plan.get("reason"), str)
        or not plan["reason"].strip()
        or (plan.get("backend"), plan["portable"]) != PROFILES[mode]
    ):
        return fail("Malformed or inconsistent plan profile")
    if not isinstance(needs, dict) or set(needs) != JOBS:
        return fail("Missing or unexpected job results")
    required = {"validation-plan"}
    if mode == "full":
        required.add("model-store-windows")
    if plan["backend"] != "none":
        required.add("backend-static-tests")
    if plan["portable"]:
        required.add("portable-product")
    for job, value in needs.items():
        if (
            not isinstance(value, dict)
            or not isinstance(value.get("result"), str)
            or value["result"] not in {"success", "skipped", "failure", "cancelled"}
        ):
            return fail(f"Malformed result for {job}")
        result = value["result"]
        if result != "success" and (job in required or result != "skipped"):
            return fail(f"Unacceptable result for {job}: {result}")
    if mode == "deferred":
        return fail("Draft deferral is not merge acceptance")
    return {"success": True, "reason": "All applicable validation succeeded"}
