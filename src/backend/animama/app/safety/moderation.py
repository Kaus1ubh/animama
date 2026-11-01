"""Interpret moderation results for crisis detection (spec R3).

OpenAI Responses turns carry inline moderation on the chat request. Anthropic
Messages turns have none, so a composition may supply an operator
``CrisisModerator`` that checks the user's message in a separate request.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from contextlib import suppress
from typing import Protocol

from animama.app.model_clients import ModelClientModeration
from animama.logging import get_logger

OPENAI_MODERATION_MODEL = "omni-moderation-latest"
"""OpenAI moderation model, requested inline on Responses or from the moderation endpoint."""

SELF_HARM_FLAG_CATEGORIES = frozenset({"self-harm/intent", "self-harm/instructions"})
SELF_HARM_SCORE_CATEGORY = "self-harm"
SELF_HARM_SCORE_THRESHOLD = 0.8
"""Initial threshold for the broad self-harm score; calibrated in the live check (gate G2)."""

OPERATOR_MODERATION_GRACE_SECONDS = 2.0
"""How long a finished reply waits for a pending operator check before showing no card."""

_log = get_logger("app.safety.moderation")


class CrisisModerator(Protocol):
    """An operator-configured check of one user message for crisis detection.

    It receives only the message text, never instructions, persona, memory or
    history, so an Anima cannot steer it. It never logs the text.
    """

    async def moderate(self, text: str) -> ModelClientModeration:
        """Return the content-free result, or an ``error`` result when the check failed."""
        ...


def moderation_result(categories: Mapping[str, object], scores: Mapping[str, object]) -> ModelClientModeration:
    """Build a content-free result from a provider's per-category flags and scores."""

    return ModelClientModeration(
        status="result",
        flagged_categories=tuple(sorted(str(name) for name, flagged in categories.items() if flagged is True)),
        category_scores={str(name): float(score) for name, score in scores.items() if isinstance(score, int | float)},
    )


def moderation_indicates_crisis(moderation: ModelClientModeration | None) -> bool:
    """Return whether an input moderation result signals self-harm or suicide risk."""

    if moderation is None or moderation.status != "result":
        return False
    if SELF_HARM_FLAG_CATEGORIES.intersection(moderation.flagged_categories):
        return True
    return moderation.category_scores.get(SELF_HARM_SCORE_CATEGORY, 0.0) >= SELF_HARM_SCORE_THRESHOLD


async def settle_operator_moderation(
    task: asyncio.Task[ModelClientModeration], *, timeout: float = OPERATOR_MODERATION_GRACE_SECONDS
) -> ModelClientModeration | None:
    """Wait up to ``timeout`` for an operator check started alongside the reply.

    Returns ``None`` when it is still running (the caller cancels it) and an
    ``error`` result when it raised, so a failed check never affects the turn.
    """

    done, _pending = await asyncio.wait({task}, timeout=timeout)
    if not done:
        return None
    if task.cancelled():
        return ModelClientModeration(status="error")
    try:
        return task.result()
    except Exception as exc:
        _log.warning("Operator crisis moderation failed", error_type=type(exc).__name__)
        return ModelClientModeration(status="error")


async def discard_operator_moderation(task: asyncio.Task[ModelClientModeration]) -> None:
    """Cancel an operator check that is still running when the turn ends.

    A check that already failed has its exception retrieved, so asyncio never
    logs its traceback.
    """

    if not task.done():
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    elif not task.cancelled():
        task.exception()


__all__ = [
    "OPENAI_MODERATION_MODEL",
    "OPERATOR_MODERATION_GRACE_SECONDS",
    "SELF_HARM_FLAG_CATEGORIES",
    "SELF_HARM_SCORE_THRESHOLD",
    "CrisisModerator",
    "discard_operator_moderation",
    "moderation_indicates_crisis",
    "moderation_result",
    "settle_operator_moderation",
]
