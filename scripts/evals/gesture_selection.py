#!/usr/bin/env python3
"""Measure how well the chat model picks Gestures from a loadout.

Every prompt runs through chat's own turn executor (``DirectChatTurnExecutor``):
the same system prompt (and turn context, when there is any), equipped Gesture list, structured reply
schema, structured repair and salvage, and Gesture validation as ``chat:sse``.
In-memory stand-ins replace its repositories, so no Anima, chat or memory row
is read or written. The Anima has a neutral, generic identity.

Turns are incognito: the provider is asked not to store them (``store=False``),
chat persists nothing and chat's pre-send compaction is skipped. An OpenAI
Responses client configured with a compaction threshold can still ask the
provider for native context compaction; the results record that setting as
``model.native_context_compaction``. Each scripted chat keeps its own visible
history in memory and replays it the way chat would: the user's messages and
the assistant's structured reply text.

Limitation: memory influence and updates are off, so the prompt has no memory
map, memory tools or ``MEMORIES.md``, unlike a default chat with memories.

Inputs:
  ``--loadout FILE`` (repeatable): a JSON list of ``{"selector", "name",
  "description"}``; the file stem names the loadout. The harness keeps the
  file's order. Chat lists an Anima's equipped Gestures sorted by selector
  (``AnimaRuntimeService`` sorts runtime roots by kind, then by ``slot_key``,
  which is ``gesture:<selector>`` for bindings and starters alike), so sort a
  loadout file by selector to match; the plan notes a loadout that is not.
  ``--prompts FILE``: a JSON object with ``"items"``, single-turn prompts
  ``{"id", "message", "acceptable": [selector | null, ...], "tags": [...]}``,
  and optional ``"scripted_chats"``, ``{"id", "turns": [message, ...]}``.

Each single-turn item runs as a fresh one-turn chat ``--repeats`` times per
loadout. Each scripted chat runs turn by turn ``--scripted-repeats`` times per
loadout. Loadouts alternate item by item, so a run stopped at the cap leaves
the loadouts with comparable coverage. A chosen Gesture fits when it is in
``acceptable``; no Gesture fits only when ``acceptable`` contains ``null``.

Preview the plan, the call estimate and approximate input tokens per first
turn (no database or model needed)::

    uv run python -m scripts.evals.gesture_selection --dry-run \\
        --loadout starters.json --loadout candidates.json --loadout all.json \\
        --prompts prompts.json --repeats 3 --scripted-repeats 1 --max-calls 800

With 60 items and two 30-turn scripted chats, that plans 3 x (3 x 60 + 60) =
720 calls. The cap leaves headroom because structured repairs and
context-window retries also count against it. A plan whose estimate exceeds
the cap does not start, and no call beyond the cap is sent.

To estimate cost before a paid run, multiply the planned calls by the input
tokens per call and the model's input price, then add calls x output tokens (a
short reply of about 100-200 tokens, plus any reasoning) x the output price.
Single-turn calls stay near the first-turn estimate; scripted turns grow with
their history. A free smoke run (``ANIMAMA_LLM_SKIP=1``, below) checks the
wiring and records instruction bytes and estimated tokens, but the mock model
reports no usage.

Paid runs happen inside the backend container of a development stack started
from this checkout (``./reset.sh --name <name> --base-port <port>``), where
configured model connections and their keys are available. Only the
development compose selection bind-mounts the checkout at ``/app``; the built
image has no ``scripts/``. ``--model-provider-id`` is a model catalog row id
(``--list-models`` prints the active chat rows); it resolves the way chat
resolves a requested model, and each request reads its connection's key from
the process credential store. The harness never reads, prints or logs keys,
and reads the catalog in a read-only transaction::

    source .animama-stack.env
    docker compose -p "$COMPOSE_PROJECT_NAME" exec animama-server python -m scripts.evals.gesture_selection \\
        --loadout <path> --prompts <path> --model-provider-id <row id> \\
        --repeats 3 --max-calls 800 --output-dir /app/.animama-drafts/gesture-eval/<run>

Paths are container paths, and ``/app`` is this checkout, so an
``--output-dir`` under ``/app/.animama-drafts/`` writes through the mount into
the gitignored drafts folder. For a free smoke run against the mock model
client, add ``-e ANIMAMA_LLM_SKIP=1`` after ``exec``.

Outputs go to ``--output-dir`` (default: a new directory under the system temp
directory, inside the container for container runs), also when a run stops at
the cap, fails or is interrupted: ``results.json`` with each turn's Gesture,
emotional tone, spoken reply, usage and timing, and ``summary.md`` with fit and
null rates, Gesture-list bytes, repetition in scripted chats, tokens, estimated
cost, latency and per-turn token statistics, but no prompts or replies.

Cost: ``cost`` uses the catalog row's standard rates, and is unpriced when the
row has no rate or the provider reports prompt-cache writes (the catalog
records no cache-write rate). ``--price input=…,cached_input=…,cache_write=…,output=…``
(USD per 1M tokens, all four required) adds ``price_estimate`` for the run and
``estimated_cost_usd`` per turn. Uncached input is input minus cached input
minus cache writes; reasoning tokens are part of output and bill at the output
rate. Both are estimates from published rates; billing is authoritative.

Each loadout's ``tokens`` summary gives, for successful single-turn items and
scripted turns separately, the total, median, nearest-rank p90 and mean per
turn of input, cached input, cache-write, output and reasoning tokens, and of
the estimated cost when priced. A turn sums all of its calls. Usage cannot
tell a provider that reports no reasoning tokens from one that used none, so
the summary shows "none reported" for a zero reasoning total.

Timing uses a monotonic clock. Each turn records ``latency_seconds``, from
sending the turn until chat's reply stream ends, covering every call of the
turn (a structured repair or context retry included); ``first_output_seconds``,
until chat's first spoken reply text; and ``call_latencies``, each model call's
``seconds`` and ``first_text_seconds`` until its first streamed text delta
(``null`` when it streamed none). Chat streams speech sentence by sentence from
a structured reply, so first output is the first complete sentence. A reply
that arrives only in its final speaks at the end of its call. When the first
reply streams no speech and needs a structured repair, the repair also
streams, so first output is the first call's duration plus the repair's first
sentence. ``first_output_seconds`` is ``null`` only when no speech reached
chat's stream; a failed turn can still have one when speech streamed before
the error. Each loadout's ``latency`` summary gives the median, nearest-rank
p90 and mean over successful single-turn items and scripted turns separately
of the turn latency, the first token (the first call's ``first_text_seconds``,
the provider's time to its first streamed text, over the turns whose first
call streamed any) and the first speech. Turns run one at a time, so latencies
do not overlap, but they include network and provider queueing, so compare
configurations measured in the same session and conditions.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import statistics
import sys
import tempfile
import time
from collections.abc import AsyncIterator, Callable, Iterable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, cast

from pydantic import BaseModel

from animama.app.chat import (
    DirectChatMemoryContext,
    DirectChatMemoryContextService,
    DirectChatPrompt,
    DirectChatTurnExecutor,
    DirectChatTurnRequest,
    DirectChatTurnSetupError,
    ModelClientNotFoundError,
    RuntimeGestureDescriptor,
)
from animama.app.chat.api_standard import OPENAI_CHAT_COMPLETIONS_PROVIDER_TYPE
from animama.app.chat.direct_turn.message_builders import user_provider_message
from animama.app.chat.direct_turn.response_format import render_available_gestures
from animama.app.chat.memory_context import MEMORY_CONTEXT_METADATA_VERSION
from animama.app.chat.options import DirectChatOptions
from animama.app.main_structured_response import (
    MAIN_STRUCTURED_RESPONSE_PART_SPEECH,
    MainStructuredJsonStreamParser,
    MainStructuredResponse,
    main_structured_response_from_data,
    plain_text_main_structured_response,
    recover_main_structured_response,
    render_main_structured_json,
)
from animama.app.model_catalog import STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
from animama.app.model_clients import (
    ModelClient,
    ModelClientDelta,
    ModelClientError,
    ModelClientRegistry,
    ModelClientRequest,
    StaticModelClientRegistry,
    uses_native_context_compaction,
)
from animama.app.model_clients.context_budget import estimate_prompt_tokens
from animama.app.ports import ModelProviderRepository
from animama.app.services import AnimaChatProfileService, ChatManager
from animama.app.util.model_pricing import estimate_model_token_cost
from animama.domain import ModelProvider, ModelProviderCapabilities
from animama.domain.chat import Chat, ChatContext, ChatMessage, MessageRole
from animama.domain.events import Event, EventType, UserResponsePayload
from animama.domain.model_connection import MODEL_KIND_CHAT
from animama.domain.usage import Usage, UsageInputDetails, UsageOutputDetails

__all__ = [
    "ANIMA_IDENTITY",
    "ANIMA_NAME",
    "CallBudgetExceeded",
    "EvalInputError",
    "EvalPlan",
    "Loadout",
    "PromptItem",
    "PromptSet",
    "ScriptedChat",
    "TokenPrices",
    "build_registry",
    "check_budget",
    "distinct_gestures",
    "estimate_first_turn_tokens",
    "load_loadout",
    "load_model_provider",
    "load_prompt_set",
    "longest_run",
    "main",
    "parse_token_prices",
    "render_plan",
    "render_summary",
    "replayed_reply",
    "run_evaluation",
    "score_fit",
    "write_outputs",
]

RESULT_SCHEMA = "animama/gesture-selection-eval/1"
ANIMA_NAME = "Sora"
ANIMA_IDENTITY = (
    "Sora is a friendly, curious and even-tempered companion. Sora speaks casually and briefly, listens "
    "closely, enjoys everyday conversation, and shows emotions openly but in proportion to the moment."
)
# Fixed, synthetic owner and Anima ids: the in-memory stand-ins never look them up.
_EVAL_OWNER_ID = "gesture-eval-owner"
_EVAL_ANIMA_ID = "gesture-eval-anima"
_BUDGET_ERROR_CODE = "eval_call_budget_spent"
_USAGE_KEYS = (
    "input_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
    "output_tokens",
    "reasoning_tokens",
    "total_tokens",
)
# A built-in JSON-schema chat row used only to size prompts for the dry-run token estimate.
_ESTIMATE_MODEL_PROVIDER = ModelProvider(
    id="gesture-eval:json-schema-estimate",
    model="json-schema-estimate",
    provider_type=OPENAI_CHAT_COMPLETIONS_PROVIDER_TYPE,
    model_label="JSON-schema estimate",
    provider_label="Estimate",
    capabilities=ModelProviderCapabilities(
        supports_streaming=True,
        structured_kinds=["main_structured_response"],
        structured_output_transport=STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
    ),
)

TurnProgress = Callable[[Mapping[str, Any]], None]
ResultsSink = Callable[[dict[str, Any]], None]
Clock = Callable[[], float]
"""A monotonic clock in seconds; runs use ``time.monotonic`` and tests inject a fake."""


class EvalInputError(ValueError):
    """A loadout, prompt set or option the harness cannot use."""


class CallBudgetExceeded(RuntimeError):
    """The plan needs more model calls than ``--max-calls`` allows; nothing was sent."""


@dataclass(frozen=True, slots=True)
class Loadout:
    """An equipped Gesture list, in the order the harness lists it to the model."""

    name: str
    gestures: tuple[RuntimeGestureDescriptor, ...]
    sha256: str = field(default="", compare=False)
    """SHA-256 of the loaded file's bytes, when it came from a file."""

    @property
    def selectors(self) -> tuple[str, ...]:
        return tuple(gesture.selector for gesture in self.gestures)


