"""Boundary regressions use disposable modules rather than project-specific exceptions."""

import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("python_boundary", Path(__file__).with_name("check-python-imports.py"))
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class ImportBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.write("animama/__init__.py", "")
        self.write("animama/app/__init__.py", "")
        self.write("animama/app/service.py", "from animama.domain.owner import Owner\n")
        self.write("animama/domain/owner.py", "class Owner: pass\n")

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def test_neutral_modules_and_local_to_shared_dependencies_pass(self):
        self.write("animama/local/factory.py", "from animama.app.service import Owner\n")
        self.assertEqual(checker.audit(self.root)["forbidden_edges"], 0)

    def test_transitive_package_initializer_leak_fails(self):
        self.write("animama/app/service.py", "from animama.orm.model import Model\n")
        self.write("animama/orm/model.py", "class Model: pass\n")
        self.write("animama/orm/__init__.py", "from animama.local.installation_model import Installation\n")
        with self.assertRaisesRegex(ValueError, "animama.orm -> animama.local.installation_model"):
            checker.audit(self.root)

    def test_relative_and_lazy_function_imports_are_checked(self):
        self.write("animama/app/service.py", "def later():\n    from ..local import installation_model\n")
        with self.assertRaisesRegex(ValueError, "animama.local"):
            checker.audit(self.root)

    def test_literal_and_unresolved_dynamic_imports_fail(self):
        for source in ('importlib.import_module("animama.server.app")', "importlib.import_module(name)"):
            with self.subTest(source=source):
                self.write("animama/app/service.py", "import importlib\n" + source)
                with self.assertRaises(ValueError):
                    checker.audit(self.root)

    def test_initializer_cannot_hide_shared_ancestor_import(self):
        self.write("animama/__init__.py", "import animama.runtime.cli\n")
        with self.assertRaisesRegex(ValueError, "animama.runtime.cli"):
            checker.audit(self.root)

    def test_unavailable_private_module_import_is_still_forbidden(self):
        self.write("animama/app/service.py", "from animama import cloud\n")
        with self.assertRaisesRegex(ValueError, "animama.cloud"):
            checker.audit(self.root)

    def test_dynamic_import_aliases_and_explicit_relative_packages(self):
        sources = (
            'from importlib import import_module as load\nload("animama.local.database")',
            'import importlib as modules\nmodules.import_module(".server.config", "animama")',
            'import importlib\nimportlib.import_module(".runtime", package="animama")',
            'import importlib\nimportlib.import_module(".runtime", package=unknown)',
        )
        for source in sources:
            with self.subTest(source=source):
                self.write("animama/app/service.py", source)
                with self.assertRaises(ValueError):
                    checker.audit(self.root)


if __name__ == "__main__":
    unittest.main()
