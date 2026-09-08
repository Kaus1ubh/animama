"""Verify evidence expansion and reproducibility without relying on project assets."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("build-provenance.py")
SPEC = importlib.util.spec_from_file_location("build_provenance", SCRIPT)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class ProvenanceBuilderTests(unittest.TestCase):
    """Fail on stale sources while preserving explicit restrictions and unknowns."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.checker = builder.load_checker()
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Provenance fixture")
        self.git("config", "core.hooksPath", "/dev/null")
        self.write("LICENSE", "Fixture license evidence\n")
        self.write("content/README.md", "Fixture content guide\n")
        self.write("content/included/README.md", "Fixture Included guide\n")
        self.write(builder.RUNTIME, json.dumps({"groups": []}))
        self.notice = builder.NOTICE_ROOT + "included-content-attribution.txt"
        self.write(self.notice, "Fixture required notice\n")
        rules = [
            {"glob": "excluded/**/*", "distribution": "excluded", "license_id": "LicenseRef-unknown",
             "creator": "UNKNOWN", "provenance": "An explicit existing exclusion"},
            {"glob": "gestures/**/*.vrma", "distribution": "included",
             "license_id": "LicenseRef-Adobe-Mixamo-embedded-product", "creator": "Fixture Mixamo source",
             "provenance": "Only embedded-product use recorded"},
            {"glob": "**/*", "distribution": "included", "license_id": "LicenseRef-owner-fallback",
             "creator": "Legacy asserted owner", "provenance": "Blanket fallback is not verified authorship"},
        ]
        self.write(builder.INCLUDED, json.dumps({"rules": rules}))
        self.write("content/included/unknown.txt", "Unidentified input\n")
        self.write("content/included/excluded/song with spaces.wav", b"excluded fixture\0")
        self.write("content/included/gestures/example.vrma", b"Mixamo fixture\0")
        self.payload = b"arbitrary hydrated fixture\0"
        self.write("outside-lfs.txt", self.payload)
        self.oid = self.checker.digest(self.root / "outside-lfs.txt")
        self.pointer = self.checker.LFS_HEADER + f"oid sha256:{self.oid}\nsize {len(self.payload)}\n".encode()
        self.write("outside-lfs.txt", self.pointer)
        self.git("add", ".")
        self.git("commit", "-qm", "Fixture baseline")
        self.baseline = self.git("rev-parse", "HEAD").decode().strip()
        self.write("outside-lfs.txt", self.payload)

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, capture_output=True, check=True).stdout

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode() if isinstance(content, str) else content)

    def build(self):
        return builder.build(self.root, self.baseline)

    def test_deterministic_output_preserves_exclusions_and_unknown_provenance(self):
        result = self.build()
        self.assertEqual(result, self.build())
        records = {record["path"]: record for record in result["files"]}
        evidence = {item["id"]: item for item in result["evidence"]}
        self.assertEqual(records["content/included/excluded/song with spaces.wav"]["publication_status"], "blocked")
        self.assertEqual(records["content/included/gestures/example.vrma"]["publication_status"], "blocked")
        unknown = records["content/included/unknown.txt"]
        self.assertEqual(unknown["publication_status"], "review-pending")
        self.assertEqual(evidence[unknown["evidence_ids"][0]]["license"], "UNKNOWN")
        self.assertTrue(evidence[unknown["evidence_ids"][0]]["source"].startswith("UNKNOWN:"))
        self.assertFalse(any(record["publication_status"] == "approved" for record in records.values()))
        self.assertEqual(records["outside-lfs.txt"]["lfs_oid"], self.oid)
        errors = []
        entries = self.checker.index_entries(self.root)
        self.checker.check_provenance(self.root, result, entries, self.checker.lfs_pointers(self.root, entries), errors)
        self.assertEqual(errors, [])

    def test_dirty_asset_and_unhydrated_lfs_payload_fail(self):
        self.write("content/included/unknown.txt", "Unreviewed replacement")
        with self.assertRaisesRegex(ValueError, "unstaged changes"):
            self.build()
        self.git("checkout", "--", "content/included/unknown.txt")
        self.write("outside-lfs.txt", self.pointer)
        with self.assertRaisesRegex(ValueError, "unhydrated"):
            self.build()

    def test_staged_asset_requires_reviewed_baseline_refresh(self):
        self.write("content/included/unknown.txt", "Reviewed replacement")
        self.git("add", "content/included/unknown.txt")
        with self.assertRaisesRegex(ValueError, "Asset index differs from source commit"):
            self.build()

    def test_supporting_evidence_must_match_index_and_source_commit(self):
        self.write(self.notice, "Changed supporting notice\n")
        with self.assertRaisesRegex(ValueError, "Supporting provenance evidence has unstaged changes"):
            self.build()
        self.git("add", self.notice)
        with self.assertRaisesRegex(ValueError, "Evidence index differs from source commit"):
            self.build()

    def test_missing_notice_fails_instead_of_omitting_evidence(self):
        (self.root / self.notice).unlink()
        with self.assertRaisesRegex(ValueError, "Evidence input is not a tracked file"):
            self.build()

    def test_cli_check_is_read_only_and_rejects_stale_inventory(self):
        argv = [sys.executable, str(SCRIPT), "--root", str(self.root)]
        subprocess.run(argv, capture_output=True, check=True)
        output = self.root / builder.OUTPUT
        original = output.read_bytes()
        subprocess.run([*argv, "--check"], capture_output=True, check=True)
        self.assertEqual(output.read_bytes(), original)
        changed = json.loads(original)
        changed["files"][0]["sha256"] = "0" * 64
        output.write_text(json.dumps(changed))
        modified = output.read_bytes()
        result = subprocess.run([*argv, "--check"], capture_output=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"differs from deterministic output", result.stderr)
        self.assertEqual(output.read_bytes(), modified)

    def test_double_star_inventory_pattern_handles_root_and_nested_assets(self):
        self.assertTrue(builder.matches_glob("gestures/example.vrma", "gestures/**/*.vrma"))
        self.assertTrue(builder.matches_glob("gestures/deep/example.vrma", "gestures/**/*.vrma"))
        self.assertFalse(builder.matches_glob("gestures/example.vrma.meta.json", "gestures/**/*.vrma"))
        self.assertFalse(builder.matches_glob("poses/example.vrma", "gestures/**/*.vrma"))


if __name__ == "__main__":
    unittest.main()
