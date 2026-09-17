"""Table-driven selection and aggregate failure regression tests."""

from __future__ import annotations

import copy
import unittest

from validation_policy import choose_plan, evaluate


def event(action="synchronize", draft=False, labels=()):
    return {"action": action, "pull_request": {"draft": draft, "labels": [{"name": name} for name in labels]}}


def modified(path):
    return {"status": "M", "old_path": None, "path": path}


def results(backend="success", portable="success", router="success", windows="success"):
    return {
        "validation-plan": {"result": router},
        "backend-static-tests": {"result": backend},
        "portable-product": {"result": portable},
        "model-store-windows": {"result": windows},
    }


class SelectionTests(unittest.TestCase):
    def test_owned_area_matrix(self):
        cases = {
            "docs/backend/guide.md": "docs",
            "tests/test_chat.py": "backend",
            "src/frontend/web/src/components/Chat.tsx": "frontend",
            "src/frontend/desktop/src/main.cts": "frontend",
            "src/backend/animama/app/service.py": "full",
            "src/frontend/packages/runtime-contracts/src/index.ts": "full",
            "src/frontend/web/src/routeTree.gen.ts": "full",
            "src/frontend/web/src/catalog/data.ts": "full",
            "src/frontend/web/src/vendor/lib.ts": "full",
            "src/frontend/web/vite.config.ts": "full",
            "src/frontend/e2e/journeys/library.spec.ts": "full",
            "src/frontend/pnpm-lock.yaml": "full",
            "uv.lock": "full",
            ".github/workflows/validate-public.yml": "full",
            "content/included/guide.md": "full",
            "README.md": "full",
            "docs/AGENTS.md": "full",
            "tests/conftest.py": "full",
            "tests/test_accountless_repository_boundaries.py": "full",
            "tests/test_desktop_runtime_packaging.py": "full",
            "tests/test_model_store.py": "full",
            "tests/test_browser_model_store.py": "full",
            "tests/test_fixture_helper.py": "full",
            "unknown/file.md": "full",
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                self.assertEqual(choose_plan("pull_request", event(), [modified(path)])["mode"], expected)

    def test_provenance_document_requires_full(self):
        path = "docs/architecture/notice.md"
        self.assertEqual(choose_plan("pull_request", event(), [modified(path)], excluded_paths=[path])["mode"], "full")

    def test_mixed_changes_and_nonmodifications_require_full(self):
        for changes in (
            [modified("docs/guide.md"), modified("tests/test_chat.py")],
            [modified("src/frontend/web/src/a.ts"), modified("src/frontend/desktop/src/a.ts")],
            [
                {"status": status, "old_path": "docs/old.md" if status == "R" else None, "path": "docs/new.md"}
                for status in ("A", "D", "R")
            ],
        ):
            self.assertEqual(choose_plan("pull_request", event(), changes)["mode"], "full")
        for status in ("A", "D", "R", "R100", "C", "T"):
            self.assertEqual(
                choose_plan("pull_request", event(), [{"status": status, "old_path": None, "path": "docs/a.md"}])[
                    "mode"
                ],
                "full",
            )

    def test_event_transition_matrix(self):
        for action in (
            "opened",
            "synchronize",
            "reopened",
            "ready_for_review",
            "converted_to_draft",
            "labeled",
            "unlabeled",
            "edited",
        ):
            for draft in (False, True):
                for labels in ([], ["ci:full"]):
                    with self.subTest(action=action, draft=draft, labels=labels):
                        expected = "full" if labels else "deferred" if draft else "docs"
                        self.assertEqual(
                            choose_plan("pull_request", event(action, draft, labels), [modified("docs/a.md")])["mode"],
                            expected,
                        )
        for name in ("push", "schedule", "workflow_dispatch", "workflow_call", "unknown"):
            self.assertEqual(choose_plan(name, event(draft=True), [modified("docs/a.md")])["mode"], "full")
        self.assertEqual(choose_plan("pull_request", event(draft=True), [], reusable=True)["mode"], "full")

    def test_invalid_metadata_and_discovery_fail_closed(self):
        events = [None, {}, {"action": []}, event("unknown"), event(draft="false"), event()]
        events[-1]["pull_request"]["labels"] = [{"name": []}]
        for value in events:
            self.assertEqual(choose_plan("pull_request", value, [modified("docs/a.md")])["mode"], "full")
        for changes in (
            None,
            [],
            [{}],
            [modified("../docs/a.md")],
            [modified("docs//a.md")],
            [modified("docs/a\n.md")],
        ):
            self.assertEqual(choose_plan("pull_request", event(), changes)["mode"], "full")
        self.assertEqual(
            choose_plan("pull_request", event(), [modified("docs/a.md")], diff_error="missing base")["mode"], "full"
        )
        for excluded in (None, "docs/a.md", [[]]):
            self.assertEqual(
                choose_plan("pull_request", event(), [modified("docs/a.md")], excluded_paths=excluded)["mode"], "full"
            )


class AggregateTests(unittest.TestCase):
    def test_full_and_intentionally_omitted_results(self):
        full = choose_plan("workflow_call", {}, None)
        self.assertTrue(evaluate(full, results())["success"])
        docs = choose_plan("pull_request", event(), [modified("docs/a.md")])
        self.assertTrue(evaluate(docs, results(portable="skipped", windows="skipped"))["success"])
        self.assertTrue(evaluate(docs, results())["success"])
        for result in ("failure", "cancelled", "timed_out", "unknown", None, []):
            self.assertFalse(evaluate(docs, results(portable=result))["success"])
        for key in ("backend-static-tests", "portable-product", "validation-plan", "model-store-windows"):
            for value in ("skipped", "failure", "cancelled", "timed_out"):
                jobs = results()
                jobs[key]["result"] = value
                self.assertFalse(evaluate(full, jobs)["success"])

    def test_missing_and_malformed_results(self):
        plan = choose_plan("push", {}, None)
        for value in (
            None,
            {},
            [],
            {"validation-plan": {"result": "success"}},
            results() | {"unrecognized": {"result": "success"}},
        ):
            self.assertFalse(evaluate(plan, value)["success"])
        jobs = results()
        jobs["backend-static-tests"] = "success"
        self.assertFalse(evaluate(plan, jobs)["success"])

    def test_plan_cannot_lower_requirements_or_smuggle_fields(self):
        plan = choose_plan("push", {}, None)
        for key, value in (
            ("schema_version", True),
            ("schema_version", 2),
            ("mode", []),
            ("mode", "unknown"),
            ("backend", "none"),
            ("portable", False),
            ("portable", 1),
            ("reason", ""),
        ):
            changed = copy.deepcopy(plan)
            changed[key] = value
            self.assertFalse(evaluate(changed, results())["success"])
        self.assertFalse(evaluate(plan | {"allow_failure": True}, results())["success"])
        self.assertFalse(evaluate(None, results())["success"])

    def test_deferred_is_never_acceptance(self):
        plan = choose_plan("pull_request", event(draft=True), [])
        self.assertFalse(evaluate(plan, results(backend="skipped", portable="skipped"))["success"])
        self.assertFalse(evaluate(plan, results())["success"])


if __name__ == "__main__":
    unittest.main()
