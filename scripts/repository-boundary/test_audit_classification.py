"""Exercise boundary failures against real disposable Git indexes and payloads."""

import copy
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("audit", Path(__file__).with_name("audit-classification.py"))
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


class ClassificationTests(unittest.TestCase):
    """The inventory must fail closed when tracked inputs or their bytes change."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Boundary fixture")
        self.git("config", "core.hooksPath", "/dev/null")
        self.write(".gitignore", "ignored/\n")
        self.write("LICENSE", "Fixture provenance evidence.\n")
        self.write("ignored/file with spaces.txt", "tracked even though ignored\n")
        self.write("file with\na newline.py", "value = 1\n")
        self.write("content/example image.png", b"\0fixture image\n")
        self.payload = b"materialized model bytes\0\1\2"
        self.payload_oid = hashlib.sha256(self.payload).hexdigest()
        self.pointer = (
            audit.LFS_HEADER + f"oid sha256:{self.payload_oid}\nsize {len(self.payload)}\n".encode()
        )
        # An LFS path outside asset trees/extensions must still receive review.
        self.write("unusual-lfs.txt", self.pointer)
        self.git("add", "-f", ".")
        self.git("commit", "-qm", "fixture")
        self.write("unusual-lfs.txt", self.payload)
        self.source_commit = self.git("rev-parse", "HEAD").decode().strip()
        self.entries = audit.index_entries(self.root)
        self.paths = sorted(self.entries)
        self.groups = [{"id": "fixture", "owner": "public", "rationale": "Fixture ownership", "paths": self.paths}]
        self.provenance = {
            "schema_version": 1,
            "source_commit": self.source_commit,
            "evidence": [{
                "id": "fixture", "source": "Authored test fixture", "revision": self.source_commit,
                "license": "UNKNOWN", "unresolved_decision": "Fixture remains private",
                "required_notices": ["Fixture notice"],
                "path_sha256": {"LICENSE": audit.digest(self.root / "LICENSE")},
            }],
            "files": [],
        }
        for path in ("content/example image.png", "unusual-lfs.txt"):
            record = {
                "path": path, "git_blob_oid": self.entries[path]["oid"],
                "sha256": audit.digest(self.root / path), "evidence_ids": ["fixture"],
                "publication_status": "review-pending",
            }
            if path == "unusual-lfs.txt":
                record.update(lfs_oid=self.payload_oid, lfs_size=len(self.payload))
            self.provenance["files"].append(record)
        self.save()

    def git(self, *args):
        return subprocess.run(
            ["git", "-c", "filter.lfs.clean=cat", "-c", "filter.lfs.required=false", *args],
            cwd=self.root, capture_output=True, check=True,
        ).stdout

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode() if isinstance(content, str) else content)

    def save(self):
        self.write("provenance.json", json.dumps(self.provenance))
        manifest = [
            "schema_version = 1", f"source_commit = {json.dumps(self.source_commit)}",
            'provenance_manifest = "provenance.json"',
        ]
        manifest.extend(f"{key} = {json.dumps(value)}" for key, value in getattr(self, "snapshot", {}).items())
        for group in self.groups:
            manifest.extend(["[[groups]]", *[f"{key} = {json.dumps(value)}" for key, value in group.items()]])
        self.write("boundary.toml", "\n".join(manifest) + "\n")

    def run_audit(self, paths=None):
        self.save()
        return audit.audit(self.root, self.root / "boundary.toml", paths)

    def test_complete_inventory_includes_ignored_spaces_newlines_and_all_lfs(self):
        result = self.run_audit(audit.nul_paths(self.git("ls-files", "-z")))
        self.assertEqual(result["tracked_paths"], 6)
        self.assertEqual(result["owners"], {"public": 6})
        self.assertEqual(result["lfs_paths"], 1)
        self.assertEqual(result["provenance_files"], 2)
        self.assertFalse(result["publication_approval"])

    def make_exported_snapshot(self):
        """Model a new root whose imported provenance commit is unavailable."""
        self.source_commit = "a" * 40
        self.snapshot = {
            "mode": "exported-snapshot", "snapshot_id": "b" * 64, "source_manifest_sha256": "c" * 64,
        }
        self.provenance.update(self.snapshot, source_commit=self.source_commit)

    def test_exported_snapshot_checks_payloads_without_monorepo_history(self):
        self.make_exported_snapshot()
        self.assertEqual(self.run_audit()["provenance_files"], 2)
        self.write("content/example image.png", b"changed payload")
        with self.assertRaisesRegex(ValueError, "Stale provenance SHA-256"):
            self.run_audit()

    def test_exported_snapshot_requires_matching_explicit_metadata(self):
        self.make_exported_snapshot()
        for field in ("mode", "snapshot_id", "source_manifest_sha256"):
            original = self.provenance.pop(field)
            with self.assertRaisesRegex(ValueError, "does not match classification manifest"):
                self.run_audit()
            self.provenance[field] = original
        self.snapshot["snapshot_id"] = "invalid"
        self.provenance["snapshot_id"] = "invalid"
        with self.assertRaisesRegex(ValueError, "requires a valid snapshot_id"):
            self.run_audit()

    def test_projected_provenance_builder_checks_without_overwriting_records(self):
        self.make_exported_snapshot()
        self.save()
        self.write("repository-boundary.toml", (self.root / "boundary.toml").read_text())
        before = (self.root / "provenance.json").read_bytes()
        command = [sys.executable, str(Path(__file__).with_name("build-provenance.py")),
                   "--root", str(self.root), "--output", "provenance.json"]
        result = subprocess.run([*command, "--check"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("immutable export record", result.stderr)
        self.assertEqual((self.root / "provenance.json").read_bytes(), before)

    def test_missing_classification_and_newly_tracked_path_fail(self):
        self.write("new.py", "new source\n")
        self.git("add", "new.py")
        with self.assertRaisesRegex(ValueError, "Missing classification: 'new.py'"):
            self.run_audit()

    def test_overlap_across_groups_and_duplicate_within_group_fail(self):
        self.groups.append({"id": "other", "owner": "cloud", "rationale": "Ambiguous", "paths": ["LICENSE"]})
        with self.assertRaisesRegex(ValueError, "Overlapping classification"):
            self.run_audit()
        self.groups.pop()
        self.groups[0]["paths"].append("LICENSE")
        with self.assertRaisesRegex(ValueError, "Overlapping classification"):
            self.run_audit()

    def test_stale_classification_fails_after_deletion(self):
        self.git("rm", "--", "ignored/file with spaces.txt")
        with self.assertRaisesRegex(ValueError, "Stale classification"):
            self.run_audit()

    def test_repository_plans_require_explicit_classification_without_inferred_privacy(self):
        plans = ["PLANS.md", "docs/plans/chat/chat-spec.md", "docs/plans/chat/chat-execplan.md"]
        for path in plans:
            self.write(path, "# Reviewed repository planning document\n")
        self.git("add", "--", *plans)
        with self.assertRaisesRegex(ValueError, "Missing classification"):
            self.run_audit()
        self.groups.append({
            "id": "planning", "owner": "public",
            "rationale": "Reviewed repository-owned planning documents", "paths": plans,
        })
        result = self.run_audit()
        self.assertEqual(result["owners"], {"public": 9})
        self.assertFalse(result["publication_approval"])
        self.groups[-1]["owner"] = "cloud"
        self.assertEqual(self.run_audit()["owners"]["cloud"], len(plans))

    def test_durable_architecture_contract_and_operation_docs_remain_public(self):
        docs = ["docs/architecture/boundaries.md", "docs/contracts/client.md",
                "docs/backend/operations/development.md"]
        for path in docs:
            self.write(path, "# Durable reference\n")
        self.git("add", "--", *docs)
        self.groups[0]["paths"] += docs
        self.assertEqual(self.run_audit()["owners"], {"public": 9})

    def test_deleted_working_tree_input_is_not_silently_accepted(self):
        (self.root / "LICENSE").unlink()
        with self.assertRaisesRegex(ValueError, "Tracked input absent from working tree"):
            self.run_audit()

    def test_duplicate_missing_and_stale_provenance_records_fail(self):
        original = copy.deepcopy(self.provenance["files"])
        for change, message in (("duplicate", "Duplicate provenance"), ("missing", "Missing provenance"),
                                ("stale", "Stale provenance record")):
            with self.subTest(change=change):
                self.provenance["files"] = copy.deepcopy(original)
                if change == "duplicate":
                    self.provenance["files"].append(copy.deepcopy(original[0]))
                elif change == "missing":
                    self.provenance["files"].pop()
                else:
                    self.provenance["files"][0]["path"] = "deleted.png"
                with self.assertRaisesRegex(ValueError, message):
                    self.run_audit()

    def test_stale_blob_sha_and_lfs_identity_fail(self):
        original = copy.deepcopy(self.provenance["files"])
        cases = ((0, "git_blob_oid", "0" * 40, "Stale provenance Git blob"),
                 (0, "sha256", "0" * 64, "Stale provenance SHA-256"),
                 (1, "lfs_oid", "0" * 64, "Stale provenance LFS identity"),
                 (1, "lfs_size", 999, "Stale provenance LFS identity"))
        for position, field, value, message in cases:
            with self.subTest(field=field):
                self.provenance["files"] = copy.deepcopy(original)
                self.provenance["files"][position][field] = value
                with self.assertRaisesRegex(ValueError, message):
                    self.run_audit()

    def test_unhydrated_and_corrupt_lfs_payloads_fail(self):
        self.write("unusual-lfs.txt", self.pointer)
        with self.assertRaisesRegex(ValueError, "LFS payload not materialized"):
            self.run_audit()
        self.write("unusual-lfs.txt", b"corrupt payload")
        # Updating only the recorded SHA must not hide disagreement with Git LFS.
        self.provenance["files"][1]["sha256"] = audit.digest(self.root / "unusual-lfs.txt")
        with self.assertRaisesRegex(ValueError, "Materialized LFS payload differs"):
            self.run_audit()

    def test_changed_non_lfs_payload_cannot_be_rebound_to_old_index_blob(self):
        self.write("content/example image.png", b"replacement image")
        self.provenance["files"][0]["sha256"] = audit.digest(self.root / "content/example image.png")
        with self.assertRaisesRegex(ValueError, "Materialized non-LFS payload differs from index blob"):
            self.run_audit()

    def test_staged_asset_change_requires_explicit_baseline_refresh(self):
        path = "content/example image.png"
        self.write(path, b"replacement image")
        self.git("add", "--", path)
        self.provenance["files"][0].update(
            sha256=audit.digest(self.root / path), git_blob_oid=audit.index_entries(self.root)[path]["oid"]
        )
        with self.assertRaisesRegex(ValueError, "asset index differs from source commit"):
            self.run_audit()

    def test_supporting_evidence_change_cannot_be_hidden_by_updated_hash(self):
        self.write("LICENSE", "changed supporting evidence\n")
        self.provenance["evidence"][0]["path_sha256"]["LICENSE"] = audit.digest(self.root / "LICENSE")
        with self.assertRaisesRegex(ValueError, "evidence bytes differ from index blob"):
            self.run_audit()
        self.git("add", "--", "LICENSE")
        with self.assertRaisesRegex(ValueError, "evidence index differs from source commit"):
            self.run_audit()

    def test_lfs_attribute_without_pointer_fails(self):
        self.write(".gitattributes", "LICENSE filter=lfs\n")
        self.git("add", ".gitattributes")
        self.groups[0]["paths"].append(".gitattributes")
        with self.assertRaisesRegex(ValueError, "LFS path lacks a valid index pointer"):
            self.run_audit()

    def test_stale_evidence_and_unknown_reference_fail(self):
        self.write("LICENSE", "changed license evidence\n")
        with self.assertRaisesRegex(ValueError, "Stale provenance evidence hash"):
            self.run_audit()
        self.write("LICENSE", "Fixture provenance evidence.\n")
        self.provenance["files"][0]["evidence_ids"] = ["missing"]
        with self.assertRaisesRegex(ValueError, "unknown provenance evidence"):
            self.run_audit()

    def test_stdin_subset_and_non_nul_input_fail(self):
        with self.assertRaisesRegex(ValueError, "complete Git index"):
            self.run_audit(self.paths[:-1])
        with self.assertRaisesRegex(ValueError, "NUL-terminated"):
            audit.nul_paths(b"LICENSE\n")
        with self.assertRaisesRegex(ValueError, "Duplicate tracked path"):
            audit.nul_paths(b"LICENSE\0LICENSE\0")

    def test_invalid_manifest_paths_and_owner_fail(self):
        for path in ("../escape", "/absolute", "double//slash", "trailing/", ".git/config"):
            with self.subTest(path=path):
                self.groups[0]["paths"] = [*self.paths, path]
                with self.assertRaisesRegex(ValueError, "Invalid manifest path"):
                    self.run_audit()
        self.groups[0]["paths"] = self.paths
        self.groups[0]["owner"] = "default"
        with self.assertRaisesRegex(ValueError, "Invalid owner"):
            self.run_audit()

    def test_unmerged_index_fails_before_inventory_checks(self):
        oid = self.entries["LICENSE"]["oid"]
        data = f"0 {'0' * 40}\tLICENSE\n100644 {oid} 1\tLICENSE\n100644 {oid} 2\tLICENSE\n".encode()
        subprocess.run(["git", "update-index", "--index-info"], cwd=self.root, input=data, check=True)
        with self.assertRaisesRegex(ValueError, "Resolve index conflicts"):
            self.run_audit()


if __name__ == "__main__":
    unittest.main()
