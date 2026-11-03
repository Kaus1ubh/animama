"""Blind judging of a benchmark run through the Claude CLI (spec R12, D6-D8).

``plan_judging`` turns a run's judged items into fixed-size, blind batches:
every item gets an opaque random id, and a seeded shuffle mixes
configurations, memory arms and languages. The plan, each batch's items
(naming personas by id; the prompt sent adds their texts) and the mapping
from opaque ids back to records are written once under the run's ``judge/``
folder; the mapping is never sent.

``run_judging`` sends each batch to ``claude -p`` on the owner's subscription,
at a pinned model and effort, with the rubric as the system prompt and its
JSON schema for the output. Output that does not match the schema or the
batch's ids is retried, then recorded as missing; it is never guessed. One
result file per batch and effort is the ledger: a rerun skips completed
batches. A usage limit or a sign-in problem stops judging cleanly, keeping
everything finished, so it resumes later.

Isolation (D7): each call runs from a new empty directory with restricted
mode, no tools beyond structured output, no MCP servers, skills or slash
commands, and no session persistence. Its environment keeps only the
variables a signed-in CLI needs, so no API key, endpoint, provider switch or
calling session's settings reach it. Every call's start-up event is checked:
a call that loaded anything else, or that was not signed in through the
subscription, stops the run.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import re
import signal
import tempfile
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from scripts.evals.core.inputs import EvalInputError

from .judge_items import JudgeItem, build_items
from .prompt_set import PromptSet
from .results import write_json
from .rubrics import JudgeOutputError, Rubric, RubricSet, schema_text, system_prompt, validate_output

__all__ = [
    "BATCH_SIZES",
    "DEFAULT_CONCURRENCY",
    "EFFORTS",
    "JUDGE_MODEL",
    "JUDGE_NAME",
    "MAX_ATTEMPTS",
    "ClaudeCli",
    "JudgeCallError",
    "JudgePlan",
    "JudgeRun",
    "JudgeStopped",
    "PlannedBatch",
    "batch_prompt",
    "inputs_fingerprint",
    "load_or_plan",
    "load_plan",
    "plan_judging",
    "run_judging",
]

JUDGE_MODEL = "claude-fable-5-1"
"""Pinned by full id (D6; Fable 5.1 since D17); the CLI's start-up event confirms the model it served."""
JUDGE_NAME = "Claude Fable 5.1"
EFFORTS = ("medium", "high")
MAX_ATTEMPTS = 3
"""One call and two retries per batch before its scores are recorded as missing (spec R12)."""
DEFAULT_CONCURRENCY = 2
"""Parallel ``claude -p`` processes (D12); the Phase 6 smoke ran two at a time with no usage-limit stop."""
BATCH_SIZES: Mapping[str, int] = {
    "reply": 20,
    "expression": 20,
    "audio_tags": 20,
    "long_chat": 2,
    "memory_turn": 10,
    "capture": 4,
    "recall": 20,
    "memory_manager": 3,
}
"""Items per batch for each rubric: fixed, so a batch's size never depends on which items it holds."""
PLAN_SCHEMA = "animama/model-benchmark-judge-plan/1"
RESULT_SCHEMA = "animama/model-benchmark-judge-result/1"
JUDGE_DIR = "judge"
_KEPT_ENV = (
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR", "TERM", "CLAUDE_CONFIG_DIR",
    # A network that needs a proxy or its own certificates still reaches the subscription.
    "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
)  # fmt: skip
"""The only variables a judge call inherits, with the ``LC_*`` locale variables: enough for the CLI, its
subscription sign-in and the network, and nothing that would select an API key, another endpoint or provider, or
the settings of a Claude session the judge was started from."""
_LIMIT = re.compile(r"usage limit|hit your limit|limit (?:will )?reset|rate[_ ]limit|too many requests|\b429\b", re.I)
_AUTH = re.compile(
    r"not logged in|please run /login|/login|invalid api key|oauth|authenticat|unauthori[sz]ed|\b401\b", re.I
)


class JudgeStopped(RuntimeError):
    """Judging stopped on a usage limit, a sign-in problem or broken isolation; completed batches are kept.

    ``resumable`` is true when rerunning the same command later can continue: a usage limit resets, while
    broken isolation or a missing CLI needs fixing first.
    """

    def __init__(self, reason: str, *, resumable: bool) -> None:
        super().__init__(reason)
        self.resumable = resumable


