"""Exercise measurement against disposable Git repositories and the pinned scc."""

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("measure", Path(__file__).with_name("measure.py"))
measure = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(measure)
SCC = shutil.which(os.environ.get("SCC_BIN", "scc"))


@unittest.skipUnless(SCC, "Set SCC_BIN to the pinned scc binary for integration tests")
class MeasurementTests(unittest.TestCase):
    """Verify coverage and recovery contracts, not scanner internals."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo"
        self.root.mkdir()
        self.output = Path(self.temp.name) / "reports"
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Measurement fixture")
        self.write("cloud/main.py", "# retained tracked cloud\nvalue = 1\n")
        self.write(".gitignore", "cloud/\n")
        self.write("file with spaces.py", "\n# comment\nvalue = 2\n")
        self.write("empty.py", "")
        self.write("src/frontend/web/src/client/sdk.gen.ts", "export const value = 1;\n")
        self.write("src/frontend/web/src/lib/speech/pocket/index.js", "export const value = 1;\n")
        self.write("src/frontend/web/src/lib/speech/pocket/bridge.ts", "export const value = 1;\n")
        self.write("src/frontend/web/vite.config.ts", "export default {};\n")
        self.write("src/backend/packaging/desktop/runtime.spec", "# PyInstaller config\nvalue = 1\n")
        self.write("src/frontend/desktop/build/icon.icns", b"\x00binary")
        self.write("content/included/catalog/item.json", '{"label":"catalog data"}\n')
        self.write("src/frontend/web/tests/app.test.ts", "const test = 1;\n")
        self.write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n")
        self.git("add", "-f", ".")
        self.git("commit", "-qm", "fixture")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode() if isinstance(content, str) else content)

    def run_measurement(self, label):
        return measure.measure(self.root, self.output, label, Path(SCC))

    def test_tracked_ignored_files_categories_and_repeatable_totals(self):
        self.write("untracked.py", "not_part_of_baseline = True\n")
        before = self.run_measurement("before")
        again = self.run_measurement("repeat")
        summary = json.loads((before / "summary.json").read_text())
        self.assertEqual(summary, json.loads((again / "summary.json").read_text()))
        rows = {r["path"]: r for r in json.loads((before / "files.json").read_text())}
        self.assertNotIn("untracked.py", rows)
        self.assertEqual(rows["cloud/main.py"]["code"], 1)
        self.assertEqual(rows["file with spaces.py"]["comments"], 1)
        self.assertEqual(rows["empty.py"]["lines"], 0)
        self.assertEqual(rows["src/frontend/web/src/client/sdk.gen.ts"]["category"], "generated")
        self.assertEqual(rows["src/frontend/web/src/lib/speech/pocket/index.js"]["category"], "vendored")
        self.assertEqual(rows["src/frontend/web/src/lib/speech/pocket/bridge.ts"]["category"], "authored")
        self.assertEqual(rows["src/frontend/web/vite.config.ts"]["category"], "docs_config")
        self.assertEqual(rows["src/backend/packaging/desktop/runtime.spec"]["language"], "Python")
        self.assertEqual(rows["src/backend/packaging/desktop/runtime.spec"]["code"], 1)
        self.assertEqual(rows["src/frontend/desktop/build/icon.icns"]["status"], "bytes_only")
        self.assertEqual(rows["content/included/catalog/item.json"]["status"], "bytes_only")
        self.assertEqual(rows["pnpm-lock.yaml"]["reason"], "scc-builtin-lockfile-exclusion")
        self.assertEqual(sum(r["files"] for r in summary["by_category"].values()), len(rows))

    def test_refuses_baseline_overwrite_and_reports_inside_checkout(self):
        result = self.run_measurement("before")
        original = (result / "summary.json").read_bytes()
        with self.assertRaises(FileExistsError):
            self.run_measurement("before")
        self.assertEqual(original, (result / "summary.json").read_bytes())
        with self.assertRaisesRegex(ValueError, "outside"):
            measure.measure(self.root, self.root / "reports", "before", Path(SCC))
        with self.assertRaisesRegex(ValueError, "Label"):
            self.run_measurement("../escape")

    def test_deleted_file_is_a_gap_and_evidence_is_preserved(self):
        (self.root / "cloud/main.py").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            self.run_measurement("missing")
        rows = json.loads((self.output / "missing/files.json").read_text())
        self.assertEqual(next(r for r in rows if r["path"] == "cloud/main.py")["status"], "missing")

    def test_unhydrated_lfs_pointer_is_not_counted_as_source(self):
        self.write("model.onnx", "version https://git-lfs.github.com/spec/v1\noid sha256:" + "0" * 64 + "\nsize 42\n")
        self.git("add", "model.onnx")
        with self.assertRaisesRegex(ValueError, "lfs_pointer"):
            self.run_measurement("pointer")
        rows = json.loads((self.output / "pointer/files.json").read_text())
        row = next(r for r in rows if r["path"] == "model.onnx")
        self.assertEqual(row["lfs_declared_bytes"], 42)
        self.assertNotIn("code", row)


if __name__ == "__main__":
    unittest.main()
