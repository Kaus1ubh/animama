"""The benchmark's dry run (spec R14): planned calls, tokens, cost and wall time, with no database or model.

Every figure is an estimate the owner approves a run against; the run itself
enforces the caps. Input tokens come from chat's own prompt assembly for each
configuration's row, measured with chat's conservative token estimate. The
USD estimate prices every call at its first turn's size with no prompt
caching: caching lowers it, while a long chat's growing history raises it, as
do the memory sections and tools of memory and Memory Manager calls, so the
run's USD cap, not this figure, bounds the spend. Wall time is the planned
calls times a seconds-per-call allowance, plus judging.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal

from animama.app.model_clients.context_budget import estimate_prompt_tokens
from animama.domain.usage import Usage
from scripts.evals.core.chat import EvalChats, StaticMemoryContext, build_executor, turn_request
from scripts.evals.core.model_calls import CallPrice, CallRecord, UnusedModelClient
from scripts.evals.core.pricing import TokenPrices, usage_json

from .configs import Configuration, capability_problem, first_per_row
from .judge import BATCH_SIZES, DEFAULT_CONCURRENCY
from .judge_items import OPEN_PROBES_ONLY, TAGGED_REPLIES_ONLY
from .options import PROVIDER_MODERATION, core_turn_options
from .prompt_set import PromptSet
from .rubrics import RubricSet
from .runner import WARMUP_MESSAGE, planned_turns

__all__ = [
    "DEFAULT_SECONDS_PER_CALL",
    "ESTIMATED_OUTPUT_TOKENS",
    "TIME_BOUND_SECONDS",
    "BenchmarkPlan",
    "call_price",
    "estimate_first_turn_tokens",
    "estimate_usd",
    "estimated_seconds",
    "judge_estimate",
    "judged_items",
    "render_plan",
    "total_usd",
]

PriceTable = Mapping[str, TokenPrices | None]
"""``--price`` rates per configuration label; ``None`` falls back to the catalog's standard rates."""

TIME_BOUND_SECONDS = 4 * 60 * 60
"""One full run of the standard set fits this wall time, judging included, unless the owner grants an exception."""
DEFAULT_SECONDS_PER_CALL = 2.5
"""#409 measured medians of about 2 s per turn for both built-in rows; the allowance covers repairs and p90 turns."""
ESTIMATED_OUTPUT_TOKENS = 200
"""Output tokens allowed per call in the cost estimate: a short reply of 100-200 tokens plus any reasoning."""
MEMORY_TURN_CALLS = 2
"""Calls planned per memory or recall turn: the reply, plus one memory-tool round on average."""
MANAGER_RUN_CALLS = 6
"""Calls planned per Memory Manager run: reads, a proposal or two, and its final reply. Each row runs once."""
MEMORY_ARM_COUNT = 3
JUDGE_SECONDS_PER_BATCH: Mapping[str, Mapping[str, float]] = {
    "medium": {"reply": 10.0, "expression": 30.0},
    "high": {"reply": 20.0, "expression": 35.0},
}
"""Wall time of one judge batch, rounded up from the Phase 6 smoke (20-item batches, two at a time): reply took
8.7 s at medium and 17.9 s at high, expression 26.9 s and 31.8 s."""
UNMEASURED_SECONDS_PER_BATCH: Mapping[str, float] = {"medium": 30.0, "high": 35.0}
"""The allowance for a rubric the smoke did not time: the slowest measured batch, rounded up."""
JUDGE_INPUT_TOKENS_PER_BATCH: Mapping[str, int] = {"reply": 9_200, "expression": 21_700}
"""Input tokens of one batch in the Phase 6 smoke; expression batches list the 140 equipped Gestures."""
AUDIO_TAG_SHARE = 0.3
"""The share of replies expected to carry an Audio tag; only those go to the Audio-tag rubric."""


