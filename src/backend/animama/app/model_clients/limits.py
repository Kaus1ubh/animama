"""Composition-selected limits for one provider request, including retries."""

import math
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ModelCallLimits:
    """A bounded invocation never retries inside the adapter or provider SDK.

    A caller may retry by making another admitted invocation. These limits are
    server-selected; they are not an HTTP request option or model catalog field.
    """

    max_output_tokens: int
    timeout_seconds: float
    max_native_tool_calls: int | None = None
    cleanup_timeout_seconds: float = 5.0

    def __post_init__(self) -> None:
        if type(self.max_output_tokens) is not int or self.max_output_tokens <= 0:
            raise ValueError("max_output_tokens must be a positive integer")
        if self.max_native_tool_calls is not None and (
            type(self.max_native_tool_calls) is not int or self.max_native_tool_calls < 1
        ):
            raise ValueError("max_native_tool_calls must be a positive integer")
        if not math.isfinite(self.cleanup_timeout_seconds) or self.cleanup_timeout_seconds <= 0:
            raise ValueError("cleanup_timeout_seconds must be positive and finite")
        if not math.isfinite(self.timeout_seconds) or self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive and finite")
