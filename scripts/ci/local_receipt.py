"""Validate owner-reviewed local assertions, never independent CI evidence.

The network boundary belongs to the workflow caller. This module consumes only
GitHub comment records and exact source identities supplied by that caller.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime, timedelta

RECEIPT_MARKER = "animama-local-receipt-v1"
REVIEW_MARKER = "animama-local-review-v1"
MAX_AGE = timedelta(days=7)
FUTURE_TOLERANCE = timedelta(minutes=5)
RECEIPT_KEYS = {
    "schema_version",
    "policy",
    "source_commit",
    "source_tree",
    "baseline",
    "completed_at",
    "environment",
    "checks",
    "limitations",
}
ENVIRONMENT = {"os": "Linux", "python": "3.12.13", "node": "24.15.0", "pnpm": "10.33.0", "uv": "0.11.28"}
CHECK_KEYS = {"id", "status", "command", "duration_seconds", "log_sha256"}


def canonical_receipt_digest(receipt: object) -> str:
    """Hash sorted, compact, ASCII-escaped JSON; reject non-JSON numeric values."""
    encoded = json.dumps(receipt, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def receipt_comment_body(receipt: object) -> str:
    """Render the bounded comment format; the owner review is a separate action."""
    return f"{RECEIPT_MARKER}\n```json\n{json.dumps(receipt, indent=2, allow_nan=False)}\n```"


def _timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not value.endswith(("Z", "+00:00")):
        raise ValueError("Timestamp must use explicit UTC")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() != timedelta(0):
        raise ValueError("Timestamp must use UTC")
    return parsed


def _hex(value: object, length: int) -> bool:
    return isinstance(value, str) and re.fullmatch(rf"[0-9a-f]{{{length}}}", value) is not None


def _failed(reason: str) -> dict[str, object]:
    return {"accepted": False, "reason": reason}


def _duration(value: object) -> bool:
    try:
        return type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        return False


def validate_receipt(
    receipt: object,
    *,
    expected_commit: str | None,
    expected_tree: str,
    expected_baseline: str,
    required_checks: Iterable[str],
    now: datetime,
    review: object,
    owner: str,
) -> dict[str, object]:
    """Fail closed unless exact, fresh local evidence has an owner digest review.

    ``expected_commit=None`` is reserved for a caller that has already matched
    the merged PR. Exact tree and baseline matching remain mandatory.
    """
    if (
        not isinstance(now, datetime)
        or now.utcoffset() != timedelta(0)
        or not _hex(expected_tree, 40)
        or not _hex(expected_baseline, 40)
        or (expected_commit is not None and not _hex(expected_commit, 40))
        or not isinstance(owner, str)
        or not owner
        or isinstance(required_checks, str | bytes)
    ):
        return _failed("Malformed receipt validation context")
    try:
        required = list(required_checks)
        if not required or any(not isinstance(check, str) or not check for check in required):
            return _failed("Malformed required local check IDs")
        if len(set(required)) != len(required):
            return _failed("Duplicate required local check IDs")
    except TypeError:
        return _failed("Malformed required local check IDs")
    if not isinstance(receipt, dict) or set(receipt) != RECEIPT_KEYS:
        return _failed("Malformed local receipt fields")
    if type(receipt["schema_version"]) is not int or receipt["schema_version"] != 1:
        return _failed("Unsupported local receipt schema")
    if receipt["policy"] != "local-first-v1":
        return _failed("Unsupported local receipt policy")
    for field in ("source_commit", "source_tree", "baseline"):
        if not _hex(receipt[field], 40):
            return _failed(f"Malformed local receipt {field}")
    if expected_commit is not None and receipt["source_commit"] != expected_commit:
        return _failed("Local receipt source commit does not match candidate")
    if receipt["source_tree"] != expected_tree or receipt["baseline"] != expected_baseline:
        return _failed("Local receipt tree or baseline does not match candidate")
    try:
        completed = _timestamp(receipt["completed_at"])
    except ValueError:
        return _failed("Malformed local receipt completion timestamp")
    if now - completed > MAX_AGE or completed - now > FUTURE_TOLERANCE:
        return _failed("Local receipt is stale or future-dated")
    environment = receipt["environment"]
    if (
        not isinstance(environment, dict)
        or set(environment) != set(ENVIRONMENT) | {"architecture", "isolated", "frozen"}
        or any(environment[key] != value for key, value in ENVIRONMENT.items())
        or environment["isolated"] is not True
        or environment["frozen"] is not True
        or not isinstance(environment["architecture"], str)
        or not environment["architecture"].strip()
    ):
        return _failed("Local receipt requires isolated Linux and frozen declared toolchains")
    limitations = receipt["limitations"]
    if not isinstance(limitations, list) or any(not isinstance(item, str) or not item.strip() for item in limitations):
        return _failed("Malformed local receipt limitations")
    checks = receipt["checks"]
    if not isinstance(checks, list):
        return _failed("Malformed local check records")
    seen = set()
    for check in checks:
        if not isinstance(check, dict) or set(check) != CHECK_KEYS:
            return _failed("Malformed local check record")
        check_id = check["id"]
        duration = check["duration_seconds"]
        command = check["command"]
        if not isinstance(check_id, str) or not check_id or check_id in seen:
            return _failed("Missing or duplicate local check ID")
        seen.add(check_id)
        if check["status"] != "passed":
            return _failed(f"Local check did not pass: {check_id}")
        if (
            not isinstance(command, list)
            or not command
            or any(not isinstance(arg, str) or not arg.strip() for arg in command)
            or not _duration(duration)
            or not _hex(check["log_sha256"], 64)
        ):
            return _failed(f"Malformed command, duration or log hash for local check: {check_id}")
    if not set(required) <= seen:
        return _failed("Missing required local checks: " + ", ".join(sorted(set(required) - seen)))
    try:
        digest = canonical_receipt_digest(receipt)
    except (TypeError, ValueError):
        return _failed("Local receipt cannot be represented as canonical JSON")
    if (
        not isinstance(review, Mapping)
        or not isinstance(review.get("user"), Mapping)
        or review["user"].get("login") != owner
        or review.get("body") != f"{REVIEW_MARKER} {digest}"
    ):
        return _failed("Missing exact repository-owner review of the local receipt digest")
    try:
        created = _timestamp(review.get("created_at"))
        reviewed = _timestamp(review.get("updated_at"))
    except ValueError:
        return _failed("Malformed owner review timestamps")
    if reviewed < created or reviewed < completed or now - reviewed > MAX_AGE or reviewed - now > FUTURE_TOLERANCE:
        return _failed("Owner review predates evidence, is stale or is future-dated")
    return {
        "accepted": True,
        "reason": "Fresh exact-source local receipt reviewed by repository owner; not independent CI evidence",
        "trust": "owner-reviewed-local-assertion",
        "receipt_sha256": digest,
        "source_commit": receipt["source_commit"],
        "source_tree": receipt["source_tree"],
        "baseline": receipt["baseline"],
        "required_checks": sorted(required),
        "limitations": limitations,
        "reviewed_by": owner,
        "reviewed_at": reviewed.astimezone(UTC).isoformat(),
        "review_comment_id": review.get("id"),
    }


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def find_reviewed_receipt(comments: object, **context: object) -> dict[str, object]:
    """Inspect the latest receipt comment; never resurrect superseded evidence.

    The caller supplies a complete paginated GitHub comment collection. Receipt
    authors may be contributors or automation, but only the exact owner review
    enables reduced coverage. A modified receipt needs a later matching review.
    """
    if not isinstance(comments, list) or any(not isinstance(comment, Mapping) for comment in comments):
        return _failed("Malformed GitHub comment collection")
    receipts = [comment for comment in comments if str(comment.get("body", "")).startswith(RECEIPT_MARKER)]
    if not receipts:
        return _failed("No local receipt comment")
    try:
        # GitHub timestamps have second precision. A newer comment ID must win
        # a timestamp tie, even if the API response is supplied in reverse order.
        if any(type(comment.get("id")) is not int or comment["id"] <= 0 for comment in receipts):
            return _failed("Malformed local receipt comment ID")
        receipt_comment = max(receipts, key=lambda comment: (_timestamp(comment.get("updated_at")), comment["id"]))
        published = _timestamp(receipt_comment.get("updated_at"))
        created = _timestamp(receipt_comment.get("created_at"))
        if published < created:
            return _failed("Malformed local receipt comment chronology")
        body = receipt_comment.get("body")
        if not isinstance(body, str) or len(body) > 65000:
            return _failed("Malformed or oversized local receipt comment")
        match = re.fullmatch(r"animama-local-receipt-v1\r?\n```json\r?\n(.+)\r?\n```\s*", body, re.DOTALL)
        if not match:
            return _failed("Malformed local receipt comment format")
        receipt = json.loads(match[1], object_pairs_hook=_unique_object)
        digest = canonical_receipt_digest(receipt)
    except (TypeError, ValueError, RecursionError):
        return _failed("Malformed local receipt JSON or comment timestamps")
    reviews = [comment for comment in comments if comment.get("body") == f"{REVIEW_MARKER} {digest}"]
    failure = _failed("No matching repository-owner receipt review")
    for review in reviews:
        result = validate_receipt(receipt, review=review, **context)
        if not result["accepted"]:
            failure = result
            continue
        if _timestamp(review["updated_at"]) < published:
            failure = _failed("Owner review predates the latest receipt comment update")
            continue
        result["receipt_comment_id"] = receipt_comment.get("id")
        return result
    return failure
