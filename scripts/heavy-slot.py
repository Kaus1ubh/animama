#!/usr/bin/env python3
"""Run a heavy local job in one of a few machine-wide slots.

Parallel agent sessions share one machine. Heavy jobs (browser journeys, local
receipts, package-set builds, full pre-push suites and the Cloud full gate) each
take a slot; further jobs wait for one instead of competing for cores and memory.
Animama and Animama Cloud keep identical copies of this script and share one
slot directory, so the limit covers every checkout on the machine.

    python3 scripts/heavy-slot.py -- make check-test            # Animama
    python3 scripts/heavy-slot.py -- pnpm check:pre-pr:full     # Cloud
    python3 scripts/heavy-slot.py --status

A slot is a flock(2) lock held by the job's own process: the wrapper replaces
itself with the command, so exit status and signals are the command's, and the
kernel frees the slot when the job (and any child still holding it) exits, even
after a crash. A background process the job leaves running keeps the slot;
`--status` marks a holder whose own pid has exited, and `lsof` on the slot file
names the process. A job started inside a slotted job runs without taking another.

Environment:
    ANIMAMA_HEAVY_SLOTS     number of slots (default 2)
    ANIMAMA_HEAVY_SLOT_DIR  lock directory (default ~/.cache/animama/heavy-slots)
"""

from __future__ import annotations

import argparse
import datetime
import fcntl
import os
import re
import shlex
import signal
import sys
import time
from pathlib import Path

DEFAULT_SLOTS = 2
POLL_SECONDS = 1.0
BUSY_EXIT = 75  # EX_TEMPFAIL: every slot is held and --no-wait was given.
HELD_ENV = "ANIMAMA_HEAVY_SLOT_HELD"


def slot_directory() -> Path:
    configured = os.environ.get("ANIMAMA_HEAVY_SLOT_DIR")
    return Path(configured) if configured else Path.home() / ".cache" / "animama" / "heavy-slots"


def slot_paths(directory: Path, count: int) -> list[Path]:
    return [directory / f"slot-{index}.lock" for index in range(count)]


def try_acquire(paths: list[Path]) -> int | None:
    """Return a locked descriptor for the first free slot, or None if all are held."""
    for path in paths:
        descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(descriptor)
            continue
        return descriptor
    return None


def holders(paths: list[Path]) -> list[str]:
    """Describe each held slot; a slot whose lock can be taken is free."""
    described = []
    for path in paths:
        if not path.exists():
            continue
        descriptor = os.open(path, os.O_RDONLY)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            text = path.read_text().strip() or "held"
            match = re.match(r"pid (\d+) ", text)
            if match and not pid_alive(int(match.group(1))):
                text += f" (pid exited; a child still holds the slot: lsof {path})"
            described.append(f"{path.name}: {text}")
        finally:
            os.close(descriptor)
    return described


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def describe_holder(descriptor: int, command: list[str]) -> None:
    started = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    text = f"pid {os.getpid()} since {started} in {os.getcwd()}: {shlex.join(command)}\n"
    os.ftruncate(descriptor, 0)
    os.pwrite(descriptor, text.encode(), 0)


def parse_slots(value: str) -> int:
    count = int(value)
    if count < 1:
        raise argparse.ArgumentTypeError("needs at least one slot")
    return count


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--slots",
        type=parse_slots,
        default=os.environ.get("ANIMAMA_HEAVY_SLOTS", str(DEFAULT_SLOTS)),
        help="number of machine-wide slots (default: ANIMAMA_HEAVY_SLOTS or 2)",
    )
    parser.add_argument("--no-wait", action="store_true", help=f"exit {BUSY_EXIT} instead of waiting for a slot")
    parser.add_argument("--status", action="store_true", help="list the jobs holding slots and exit")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="the job to run, after --")
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ["--"] else args.command

    directory = slot_directory()
    directory.mkdir(parents=True, exist_ok=True)
    paths = slot_paths(directory, args.slots)

    if args.status:
        held = holders(paths)
        print(f"{len(held)} of {args.slots} heavy-job slots in use")
        for line in held:
            print(f"  {line}")
        return 0
    if not command:
        parser.error("give the job to run after --")

    if os.environ.get(HELD_ENV):
        # A job inside a slotted job already counts against the limit.
        return run(command)

    descriptor = try_acquire(paths)
    waiting_since = None
    while descriptor is None:
        if args.no_wait:
            print(f"heavy-slot: all {args.slots} slots are busy", file=sys.stderr)
            for line in holders(paths):
                print(f"  {line}", file=sys.stderr)
            return BUSY_EXIT
        if waiting_since is None:
            waiting_since = time.monotonic()
            print(f"heavy-slot: waiting for one of {args.slots} slots, held by:", file=sys.stderr)
            for line in holders(paths):
                print(f"  {line}", file=sys.stderr)
        time.sleep(POLL_SECONDS)
        descriptor = try_acquire(paths)
    if waiting_since is not None:
        print(f"heavy-slot: started after waiting {time.monotonic() - waiting_since:.0f} s", file=sys.stderr)

    describe_holder(descriptor, command)
    os.set_inheritable(descriptor, True)
    os.environ[HELD_ENV] = "1"
    return run(command)


def run(command: list[str]) -> int:
    # Python ignores SIGPIPE and SIGXFSZ; restore the defaults the job expects, as
    # subprocess does, so pipelines such as `producer | head` end normally.
    for name in ("SIGPIPE", "SIGXFSZ"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), signal.SIG_DFL)
    try:
        os.execvp(command[0], command)
    except OSError as error:
        print(f"heavy-slot: cannot run {command[0]}: {error}", file=sys.stderr)
        return 127


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(130)