@dataclass(frozen=True, slots=True)
class BenchmarkPlan:
    prompt_set: PromptSet
    configurations: tuple[Configuration, ...]
    tier: str
    repeats: int = 1
    scripted_repeats: int = 1

    @property
    def turns_per_configuration(self) -> int:
        """Core and scripted-chat turns per configuration, its warm-up included."""

        return planned_turns(self.prompt_set, repeats=self.repeats, scripted_repeats=self.scripted_repeats)

    @property
    def memory_turns_per_configuration(self) -> int:
        """Memory-chat and recall turns per configuration, across the three arms."""

        return MEMORY_ARM_COUNT * sum(len(chat.turns) + len(chat.recall) for chat in self.prompt_set.memory_chats)

    @property
    def calls_per_configuration(self) -> int:
        """Planned calls of every configuration, leaving out the Memory Manager runs its row makes once."""

        return self.turns_per_configuration + MEMORY_TURN_CALLS * self.memory_turns_per_configuration

    def calls_for(self, configuration: Configuration) -> int:
        """Planned calls of one configuration, with its row's Memory Manager runs when it is the row's first."""

        manager = MANAGER_RUN_CALLS * len(self.prompt_set.manager_runs)
        return self.calls_per_configuration + (manager if configuration in first_per_row(self.runnable) else 0)

    @property
    def needs_benchmark_database(self) -> bool:
        return bool(self.prompt_set.memory_chats or self.prompt_set.manager_runs)

    @property
    def runnable(self) -> tuple[Configuration, ...]:
        return tuple(
            configuration for configuration in self.configurations if capability_problem(configuration) is None
        )

    @property
    def estimated_calls(self) -> int:
        """Planned calls; a structured repair or context retry can add one more to a turn."""

        return sum(self.calls_for(configuration) for configuration in self.runnable)


def judged_items(plan: BenchmarkPlan, rubrics: RubricSet) -> dict[str, int]:
    """Planned judged items per rubric, from each rubric's kinds (an estimate for Audio tags)."""

    prompt_set = plan.prompt_set
    configurations = len(plan.runnable)
    kinds = {
        "single": configurations * len(prompt_set.items) * len(prompt_set.personas) * plan.repeats,
        "chat": configurations * sum(len(chat.turns) for chat in prompt_set.scripted_chats) * plan.scripted_repeats,
        "memory": configurations * MEMORY_ARM_COUNT * sum(len(chat.turns) for chat in prompt_set.memory_chats),
        "recall": configurations * MEMORY_ARM_COUNT * sum(len(chat.recall) for chat in prompt_set.memory_chats),
        "chat_transcript": configurations * len(prompt_set.scripted_chats) * plan.scripted_repeats,
        "capture": configurations * MEMORY_ARM_COUNT * len(prompt_set.memory_chats),
        "memory_manager": len(first_per_row(plan.runnable)) * len(prompt_set.manager_runs),
    }
    open_recall = (
        configurations
        * MEMORY_ARM_COUNT
        * sum(1 for chat in prompt_set.memory_chats for probe in chat.recall if not probe.expect)
    )
    counts: dict[str, int] = {}
    for rubric in rubrics.rubrics:
        count = sum(
            open_recall if kind == "recall" and rubric.id in OPEN_PROBES_ONLY else kinds[kind]
            for kind in rubric.applies_to
        )
        counts[rubric.id] = round(count * AUDIO_TAG_SHARE) if rubric.id in TAGGED_REPLIES_ONLY else count
    return counts


def judge_estimate(
    plan: BenchmarkPlan, rubrics: RubricSet, *, effort: str = "medium", concurrency: int = DEFAULT_CONCURRENCY
) -> tuple[list[str], float]:
    """The plan's judging: lines describing its batches, and its wall time in seconds."""

    items = {rubric: count for rubric, count in judged_items(plan, rubrics).items() if count}
    batches = {rubric: math.ceil(count / BATCH_SIZES[rubric]) for rubric, count in items.items()}
    per_batch = {
        rubric: JUDGE_SECONDS_PER_BATCH[effort].get(rubric, UNMEASURED_SECONDS_PER_BATCH[effort]) for rubric in items
    }
    seconds = sum(batches[rubric] * per_batch[rubric] for rubric in items) / concurrency
    lines = [
        f"Judging: {sum(items.values())} items in {sum(batches.values())} batches at effort {effort}, "
        f"{concurrency} at a time; Audio-tag items assume {AUDIO_TAG_SHARE:.0%} of replies carry a tag",
    ]
    for rubric in items:
        tokens = JUDGE_INPUT_TOKENS_PER_BATCH.get(rubric)
        measured = rubric in JUDGE_SECONDS_PER_BATCH[effort]
        lines.append(
            f"  - {rubric}: {items[rubric]} items, {batches[rubric]} batches, about {per_batch[rubric]:g} s each"
            + (f" and {tokens:,} input tokens (measured)" if tokens is not None and measured else " (not measured)")
        )
    return lines, seconds


