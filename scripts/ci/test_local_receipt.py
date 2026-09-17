"""Local evidence selection rejects stale, edited and unreviewed assertions."""

from __future__ import annotations

import copy
import json
import unittest
from datetime import UTC, datetime, timedelta

from local_receipt import (
    REVIEW_MARKER,
    canonical_receipt_digest,
    find_reviewed_receipt,
    receipt_comment_body,
    validate_receipt,
)

NOW = datetime(2026, 9, 17, 12, tzinfo=UTC)
COMMIT, TREE, BASE = "a" * 40, "b" * 40, "c" * 40


def timestamp(delta=timedelta()):
    return (NOW + delta).isoformat().replace("+00:00", "Z")


def receipt():
    return {
        "schema_version": 1,
        "policy": "local-first-v1",
        "source_commit": COMMIT,
        "source_tree": TREE,
        "baseline": BASE,
        "completed_at": timestamp(timedelta(minutes=-10)),
        "environment": {
            "os": "Linux",
            "architecture": "x86_64",
            "python": "3.12.13",
            "node": "24.15.0",
            "pnpm": "10.33.0",
            "uv": "0.11.28",
            "isolated": True,
            "frozen": True,
        },
        "checks": [
            {
                "id": "backend-full",
                "status": "passed",
                "command": ["make", "check-test"],
                "duration_seconds": 73.1,
                "log_sha256": "d" * 64,
            }
        ],
        "limitations": ["Owner-reviewed assertion; no independent CI execution implied."],
    }


def comment(body, identifier=1, delta=timedelta(minutes=-5), owner="raymond-van"):
    return {
        "id": identifier,
        "body": body,
        "user": {"login": owner},
        "created_at": timestamp(delta),
        "updated_at": timestamp(delta),
    }


def review(value):
    return comment(f"{REVIEW_MARKER} {canonical_receipt_digest(value)}", identifier=2)


def context():
    return {
        "expected_commit": COMMIT,
        "expected_tree": TREE,
        "expected_baseline": BASE,
        "required_checks": ["backend-full"],
        "now": NOW,
        "owner": "raymond-van",
    }


def validate(value, **changes):
    return validate_receipt(value, **(context() | {"review": review(value)} | changes))


class ReceiptValidationTests(unittest.TestCase):
    def test_exact_evidence_and_canonical_digest(self):
        value = receipt()
        result = validate(value)
        self.assertTrue(result["accepted"])
        self.assertEqual(result["trust"], "owner-reviewed-local-assertion")
        self.assertEqual(result["receipt_sha256"], canonical_receipt_digest(dict(reversed(list(value.items())))))
        self.assertIn("not independent CI evidence", result["reason"])

    def test_exact_commit_tree_and_baseline(self):
        for field in ("source_commit", "source_tree", "baseline"):
            value = receipt()
            value[field] = "e" * 40
            with self.subTest(field=field):
                self.assertFalse(validate(value)["accepted"])
        value = receipt()
        value["source_commit"] = "e" * 40
        self.assertTrue(validate(value, expected_commit=None)["accepted"])
        value["source_tree"] = "e" * 40
        self.assertFalse(validate(value, expected_commit=None)["accepted"])

    def test_malformed_schema_fields_and_source(self):
        for key, values in {
            "schema_version": [True, "1", 2],
            "policy": [None, "other", []],
            "source_commit": [None, "A" * 40, "a" * 39],
            "limitations": [None, "none", [""], [False]],
            "completed_at": [None, "2026-09-17T12:00:00", "not-a-date", "2026-09-17T12:00:00+01:00"],
        }.items():
            for invalid in values:
                value = receipt()
                value[key] = invalid
                with self.subTest(key=key, value=invalid):
                    self.assertFalse(validate(value)["accepted"])
        for value in (None, [], {}, receipt() | {"ignore_failures": True}):
            self.assertFalse(validate_receipt(value, review={}, **context())["accepted"])

    def test_stale_future_and_boundary_ages(self):
        for delta in (timedelta(days=-7, seconds=-1), timedelta(minutes=5, seconds=1)):
            value = receipt()
            value["completed_at"] = timestamp(delta)
            self.assertFalse(validate(value)["accepted"])
        value = receipt()
        value["completed_at"] = timestamp(timedelta(days=-7))
        self.assertTrue(validate(value)["accepted"])

    def test_environment_is_strict(self):
        for field, invalid in {
            "os": "Darwin",
            "architecture": "",
            "python": "3.10",
            "node": "22",
            "pnpm": "9",
            "uv": "0.10",
            "isolated": 1,
            "frozen": False,
        }.items():
            value = receipt()
            value["environment"][field] = invalid
            self.assertFalse(validate(value)["accepted"])
        for invalid in (None, {}, receipt()["environment"] | {"trusted": True}):
            value = receipt()
            value["environment"] = invalid
            self.assertFalse(validate(value)["accepted"])

    def test_missing_duplicate_and_nonpassing_checks(self):
        for checks in (None, [], [receipt()["checks"][0]] * 2, [{}]):
            value = receipt()
            value["checks"] = checks
            self.assertFalse(validate(value)["accepted"])
        for status in ("failed", "skipped", "cancelled", "timed_out", "success", None):
            value = receipt()
            value["checks"][0]["status"] = status
            self.assertFalse(validate(value)["accepted"])
        value = receipt()
        value["checks"].append(value["checks"][0] | {"id": "install"})
        self.assertTrue(validate(value)["accepted"])
        value["checks"][1]["status"] = "failed"
        self.assertFalse(validate(value)["accepted"])

    def test_check_details_are_required_and_bounded(self):
        for key, values in {
            "id": [None, "", []],
            "command": [None, [], "make check-test", [False], [""]],
            "duration_seconds": [None, True, -1, "1", 10**400],
            "log_sha256": [None, "d" * 63, "D" * 64],
        }.items():
            for invalid in values:
                value = receipt()
                value["checks"][0][key] = invalid
                with self.subTest(key=key, value=invalid):
                    self.assertFalse(validate(value)["accepted"])
        for invalid in (float("nan"), float("inf")):
            value = receipt()
            value["checks"][0]["duration_seconds"] = invalid
            self.assertFalse(validate_receipt(value, review={}, **context())["accepted"])

    def test_changed_receipt_requires_new_digest_review(self):
        value = receipt()
        approved = review(value)
        value["checks"][0]["duration_seconds"] = 74
        self.assertFalse(validate(value, review=approved)["accepted"])
        for patch in ({"user": {"login": "someone-else"}}, {"body": approved["body"] + "\n"}, {"user": None}):
            self.assertFalse(validate(receipt(), review=approved | patch)["accepted"])

    def test_owner_review_timestamp_validation(self):
        for delta in (timedelta(minutes=-11), timedelta(minutes=6), timedelta(days=-8)):
            approval = review(receipt())
            approval["created_at"] = approval["updated_at"] = timestamp(delta)
            self.assertFalse(validate(receipt(), review=approval)["accepted"])
        approval = review(receipt())
        approval["updated_at"] = timestamp(timedelta(minutes=-6))
        self.assertFalse(validate(receipt(), review=approval)["accepted"])
        approval["updated_at"] = None
        self.assertFalse(validate(receipt(), review=approval)["accepted"])

    def test_invalid_caller_context_fails_closed(self):
        for changes in (
            {"required_checks": []},
            {"required_checks": None},
            {"required_checks": "backend-full"},
            {"required_checks": ["backend-full", "backend-full"]},
            {"required_checks": [[]]},
            {"now": NOW.replace(tzinfo=None)},
            {"now": None},
            {"owner": ""},
            {"expected_tree": None},
        ):
            self.assertFalse(validate(receipt(), **changes)["accepted"])