class JudgeCallError(RuntimeError):
    """One judge call failed in a way a retry may fix."""


@dataclass(frozen=True, slots=True)
class PlannedBatch:
    id: str
    rubric: str
    items: tuple[str, ...]
    """Opaque item ids, in the order the judge receives them."""


@dataclass(frozen=True, slots=True)
class JudgePlan:
    directory: Path
    """The run's ``judge/`` folder."""
    seed: int
    batches: tuple[PlannedBatch, ...]
    mapping: Mapping[str, Mapping[str, Any]]
    """Opaque item id to its rubric, batch, checklist entries and record reference."""

    def payload_path(self, batch: PlannedBatch) -> Path:
        return self.directory / "batches" / f"{batch.id}.json"

    def result_path(self, batch: PlannedBatch, effort: str) -> Path:
        return self.directory / effort / f"{batch.id}.json"


def _inputs_fingerprint(turns_sha256: str, prompt_set: PromptSet, rubrics: RubricSet, seed: int) -> dict[str, Any]:
    return {
        "judge_model": JUDGE_MODEL,
        "seed": seed,
        "turns_sha256": turns_sha256,
        "prompt_set": dict(prompt_set.hashes),
        "rubrics": {"version": rubrics.version, "sha256": rubrics.sha256},
        "batch_sizes": dict(BATCH_SIZES),
    }


def plan_judging(
    items: Sequence[JudgeItem], directory: Path, *, seed: int, fingerprint: Mapping[str, Any]
) -> JudgePlan:
    """Assign opaque ids, shuffle each rubric's items with ``seed``, and cut them into fixed-size batches.

    Writes ``plan.json``, one payload per batch under ``batches/`` and ``mapping.json``.
    """

    rng = random.Random(seed)
    ids: set[str] = set()
    by_rubric: dict[str, list[tuple[str, JudgeItem]]] = {}
    for item in items:
        item_id = _opaque_id(rng, ids)
        by_rubric.setdefault(item.rubric, []).append((item_id, item))
    batches: list[PlannedBatch] = []
    mapping: dict[str, dict[str, Any]] = {}
    payloads: dict[str, dict[str, Any]] = {}
    for rubric_id, entries in by_rubric.items():
        rng.shuffle(entries)
        if rubric_id not in BATCH_SIZES:
            raise EvalInputError(f"no batch size for rubric {rubric_id!r}; add it to BATCH_SIZES")
        size = BATCH_SIZES[rubric_id]
        for start in range(0, len(entries), size):
            chunk = entries[start : start + size]
            batch = PlannedBatch(
                id=f"{rubric_id}-{start // size + 1:04d}", rubric=rubric_id, items=tuple(i for i, _ in chunk)
            )
            batches.append(batch)
            payloads[batch.id] = _payload(rubric_id, chunk)
            for item_id, item in chunk:
                mapping[item_id] = {
                    "rubric": rubric_id,
                    "batch": batch.id,
                    "entries": list(item.entries) if item.entries is not None else None,
                    **item.ref,
                }
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "batches").mkdir(exist_ok=True)
    for batch in batches:
        write_json(directory / "batches" / f"{batch.id}.json", payloads[batch.id], indent=1)
    write_json(directory / "mapping.json", mapping, indent=1)
    write_json(
        directory / "plan.json",
        {
            "schema": PLAN_SCHEMA,
            "inputs": dict(fingerprint),
            "batches": [{"id": b.id, "rubric": b.rubric, "items": list(b.items)} for b in batches],
        },
    )
    return JudgePlan(directory=directory, seed=seed, batches=tuple(batches), mapping=mapping)


def _opaque_id(rng: random.Random, taken: set[str]) -> str:
    while True:
        item_id = f"i{rng.getrandbits(40):010x}"
        if item_id not in taken:
            taken.add(item_id)
            return item_id


