from __future__ import annotations

import json
import os
import re
import time
from collections.abc import Mapping
from typing import Any

from .types import ModelClientRequest

_PREVIEW_ENABLED_ENV = "ANIMAMA_MODEL_CLIENT_LOG_PREVIEWS"
_PREVIEW_CHARS_ENV = "ANIMAMA_MODEL_CLIENT_LOG_PREVIEW_CHARS"
_DEFAULT_PREVIEW_CHARS = 240
_MAX_PREVIEW_CHARS = 2_000
_MAX_PREVIEW_MESSAGES = 8
_MAX_PREVIEW_TOOL_CALLS = 4
_SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(api[_-]?key|authorization|password|secret|token)\b\s*[:=]\s*['\"]?[^,\s}\]]+"
)
_BEARER_RE = re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/-]+=*")
_OPENAI_KEY_RE = re.compile(r"\bsk-[a-zA-Z0-9_-]{16,}\b")


def model_client_request_log_context(
    request: ModelClientRequest,
    *,
    include_prompt_preview: bool = False,
) -> dict[str, Any]:
    """Return model-client lifecycle fields, with optional gated content previews."""

    metadata = getattr(request.prompt, "metadata", {}) or {}
    context: dict[str, Any] = {
        "model_provider_id": request.model_provider.id,
        "provider_type": request.model_provider.provider_type,
        "model": request.model_provider.model,
        "anima_id": _metadata_str(metadata, "anima_id"),
        "chat_id": _metadata_str(metadata, "chat_id"),
        "run_id": _metadata_str(metadata, "run_id"),
        "context_source": _metadata_str(metadata, "context_source"),
        "prompt_message_count": len(request.prompt.messages),
        "prompt_tool_count": len(request.prompt.tools),
        "native_tools": list(request.provider_options.native_tools),
        "memory_apply_patch_enabled": request.provider_options.memory_apply_patch_enabled,
        "previous_response_id_present": request.continuation is not None,
    }
    if include_prompt_preview and model_client_preview_enabled():
        context["prompt_preview"] = _prompt_preview(request, max_chars=model_client_preview_chars())
    return context


def model_client_preview_log_context(**fields: object) -> dict[str, Any]:
    """Return truncated preview fields when model-client preview logging is enabled."""

    if not model_client_preview_enabled():
        return {}
    max_chars = model_client_preview_chars()
    previews: dict[str, Any] = {}
    for key, value in fields.items():
        preview = _preview_value(value, max_chars=max_chars)
        if preview is not None:
            previews[key] = preview
    return previews


def model_client_preview_enabled() -> bool:
    value = os.getenv(_PREVIEW_ENABLED_ENV)
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def model_client_preview_chars() -> int:
    raw_value = os.getenv(_PREVIEW_CHARS_ENV)
    if raw_value is None:
        return _DEFAULT_PREVIEW_CHARS
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return _DEFAULT_PREVIEW_CHARS
    return max(40, min(value, _MAX_PREVIEW_CHARS))


def elapsed_ms(started_at: float) -> int:
    """Return monotonic elapsed milliseconds for structured timing logs."""

    return max(0, int((time.monotonic() - started_at) * 1000))


def _metadata_str(metadata: Any, key: str) -> str | None:
    value = metadata.get(key) if hasattr(metadata, "get") else None
    return value if isinstance(value, str) and value.strip() else None


def _prompt_preview(request: ModelClientRequest, *, max_chars: int) -> dict[str, Any]:
    messages = list(request.prompt.messages)
    selected_messages = messages[-_MAX_PREVIEW_MESSAGES:]
    return {
        "message_count": len(messages),
        "omitted_message_count": max(0, len(messages) - len(selected_messages)),
        "messages": [_message_preview(message, max_chars=max_chars) for message in selected_messages],
    }


def _message_preview(message: object, *, max_chars: int) -> dict[str, Any]:
    if not isinstance(message, Mapping):
        return {"type": type(message).__name__, "preview": _preview_value(message, max_chars=max_chars)}
    preview: dict[str, Any] = {}
    role = message.get("role")
    if isinstance(role, str) and role.strip():
        preview["role"] = role.strip()
    content_preview = _preview_value(message.get("content"), max_chars=max_chars)
    if content_preview is not None:
        preview["content_preview"] = content_preview
    name = message.get("name")
    if isinstance(name, str) and name.strip():
        preview["name"] = name.strip()
    tool_call_id = message.get("tool_call_id")
    if isinstance(tool_call_id, str) and tool_call_id.strip():
        preview["tool_call_id"] = tool_call_id.strip()
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list | tuple):
        selected_tool_calls = list(tool_calls)[:_MAX_PREVIEW_TOOL_CALLS]
        preview["tool_call_count"] = len(tool_calls)
        preview["tool_calls"] = [
            _tool_call_preview(tool_call, max_chars=max_chars) for tool_call in selected_tool_calls
        ]
    return preview or {"keys": sorted(str(key) for key in message.keys())}


def _tool_call_preview(tool_call: object, *, max_chars: int) -> dict[str, Any]:
    if not isinstance(tool_call, Mapping):
        return {"type": type(tool_call).__name__, "preview": _preview_value(tool_call, max_chars=max_chars)}
    preview: dict[str, Any] = {}
    for key in ("id", "type"):
        value = tool_call.get(key)
        if isinstance(value, str) and value.strip():
            preview[key] = value.strip()
    function = tool_call.get("function")
    if isinstance(function, Mapping):
        name = function.get("name")
        if isinstance(name, str) and name.strip():
            preview["name"] = name.strip()
        arguments_preview = _preview_value(function.get("arguments"), max_chars=max_chars)
        if arguments_preview is not None:
            preview["arguments_preview"] = arguments_preview
    return preview or {"keys": sorted(str(key) for key in tool_call.keys())}


def _preview_value(value: object, *, max_chars: int) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return _preview_text(value, max_chars=max_chars)
    try:
        text = json.dumps(value, ensure_ascii=True, sort_keys=True, default=str)
    except (TypeError, ValueError):
        text = str(value)
    return _preview_text(text, max_chars=max_chars)


def _preview_text(text: str, *, max_chars: int) -> str | None:
    normalized = " ".join(str(text).split())
    if not normalized:
        return None
    redacted = _redact_preview_text(normalized)
    if len(redacted) <= max_chars:
        return redacted
    return f"{redacted[:max_chars]}...[truncated]"


def _redact_preview_text(text: str) -> str:
    redacted = _SECRET_ASSIGNMENT_RE.sub(lambda match: f"{match.group(1)}=[redacted]", text)
    redacted = _BEARER_RE.sub("Bearer [redacted]", redacted)
    return _OPENAI_KEY_RE.sub("sk-[redacted]", redacted)


__all__ = [
    "elapsed_ms",
    "model_client_preview_chars",
    "model_client_preview_enabled",
    "model_client_preview_log_context",
    "model_client_request_log_context",
]
