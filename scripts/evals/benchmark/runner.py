"""The benchmark's core-turn and long-chat run loop (spec R2, R4, R14, R15).

Every turn goes through chat's turn executor with the in-memory stand-ins:
the real prompt assembly, structured reply schema, repair and salvage, and
Gesture validation. Calls run one at a time. Each configuration first sends
one warm-up turn, recorded but never measured; then the configurations take
turns item by item, persona by persona, and scripted chats turn by turn, so a
run stopped at its cap leaves every configuration with comparable coverage.
One budget caps the calls and spend of every configuration together.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from typing import Any

from animama.app.chat import DirectChatTurnExecutor, ModelClientNotFoundError
from animama.app.chat.direct_turn.types import PreparedDirectChatTurn
from animama.app.model_clients import ModelClientRegistry, uses_native_context_compaction
from animama.app.model_clients.context_budget import estimate_prompt_tokens

from ..core.chat import EvalChats, StaticMemoryContext, build_executor, instruction_bytes, turn_request
from ..core.model_calls import BudgetedModelClient, CallBudget, CallPrice, Clock, call_latency, seconds
from ..core.pricing import usage_json
from ..core.turns import execute_turn
from .configs import Configuration
from .measures import recovery_path
from .options import PROVIDER_MODERATION, core_turn_options
from .prompt_set import Persona, PromptSet
from .speech_checks import check_speech

__all__ = ["WARMUP_MESSAGE", "RunCaps", "RunOutcome", "TurnSink", "run_benchmark"]

WARMUP_MESSAGE = "Hi! How's your day going?"
_OWNER_ID = "model-benchmark-owner"

TurnSink = Callable[[dict[str, Any]], None]


@dataclass(frozen=True, slots=True)
class RunCaps:
    """The owner-approved hard caps for one run: model calls, and estimated USD when priced."""

    max_calls: int
    max_usd: Decimal | None = None


@dataclass(slots=True)
class RunOutcome:
    """How the run ended and what it spent; the turns themselves went to the sink."""

    aborted: str | None = "interrupted"
    """``None`` for a complete run, ``max_calls`` or ``max_usd`` at a cap, else ``error: <type>`` or ``interrupted``."""
    calls: int = 0
    spent_usd: Decimal = Decimal(0)
    turns: int = 0
    prompts: dict[str, dict[str, Any]] = field(default_factory=dict)
    """Per configuration, persona and language: the first turn's instruction bytes and estimated input tokens."""
    served_models: dict[str, list[str]] = field(default_factory=dict)
    native_context_compaction: dict[str, bool] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class _Unit:
    """One turn to send: what it is, who speaks, and in which language."""

    kind: str
    unit_id: str
    area: str
    language: str
    persona: Persona
    message: str
    repeat: int
    turn: int = 1
    pair_id: str | None = None
    held_out: bool = False
    tags: tuple[str, ...] = ()
    acceptable: tuple[str | None, ...] | None = None


def _units(prompt_set: PromptSet, *, repeats: int, scripted_repeats: int) -> list[_Unit]:
    """The units in run order; every configuration takes each unit before the next one is sent."""

    units: list[_Unit] = []
    for repeat in range(1, repeats + 1):
        for item in prompt_set.items:
            for persona in prompt_set.personas:
                unit = _Unit(
                    kind="single",
                    unit_id=item.id,
                    area=item.area,
                    language=item.language,
                    persona=persona,
                    message=item.message,
                    repeat=repeat,
                    pair_id=item.pair_id,
                    held_out=item.held_out,
                    tags=item.tags,
                    acceptable=item.acceptable,
                )
                units.append(unit)
    for repeat in range(1, scripted_repeats + 1):
        for chat in prompt_set.scripted_chats:
            persona = prompt_set.persona(chat.persona)
            for index, message in enumerate(chat.turns, start=1):
                unit = _Unit(
                    kind="chat",
                    unit_id=chat.id,
                    area=chat.area,
                    language=chat.language,
                    persona=persona,
                    message=message,
                    repeat=repeat,
                    turn=index,
                    pair_id=chat.pair_id,
                    held_out=chat.held_out,
                )
                units.append(unit)
    return units