class CommentSelectionTests(unittest.TestCase):
    def comments(self):
        value = receipt()
        return [comment(receipt_comment_body(value), delta=timedelta(minutes=-8)), review(value)]

    def test_comment_lookup_and_unrelated_comments(self):
        result = find_reviewed_receipt(self.comments() + [comment("ordinary discussion")], **context())
        self.assertTrue(result["accepted"])
        self.assertEqual(result["receipt_comment_id"], 1)
        self.assertFalse(find_reviewed_receipt([], **context())["accepted"])
        self.assertFalse(find_reviewed_receipt([None], **context())["accepted"])

    def test_modified_comment_needs_later_review_even_for_same_digest(self):
        comments = self.comments()
        comments[0]["updated_at"] = timestamp(timedelta(minutes=-1))
        self.assertFalse(find_reviewed_receipt(comments, **context())["accepted"])
        comments[1]["updated_at"] = timestamp()
        self.assertTrue(find_reviewed_receipt(comments, **context())["accepted"])

    def test_latest_receipt_does_not_resurrect_old_evidence(self):
        comments = self.comments()
        changed = copy.deepcopy(receipt())
        changed["source_tree"] = "e" * 40
        comments.append(comment(receipt_comment_body(changed), identifier=3, delta=timedelta(minutes=-1)))
        self.assertFalse(find_reviewed_receipt(comments, **context())["accepted"])

    def test_same_second_supersession_uses_comment_identity(self):
        comments = self.comments()
        changed = receipt()
        changed["source_tree"] = "e" * 40
        newer = comment(receipt_comment_body(changed), identifier=3, delta=timedelta(minutes=-8))
        for items in (comments + [newer], [newer] + comments):
            self.assertFalse(find_reviewed_receipt(items, **context())["accepted"])
        comments[0]["id"] = "1"
        self.assertFalse(find_reviewed_receipt(comments, **context())["accepted"])

    def test_malformed_json_duplicates_and_missing_owner_review(self):
        for body in (
            "animama-local-receipt-v1\n```json\n{}\n```",
            "animama-local-receipt-v1\n```json\n{invalid}\n```",
            "animama-local-receipt-v1\n```json\n" + json.dumps(receipt())[:-1] + ',"schema_version":1}\n```',
            "animama-local-receipt-v1 " + json.dumps(receipt()),
            "animama-local-receipt-v1" + " " * 65000,
        ):
            comments = self.comments()
            comments[0]["body"] = body
            self.assertFalse(find_reviewed_receipt(comments, **context())["accepted"])
        comments = self.comments()
        comments[1]["user"]["login"] = "another-contributor"
        self.assertFalse(find_reviewed_receipt(comments, **context())["accepted"])
        comments = self.comments()
        comments[0]["updated_at"] = "malformed"
        self.assertFalse(find_reviewed_receipt(comments, **context())["accepted"])


if __name__ == "__main__":
    unittest.main()
