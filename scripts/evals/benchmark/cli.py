"""The benchmark's commands: ``plan`` (the dry run), ``run``, ``judge``, ``models`` and ``cleanup``.

``plan`` needs no database or model: the standard set comes from the catalog
the code defines. ``run`` runs inside the backend container of a development
task stack, where the configured connections and keys are; it reads the model
catalog in a read-only transaction and never reads, prints or logs keys. A
prompt set with memory work also gets a disposable benchmark database
(``memory_db``), dropped when the run ends; ``cleanup`` drops one a killed run
left behind::

    source .animama-stack.env
    docker compose -p "$COMPOSE_PROJECT_NAME" exec animama-server python -m scripts.evals.benchmark run \\
        --prompts <path> --standard --max-calls <n> --max-usd <usd> --price <rates> \\
        --output-dir /app/.animama-drafts/model-benchmark/<run>

Add ``-e ANIMAMA_LLM_SKIP=1`` after ``exec`` for a free run against chat's
mock model client, which needs no approval.

``judge`` runs on the host, where the Claude CLI is signed in to the owner's
subscription; it reads the run directory and writes under its ``judge/``
folder, and can be rerun to resume::

    uv run --no-sync python -m scripts.evals.benchmark judge --run-dir .animama-drafts/model-benchmark/<run> \
        --prompts docs/benchmarks/inputs/prompts.json --effort medium
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import platform
import sys
import time
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from agents import set_tracing_disabled

from animama.app.chat import DirectChatTurnSetupError, ModelClientNotFoundError
from animama.app.model_clients import StaticModelClientRegistry
from animama.domain import ModelProvider

from ..core import catalog
from ..core.inputs import EvalInputError
from ..core.pricing import TokenPrices, parse_token_prices
from .configs import Configuration, builtin_chat_rows, capability_problem, parse_config, standard_configurations
from .judge import DEFAULT_CONCURRENCY, EFFORTS, ClaudeCli, load_or_plan, run_judging
from .memory_db import benchmark_database, benchmark_database_name, drop_leftover_databases, japanese_search_probe
from .memory_runner import ARM_BOTH, ARM_MEMORIES_MD_ONLY, ARM_REMEMBER_ONLY, BenchmarkSessions
from .options import ELEVENLABS_VOICE, PROVIDER_MODERATION
from .planner import (
    DEFAULT_SECONDS_PER_CALL,
    TIME_BOUND_SECONDS,
    BenchmarkPlan,
    call_price,
    estimate_first_turn_tokens,
    estimate_usd,
    estimated_seconds,
    judge_estimate,
    render_plan,
    total_usd,
)
from .prompt_set import TIERS, load_prompt_set
from .results import MANIFEST, RUN_SCHEMA, TURNS, RunDirectory, read_turns
from .rubrics import TRACKED_RUBRICS, load_rubrics
from .runner import RunCaps, RunOutcome, run_benchmark

__all__ = ["main"]

JUDGE_SEED = 470
"""The seed of the judge's shuffle and opaque ids; the prompt set's held-out choice used the same number."""


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def _seconds(value: str) -> float:
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("must be a positive number of seconds")
    return number


def _usd(value: str) -> Decimal:
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise argparse.ArgumentTypeError("must be a number") from exc
    if not amount.is_finite() or amount < 0:
        raise argparse.ArgumentTypeError("must be a non-negative number")
    return amount


def _plan_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--prompts", type=Path, required=True, help="prompt-set manifest (format v1)")
    parser.add_argument("--tier", choices=TIERS, default="full", help="smoke subset or the full set")
    parser.add_argument("--standard", action="store_true", help="every visible built-in chat row at none and low")
    parser.add_argument("--config", action="append", default=[], help="catalog row id, optionally @effort (repeatable)")
    parser.add_argument("--repeats", type=_positive_int, default=1, help="runs of each single-turn item")
    parser.add_argument("--scripted-repeats", type=_positive_int, default=1, help="runs of each scripted chat")
    parser.add_argument("--max-calls", type=_positive_int, help="hard limit on model calls, repairs included")
    parser.add_argument(
        "--price",
        help="published USD rates per 1M tokens: input=…,cached_input=…,cache_write=…,output=…; prices every "
        "configuration without a --row-price, which must then share the same catalog rates (rows the catalog does not "
        "price all count as alike, so check their published rates)",
    )
    parser.add_argument(
        "--row-price",
        nargs=2,
        action="append",
        default=[],
        metavar=("ROW_ID", "RATES"),
        help="rates for one catalog row's configurations, in the --price format (repeatable)",
    )
    parser.add_argument(
        "--seconds-per-call",
        type=_seconds,
        default=DEFAULT_SECONDS_PER_CALL,
        help=f"wall-time allowance per model call (default {DEFAULT_SECONDS_PER_CALL})",
    )
    parser.add_argument("--judge-effort", choices=EFFORTS, default="medium", help="judge effort for the estimate")
    parser.add_argument(
        "--judge-concurrency",
        type=_positive_int,
        default=DEFAULT_CONCURRENCY,
        help=f"parallel judge processes for the estimate (default {DEFAULT_CONCURRENCY})",
    )


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.evals.benchmark",
        description="Benchmark chat models through chat's real turn executor; see docs/benchmarks/README.md.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    _plan_arguments(commands.add_parser("plan", help="print the plan and estimates without a database or model"))
    run = commands.add_parser("run", help="run the benchmark (inside a development stack's backend container)")
    _plan_arguments(run)
    run.add_argument("--max-usd", type=_usd, help="hard limit on estimated spend in USD (needs --price or --row-price)")
    run.add_argument("--output-dir", type=Path, required=True, help="new directory for turns.jsonl and the manifest")
    run.add_argument(
        "--over-time-approved",
        action="store_true",
        help="the owner approved this run although its estimate exceeds the 4-hour bound",
    )
    run.add_argument("--network-label", default="unrecorded", help="the network the run used, for the report")
    run.add_argument(
        "--machine-label",
        default=platform.node(),
        help="the machine the run used, for the report (default: this host's name, a container id in a stack)",
    )
    run.add_argument("--source-revision", default="unrecorded", help="the checkout's commit, for the report")
    judge = commands.add_parser("judge", help="judge a run's replies blind through the Claude CLI (on the host)")
    judge.add_argument("--run-dir", type=Path, required=True, help="a run's output directory")
    judge.add_argument("--prompts", type=Path, required=True, help="the run's prompt-set manifest on this machine")
    judge.add_argument("--rubrics", type=Path, default=TRACKED_RUBRICS, help="rubric file (default: the tracked one)")
    judge.add_argument("--effort", choices=EFFORTS, required=True, help="the judge's reasoning effort")
    judge.add_argument(
        "--concurrency",
        type=_positive_int,
        default=DEFAULT_CONCURRENCY,
        help=f"parallel judge processes (default {DEFAULT_CONCURRENCY})",
    )
    judge.add_argument("--rubric", action="append", default=[], help="judge only this rubric's batches (repeatable)")
    judge.add_argument("--batch", action="append", default=[], help="judge only this batch (repeatable)")
    judge.add_argument("--claude", default="claude", help="the Claude CLI executable")
    judge.add_argument("--timeout", type=_seconds, default=900.0, help="seconds allowed for one judge call")
    judge.add_argument(
        "--allow-unfinished",
        action="store_true",
        help="judge a run whose manifest still says it is running (a run that was killed)",
    )
    commands.add_parser("models", help="print the active chat rows of the model catalog")
    commands.add_parser(
        "cleanup",
        help="drop benchmark databases a killed run left behind; a database in use, such as a running "
        "benchmark's, is kept",
    )
    return parser.parse_args(argv)


def _configurations(args: argparse.Namespace, rows: Sequence[Any]) -> tuple[Configuration, ...]:
    configurations = standard_configurations(rows) if args.standard else []
    configurations += [parse_config(text, rows) for text in args.config]
    if not configurations:
        raise EvalInputError("Choose --standard and/or --config")
    labels = [configuration.label for configuration in configurations]
    if len(set(labels)) != len(labels):
        raise EvalInputError("A configuration is listed twice")
    return tuple(configurations)


def _plan(args: argparse.Namespace, rows: Sequence[Any]) -> BenchmarkPlan:
    prompt_set = load_prompt_set(args.prompts).for_tier(args.tier)
    return BenchmarkPlan(
        prompt_set=prompt_set,
        configurations=_configurations(args, rows),
        tier=args.tier,
        repeats=args.repeats,
        scripted_repeats=args.scripted_repeats,
    )


def _price_table(args: argparse.Namespace, plan: BenchmarkPlan) -> dict[str, TokenPrices | None]:
    """Each runnable configuration's ``--row-price`` or ``--price`` rates; ``None`` when neither was given.

    One ``--price`` may price several rows only when their catalog rates agree, so a row with other rates cannot
    be priced, and capped, at another model's rates.
    """

    default = parse_token_prices(args.price) if args.price is not None else None
    rows = {configuration.model_provider.id for configuration in plan.runnable}
    row_prices: dict[str, TokenPrices] = {}
    for row_id, rates in args.row_price:
        if row_id not in rows:
            raise EvalInputError(f"--row-price: {row_id!r} is not a runnable configuration's row")
        row_prices[row_id] = parse_token_prices(rates)
    shared = [c.model_provider for c in plan.runnable if c.model_provider.id not in row_prices]
    if default is not None and len({_catalog_rates(row) for row in shared}) > 1:
        names = ", ".join(sorted({row.id for row in shared}))
        raise EvalInputError(f"--price would price rows with different catalog rates alike ({names}); add --row-price")
    return {
        configuration.label: row_prices.get(configuration.model_provider.id, default) for configuration in plan.runnable
    }


def _catalog_rates(row: ModelProvider) -> tuple[Decimal | None, Decimal | None, Decimal | None]:
    pricing = row.pricing
    return (
        pricing.standard_input_price_per_million,
        pricing.standard_cached_input_price_per_million,
        pricing.standard_output_price_per_million,
    )


async def _print_plan(args: argparse.Namespace, plan: BenchmarkPlan) -> dict[str, Decimal | None]:
    """Print the plan; return each configuration's USD estimate for the run's cap check."""

    tokens = await estimate_first_turn_tokens(plan)
    prices = _price_table(args, plan)
    judge_lines, judge_seconds = judge_estimate(
        plan, load_rubrics(TRACKED_RUBRICS), effort=args.judge_effort, concurrency=args.judge_concurrency
    )
    print(
        render_plan(
            plan,
            first_turn_tokens=tokens,
            seconds_per_call=args.seconds_per_call,
            max_calls=args.max_calls,
            prices=prices,
            max_usd=getattr(args, "max_usd", None),
            judge_lines=judge_lines,
            judge_seconds=judge_seconds,
        )
    )
    return estimate_usd(plan, first_turn_tokens=tokens, prices=prices)


async def _models() -> int:
    async with catalog.read_only_model_providers() as model_providers:
        rows = await catalog.chat_model_rows(model_providers)
    for row in rows:
        connection = row.connection.name if row.connection is not None else row.connection_id
        hidden = " (hidden)" if row.hidden else ""
        print(f"{row.id}\t{row.model_label}\t{connection}\t{row.source}{hidden}")
    return 0


def _manifest(
    args: argparse.Namespace,
    plan: BenchmarkPlan,
    *,
    started_at: datetime,
    outcome: RunOutcome | None,
    prices: Mapping[str, TokenPrices | None],
    database: str | None = None,
) -> dict[str, Any]:
    """The run's manifest; ``outcome`` is ``None`` before the run starts, when ``database`` names its database."""

    return {
        "schema": RUN_SCHEMA,
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(UTC).isoformat() if outcome is not None else None,
        "aborted": outcome.aborted if outcome is not None else "running",
        "tier": plan.tier,
        "prompt_set": {"path": str(args.prompts), "version": plan.prompt_set.version, **plan.prompt_set.hashes},
        "repeats": plan.repeats,
        "scripted_repeats": plan.scripted_repeats,
        "configurations": [
            {
                "label": configuration.label,
                "model_provider_id": configuration.model_provider.id,
                "provider_type": configuration.model_provider.provider_type,
                "model": configuration.model_provider.model,
                "connection_id": configuration.model_provider.connection_id,
                "effort": configuration.effort,
                "not_run": capability_problem(configuration),
                "native_context_compaction": (
                    outcome.native_context_compaction.get(configuration.label) if outcome is not None else None
                ),
                "served_models": outcome.served_models.get(configuration.label, []) if outcome is not None else [],
            }
            for configuration in plan.configurations
        ],
        "caps": {"max_calls": args.max_calls, "max_usd": str(args.max_usd) if args.max_usd is not None else None},
        "over_time_approved": args.over_time_approved,
        "price_source": {
            label: {"rates_per_million_usd": rates.as_json()} if rates is not None else None
            for label, rates in prices.items()
        },
        "calls_made": outcome.calls if outcome is not None else 0,
        "estimated_spend_usd": str(outcome.spent_usd) if outcome is not None else "0",
        "turns_recorded": outcome.turns if outcome is not None else 0,
        "prompts": outcome.prompts if outcome is not None else {},
        "benchmark_database": outcome.benchmark_database if outcome is not None else database,
        "japanese_search_probe": outcome.japanese_search_probe if outcome is not None else None,
        "conditions": {
            "machine": args.machine_label,
            "platform": platform.platform(),
            "network": args.network_label,
            "source_revision": args.source_revision,
            "llm_skip": catalog.llm_skip(),
        },
        "options": {
            "voice": ELEVENLABS_VOICE.provider,
            "native_tools": [],
            "provider_moderation": PROVIDER_MODERATION,
            "incognito": True,
            # Core and long-chat turns run with memory influence and updates off: no memory sections or tools.
            "memory": "off",
            # Memory chats, recall chats and Memory Manager runs have memory on in these arms.
            "memory_arms": [ARM_REMEMBER_ONLY, ARM_MEMORIES_MD_ONLY, ARM_BOTH] if plan.needs_benchmark_database else [],
        },
    }


