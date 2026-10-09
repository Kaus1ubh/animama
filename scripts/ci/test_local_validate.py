"""Safety and profile tests for exact-source local pre-push verification."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

from local_validate import clone_exact, commands, exact_commit, prepare_output, run_check, worker


class LocalValidationTests(unittest.TestCase):
    def test_profiles_preserve_independent_packaging_and_one_source_build(self):
        source, output = Path("/tmp/check/source"), Path("/tmp/check")
        commit, baseline = "a" * 40, "b" * 40
        backend = commands("backend", source, output, commit, baseline)
        self.assertEqual([row[0] for row in backend], ["backend-full", "source-integrity"])
        web = commands("web", source, output, commit, baseline)
        self.assertEqual([row[0] for row in web], ["frontend-source", "browser-smoke", "source-integrity"])
        full = commands("full", source, output, commit, baseline)
        self.assertEqual(
            [row[0] for row in full],
            [
                "backend-full",
                "tooling-tests",
                "frontend-source",
                "browser-smoke",
                "package-build",
                "isolated-consumers",
                "release-completed-environments",
                "baseline-models",
                "baseline-build",
                "compatibility",
                "source-integrity",
            ],
        )
        self.assertEqual(sum("ci:source" in row[2] for row in full), 1)
        # The hosted tooling step's runner, including the whole-app harness unit tests.
        tooling = next(row[2] for row in full if row[0] == "tooling-tests")
        self.assertEqual(tooling[-1], "scripts/ci/tooling_tests.py")
        baseline_command = next(row[2] for row in full if row[0] == "baseline-build")
        self.assertIn(str(output / "baseline"), baseline_command)
        self.assertIn(baseline, baseline_command)
        # The baseline's own pinned speech set, not the candidate's, feeds its build.
        baseline_models = next(row[2] for row in full if row[0] == "baseline-models")
        self.assertEqual(baseline_models[-3:], ["models", "--source", str(output / "baseline")])
        identifiers = [row[0] for row in full]
        self.assertLess(identifiers.index("isolated-consumers"), identifiers.index("release-completed-environments"))
        self.assertLess(identifiers.index("release-completed-environments"), identifiers.index("baseline-build"))
        cleanup = next(row[2] for row in full if row[0] == "release-completed-environments")
        self.assertNotIn(str(source / ".venv"), cleanup)
        smoke = next(row[2] for row in full if row[0] == "browser-smoke")
        self.assertIn("--pg-bin", smoke)
        self.assertNotIn("--mode", smoke)  # The existing harness always runs both modes.

    def test_output_rejects_source_children_nonempty_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            for output in (source, source / "child"):
                with self.assertRaisesRegex(ValueError, "external"):
                    prepare_output(output, source)
            external = root / "external"
            prepare_output(external, source)
            (external / "valuable").write_text("preserve me")
            with self.assertRaisesRegex(ValueError, "empty"):
                prepare_output(external, source)
            link = root / "link"
            link.symlink_to(external)
            with self.assertRaises(ValueError):
                prepare_output(link, source)
            self.assertEqual((external / "valuable").read_text(), "preserve me")

    def test_failed_command_records_failure_and_exact_log_digest(self):
        # GNU env --chdir is used in Linux; the focused unit test stays portable.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = subprocess.Popen

            def popen(command, **kwargs):
                self.assertEqual(command[:2], ["env", "--chdir"])
                return original(command[3:], **kwargs)

            with patch("local_validate.subprocess.Popen", side_effect=popen):
                result = run_check("failure", root, [sys.executable, "-c", "print('failed'); exit(7)"], root)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["command"][2], str(root))
            self.assertEqual(result["log_sha256"], hashlib.sha256((root / "logs/failure.log").read_bytes()).hexdigest())
            self.assertGreaterEqual(result["duration_seconds"], 0)

    def test_clone_uses_commit_and_excludes_ignored_or_dirty_caller_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, destination = root / "caller", root / "isolated"
            source.mkdir()

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=source, text=True).strip()

            git("init", "-q")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            (source / ".gitignore").write_text("ignored\n")
            (source / "tracked.txt").write_text("committed\n")
            git("add", ".")
            git("commit", "-qm", "fixture")
            commit = git("rev-parse", "HEAD")
            (source / "tracked.txt").write_text("unrelated change\n")
            (source / "ignored").write_text("user-supplied asset\n")
            self.assertEqual(exact_commit(source, commit), commit)
            with self.assertRaises(ValueError):
                exact_commit(source, "HEAD")
            clone_exact(source, commit, destination)
            self.assertEqual((destination / "tracked.txt").read_text(), "committed\n")
            self.assertFalse((destination / "ignored").exists())
            self.assertTrue((destination / ".git").is_dir())
            self.assertFalse((destination / ".git/objects/info/alternates").exists())
            self.assertEqual((source / "tracked.txt").read_text(), "unrelated change\n")

    def test_worker_models_are_scoped_prerequisites_and_fail_closed(self):
        prerequisites = [
            f"{model}-{operation}" for model in ("parakeet", "browser_speech") for operation in ("acquire", "verify")
        ]
        for profile, failure in [("backend", None), ("web", None), ("full", None)] + [
            ("web", identifier) for identifier in prerequisites
        ]:
            with self.subTest(profile=profile, failure=failure), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                (output / "source").mkdir()
                args = Namespace(output=output, commit="a" * 40, baseline="b" * 40, profile=profile)
                observed = []

                def check(
                    identifier,
                    cwd,
                    command,
                    evidence,
                    observed=observed,
                    profile=profile,
                    output=output,
                    failure=failure,
                ):
                    observed.append(identifier)
                    if profile in {"web", "full"}:
                        self.assertEqual(os.environ["ANIMAMA_MODEL_ROOT"], str(output / "models"))
                    else:
                        self.assertNotIn("ANIMAMA_MODEL_ROOT", os.environ)
                    if identifier in prerequisites:
                        self.assertEqual(command[-2:], ["--root", str(output / "models")])
                    return {
                        "id": identifier,
                        "status": "failed" if identifier == failure else "passed",
                        "command": command,
                        "duration_seconds": 0,
                        "log_sha256": "c" * 64,
                    }

                versions = {"node": "v24.15.0", "pnpm": "10.33.0", "uv": "uv 0.11.28"}
                exists = Path.exists
                with (
                    patch.dict(os.environ, {}, clear=True),
                    patch("local_validate.platform.system", return_value="Linux"),
                    patch("local_validate.platform.python_version", return_value="3.12.13"),
                    patch.object(
                        Path, "exists", lambda path, exists=exists: path == Path("/.dockerenv") or exists(path)
                    ),
                    patch(
                        "local_validate.capture",
                        side_effect=lambda command, cwd, versions=versions: versions[command[0]],
                    ),
                    patch("local_validate.git", side_effect=[args.commit, "d" * 40]),
                    patch("local_validate.run_check", side_effect=check),
                ):
                    self.assertEqual(worker(args), 1 if failure else 0)
                if profile == "backend":
                    self.assertFalse(set(prerequisites) & set(observed))
                elif failure:
                    self.assertEqual(observed[-1], failure)
                    self.assertNotIn("frontend-source", observed)
                else:
                    self.assertEqual(observed[1:5], prerequisites)
                    self.assertLess(observed.index(prerequisites[-1]), observed.index("frontend-source"))
                receipt = json.loads((output / "local-validation.json").read_text())
                self.assertEqual([item["id"] for item in receipt["checks"]], observed)
                self.assertEqual((output / "receipt-comment.md").exists(), failure is None)
                self.assertEqual((output / "receipt-sha256.txt").exists(), failure is None)

    def test_worker_stops_at_failed_prerequisite_without_emitting_review_material(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "source").mkdir()
            args = Namespace(output=output, commit="a" * 40, baseline="b" * 40, profile="full")
            results = []

            def check(identifier, cwd, command, evidence):
                results.append(identifier)
                return {
                    "id": identifier,
                    "status": "failed",
                    "command": command,
                    "duration_seconds": 0,
                    "log_sha256": "c" * 64,
                }

            versions = {"node": "v24.15.0", "pnpm": "10.33.0", "uv": "uv 0.11.28"}
            exists = Path.exists
            with (
                patch.dict(os.environ),
                patch("local_validate.platform.system", return_value="Linux"),
                patch("local_validate.platform.python_version", return_value="3.12.13"),
                patch.object(Path, "exists", lambda path, exists=exists: path == Path("/.dockerenv") or exists(path)),
                patch(
                    "local_validate.capture", side_effect=lambda command, cwd, versions=versions: versions[command[0]]
                ),
                patch("local_validate.git", side_effect=[args.commit, "d" * 40]),
                patch("local_validate.run_check", side_effect=check),
            ):
                self.assertEqual(worker(args), 1)
            self.assertEqual(results, ["frozen-python-install"])
            receipt = json.loads((output / "local-validation.json").read_text())
            self.assertEqual(receipt["checks"][0]["status"], "failed")
            self.assertFalse((output / "receipt-comment.md").exists())
            self.assertFalse((output / "receipt-sha256.txt").exists())


if __name__ == "__main__":
    unittest.main()
