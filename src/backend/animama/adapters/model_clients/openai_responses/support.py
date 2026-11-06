from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from openai.types.responses import (
    Response,
    ResponseApplyPatchToolCall,
    ResponseCodeInterpreterToolCall,
    ResponseFileSearchToolCall,
    ResponseFunctionWebSearch,
    ResponseOutputMessage,
    ResponseOutputText,
)

from animama.adapters.model_clients._common import get_value

OPENAI_RESPONSES_HTTP_PROVIDER_TYPE = "OpenAIResponsesHTTPAgent"
OPENAI_API = "responses"
OPENAI_STREAM_INCOMPLETE_CODE = "openai_stream_incomplete"
OPENAI_MISSING_FINAL_ANSWER_PHASE_CODE = "openai_missing_final_answer_phase"

PHASE_COMMENTARY = "commentary"
PHASE_FINAL_ANSWER = "final_answer"
OPENAI_RESPONSES_HISTORY_METADATA_KEY = "openai_responses_history"
OPENAI_RESPONSES_ASSISTANT_PHASES_KEY = "assistant_phases_by_message_index"
OPENAI_RESPONSES_ASSISTANT_PHASES = frozenset({PHASE_COMMENTARY, PHASE_FINAL_ANSWER})

KNOWN_OUTPUT_ITEM_TYPES = frozenset(
    {
        "message",
        "function_call",
        "function_call_output",
        "compaction",
        "reasoning",
        "web_search_call",
        "file_search_call",
        "code_interpreter_call",
        "image_generation_call",
        "apply_patch_call",
        "apply_patch_call_output",
    }
)
NATIVE_TOOL_ITEM_TYPES = frozenset(
    {
        "web_search_call",
        "file_search_call",
        "code_interpreter_call",
        "image_generation_call",
        "apply_patch_call",
    }
)


def response_item_id(item: object) -> str | None:
    return clean_str(get_value(item, "id"))


def response_item_type(item: object) -> str:
    return str(get_value(item, "type", "") or "").strip()


def response_item_status(item: object) -> str | None:
    return clean_str(get_value(item, "status"))


def response_message_phase(item: object) -> str | None:
    if not isinstance(item, ResponseOutputMessage):
        return None
    return clean_str(item.phase)


def response_message_text_length(item: ResponseOutputMessage) -> int:
    total = 0
    for part in item.content:
        if isinstance(part, ResponseOutputText) and isinstance(part.text, str):
            total += len(part.text)
    return total


def response_message_annotation_count(item: ResponseOutputMessage) -> int:
    total = 0
    for part in item.content:
        if isinstance(part, ResponseOutputText):
            total += len(part.annotations or [])
    return total


def native_tool_summary_from_response_item(
    item: object,
    *,
    output_index: int,
    include_output_index: bool = True,
) -> dict[str, Any]:
    item_type = response_item_type(item)
    if not is_native_tool_item_type(item_type):
        return {}
    summary: dict[str, Any] = {
        "item_id": response_item_id(item),
        "tool_type": item_type,
        "status": response_item_status(item),
    }
    if include_output_index:
        summary["output_index"] = output_index
    if isinstance(item, ResponseFunctionWebSearch):
        action = item.action
        summary["action_type"] = response_item_type(action)
        query_count = sequence_count(get_value(action, "queries")) or (
            1 if clean_str(get_value(action, "query")) else 0
        )
        source_count = sequence_count(get_value(action, "sources"))
        if query_count:
            summary["query_count"] = query_count
        if source_count:
            summary["source_count"] = source_count
    elif isinstance(item, ResponseApplyPatchToolCall):
        operation = item.operation
        summary["tool_call_id"] = clean_str(item.call_id)
        summary["action_type"] = response_item_type(operation)
        path = get_value(operation, "path")
        if isinstance(path, str):
            summary["path_length"] = len(path)
    elif isinstance(item, ResponseFileSearchToolCall):
        summary["query_count"] = len(item.queries or [])
        summary["result_count"] = len(item.results or [])
    elif isinstance(item, ResponseCodeInterpreterToolCall):
        summary["content_length"] = len(item.code or "")
        summary["result_count"] = len(item.outputs or [])
    else:
        results = get_value(item, "results")
        outputs = get_value(item, "outputs")
        if isinstance(results, list):
            summary["result_count"] = len(results)
        if isinstance(outputs, list):
            summary["result_count"] = len(outputs)
    return {key: value for key, value in summary.items() if value is not None}


def is_native_tool_item_type(item_type: str) -> bool:
    return item_type in NATIVE_TOOL_ITEM_TYPES


def response_identity_details(response: Response) -> dict[str, Any]:
    details: dict[str, Any] = {"response_id": response.id, "model": response.model}
    if response.status is not None:
        details["status"] = response.status
    if response.service_tier is not None:
        details["service_tier"] = response.service_tier
    return details


def response_error_details(response: Response) -> dict[str, Any]:
    error = response.error
    if error is None:
        return {}
    return {
        "provider_error_code": error.code,
    }


def response_incomplete_details(response: Response) -> dict[str, Any]:
    incomplete = response.incomplete_details
    reason = clean_str(get_value(incomplete, "reason"))
    if reason is None:
        return {}
    return {"incomplete_reason": reason}


def primary_phase(phase_counts: Mapping[str, int]) -> str | None:
    if not phase_counts:
        return None
    if PHASE_FINAL_ANSWER in phase_counts:
        return PHASE_FINAL_ANSWER
    if PHASE_COMMENTARY in phase_counts:
        return PHASE_COMMENTARY
    return next(iter(phase_counts))


def append_once(values: list[str], value: str) -> None:
    if value and value not in values:
        values.append(value)


def sequence_count(value: Any) -> int:
    if isinstance(value, list | tuple | set | frozenset):
        return len(value)
    return 0


def optional_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float) and value.is_integer():
        return max(0, int(value))
    return 0


def unknown_field_names(value: object) -> tuple[str, ...]:
    extra = getattr(value, "model_extra", None)
    if isinstance(extra, Mapping):
        return tuple(str(key) for key in sorted(extra) if str(key).strip())
    if isinstance(value, Mapping):
        return tuple(str(key) for key in sorted(value) if str(key).strip() and key != "type")
    fields = getattr(value, "__dict__", None)
    if isinstance(fields, dict):
        return tuple(str(key) for key in sorted(fields) if str(key).strip() and not str(key).startswith("_"))
    return ()


def clean_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    out = value.strip()
    return out or None
