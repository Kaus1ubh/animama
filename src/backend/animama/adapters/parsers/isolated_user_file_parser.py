"""Parse each upload in its own child process under time and memory limits.

Uploaded files are untrusted. Reading one in a separate process keeps a hang, a
crash or runaway memory away from the server: the child gets the bytes on its
standard input, answers on its standard output (see
:mod:`animama.adapters.parsers.parse_child`), and is killed when it runs past
the wall-clock limit or its resident memory passes the memory limit. Waiting on
the child never blocks the server's event loop (spec R1.6, R3.1).
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from contextlib import suppress
from typing import Any

import psutil

from animama.adapters.parsers.parse_child import (
    PARSE_UPLOAD_COMMAND,
    UNREADABLE_REASON,
    ParseRequest,
    decode_parse_answer,
    memory_limit_reason,
    time_limit_reason,
)
from animama.app.ports.user_file_parser_port import UserFileParseError, UserFileParser, UserFileParseRejectedError
from animama.domain.user_file_processing import ParsedUserFileDocument
from animama.logging import get_logger

DEFAULT_PARSE_TIMEOUT_SECONDS = 120.0
DEFAULT_PARSE_MEMORY_MB = 1024
MEMORY_SAMPLE_SECONDS = 0.01
"""How often the child's resident memory is sampled: native code can inflate gigabytes a second."""
# After a kill the child's pipes close at once; this only bounds a pathological wait.
_STOP_WAIT_SECONDS = 5.0

# What a parse child inherits: where to find programs, libraries and temporary
# files, the locale, and Python's and PyInstaller's own settings. Nothing else:
# the server's environment holds database and provider credentials.
_CHILD_ENVIRONMENT_NAMES = frozenset(
    {
        "PATH",
        "HOME",
        "TMPDIR",
        "TEMP",
        "TMP",
        "TZ",
        "LANG",
        "LANGUAGE",
        "LD_LIBRARY_PATH",
        "PYTHONPATH",
        "PYTHONHOME",
        "PYTHONUNBUFFERED",
        "PYTHONIOENCODING",
        "PYTHONUTF8",
        "PYTHONDONTWRITEBYTECODE",
        "PYTHONNOUSERSITE",
        "PYTHONSAFEPATH",
        "PYTHONPYCACHEPREFIX",
        # The frozen runtime's bootloader (PyInstaller 5 one-file builds).
        "_MEIPASS2",
        # Windows system locations that Python and its DLLs rely on.
        "SYSTEMROOT",
        "SYSTEMDRIVE",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
    }
)
# Locale categories and the frozen runtime's bootloader state (PyInstaller 6).
_CHILD_ENVIRONMENT_PREFIXES = ("LC_", "_PYI_")

_log = get_logger("adapters.parsers.isolated_user_file_parser")


def default_parse_command() -> list[str]:
    """Return the command that starts a parse child of this runtime.

    The frozen desktop runtime dispatches the subcommand itself; otherwise the
    package's CLI module runs on this interpreter. ``-P`` keeps the server's
    working directory off the child's import path.
    """

    if getattr(sys, "frozen", False):
        return [sys.executable, PARSE_UPLOAD_COMMAND]
    return [sys.executable, "-P", "-m", "animama.runtime.cli", PARSE_UPLOAD_COMMAND]


