"""Mocked read-only discovery must never upgrade missing evidence into trust."""

from __future__ import annotations

import copy
import os
import unittest
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from github_evidence import MAX_RESPONSE_BYTES, _get_json, _NoRedirect, periodic_unchanged, review_for_event
from local_receipt import canonical_receipt_digest, receipt_comment_body

REPO = "raymond-van/animama"
PREFIX = f"/repos/{REPO}"
HEAD, TREE, BASE, MERGE = "a" * 40, "b" * 40, "c" * 40, "d" * 40
NOW = datetime(2026, 9, 17, 12, tzinfo=UTC)


def comments():
    receipt = {
        "schema_version": 1,
        "policy": "local-first-v1",
        "source_commit": HEAD,
        "source_tree": TREE,
        "baseline": BASE,
        "completed_at": "2026-09-17T11:50:00Z",
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
                "duration_seconds": 120,
                "log_sha256": "e" * 64,
            }
        ],
        "limitations": [],
    }
    common = {"user": {"login": "raymond-van"}, "created_at": "2026-09-17T11:55:00Z"}
    return [
        common | {"id": 1, "body": receipt_comment_body(receipt), "updated_at": "2026-09-17T11:55:00Z"},
        common
        | {
            "id": 2,
            "body": f"animama-local-review-v1 {canonical_receipt_digest(receipt)}",
            "updated_at": "2026-09-17T11:56:00Z",
        },
    ]


def pull():
    return {
        "number": 7,
        "head": {"sha": HEAD},
        "base": {"ref": "main"},
        "labels": [],
        "merged": True,
        "merged_at": "2026-09-17T11:59:00Z",
        "merge_commit_sha": MERGE,
    }


def pr_event():
    return {"number": 7, "pull_request": pull(), "repository": {"full_name": REPO}}


def push_event():
    return {"ref": "refs/heads/main", "before": BASE, "after": MERGE}


def context():
    return {
        "source_commit": MERGE,
        "source_tree": TREE,
        "baseline": BASE,
        "required_checks": ["backend-full"],
        "now": NOW,
    }


def run(identifier=90, **changes):
    return {
        "id": identifier,
        "event": "schedule",
        "head_branch": "main",
        "status": "completed",
        "conclusion": "success",
        "head_sha": MERGE,
    } | changes


