"""Count the SQL statements a block of async session work sends."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event

# A starter loadout's statements, whatever its pool sizes (about 1,000 before batching).
STARTER_LOADOUT_STATEMENTS = 20


@contextmanager
def counted_statements(session) -> Iterator[list[str]]:  # noqa: ANN001
    """Collect every statement ``session``'s engine sends inside the block."""

    statements: list[str] = []

    def record(_conn, _cursor, statement, _parameters, _context, _executemany):  # noqa: ANN001
        statements.append(statement)

    engine = session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)