def _payload(rubric_id: str, chunk: Sequence[tuple[str, JudgeItem]]) -> dict[str, Any]:
    """One batch's stored items under their opaque ids, with the personas they name; see ``batch_prompt``."""

    personas = sorted({item.content["persona"] for _, item in chunk if item.content.get("persona")})
    payload: dict[str, Any] = {"rubric": rubric_id}
    if personas:
        payload["personas"] = personas  # Replaced by their identity texts in ``batch_prompt``.
    payload["items"] = [{"id": item_id, **item.content} for item_id, item in chunk]
    return payload


def inputs_fingerprint(
    turns_sha256: str, prompt_set: PromptSet, rubrics: RubricSet, seed: int, **extra: Any
) -> dict[str, Any]:
    """What a judge plan depends on; a plan is reused only for the same fingerprint."""

    return {**_inputs_fingerprint(turns_sha256, prompt_set, rubrics, seed), **extra}


def load_plan(directory: Path, fingerprint: Mapping[str, Any], *, seed: int) -> JudgePlan | None:
    """The plan written in ``directory`` before, which must match ``fingerprint``; ``None`` when there is none."""

    plan_file = directory / "plan.json"
    if not plan_file.exists():
        return None
    recorded = json.loads(plan_file.read_text(encoding="utf-8"))
    if recorded.get("schema") != PLAN_SCHEMA or recorded.get("inputs") != dict(fingerprint):
        raise EvalInputError(
            f"{plan_file} was planned from other inputs (turns, prompt set, rubrics, judge model, seed or batch "
            "sizes). A changed rubric or judge starts a new results series: copy the run's manifest.json and "
            "turns.jsonl into a new directory and judge that one"
        )
    mapping = json.loads((directory / "mapping.json").read_text(encoding="utf-8"))
    batches = tuple(PlannedBatch(id=b["id"], rubric=b["rubric"], items=tuple(b["items"])) for b in recorded["batches"])
    return JudgePlan(directory=directory, seed=seed, batches=batches, mapping=mapping)


def load_or_plan(
    run_directory: Path, turns: Sequence[Mapping[str, Any]], turns_sha256: str, prompt_set: PromptSet,
    rubrics: RubricSet, *, seed: int,
) -> JudgePlan:  # fmt: skip
    """The run's judge plan: the one written before, which must match these inputs, or a new one."""

    directory = run_directory / JUDGE_DIR
    fingerprint = inputs_fingerprint(turns_sha256, prompt_set, rubrics, seed)
    plan = load_plan(directory, fingerprint, seed=seed)
    if plan is not None:
        return plan
    return plan_judging(build_items(turns, prompt_set, rubrics), directory, seed=seed, fingerprint=fingerprint)


def batch_prompt(payload: Mapping[str, Any], prompt_set: PromptSet) -> str:
    """The user message for one batch: the payload as JSON, with each persona's identity text and, for the
    expression rubric, the equipped Gestures."""

    message = dict(payload)
    personas = message.pop("personas", None)
    if personas:
        message["personas"] = {persona_id: prompt_set.persona(persona_id).identity for persona_id in personas}
    if payload.get("rubric") == "expression":
        message["equipped_gestures"] = [
            {"name": gesture.name, "description": gesture.description} for gesture in prompt_set.loadout.gestures
        ]
    items = message.pop("items")
    message["items"] = items
    return json.dumps(message, ensure_ascii=False, indent=1)


# --- The Claude CLI --------------------------------------------------------------------------