class FakeAPI:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.paths = []

    def __call__(self, path):
        self.paths.append(path)
        if path not in self.responses:
            raise AssertionError(f"Unexpected API request: {path}")
        value = self.responses[path]
        if isinstance(value, Exception):
            raise value
        return copy.deepcopy(value)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"GITHUB_REPOSITORY": REPO, "GITHUB_RUN_ID": "100"})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def api(self, **changes):
        responses = {
            f"{PREFIX}/issues/7/comments?per_page=100&page=1": comments(),
            f"{PREFIX}/commits/{MERGE}/pulls?per_page=100&page=1": [pull()],
            f"{PREFIX}/pulls/7": pull(),
        }
        responses.update(changes)
        return FakeAPI(responses)

    def test_pr_binds_head_but_checks_integrated_tree_and_baseline(self):
        api = self.api()
        result = review_for_event("pull_request", pr_event(), get_json=api, **context())
        self.assertTrue(result["accepted"])
        self.assertEqual(result["source_commit"], HEAD)
        self.assertEqual(result["integrated_commit"], MERGE)
        self.assertEqual(api.paths, [f"{PREFIX}/issues/7/comments?per_page=100&page=1"])
        for changes in ({"source_tree": "f" * 40}, {"baseline": "f" * 40}):
            result = review_for_event("pull_request", pr_event(), get_json=api, **(context() | changes))
            self.assertFalse(result["accepted"])
        event = pr_event()
        event["pull_request"]["head"]["sha"] = "f" * 40
        self.assertFalse(review_for_event("pull_request", event, get_json=api, **context())["accepted"])

    def test_comments_are_completely_paginated(self):
        api = self.api()
        api.responses[f"{PREFIX}/issues/7/comments?per_page=100&page=1"] = [{"body": "discussion"}] * 100
        api.responses[f"{PREFIX}/issues/7/comments?per_page=100&page=2"] = comments()
        self.assertTrue(review_for_event("pull_request", pr_event(), get_json=api, **context())["accepted"])
        self.assertEqual(len(api.paths), 2)
        for page in range(1, 11):
            api.responses[f"{PREFIX}/issues/7/comments?per_page=100&page={page}"] = [{"body": "discussion"}] * 100
        api.paths.clear()
        self.assertFalse(review_for_event("pull_request", pr_event(), get_json=api, **context())["accepted"])
        self.assertEqual(len(api.paths), 10)

    def test_permission_errors_and_malformed_responses_fall_back_without_secret_text(self):
        for response in ({}, [None], RuntimeError("secret-token-should-not-appear")):
            api = self.api()
            api.responses[f"{PREFIX}/issues/7/comments?per_page=100&page=1"] = response
            result = review_for_event("pull_request", pr_event(), get_json=api, **context())
            self.assertFalse(result["accepted"])
            self.assertNotIn("secret-token", result["reason"])

    def test_explicit_full_and_unsupported_events_avoid_receipt_fetches(self):
        event = pr_event()
        event["pull_request"]["labels"] = [{"name": "ci:full"}]
        api = FakeAPI()
        self.assertFalse(review_for_event("pull_request", event, get_json=api, **context())["accepted"])
        for event_name in ("workflow_call", "workflow_dispatch", "schedule", "unknown"):
            self.assertFalse(review_for_event(event_name, {}, get_json=api, **context())["accepted"])
        self.assertEqual(api.paths, [])

    def test_malformed_metadata_and_wrong_repository_fail_closed(self):
        for event in (
            None,
            {},
            pr_event() | {"number": True},
            pr_event() | {"repository": {"full_name": "other/repo"}},
        ):
            self.assertFalse(review_for_event("pull_request", event, get_json=FakeAPI(), **context())["accepted"])
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "https://example.test/repo"}):
            self.assertFalse(review_for_event("pull_request", pr_event(), get_json=FakeAPI(), **context())["accepted"])

    def test_main_push_requires_exact_merged_pr_and_retains_commit_binding(self):
        api = self.api()
        result = review_for_event("push", push_event(), get_json=api, **context())
        self.assertTrue(result["accepted"])
        self.assertEqual(result["source_commit"], HEAD)
        self.assertEqual(result["source_tree"], TREE)
        self.assertEqual(result["baseline"], BASE)
        for patch_values in ({"before": "f" * 40}, {"after": "f" * 40}, {"ref": "refs/heads/feature"}):
            untouched = FakeAPI()
            self.assertFalse(
                review_for_event("push", push_event() | patch_values, get_json=untouched, **context())["accepted"]
            )
            self.assertEqual(untouched.paths, [])

    def test_direct_unmerged_multiply_associated_and_full_label_pushes_fall_back(self):
        cases = [
            [],
            [pull() | {"merged": False}],
            [pull() | {"base": {"ref": "other"}}],
            [pull() | {"merge_commit_sha": "f" * 40}],
            [pull(), pull() | {"number": 8}],
            [pull() | {"labels": [{"name": "ci:full"}]}],
        ]
        for associated in cases:
            api = self.api()
            api.responses[f"{PREFIX}/commits/{MERGE}/pulls?per_page=100&page=1"] = associated
            for item in associated:
                api.responses[f"{PREFIX}/pulls/{item['number']}"] = item
            self.assertFalse(review_for_event("push", push_event(), get_json=api, **context())["accepted"])

    def test_incomplete_association_summary_uses_detail(self):
        api = self.api()
        api.responses[f"{PREFIX}/commits/{MERGE}/pulls?per_page=100&page=1"] = [{"number": 7}]
        self.assertTrue(review_for_event("push", push_event(), get_json=api, **context())["accepted"])

    def test_periodic_uses_latest_previous_schedule_only(self):
        path = f"{PREFIX}/actions/workflows/validate-public.yml/runs?event=schedule&branch=main&per_page=100&page=1"
        for latest in (
            run(),
            run(status="in_progress"),
            run(conclusion="failure"),
            run(head_sha=HEAD),
            run(event="push"),
            run(head_branch="feature"),
            run(conclusion=None),
        ):
            api = FakeAPI({path: {"workflow_runs": [run(100, status="in_progress"), run(80), latest]}})
            self.assertEqual(periodic_unchanged(MERGE, get_json=api), latest == run())
            self.assertEqual(api.paths, [path])
        for response in (
            {},
            {"workflow_runs": []},
            {"workflow_runs": [run(100)]},
            {"workflow_runs": [run(110)]},
            RuntimeError("permission denied"),
        ):
            self.assertFalse(periodic_unchanged(MERGE, get_json=FakeAPI({path: response})))


class TransportTests(unittest.TestCase):
    def test_transport_is_bounded_read_only_https_without_redirects(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok": true}'
        opener = MagicMock()
        opener.open.return_value = response
        with (
            patch.dict(os.environ, {"CI_READ_TOKEN": "test-secret"}),
            patch("github_evidence.urllib.request.build_opener", return_value=opener) as build,
        ):
            self.assertEqual(_get_json(f"{PREFIX}/issues/7/comments"), {"ok": True})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, f"https://api.github.com{PREFIX}/issues/7/comments")
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(opener.open.call_args.kwargs, {"timeout": 15})
        self.assertEqual(request.get_header("Authorization"), "Bearer test-secret")
        self.assertIsInstance(build.call_args.args[0], _NoRedirect)
        self.assertIsNone(build.call_args.args[0].redirect_request(None, None, 302, None, None, "https://example.test"))
        response.__enter__.return_value.read.assert_called_once_with(MAX_RESPONSE_BYTES + 1)

    def test_transport_rejects_wrong_urls_missing_token_and_oversize(self):
        for path in ("https://example.test", "//example.test", "/repos/test/repo\nInjected: true"):
            with self.assertRaises(ValueError):
                _get_json(path)
        with patch.dict(os.environ, {"CI_READ_TOKEN": ""}), self.assertRaises(ValueError):
            _get_json(f"{PREFIX}/issues/7/comments")
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"x" * (MAX_RESPONSE_BYTES + 1)
        opener = MagicMock()
        opener.open.return_value = response
        with (
            patch.dict(os.environ, {"CI_READ_TOKEN": "test-secret"}),
            patch("github_evidence.urllib.request.build_opener", return_value=opener),
            self.assertRaises(ValueError),
        ):
            _get_json(f"{PREFIX}/issues/7/comments")


if __name__ == "__main__":
    unittest.main()
