"""Real Git fixtures exercise committed export safety and independent verification."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
from export_core import canonical, classification, sha256, verify_export  # noqa: E402

SPEC = importlib.util.spec_from_file_location("repository_export", TOOLS / "export.py")
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / "source"
        self.root.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Export fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "core.hooksPath", "/dev/null")
        self.git("config", "filter.lfs.clean", "cat")
        self.git("config", "filter.lfs.smudge", "cat")
        self.git("config", "filter.lfs.process", "")
        self.git("config", "filter.lfs.required", "false")
        self.files = {
            "LICENSE": b"Private fixture license evidence.\n",
            "public.txt": b"Committed public contents.\n",
            "asset.png": b"synthetic image bytes\0",
            "docs/plans/private.md": b"Private execution plan.\n",
        }
        for path, payload in self.files.items():
            self.write(path, payload)
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        self.baseline = self.git("rev-parse", "HEAD").decode().strip()
        self.provenance = {
            "schema_version": 1,
            "source_commit": self.baseline,
            "evidence": [
                {
                    "id": "fixture",
                    "source": "Authored fixture",
                    "revision": "1",
                    "license": "UNKNOWN",
                    "unresolved_decision": "Private test fixture",
                    "required_notices": [],
                    "path_sha256": {"LICENSE": sha256(self.files["LICENSE"])},
                }
            ],
            "files": [self.provenance_record("asset.png", self.files["asset.png"])],
        }
        self.owners = {path: "cloud" if path.startswith("docs/plans/") else "public" for path in self.files}
        self.owners.update({"repository-boundary.toml": "public", "provenance.json": "public"})
        self.mappings = []
        self.allowed = []
        self.project = True
        self.save()
        self.run_count = 0

    def git(self, *args, cwd=None):
        return subprocess.run(["git", *args], cwd=cwd or self.root, capture_output=True, check=True).stdout

    def write(self, path, payload):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload.encode() if isinstance(payload, str) else payload)

    def provenance_record(self, path, payload):
        return {
            "path": path,
            "sha256": sha256(payload),
            "git_blob_oid": self.git("rev-parse", f"HEAD:{path}").decode().strip(),
            "publication_status": "review-pending",
            "evidence_ids": ["fixture"],
        }

    def save(self, *, extra_groups=None):
        lines = [
            "schema_version = 1",
            f"source_commit = {json.dumps(self.baseline)}",
            'provenance_manifest = "provenance.json"',
            "[export]",
            f"project_inventory = {str(self.project).lower()}",
            f"allowed_paths = {json.dumps(self.allowed)}",
        ]
        for mapping in self.mappings:
            lines.append("[[export.mappings]]")
            lines.extend(f"{key} = {json.dumps(value)}" for key, value in mapping.items())
        groups = [
            {
                "id": owner,
                "owner": owner,
                "rationale": "Reviewed fixture ownership",
                "paths": sorted(path for path, assigned in self.owners.items() if assigned == owner),
            }
            for owner in sorted(set(self.owners.values()))
        ]
        for group in groups + (extra_groups or []):
            lines.append("[[groups]]")
            lines.extend(f"{key} = {json.dumps(value)}" for key, value in group.items())
        self.write("repository-boundary.toml", "\n".join(lines) + "\n")
        self.write("provenance.json", canonical(self.provenance))
        self.git("add", "-f", ".")
        self.git("commit", "--allow-empty", "-qm", "reviewed inventory")
        self.commit = self.git("rev-parse", "HEAD").decode().strip()

    def run_export(self, *, explicit=True):
        self.run_count += 1
        stage = self.directory / f"export-{self.run_count}"
        result = exporter.export(
            self.root,
            self.commit if explicit else None,
            "repository-boundary.toml",
            stage / "public",
            stage / "cloud",
            stage / "export-manifest.json",
        )
        return stage, result

    def add(self, path, payload, owner="public"):
        self.write(path, payload)
        self.owners[path] = owner

    def test_deterministic_committed_exports_ignore_dirty_bytes_only_with_explicit_commit(self):
        stage, first = self.run_export(explicit=False)
        self.write("public.txt", "uncommitted replacement")
        self.write("untracked.txt", "never exported")
        self.write("repository-boundary.toml", "invalid working-tree manifest")
        with self.assertRaisesRegex(ValueError, "Dirty source"):
            self.run_export(explicit=False)
        index_before = self.git("ls-files", "--stage", "-z")
        other, second = self.run_export()
        self.assertEqual(canonical(first), canonical(second))
        self.assertEqual(index_before, self.git("ls-files", "--stage", "-z"))
        self.assertEqual((other / "public/public.txt").read_bytes(), self.files["public.txt"])
        self.assertFalse((other / "public/untracked.txt").exists())
        self.assertTrue(verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud")["verified"])

    def test_projection_is_standalone_and_contains_no_private_path_list(self):
        stage, _ = self.run_export()
        public = stage / "public"
        inventory = tomllib.loads((public / "repository-boundary.toml").read_text())
        provenance = json.loads((public / "provenance.json").read_bytes())
        self.assertEqual(inventory["mode"], "exported-snapshot")
        self.assertEqual(inventory["snapshot_id"], provenance["snapshot_id"])
        self.assertEqual(inventory["source_manifest_sha256"], provenance["source_manifest_sha256"])
        self.assertNotIn("docs/plans/private.md", (public / "repository-boundary.toml").read_text())
        self.git("init", "-q", cwd=public)
        self.git("add", ".", cwd=public)
        evidence = classification.audit(public, public / "repository-boundary.toml")
        self.assertEqual(evidence["owners"], {"public": 6})
        self.assertTrue(verify_export(stage / "export-manifest.json", public, stage / "cloud")["verified"])

    def test_external_review_commit_store_is_used_only_for_source_reads(self):
        objects = self.directory / "private-review-objects"
        objects.mkdir()
        overrides = {
            "GIT_OBJECT_DIRECTORY": str(objects),
            "GIT_ALTERNATE_OBJECT_DIRECTORIES": str(self.root / ".git/objects"),
        }
        original = self.commit
        tree = self.git("rev-parse", "HEAD^{tree}").decode().strip()
        private_commit = (
            subprocess.run(
                ["git", "commit-tree", tree, "-p", original, "-m", "immutable private review"],
                cwd=self.root,
                env=dict(os.environ, **overrides),
                capture_output=True,
                check=True,
            )
            .stdout.decode()
            .strip()
        )
        self.commit = private_commit
        with patch.dict(os.environ, overrides):
            stage, result = self.run_export()
        self.assertEqual(self.git("rev-parse", "HEAD").decode().strip(), original)
        self.assertEqual(result["source_commit"], private_commit)
        self.git("init", "-q", cwd=stage / "public")
        with patch.dict(os.environ, overrides):
            self.assertTrue(
                verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud")["verified"]
            )

    def test_missing_overlapping_and_stale_classification_fail(self):
        original = copy.deepcopy(self.owners)
        del self.owners["public.txt"]
        self.save()
        with self.assertRaisesRegex(ValueError, "Missing classification"):
            self.run_export()
        self.owners = copy.deepcopy(original)
        self.save(
            extra_groups=[{"id": "duplicate", "owner": "public", "rationale": "bad overlap", "paths": ["public.txt"]}]
        )
        with self.assertRaisesRegex(ValueError, "Overlapping classification"):
            self.run_export()
        self.owners["absent.txt"] = "public"
        self.save()
        with self.assertRaisesRegex(ValueError, "Stale classification"):
            self.run_export()

    def test_file_added_after_manifest_freeze_cannot_escape_coverage(self):
        self.write("newly-tracked.txt", "unclassified")
        self.git("add", "newly-tracked.txt")
        self.git("commit", "-qm", "new source")
        self.commit = self.git("rev-parse", "HEAD").decode().strip()
        with self.assertRaisesRegex(ValueError, "Missing classification"):
            self.run_export()

    def test_private_source_cannot_be_relabelled_or_mapped_public(self):
        self.add("scripts/repository-boundary/pin-upstream.py", "# private lock writer\n")
        self.save()
        with self.assertRaisesRegex(ValueError, "Cloud-only input"):
            self.run_export()
        self.owners["scripts/repository-boundary/pin-upstream.py"] = "cloud"
        for target in ("services/hosted-api/app.py", "Services/Hosted-Api/app.py", "docs/Plans/private.md"):
            with self.subTest(target=target):
                self.mappings = [{"source": "public.txt", "target": target}]
                self.save()
                with self.assertRaisesRegex(ValueError, "Cloud-only input"):
                    self.run_export()

    def test_traversal_windows_names_and_case_unicode_collisions_fail(self):
        for target in ("../escape", "/absolute", "C:relative", "AUX.txt", "trailing. "):
            with self.subTest(target=target):
                self.mappings = [{"source": "public.txt", "target": target}]
                self.save()
                with self.assertRaises(ValueError):
                    self.run_export()
        self.add("second.txt", "second")
        for first, second in (("Same/a.txt", "same/b.txt"), ("é.txt", "e\u0301.txt"), ("dir", "dir/file")):
            with self.subTest(first=first, second=second):
                self.mappings = [{"source": "public.txt", "target": first}, {"source": "second.txt", "target": second}]
                self.save()
                with self.assertRaisesRegex(ValueError, "collision"):
                    self.run_export()

    def test_source_and_output_symlinks_are_rejected(self):
        (self.root / "escape").symlink_to("../../outside")
        self.owners["escape"] = "public"
        self.save()
        with self.assertRaisesRegex(ValueError, "symlinks"):
            self.run_export()
        (self.root / "escape").unlink()
        del self.owners["escape"]
        self.save()
        destination = self.directory / "linked"
        destination.symlink_to(self.directory / "elsewhere")
        with self.assertRaisesRegex(ValueError, "symlink"):
            exporter.export(
                self.root,
                self.commit,
                "repository-boundary.toml",
                destination,
                self.directory / "cloud",
                self.directory / "manifest.json",
            )

    def test_secret_canaries_and_private_keys_fail_without_printing_bytes(self):
        examples = [b"ANIMAMA_SPLIT_SECRET_CANARY_" + b"A" * 32, b"-----" + b"BEGIN PRIVATE KEY-----\nsynthetic\n"]
        for payload in examples:
            with self.subTest(payload_type=payload[:5]):
                self.add("canary.txt", payload)
                self.save()
                with self.assertRaisesRegex(ValueError, "Secret/key canary") as error:
                    self.run_export()
                self.assertNotIn(payload.decode(), str(error.exception))

    def test_exact_reviewed_build_exception_does_not_admit_credentials_or_other_build_files(self):
        path = "desktop/build/entitlements.plist"
        self.add(path, "authored packaging resource")
        self.save()
        with self.assertRaisesRegex(ValueError, "generated-state"):
            self.run_export()
        self.allowed = [path]
        self.save()
        self.run_export()
        self.add(".env", "PRIVATE_SETTING=fixture")
        self.allowed.append(".env")
        self.save()
        with self.assertRaisesRegex(ValueError, "Credential"):
            self.run_export()

    def test_full_private_plan_and_private_service_cannot_be_public(self):
        self.owners["docs/plans/private.md"] = "public"
        self.save()
        with self.assertRaisesRegex(ValueError, "cloud-owned"):
            self.run_export()
        self.owners["docs/plans/private.md"] = "cloud"
        self.add("services/identity/app.py", "health = True")
        self.save()
        with self.assertRaisesRegex(ValueError, "Cloud-only"):
            self.run_export()

    def test_same_owner_template_replacement_and_cross_owner_rejection(self):
        self.add("templates/public.txt", "reviewed public replacement")
        self.mappings = [{"source": "templates/public.txt", "target": "public.txt", "replaces": "public.txt"}]
        self.save()
        stage, result = self.run_export()
        self.assertEqual((stage / "public/public.txt").read_text(), "reviewed public replacement")
        self.assertFalse((stage / "public/templates/public.txt").exists())
        original = next(row for row in result["source_files"] if row["path"] == "public.txt")
        self.assertEqual(original["disposition"], "replaced")
        self.owners["templates/public.txt"] = "cloud"
        self.save()
        with self.assertRaisesRegex(ValueError, "same-owner"):
            self.run_export()

    def test_nonempty_retry_and_outputs_inside_source_are_rejected(self):
        stage, _ = self.run_export()
        with self.assertRaisesRegex(ValueError, "empty"):
            exporter.export(
                self.root,
                self.commit,
                "repository-boundary.toml",
                stage / "public",
                stage / "cloud",
                stage / "another-manifest.json",
            )
        with self.assertRaisesRegex(ValueError, "outside"):
            exporter.export(
                self.root,
                self.commit,
                "repository-boundary.toml",
                self.root / "output",
                self.directory / "cloud",
                self.directory / "manifest.json",
            )

    def test_provenance_missing_records_and_stale_evidence_fail(self):
        self.provenance["files"] = []
        self.save()
        with self.assertRaisesRegex(ValueError, "Missing provenance"):
            self.run_export()
        self.provenance["files"] = [self.provenance_record("asset.png", self.files["asset.png"])]
        self.write("LICENSE", "changed evidence")
        self.save()
        with self.assertRaisesRegex(ValueError, "Stale or missing provenance evidence"):
            self.run_export()

    def add_lfs(self, *, marked=True):
        payload = b"hydrated synthetic binary\0" * 17
        oid = hashlib.sha256(payload).hexdigest()
        path = "unusual-lfs.txt"
        self.add(path, classification.LFS_HEADER + f"oid sha256:{oid}\nsize {len(payload)}\n".encode())
        if marked:
            self.add(".gitattributes", f"{path} filter=lfs diff=lfs merge=lfs -text\n")
            self.git("add", ".gitattributes")
        self.git("add", path)
        self.git("commit", "-qm", "LFS baseline")
        self.baseline = self.git("rev-parse", "HEAD").decode().strip()
        self.provenance["source_commit"] = self.baseline
        record = self.provenance_record(path, payload)
        record.update(lfs_oid=oid, lfs_size=len(payload))
        self.provenance["files"].append(record)
        self.save()
        object_path = self.root / ".git/lfs/objects" / oid[:2] / oid[2:4] / oid
        object_path.parent.mkdir(parents=True)
        object_path.write_bytes(payload)
        return path, payload, object_path

    def test_lfs_payload_outside_asset_roots_uses_verified_object_bytes_not_worktree(self):
        path, payload, object_path = self.add_lfs()
        self.write(path, "dirty bytes are irrelevant")
        stage, result = self.run_export()
        self.assertEqual((stage / "public" / path).read_bytes(), payload)
        record = next(row for row in result["exports"]["public"]["files"] if row["path"] == path)
        self.assertEqual(record["lfs_oid"], sha256(payload))
        object_path.write_bytes(b"corrupted")
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.run_export()
        object_path.unlink()
        self.write(path, payload)
        with self.assertRaisesRegex(ValueError, "not hydrated"):
            self.run_export()

    def test_projection_rejects_unmarked_and_uncovered_mapped_lfs_targets(self):
        path, payload, _ = self.add_lfs(marked=False)
        with self.assertRaisesRegex(ValueError, "require committed LFS attributes"):
            self.run_export()
        self.project = False
        self.save()
        stage, _ = self.run_export()
        self.assertEqual((stage / "public" / path).read_bytes(), payload)
        self.project = True
        self.add(".gitattributes", f"{path} filter=lfs diff=lfs merge=lfs -text\n")
        self.mappings = [{"source": path, "target": "uncovered.dat"}]
        self.save()
        with self.assertRaisesRegex(ValueError, "require committed LFS attributes"):
            self.run_export()

    def test_dirty_export_implementation_cannot_claim_another_committed_tool_version(self):
        self.add("scripts/repository-boundary/export_core.py", "different committed implementation")
        self.save()
        with self.assertRaisesRegex(ValueError, "Run the committed exporter tools"):
            self.run_export()

    def test_lfs_attribute_without_pointer_fails_at_selected_commit(self):
        self.add(".gitattributes", "public.txt filter=lfs diff=lfs merge=lfs -text\n")
        self.save()
        with self.assertRaisesRegex(ValueError, "attribute lacks a pointer"):
            self.run_export()

    def test_verifier_rejects_content_mode_missing_extra_symlinks_and_original_history(self):
        stage, _ = self.run_export()
        target = stage / "public/public.txt"
        target.write_text("tampered")
        with self.assertRaisesRegex(ValueError, "differs"):
            verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud")
        target.write_bytes(self.files["public.txt"])
        target.chmod(0o755)
        with self.assertRaisesRegex(ValueError, "differs"):
            verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud")
        target.chmod(0o644)
        target.unlink()
        with self.assertRaisesRegex(ValueError, "Missing"):
            verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud")
        target.symlink_to(self.root / "public.txt")
        with self.assertRaisesRegex(ValueError, "symlink"):
            verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud")
        target.unlink()
        target.write_bytes(self.files["public.txt"])
        extra = stage / "cloud/unrecorded.txt"
        extra.write_text("unrecorded")
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud")
        extra.unlink()
        shutil.copytree(self.root / ".git", stage / "public/.git")
        with self.assertRaisesRegex(ValueError, "original source history"):
            verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud")

    def test_generated_layer_binds_base_and_declares_all_changes(self):
        stage, result = self.run_export()
        payload = b"deterministic artifact pins\n"
        target = stage / "cloud/upstream/animama.lock"
        target.parent.mkdir()
        target.write_bytes(payload)
        layer = {
            "schema_version": 1,
            "kind": "generated-export-layer",
            "owner": "cloud",
            "base_tree_sha256": result["exports"]["cloud"]["tree_sha256"],
            "files": [
                {
                    "path": "upstream/animama.lock",
                    "sha256": sha256(payload),
                    "size": len(payload),
                    "mode": "100644",
                    "operation": "add",
                }
            ],
        }
        layer_path = stage / "generated-layer.json"
        layer_path.write_bytes(canonical(layer))
        self.assertEqual(
            verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud", [layer_path])[
                "generated_files"
            ],
            1,
        )
        layer["base_tree_sha256"] = "0" * 64
        layer_path.write_bytes(canonical(layer))
        with self.assertRaisesRegex(ValueError, "bind"):
            verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud", [layer_path])

    def test_generated_replacement_requires_exact_base_and_rechecks_secrets(self):
        stage, result = self.run_export()
        path = "docs/plans/private.md"
        target = stage / "cloud" / path
        original = next(row for row in result["exports"]["cloud"]["files"] if row["path"] == path)
        payload = b"deterministic generated replacement\n"
        target.write_bytes(payload)
        record = {
            "path": path,
            "sha256": sha256(payload),
            "size": len(payload),
            "mode": "100644",
            "operation": "replace",
            "base_sha256": original["sha256"],
        }
        layer = {
            "schema_version": 1,
            "kind": "generated-export-layer",
            "owner": "cloud",
            "base_tree_sha256": result["exports"]["cloud"]["tree_sha256"],
            "files": [record],
        }
        layer_path = stage / "generated-layer.json"
        layer_path.write_bytes(canonical(layer))
        verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud", [layer_path])
        record["base_sha256"] = "0" * 64
        layer_path.write_bytes(canonical(layer))
        with self.assertRaisesRegex(ValueError, "original bytes"):
            verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud", [layer_path])
        record["base_sha256"] = original["sha256"]
        payload = b"ANIMAMA_SPLIT_SECRET_CANARY_" + b"X" * 32
        target.write_bytes(payload)
        record.update(sha256=sha256(payload), size=len(payload))
        layer_path.write_bytes(canonical(layer))
        with self.assertRaisesRegex(ValueError, "Secret/key canary"):
            verify_export(stage / "export-manifest.json", stage / "public", stage / "cloud", [layer_path])


if __name__ == "__main__":
    unittest.main()