def child_environment(environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return the environment for a parse child: only what running Python needs.

    It is built from an allowlist (program and library paths, temporary
    directories, locale, Python and PyInstaller settings, Windows system
    locations). Everything else stays in the server, including the database
    password (``ANIMAMA_DATABASE_URL``, ``PG*``), provider keys and any other
    secret an operator's environment holds.
    """

    source = os.environ if environ is None else environ
    return {
        name: value
        for name, value in source.items()
        if name.upper() in _CHILD_ENVIRONMENT_NAMES or name.upper().startswith(_CHILD_ENVIRONMENT_PREFIXES)
    }


class UserFileParseChildError(UserFileParseError):
    """The parse child ended without a usable answer: a crash, a signal or a broken command.

    Unlike a rejection this is retried, because the same bytes may read on the next attempt.
    """


class IsolatedUserFileParser(UserFileParser):
    """Read uploads in bounded ``parse-upload`` child processes.

    Content the child rejects, and a child that runs past a limit, raise
    :class:`UserFileParseRejectedError`: the same bytes would fail the same way
    again. A child that ends without a usable answer raises
    :class:`UserFileParseChildError`, and failing to start one raises an
    ordinary error; both are retried.
    """

    def __init__(
        self,
        *,
        timeout_seconds: float = DEFAULT_PARSE_TIMEOUT_SECONDS,
        memory_limit_mb: int = DEFAULT_PARSE_MEMORY_MB,
        command: Sequence[str] | None = None,
        memory_sample_seconds: float = MEMORY_SAMPLE_SECONDS,
    ) -> None:
        if timeout_seconds <= 0 or memory_limit_mb <= 0:
            raise ValueError("Parse time and memory limits must be positive")
        self._timeout_seconds = float(timeout_seconds)
        self._memory_limit_mb = int(memory_limit_mb)
        self._command = list(command) if command is not None else default_parse_command()
        self._memory_sample_seconds = memory_sample_seconds

    async def parse(self, *, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
        request = ParseRequest(
            filename=filename,
            extension=extension,
            memory_limit_mb=self._memory_limit_mb,
            timeout_seconds=self._timeout_seconds,
        ).encode(payload)
        started = time.perf_counter()
        process = await self._start_child()
        exchange = asyncio.ensure_future(process.communicate(request))
        watcher = asyncio.ensure_future(self._exceeds_memory_limit(process))
        try:
            async with asyncio.timeout(self._timeout_seconds):
                done, _pending = await asyncio.wait((exchange, watcher), return_when=asyncio.FIRST_COMPLETED)
                if watcher in done and watcher.result():
                    raise UserFileParseRejectedError(
                        memory_limit_reason(self._memory_limit_mb), error_type="MemoryError"
                    )
                stdout, stderr = await exchange
        except TimeoutError:
            raise UserFileParseRejectedError(
                time_limit_reason(self._timeout_seconds), error_type="TimeoutError"
            ) from None
        finally:
            watcher.cancel()
            await _stop_child(process, exchange)
        try:
            # A large document's answer is tens of megabytes of JSON; decode it off the event loop.
            return await asyncio.to_thread(decode_parse_answer, stdout)
        except (ValueError, RecursionError):
            error_type = "ParseChildExited" if process.returncode else "InvalidParseAnswer"
            # Standard error is counted, not logged: a library may have printed document text.
            _log.warning(
                "User-file parse child gave no usable answer",
                extension=extension,
                error_type=error_type,
                returncode=process.returncode,
                stderr_bytes=len(stderr),
                duration_seconds=round(time.perf_counter() - started, 3),
            )
            raise UserFileParseChildError(UNREADABLE_REASON, error_type=error_type) from None

    async def _start_child(self) -> asyncio.subprocess.Process:
        options: dict[str, Any] = {}
        if sys.platform == "win32":
            # No console window, and no Ctrl+C from the server's console.
            options["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            # Its own session, so a terminal's Ctrl+C reaches only the server, whose shutdown stops the child.
            options["start_new_session"] = True
        try:
            return await asyncio.create_subprocess_exec(
                *self._command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=child_environment(),
                **options,
            )
        except NotImplementedError as exc:
            raise RuntimeError("This event loop cannot start upload parse processes") from exc

    async def _exceeds_memory_limit(self, process: asyncio.subprocess.Process) -> bool:
        """Sample the child's resident memory until it passes the limit.

        Returns ``False`` when the child can no longer be sampled (it exited, or
        the platform refuses); the time limit still applies.
        """

        limit_bytes = self._memory_limit_mb * 1024 * 1024
        try:
            child = psutil.Process(process.pid)
            while process.returncode is None:
                if child.memory_info().rss > limit_bytes:
                    return True
                await asyncio.sleep(self._memory_sample_seconds)
        except psutil.Error:
            pass
        return False


async def _stop_child(process: asyncio.subprocess.Process, exchange: asyncio.Future[Any]) -> None:
    """Kill the child if it still runs, then wait for its pipes to close and reap it."""

    if process.returncode is None:
        with suppress(ProcessLookupError):
            process.kill()
    if not exchange.done():
        await asyncio.wait((exchange,), timeout=_STOP_WAIT_SECONDS)
    if not exchange.done():
        exchange.cancel()
    elif not exchange.cancelled():
        # Consume the outcome, so a failed exchange is not reported as unretrieved.
        exchange.exception()


__all__ = [
    "DEFAULT_PARSE_MEMORY_MB",
    "DEFAULT_PARSE_TIMEOUT_SECONDS",
    "IsolatedUserFileParser",
    "UserFileParseChildError",
    "child_environment",
    "default_parse_command",
]
