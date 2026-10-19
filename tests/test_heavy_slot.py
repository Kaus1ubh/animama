"""Behavior of scripts/heavy-slot.py, the machine-wide queue for heavy local jobs.

Animama and Animama Cloud keep identical copies of the script and of this test.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "heavy-slot.py"
# Signals that it holds the slot, then runs until the release file appears.
HOLD = (
    "import pathlib, sys, time\n"
    "pathlib.Path(sys.argv[1]).touch()\n"
    "while not pathlib.Path(sys.argv[2]).exists():\n"
    "    time.sleep(0.05)\n"
)


class HeavySlotTest(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.env = {**os.environ, "ANIMAMA_HEAVY_SLOT_DIR": str(self.directory), "ANIMAMA_HEAVY_SLOTS": "1"}
        self.env.pop("ANIMAMA_HEAVY_SLOT_HELD", None)

    def slot(self, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            env=env or self.env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def hold_only_slot(self) -> Path:
        """Occupy the single slot; touching the returned path ends the holder."""
        ready, release = self.directory / "ready", self.directory / "release"
        holder = subprocess.Popen(
            [sys.executable, str(SCRIPT), "--", sys.executable, "-c", HOLD, str(ready), str(release)],
            env=self.env,
        )
        self.addCleanup(holder.wait, 30)
        self.addCleanup(release.touch)
        self.wait_for(ready)
        return release

    def wait_for(self, path: Path) -> None:
        deadline = time.monotonic() + 20
        while not path.exists():
            self.assertLess(time.monotonic(), deadline, f"{path.name} never appeared")
            time.sleep(0.05)

    def test_runs_the_job_and_returns_its_exit_status(self) -> None:
        result = self.slot("--", sys.executable, "-c", "import sys; print(sys.argv[1:]); sys.exit(3)", "--flag")

        self.assertEqual(result.returncode, 3)
        self.assertIn("['--flag']", result.stdout)

    def test_the_job_gets_default_signal_handling(self) -> None:
        result = self.slot("--", "/bin/sh", "-c", "yes | head -n 1")

        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "y\n", ""))

    def test_busy_slots_refuse_a_no_wait_job_and_name_the_holder(self) -> None:
        self.hold_only_slot()

        busy = self.slot("--no-wait", "--", sys.executable, "-c", "pass")
        status = self.slot("--status")

        self.assertEqual(busy.returncode, 75)
        self.assertIn("all 1 slots are busy", busy.stderr)
        self.assertIn(str(self.directory / "release"), busy.stderr)
        self.assertIn("1 of 1 heavy-job slots in use", status.stdout)

    def test_a_waiting_job_starts_when_the_holder_finishes(self) -> None:
        release = self.hold_only_slot()
        started = self.directory / "started"
        waiter = subprocess.Popen(
            [sys.executable, str(SCRIPT), "--", sys.executable, "-c", f"open({str(started)!r}, 'w')"],
            env=self.env,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(waiter.kill)

        time.sleep(1.5)
        self.assertFalse(started.exists(), "the waiting job ran while the only slot was held")
        release.touch()

        _, stderr = waiter.communicate(timeout=20)
        self.assertEqual(waiter.returncode, 0)
        self.assertTrue(started.exists())
        self.assertIn("waiting for one of 1 slots", stderr)

    def test_a_job_inside_a_slotted_job_does_not_take_another_slot(self) -> None:
        self.hold_only_slot()

        nested = self.slot(
            "--no-wait", "--", sys.executable, "-c", "pass", env={**self.env, "ANIMAMA_HEAVY_SLOT_HELD": "1"}
        )

        self.assertEqual(nested.returncode, 0)


if __name__ == "__main__":
    unittest.main()
