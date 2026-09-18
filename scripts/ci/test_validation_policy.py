"""Selection and single-job acceptance stay conservative at input boundaries."""

from __future__ import annotations

import copy
import unittest

from validation_policy import BASE, PROFILES, choose_plan, classify, evaluate


def event(action="synchronize", draft=False, labels=()):
    return {"action": action, "pull_request": {"draft": draft, "labels": [{"name": name} for name in labels]}}


def main_event():
    return {"ref": "refs/heads/main", "before": "a" * 40, "after": "b" * 40}


def modified(path):
    return {"status": "M", "old_path": None, "path": path}


def results(plan):
    return {name: {"outcome": "success", "conclusion": "success"} for name in plan["required"]}


class ClassificationTests(unittest.TestCase):
    def test_reduced_path_allowlist(self):
        for path, area in {
            "docs/backend/operations/development.md": "docs",
            "tests/test_chat.py": "backend",
            "src/backend/animama/app/services/memory_entry_diff.py": "backend",
            "src/frontend/web/src/ui/components/button.tsx": "web",
            "src/frontend/web/src/ui/components/card.tsx": "web",
            "src/frontend/web/src/ui/components/input.tsx": "web",
        }.items():
            self.assertEqual(classify([modified(path)]), area, path)

    def test_high_risk_and_unknown_paths_never_reduce_with_review(self):
        paths = [
            "README.md",
            "AGENTS.md",
            "docs/AGENTS.md",
            "docs/SKILL.md",
            "docs/PLANS.md",
            "docs/configuration.json",
            "docs/script.py",
            "docs/package.json",
            "package.json",
            "src/backend/animama/app/services/chat.py",
            "tests/conftest.py",
            "tests/fixtures/test_shared.py",
            "tests/test_fixture_helper.py",
            "tests/test_support.py",
            "tests/test_accountless_repository_boundaries.py",
            "tests/test_compose_network_boundaries.py",
            "tests/test_desktop_runtime_packaging.py",
            "tests/test_included_content_integrity.py",
            "tests/test_model_store.py",
            "tests/test_browser_model_store.py",
            "tests/test_generate_synthetic_docs.py",
            "src/frontend/desktop/src/main.cts",
            "src/frontend/web/src/main.local.tsx",
            "src/frontend/web/src/routes/index.tsx",
            "src/frontend/web/src/ui/script.js",
            "src/frontend/web/src/ui/create-anima/createAnimaDraftStorage.ts",
            "src/frontend/web/src/ui/sidebar/ApplicationSettingsModal.tsx",
            "src/frontend/web/src/ui/components/model-selector.tsx",
            "src/frontend/web/src/ui/components/new-control.tsx",
            "src/frontend/web/src/components/Button.tsx",
            "src/frontend/web/vite.config.ts",
            "src/frontend/web/public/image.png",
            "src/frontend/packages/runtime-contracts/src/index.ts",
            "src/frontend/desktop/resources/runtime.py",
            "src/frontend/e2e/journeys/library.spec.ts",
            "src/frontend/pnpm-lock.yaml",
            "uv.lock",
            "pyproject.toml",
            "docker-compose.yml",
            ".github/workflows/validate-public.yml",
            "scripts/ci/validation_policy.py",
            "content/included/guide.md",
            "unknown/file.md",
        ]
        paths += [
            f"src/frontend/web/src/ui/{name}.tsx"
            for name in (
                "Chat",
                "Avatar",
                "voice",
                "speech",
                "Canvas",
                "content",
                "owner",
                "credentials",
                "bootstrap",
                "auth",
                "runtime",
                "generated/client",
                "vendor/Control",
                "catalog/data",
                "routeTree.gen",
            )
        ]
        for path in paths:
            self.assertEqual(classify([modified(path)]), "full", path)
            for name, value in (("pull_request", event()), ("push", main_event())):
                self.assertEqual(choose_plan(name, value, [modified(path)], local_reviewed=True)["mode"], "full", path)

    def test_nonmodifications_rename_sides_and_mixed_areas(self):
        for status in ("A", "D", "R", "R100", "C", "C100", "T", "U", "M ", None, []):
            self.assertEqual(classify([{"status": status, "old_path": None, "path": "docs/new.md"}]), "full")
        for old, new in (
            ("docs/old.md", "docs/new.md"),
            ("scripts/ci/validation.py", "docs/a.md"),
            ("docs/a.md", "scripts/ci/validation.py"),
        ):
            for status in ("M", "R100"):
                self.assertEqual(classify([{"status": status, "old_path": old, "path": new}]), "full")
        for paths in (
            ["docs/a.md", "tests/test_chat.py"],
            ["tests/test_chat.py", "src/frontend/web/src/ui/components/label.tsx"],
            ["docs/a.md", "uv.lock"],
        ):
            self.assertEqual(classify([modified(path) for path in paths]), "full")
        self.assertEqual(classify([modified("docs/a.md"), modified("docs/b.md")]), "docs")

    def test_caller_exclusions_and_malformed_classification_inputs(self):
        for path in ("docs/notice.md", "src/frontend/web/src/ui/components/button.tsx", "tests/test_chat.py"):
            self.assertEqual(classify([modified(path)], excluded_paths=[path]), "full")
        self.assertEqual(classify([modified("docs/a.md")], excluded_paths=["docs/other.md"]), "docs")
        for changes in (None, [], {}, (), [{}], [None], [modified("docs/a.md") | {"extra": True}]):
            self.assertEqual(classify(changes), "full")
        for path in (
            None,
            [],
            "",
            "../docs/a.md",
            "/docs/a.md",
            "docs//a.md",
            "docs/./a.md",
            "docs/../a.md",
            "docs/a\n.md",
            "docs\\a.md",
            "docs/a\x00.md",
        ):
            self.assertEqual(classify([modified(path)]), "full")
        for excluded in (None, "docs/a.md", [[]], [False], ["../docs/a.md"]):
            self.assertEqual(classify([modified("docs/a.md")], excluded_paths=excluded), "full")