@dataclass(frozen=True, slots=True)
class PromptItem:
    """A single-turn prompt and the Gestures (``None`` for no Gesture) that fit it."""

    id: str
    message: str
    acceptable: tuple[str | None, ...]
    tags: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ScriptedChat:
    """A multi-turn chat used to measure Gesture repetition."""

    id: str
    turns: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PromptSet:
    items: tuple[PromptItem, ...] = ()
    scripted_chats: tuple[ScriptedChat, ...] = ()
    sha256: str = field(default="", compare=False)
    """SHA-256 of the loaded file's bytes, when it came from a file."""

    @property
    def scripted_turns(self) -> int:
        return sum(len(chat.turns) for chat in self.scripted_chats)


@dataclass(frozen=True, slots=True)
class EvalPlan:
    """Every loadout runs each item ``repeats`` times and each scripted chat ``scripted_repeats`` times."""

    loadouts: tuple[Loadout, ...]
    prompt_set: PromptSet
    repeats: int = 1
    scripted_repeats: int = 1

    @property
    def calls_per_loadout(self) -> int:
        """One call per turn; a structured repair or context retry can add one more to a turn."""

        return self.repeats * len(self.prompt_set.items) + self.scripted_repeats * self.prompt_set.scripted_turns

    @property
    def estimated_calls(self) -> int:
        return self.calls_per_loadout * len(self.loadouts)


@dataclass(frozen=True, slots=True)
class TokenPrices:
    """Published USD rates per 1M tokens, used to estimate each turn's cost.

    Uncached input is ``input_tokens - cached_input_tokens - cache_write_tokens``,
    as chat's usage model and catalog estimator define it. Reasoning tokens are
    part of ``output_tokens`` and bill at the output rate.
    """

    input: Decimal
    cached_input: Decimal
    cache_write: Decimal
    output: Decimal

    def cost(self, usage: Mapping[str, int]) -> Decimal:
        uncached = max(usage["input_tokens"] - usage["cached_input_tokens"] - usage["cache_write_tokens"], 0)
        return (
            uncached * self.input
            + usage["cached_input_tokens"] * self.cached_input
            + usage["cache_write_tokens"] * self.cache_write
            + usage["output_tokens"] * self.output
        ) / _ONE_MILLION

    def as_json(self) -> dict[str, str]:
        return {name: str(getattr(self, name)) for name in _PRICE_NAMES}


_ONE_MILLION = Decimal(1_000_000)
_PRICE_NAMES = ("input", "cached_input", "cache_write", "output")


def parse_token_prices(text: str) -> TokenPrices:
    """Parse ``input=…,cached_input=…,cache_write=…,output=…`` (USD per 1M tokens); every rate is required."""

    rates: dict[str, Decimal] = {}
    for part in text.split(","):
        name, separator, value = part.partition("=")
        name = name.strip()
        if not separator or name not in _PRICE_NAMES:
            raise EvalInputError(
                f"--price: unknown or malformed rate {part.strip()!r}; expected {', '.join(_PRICE_NAMES)}"
            )
        try:
            rate = Decimal(value.strip())
        except InvalidOperation as exc:
            raise EvalInputError(f"--price: {name} must be a number") from exc
        if not rate.is_finite() or rate < 0:
            raise EvalInputError(f"--price: {name} must be a non-negative number")
        if name in rates:
            raise EvalInputError(f"--price: duplicate rate {name!r}")
        rates[name] = rate
    missing = [name for name in _PRICE_NAMES if name not in rates]
    if missing:
        raise EvalInputError(f"--price: missing {', '.join(missing)}")
    return TokenPrices(**rates)


# --- Inputs -----------------------------------------------------------------


def _read_json(path: Path) -> tuple[Any, str]:
    """Return a file's parsed JSON and the SHA-256 of the exact bytes parsed."""

    try:
        raw = path.read_bytes()
        return json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest()
    except (OSError, ValueError) as exc:
        raise EvalInputError(f"{path}: cannot read JSON ({exc})") from exc


def _required_text(entry: Mapping[str, Any], key: str, where: str) -> str:
    value = entry.get(key)
    if not isinstance(value, str) or not value.strip():
        raise EvalInputError(f"{where}: {key!r} must be a non-empty string")
    return value.strip()


def _require_unique(ids: Iterable[str], where: str) -> None:
    seen: set[str] = set()
    for item_id in ids:
        if item_id in seen:
            raise EvalInputError(f"{where}: duplicate id {item_id!r}")
        seen.add(item_id)


def load_loadout(path: Path) -> Loadout:
    """Read a loadout file: a non-empty JSON list of ``{selector, name, description}``."""

    data, sha256 = _read_json(path)
    if not isinstance(data, list) or not data:
        raise EvalInputError(f"{path}: expected a non-empty JSON list of Gestures")
    gestures: list[RuntimeGestureDescriptor] = []
    selectors: set[str] = set()
    for index, entry in enumerate(data):
        where = f"{path}[{index}]"
        if not isinstance(entry, Mapping):
            raise EvalInputError(f"{where}: expected an object")
        selector = _required_text(entry, "selector", where)
        if selector in selectors:
            raise EvalInputError(f"{where}: duplicate selector {selector!r}")
        selectors.add(selector)
        gestures.append(
            RuntimeGestureDescriptor(
                selector=selector,
                name=_required_text(entry, "name", where),
                description=_required_text(entry, "description", where),
            )
        )
    return Loadout(name=path.stem, gestures=tuple(gestures), sha256=sha256)


