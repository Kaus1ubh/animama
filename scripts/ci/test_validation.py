"""Exercise real Git history and the CLI boundary, without network or dependencies."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import validation


class GitSelectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / "source"
        self.root.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.email", "ci-fixture@example.invalid")
        self.git("config", "user.name", "CI fixture")
        self.write("docs/backend/a.md", "initial\n")
        self.write("docs/frontend/b.md", "initial\n")
        self.write("docs/architecture/repository-provenance.json", '{"files":[],"evidence":[]}\n')
        self.base = self.commit("base")

    def git(self, *args):
        return validation.git(self.root, *args).decode().strip()

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def commit(self, message):
        self.git("add", ".")
        self.git("-c", "commit.gpgsign=false", "commit", "-m", message)
        return self.git("rev-parse", "HEAD")

    def event(self, head):
        return {
            "action": "synchronize",
            "number": 12,
            "pull_request": {"head": {"sha": head}, "base": {"sha": self.base}, "draft": False, "labels": []},
        }

    def test_complete_diff_includes_earlier_commits(self):
        self.write("docs/backend/a.md", "earlier\n")
        self.commit("first")
        self.write("docs/frontend/b.md", "latest\n")
        head = self.commit("second")
        changes, merge_base = validation.discover(self.root, self.event(head))
        self.assertEqual(merge_base, self.base)
        self.assertEqual({row["path"] for row in changes}, {"docs/backend/a.md", "docs/frontend/b.md"})
        self.assertTrue(all(row["old_path"] is None for row in changes))

    def test_shallow_checkout_fetches_enough_exact_history(self):
        self.git("checkout", "-b", "feature")
        for index in range(4):
            self.write("docs/backend/a.md", f"change {index}\n")
            self.commit(f"change {index}")
        head = self.git("rev-parse", "HEAD")
        clone = Path(self.directory.name) / "shallow"
        subprocess.run(
            ["git", "clone", "--quiet", "--depth=1", "--branch", "feature", self.root.as_uri(), str(clone)], check=True
        )
        changes, merge_base = validation.discover(clone, self.event(head))
        self.assertEqual(merge_base, self.base)
        self.assertEqual([row["path"] for row in changes], ["docs/backend/a.md"])

    def test_cli_records_source_tree_and_exports_docs_plan(self):
        self.write("docs/backend/a.md", "documentation\n")
        head = self.commit("docs")
        event_path = Path(self.directory.name) / "event.json"
        event_path.write_text(json.dumps(self.event(head)))
        output_path = Path(self.directory.name) / "outputs"
        receipt = Path(self.directory.name) / "receipt.json"
        with patch.dict(
            os.environ,
            {
                "GITHUB_EVENT_NAME": "pull_request",
                "GITHUB_EVENT_PATH": str(event_path),
                "GITHUB_WORKFLOW": validation.WORKFLOW,
                "GITHUB_SHA": head,
                "GITHUB_OUTPUT": str(output_path),
                "CI_INPUTS": "{}",
            },
        ):
            validation.plan(self.root, receipt)
        data = json.loads(receipt.read_text())
        self.assertEqual(data["plan"]["mode"], "docs")
        self.assertEqual(data["source_tree"], self.git("rev-parse", "HEAD^{tree}"))
        self.assertIn("backend=docs\n", output_path.read_text())

    def test_incomplete_history_cannot_select_docs(self):
        event = self.event("f" * 40)
        with self.assertRaises(ValueError):
            validation.discover(self.root, event)

    def test_executable_and_lfs_inputs_cannot_select_docs(self):
        self.write(".gitattributes", "docs/frontend/b.md filter=lfs\n")
        self.git("add", ".gitattributes")
        self.git("update-index", "--chmod=+x", "docs/backend/a.md")
        self.git("-c", "commit.gpgsign=false", "commit", "-m", "executable")
        changes = [{"status": "M", "old_path": None, "path": "docs/frontend/b.md"}]
        excluded = validation.special_inputs(self.root, self.base, changes)
        self.assertIn("docs/backend/a.md", excluded)
        self.assertIn("docs/frontend/b.md", excluded)


class InputBoundaryTests(unittest.TestCase):
    def test_renames_deletions_and_unusual_filenames(self):
        rows = validation.parse_changes(b"R100\0old name\0new\nname\0D\0removed\0")
        self.assertEqual(rows[0], {"status": "R100", "old_path": "old name", "path": "new\nname"})
        self.assertEqual(rows[1], {"status": "D", "old_path": None, "path": "removed"})
        for malformed in (b"M\0truncated", b"R100\0one\0", b"M\0../escape\0", b"invalid\0path\0"):
            with self.subTest(malformed=malformed), self.assertRaises(ValueError):
                validation.parse_changes(malformed)

    def test_gate_writes_failure_for_absent_plan(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"CI_PLAN": "", "CI_NEEDS": "{}"}):
            output = Path(directory) / "gate.json"
            self.assertEqual(validation.gate(output), 1)
            self.assertFalse(json.loads(output.read_text())["success"])


if __name__ == "__main__":
    unittest.main()