class SelectionTests(unittest.TestCase):
    def test_local_code_evidence_replaces_expensive_hosted_work_on_pr_and_main(self):
        for path, mode in (("tests/test_chat.py", "backend"), ("src/frontend/web/src/ui/components/label.tsx", "web")):
            for name, value in (("pull_request", event()), ("push", main_event())):
                for reviewed in (False, True, 1, "true", None):
                    plan = choose_plan(name, value, [modified(path)], local_reviewed=reviewed)
                    self.assertEqual(plan["mode"], mode if reviewed is True else "full")
                    if reviewed is True:
                        for omitted in ("backend-tests", "browser-smoke", "package-build"):
                            self.assertNotIn(omitted, plan["required"])
                        self.assertIn("audit", plan["required"])

    def test_docs_remain_minimal_on_pr_and_main_without_receipts(self):
        for name, value in (("pull_request", event()), ("push", main_event())):
            plan = choose_plan(name, value, [modified("docs/guide.md")])
            self.assertEqual(plan["mode"], "docs")
            self.assertIn("docs-tests", plan["required"])
            for omitted in (
                "hydrate",
                "browser-install",
                "model-inputs",
                "node",
                "pnpm-install",
                "backend-tests",
                "browser-smoke",
            ):
                self.assertNotIn(omitted, plan["required"])

    def test_draft_ready_label_and_base_edit_transitions(self):
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
                for labels in ([], ["documentation"], ["ci:full"], ["documentation", "ci:full"]):
                    for path, mode in (("docs/a.md", "docs"), ("tests/test_chat.py", "backend")):
                        expected = "full" if "ci:full" in labels else "deferred" if draft else mode
                        value = event(action, draft, labels)
                        if action == "edited":
                            value["changes"] = {"base": {"ref": {"from": "checkpoint"}}}
                        self.assertEqual(
                            choose_plan("pull_request", value, [modified(path)], local_reviewed=True)["mode"], expected
                        )
        # Caller rejects stale receipt binding after a base change.
        self.assertEqual(
            choose_plan("pull_request", event("edited"), [modified("tests/test_chat.py")], local_reviewed=False)[
                "mode"
            ],
            "full",
        )

    def test_manual_reusable_release_unknown_and_periodic_callers(self):
        for name in ("workflow_dispatch", "workflow_call", "release", "unknown", "", None, []):
            self.assertEqual(
                choose_plan(
                    name, event(draft=True), [modified("docs/a.md")], local_reviewed=True, periodic_unchanged=True
                )["mode"],
                "full",
            )
        for name, value in (("pull_request", event(draft=True)), ("push", main_event()), ("schedule", {})):
            self.assertEqual(
                choose_plan(name, value, [modified("docs/a.md")], reusable=True, periodic_unchanged=True)["mode"],
                "full",
            )
        for unchanged in (False, None, 1, "true", [], {}):
            self.assertEqual(choose_plan("schedule", {}, None, periodic_unchanged=unchanged)["mode"], "full")
        plan = choose_plan("schedule", {}, None, periodic_unchanged=True)
        self.assertEqual(plan["mode"], "unchanged")
        self.assertEqual(set(plan["required"]), BASE)

    def test_malformed_events_and_missing_diff_fall_back(self):
        events = [None, {}, {"action": []}, event("unknown"), event(draft="false"), event()]
        events[-1]["pull_request"]["labels"] = [{"name": []}]
        for value in events:
            self.assertEqual(choose_plan("pull_request", value, [modified("docs/a.md")])["mode"], "full")
        for pr in ([], None, {"draft": False, "labels": None}, {"draft": False, "labels": [None]}):
            self.assertEqual(
                choose_plan("pull_request", {"action": "opened", "pull_request": pr}, [modified("docs/a.md")])["mode"],
                "full",
            )
        for value in (None, {}, {"ref": "refs/heads/other"}, {"ref": []}):
            self.assertEqual(choose_plan("push", value, [modified("docs/a.md")], local_reviewed=True)["mode"], "full")
        for name, value in (("pull_request", event()), ("push", main_event())):
            for changes in (None, [], [{}]):
                self.assertEqual(choose_plan(name, value, changes, local_reviewed=True)["mode"], "full")
            self.assertEqual(
                choose_plan(name, value, [modified("docs/a.md")], diff_error="missing merge base", local_reviewed=True)[
                    "mode"
                ],
                "full",
            )


