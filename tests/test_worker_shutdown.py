"""Workers stop gracefully on POSIX signals and on a Windows console break."""

from __future__ import annotations

import signal
from unittest.mock import MagicMock

import pytest

from animama.workers import shutdown


def test_posix_workers_stop_on_sigterm_and_sigint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("sys.platform", "linux")
    loop = MagicMock()
    stop = MagicMock()

    shutdown.install_shutdown_handlers(loop, stop)

    assert [call.args for call in loop.add_signal_handler.call_args_list] == [
        (signal.SIGTERM, stop),
        (signal.SIGINT, stop),
    ]


def test_windows_workers_stop_on_ctrl_break_through_the_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    # Windows event loops have no add_signal_handler; the process guard sends
    # CTRL_BREAK_EVENT, which Python delivers as SIGBREAK.
    monkeypatch.setattr("sys.platform", "win32")
    monkeypatch.setattr("signal.SIGBREAK", 21, raising=False)
    installed: dict[int, object] = {}
    monkeypatch.setattr("signal.signal", lambda sig, handler: installed.setdefault(sig, handler))
    loop = MagicMock()
    stop = MagicMock()

    shutdown.install_shutdown_handlers(loop, stop)

    assert sorted(installed) == sorted([signal.SIGINT, 21])
    loop.is_closed.return_value = False
    installed[21](21, None)  # type: ignore[operator]
    loop.call_soon_threadsafe.assert_called_once_with(stop)
    loop.add_signal_handler.assert_not_called()
    # A late Ctrl+Break after shutdown must not raise from the handler.
    loop.is_closed.return_value = True
    installed[21](21, None)  # type: ignore[operator]
    loop.call_soon_threadsafe.assert_called_once()
