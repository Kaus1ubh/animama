"""Integration fixtures for inventory scope, coverage rules, and checkout drift."""

from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import architecture_inventory as inventory


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="architecture-inventory-test-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = self.base / "checkout with spaces"
        self.repo.mkdir()
        self.run_git("init", "-q", "--initial-branch=main")
        self.run_git("config", "user.name", "Inventory Test")
        self.run_git("config", "user.email", "inventory@example.invalid")
        self.write("src/main.py", "print('hello')\n")
        self.run_git("add", ".")
        self.run_git("commit", "-qm", "Initial fixture")
        self.snapshot_path = self.base / "inventory.json"
        self.coverage_path = self.base / "coverage.jsonl"

    def run_git(self, *args, cwd=None):
        return subprocess.run(
            ["git", "-C", str(cwd or self.repo), *args],
            capture_output=True,
            check=True,
            env=dict(os.environ, GIT_CONFIG_NOSYSTEM="1"),
        ).stdout

    def write(self, path, contents):
        output = self.repo / path
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(contents, encoding="utf-8")
        return output

    def call(self, *args):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            result = inventory.main(list(map(str, args)))
        return result, stdout.getvalue(), stderr.getvalue()

    def snapshot(self, *extra, output=None):
        target = output or self.snapshot_path
        result = self.call("snapshot", "--repo", self.repo, "--output", target, *extra)
        self.assertEqual(result[0], 0, result)
        return json.loads(target.read_text(encoding="utf-8"))

    def coverage(self, data, dispositions=None):
        dispositions = dispositions or {}
        records = [
            {
                "path": entry["path"],
                "unit": "U01",
                "disposition": dispositions.get(entry["path"], "reviewed"),
                "note": "units/U01.md: inspected entrypoint and its callers",
            }
            for entry in data["files"]
        ]
        self.save_coverage(records)
        return records

    def save_coverage(self, records):
        self.coverage_path.write_text(
            "".join(json.dumps(record, ensure_ascii=True) + "\n" for record in records),
            encoding="utf-8",
        )

    def check(self):
        return self.call("check", "--inventory", self.snapshot_path, "--coverage", self.coverage_path)

    def test_clean_full_checkout_coverage_is_current(self):
        self.write("new untracked.py", "new code\n")
        data = self.snapshot()
        self.assertEqual(data["schema_version"], 1)
        self.assertEqual(data["root"], str(self.repo.resolve()))
        self.assertEqual([entry["path"] for entry in data["files"]], ["new untracked.py", "src/main.py"])
        self.assertEqual(data["files"][0]["fingerprint"], hashlib.sha256(b"new code\n").hexdigest())
        self.coverage(data)
        result = self.check()
        self.assertEqual(result[0], 0, result)
        self.assertIn("2/2 paths", result[1])
        self.assertIn("does not prove architectural analysis", result[1])

    def test_nested_repo_argument_still_scans_whole_checkout(self):
        self.write("outside.txt", "outside nested source directory")
        result = self.call("snapshot", "--repo", self.repo / "src", "--output", self.snapshot_path)
        self.assertEqual(result[0], 0, result)
        data = json.loads(self.snapshot_path.read_text())
        self.assertEqual([entry["path"] for entry in data["files"]], ["outside.txt", "src/main.py"])

    def test_pending_and_missing_coverage_fail(self):
        data = self.snapshot()
        self.coverage(data, {"src/main.py": "pending"})
        result = self.check()
        self.assertEqual(result[0], 1, result)
        self.assertIn("1 pending", result[1])
        self.save_coverage([])
        result = self.check()
        self.assertEqual(result[0], 1, result)
        self.assertIn("1 missing", result[1])

    def test_duplicate_unknown_and_invalid_records_are_invalid_data(self):
        data = self.snapshot()
        records = self.coverage(data)
        bad_records = [
            records + records,
            records + [{**records[0], "path": "unknown.py"}],
            [{**records[0], "unit": " "}],
            [{**records[0], "note": ""}],
            [{**records[0], "disposition": "finished"}],
            [{**records[0], "disposition": []}],
        ]
        for bad in bad_records:
            with self.subTest(records=bad):
                self.save_coverage(bad)
                result = self.check()
                self.assertEqual(result[0], 2, result)
                self.assertTrue(result[2].startswith("Error:"))

    def test_content_and_addition_drift(self):
        data = self.snapshot()
        self.coverage(data)
        self.write("src/main.py", "print('other')\n")
        self.write("new.py", "new")
        result = self.check()
        self.assertEqual(result[0], 1, result)
        self.assertIn("1 added, 0 removed, 1 changed", result[1])

    def test_untracked_removal_and_tracked_deletion_drift(self):
        self.write("temporary.txt", "temporary")
        data = self.snapshot()
        self.coverage(data)
        (self.repo / "temporary.txt").unlink()
        (self.repo / "src/main.py").unlink()
        result = self.check()
        self.assertEqual(result[0], 1, result)
        self.assertIn("0 added, 1 removed, 1 changed", result[1])

    def test_head_change_without_content_drift(self):
        data = self.snapshot()
        self.coverage(data)
        self.run_git("commit", "--allow-empty", "-qm", "Provenance changed")
        result = self.check()
        self.assertEqual(result[0], 1, result)
        self.assertIn("0 added, 0 removed, 0 changed; HEAD changed", result[1])

    def test_symlink_hash_is_target_not_contents_and_retargeting_is_drift(self):
        outside = self.base / "secret.txt"
        outside.write_text("A secret that must never enter inventory output")
        link = self.repo / "external-link"
        link.symlink_to(outside)
        data = self.snapshot()
        entry = next(entry for entry in data["files"] if entry["path"] == "external-link")
        self.assertEqual(entry["kind"], "symlink")
        self.assertEqual(entry["fingerprint"], hashlib.sha256(os.fsencode(str(outside))).hexdigest())
        self.assertNotIn("A secret", self.snapshot_path.read_text())
        self.coverage(data)
        self.assertEqual(self.check()[0], 1)  # A special path cannot be source-reviewed.
        self.coverage(data, {"external-link": "supporting"})
        self.assertEqual(self.check()[0], 0)
        outside.write_text("Changing the target contents must not trigger traversal")
        self.assertEqual(self.check()[0], 0)
        link.unlink()
        link.symlink_to(self.base / "different.txt")
        result = self.check()
        self.assertEqual(result[0], 1, result)
        self.assertIn("1 changed", result[1])

    def test_replaced_parent_symlink_does_not_traverse(self):
        (self.repo / "src/main.py").unlink()
        (self.repo / "src").rmdir()
        outside = self.base / "outside-source"
        outside.mkdir()
        (outside / "main.py").write_text("outside content")
        (self.repo / "src").symlink_to(outside, target_is_directory=True)
        data = self.snapshot()
        entry = next(entry for entry in data["files"] if entry["path"] == "src/main.py")
        self.assertEqual(entry["kind"], "other")
        self.assertEqual(entry["state"], "symlink_ancestor")

    def test_deleted_tracked_files_are_accounted_for(self):
        (self.repo / "src/main.py").unlink()
        data = self.snapshot()
        self.assertEqual(data["files"][0]["kind"], "missing")
        self.coverage(data)
        self.assertEqual(self.check()[0], 1)
        self.coverage(data, {"src/main.py": "excluded"})
        self.assertEqual(self.check()[0], 0)

    def test_tracked_ignored_and_odd_names_are_included(self):
        names = [
            "name with spaces.txt",
            "line\nbreak.txt",
            "tab\tname.txt",
            "back\\slash.txt",
            "-option.txt",
            "ignored.txt",
        ]
        for name in names:
            self.write(name, "test")
        self.run_git("add", "--", *names)
        self.write(".gitignore", "ignored*\n")
        self.write("ignored-untracked.txt", "ignored")
        data = self.snapshot()
        paths = [entry["path"] for entry in data["files"]]
        for name in names:
            self.assertIn(name, paths)
        self.assertNotIn("ignored-untracked.txt", paths)
        self.assertEqual(paths, sorted(paths))
        self.coverage(data)
        self.assertEqual(self.check()[0], 0)

    def test_exclusions_are_explicit_accounted_and_stable_for_artifacts(self):
        self.write("review/notes.md", "review output")
        self.write("review-old/source.py", "not excluded by review prefix")
        output = self.repo / "review/inventory.json"
        data = self.snapshot("--exclude-prefix", "review/", "--exclude-reason", "Review artifacts", output=output)
        self.assertEqual(data["exclusions"], [{"prefix": "review", "reason": "Review artifacts"}])
        self.assertEqual(
            data["excluded_paths"], [{"path": "review/notes.md", "prefix": "review", "reason": "Review artifacts"}]
        )
        self.assertIn("review-old/source.py", [entry["path"] for entry in data["files"]])
        self.snapshot_path = output
        self.coverage_path = self.repo / "review/coverage.jsonl"
        self.coverage(data)
        result = self.check()
        self.assertEqual(result[0], 0, result)
        self.assertIn("1 paths at snapshot, 3 now", result[1])

    def test_inside_output_requires_explicit_exclusion(self):
        output = self.repo / "review/inventory.json"
        result = self.call("snapshot", "--repo", self.repo, "--output", output)
        self.assertEqual(result[0], 2, result)
        self.assertIn("explicit --exclude-prefix", result[2])
        self.assertFalse(output.parent.exists())

    def test_repeatable_exclusions_and_invalid_prefixes(self):
        self.write("review/notes.md", "output")
        self.write("reports/notes.md", "output")
        data = self.snapshot("--exclude-prefix", "review", "--exclude-prefix", "reports")
        self.assertEqual(data["counts"]["excluded"], 2)
        for prefix in (".", "../escape", "/absolute", "a/../b", "a//b"):
            with self.subTest(prefix=prefix):
                result = self.call(
                    "snapshot", "--repo", self.repo, "--output", self.base / "new.json", "--exclude-prefix", prefix
                )
                self.assertEqual(result[0], 2, result)

    def test_overwrite_protection_and_force_atomic_replacement(self):
        self.snapshot()
        original = self.snapshot_path.read_bytes()
        result = self.call("snapshot", "--repo", self.repo, "--output", self.snapshot_path)
        self.assertEqual(result[0], 2, result)
        self.assertEqual(self.snapshot_path.read_bytes(), original)
        self.write("new.txt", "changed")
        self.snapshot("--force")
        self.assertNotEqual(self.snapshot_path.read_bytes(), original)
        self.assertEqual(list(self.base.glob(".inventory-*")), [])

    def test_unborn_repository(self):
        unborn = self.base / "unborn"
        unborn.mkdir()
        self.run_git("init", "-q", cwd=unborn)
        (unborn / "new.txt").write_text("new")
        result = self.call("snapshot", "--repo", unborn, "--output", self.snapshot_path)
        self.assertEqual(result[0], 0, result)
        data = json.loads(self.snapshot_path.read_text())
        self.assertIsNone(data["head"])
        self.coverage(data)
        self.assertEqual(self.check()[0], 0)

    def test_submodule_is_explicit_and_not_recursed(self):
        submodule = self.repo / "vendor/lib"
        submodule.mkdir(parents=True)
        self.run_git("init", "-q", cwd=submodule)
        (submodule / "library.py").write_text("library source")
        self.run_git("add", ".", cwd=submodule)
        self.run_git(
            "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Library", cwd=submodule
        )
        oid = self.run_git("rev-parse", "HEAD", cwd=submodule).decode().strip()
        self.run_git("update-index", "--add", "--cacheinfo", f"160000,{oid},vendor/lib")
        data = self.snapshot()
        paths = [entry["path"] for entry in data["files"]]
        self.assertIn("vendor/lib", paths)
        self.assertNotIn("vendor/lib/library.py", paths)
        entry = next(entry for entry in data["files"] if entry["path"] == "vendor/lib")
        self.assertEqual(entry["kind"], "submodule")
        self.assertEqual(entry["submodule"]["checkout_head"], oid)
        self.assertFalse(entry["submodule"]["dirty"])
        self.coverage(data)
        self.assertEqual(self.check()[0], 1)
        self.coverage(data, {"vendor/lib": "supporting"})
        self.assertEqual(self.check()[0], 0)
        (submodule / "library.py").write_text("library changed")
        result = self.check()
        self.assertEqual(result[0], 1, result)
        self.assertIn("1 changed", result[1])

    def test_invalid_json_and_inventory_schema(self):
        self.snapshot_path.write_text("{broken")
        self.coverage_path.write_text("")
        self.assertEqual(self.check()[0], 2)
        self.snapshot_path.unlink()
        data = self.snapshot()
        self.coverage_path.write_text("{broken\n")
        self.assertEqual(self.check()[0], 2)
        self.coverage(data)
        variants = [
            {**data, "schema_version": True},
            {**data, "files": data["files"] + data["files"]},
            {**data, "files": [{**data["files"][0], "kind": []}]},
            {**data, "files": [{**data["files"][0], "fingerprint": "bad"}]},
            {**data, "counts": {}},
            {**data, "excluded_paths": [{"path": "unknown"}]},
            {**data, "root": "/bad\x00root"},
            {**data, "head": []},
            {**data, "provenance": {"status_entries": []}},
        ]
        for invalid in variants:
            with self.subTest(data=invalid):
                self.snapshot_path.write_text(json.dumps(invalid))
                self.assertEqual(self.check()[0], 2)

    def test_drift_examples_are_bounded_and_terminal_safe(self):
        data = self.snapshot()
        self.coverage(data)
        for index in range(10):
            self.write(f"new\n{index}.txt", "new")
        result = self.check()
        self.assertEqual(result[0], 1, result)
        self.assertIn("(+5 more)", result[1])
        self.assertIn('"new\\n0.txt"', result[1])

    def test_snapshot_and_check_do_not_change_index(self):
        index = self.repo / ".git/index"
        before = index.read_bytes()
        data = self.snapshot()
        self.coverage(data)
        self.assertEqual(self.check()[0], 0)
        self.assertEqual(index.read_bytes(), before)

    def test_staging_only_change_is_provenance_drift(self):
        self.write("src/main.py", "changed")
        data = self.snapshot()
        self.assertTrue(data["provenance"]["in_scope_dirty"])
        self.coverage(data)
        self.assertEqual(self.check()[0], 0)
        self.run_git("add", "src/main.py")
        result = self.check()
        self.assertEqual(result[0], 1, result)
        self.assertIn("0 added, 0 removed, 0 changed", result[1])
        self.assertIn("Index/worktree status: changed", result[1])

    def test_rename_status_keeps_original_path(self):
        self.run_git("mv", "src/main.py", "src/new name.py")
        data = self.snapshot()
        records = data["provenance"]["status_entries"]
        self.assertEqual(records, [{"path": "src/new name.py", "original_path": "src/main.py", "status": "R "}])
        self.coverage(data)
        self.assertEqual(self.check()[0], 0)

    def test_executable_change_detected_even_when_content_is_already_dirty(self):
        self.run_git("config", "core.fileMode", "false")
        source = self.write("src/main.py", "already changed")
        data = self.snapshot()
        self.coverage(data)
        self.assertEqual(self.check()[0], 0)
        source.chmod(source.stat().st_mode | 0o100)
        result = self.check()
        self.assertEqual(result[0], 1, result)
        self.assertIn("1 changed", result[1])
        self.assertIn("Index/worktree status: unchanged", result[1])


if __name__ == "__main__":
    unittest.main()