@dataclass(slots=True)
class ClaudeCli:
    """``claude -p`` with the isolation flags (D7); ``binary`` lets tests use a stub executable."""

    binary: str = "claude"
    model: str = JUDGE_MODEL
    timeout: float = 900.0

    def arguments(self, *, effort: str, system: str, schema: str) -> list[str]:
        return [
            self.binary,
            "-p",
            "--model",
            self.model,
            "--effort",
            effort,
            "--restricted",
            "--strict-mcp-config",
            "--tools",
            "",
            "--disable-slash-commands",
            "--no-session-persistence",
            "--output-format",
            "stream-json",
            "--verbose",
            "--system-prompt",
            system,
            "--json-schema",
            schema,
        ]

    def environment(self) -> dict[str, str]:
        return {key: value for key, value in os.environ.items() if key in _KEPT_ENV or key.startswith("LC_")}

    async def version(self) -> str:
        process = await self._start(self.binary, "--version", cwd=None)
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=60)
        except TimeoutError as exc:
            raise JudgeStopped(f"the Claude CLI {self.binary!r} did not report its version", resumable=False) from exc
        finally:
            await _stop(process)
        return stdout.decode("utf-8", "replace").strip()

    async def _start(self, *argv: str, cwd: str | None) -> asyncio.subprocess.Process:
        if os.sep in argv[0]:
            # A path to the CLI (or a stand-in) is resolved now: calls run from an empty directory.
            argv = (str(Path(argv[0]).resolve()), *argv[1:])
        try:
            # Its own process group, so a timeout or an interruption stops anything the CLI started too.
            return await asyncio.create_subprocess_exec(
                *argv,
                cwd=cwd,
                env=self.environment(),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
        except OSError as exc:
            raise JudgeStopped(f"could not start the Claude CLI {self.binary!r} ({exc})", resumable=False) from exc

    async def call(self, prompt: str, *, effort: str, system: str, schema: str) -> dict[str, Any]:
        """Send one batch; return the start-up event and the result event.

        Raises ``JudgeStopped`` for a usage limit, a sign-in problem or broken isolation, and
        ``JudgeCallError`` for anything a retry may fix.
        """

        with tempfile.TemporaryDirectory(prefix="animama-judge-") as empty:
            process = await self._start(*self.arguments(effort=effort, system=system, schema=schema), cwd=empty)
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(prompt.encode("utf-8")), self.timeout)
            except TimeoutError as exc:
                raise JudgeCallError(f"no answer within {self.timeout:g} s") from exc
            finally:
                await _stop(process)
        events = _events(stdout.decode("utf-8", "replace"))
        init = next((e for e in events if e.get("type") == "system" and e.get("subtype") == "init"), None)
        result = next((e for e in reversed(events) if e.get("type") == "result"), None)
        problem = _stop_reason(events, result, stderr.decode("utf-8", "replace"))
        if problem is not None:
            raise JudgeStopped(problem, resumable=True)
        if init is not None:
            _check_isolation(init, self.model)
        if result is None or result.get("is_error") or result.get("subtype") != "success":
            detail = (result or {}).get("result") or stderr.decode("utf-8", "replace").strip()[-300:]
            raise JudgeCallError(f"the CLI reported an error (exit {process.returncode}): {detail}")
        if init is None:
            raise JudgeStopped("the CLI sent no start-up event, so its isolation cannot be checked", resumable=False)
        return {"init": init, "result": result}


async def _stop(process: asyncio.subprocess.Process) -> None:
    """Kill whatever is left of the call's process group, even after the CLI itself exited, and reap the CLI."""

    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    if process.returncode is None:
        await process.wait()


def _events(text: str) -> list[dict[str, Any]]:
    events = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict):
            events.append(event)
    return events


def _stop_reason(events: Sequence[Mapping[str, Any]], result: Mapping[str, Any] | None, stderr: str) -> str | None:
    for event in events:
        if event.get("type") == "rate_limit_event":
            status = (event.get("rate_limit_info") or {}).get("status")
            if status == "rejected":
                return "the subscription's usage limit was reached"
    text = f"{(result or {}).get('result') or ''}\n{stderr}" if result is None or result.get("is_error") else ""
    if _LIMIT.search(text):
        return "the subscription's usage limit was reached"
    if _AUTH.search(text):
        return "the Claude CLI is not signed in to the subscription (run `claude` and sign in)"
    return None


def _check_isolation(init: Mapping[str, Any], model: str) -> None:
    """Stop when a call loaded anything beyond the rubric and the schema, or ran outside the subscription."""

    problems = []
    if init.get("apiKeySource") != "none":
        problems.append(f"its credential source is {init.get('apiKeySource')!r}, not the subscription sign-in")
    if list(init.get("tools") or ()) not in ([], ["StructuredOutput"]):
        problems.append(f"it offered tools {init.get('tools')}")
    for key in ("mcp_servers", "slash_commands", "skills"):
        if init.get(key):
            problems.append(f"it loaded {key} {init.get(key)}")
    installed = [p for p in init.get("plugins") or () if not str(p.get("source", "")).endswith("@builtin")]
    if installed:
        problems.append(f"it loaded plugins {[p.get('name') for p in installed]}")
    if init.get("model") != model:
        problems.append(f"it ran {init.get('model')!r}, not {model!r}")
    if problems:
        raise JudgeStopped("judge isolation broken: " + "; ".join(problems), resumable=False)