def call_price(token_prices: TokenPrices | None) -> CallPrice | None:
    """A call's USD cost from ``--price`` rates, or ``None`` when no rates were given.

    A run's USD cap uses explicit published rates: the catalog records no
    prompt-cache-write rate, so it cannot price every call (Anthropic reports
    cache writes).
    """

    if token_prices is None:
        return None
    prices = token_prices

    def price(usage: Usage) -> Decimal:
        return prices.cost(usage_json([CallRecord(started=0.0, final_text="", usage=usage)]))

    return price


async def estimate_first_turn_tokens(plan: BenchmarkPlan) -> dict[str, int]:
    """Chat's input-token estimate for each runnable configuration's largest first turn, without a model call.

    The largest persona identity is used, in English, with the ElevenLabs voice.
    """

    persona = max(plan.prompt_set.personas, key=lambda persona: len(persona.identity))
    estimates: dict[str, int] = {}
    for configuration in plan.runnable:
        row = configuration.model_provider
        executor = build_executor(
            row,
            UnusedModelClient(),
            EvalChats(),
            memory_context=StaticMemoryContext(identity=persona.identity, name=persona.name),
        )
        language = core_turn_options("en", configuration.effort)
        request = turn_request(
            plan.prompt_set.loadout.gestures,
            anima_id="model-benchmark-estimate",
            user_id="model-benchmark-estimate",
            chat_id=f"estimate/{configuration.label}",
            turn_index=1,
            message=WARMUP_MESSAGE,
            model_provider_id=row.id,
            options=language.options,
            provider_moderation=PROVIDER_MODERATION,
        )
        prepared = await executor.prepare_turn(request)
        estimates[configuration.label] = estimate_prompt_tokens(prepared.model_request.prompt)
    return estimates


def _estimated_usd(
    configuration: Configuration, calls: int, input_tokens: int, token_prices: TokenPrices | None
) -> Decimal | None:
    pricing = configuration.model_provider.pricing
    input_rate = token_prices.input if token_prices is not None else pricing.standard_input_price_per_million
    output_rate = token_prices.output if token_prices is not None else pricing.standard_output_price_per_million
    if input_rate is None or output_rate is None:
        return None
    return calls * (input_tokens * input_rate + ESTIMATED_OUTPUT_TOKENS * output_rate) / Decimal(1_000_000)


def estimate_usd(
    plan: BenchmarkPlan, *, first_turn_tokens: Mapping[str, int], prices: PriceTable
) -> dict[str, Decimal | None]:
    """Each runnable configuration's estimated USD, ``None`` when it cannot be priced."""

    return {
        configuration.label: (
            _estimated_usd(
                configuration,
                plan.calls_for(configuration),
                first_turn_tokens[configuration.label],
                prices.get(configuration.label),
            )
            if configuration.label in first_turn_tokens
            else None
        )
        for configuration in plan.runnable
    }


def total_usd(estimates: Mapping[str, Decimal | None]) -> Decimal | None:
    """The plan's estimated USD, or ``None`` when a configuration cannot be priced."""

    values = list(estimates.values())
    return None if any(value is None for value in values) else sum((v for v in values if v is not None), Decimal(0))


def estimated_seconds(plan: BenchmarkPlan, *, seconds_per_call: float, judge_seconds: float = 0.0) -> float:
    """Wall time for the planned calls one at a time, plus judging."""

    return plan.estimated_calls * seconds_per_call + judge_seconds