def _prompt_item(entry: Any, where: str) -> PromptItem:
    if not isinstance(entry, Mapping):
        raise EvalInputError(f"{where}: expected an object")
    acceptable = entry.get("acceptable")
    if (
        not isinstance(acceptable, list)
        or not acceptable
        or not all(value is None or (isinstance(value, str) and value.strip()) for value in acceptable)
    ):
        raise EvalInputError(f"{where}: 'acceptable' must be a non-empty list of selectors or null")
    tags = entry.get("tags", [])
    if not isinstance(tags, list) or not all(isinstance(tag, str) and tag.strip() for tag in tags):
        raise EvalInputError(f"{where}: 'tags' must be a list of non-empty strings")
    # The message is sent exactly as written; it only has to say something.
    _required_text(entry, "message", where)
    return PromptItem(
        id=_required_text(entry, "id", where),
        message=entry["message"],
        acceptable=tuple(value.strip() if isinstance(value, str) else None for value in acceptable),
        tags=tuple(tag.strip() for tag in tags),
    )


def _scripted_chat(entry: Any, where: str) -> ScriptedChat:
    if not isinstance(entry, Mapping):
        raise EvalInputError(f"{where}: expected an object")
    turns = entry.get("turns")
    if not isinstance(turns, list) or not turns or not all(isinstance(turn, str) and turn.strip() for turn in turns):
        raise EvalInputError(f"{where}: 'turns' must be a non-empty list of messages")
    return ScriptedChat(id=_required_text(entry, "id", where), turns=tuple(turns))


def load_prompt_set(path: Path) -> PromptSet:
    """Read a prompt-set file with single-turn ``items`` and optional ``scripted_chats``."""

    data, sha256 = _read_json(path)
    if not isinstance(data, Mapping):
        raise EvalInputError(f"{path}: expected a JSON object with 'items' and 'scripted_chats'")
    raw_items = data.get("items", [])
    raw_chats = data.get("scripted_chats", [])
    if not isinstance(raw_items, list) or not isinstance(raw_chats, list):
        raise EvalInputError(f"{path}: 'items' and 'scripted_chats' must be lists")
    items = tuple(_prompt_item(entry, f"{path}: items[{index}]") for index, entry in enumerate(raw_items))
    chats = tuple(_scripted_chat(entry, f"{path}: scripted_chats[{index}]") for index, entry in enumerate(raw_chats))
    if not items and not chats:
        raise EvalInputError(f"{path}: no items or scripted chats")
    _require_unique((item.id for item in items), f"{path}: items")
    _require_unique((chat.id for chat in chats), f"{path}: scripted_chats")
    return PromptSet(items=items, scripted_chats=chats, sha256=sha256)


# --- Scoring ----------------------------------------------------------------


def score_fit(gesture: str | None, acceptable: Sequence[str | None]) -> bool:
    """Return whether the played Gesture fits; ``None`` fits only when ``acceptable`` contains ``None``."""

    return gesture in acceptable


def longest_run(gestures: Sequence[str | None]) -> tuple[int, str | None]:
    """Return the longest run of one Gesture on consecutive turns, and that Gesture (the first such run).

    A turn without a Gesture ends a run.
    """

    best, best_gesture, run, previous = 0, None, 0, None
    for gesture in gestures:
        if gesture is None:
            run, previous = 0, None
            continue
        run = run + 1 if gesture == previous else 1
        previous = gesture
        if run > best:
            best, best_gesture = run, gesture
    return best, best_gesture


def distinct_gestures(gestures: Iterable[str | None]) -> int:
    return len({gesture for gesture in gestures if gesture is not None})


def gesture_list_bytes(loadout: Loadout) -> int:
    """UTF-8 size of the Gesture list chat appends to the system prompt for this loadout."""

    return len(render_available_gestures(loadout.gestures).encode("utf-8"))


def coverable_items(loadout: Loadout, items: Iterable[PromptItem]) -> int:
    """Count items that can fit this loadout: one acceptable Gesture is equipped, or null is acceptable."""

    selectors = set(loadout.selectors)
    return sum(1 for item in items if any(value is None or value in selectors for value in item.acceptable))


def unknown_acceptable_selectors(plan: EvalPlan) -> list[str]:
    """Return acceptable selectors equipped in no loadout, which usually means a typo."""

    equipped = {selector for loadout in plan.loadouts for selector in loadout.selectors}
    named = {value for item in plan.prompt_set.items for value in item.acceptable if value is not None}
    return sorted(named - equipped)


def render_plan(
    plan: EvalPlan,
    *,
    max_calls: int | None,
    first_turn_tokens: Mapping[str, int] | None = None,
) -> str:
    """Describe what a run would send: the up-front call estimate, prompt sizes and input checks."""

    prompt_set = plan.prompt_set
    lines = [
        "Gesture selection evaluation plan",
        f"Prompt set: {len(prompt_set.items)} single-turn items, {len(prompt_set.scripted_chats)} scripted chats "
        f"({prompt_set.scripted_turns} turns)",
        f"Repeats per loadout: {plan.repeats} for single-turn items, {plan.scripted_repeats} for scripted chats",
        "Loadouts:",
    ]
    for loadout in plan.loadouts:
        lines.append(
            f"  - {loadout.name}: {len(loadout.gestures)} Gestures, {gesture_list_bytes(loadout)} gesture-list bytes, "
            f"{coverable_items(loadout, prompt_set.items)}/{len(prompt_set.items)} items coverable"
        )
    lines.append(
        f"Estimated model calls: {plan.estimated_calls} ({plan.calls_per_loadout} per loadout); "
        f"up to {2 * plan.estimated_calls} if every reply needs chat's structured repair request"
    )
    if first_turn_tokens:
        lines.append(
            "Approximate input tokens (chat's conservative estimate for a JSON-schema model; "
            "scripted turns grow with their history):"
        )
        lines.extend(f"  - {name}: ~{tokens} input tokens per first turn" for name, tokens in first_turn_tokens.items())
    if max_calls is not None:
        if plan.estimated_calls > max_calls:
            lines.append(f"Budget: the estimate exceeds --max-calls {max_calls}, so the run will not start")
        else:
            lines.append(
                f"Budget: the estimate is within --max-calls {max_calls}; repairs and context retries also "
                "count, and no call beyond the cap is sent"
            )
    for loadout in plan.loadouts:
        if list(loadout.selectors) != sorted(loadout.selectors):
            lines.append(
                f"Note: {loadout.name} is not in production order (chat lists equipped Gestures sorted by selector)"
            )
    unknown = unknown_acceptable_selectors(plan)
    if unknown:
        lines.append("Acceptable selectors in no loadout: " + ", ".join(unknown))
    return "\n".join(lines)


# --- In-memory chat collaborators --------------------------------------------


@dataclass(slots=True)
class _CallRecord:
    started: float
    """Clock reading when the call was dispatched."""
    finished: float | None = None
    """Clock reading when the call's stream ended or failed."""
    first_text: float | None = None
    """Clock reading at the call's first streamed text delta, or ``None`` when it streamed none."""
    usage: Usage | None = None
    """Provider-reported usage, or ``None`` when the call failed or the server reported none."""
    final_text: str | None = None
    """The call's final reply text, or ``None`` when it failed."""
    text_deltas: list[str] = field(default_factory=list)
    """The reply text the call streamed before its final."""


class _BudgetedModelClient:
    """Dispatch at most ``max_calls`` requests to the wrapped client and record each call.

    A request beyond the budget is refused with a model-client error before it
    reaches the provider; the runner then discards that turn and stops.
    """

    def __init__(self, client: ModelClient, *, max_calls: int, clock: Clock) -> None:
        self._client = client
        self._max_calls = max_calls
        self._clock = clock
        self.calls: list[_CallRecord] = []
        self.refused = False

    @property
    def native_context_compaction(self) -> bool:
        """Report the wrapped client's value so chat fits prompts exactly as it would without the budget."""

        return uses_native_context_compaction(self._client)

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        if len(self.calls) >= self._max_calls:
            self.refused = True
            raise ModelClientError("The evaluation call budget is spent", code=_BUDGET_ERROR_CODE)
        record = _CallRecord(started=self._clock())
        self.calls.append(record)
        try:
            async for delta in self._client.stream(request):
                if delta.kind == "text_delta" and delta.text:
                    if record.first_text is None:
                        record.first_text = self._clock()
                    record.text_deltas.append(delta.text)
                elif delta.kind == "final" and delta.final is not None:
                    record.final_text = delta.final.text
                    if delta.final.usage_reported:
                        record.usage = delta.final.usage
                    # The final reply has arrived; a trailing ``done`` delta adds nothing to wait for.
                    record.finished = self._clock()
                yield delta
        finally:
            if record.finished is None:
                record.finished = self._clock()

    async def aclose(self) -> None:
        """The composition closes the wrapped registry client."""


