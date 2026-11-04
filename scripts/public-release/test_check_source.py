"""Source-review coverage tests; no Animama services or asset downloads."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("check_source", Path(__file__).with_name("check_source.py"))
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

REVIEW = "licenses/source-review.json"


class SourceReviewCoverageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.source = Path(self.temp.name) / "source"
        self.source.mkdir()
        subprocess.run(["git", "init", "-q", str(self.source)], check=True)
        self.write({"LICENSE": "Licence text\n", "src/app.py": "print('app')\n"})
        self.review_paths(["LICENSE", "src/app.py", REVIEW])

    def tearDown(self):
        self.temp.cleanup()

    def write(self, files: dict[str, str]) -> None:
        for relative, value in files.items():
            path = self.source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value)
        subprocess.run(["git", "add", "--", *files], cwd=self.source, check=True)

    def review_paths(self, paths: list[str], licence: str = "AGPL-3.0-only") -> None:
        entries = [self.entry(path, licence) for path in paths]
        self.write({REVIEW: json.dumps({"schema": module.SCHEMA, "files": entries})})

    @staticmethod
    def entry(path: str, licence: str = "AGPL-3.0-only") -> dict[str, str]:
        return {
            "path": path,
            "candidate_license": licence,
            "basis": "Original work",
            "copyright": "2026 Fixture",
            "review": "prepared",
        }

    def problems(self) -> dict[str, list[str]]:
        return module.coverage(self.source)

    def test_exact_coverage_reports_no_problems(self):
        self.assertEqual(self.problems(), {})

    def test_tracked_file_without_an_entry_is_reported(self):
        self.write({"src/new.py": "# unreviewed\n"})
        self.assertEqual(self.problems(), {"missing": ["src/new.py"]})

    def test_untracked_files_need_no_entry(self):
        (self.source / "scratch.txt").write_text("not tracked")
        self.assertEqual(self.problems(), {})

    def test_entry_for_a_removed_file_is_reported(self):
        subprocess.run(["git", "rm", "-qf", "src/app.py"], cwd=self.source, check=True)
        self.assertEqual(self.problems(), {"stale": ["src/app.py"]})

    def test_duplicate_entries_are_reported(self):
        self.review_paths(["LICENSE", "LICENSE", "src/app.py", REVIEW])
        self.assertEqual(self.problems(), {"duplicate": ["LICENSE"]})

    def test_entries_with_a_pending_licence_are_reported(self):
        self.review_paths(["LICENSE", "src/app.py", REVIEW], licence="AGPL-3.0-only (pending rights question)")
        self.assertEqual(self.problems(), {"pending": ["LICENSE", REVIEW, "src/app.py"]})

    def test_tracked_private_state_is_reported(self):
        self.write({"data/owner.db": "private", ".env": "SECRET=1", "content/local/item.json": "{}"})
        self.review_paths(["LICENSE", "src/app.py", REVIEW, "data/owner.db", ".env", "content/local/item.json"])
        self.assertEqual(self.problems(), {"private": [".env", "content/local/item.json", "data/owner.db"]})

    def test_documented_placeholders_are_not_private_state(self):
        self.write({".env.example": "KEY=\n", "content/local/README.md": "# Local content\n"})
        self.review_paths(["LICENSE", "src/app.py", REVIEW, ".env.example", "content/local/README.md"])
        self.assertEqual(self.problems(), {})

    def test_entries_missing_a_field_are_reported(self):
        incomplete = {"path": "src/app.py", "candidate_license": "AGPL-3.0-only"}
        entries = [self.entry("LICENSE"), self.entry(REVIEW), incomplete]
        self.write({REVIEW: json.dumps({"schema": module.SCHEMA, "files": entries})})
        self.assertEqual(self.problems(), {"malformed": ["src/app.py"]})

    def test_blank_or_non_text_fields_are_reported(self):
        blank = dict(self.entry("src/app.py"), basis="   ")
        wrong = dict(self.entry("LICENSE"), candidate_license=["AGPL-3.0-only"])
        listed = dict(self.entry(REVIEW), copyright=["2026 Fixture", "Upstream holder"])
        self.write({REVIEW: json.dumps({"schema": module.SCHEMA, "files": [blank, wrong, listed]})})
        self.assertEqual(self.problems(), {"malformed": ["src/app.py", "LICENSE"]})

    def test_entry_without_a_path_is_reported(self):
        entries = [self.entry("LICENSE"), self.entry("src/app.py"), self.entry(REVIEW), {"basis": "orphan"}]
        self.write({REVIEW: json.dumps({"schema": module.SCHEMA, "files": entries})})
        self.assertEqual(self.problems(), {"malformed": ["(entry 4 has no path)"]})

    def test_unsupported_review_schema_fails(self):
        self.write({REVIEW: json.dumps({"schema": "other", "files": []})})
        with self.assertRaisesRegex(ValueError, "Unsupported source review"):
            self.problems()


if __name__ == "__main__":
    unittest.main()
