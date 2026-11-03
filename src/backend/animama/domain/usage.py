# Adapted from OpenAI Agents SDK (MIT): src/agents/usage.py.
# See licenses/third-party/adapted-code.md.
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class UsageInputDetails:
    cached_tokens: int = 0
    audio_tokens: int = 0
    cache_write_tokens: int = 0
    """Input tokens written to the provider's prompt cache (priced separately)."""


@dataclass(slots=True)
class UsageOutputDetails:
    reasoning_tokens: int = 0
    audio_tokens: int = 0
    accepted_prediction_tokens: int = 0
    rejected_prediction_tokens: int = 0


@dataclass(slots=True)
class Usage:
    """Standardized usage counters across providers.

    Unknown counters are optional and ignored by persistence if not set.
    """

    # Generic counters
    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0

    # Detailed counters
    input_tokens_details: UsageInputDetails = field(default_factory=UsageInputDetails)
    output_tokens_details: UsageOutputDetails = field(default_factory=UsageOutputDetails)

    def add(self, other: Usage) -> None:
        self.requests += other.requests if other.requests else 0
        self.input_tokens += other.input_tokens if other.input_tokens else 0
        self.output_tokens += other.output_tokens if other.output_tokens else 0
        self.total_tokens += other.total_tokens if other.total_tokens else 0
        self.input_tokens_details = UsageInputDetails(
            cached_tokens=self.input_tokens_details.cached_tokens + other.input_tokens_details.cached_tokens,
            cache_write_tokens=(
                self.input_tokens_details.cache_write_tokens + other.input_tokens_details.cache_write_tokens
            ),
        )

        self.output_tokens_details = UsageOutputDetails(
            reasoning_tokens=self.output_tokens_details.reasoning_tokens + other.output_tokens_details.reasoning_tokens
        )


__all__ = ["Usage", "UsageInputDetails", "UsageOutputDetails"]
