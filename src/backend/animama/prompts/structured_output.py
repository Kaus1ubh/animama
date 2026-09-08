from __future__ import annotations

from typing import Any

from animama.app.structured_output_config import build_structured_output_collection
from animama.domain.emotions import (
    EMOTION_DEMOTION_BUDGET,
    EMOTION_GROUPS,
    EMOTION_PROMOTION_BUDGET,
    TRACKED_EMOTIONS,
)
from animama.domain.enums import AgentInstructionProfile

StructuredOutputSchema = dict[str, Any]
EMOTIONAL_ANALYST_OUTPUT_KIND = "emotional_analyst"

_TRACKED_EMOTION_LIST = ", ".join(TRACKED_EMOTIONS)
_EMOTION_GROUP_LIST = ", ".join(EMOTION_GROUPS)
_PROMOTION_EMOTION_DESCRIPTION = (
    "Tracked leaf emotion to increase. Must be one of these tracked emotions only: "
    f"{_TRACKED_EMOTION_LIST}. Do not use emotion group names such as: {_EMOTION_GROUP_LIST}."
)
_DEMOTION_EMOTION_DESCRIPTION = (
    "Tracked leaf emotion to decrease. Must be one of these tracked emotions only: "
    f"{_TRACKED_EMOTION_LIST}. Do not use emotion group names such as: {_EMOTION_GROUP_LIST}."
)


EMOTIONAL_ANALYST_STRUCTURED_OUTPUT_SCHEMA: StructuredOutputSchema = {
    "kind": EMOTIONAL_ANALYST_OUTPUT_KIND,
    "version": 1,
    "persist_raw_json": True,
    "fields": {
        "promotions": {
            "type": "list",
            "min_items": 0,
            "max_items": 3,
            "default_factory": "list",
            "items": {
                "type": "object",
                "fields": {
                    "emotion": {
                        "type": "str",
                        "enum": list(TRACKED_EMOTIONS),
                        "description": _PROMOTION_EMOTION_DESCRIPTION,
                    },
                    "value": {
                        "type": "int",
                        "min": 1,
                        "max": min(3, EMOTION_PROMOTION_BUDGET),
                        "description": "Positive promotion amount for the selected emotion.",
                    },
                },
            },
        },
        "demotions": {
            "type": "list",
            "min_items": 0,
            "max_items": 2,
            "default_factory": "list",
            "items": {
                "type": "object",
                "fields": {
                    "emotion": {
                        "type": "str",
                        "enum": list(TRACKED_EMOTIONS),
                        "description": _DEMOTION_EMOTION_DESCRIPTION,
                    },
                    "value": {
                        "type": "int",
                        "min": -min(2, EMOTION_DEMOTION_BUDGET),
                        "max": -1,
                        "description": "Negative demotion amount for the selected emotion.",
                    },
                },
            },
        },
    },
}

STRUCTURED_OUTPUT_SCHEMAS: dict[str, StructuredOutputSchema] = {
    "emotional_analyst": build_structured_output_collection(
        default=EMOTIONAL_ANALYST_OUTPUT_KIND,
        outputs={EMOTIONAL_ANALYST_OUTPUT_KIND: EMOTIONAL_ANALYST_STRUCTURED_OUTPUT_SCHEMA},
    ),
}


def get_structured_output_schema(profile: AgentInstructionProfile | str | None) -> StructuredOutputSchema | None:
    """Return a structured output schema for a profile, if defined."""
    if profile is None:
        return None
    key = profile.value if isinstance(profile, AgentInstructionProfile) else str(profile)
    key = key.strip().lower()
    return STRUCTURED_OUTPUT_SCHEMAS.get(key)