class _UnusedModelClient:
    """Registered only so chat can prepare a turn for the token estimate; it is never called."""

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        raise AssertionError("The token estimate prepares turns without calling a model")
        yield  # pragma: no cover - makes this an async generator

    async def aclose(self) -> None:
        """Nothing to close."""


class _EvalChats:
    """In-memory stand-in for ``ChatManager`` that keeps each evaluation conversation's history.

    Incognito turns are never recorded by chat, so the runner appends each
    successful turn's replay rows here and the next scripted turn reads them back.
    """

    def __init__(self) -> None:
        self._messages: dict[str, list[ChatMessage]] = {}

    async def ensure_owned_chat(
        self,
        *,
        anima_id: str,
        chat_id: str,
        user_id: str,
        api_standard: str | None = None,
        model_provider_id: str | None = None,
    ) -> Chat:
        # No Responses cursor: every turn sends its explicit visible history.
        return Chat(
            id=chat_id,
            anima_id=anima_id,
            user_id=user_id,
            api_standard=api_standard,
            last_model_provider_id=model_provider_id,
        )

    async def get_chat_context(self, *, chat_id: str, native_compaction: bool = False) -> ChatContext:
        # Evaluation chats keep no compaction, so ``native_compaction`` changes nothing.
        del native_compaction
        return ChatContext(messages=list(self._messages.get(chat_id, ())))

    async def record_turn(self, **_: Any) -> None:
        raise AssertionError("Incognito evaluation turns must never be persisted")

    def append(self, chat_id: str, rows: Sequence[ChatMessage]) -> None:
        self._messages.setdefault(chat_id, []).extend(rows)


class _NeutralMemoryContext:
    """Stand-in for ``DirectChatMemoryContextService``: the neutral identity and no memories.

    Matches what chat builds with memory influence off: no memory map and no ``MEMORIES.md``.
    """

    async def build_context(self, *, anima_id: str, **_: Any) -> DirectChatMemoryContext:
        return DirectChatMemoryContext(
            anima_identity=ANIMA_IDENTITY,
            anima_name=ANIMA_NAME,
            manifest={
                "version": MEMORY_CONTEXT_METADATA_VERSION,
                "anima_id": anima_id,
                "disable_memory_influence": True,
                "opened_files": [],
            },
        )


class _SelectedModelProvider:
    """Model-provider repository holding only the row chosen for the evaluation."""

    def __init__(self, model_provider: ModelProvider) -> None:
        self._model_provider = model_provider

    async def get(self, model_provider_id: str, *, for_update: bool = False) -> ModelProvider | None:
        return self._model_provider if model_provider_id == self._model_provider.id else None


class _NoAnimaProfile:
    """Every evaluation turn names its model, so chat never consults an Anima chat profile."""

    async def resolve_for_anima(self, anima_id: str) -> None:
        raise DirectChatTurnSetupError("The Gesture selection evaluation always names its model provider")


def _build_executor(model_provider: ModelProvider, client: ModelClient, chats: _EvalChats) -> DirectChatTurnExecutor:
    """Build chat's turn executor around the in-memory stand-ins and one model client."""

    return DirectChatTurnExecutor(
        registry=StaticModelClientRegistry({model_provider.provider_type: client}),
        profile_service=cast(AnimaChatProfileService, _NoAnimaProfile()),
        model_providers=cast(ModelProviderRepository, _SelectedModelProvider(model_provider)),
        chat_manager=cast(ChatManager, chats),
        memory_context_service=cast(DirectChatMemoryContextService, _NeutralMemoryContext()),
    )


def _turn_options(reasoning_effort: str | None) -> DirectChatOptions:
    # Incognito: store=False at the provider, no persistence and no pre-send compaction.
    # Memory influence and updates off: no memory map, MEMORIES.md or episode capture.
    return DirectChatOptions(
        incognito=True,
        disable_memory_influence=True,
        disable_memory_updates=True,
        reasoning_effort=reasoning_effort,
    )


def _turn_request(
    loadout: Loadout,
    *,
    chat_id: str,
    turn_index: int,
    message: str,
    model_provider_id: str,
    options: DirectChatOptions,
) -> DirectChatTurnRequest:
    return DirectChatTurnRequest(
        anima_id=_EVAL_ANIMA_ID,
        user_id=_EVAL_OWNER_ID,
        chat_id=chat_id,
        run_id=f"{chat_id}/t{turn_index}",
        user_message=message,
        model_provider_id=model_provider_id,
        request_options=options,
        runtime_gesture_ids=loadout.selectors,
        runtime_gesture_descriptors=loadout.gestures,
    )


# --- Running ----------------------------------------------------------------


def _usage_json(calls: Iterable[_CallRecord]) -> dict[str, int]:
    """Sum the calls' reported usage; ``unreported_calls`` counts completed calls that reported none.

    A call that failed before its final (for example an oversized prompt that
    chat then retries) reported nothing and is not counted as unreported.
    """

    totals = dict.fromkeys((*_USAGE_KEYS, "unreported_calls"), 0)
    for call in calls:
        usage = call.usage
        if usage is None:
            if call.final_text is not None:
                totals["unreported_calls"] += 1
            continue
        totals["input_tokens"] += usage.input_tokens
        totals["cached_input_tokens"] += usage.input_tokens_details.cached_tokens
        totals["cache_write_tokens"] += usage.input_tokens_details.cache_write_tokens
        totals["output_tokens"] += usage.output_tokens
        totals["reasoning_tokens"] += usage.output_tokens_details.reasoning_tokens
        totals["total_tokens"] += usage.total_tokens
    return totals


def _sum_usage_json(parts: Iterable[Mapping[str, int]]) -> dict[str, int]:
    totals = dict.fromkeys((*_USAGE_KEYS, "unreported_calls"), 0)
    for part in parts:
        for key in totals:
            totals[key] += int(part.get(key, 0))
    return totals


def _cost_json(model_provider: ModelProvider, usage: Mapping[str, int]) -> dict[str, Any]:
    """Estimate the run's cost from the catalog row's standard-tier pricing and the reported usage."""

    cost = estimate_model_token_cost(
        model_provider=model_provider,
        usage=Usage(
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            total_tokens=usage["total_tokens"],
            input_tokens_details=UsageInputDetails(
                cached_tokens=usage["cached_input_tokens"],
                cache_write_tokens=usage["cache_write_tokens"],
            ),
            output_tokens_details=UsageOutputDetails(reasoning_tokens=usage["reasoning_tokens"]),
        ),
    )
    return {
        "priced": cost.priced,
        "total": f"{cost.total_cost:.6f}" if cost.total_cost is not None else None,
        "currency": cost.currency,
        "service_tier": cost.service_tier,
        "unpriced_reason": cost.unpriced_reason,
        "unreported_calls": usage["unreported_calls"],
    }


def instruction_bytes(prompt: DirectChatPrompt) -> int:
    """UTF-8 size of a prompt's system and developer messages."""

    total = 0
    for message in prompt.messages:
        entry = cast(Mapping[str, Any], message)
        content = entry.get("content")
        if entry.get("role") in {"system", "developer"} and isinstance(content, str):
            total += len(content.encode("utf-8"))
    return total


def _salvaged_reply(text_deltas: Sequence[str]) -> MainStructuredResponse | None:
    """Rebuild the reply chat salvages from a reply's streamed text, or ``None`` when no speech streamed.

    Mirrors ``_MainStructuredResponseStreamEmitter``: chat feeds the same parser
    delta by delta, stops when the parser fails or the stream is not
    structured, and salvages only after speech reached the client.
    """

    parser = MainStructuredJsonStreamParser()
    speech_streamed = False
    for delta in text_deltas:
        try:
            events = parser.feed(delta)
        except ValueError:
            break
        speech_streamed = speech_streamed or any(
            event.response_part == MAIN_STRUCTURED_RESPONSE_PART_SPEECH and event.text for event in events
        )
        if parser.streaming_unavailable:
            break
    data = parser.salvaged_data() if speech_streamed else None
    return main_structured_response_from_data(data) if data is not None else None