# --- Running -----------------------------------------------------------------------------


@dataclass(slots=True)
class JudgeRun:
    """What a ``run_judging`` call did; ``stopped`` holds the reason when it stopped early."""

    completed: int = 0
    skipped: int = 0
    missing: int = 0
    stopped: str | None = None
    resumable: bool = True
    """Whether rerunning the same command can continue after a stop."""
    seconds: list[float] = field(default_factory=list)
    """Wall time of each completed batch."""


def run_judging(
    plan: JudgePlan,
    prompt_set: PromptSet,
    rubrics: RubricSet,
    *,
    effort: str,
    cli: ClaudeCli,
    concurrency: int = DEFAULT_CONCURRENCY,
    select: Callable[[PlannedBatch], bool] = lambda batch: True,
    clock: Callable[[], float] = time.monotonic,
) -> JudgeRun:
    """Judge every selected batch at ``effort`` that has no completed result yet.

    Call it from the main thread: while it runs it handles SIGTERM and SIGHUP itself, then resets them to the
    default handling, not to a handler the caller had installed.
    """

    if effort not in EFFORTS:
        raise EvalInputError(f"--effort must be one of {', '.join(EFFORTS)}")
    return asyncio.run(_run(plan, prompt_set, rubrics, effort, cli, concurrency, select, clock))


async def _run(
    plan: JudgePlan,
    prompt_set: PromptSet,
    rubrics: RubricSet,
    effort: str,
    cli: ClaudeCli,
    concurrency: int,
    select: Callable[[PlannedBatch], bool],
    clock: Callable[[], float],
) -> JudgeRun:
    outcome = JudgeRun()
    try:
        version = await cli.version()
    except JudgeStopped as exc:
        outcome.stopped, outcome.resumable = str(exc), exc.resumable
        return outcome
    real = _is_claude_code(version)
    instructions = _user_instructions() if real else None
    if instructions is not None:
        # Restricted mode ignores settings files, not the user's own CLAUDE.md, which every session loads.
        outcome.stopped = f"{instructions} would reach the judge; move it aside while judging"
        outcome.resumable = False
        return outcome
    pending = []
    for batch in plan.batches:
        if not select(batch):
            continue
        if _completed(plan.result_path(batch, effort), rubrics, real=real):
            outcome.skipped += 1
        else:
            pending.append(batch)
    if not pending:
        return outcome
    gate = asyncio.Semaphore(concurrency)

    async def judge(batch: PlannedBatch) -> None:
        async with gate:
            if outcome.stopped is not None:
                return
            try:
                record = await _judge_batch(plan, batch, prompt_set, rubrics.get(batch.rubric), rubrics, effort,
                                            cli, version, clock)  # fmt: skip
            except JudgeStopped as exc:
                if outcome.stopped is None:
                    outcome.stopped, outcome.resumable = str(exc), exc.resumable
                return
            write_json(plan.result_path(batch, effort), record, indent=1)
            if record["status"] == "ok":
                outcome.completed += 1
                outcome.seconds.append(record["seconds"])
            else:
                outcome.missing += 1

    # SIGTERM or SIGHUP (a closed terminal, a ``timeout`` wrapper) cancels the run, so every call's process group
    # is killed rather than left judging on the subscription after the judge is gone.
    loop = asyncio.get_running_loop()
    main = asyncio.current_task()
    signalled: list[signal.Signals] = []

    def on_signal(number: signal.Signals) -> None:
        signalled.append(number)
        if main is not None:
            main.cancel()

    for number in (signal.SIGTERM, signal.SIGHUP):
        loop.add_signal_handler(number, on_signal, number)
    try:
        await asyncio.gather(*(judge(batch) for batch in pending))
    except asyncio.CancelledError:
        if not signalled:
            raise
        outcome.stopped, outcome.resumable = f"stopped by {signalled[0].name}", True
    finally:
        for number in (signal.SIGTERM, signal.SIGHUP):
            loop.remove_signal_handler(number)
    return outcome