def planned_turns(prompt_set: PromptSet, *, repeats: int, scripted_repeats: int) -> int:
    """Turns per configuration, its warm-up included."""

    return 1 + len(_units(prompt_set, repeats=repeats, scripted_repeats=scripted_repeats))


@dataclass(slots=True)
class _Contestant:
    """One configuration's budgeted client and its executors, one per persona."""

    configuration: Configuration
    client: BudgetedModelClient
    executors: dict[str, DirectChatTurnExecutor]


def _anima_id(persona: Persona) -> str:
    return f"model-benchmark-anima-{persona.id}"


async def run_benchmark(
    prompt_set: PromptSet,
    configurations: Sequence[Configuration],
    *,
    registry: ModelClientRegistry,
    caps: RunCaps,
    prices: Mapping[str, CallPrice | None],
    sink: TurnSink,
    repeats: int = 1,
    scripted_repeats: int = 1,
    clock: Clock = time.monotonic,
    progress: TurnSink | None = None,
    outcome: RunOutcome | None = None,
) -> RunOutcome:
    """Run every configuration over the prompt set and send each finished turn to ``sink``.

    ``prices`` maps each configuration's label to its call price; a cap on USD
    needs every configuration priced. The run fills ``outcome`` as it goes, so
    a caller that passes one still has the calls, spend and abort reason when
    the run stops at a cap, fails or is cancelled.
    """

    if caps.max_usd is not None:
        unpriced = [configuration.label for configuration in configurations if prices.get(configuration.label) is None]
        if unpriced:
            raise ValueError(f"A USD cap needs prices for every configuration; unpriced: {', '.join(unpriced)}")
    budget = CallBudget(max_calls=caps.max_calls, max_usd=caps.max_usd)
    chats = EvalChats()
    outcome = outcome if outcome is not None else RunOutcome()
    try:
        contestants = _contestants(configurations, registry, budget, prices, prompt_set, chats, outcome, clock)
        warmup = _Unit(
            kind="warmup",
            unit_id="warmup",
            area="core",
            language="en",
            persona=prompt_set.personas[0],
            message=WARMUP_MESSAGE,
            repeat=1,
        )
        units = [warmup, *_units(prompt_set, repeats=repeats, scripted_repeats=scripted_repeats)]
        stopped = False
        for unit in units:
            for contestant in contestants:
                if not await _turn(contestant, unit, prompt_set, chats, outcome, sink, progress, clock):
                    stopped = True
                    break
            if stopped:
                break
        outcome.aborted = budget.refused if stopped else None
    except Exception as exc:
        outcome.aborted = f"error: {exc.__class__.__name__}"
        raise
    finally:
        outcome.calls = budget.calls
        outcome.spent_usd = budget.spent_usd
    return outcome


def _contestants(
    configurations: Sequence[Configuration],
    registry: ModelClientRegistry,
    budget: CallBudget,
    prices: Mapping[str, CallPrice | None],
    prompt_set: PromptSet,
    chats: EvalChats,
    outcome: RunOutcome,
    clock: Clock,
) -> list[_Contestant]:
    contestants: list[_Contestant] = []
    for configuration in configurations:
        row = configuration.model_provider
        client = registry.get(row.provider_type)
        if client is None:
            raise ModelClientNotFoundError(f"No model client registered for provider type {row.provider_type!r}")
        budgeted = BudgetedModelClient(client, clock=clock, budget=budget, price=prices.get(configuration.label))
        contestants.append(
            _Contestant(
                configuration=configuration,
                client=budgeted,
                executors={
                    persona.id: build_executor(
                        row,
                        budgeted,
                        chats,
                        memory_context=StaticMemoryContext(identity=persona.identity, name=persona.name),
                    )
                    for persona in prompt_set.personas
                },
            )
        )
        outcome.native_context_compaction[configuration.label] = uses_native_context_compaction(client)
    return contestants