def _print_progress(turn: Mapping[str, Any]) -> None:
    outcome = f"error {turn['error']}" if turn["error"] is not None else (turn["gesture"] or "no gesture")
    print(
        f"[{turn['configuration']}] {turn['kind']} {turn['unit_id']} #{turn['turn']} ({turn['persona']}, "
        f"{turn['language']}): {outcome} in {turn['latency_seconds']:.2f}s",
        file=sys.stderr,
    )


async def _run(args: argparse.Namespace) -> int:
    if args.max_calls is None or args.max_usd is None:
        raise EvalInputError("run needs --max-calls and --max-usd: the owner-approved caps")
    async with catalog.read_only_model_providers() as model_providers:
        rows = await catalog.chat_model_rows(model_providers)
    plan = _plan(args, rows)
    estimates = await _print_plan(args, plan)
    prices = _price_table(args, plan)
    unpriced = [label for label, rates in prices.items() if rates is None]
    if unpriced:
        # The catalog records no prompt-cache-write rate, so it cannot price every call (Anthropic reports them).
        raise EvalInputError(f"A USD cap needs --price or --row-price rates; unpriced: {', '.join(unpriced)}")
    if plan.estimated_calls > args.max_calls:
        raise EvalInputError(f"The plan needs {plan.estimated_calls} model calls, more than --max-calls")
    estimated = total_usd(estimates)
    if estimated is not None and estimated > args.max_usd:
        raise EvalInputError(f"The plan's cost estimate ~{estimated:.4f} USD exceeds --max-usd {args.max_usd}")
    _judge_lines, judge_seconds = judge_estimate(
        plan, load_rubrics(TRACKED_RUBRICS), effort=args.judge_effort, concurrency=args.judge_concurrency
    )
    seconds = estimated_seconds(plan, seconds_per_call=args.seconds_per_call, judge_seconds=judge_seconds)
    if seconds > TIME_BOUND_SECONDS and not args.over_time_approved:
        raise EvalInputError("The estimate exceeds the 4-hour bound; trim the plan or pass --over-time-approved")
    directory = RunDirectory(args.output_dir)
    started_at = datetime.now(UTC)
    # Filled as the run goes, so the manifest records a partial or failed run's calls, spend and reason too.
    outcome = RunOutcome()
    if plan.needs_benchmark_database:
        # Named before the first manifest, so a killed run's manifest says which database `cleanup` should drop.
        outcome.benchmark_database = benchmark_database_name(directory.path.name)
    directory.write_manifest(
        _manifest(args, plan, started_at=started_at, outcome=None, prices=prices, database=outcome.benchmark_database)
    )
    registry: StaticModelClientRegistry | None = None
    try:
        registry = catalog.build_model_client_registry()
        async with _memory_sessions(outcome) as memory_sessions:
            await run_benchmark(
                plan.prompt_set,
                plan.runnable,
                registry=registry,
                caps=RunCaps(max_calls=args.max_calls, max_usd=args.max_usd),
                prices={label: call_price(rates) for label, rates in prices.items()},
                sink=directory.append_turn,
                repeats=args.repeats,
                scripted_repeats=args.scripted_repeats,
                clock=time.monotonic,
                progress=_print_progress,
                outcome=outcome,
                memory_sessions=memory_sessions,
            )
    except Exception as exc:
        if outcome.aborted == "interrupted":
            # The run loop never started, for example the registry could not be built.
            outcome.aborted = f"error: {exc.__class__.__name__}"
        raise
    finally:
        directory.write_manifest(_manifest(args, plan, started_at=started_at, outcome=outcome, prices=prices))
        if registry is not None:
            await registry.aclose()
        print(f"\nRun: {directory.path}", file=sys.stderr)
    return 0 if outcome.aborted is None else 1


