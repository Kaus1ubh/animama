"""Source-candidate safety tests; no Animama services or asset downloads."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("prepare_source", Path(__file__).with_name("prepare_source.py"))
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class SourcePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        subprocess.run(["git", "init", "-q", str(self.source)], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(self.source),
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--allow-empty",
                "-qm",
                "fixture",
            ],
            check=True,
        )
        files = {
            ".gitignore": "ignored-private/\n",
            "LICENSE": "Private source\n",
            "README.md": "# Fixture\n\n## Copyright and licensing\nPrivate.\n",
            "pyproject.toml": 'license = "LicenseRef-Proprietary"\n',
            "package.json": '{"license":"UNLICENSED"}',
            "scripts/public-release/templates/AGPL-3.0-only.txt": "AGPL fixture\n",
            "src/frontend/desktop/electron-builder.yml": (
                "copyright: Copyright (c) 2026 Raymond Van. All rights reserved.\n"
            ),
            "src/frontend/desktop/runtime/license-sources.json": (
                '{"groups":[{"id":"animama","license":"Proprietary"}]}'
            ),
            "licenses/source-review.json": "",
        }
        paths = sorted(files)
        files["licenses/source-review.json"] = json.dumps(
            {"schema": "animama-source-license-review/1", "files": [{"path": path} for path in paths]}
        )
        for relative, value in files.items():
            path = self.source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value)
        self.stage(*paths)
        self.review = self.root / "input.json"
        module.write_exclusive(self.review, module.inventory(self.source))
        self.output = self.root / "candidate"
        self.receipt = self.root / "receipt.json"

    def tearDown(self):
        self.temp.cleanup()

    def create(self):
        return module.prepare(self.source, self.review, self.output, self.receipt)

    def stage(self, *paths):
        subprocess.run(["git", "add", "--", *paths], cwd=self.source, check=True)

    def test_candidate_is_separate_and_excludes_untracked_and_ignored_files(self):
        (self.source / "private-secret.txt").write_text("never copy")
        (self.source / "ignored-private").mkdir()
        (self.source / "ignored-private/secret.txt").write_text("never copy ignored files")
        result = self.create()
        module.verify(self.output, result)
        self.assertEqual((self.source / "LICENSE").read_text(), "Private source\n")
        self.assertEqual((self.output / "LICENSE").read_text(), "AGPL fixture\n")
        self.assertFalse((self.output / ".git").exists())
        self.assertFalse((self.output / "private-secret.txt").exists())
        self.assertFalse((self.output / "ignored-private").exists())
        self.assertFalse(result["release_approved"])

    def test_reviewed_tracked_repository_plans_are_included_but_untracked_plans_are_not(self):
        plans = ["PLANS.md", "docs/plans/chat/chat-spec.md", "docs/plans/chat/chat-execplan.md"]
        for relative in [*plans, "docs/plans/private.md"]:
            path = self.source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"# Synthetic planning fixture: {relative}\n")
        self.stage(*plans)
        license_path = self.source / "licenses/source-review.json"
        license_review = json.loads(license_path.read_text())
        license_review["files"].extend({"path": path} for path in plans)
        license_path.write_text(json.dumps(license_review))
        self.review.unlink()
        module.write_exclusive(self.review, module.inventory(self.source))

        result = self.create()
        module.verify(self.output, result)
        for relative in plans:
            self.assertEqual((self.output / relative).read_bytes(), (self.source / relative).read_bytes())
        self.assertFalse((self.output / "docs/plans/private.md").exists())
        self.assertFalse(result["release_approved"])

    def test_changed_source_fails_before_output(self):
        (self.source / "LICENSE").write_text("changed")
        with self.assertRaisesRegex(ValueError, "Source changed"):
            self.create()
        self.assertFalse(self.output.exists())

    def test_added_tracked_file_invalidates_frozen_inventory(self):
        (self.source / "new-source.py").write_text("# New source requires review\n")
        self.stage("new-source.py")
        with self.assertRaisesRegex(ValueError, "Source changed"):
            self.create()
        self.assertFalse(self.output.exists())

    def test_new_tracked_file_requires_license_coverage(self):
        (self.source / "new-source.py").write_text("# Unreviewed tracked source\n")
        self.stage("new-source.py")
        self.review.unlink()
        module.write_exclusive(self.review, module.inventory(self.source))
        with self.assertRaisesRegex(ValueError, "exact input file set"):
            self.create()
        self.assertFalse(self.output.exists())

    def test_tracked_private_state_is_rejected(self):
        (self.source / "data").mkdir()
        (self.source / "data/private.txt").write_text("synthetic private state")
        self.stage("data/private.txt")
        with self.assertRaisesRegex(ValueError, "Forbidden candidate path"):
            module.inventory(self.source)

    def test_reserved_generated_file_is_rejected(self):
        (self.source / "SOURCE_CANDIDATE.json").write_text("{}")
        self.stage("SOURCE_CANDIDATE.json")
        with self.assertRaisesRegex(ValueError, "reserved generated path"):
            module.inventory(self.source)

    def test_existing_destination_is_preserved(self):
        self.output.mkdir()
        with self.assertRaisesRegex(ValueError, "already exist"):
            self.create()
        self.assertTrue(self.output.is_dir())

    def test_output_cannot_be_inside_source(self):
        self.output = self.source / "candidate"
        with self.assertRaisesRegex(ValueError, "outside"):
            self.create()

    def test_symlink_traversal_private_state_and_lfs_pointer_fail(self):
        link = self.source / "link"
        link.symlink_to(self.source / "LICENSE")
        for relative in ["link", "../input.json", ".git/config", "data/file", "docs/plans/.env", ".env"]:
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                module.safe_file(self.source, relative)
        (self.source / "pointer").write_text("version https://git-lfs.github.com/spec/v1\noid sha256:123\n")
        with self.assertRaisesRegex(ValueError, "Hydrate"):
            module.safe_file(self.source, "pointer")

    def test_extra_or_changed_candidate_files_fail(self):
        result = self.create()
        extra = self.output / "extra.txt"
        extra.write_text("undeclared")
        with self.assertRaisesRegex(ValueError, "differ"):
            module.verify(self.output, result)
        extra.unlink()
        (self.output / "LICENSE").write_text("tampered")
        with self.assertRaisesRegex(ValueError, "differ"):
            module.verify(self.output, result)

    def test_missing_license_coverage_fails_without_candidate(self):
        path = self.source / "licenses/source-review.json"
        path.write_text('{"schema":"animama-source-license-review/1","files":[]}')
        self.review.unlink()
        module.write_exclusive(self.review, module.inventory(self.source))
        with self.assertRaisesRegex(ValueError, "exact input file set"):
            self.create()
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