def replayed_reply(
    final_texts: Sequence[str],
    output_type: type[BaseModel],
    *,
    first_reply_deltas: Sequence[str] = (),
) -> tuple[MainStructuredResponse, str, str | None] | None:
    """Return the reply a turn produced, the text chat would replay for it in history, and its recovery.

    ``final_texts`` are the turn's successful replies in call order: the first
    reply, then its structured repair when one was requested;
    ``first_reply_deltas`` is the text the first reply streamed. This follows
    the executor's order (``_recover_final_reply``): the final text when it
    validates (``"repaired"`` after a repair); then the reply salvaged from
    streamed speech, which chat keeps instead of requesting a repair; then a
    neutral plain-text reply. Salvaged and plain-text replies are replayed as
    structured JSON.
    """

    if not final_texts:
        return None
    final_text = final_texts[-1]
    try:
        reply = recover_main_structured_response(final_text, output_type)
    except ValueError:
        pass
    else:
        return reply, final_text, "repaired" if len(final_texts) > 1 else None
    # Chat salvages only the first reply: a salvaged reply is never repaired.
    salvaged = _salvaged_reply(first_reply_deltas) if len(final_texts) == 1 else None
    if salvaged is not None:
        return salvaged, render_main_structured_json(salvaged), "salvaged"
    for text in (final_text, final_texts[0]):
        plain = plain_text_main_structured_response(text)
        if plain is not None:
            return plain, render_main_structured_json(plain), "plain_text"
    return None


def _history_rows(request: DirectChatTurnRequest, replay_text: str) -> list[ChatMessage]:
    """Build the user and assistant rows chat persists for a turn, which later turns replay."""

    def row(role: MessageRole, content: str, raw_provider_message: dict[str, Any]) -> ChatMessage:
        return ChatMessage(
            id=None,
            chat_id=request.chat_id,
            run_id=request.run_id,
            message_type="message",
            role=role,
            content=content,
            data=None,
            usage=None,
            turn=None,
            created_at=None,
            raw_provider_message=raw_provider_message,
        )

    return [
        row(MessageRole.USER, request.user_message, user_provider_message(request.user_message)),
        row(MessageRole.ASSISTANT, replay_text, {"role": "assistant", "content": replay_text}),
    ]


@dataclass(slots=True)
class _Run:
    """One evaluation run's executor, collaborators and collected turns."""

    executor: DirectChatTurnExecutor
    chats: _EvalChats
    budget: _BudgetedModelClient
    model_provider: ModelProvider
    options: DirectChatOptions
    progress: TurnProgress | None
    clock: Clock
    token_prices: TokenPrices | None = None
    turns: list[dict[str, Any]] = field(default_factory=list)
    instruction_bytes: dict[str, int] = field(default_factory=dict)
    first_turn_tokens: dict[str, int] = field(default_factory=dict)

    async def turn(
        self,
        loadout: Loadout,
        *,
        repeat: int,
        kind: str,
        conversation_id: str,
        turn_index: int,
        message: str,
        acceptable: Sequence[str | None] | None = None,
    ) -> bool:
        """Run one chat turn and record what it played; return ``False`` once the call budget is spent."""

        chat_id = f"{loadout.name}/r{repeat}/{kind}/{conversation_id}"
        request = _turn_request(
            loadout,
            chat_id=chat_id,
            turn_index=turn_index,
            message=message,
            model_provider_id=self.model_provider.id,
            options=self.options,
        )
        first_call = len(self.budget.calls)
        # Latency runs from sending the turn, as chat:sse receives it, until chat's stream ends.
        sent = self.clock()
        prepared = await self.executor.prepare_turn(request)
        if loadout.name not in self.instruction_bytes:
            # Measured once per loadout, on a first turn without history.
            self.instruction_bytes[loadout.name] = instruction_bytes(prepared.model_request.prompt)
            self.first_turn_tokens[loadout.name] = estimate_prompt_tokens(prepared.model_request.prompt)
        events: list[Event] = []
        first_output: float | None = None
        async for event in self.executor.stream_prepared_turn(prepared):
            if first_output is None and _is_speech(event):
                first_output = self.clock()
            events.append(event)
        finished = self.clock()
        if self.budget.refused:
            # A turn missing a refused call (its first call or its repair) is not scored.
            return False

        # The played Gesture is the one chat validated against the loadout and sent to the avatar.
        gesture = next(
            (event.payload.gesture for event in events if event.type is EventType.AVATAR_GESTURE_REQUESTED),
            None,
        )
        error = next(
            (event.payload.code or "error" for event in events if event.type is EventType.ERROR),
            None,
        )
        calls = self.budget.calls[first_call:]
        reply: MainStructuredResponse | None = None
        recovery: str | None = None
        if error is None:
            replayed = replayed_reply(
                [call.final_text for call in calls if call.final_text is not None],
                prepared.output_type,
                first_reply_deltas=calls[0].text_deltas if calls else (),
            )
            if replayed is not None:
                reply, replay_text, recovery = replayed
                # Chat persists nothing for an incognito turn, so the runner keeps the history it would replay.
                self.chats.append(chat_id, _history_rows(request, replay_text))
        replayed_gesture = (reply.gesture or None) if reply is not None else None
        usage = _usage_json(calls)
        record: dict[str, Any] = {
            "loadout": loadout.name,
            "repeat": repeat,
            "kind": kind,
            "conversation_id": conversation_id,
            "turn": turn_index,
            "gesture": gesture,
            "replayed_gesture": replayed_gesture,
            # True when the played Gesture differs from the replayed reply's, for example a selector
            # outside the loadout that chat dropped.
            "gesture_mismatch": error is None and replayed_gesture != gesture,
            "fit": score_fit(gesture, acceptable) if acceptable is not None and error is None else None,
            "emotional_tone": reply.emotional_tone if reply is not None else None,
            "emotional_intensity": reply.emotional_intensity if reply is not None else None,
            "speech": reply.speech if reply is not None else None,
            "structured_recovery": recovery,
            "error": error,
            "calls": len(calls),
            "usage": usage,
            "estimated_cost_usd": (
                float(self.token_prices.cost(usage))
                if self.token_prices is not None and not usage["unreported_calls"]
                else None
            ),
            "latency_seconds": _seconds(finished - sent),
            "first_output_seconds": _seconds(first_output - sent) if first_output is not None else None,
            "call_latencies": [_call_latency(call) for call in calls],
        }
        self.turns.append(record)
        if self.progress is not None:
            self.progress(record)
        return True


def _is_speech(event: Event) -> bool:
    """Whether the event carries spoken reply text, the first output a listener hears."""

    payload = event.payload
    return (
        event.type is EventType.USER_RESPONSE
        and isinstance(payload, UserResponsePayload)
        and payload.response_part == MAIN_STRUCTURED_RESPONSE_PART_SPEECH
        and bool(payload.value)
    )


def _seconds(value: float) -> float:
    return round(value, 4)


def _call_latency(call: _CallRecord) -> dict[str, float | None]:
    """One model call's duration and its time to the first streamed text delta (``None`` when none streamed)."""

    finished = call.finished if call.finished is not None else call.started
    return {
        "seconds": _seconds(finished - call.started),
        "first_text_seconds": _seconds(call.first_text - call.started) if call.first_text is not None else None,
    }


def check_budget(plan: EvalPlan, max_calls: int) -> None:
    """Raise ``CallBudgetExceeded`` when the plan's estimate exceeds ``max_calls``."""

    if plan.estimated_calls > max_calls:
        raise CallBudgetExceeded(
            f"The plan needs {plan.estimated_calls} model calls, more than --max-calls {max_calls}"
        )


async def run_evaluation(
    plan: EvalPlan,
    *,
    model_provider: ModelProvider,
    registry: ModelClientRegistry,
    max_calls: int,
    reasoning_effort: str | None = None,
    progress: TurnProgress | None = None,
    on_finish: ResultsSink | None = None,
    clock: Clock = time.monotonic,
    token_prices: TokenPrices | None = None,
) -> dict[str, Any]:
    """Run the plan through chat's turn executor and return the result document.

    Raises ``CallBudgetExceeded`` before any call when the estimate exceeds
    ``max_calls``. A structured repair that would pass the budget is refused;
    the run then stops and the result records ``aborted: "max_calls"``.
    ``on_finish`` receives the result document even when the run fails
    (``aborted: "error: <type>"``) or is cancelled (``aborted: "interrupted"``).
    ``clock`` times turns and model calls; turns run one after another, so
    their latencies do not overlap. ``token_prices`` adds a cost estimate per
    turn and for the run from published rates.
    """

    check_budget(plan, max_calls)
    client = registry.get(model_provider.provider_type)
    if client is None:
        raise ModelClientNotFoundError(f"No model client registered for provider type {model_provider.provider_type!r}")
    budget = _BudgetedModelClient(client, max_calls=max_calls, clock=clock)
    chats = _EvalChats()
    run = _Run(
        executor=_build_executor(model_provider, budget, chats),
        chats=chats,
        budget=budget,
        model_provider=model_provider,
        options=_turn_options(reasoning_effort),
        progress=progress,
        clock=clock,
        token_prices=token_prices,
    )
    started_at = datetime.now(UTC)
    # Anything that is not an ordinary exception (cancellation, Ctrl-C) leaves this value.
    aborted: str | None = "interrupted"
    try:
        aborted = None if await _run_plan(run, plan) else "max_calls"
    except Exception as exc:
        aborted = f"error: {exc.__class__.__name__}"
        raise
    finally:
        results = _results_document(
            plan,
            run,
            model_provider=model_provider,
            native_context_compaction=uses_native_context_compaction(client),
            reasoning_effort=reasoning_effort,
            max_calls=max_calls,
            aborted=aborted,
            started_at=started_at,
        )
        if on_finish is not None:
            on_finish(results)
    return results


