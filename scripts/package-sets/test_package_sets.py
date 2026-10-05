"""Exercise policy failures against real archives and independent Git snapshots."""

import copy
import io
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import build
from package_set import canonical, compare, file_record, identity, metadata, verify


def fixture(root):
    root.mkdir()
    for name in ("runtime-contracts", "product-ui", "discover-client"):
        with tarfile.open(root / f"animama-{name}-0.1.0.tgz", "w:gz") as t:
            for path, data in {
                "package/package.json": canonical({"name": f"@animama/{name}", "version": "0.1.0"}),
                "package/dist/types/index.d.ts": b"export interface Owner { id: string; }",
            }.items():
                info = tarfile.TarInfo(path)
                info.size = len(data)
                t.addfile(info, io.BytesIO(data))
    with zipfile.ZipFile(root / "animama_backend-0.1.0-py3-none-any.whl", "w") as z:
        z.writestr("animama_backend-0.1.0.dist-info/METADATA", "Name: animama-backend\nVersion: 0.1.0\n")
    (root / "runtime-owner.schema.json").write_bytes(
        canonical({"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]})
    )
    (root / "openapi.json").write_bytes(canonical({"openapi": "3.1.0", "paths": {"/v1/chats": {}}}))
    m = {
        "schema_version": 1,
        "source": {
            "commit": "a" * 40,
            "tree": "b" * 40,
            "dirty": False,
            "snapshot_sha256": "c" * 64,
            "source_date_epoch": 1,
        },
        "build": {
            "inputs": {name: "d" * 64 for name in ("uv.lock", "src/frontend/pnpm-lock.yaml", "pyproject.toml")},
            "recipe": {"scripts/package-sets/build.py": "e" * 64},
            "python": "3.12.13",
            "uv": "uv 0.11.0",
            "node": "v24.15.0",
            "pnpm": "10.33.0",
        },
        "packages": [
            file_record(root, p.name, **metadata(p)) for p in sorted(root.iterdir()) if p.suffix in {".whl", ".tgz"}
        ],
        "contracts": [
            file_record(root, n, kind="contract", name=name, version="1.0.0")
            for name, n in [("runtime-owner", "runtime-owner.schema.json"), ("local-http", "openapi.json")]
        ],
    }
    write_manifest(root, m)
    return m


def write_manifest(root, m):
    (root / "manifest.json").write_bytes(canonical(m))
    (root / "SHA256SUMS").write_text(
        "".join(
            f"{r['sha256']}  {r['file']}\n"
            for r in sorted(m["packages"] + m["contracts"] + m.get("applications", []), key=lambda x: x["file"])
        )
    )


class PackageSetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.old = self.root / "old"
        self.m = fixture(self.old)

    def test_exact_set_and_content_identity(self):
        self.assertEqual(verify(self.old), self.m)
        self.assertIn("/" + "a" * 40 + "/", identity(self.m))
        changed = copy.deepcopy(self.m)
        changed["source"]["snapshot_sha256"] = "e" * 64
        self.assertNotEqual(identity(changed), identity(self.m))

    def test_format_one_does_not_accept_unverified_build_fields(self):
        m = copy.deepcopy(self.m)
        m["build"]["private_source"] = "../unverified-source"
        write_manifest(self.old, m)
        with self.assertRaisesRegex(ValueError, "build"):
            verify(self.old)

    def test_build_hashes_require_safe_recipe_paths_and_exact_lock_inputs(self):
        for mutate in (
            lambda m: m["build"]["recipe"].update({"../source.py": "e" * 64}),
            lambda m: m["build"]["inputs"].update({"private.lock": "d" * 64}),
            lambda m: m["build"]["recipe"].update({"scripts/build.py": "not-a-digest"}),
        ):
            with self.subTest(mutate=mutate):
                m = copy.deepcopy(self.m)
                mutate(m)
                write_manifest(self.old, m)
                with self.assertRaises(ValueError):
                    verify(self.old)

    def test_corrupt_digest_floating_commit_missing_version_and_path(self):
        for mutate in (
            lambda m: m["source"].update(commit="main"),
            lambda m: m["packages"][0].update(sha256="d" * 64),
            lambda m: m["contracts"][0].pop("version"),
            lambda m: m["packages"][0].update(file="../escape"),
        ):
            m = copy.deepcopy(self.m)
            mutate(m)
            write_manifest(self.old, m)
            with self.assertRaises((ValueError, KeyError)):
                verify(self.old)

    def test_contract_documentation_passes_but_structural_change_needs_major(self):
        import shutil

        new = self.root / "new"
        shutil.copytree(self.old, new)
        m = copy.deepcopy(self.m)
        path = new / "runtime-owner.schema.json"
        schema = json.loads(path.read_text())
        schema["description"] = "Harmless description"
        path.write_bytes(canonical(schema))
        m["contracts"][0] = file_record(new, path.name, kind="contract", name="runtime-owner", version="1.0.0")
        write_manifest(new, m)
        compare(self.old, new)
        schema["required"].append("newRequiredField")
        path.write_bytes(canonical(schema))
        m["contracts"][0] = file_record(new, path.name, kind="contract", name="runtime-owner", version="1.0.0")
        write_manifest(new, m)
        with self.assertRaisesRegex(ValueError, "major"):
            compare(self.old, new)
        m["contracts"][0]["version"] = "2.0.0"
        write_manifest(new, m)
        compare(self.old, new)

    def test_snapshot_rejects_dirty_and_override_in_ci_and_excludes_ignored_secrets(self):
        repo = self.root / "repo"
        repo.mkdir()
        (repo / "a.txt").write_text("tracked")
        (repo / ".gitignore").write_text(".env\n")

        def git(*args):
            return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()

        git("init", "-q")
        git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture")
        commit = git("rev-parse", "HEAD")
        (repo / ".env").write_text("never copy this")
        dest = self.root / "clean"
        dest.mkdir()
        build.snapshot(repo, commit, dest)
        self.assertFalse((dest / ".env").exists())
        (repo / "a.txt").write_text("dirty")
        with self.assertRaisesRegex(ValueError, "Dirty"):
            build.snapshot(repo, commit, self.root / "bad")
        with patch.dict(os.environ, {"CI": "true"}), self.assertRaisesRegex(ValueError, "forbidden"):
            build.snapshot(repo, commit, self.root / "ci", True)
        with patch.dict(os.environ, {}, clear=True):
            dest = self.root / "dev"
            dest.mkdir()
            record = build.snapshot(repo, commit, dest, True)
            self.assertTrue(record["dirty"])
            self.assertEqual((dest / "a.txt").read_text(), "dirty")

    def test_snapshot_records_agent_tooling_links_without_following_them(self):
        repo = self.root / "links"
        (repo / ".agents/skills").mkdir(parents=True)
        (repo / ".agents/skills/s.md").write_text("skill")
        (repo / ".claude").mkdir()
        (repo / ".claude/skills").symlink_to("../.agents/skills")

        def git(*args):
            return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()

        git("init", "-q")
        git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture")
        dest = self.root / "links-out"
        dest.mkdir()
        record = build.snapshot(repo, git("rev-parse", "HEAD"), dest)
        self.assertFalse((dest / ".claude/skills").exists())
        self.assertEqual((dest / ".agents/skills/s.md").read_text(), "skill")
        # The link is still bound into the snapshot identity.
        (repo / ".claude/skills").unlink()
        (repo / ".claude/skills").symlink_to("../.agents")
        git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "retarget")
        other = self.root / "links-other"
        other.mkdir()
        changed = build.snapshot(repo, git("rev-parse", "HEAD"), other)
        self.assertNotEqual(record["snapshot_sha256"], changed["snapshot_sha256"])

    def test_snapshot_rejects_product_and_escaping_links(self):
        for name, target in (("src/link", "../a.txt"), (".claude/out", "../../outside")):
            repo = self.root / f"bad-{name.replace('/', '-')}"
            (repo / Path(name).parent).mkdir(parents=True)
            (repo / "a.txt").write_text("tracked")
            (repo / name).symlink_to(target)

            def git(*args, repo=repo):
                return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()

            git("init", "-q")
            git("add", ".")
            git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture")
            dest = self.root / f"{repo.name}-out"
            dest.mkdir()
            with self.assertRaisesRegex(ValueError, "symlink|escapes"):
                build.snapshot(repo, git("rev-parse", "HEAD"), dest)


class RepositoryDependencyTests(unittest.TestCase):
    def test_private_import_and_sibling_manifest_rejected(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "repository_check", Path(__file__).resolve().parents[1] / "check-repository-dependencies.py"
        )
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src").mkdir()
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            py = root / "src/example.py"
            py.write_text("import animama_cloud.private_service\n")
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)
            with self.assertRaisesRegex(ValueError, "private import"):
                checker.check(root)
            py.write_text("import json\n")
            manifest = root / "package.json"
            manifest.write_text(json.dumps({"dependencies": {"shared": "file:../animama-cloud"}}))
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)
            with self.assertRaisesRegex(ValueError, "external dependency"):
                checker.check(root)
            manifest.write_text(json.dumps({"dependencies": {"shared": "file:./public-package"}}))
            self.assertEqual(checker.check(root)["private_dependencies"], 0)


if __name__ == "__main__":
    unittest.main()
