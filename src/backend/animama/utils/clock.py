"""Current-time helpers shared by every layer, so all callers read the same UTC clock."""

from __future__ import annotations

from datetime import UTC, datetime


def utc_now() -> datetime:
    """Return the current time as a timezone-aware UTC datetime."""

    return datetime.now(UTC)


def naive_utc_now() -> datetime:
    """Return the current UTC time without ``tzinfo``.

    This is the value the deprecated ``datetime.utcnow()`` returned; some
    persisted timestamps are naive UTC, so their writers keep that form.
    """

    return datetime.now(UTC).replace(tzinfo=None)


__all__ = ["naive_utc_now", "utc_now"]
