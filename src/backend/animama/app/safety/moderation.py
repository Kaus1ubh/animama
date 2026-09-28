"""Interpret provider moderation results for crisis detection (spec R3)."""

from __future__ import annotations

from animama.app.model_clients import ModelClientModeration

RESPONSES_MODERATION_MODEL = "omni-moderation-latest"
"""Model requested for OpenAI Responses built-in moderation."""

SELF_HARM_FLAG_CATEGORIES = frozenset({"self-harm/intent", "self-harm/instructions"})
SELF_HARM_SCORE_CATEGORY = "self-harm"
SELF_HARM_SCORE_THRESHOLD = 0.8
"""Initial threshold for the broad self-harm score; calibrated in the live check (gate G2)."""


def moderation_indicates_crisis(moderation: ModelClientModeration | None) -> bool:
    """Return whether an input moderation result signals self-harm or suicide risk."""

    if moderation is None or moderation.status != "result":
        return False
    if SELF_HARM_FLAG_CATEGORIES.intersection(moderation.flagged_categories):
        return True
    return moderation.category_scores.get(SELF_HARM_SCORE_CATEGORY, 0.0) >= SELF_HARM_SCORE_THRESHOLD


__all__ = [
    "RESPONSES_MODERATION_MODEL",
    "SELF_HARM_FLAG_CATEGORIES",
    "SELF_HARM_SCORE_THRESHOLD",
    "moderation_indicates_crisis",
]