class AggregateTests(unittest.TestCase):
    def plans(self):
        return [
            choose_plan("workflow_dispatch", {}, None),
            choose_plan("pull_request", event(), [modified("docs/a.md")]),
            choose_plan("push", main_event(), [modified("tests/test_chat.py")], local_reviewed=True),
            choose_plan(
                "pull_request",
                event(),
                [modified("src/frontend/web/src/ui/components/button.tsx")],
                local_reviewed=True,
            ),
            choose_plan("schedule", {}, None, periodic_unchanged=True),
        ]

    def test_schema_two_success_and_intentionally_omitted_steps(self):
        for plan in self.plans():
            self.assertEqual(plan["schema_version"], 2)
            self.assertEqual(set(plan), {"schema_version", "mode", "reason", "required"})
            self.assertTrue(evaluate(plan, results(plan))["success"])
            steps = results(plan) | {"unselected-check": {"outcome": "skipped", "conclusion": "skipped"}}
            self.assertTrue(evaluate(plan, steps)["success"])
            steps["artifact-upload"] = {"outcome": "success", "conclusion": "success"}
            self.assertTrue(evaluate(plan, steps)["success"])

    def test_every_required_step_must_succeed_without_continue_on_error_masking(self):
        plan = self.plans()[0]
        self.assertGreater(len(plan["required"]), 20)
        for name in plan["required"]:
            steps = results(plan)
            del steps[name]
            self.assertFalse(evaluate(plan, steps)["success"], name)
            for value in ("skipped", "failure", "cancelled", "timed_out", "unknown", None, []):
                for outcome, conclusion in ((value, value), (value, "success"), ("success", value)):
                    steps = results(plan)
                    steps[name] = {"outcome": outcome, "conclusion": conclusion}
                    self.assertFalse(evaluate(plan, steps)["success"], (name, outcome, conclusion))

    def test_unselected_failed_work_cannot_be_hidden(self):
        plan = self.plans()[1]
        for value in ("failure", "cancelled", "timed_out", "unknown", None, [], {}):
            for conclusion in (value, "success"):
                steps = results(plan) | {"unexpected-check": {"outcome": value, "conclusion": conclusion}}
                self.assertFalse(evaluate(plan, steps)["success"])

    def test_missing_malformed_steps_and_invalid_required_sets(self):
        for plan in self.plans():
            for value in (None, [], {}, {"checkout": {"outcome": "success", "conclusion": "success"}}):
                self.assertFalse(evaluate(plan, value)["success"])
            for value in (None, [], "success", {}, {"result": "success"}, {"outcome": "success"}):
                steps = results(plan)
                steps["checkout"] = value
                self.assertFalse(evaluate(plan, steps)["success"])
            for key, value in (
                ("schema_version", True),
                ("schema_version", 1),
                ("schema_version", "2"),
                ("mode", []),
                ("mode", "unknown"),
                ("reason", ""),
                ("reason", None),
                ("required", None),
                ("required", []),
                ("required", {}),
                ("required", plan["required"][:-1]),
                ("required", plan["required"] + ["unexpected"]),
                ("required", plan["required"] + [plan["required"][0]]),
                ("required", list(reversed(plan["required"]))),
                ("required", tuple(plan["required"])),
                ("required", [[]]),
            ):
                changed = copy.deepcopy(plan)
                changed[key] = value
                self.assertFalse(evaluate(changed, results(plan))["success"])
            self.assertFalse(evaluate(plan | {"allow_failure": True}, results(plan))["success"])
        self.assertFalse(evaluate(None, {})["success"])
        full = self.plans()[0]
        self.assertFalse(evaluate(full | {"mode": "docs"}, results(full))["success"])

    def test_deferred_never_accepts_even_when_setup_succeeds(self):
        plan = choose_plan("pull_request", event(draft=True), [])
        self.assertEqual(plan["mode"], "deferred")
        self.assertFalse(evaluate(plan, results(plan))["success"])
        all_success = {name: {"outcome": "success", "conclusion": "success"} for name in BASE | PROFILES["full"]}
        self.assertFalse(evaluate(plan, all_success)["success"])


if __name__ == "__main__":
    unittest.main()
