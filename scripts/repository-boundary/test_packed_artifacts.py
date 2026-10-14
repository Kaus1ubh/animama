"""Catch artifact boundaries that silently resolve back to source checkouts."""

import importlib.util
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("packed", Path(__file__).with_name("check-packed-artifacts.py"))
packed = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packed)


class PackedArtifactTests(unittest.TestCase):
    """Real npm tarballs exercise manifest, emitted export and path validation."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "package.tgz"
        self.metadata = {
            "name": "@animama/runtime-contracts",
            "version": "0.1.0",
            "exports": {".": {"import": "./dist/index.js", "types": "./dist/index.d.ts"}},
        }
        self.files = {
            "dist/index.js": "export const answer = 42;",
            "dist/index.d.ts": "export declare const answer: 42;",
        }

    def pack(self):
        """Write the same package envelope emitted by npm/pnpm pack."""
        with tarfile.open(self.path, "w:gz") as archive:
            for name, content in {"package.json": json.dumps(self.metadata), **self.files}.items():
                data = content.encode()
                member = tarfile.TarInfo("package/" + name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))

    def test_emitted_package_passes(self):
        self.pack()
        self.assertEqual(packed.inspect_tarball(self.path)["name"], self.metadata["name"])

    def test_workspace_dependency_cannot_masquerade_as_portable_package(self):
        self.metadata["dependencies"] = {"@animama/product-ui": "workspace:*"}
        self.pack()
        with self.assertRaisesRegex(ValueError, "Source dependency"):
            packed.inspect_tarball(self.path)

    def test_private_web_alias_in_declarations_is_rejected(self):
        self.files["dist/index.d.ts"] = 'export type { Owner } from "@/app/local-runtime";'
        self.pack()
        with self.assertRaisesRegex(ValueError, "Checkout-bound import"):
            packed.inspect_tarball(self.path)

    def test_missing_emitted_export_is_rejected(self):
        del self.files["dist/index.js"]
        self.pack()
        with self.assertRaisesRegex(ValueError, "emitted artifact bytes"):
            packed.inspect_tarball(self.path)

    def test_unsafe_archive_member_is_rejected(self):
        self.files["../outside.js"] = "export {};"
        self.pack()
        with self.assertRaisesRegex(ValueError, "Unsafe package member"):
            packed.inspect_tarball(self.path)

    def test_resolution_receipt_binds_retained_graph_and_inventory_bytes(self):
        work = Path(self.temp.name)
        graph = work / "pnpm-lock.yaml"
        graph.write_text("lockfileVersion: '9.0'\n")
        inventory = work / "backend-dependencies.json"
        inventory.write_text('[{"name":"example","version":"1.2.3"}]\n')
        receipt = packed.dependency_receipt([graph, inventory], work)
        self.assertEqual(receipt["mode"], "fresh-resolution")
        self.assertFalse(receipt["source_lockfiles_used"])
        self.assertEqual(receipt["evidence"][0]["path"], "pnpm-lock.yaml")
        original = receipt["evidence"][1]["sha256"]
        inventory.write_text('[{"name":"example","version":"1.2.4"}]\n')
        self.assertNotEqual(packed.dependency_receipt([inventory], work)["evidence"][0]["sha256"], original)
        inventory.unlink()
        with self.assertRaises(FileNotFoundError):
            packed.dependency_receipt([inventory], work)

    def test_each_step_records_its_wall_time_even_when_it_fails(self):
        logs = Path(self.temp.name)
        packed.PHASES.clear()
        self.addCleanup(packed.PHASES.clear)
        packed.run([sys.executable, "-c", "pass"], cwd=logs, logs=logs, name="quick", env={})
        with self.assertRaisesRegex(RuntimeError, r"broken failed \(3\) after [0-9.]+ s"):
            packed.run([sys.executable, "-c", "raise SystemExit(3)"], cwd=logs, logs=logs, name="broken", env={})
        self.assertEqual([phase["name"] for phase in packed.PHASES], ["quick", "broken"])
        self.assertTrue(all(phase["seconds"] >= 0 for phase in packed.PHASES))


if __name__ == "__main__":
    unittest.main()