def render_plan(
    plan: BenchmarkPlan,
    *,
    first_turn_tokens: Mapping[str, int],
    seconds_per_call: float,
    max_calls: int | None,
    prices: PriceTable,
    max_usd: Decimal | None = None,
    judge_lines: Sequence[str] = (),
    judge_seconds: float = 0.0,
) -> str:
    """Describe what a run would send and cost, and whether it fits its caps and the time bound."""

    prompt_set = plan.prompt_set
    languages = sorted(
        {item.language for item in prompt_set.items}
        | {chat.language for chat in prompt_set.scripted_chats}
        | {chat.language for chat in prompt_set.memory_chats}
    )
    lines = [
        "Model benchmark plan",
        f"Prompt set: version {prompt_set.version}, tier {plan.tier}: {len(prompt_set.items)} single-turn items, "
        f"{len(prompt_set.scripted_chats)} scripted chats "
        f"({sum(len(chat.turns) for chat in prompt_set.scripted_chats)} turns); "
        f"{len(prompt_set.personas)} personas; languages {', '.join(languages)}",
        *(_composition_lines(prompt_set)),
        f"Repeats: {plan.repeats} for single-turn items (each under every persona), "
        f"{plan.scripted_repeats} for scripted chats",
        f"Turns per configuration: {plan.turns_per_configuration}, one discarded warm-up included"
        + (
            f"; plus {plan.memory_turns_per_configuration} memory and recall turns in {MEMORY_ARM_COUNT} arms "
            f"(about {MEMORY_TURN_CALLS} calls each), and {len(prompt_set.manager_runs)} Memory Manager runs "
            f"per catalog row at the runtime's own effort (about {MANAGER_RUN_CALLS} calls each), "
            "on a disposable benchmark database"
            if plan.needs_benchmark_database
            else ""
        ),
        "Configurations:",
    ]
    estimates = estimate_usd(plan, first_turn_tokens=first_turn_tokens, prices=prices)
    for configuration in plan.configurations:
        problem = capability_problem(configuration)
        if problem is not None:
            lines.append(f"  - {configuration.label}: not run, {problem}")
            continue
        usd = estimates[configuration.label]
        cost = f"~{usd:.4f} USD" if usd is not None else "unpriced"
        source = "--price rates" if prices.get(configuration.label) is not None else "catalog standard rates"
        lines.append(
            f"  - {configuration.label}: ~{first_turn_tokens.get(configuration.label)} input tokens per first turn, "
            f"{plan.calls_for(configuration)} calls, {cost} ({source})"
        )
    lines.append(
        f"Estimated model calls: {plan.estimated_calls}; up to {2 * plan.estimated_calls} if every reply needs "
        "chat's structured repair request, and extra memory tool rounds can add more; --max-calls bounds them all"
    )
    total = total_usd(estimates)
    lines.append(
        f"Estimated cost: ~{total:.4f} USD, each call at its first turn's size, uncached, "
        f"{ESTIMATED_OUTPUT_TOKENS} output tokens per call"
        if total is not None
        else "Estimated cost: unpriced for at least one configuration"
    )
    if max_usd is not None and total is not None and total > max_usd:
        lines.append(f"Budget: the cost estimate exceeds --max-usd {max_usd}, so the run will not start")
    lines.extend(judge_lines)
    seconds = estimated_seconds(plan, seconds_per_call=seconds_per_call, judge_seconds=judge_seconds)
    lines.append(
        f"Estimated wall time: {seconds / 3600:.2f} h ({plan.estimated_calls} calls x {seconds_per_call:g} s"
        + (f" + {judge_seconds / 3600:.2f} h judging" if judge_seconds else "")
        + f"); the bound is {TIME_BOUND_SECONDS / 3600:g} h"
    )
    if seconds > TIME_BOUND_SECONDS:
        lines.append("Time: over the bound, so a run starts only with --over-time-approved (the owner's exception)")
    if max_calls is not None:
        if plan.estimated_calls > max_calls:
            lines.append(f"Budget: the estimate exceeds --max-calls {max_calls}, so the run will not start")
        else:
            lines.append(
                f"Budget: the estimate is within --max-calls {max_calls}; repairs and context retries also count, "
                "and no call beyond the cap is sent"
            )
    return "\n".join(lines)


def _composition_lines(prompt_set: PromptSet) -> list[str]:
    """Items and chats by area and language, with the held-out share of each."""

    groups: dict[tuple[str, str, str], list[bool]] = {}
    for item in prompt_set.items:
        groups.setdefault(("items", item.area, item.language), []).append(item.held_out)
    for chat in prompt_set.scripted_chats:
        groups.setdefault(("chats", chat.area, chat.language), []).append(chat.held_out)
    for memory_chat in prompt_set.memory_chats:
        groups.setdefault(("memory chats", memory_chat.area, memory_chat.language), []).append(memory_chat.held_out)
    for run in prompt_set.manager_runs:
        groups.setdefault(("Memory Manager runs", run.kind, "en"), []).append(run.held_out)
    return [
        f"  - {kind}, {area}, {language}: {len(held)} ({sum(held)} held out)"
        for (kind, area, language), held in sorted(groups.items())
    ]
