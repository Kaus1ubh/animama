from __future__ import annotations

import inspect
from collections.abc import Mapping
from typing import Any

from animama.app.util.usage import normalize_usage
from animama.domain.usage import Usage


def jsonable(value: Any) -> Any:
    """Return a plain JSON-like value from immutable request mappings."""

    if isinstance(value, Mapping):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, tuple | list | set | frozenset):
        return [jsonable(item) for item in value]
    return value


def get_value(obj: Any, key: str, default: Any = None) -> Any:
    """Read a value from provider SDK objects or mapping-like payloads."""

    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def coerce_text(value: Any) -> str | None:
    """Best-effort extraction for SDK text values that may be strings or parts."""

    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, Mapping):
                continue
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)
            elif isinstance(text, Mapping) and isinstance(text.get("value"), str):
                parts.append(str(text["value"]))
        return "".join(parts) if parts else None
    return None


def usage_from_payload(payload: Any) -> Usage:
    """Normalize supported provider usage payloads to domain usage counters."""

    usage = normalize_usage(payload)
    if usage is not None:
        return usage
    if payload is None:
        return Usage()
    prompt_tokens = get_value(payload, "prompt_token_count")
    candidate_tokens = get_value(payload, "candidates_token_count")
    total_tokens = get_value(payload, "total_token_count")
    if any(isinstance(value, int) for value in (prompt_tokens, candidate_tokens, total_tokens)):
        return Usage(
            requests=1,
            input_tokens=prompt_tokens if isinstance(prompt_tokens, int) else 0,
            output_tokens=candidate_tokens if isinstance(candidate_tokens, int) else 0,
            total_tokens=total_tokens if isinstance(total_tokens, int) else 0,
        )
    return Usage()


def int_attr(value: Any, attr: str) -> int:
    raw = get_value(value, attr)
    if isinstance(raw, bool):
        return 0
    if isinstance(raw, int):
        return max(0, raw)
    if isinstance(raw, float) and raw.is_integer():
        return max(0, int(raw))
    return 0


def nested_int_attr(value: Any, attr: str, nested_attr: str) -> int:
    return int_attr(get_value(value, attr), nested_attr)


async def close_maybe_async(value: Any) -> None:
    """Call ``close``/``aclose`` on SDK resources when present."""

    for name in ("aclose", "close"):
        close = getattr(value, name, None)
        if not callable(close):
            continue
        result = close()
        if inspect.isawaitable(result):
            await result
        return


__all__ = [
    "close_maybe_async",
    "coerce_text",
    "get_value",
    "int_attr",
    "jsonable",
    "nested_int_attr",
    "usage_from_payload",
]
