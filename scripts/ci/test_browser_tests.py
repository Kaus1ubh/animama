"""Browser groups cover every file and failures cannot be hidden."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import browser_tests
from browser_tests import GROUPS, PRELUDE, browser_groups, discover, layout, run
from validation_policy import SUITES


def web_with(stems):
    directory = Path(tempfile.mkdtemp())
    (directory / "scripts").mkdir()
    for stem in stems:
        (directory / "scripts" / f"{stem}.browser.test.mjs").write_text("// fixture\n")
    return directory


ALL = [*GROUPS["tooling"], *GROUPS["hosted"], *PRELUDE, "setup-downloads", "voice-clone-library"]


class GroupTests(unittest.TestCase):
    def test_groups_follow_the_plan_and_core_always_runs(self):
        self.assertEqual(browser_groups(set()), ["core", "hosted", "tooling"])
        self.assertEqual(browser_groups({"browser-hosted", "browser-tooling", "promotion"}), ["core"])
        self.assertEqual(browser_groups({"browser-hosted"}), ["core", "tooling"])
        self.assertEqual(set(browser_tests.SUITE_GROUPS), set(SUITES) - {"promotion"})

    def test_checked_in_files_are_grouped_and_unknown_files_run_as_core(self):
        files = discover()
        self.assertGreaterEqual(len(files), 12)
        for group, members in GROUPS.items():
            for stem in members:
                self.assertEqual(files[stem], group)
        self.assertEqual(discover(web_with([*ALL, "brand-new"]))["brand-new"], "core")
        with self.assertRaises(SystemExit):
            discover(web_with(["hosted-composition"]))

    def test_layout_places_each_selected_file_once(self):
        files = discover(web_with([*ALL, "brand-new"]))
        for groups in (["core"], ["core", "tooling"], ["core", "hosted", "tooling"]):
            prelude, lanes = layout(files, groups)
            placed = prelude + [stem for lane in lanes for stem in lane]
            self.assertEqual(len(placed), len(set(placed)))
            self.assertEqual(set(placed), {stem for stem, group in files.items() if group in groups})
            self.assertEqual(prelude, list(PRELUDE))
        prelude, lanes = layout(files, ["core"])
        self.assertNotIn("animation-preview", prelude + [stem for lane in lanes for stem in lane])


class RunTests(unittest.TestCase):
    def test_failed_or_unknown_groups_fail_the_step(self):
        web = web_with(ALL)
        output = Path(tempfile.mkdtemp()) / "out"
        for groups in ([], ["hosted"], ["core", "unknown"]):
            with self.assertRaises(SystemExit):
                run(groups, output, web)

        def fake(command, **kwargs):
            kwargs["stdout"].write(b"log\n")
            return type("Result", (), {"returncode": 1 if "effect-check" in command[-1] else 0})()

        with patch("browser_tests.subprocess.run", side_effect=fake):
            self.assertEqual(run(["core", "tooling"], output, web), 1)
        rows = json.loads((output / "results.json").read_text())["files"]
        self.assertEqual({row["file"] for row in rows if row["status"] == "failed"}, {"effect-check.browser.test.mjs"})
        self.assertNotIn("hosted-workflows.browser.test.mjs", {row["file"] for row in rows})
        with patch("browser_tests.subprocess.run", side_effect=lambda command, **kwargs: fake(["ok"], **kwargs)):
            self.assertEqual(run(["core"], Path(tempfile.mkdtemp()), web), 0)


if __name__ == "__main__":
    unittest.main()
