"""The shared tooling-suite runner fails closed and includes the harness's Node tests."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tooling_tests


class ToolingSuiteTests(unittest.TestCase):
    def test_the_emitted_application_harness_unit_tests_are_a_required_suite(self):
        self.assertIn("scripts/repository-boundary/consumers/hosted-app", tooling_tests.NODE_SUITES)
        for directory in tooling_tests.NODE_SUITES:
            self.assertTrue(list((tooling_tests.ROOT / directory).glob("*.test.mjs")), directory)

    def test_node_suites_fail_when_empty_or_failing_and_pass_otherwise(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "empty").mkdir()
            with patch.object(tooling_tests, "ROOT", root), self.assertRaisesRegex(SystemExit, "no tests"):
                tooling_tests.node_suite("empty")
            suite = root / "suite"
            suite.mkdir()
            test = suite / "fixture.test.mjs"
            test.write_text('import test from "node:test";\ntest("passes", () => {});\n')
            with patch.object(tooling_tests, "ROOT", root):
                tooling_tests.node_suite("suite")
            test.write_text('import test from "node:test";\ntest("fails", () => { throw new Error("x"); });\n')
            with patch.object(tooling_tests, "ROOT", root), self.assertRaises(SystemExit) as failed:
                tooling_tests.node_suite("suite")
            self.assertEqual(failed.exception.code, 1)

    def test_python_suites_fail_when_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "empty").mkdir()
            with patch.object(tooling_tests, "ROOT", root), self.assertRaisesRegex(SystemExit, "no tests"):
                tooling_tests.python_suite("empty")


if __name__ == "__main__":
    unittest.main()