def _is_claude_code(version: str) -> bool:
    """Whether ``claude --version`` came from the real CLI (``2.1.310 (Claude Code)``) rather than a stand-in."""

    return version.endswith("(Claude Code)")


def _user_instructions() -> Path | None:
    """The user's own ``CLAUDE.md``, which the real CLI loads into every session, when there is one."""

    directory = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    path = directory / "CLAUDE.md"
    return path if path.exists() else None


def _completed(path: Path, rubrics: RubricSet, *, real: bool) -> bool:
    """Whether a batch already has a completed result in this series; another series' result is an error, and so
    is mixing the real CLI's results with a stand-in's."""

    if not path.exists():
        return False
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return False
    if not isinstance(record, dict) or record.get("status") != "ok":
        return False
    if record.get("model") != JUDGE_MODEL or record.get("rubrics_sha256") != rubrics.sha256:
        raise EvalInputError(f"{path} was judged by another model or rubric version; judge a copy of the run instead")
    if _is_claude_code(str(record.get("cli_version"))) != real:
        judged = "the real Claude CLI" if real is False else "a stand-in CLI"
        raise EvalInputError(f"{path} was judged by {judged}; judge a copy of the run instead")
    return True


async def _judge_batch(
    plan: JudgePlan,
    batch: PlannedBatch,
    prompt_set: PromptSet,
    rubric: Rubric,
    rubrics: RubricSet,
    effort: str,
    cli: ClaudeCli,
    version: str,
    clock: Callable[[], float],
) -> dict[str, Any]:
    try:
        payload = json.loads(plan.payload_path(batch).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise EvalInputError(f"cannot read the planned batch {plan.payload_path(batch)} ({exc})") from exc
    prompt = batch_prompt(payload, prompt_set)
    system, schema = system_prompt(rubric), schema_text(rubric)
    expected = {item_id: plan.mapping[item_id].get("entries") for item_id in batch.items}
    started_at, started = _now(), clock()
    attempts: list[dict[str, Any]] = []
    for _attempt in range(MAX_ATTEMPTS):
        attempt_started = clock()
        try:
            call = await cli.call(prompt, effort=effort, system=system, schema=schema)
            result = call["result"]
            output = result.get("structured_output")
            if output is None:
                output = json.loads(result.get("result") or "null")
            scores = validate_output(rubric, output, expected)
        except (JudgeCallError, JudgeOutputError, ValueError) as exc:
            attempts.append({"seconds": round(clock() - attempt_started, 3), "error": str(exc)[:500]})
            continue
        attempts.append({"seconds": round(clock() - attempt_started, 3), "error": None})
        record = _record(batch, rubrics, effort, cli, version, started_at, clock() - started, attempts, "ok",
                         scores, call)  # fmt: skip
        break
    else:
        record = _record(batch, rubrics, effort, cli, version, started_at, clock() - started, attempts, "missing",
                         [], None)  # fmt: skip
    # The batch file holds persona ids; the prompt sent replaces them with their texts (and lists the Gestures).
    record["prompt_sha256"] = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    return record


def _record(
    batch: PlannedBatch,
    rubrics: RubricSet,
    effort: str,
    cli: ClaudeCli,
    version: str,
    started_at: str,
    seconds: float,
    attempts: list[dict[str, Any]],
    status: str,
    scores: list[dict[str, Any]],
    call: Mapping[str, Any] | None,
) -> dict[str, Any]:
    result = (call or {}).get("result") or {}
    return {
        "schema": RESULT_SCHEMA,
        "batch": batch.id,
        "rubric": batch.rubric,
        "rubrics_version": rubrics.version,
        "rubrics_sha256": rubrics.sha256,
        "model": cli.model,
        "served_models": sorted((result.get("modelUsage") or {}).keys()),
        "effort": effort,
        "cli_version": version,
        "status": status,
        "items": len(batch.items),
        "results": scores,
        "attempts": attempts,
        "started_at": started_at,
        "finished_at": _now(),
        "seconds": round(seconds, 3),
        "usage": result.get("usage"),
        "list_cost_usd": result.get("total_cost_usd"),
    }


def _now() -> str:
    return datetime.now(UTC).isoformat()
