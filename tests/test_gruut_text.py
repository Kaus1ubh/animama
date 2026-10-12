from __future__ import annotations

import logging
from collections.abc import Iterator

import pytest

from animama.server import gruut_text
from animama.server.gruut_text import build_gruut_sse_text

REPLY = "Some private reply."
_STANDARD_RECORD_FIELDS = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


class _RecordList(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture
def gruut_records() -> Iterator[list[logging.LogRecord]]:
    # Attach to the module logger directly so capture does not depend on the
    # propagation configured by the host composition.
    logger = gruut_text._log.logger
    handler = _RecordList()
    previous_level = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    try:
        yield handler.records
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous_level)


def _logged_content(record: logging.LogRecord) -> str:
    """Return the message and structured fields a log sink would persist."""

    fields = {key: value for key, value in record.__dict__.items() if key not in _STANDARD_RECORD_FIELDS}
    return f"{record.getMessage()} {fields!r}"


def test_build_gruut_sse_text_never_logs_reply_text(gruut_records: list[logging.LogRecord]) -> None:
    payload = build_gruut_sse_text(REPLY)

    # Backend tests install the ``server`` extra, so this exercises real gruut.
    assert payload is not None
    assert payload["tokenized_text"] == REPLY
    messages = [record.getMessage() for record in gruut_records]
    assert "gruut sentences done" in messages
    assert "gruut text built" in messages
    for record in gruut_records:
        content = _logged_content(record)
        for fragment in (REPLY, "private", "reply"):
            assert fragment not in content