async def _turn(
    contestant: _Contestant,
    unit: _Unit,
    prompt_set: PromptSet,
    chats: EvalChats,
    outcome: RunOutcome,
    sink: TurnSink,
    progress: TurnSink | None,
    clock: Clock,
) -> bool:
    """Send one unit for one configuration; return ``False`` once the budget refused a call."""

    configuration = contestant.configuration
    language = core_turn_options(unit.language, configuration.effort)
    chat_id = f"{configuration.label}/{unit.persona.id}/{unit.kind}/{unit.unit_id}/r{unit.repeat}"
    request = turn_request(
        prompt_set.loadout.gestures,
        anima_id=_anima_id(unit.persona),
        user_id=_OWNER_ID,
        chat_id=chat_id,
        turn_index=unit.turn,
        message=unit.message,
        model_provider_id=configuration.model_provider.id,
        options=language.options,
        conversation_language=language.conversation_language,
        provider_moderation=PROVIDER_MODERATION,
    )
    prompt_key = f"{configuration.label}/{unit.persona.id}/{unit.language}"

    def measure(prepared: PreparedDirectChatTurn) -> None:
        if unit.turn == 1 and prompt_key not in outcome.prompts:
            prompt = prepared.model_request.prompt
            outcome.prompts[prompt_key] = {
                "instruction_bytes": instruction_bytes(prompt),
                "estimated_input_tokens": estimate_prompt_tokens(prompt),
            }

    result = await execute_turn(
        contestant.executors[unit.persona.id],
        request,
        budget=contestant.client,
        chats=chats,
        clock=clock,
        on_prepared=measure,
    )
    if result.refused:
        # A turn missing a refused call (its first call or its repair) is not recorded.
        return False
    reply = result.reply
    replayed_gesture = (reply.gesture or None) if reply is not None else None
    served = sorted({call.served_model for call in result.calls if call.served_model})
    known = outcome.served_models.setdefault(configuration.label, [])
    known.extend(model for model in served if model not in known)
    costs = [call.cost_usd for call in result.calls]
    record: dict[str, Any] = {
        "configuration": configuration.label,
        "model_provider_id": configuration.model_provider.id,
        "effort": configuration.effort,
        "persona": unit.persona.id,
        "kind": unit.kind,
        "area": unit.area,
        "language": unit.language,
        "unit_id": unit.unit_id,
        "pair_id": unit.pair_id,
        "held_out": unit.held_out,
        "tags": list(unit.tags),
        "repeat": unit.repeat,
        "turn": unit.turn,
        "message": unit.message,
        "gesture": result.gesture,
        "replayed_gesture": replayed_gesture,
        # True when the reply named a Gesture chat dropped, for example one outside the loadout.
        "gesture_mismatch": result.error is None and replayed_gesture != result.gesture,
        "fit": result.gesture in unit.acceptable if unit.acceptable is not None and result.error is None else None,
        "emotional_tone": reply.emotional_tone if reply is not None else None,
        "emotional_intensity": reply.emotional_intensity if reply is not None else None,
        "speech": reply.speech if reply is not None else None,
        "display": reply.display if reply is not None else None,
        "speech_check": asdict(check_speech(reply.speech, reply.display)) if reply is not None else None,
        "recovery": recovery_path(result),
        "error": result.error,
        "calls": len(result.calls),
        "served_models": served,
        "usage": usage_json(result.calls),
        "estimated_cost_usd": (
            float(sum(cost for cost in costs if cost is not None)) if costs and None not in costs else None
        ),
        "latency_seconds": seconds(result.finished - result.sent),
        "first_output_seconds": seconds(result.first_output - result.sent) if result.first_output is not None else None,
        "call_latencies": [call_latency(call) for call in result.calls],
    }
    sink(record)
    outcome.turns += 1
    if progress is not None:
        progress(record)
    return True
