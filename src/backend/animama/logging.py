"""Structured logging API with no environment reads or handler configuration.

The host composition owns handlers, destinations and log policy.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, MutableMapping
from typing import Any

_RESERVED_KEYS = set(logging.makeLogRecord({}).__dict__)


class AnimaLoggerAdapter(logging.LoggerAdapter[logging.Logger]):
    """Logger adapter that preserves anima context across log calls."""

    def bind(self, **context: Any) -> AnimaLoggerAdapter:
        """Return a new adapter with additional context merged."""

        base_extra: Mapping[str, Any] | None = getattr(self, "extra", None)
        merged: dict[str, Any] = dict(base_extra or {})
        for key, value in context.items():
            if value is None:
                continue
            merged[key] = value
        return AnimaLoggerAdapter(self.logger, merged)

    def unbind(self, *keys: str) -> AnimaLoggerAdapter:
        """Return a new adapter with specific context keys removed."""

        base_extra: Mapping[str, Any] | None = getattr(self, "extra", None)
        remaining = {k: v for k, v in (base_extra or {}).items() if k not in keys}
        return AnimaLoggerAdapter(self.logger, remaining)

    def process(self, msg: str, kwargs: MutableMapping[str, Any]) -> tuple[str, MutableMapping[str, Any]]:
        """Inject bound context and coerce arbitrary kwargs into ``extra``.

        Python's logging only accepts specific kwargs (extra, exc_info, stack_info,
        stacklevel). Any other keyword arguments should be moved into ``extra``
        to avoid ``unexpected keyword argument`` errors on Logger._log.
        """

        allowed = {"extra", "exc_info", "stack_info", "stacklevel"}
        base_extra: Mapping[str, Any] | None = getattr(self, "extra", None)
        extras: dict[str, Any] = dict(base_extra or {})

        # Start with any user-provided extra
        provided_extra = kwargs.get("extra")
        if isinstance(provided_extra, Mapping):
            extras.update({k: v for k, v in provided_extra.items() if v is not None})

        # Move all non-allowed kwargs into extras
        spillover: dict[str, Any] = {k: v for k, v in dict(kwargs).items() if k not in allowed}
        for k in spillover:
            kwargs.pop(k, None)
        for k, v in spillover.items():
            if v is not None:
                extras[k] = v

        # Drop reserved keys to avoid LogRecord overwrite errors
        reserved = _RESERVED_KEYS
        for k in list(extras.keys()):
            if k in reserved or str(k).startswith("_"):
                extras.pop(k, None)

        # Ensure extra is present
        kwargs["extra"] = extras
        return msg, kwargs


def get_logger(name: str | None = None, **context: Any) -> AnimaLoggerAdapter:
    """Return a structured logger adapter with optional bound context."""

    base_logger = logging.getLogger("anima")
    if name:
        base_logger = base_logger.getChild(name)
    filtered_context = {key: value for key, value in context.items() if value is not None}
    return AnimaLoggerAdapter(base_logger, filtered_context)


__all__ = ["get_logger", "AnimaLoggerAdapter"]