def _results_document(
    plan: EvalPlan,
    run: _Run,
    *,
    model_provider: ModelProvider,
    native_context_compaction: bool,
    reasoning_effort: str | None,
    max_calls: int,
    aborted: str | None,
    started_at: datetime,
) -> dict[str, Any]:
    usage = _usage_json(run.budget.calls)
    return {
        "schema": RESULT_SCHEMA,
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "model": {
            "model_provider_id": model_provider.id,
            "provider_type": model_provider.provider_type,
            "model": model_provider.model,
            "connection_id": model_provider.connection_id,
            "reasoning_effort": reasoning_effort,
            "native_context_compaction": native_context_compaction,
        },
        "anima": {"name": ANIMA_NAME, "identity": ANIMA_IDENTITY, "memory_influence": False},
        "incognito": True,
        "prompt_set": {
            "items": len(plan.prompt_set.items),
            "scripted_chats": len(plan.prompt_set.scripted_chats),
            "scripted_turns": plan.prompt_set.scripted_turns,
        },
        "repeats": plan.repeats,
        "scripted_repeats": plan.scripted_repeats,
        "calls": {"estimated": plan.estimated_calls, "max": max_calls, "made": len(run.budget.calls)},
        "aborted": aborted,
        "usage": usage,
        "cost": _cost_json(model_provider, usage),
        "price_estimate": (
            {
                "rates_per_million_usd": run.token_prices.as_json(),
                "total_usd": float(run.token_prices.cost(usage)),
                "unreported_calls": usage["unreported_calls"],
            }
            if run.token_prices is not None
            else None
        ),
        "loadouts": [_loadout_summary(loadout, plan, run) for loadout in plan.loadouts],
        "turns": run.turns,
    }


async def _run_plan(run: _Run, plan: EvalPlan) -> bool:
    """Run every item and scripted chat, alternating loadouts; return ``False`` if the budget stopped the run."""

    for repeat in range(1, plan.repeats + 1):
        for item in plan.prompt_set.items:
            for loadout in plan.loadouts:
                if not await run.turn(
                    loadout,
                    repeat=repeat,
                    kind="single",
                    conversation_id=item.id,
                    turn_index=1,
                    message=item.message,
                    acceptable=item.acceptable,
                ):
                    return False
    for repeat in range(1, plan.scripted_repeats + 1):
        for chat in plan.prompt_set.scripted_chats:
            for loadout in plan.loadouts:
                for turn_index, message in enumerate(chat.turns, start=1):
                    if not await run.turn(
                        loadout,
                        repeat=repeat,
                        kind="scripted",
                        conversation_id=chat.id,
                        turn_index=turn_index,
                        message=message,
                    ):
                        return False
    return True


def _rate(count: int, total: int) -> float | None:
    return count / total if total else None


def _p90(values: Sequence[float]) -> float:
    """Nearest-rank 90th percentile: the smallest value at or above 90% of the sorted values."""

    ordered = sorted(values)
    return ordered[math.ceil(0.9 * len(ordered)) - 1]


def _distribution(values: Sequence[float], digits: int = 4) -> dict[str, float | None]:
    if not values:
        return {"median": None, "p90": None, "mean": None}
    return {
        "median": round(statistics.median(values), digits),
        "p90": round(_p90(values), digits),
        "mean": round(statistics.fmean(values), digits),
    }


_TOKEN_STAT_KEYS = ("input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens", "reasoning_tokens")


