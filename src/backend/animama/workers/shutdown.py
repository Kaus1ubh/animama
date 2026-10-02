"""Graceful shutdown for supervised background workers."""

from __future__ import annotations

import asyncio
import signal
import sys
from collections.abc import Callable


def install_shutdown_handlers(loop: asyncio.AbstractEventLoop, stop: Callable[[], object]) -> None:
    """Call `stop` on the event loop when the supervisor asks the worker to exit.

    POSIX supervisors send SIGTERM or SIGINT. A Windows console stop arrives as
    CTRL_C_EVENT or CTRL_BREAK_EVENT (SIGINT or SIGBREAK), and Windows event
    loops do not support `add_signal_handler`, so a plain handler hands `stop`
    to the loop thread instead. A signal after the loop has closed is ignored.
    """

    if sys.platform == "win32":

        def request_stop(_signum: int, _frame: object) -> None:
            if not loop.is_closed():
                loop.call_soon_threadsafe(stop)

        for sig in (signal.SIGINT, signal.SIGBREAK):
            signal.signal(sig, request_stop)
        return
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop)
