"""Exercise command failures, diagnostic integrity and YAML/policy integration."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import validation
from validation_policy import BASE, PROFILES, UNTIMED

ROOT = Path(__file__).resolve().parents[2]


class CommandTests(unittest.TestCase):
    def test_commands_preserve_exit_stdin_output_and_hash(self):
        for code in (0, 7):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                result = subprocess.run(
                    [
                        sys.executable,
                        str(ROOT / "scripts/ci/check.py"),
                        "fixture",
                        "--",
                        sys.executable,
                        "-c",
                        f'import sys; print(sys.stdin.read()); print("diagnostic", file=sys.stderr); sys.exit({code})',
                    ],
                    input="input text",
                    text=True,
                    capture_output=True,
                    env={
                        key: value
                        for key, value in (os.environ | {"CI_RESULTS_DIR": directory}).items()
                        if key != "RUNNER_TEMP"
                    },
                )
                self.assertEqual(result.returncode, code, result.stderr)
                receipt = json.loads((Path(directory) / "fixture.json").read_text())
                log = (Path(directory) / "fixture.log").read_bytes()
                self.assertIn("input text", result.stdout)
                self.assertIn("diagnostic", result.stdout)
                self.assertEqual(receipt["exit_code"], code)
                self.assertEqual(receipt["status"], "passed" if code == 0 else "failed")
                self.assertEqual(receipt["log_sha256"], hashlib.sha256(log).hexdigest())
                self.assertGreaterEqual(receipt["duration_seconds"], 0)

    def test_missing_or_corrupt_or_failed_receipts_reject_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan = {"required": ["fixture"]}
            self.assertIsNotNone(validation.check_receipts(root, plan)[1])
            (root / "fixture.log").write_text("log")
            receipt = {
                "id": "fixture",
                "command": ["command"],
                "duration_seconds": 1,
                "status": "passed",
                "exit_code": 0,
                "log_sha256": hashlib.sha256(b"log").hexdigest(),
            }
            path = root / "fixture.json"
            path.write_text(json.dumps(receipt))
            self.assertIsNone(validation.check_receipts(root, plan)[1])
            for mutation in (
                {"duration_seconds": -1},
                {"status": "failed"},
                {"exit_code": 1},
                {"id": "other"},
                {"log_sha256": "bad"},
                {"command": []},
            ):
                with self.subTest(mutation=mutation):
                    path.write_text(json.dumps(receipt | mutation))
                    self.assertIsNotNone(validation.check_receipts(root, plan)[1])
            path.write_text("{")
            self.assertIsNotNone(validation.check_receipts(root, plan)[1])


class WorkflowContractTests(unittest.TestCase):
    def test_one_job_and_selected_step_sets_match_gate(self):
        workflow = (ROOT / ".github/workflows/validate-public.yml").read_text()
        self.assertEqual(re.findall(r"^  ([a-z][a-z-]+):$", workflow.split("jobs:\n", 1)[1], re.M), ["validation"])
        self.assertIn("    name: Validation\n", workflow)
        blocks = re.split(r"^      - name: ", workflow, flags=re.M)[1:]
        ids = []
        for block in blocks:
            identity = re.search(r"^        id: (\S+)$", block, re.M)
            self.assertIsNotNone(identity)
            ids.append(identity[1])
        self.assertEqual(len(ids), len(set(ids)))
        for mode, required in PROFILES.items():
            selected = set()
            for block in blocks:
                identifier = re.search(r"^        id: (\S+)$", block, re.M)[1]
                if identifier in {"gate", "diagnostics", "receipts", "pnpm-cache", "speech-cache"}:
                    continue
                condition = re.search(r"^        if: (.+)$", block, re.M)
                if condition is None:
                    selected.add(identifier)
                elif condition[1].startswith("contains(fromJSON("):
                    modes = re.search(r"fromJSON\('(.+)'\)", condition[1])
                    self.assertIsNotNone(modes)
                    if mode in json.loads(modes[1]):
                        selected.add(identifier)
                else:
                    expected = re.fullmatch(r"steps.select.outputs.mode == '(\w+)'", condition[1])
                    self.assertIsNotNone(expected, condition[1])
                    if mode == expected[1]:
                        selected.add(identifier)
                if identifier not in UNTIMED:
                    self.assertIn(f'check.py" {identifier} --', block)
            self.assertEqual(selected, BASE | required, mode)
        self.assertIn("        if: always()\n", next(block for block in blocks if "id: gate\n" in block))


if __name__ == "__main__":
    unittest.main()