@asynccontextmanager
async def _memory_sessions(outcome: RunOutcome) -> AsyncIterator[BenchmarkSessions | None]:
    """The run's disposable benchmark database when its plan has memory work, dropped when the run ends."""

    name = outcome.benchmark_database
    if name is None:
        yield None
        return
    async with benchmark_database(catalog.application_database_url(), name) as factory:
        async with factory() as session:
            # Chat's memory search uses the english text-search configuration; record what that does to Japanese.
            outcome.japanese_search_probe = await japanese_search_probe(session)
        yield BenchmarkSessions(factory)


def _judge(args: argparse.Namespace) -> int:
    """Judge a run at one effort; 0 when every batch is scored, 1 with missing scores, 3 when stopped early."""

    run_dir: Path = args.run_dir
    try:
        manifest = json.loads((run_dir / MANIFEST).read_text(encoding="utf-8"))
        turns_bytes = (run_dir / TURNS).read_bytes()
    except (OSError, ValueError) as exc:
        raise EvalInputError(f"{run_dir} is not a benchmark run ({exc})") from exc
    if manifest.get("schema") != RUN_SCHEMA:
        raise EvalInputError(f"{run_dir}: unknown run schema {manifest.get('schema')!r}")
    if manifest.get("aborted") == "running" and not args.allow_unfinished:
        # The judge plan is fixed to the turns judged first, so judging a run still in progress would lock it.
        raise EvalInputError(
            f"{run_dir} is still running or was killed; judge it once it ends, or pass --allow-unfinished"
        )
    prompt_set = load_prompt_set(args.prompts)
    recorded = manifest.get("prompt_set") or {}
    changed = [key for key, value in prompt_set.hashes.items() if recorded.get(key) != value]
    if changed:
        raise EvalInputError(f"{args.prompts} is not the run's prompt set: {', '.join(changed)} differ")
    rubrics = load_rubrics(args.rubrics)
    turns = list(read_turns(run_dir))
    plan = load_or_plan(run_dir, turns, hashlib.sha256(turns_bytes).hexdigest(), prompt_set, rubrics, seed=JUDGE_SEED)
    rubric_ids, batch_ids = set(args.rubric), set(args.batch)
    unknown = sorted(rubric_ids - {batch.rubric for batch in plan.batches}) + sorted(
        batch_ids - {batch.id for batch in plan.batches}
    )
    if unknown:
        raise EvalInputError(f"no planned batches for {', '.join(unknown)}; see {plan.directory / 'plan.json'}")
    selected = [
        batch
        for batch in plan.batches
        if (not rubric_ids or batch.rubric in rubric_ids) and (not batch_ids or batch.id in batch_ids)
    ]
    print(f"Judge plan: {len(plan.batches)} batches, {len(selected)} selected, effort {args.effort}", file=sys.stderr)
    outcome = run_judging(
        plan,
        prompt_set,
        rubrics,
        effort=args.effort,
        cli=ClaudeCli(binary=args.claude, timeout=args.timeout),
        concurrency=args.concurrency,
        select=lambda batch: batch in selected,
    )
    print(
        f"Judged {outcome.completed} batches, skipped {outcome.skipped} already done, {outcome.missing} missing",
        file=sys.stderr,
    )
    if outcome.stopped is not None:
        follow_up = "rerun the same command to resume" if outcome.resumable else "fix this, then rerun the command"
        print(f"Judging stopped: {outcome.stopped}. Finished batches are kept; {follow_up}.", file=sys.stderr)
        return 3
    return 1 if outcome.missing else 0


async def _cleanup() -> int:
    dropped, in_use = await drop_leftover_databases(catalog.application_database_url())
    lines = [f"dropped {name}" for name in dropped] + [f"kept {name}: in use" for name in in_use]
    print("\n".join(lines) if lines else "no benchmark databases to drop")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        if args.command == "models":
            return asyncio.run(_models())
        if args.command == "cleanup":
            return asyncio.run(_cleanup())
        if args.command == "plan":
            asyncio.run(_print_plan(args, _plan(args, builtin_chat_rows())))
            return 0
        if args.command == "judge":
            return _judge(args)
        # The OpenAI Memory Manager runtime would otherwise export a trace of each benchmark run.
        set_tracing_disabled(True)
        return asyncio.run(_run(args))
    except (EvalInputError, DirectChatTurnSetupError, ModelClientNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        finished = "batches" if args.command == "judge" else "turns"
        print(f"Interrupted; the {finished} finished so far were written.", file=sys.stderr)
        return 130