def _token_summary(turns: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Per-turn token and estimated-cost statistics over successful turns whose every call reported usage.

    A turn's tokens sum all of its calls, a structured repair included.
    """

    reported = [turn for turn in turns if not turn["usage"]["unreported_calls"]]
    summary: dict[str, Any] = {"turns": len(reported), "unreported_turns": len(turns) - len(reported)}
    for key in _TOKEN_STAT_KEYS:
        values = [turn["usage"][key] for turn in reported]
        summary[key] = {"total": sum(values), **_distribution(values, digits=1)}
    costs = [turn["estimated_cost_usd"] for turn in reported if turn.get("estimated_cost_usd") is not None]
    summary["estimated_cost_usd"] = {"total": round(sum(costs), 8), **_distribution(costs, digits=8)} if costs else None
    return summary


def _latency_summary(turns: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Latency, first-token and first-speech statistics, in seconds, over successful turns."""

    first_tokens = [
        turn["call_latencies"][0]["first_text_seconds"]
        for turn in turns
        if turn["call_latencies"] and turn["call_latencies"][0]["first_text_seconds"] is not None
    ]
    first_outputs = [turn["first_output_seconds"] for turn in turns if turn["first_output_seconds"] is not None]
    return {
        "turns": len(turns),
        "latency_seconds": _distribution([turn["latency_seconds"] for turn in turns]),
        "first_token_seconds": {"turns": len(first_tokens), **_distribution(first_tokens)},
        "first_output_seconds": {"turns": len(first_outputs), **_distribution(first_outputs)},
    }


def _loadout_summary(loadout: Loadout, plan: EvalPlan, run: _Run) -> dict[str, Any]:
    items = {item.id: item for item in plan.prompt_set.items}
    turns = [turn for turn in run.turns if turn["loadout"] == loadout.name]
    single = [turn for turn in turns if turn["kind"] == "single"]
    scored = [turn for turn in single if turn["error"] is None]
    fits = sum(1 for turn in scored if turn["fit"])
    nulls = sum(1 for turn in scored if turn["gesture"] is None)
    by_tag: dict[str, dict[str, Any]] = {}
    for tag in sorted({tag for item in items.values() for tag in item.tags}):
        tagged = [turn for turn in scored if tag in items[turn["conversation_id"]].tags]
        tag_fits = sum(1 for turn in tagged if turn["fit"])
        by_tag[tag] = {"scored": len(tagged), "fits": tag_fits, "fit_rate": _rate(tag_fits, len(tagged))}
    scripted_scored = [turn for turn in turns if turn["kind"] == "scripted" and turn["error"] is None]
    scripted: list[dict[str, Any]] = []
    for chat in plan.prompt_set.scripted_chats:
        for repeat in range(1, plan.scripted_repeats + 1):
            chat_turns = [
                turn
                for turn in turns
                if turn["kind"] == "scripted" and turn["conversation_id"] == chat.id and turn["repeat"] == repeat
            ]
            if not chat_turns:
                continue
            # A failed turn plays no Gesture, so it also ends a run.
            gestures = [turn["gesture"] for turn in chat_turns]
            run_length, run_gesture = longest_run(gestures)
            errors = sum(1 for turn in chat_turns if turn["error"] is not None)
            scripted.append(
                {
                    "chat": chat.id,
                    "repeat": repeat,
                    "turns": len(chat_turns),
                    "scored": len(chat_turns) - errors,
                    "errors": errors,
                    "nulls": sum(1 for turn in chat_turns if turn["error"] is None and turn["gesture"] is None),
                    "distinct_gestures": distinct_gestures(gestures),
                    "longest_run": run_length,
                    "longest_run_gesture": run_gesture,
                }
            )
    return {
        "name": loadout.name,
        "gesture_count": len(loadout.gestures),
        "gesture_list_bytes": gesture_list_bytes(loadout),
        "instruction_bytes": run.instruction_bytes.get(loadout.name),
        "estimated_first_turn_input_tokens": run.first_turn_tokens.get(loadout.name),
        "coverable_items": coverable_items(loadout, items.values()),
        "single_turn": {
            "runs": len(single),
            "scored": len(scored),
            "errors": len(single) - len(scored),
            "fits": fits,
            "fit_rate": _rate(fits, len(scored)),
            "nulls": nulls,
            "null_rate": _rate(nulls, len(scored)),
            "by_tag": by_tag,
        },
        "scripted": scripted,
        "latency": {"single_turn": _latency_summary(scored), "scripted": _latency_summary(scripted_scored)},
        "tokens": {"single_turn": _token_summary(scored), "scripted": _token_summary(scripted_scored)},
        "calls": sum(turn["calls"] for turn in turns),
        "usage": _sum_usage_json(turn["usage"] for turn in turns),
    }


async def estimate_first_turn_tokens(plan: EvalPlan) -> dict[str, int]:
    """Return chat's conservative input-token estimate for each loadout's first turn, without a model call.

    The prompt is prepared for a built-in JSON-schema model; JSON-mode and
    prompt-only models also carry the reply schema in the prompt.
    """

    chats = _EvalChats()
    executor = _build_executor(_ESTIMATE_MODEL_PROVIDER, _UnusedModelClient(), chats)
    message = next(
        (item.message for item in plan.prompt_set.items),
        plan.prompt_set.scripted_chats[0].turns[0] if plan.prompt_set.scripted_chats else "",
    )
    estimates: dict[str, int] = {}
    for loadout in plan.loadouts:
        request = _turn_request(
            loadout,
            chat_id=f"estimate/{loadout.name}",
            turn_index=1,
            message=message,
            model_provider_id=_ESTIMATE_MODEL_PROVIDER.id,
            options=_turn_options(None),
        )
        prepared = await executor.prepare_turn(request)
        estimates[loadout.name] = estimate_prompt_tokens(prepared.model_request.prompt)
    return estimates


# --- Outputs ----------------------------------------------------------------


def _percent(rate: float | None, count: int, total: int) -> str:
    return "n/a" if rate is None else f"{rate * 100:.1f}% ({count}/{total})"


def render_summary(results: Mapping[str, Any]) -> str:
    """Render the short markdown summary: rates, sizes, repetition, tokens and cost, never prompts or replies."""

    model = results["model"]
    prompt_set = results["prompt_set"]
    calls = results["calls"]
    usage = results["usage"]
    cost = results["cost"]
    lines = [
        "# Gesture selection evaluation",
        "",
        f"- Model: `{model['model_provider_id']}`; reasoning effort: {model['reasoning_effort'] or 'model default'}",
        f"- Prompt set: {prompt_set['items']} single-turn items ({results['repeats']} repeat(s) per loadout) and "
        f"{prompt_set['scripted_chats']} scripted chats of {prompt_set['scripted_turns']} turns in total "
        f"({results['scripted_repeats']} repeat(s) per loadout)",
        f"- Calls: {calls['made']} made; estimate {calls['estimated']}, budget {calls['max']}",
        f"- Tokens: {usage['input_tokens']:,} input ({usage['cached_input_tokens']:,} cached), "
        f"{usage['output_tokens']:,} output ({usage['reasoning_tokens']:,} reasoning)"
        + (f"; {usage['unreported_calls']} call(s) reported no usage" if usage["unreported_calls"] else ""),
        "- Estimated cost: "
        + (
            f"{cost['total']} {cost['currency']} at catalog {cost['service_tier']} rates"
            if cost["priced"]
            else f"unpriced ({cost['unpriced_reason']})"
        ),
    ]
    price_estimate = results.get("price_estimate")
    if price_estimate:
        rates = price_estimate["rates_per_million_usd"]
        lines.append(
            f"- Estimated cost from the --price rates: {price_estimate['total_usd']:.6f} USD (USD per 1M tokens: "
            f"input {rates['input']}, cached input {rates['cached_input']}, cache write {rates['cache_write']}, "
            f"output {rates['output']}; an estimate from published rates, billing is authoritative)"
            + (
                f"; {price_estimate['unreported_calls']} call(s) reported no usage"
                if price_estimate["unreported_calls"]
                else ""
            )
        )
    if results["aborted"] == "max_calls":
        lines.append("- **Stopped early:** the call budget was spent, so later turns are missing.")
    elif results["aborted"]:
        lines.append(f"- **Stopped early** ({results['aborted']}), so later turns are missing.")
    lines += [
        "",
        "## Single-turn selection",
        "",
        "| Loadout | Gestures | Gesture-list bytes | Instruction bytes | Fit rate | Null rate | Errors | "
        "Coverable items |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for loadout in results["loadouts"]:
        single = loadout["single_turn"]
        lines.append(
            f"| {loadout['name']} | {loadout['gesture_count']} | {loadout['gesture_list_bytes']} | "
            f"{loadout['instruction_bytes'] if loadout['instruction_bytes'] is not None else 'n/a'} | "
            f"{_percent(single['fit_rate'], single['fits'], single['scored'])} | "
            f"{_percent(single['null_rate'], single['nulls'], single['scored'])} | {single['errors']} | "
            f"{loadout['coverable_items']}/{prompt_set['items']} |"
        )
    lines += [
        "",
        "A turn fits when its Gesture is acceptable for the item; no Gesture fits only where null is acceptable. "
        "Rates exclude failed turns. Coverable items have an acceptable Gesture equipped or accept null. "
        "Gesture-list bytes measure the equipped list in the system prompt; instruction bytes measure the "
        "system and developer messages of a first turn (since 2026-10-25 the system message alone: incognito "
        "turns have no turn context and the guardrails are no longer repeated there, so earlier runs are about "
        "300 tokens larger).",
    ]
    scripted_rows = [(loadout["name"], row) for loadout in results["loadouts"] for row in loadout["scripted"]]
    if scripted_rows:
        lines += [
            "",
            "## Scripted chats",
            "",
            "| Loadout | Chat | Repeat | Turns | Distinct Gestures | Longest run | No Gesture | Errors |",
            "|---|---|---:|---:|---:|---|---:|---:|",
        ]
        for name, row in scripted_rows:
            longest = f"{row['longest_run']} ({row['longest_run_gesture']})" if row["longest_run_gesture"] else "0"
            lines.append(
                f"| {name} | {row['chat']} | {row['repeat']} | {row['turns']} | {row['distinct_gestures']} | "
                f"{longest} | {row['nulls']} | {row['errors']} |"
            )
    lines += _latency_lines(results["loadouts"])
    lines += _token_lines(results["loadouts"])
    return "\n".join(lines) + "\n"


_TOKEN_ROW_LABELS = {
    "input_tokens": "Input tokens",
    "cached_input_tokens": "Cached input tokens",
    "cache_write_tokens": "Cache-write tokens",
    "output_tokens": "Output tokens",
    "reasoning_tokens": "Reasoning tokens",
}


def _token_lines(loadouts: Sequence[Mapping[str, Any]]) -> list[str]:
    """Render per-turn token and cost statistics; older results have none."""

    rows: list[str] = []
    unreported = 0
    for loadout in loadouts:
        tokens = loadout.get("tokens")
        if tokens is None:
            continue
        for label, key in (("Single-turn", "single_turn"), ("Scripted", "scripted")):
            part = tokens[key]
            unreported += part["unreported_turns"]
            if not part["turns"]:
                continue
            prefix = f"| {loadout['name']} | {label} | {part['turns']} |"
            for stat_key, row_label in _TOKEN_ROW_LABELS.items():
                stats = part[stat_key]
                if stat_key == "reasoning_tokens" and not stats["total"]:
                    rows.append(f"{prefix} {row_label} | none reported | | | |")
                    continue
                cells = [_format_count(stats[name]) for name in ("total", "median", "p90", "mean")]
                rows.append(f"{prefix} {row_label} | " + " | ".join(cells) + " |")
            cost = part["estimated_cost_usd"]
            if cost is not None:
                cells = [f"{cost[name]:.6f}" for name in ("total", "median", "p90", "mean")]
                rows.append(f"{prefix} Estimated cost (USD) | " + " | ".join(cells) + " |")
    if not rows:
        if not unreported:
            return []
        return [
            "",
            "## Tokens and cost per turn",
            "",
            f"Omitted: no successful turn reported usage ({unreported} turn(s) without usage).",
        ]
    return [
        "",
        "## Tokens and cost per turn",
        "",
        "| Loadout | Kind | Turns | Measure | Total | Median | p90 | Mean |",
        "|---|---|---:|---|---:|---:|---:|---:|",
        *rows,
        "",
        "Per successful turn whose calls all reported usage; a turn sums all of its calls, a structured repair "
        'included. Cached input and cache writes are part of input; reasoning is part of output. "None '
        'reported" means the provider reported no reasoning tokens for the group: none were used, or the '
        "provider does not report them. Costs are estimated from the --price rates; billing is authoritative.",
    ]


def _format_count(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:,.0f}" if float(value).is_integer() else f"{value:,.1f}"


def _latency_lines(loadouts: Sequence[Mapping[str, Any]]) -> list[str]:
    """Render the latency table; results written before latency was recorded have none."""

    rows: list[str] = []
    for loadout in loadouts:
        latency = loadout.get("latency")
        if latency is None:
            continue
        for label, key in (("Single-turn", "single_turn"), ("Scripted", "scripted")):
            part = latency[key]
            if not part["turns"]:
                continue
            cells = _stat_cells(part["latency_seconds"], part["turns"], part["turns"])
            # Results written before first-token timing was recorded have no first-token block.
            for key in ("first_token_seconds", "first_output_seconds"):
                stats = part.get(key)
                cells += _stat_cells(stats, stats["turns"], part["turns"]) if stats else ["n/a"] * 3
            rows.append(f"| {loadout['name']} | {label} | {part['turns']} | " + " | ".join(cells) + " |")
    if not rows:
        return []
    return [
        "",
        "## Latency",
        "",
        "| Loadout | Kind | Turns | Median s | p90 s | Mean s | First token median s | First token p90 s | "
        "First token mean s | First speech median s | First speech p90 s | First speech mean s |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        *rows,
        "",
        "Wall-clock seconds from sending a turn until chat's reply stream ends, over successful turns; a turn "
        "with a structured repair or context retry includes every call. First token is the provider's time to "
        "the first streamed text of the turn's first call; first speech is the time to chat's first spoken "
        "sentence. Each covers the turns where it was observed; (n=…) gives that count when it is smaller than "
        "Turns. p90 is the nearest-rank 90th percentile.",
    ]


def _stat_cells(stats: Mapping[str, Any], count: int, turns: int) -> list[str]:
    """Format median, p90 and mean seconds, noting the count on the median when fewer turns were observed."""

    cells = [_format_seconds(stats[name]) for name in ("median", "p90", "mean")]
    if count < turns:
        cells[0] += f" (n={count})"
    return cells


def _format_seconds(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def write_outputs(results: Mapping[str, Any], output_dir: Path) -> tuple[Path, Path]:
    """Write ``results.json`` and ``summary.md`` into ``output_dir``."""

    output_dir.mkdir(parents=True, exist_ok=True)
    results_path = output_dir / "results.json"
    summary_path = output_dir / "summary.md"
    results_path.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    summary_path.write_text(render_summary(results), encoding="utf-8")
    return results_path, summary_path


# --- Composition and CLI -----------------------------------------------------


@asynccontextmanager
async def _read_only_model_providers() -> AsyncIterator[ModelProviderRepository]:
    """Open the application database's model catalog in a read-only transaction."""

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
    from animama.local.database import dispose_engine, get_engine

    engine = get_engine()
    try:
        async with async_sessionmaker(engine)() as session:
            await session.execute(text("SET TRANSACTION READ ONLY"))
            yield SQLAlchemyModelProviderRepository(session)
    finally:
        await dispose_engine(engine=engine)


async def load_model_provider(model_provider_id: str) -> ModelProvider:
    """Read the selected catalog row with its connection, as chat does for a requested model."""

    async with _read_only_model_providers() as model_providers:
        model_provider = await model_providers.get(model_provider_id)
    if model_provider is None:
        raise EvalInputError(f"Model provider not found: {model_provider_id} (see --list-models)")
    return model_provider


def build_registry() -> StaticModelClientRegistry:
    """Build chat's shared model clients; each request reads its connection's key from the credential store."""

    from animama.server.model_clients import build_model_client_registry

    return build_model_client_registry()


async def _list_models() -> int:
    async with _read_only_model_providers() as model_providers:
        rows = await model_providers.list_active()
    for row in rows:
        if row.model_kind == MODEL_KIND_CHAT:
            connection = row.connection.name if row.connection is not None else row.connection_id
            print(f"{row.id}\t{row.model_label}\t{connection}")
    return 0


async def _run(
    plan: EvalPlan,
    *,
    model_provider_id: str,
    max_calls: int,
    reasoning_effort: str | None,
    on_finish: ResultsSink | None = None,
    token_prices: TokenPrices | None = None,
) -> dict[str, Any]:
    model_provider = await load_model_provider(model_provider_id)
    registry = build_registry()
    try:
        return await run_evaluation(
            plan,
            model_provider=model_provider,
            registry=registry,
            max_calls=max_calls,
            reasoning_effort=reasoning_effort,
            progress=_print_progress,
            on_finish=on_finish,
            token_prices=token_prices,
        )
    finally:
        await registry.aclose()


def _print_progress(turn: Mapping[str, Any]) -> None:
    if turn["error"] is not None:
        outcome = f"error {turn['error']}"
    else:
        outcome = turn["gesture"] or "no gesture"
        if turn["fit"] is not None:
            outcome += " (fit)" if turn["fit"] else " (miss)"
    outcome += f" in {turn['latency_seconds']:.2f}s"
    print(
        f"[{turn['loadout']} r{turn['repeat']}] {turn['conversation_id']} #{turn['turn']}: {outcome}",
        file=sys.stderr,
    )


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.evals.gesture_selection",
        description=(
            "Measure how well the chat model picks Gestures from a loadout. Turns run incognito "
            "(the provider stores nothing) with memory influence off: no memory map or memory tools."
        ),
    )
    parser.add_argument("--loadout", action="append", type=Path, default=[], help="loadout JSON file (repeatable)")
    parser.add_argument("--prompts", type=Path, help="prompt-set JSON file")
    parser.add_argument("--model-provider-id", help="model catalog row id to evaluate")
    parser.add_argument("--repeats", type=_positive_int, default=1, help="runs of each single-turn item per loadout")
    parser.add_argument("--scripted-repeats", type=_positive_int, default=1, help="runs of each scripted chat")
    parser.add_argument("--max-calls", type=_positive_int, help="hard limit on model calls, repairs included")
    parser.add_argument("--reasoning-effort", help="reasoning effort, as a chat setting would request it")
    parser.add_argument(
        "--price",
        help="published USD rates per 1M tokens for cost estimates: input=…,cached_input=…,cache_write=…,output=…",
    )
    parser.add_argument("--output-dir", type=Path, help="directory for results.json and summary.md")
    parser.add_argument("--dry-run", action="store_true", help="print the plan and estimates without calling a model")
    parser.add_argument("--list-models", action="store_true", help="print the active chat model rows and exit")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        if args.list_models:
            return asyncio.run(_list_models())
        if not args.loadout or args.prompts is None:
            print("error: --loadout and --prompts are required", file=sys.stderr)
            return 2
        loadouts = tuple(load_loadout(path) for path in args.loadout)
        _require_unique((loadout.name for loadout in loadouts), "loadout file names")
        prompt_set = load_prompt_set(args.prompts)
        plan = EvalPlan(
            loadouts=loadouts, prompt_set=prompt_set, repeats=args.repeats, scripted_repeats=args.scripted_repeats
        )
        print(
            render_plan(plan, max_calls=args.max_calls, first_turn_tokens=asyncio.run(estimate_first_turn_tokens(plan)))
        )
        token_prices = parse_token_prices(args.price) if args.price is not None else None
        if args.dry_run:
            return 0
        if args.model_provider_id is None or args.max_calls is None:
            print("error: --model-provider-id and --max-calls are required for a run", file=sys.stderr)
            return 2
        # Checked before the database or any model client is touched.
        check_budget(plan, args.max_calls)
        output_dir = args.output_dir or Path(tempfile.gettempdir()) / "animama-evals" / (
            f"gesture-selection-{datetime.now(UTC):%Y%m%dT%H%M%SZ}"
        )
        if (output_dir / "results.json").exists():
            print(f"error: {output_dir} already holds results; choose a new --output-dir", file=sys.stderr)
            return 2
        # Hashes of the bytes loaded above, not of the files as they are after the run.
        inputs = {
            "loadouts": [
                {"name": loadout.name, "path": str(path), "sha256": loadout.sha256}
                for loadout, path in zip(loadouts, args.loadout, strict=True)
            ],
            "prompt_set": {"path": str(args.prompts), "sha256": prompt_set.sha256},
        }

        def finish(results: dict[str, Any]) -> None:
            results["inputs"] = inputs
            results_path, summary_path = write_outputs(results, output_dir)
            print(f"\nResults: {results_path}\nSummary: {summary_path}")

        results = asyncio.run(
            _run(
                plan,
                model_provider_id=args.model_provider_id,
                max_calls=args.max_calls,
                reasoning_effort=args.reasoning_effort,
                on_finish=finish,
                token_prices=token_prices,
            )
        )
    except (EvalInputError, CallBudgetExceeded, DirectChatTurnSetupError, ModelClientNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Interrupted; any partial results were written.", file=sys.stderr)
        return 130
    return 0 if results["aborted"] is None else 1


if __name__ == "__main__":
    raise SystemExit(main())
