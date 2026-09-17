"""Read-only GitHub discovery for local assertions and unchanged scheduled runs.

API records establish who reviewed a receipt; they do not independently verify
the local commands claimed by that receipt. Failed or incomplete discovery must
retain full hosted coverage.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from collections.abc import Callable, Mapping
from datetime import datetime

from local_receipt import find_reviewed_receipt

MAX_PAGES = 10
PAGE_SIZE = 100
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
GetJSON = Callable[[str], object]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        """Never forward a bearer token to a redirect destination."""
        return None


def _get_json(path: str) -> object:
    if not path.startswith("/repos/") or any(char in path for char in ("\r", "\n", "#")):
        raise ValueError("Unsupported GitHub API path")
    token = os.environ.get("CI_READ_TOKEN", "")
    if not token:
        raise ValueError("Missing read-only GitHub token")
    request = urllib.request.Request(
        "https://api.github.com" + path,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "animama-validation-evidence",
        },
        method="GET",
    )
    with urllib.request.build_opener(_NoRedirect()).open(request, timeout=15) as response:
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("GitHub response exceeded size bound")
    return json.loads(body)


def _repository() -> tuple[str, str]:
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Missing or malformed GitHub repository")
    return repository, repository.split("/", 1)[0]


def _sha(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def _number(value: object) -> bool:
    return type(value) is int and value > 0


def _failure(reason: str) -> dict[str, object]:
    return {"accepted": False, "reason": reason}


def _list_pages(path: str, get_json: GetJSON) -> list[Mapping[str, object]]:
    """Require a short final page; a full tenth page cannot prove completeness."""
    result = []
    separator = "&" if "?" in path else "?"
    for page in range(1, MAX_PAGES + 1):
        items = get_json(f"{path}{separator}per_page={PAGE_SIZE}&page={page}")
        if (
            not isinstance(items, list)
            or len(items) > PAGE_SIZE
            or any(not isinstance(item, Mapping) for item in items)
        ):
            raise ValueError("Malformed paginated GitHub response")
        result.extend(items)
        if len(items) < PAGE_SIZE:
            return result
    raise ValueError("GitHub pagination limit reached")


def _full_requested(pr: Mapping[str, object]) -> bool:
    labels = pr.get("labels")
    if not isinstance(labels, list) or any(
        not isinstance(label, Mapping) or not isinstance(label.get("name"), str) for label in labels
    ):
        raise ValueError("Malformed pull request labels")
    return any(label["name"] == "ci:full" for label in labels)


def _merged_pull(source_commit: str, repository: str, get_json: GetJSON) -> Mapping[str, object]:
    associated = _list_pages(f"/repos/{repository}/commits/{source_commit}/pulls", get_json)
    # A commit shared by many PRs is an unusual dependency case; avoid turning
    # inexpensive selection into an unbounded chain of detail requests.
    if len(associated) > 10:
        raise ValueError("Too many associated pull requests")
    candidates = []
    for summary in associated:
        number = summary.get("number")
        if not _number(number):
            raise ValueError("Malformed associated pull request identity")
        if summary.get("merge_commit_sha") not in (None, source_commit):
            continue
        detail = get_json(f"/repos/{repository}/pulls/{number}")
        if not isinstance(detail, Mapping) or detail.get("number") != number:
            raise ValueError("Malformed associated pull request detail")
        base = detail.get("base")
        if (
            detail.get("merged") is True
            and isinstance(detail.get("merged_at"), str)
            and bool(detail["merged_at"])
            and isinstance(base, Mapping)
            and base.get("ref") == "main"
            and detail.get("merge_commit_sha") == source_commit
        ):
            candidates.append(detail)
    if len(candidates) != 1:
        raise ValueError("Main push does not identify exactly one merged pull request")
    return candidates[0]


def review_for_event(
    event_name: str,
    event: object,
    *,
    source_commit: str,
    source_tree: str,
    baseline: str,
    required_checks: list[str],
    now: datetime,
    get_json: GetJSON | None = None,
) -> dict[str, object]:
    """Find exact-source owner-reviewed evidence, or require full validation."""
    fetch = get_json or _get_json
    try:
        repository, owner = _repository()
        if not all(_sha(value) for value in (source_commit, source_tree, baseline)) or not isinstance(event, Mapping):
            return _failure("Malformed source identity or event for local evidence")
        event_repository = event.get("repository")
        if event_repository is not None and (
            not isinstance(event_repository, Mapping) or event_repository.get("full_name") != repository
        ):
            return _failure("Event repository does not match validation repository")
        if event_name == "pull_request":
            pr = event.get("pull_request")
            number = event.get("number")
            if not isinstance(pr, Mapping) or not _number(number) or pr.get("number", number) != number:
                return _failure("Malformed pull request event identity")
        elif event_name == "push" and event.get("ref") == "refs/heads/main":
            if event.get("after") != source_commit or event.get("before") != baseline:
                return _failure("Main push source or baseline does not match event")
            pr = _merged_pull(source_commit, repository, fetch)
            number = pr["number"]
        else:
            return _failure("Only pull requests and exact merged main pushes can use local evidence")
        if _full_requested(pr):
            return _failure("Persistent ci:full label requests full hosted validation")
        head = pr.get("head")
        if not isinstance(head, Mapping) or not _sha(head.get("sha")):
            return _failure("Malformed pull request head identity")
        comments = _list_pages(f"/repos/{repository}/issues/{number}/comments", fetch)
        result = find_reviewed_receipt(
            comments,
            expected_commit=head["sha"],
            expected_tree=source_tree,
            expected_baseline=baseline,
            required_checks=required_checks,
            now=now,
            owner=owner,
        )
        result["pull_request"] = number
        result["repository"] = repository
        result["integrated_commit"] = source_commit
        return result
    except Exception:
        # Do not include exception text: transport failures can embed request
        # details. The caller records a conservative fallback, never credentials.
        return _failure("GitHub evidence discovery failed or was incomplete; full hosted validation required")


def periodic_unchanged(source_commit: str, *, get_json: GetJSON | None = None) -> bool:
    """Skip only after the latest prior scheduled run succeeded on this source."""
    fetch = get_json or _get_json
    try:
        repository, _ = _repository()
        current = os.environ.get("GITHUB_RUN_ID", "")
        if not _sha(source_commit) or not current.isdecimal() or int(current) <= 0:
            return False
        response = fetch(
            f"/repos/{repository}/actions/workflows/validate-public.yml/runs"
            "?event=schedule&branch=main&per_page=100&page=1"
        )
        if not isinstance(response, Mapping) or not isinstance(response.get("workflow_runs"), list):
            return False
        runs = response["workflow_runs"]
        if len(runs) > PAGE_SIZE or any(not isinstance(run, Mapping) or not _number(run.get("id")) for run in runs):
            return False
        previous = [run for run in runs if run["id"] != int(current)]
        if not previous:
            return False
        latest = max(previous, key=lambda run: run["id"])
        return (
            latest["id"] < int(current)
            and latest.get("event") == "schedule"
            and latest.get("head_branch") == "main"
            and latest.get("status") == "completed"
            and latest.get("conclusion") == "success"
            and latest.get("head_sha") == source_commit
        )
    except Exception:
        return False
