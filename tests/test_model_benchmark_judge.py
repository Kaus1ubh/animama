"""Blind judging through the Claude CLI (scripts/evals/benchmark/judge.py, issue #470 spec R12).

A stub executable stands in for ``claude``: it logs each call's arguments,
directory and environment, answers in the CLI's stream-json format, and can
fail in the ways the real CLI does. Its settings sit in a file beside it, since
a judge call inherits only an allowlist of environment variables.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import sys
import threading
import time
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

import pytest

from scripts.evals.benchmark import cli, configs, judge, judge_items, planner, prompt_set, rubrics
from scripts.evals.benchmark.results import read_turns
from scripts.evals.core.inputs import EvalInputError

ROOT = Path(__file__).resolve().parents[1]
INPUTS = ROOT / "docs" / "benchmarks" / "inputs"
FIXTURE_RUN = Path(__file__).parent / "fixtures" / "model_benchmark" / "judge_run"
LABELS = (
    "AnthropicMessagesHTTPAgent",
    "OpenAIResponsesHTTPAgent",
    "claude-haiku",
    "gpt-6-luna",
    "@none",
    "@low",
    "remember_only",
    "memories_md_only",
    # Provider-specific memory tools and argument shapes would reveal the model too.
    "apply_patch",
    "memory_write_file",
    "update_file",
    "replacements",
)
HIDDEN_KEYS = {"configuration", "model_provider_id", "effort", "arm", "language", "unit_id", "pair_id", "held_out"}

STUB = """#!{python}
import json, os, pathlib, sys, time
args = sys.argv[1:]
config = json.loads((pathlib.Path(__file__).parent / "stub.json").read_text())
if args == ["--version"]:
    print(config.get("version", "9.9.9 (stub)"))
    sys.exit(0)
state = pathlib.Path(config["state"])
calls = int(state.read_text()) if state.exists() else 0
state.write_text(str(calls + 1))
active = pathlib.Path(config["active"])
active.mkdir(exist_ok=True)
marker = active / str(os.getpid())
marker.touch()
concurrent = len(list(active.iterdir()))
prompt = sys.stdin.read()
with open(config["log"], "a") as log:
    log.write(json.dumps({{"argv": args, "cwd": os.getcwd(), "cwd_files": os.listdir(os.getcwd()),
                          "env": sorted(os.environ), "concurrent": concurrent, "prompt": prompt}}) + "\\n")
time.sleep(config["sleep"])
marker.unlink()
mode = config["mode"]
schema = json.loads(args[args.index("--json-schema") + 1])
fields = schema["properties"]["items"]["items"]["properties"]
batch = json.loads(prompt)
def result(item):
    if "entries" in fields:
        entries = [{{"entry": e["id"], "present": False, "evidence": ""}} for e in item["checklist"]]
        return {{"id": item["id"], "entries": entries}}
    return {{"id": item["id"], **{{key: 3 for key in fields if key != "id"}}}}
output = {{"items": [result(item) for item in batch["items"]]}}
init = {{"type": "system", "subtype": "init", "tools": ["StructuredOutput"], "mcp_servers": [], "slash_commands": [],
        "skills": [], "plugins": [], "model": args[args.index("--model") + 1], "apiKeySource": "none"}}
if mode == "leak":
    init["mcp_servers"] = [{{"name": "notes"}}]
if mode == "api-key":
    init["apiKeySource"] = "ANTHROPIC_API_KEY"
if mode == "rejected":
    print(json.dumps({{"type": "rate_limit_event", "rate_limit_info": {{"status": "rejected"}}}}))
if mode == "signed-out":
    print(json.dumps({{"type": "result", "subtype": "success", "is_error": True,
                      "result": "Not logged in · Please run /login"}}))
    sys.exit(1)
print(json.dumps(init))
if mode == "limit" or (mode == "limit-after-1" and calls >= 1):
    print(json.dumps({{"type": "result", "subtype": "success", "is_error": True,
                      "result": "Claude AI usage limit reached|1793030000"}}))
    sys.exit(1)
if mode == "malformed" or (mode == "malformed-once" and calls == 0):
    output = {{"items": [{{"id": "not-in-the-batch"}}]}}
print(json.dumps({{"type": "result", "subtype": "success", "is_error": False, "result": json.dumps(output),
                  "structured_output": output, "modelUsage": {{"claude-opus-5-5": {{}}}}, "total_cost_usd": 0.01,
                  "usage": {{"input_tokens": 1, "output_tokens": 1}}}}))
"""


@pytest.fixture(scope="module")
def tracked() -> prompt_set.PromptSet:
    return prompt_set.load_prompt_set(INPUTS / "prompts.json")


@pytest.fixture(scope="module")
def rubric_set() -> rubrics.RubricSet:
    return rubrics.load_rubrics(INPUTS / "rubrics.json")


class Stub:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.path = directory / "claude"
        self.path.write_text(STUB.format(python=sys.executable), encoding="utf-8")
        self.path.chmod(0o755)
        self.log = directory / "calls.jsonl"
        self.mode("ok")

    def mode(self, mode: str, *, sleep: float = 0, version: str = "9.9.9 (stub)") -> None:
        config = {
            "version": version,
            "log": str(self.log),
            "state": str(self.directory / "state"),
            "active": str(self.directory / "active"),
            "mode": mode,
            "sleep": sleep,
        }
        (self.directory / "stub.json").write_text(json.dumps(config), encoding="utf-8")

    def calls(self) -> list[dict[str, Any]]:
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]

    def cli(self) -> judge.ClaudeCli:
        return judge.ClaudeCli(binary=str(self.path), timeout=60)


def _stopped(pid: int, *, within: float = 5.0) -> bool:
    """Whether a stub process is gone within ``within`` seconds.

    The judge sends SIGKILL before it returns, but the process can take a moment to exit and be reaped.
    """

    deadline = time.monotonic() + within
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        if time.monotonic() > deadline:
            return False
        time.sleep(0.05)


@pytest.fixture
def stub(tmp_path: Path) -> Stub:
    (tmp_path / "stub").mkdir()
    return Stub(tmp_path / "stub")


@pytest.fixture
def run_dir(tmp_path: Path) -> Path:
    shutil.copytree(FIXTURE_RUN, tmp_path / "run")
    return tmp_path / "run"


def _plan(run: Path, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet, seed: int = 470) -> judge.JudgePlan:
    turns = list(read_turns(run))
    digest = hashlib.sha256((run / "turns.jsonl").read_bytes()).hexdigest()
    return judge.load_or_plan(run, turns, digest, tracked, rubric_set, seed=seed)


# --- Items and blind batches ---------------------------------------------------------------


def _record(**fields: Any) -> dict[str, Any]:
    base = {
        "configuration": "AnthropicMessagesHTTPAgent:claude-haiku-5-5@none",
        "model_provider_id": "AnthropicMessagesHTTPAgent:claude-haiku-5-5",
        "effort": "none",
        "persona": "annie",
        "language": "en",
        "repeat": 1,
        "error": None,
        "speech": "That sounds lovely.",
        "display": None,
        "emotional_tone": "happy",
        "emotional_intensity": 4,
        "gesture": None,
        "remember": None,
        "speech_check": {"tags": []},
    }
    return {**base, **fields}


def _all_kinds(tracked: prompt_set.PromptSet) -> list[dict[str, Any]]:
    """Records of every judged kind across two configurations, two arms and both languages."""

    luna = {
        "configuration": "OpenAIResponsesHTTPAgent:gpt-6-luna@low",
        "model_provider_id": "OpenAIResponsesHTTPAgent:gpt-6-luna",
        "effort": "low",
    }
    records: list[dict[str, Any]] = [_record(kind="warmup", unit_id="warmup", turn=1, message="Hello!")]
    for item in [item for item in tracked.items if item.id in {"sadness-pet-loss", "sadness-pet-loss-ja"}]:
        for overrides in ({}, luna):
            tags = ["sighs"] if item.language == "ja" else []
            records.append(
                _record(kind="single", area="core", language=item.language, unit_id=item.id, turn=1,
                        message=item.message, speech_check={"tags": tags}, speech="[sighs] I'm so sorry.",
                        pair_id=item.pair_id, **overrides)
            )  # fmt: skip
    short = next(chat for chat in tracked.scripted_chats if chat.id == "smoke-short-chat")
    for overrides, turns in (({}, short.turns), (luna, short.turns[:3])):  # The second chat stops early.
        for index, message in enumerate(turns, start=1):
            records.append(_record(kind="chat", area="long_chat", unit_id=short.id, turn=index, message=message,
                                   **overrides))  # fmt: skip
    records.append(_record(kind="chat", area="long_chat", unit_id=short.id, turn=4, message="x", error="timeout",
                           speech=None, **luna))  # fmt: skip
    chat = next(chat for chat in tracked.memory_chats if chat.id == "new-job")
    # The same insertion, as the store diff records it, whichever tool made it.
    insertion = [{"path": "[self]/MEMORIES.md", "diff": "@@ -3,0 +4 @@\n+- They start the new job on the 10th."}]
    for arm in ("remember_only", "both"):
        call = {
            "tool": "memory_apply_patch",
            "path": "[self]/MEMORIES.md",
            "ok": arm == "both",
            "code": None if arm == "both" else "read_only",
            "arguments": {"replacements": [{"old_text": "- We met.", "new_text": "- We met.\n- New job."}]},
        }
        records.append(_record(kind="memory", area="memory", arm=arm, unit_id=chat.id, turn=1,
                               message=chat.turns[0], tool_calls=[call], remember="Starts the new job.",
                               memory_changes=insertion if arm == "both" else []))  # fmt: skip
        if arm == "both":
            # An OpenAI Responses row makes the same edit through native apply_patch with a V4A diff.
            patch = {
                "tool": "apply_patch",
                "path": "[self]/MEMORIES.md",
                "ok": True,
                "code": None,
                "arguments": {"type": "update_file", "diff": "@@\n - We met.\n+- New job."},
            }
            records.append(_record(kind="memory", area="memory", arm=arm, unit_id=chat.id, turn=1,
                                   message=chat.turns[0], tool_calls=[patch], remember="Starts the new job.",
                                   memory_changes=insertion, **luna))  # fmt: skip
        for index, probe in enumerate(chat.recall, start=1):
            records.append(_record(kind="recall", area="memory", arm=arm, unit_id=chat.id, turn=index,
                                   message=probe.message, probe_id=probe.id, expect=list(probe.expect),
                                   checklist=list(probe.checklist)))  # fmt: skip
        labels = {key: _record()[key] for key in ("configuration", "model_provider_id", "effort")}
        records.append({
            **labels, "kind": "capture", "area": "memory", "arm": arm, "persona": "annie", "language": "en",
            "unit_id": chat.id, "checklist": [{"id": e.id, "kind": e.kind, "text": e.text} for e in chat.checklist],
            "snapshot": {"files": [{"path": "MEMORIES.md", "anima": True, "content": "# Memories"},
                                   {"path": "PROFILE.md", "anima": False, "content": "# Profile"}],
                         "episodes": [{"text": "Starts the new job on the 10th.", "status": "pending"}]},
        })  # fmt: skip
    run = next(run for run in tracked.manager_runs if run.kind == "general")
    records.append({
        "configuration": "AnthropicMessagesHTTPAgent:claude-haiku-5-5", "model_provider_id": "x", "effort": "medium",
        "kind": "memory_manager", "area": "memory_manager", "unit_id": run.id, "persona": run.persona, "error": None,
        "result": {"status": "active", "kind": "general",
                   "messages": [{"role": "user", "content": run.message}, {"role": "assistant", "content": "Done."}],
                   "approvals": [{"status": "approved", "operation": "update", "target_path": "PROFILE.md",
                                  "summary": "Adds tea", "unified_diff": "+- Likes green tea."}]},
    })  # fmt: skip
    return records


def _keys(value: Any) -> Iterator[str]:
    if isinstance(value, Mapping):
        for key, inner in value.items():
            yield str(key)
            yield from _keys(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from _keys(inner)


def test_items_cover_each_rubric_and_hide_the_run(
    tmp_path: Path, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet
) -> None:
    records = _all_kinds(tracked)
    items = judge_items.build_items(records, tracked, rubric_set)
    counts: dict[str, int] = {}
    for item in items:
        counts[item.rubric] = counts.get(item.rubric, 0) + 1

    chat = next(chat for chat in tracked.memory_chats if chat.id == "new-job")
    open_probes = sum(1 for probe in chat.recall if not probe.expect)
    assert counts == {
        "reply": 4 + 6 + 3 + 3 + 2 * len(chat.recall),  # singles, chat turns that replied, memory and recall
        "expression": 4 + 6 + 3,
        "audio_tags": 2,  # Only the Japanese replies carry a tag.
        "long_chat": 1,  # The chat that stopped early is not judged as a whole.
        "memory_turn": 3,
        "capture": 2,
        "recall": 2 * open_probes,  # Probes with expected phrases are matched, not judged.
        "memory_manager": 1,
    }
    captures = [item.content["snapshot"] for item in items if item.rubric == "capture"]
    assert [sorted(snapshot) for snapshot in captures] == [["MEMORIES.md", "episode_notes", "shared_files"]] * 2
    turns = [item.content for item in items if item.rubric == "memory_turn"]
    # A write reads the same from either provider: the action, path and outcome, and the store's own diff.
    assert [turn["memory_tool_calls"] for turn in turns] == [
        [{"action": "write", "path": "[self]/MEMORIES.md", "outcome": "refused"}],
        [{"action": "write", "path": "[self]/MEMORIES.md", "outcome": "succeeded"}],
        [{"action": "write", "path": "[self]/MEMORIES.md", "outcome": "succeeded"}],
    ]
    assert turns[1] == turns[2]  # The Haiku and Luna turns made the same edit and look the same.

    plan = judge.plan_judging(items, tmp_path / "judge", seed=7, fingerprint={})
    for batch in plan.batches:
        assert len(batch.items) <= judge.BATCH_SIZES[batch.rubric]
        payload = json.loads(plan.payload_path(batch).read_text(encoding="utf-8"))
        text = judge.batch_prompt(payload, tracked)
        assert not any(label in text for label in LABELS), batch.id
        assert not HIDDEN_KEYS & set(_keys(json.loads(text))), batch.id
    mapping = json.loads((tmp_path / "judge" / "mapping.json").read_text(encoding="utf-8"))
    assert {entry["configuration"] for entry in mapping.values()} >= {records[1]["configuration"]}


def test_the_shuffle_is_seeded_and_a_plan_is_reused_only_for_its_inputs(
    tmp_path: Path, run_dir: Path, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet
) -> None:
    turns = list(read_turns(run_dir))
    items = judge_items.build_items(turns, tracked, rubric_set)
    first = judge.plan_judging(items, tmp_path / "a", seed=1, fingerprint={})
    again = judge.plan_judging(items, tmp_path / "b", seed=1, fingerprint={})
    other = judge.plan_judging(items, tmp_path / "c", seed=2, fingerprint={})

    assert first.batches == again.batches and first.batches != other.batches
    planned = _plan(run_dir, tracked, rubric_set)
    assert _plan(run_dir, tracked, rubric_set).batches == planned.batches
    changed = rubrics.RubricSet(version=rubric_set.version, sha256="0" * 64, rubrics=rubric_set.rubrics)
    with pytest.raises(EvalInputError, match="planned from other inputs"):
        _plan(run_dir, tracked, changed)


@pytest.mark.parametrize(
    ("output", "message"),
    [
        ({"items": [{"id": "a", "tag_fit": 3}, {"id": "zz", "tag_fit": 3}]}, "unknown item"),
        ({"items": [{"id": "a", "tag_fit": 3}, {"id": "a", "tag_fit": 3}]}, "two results"),
        ({"items": [{"id": "a", "tag_fit": 3}]}, "no result for 1"),
        ({"items": [{"id": "a", "tag_fit": 6}, {"id": "b", "tag_fit": 3}]}, "integer from 1 to 5"),
        ({"items": [{"id": "a", "tag_fit": True}, {"id": "b", "tag_fit": 3}]}, "integer from 1 to 5"),
        ({"items": [{"id": "a"}, {"id": "b", "tag_fit": 3}]}, "expected 'id' and the scores"),
        ({"results": []}, "one 'items' list"),
    ],
)
def test_scored_output_must_match_the_batch(output: Any, message: str, rubric_set: rubrics.RubricSet) -> None:
    with pytest.raises(rubrics.JudgeOutputError, match=message):
        rubrics.validate_output(rubric_set.get("audio_tags"), output, {"a": None, "b": None})


def test_capture_output_must_cover_exactly_the_checklist(rubric_set: rubrics.RubricSet) -> None:
    capture = rubric_set.get("capture")
    entry = {"entry": "kyoto", "present": True, "evidence": "Moving to Kyoto"}

    assert rubrics.validate_output(capture, {"items": [{"id": "a", "entries": [entry]}]}, {"a": ["kyoto"]})
    with pytest.raises(rubrics.JudgeOutputError, match="exactly the item's checklist"):
        rubrics.validate_output(capture, {"items": [{"id": "a", "entries": []}]}, {"a": ["kyoto"]})
    with pytest.raises(rubrics.JudgeOutputError, match="boolean 'present'"):
        rubrics.validate_output(
            capture, {"items": [{"id": "a", "entries": [{**entry, "present": "yes"}]}]}, {"a": ["kyoto"]}
        )


def test_the_schema_and_prompt_follow_the_rubric(rubric_set: rubrics.RubricSet) -> None:
    reply = rubric_set.get("reply")
    schema = rubrics.output_schema(reply)
    fields = schema["properties"]["items"]["items"]

    assert fields["required"] == ["id", *(criterion.key for criterion in reply.criteria)]
    assert all(criterion.anchors["5"] in rubrics.system_prompt(reply) for criterion in reply.criteria)
    assert (
        "present"
        in rubrics.output_schema(rubric_set.get("capture"))["properties"]["items"]["items"]["properties"]["entries"][
            "items"
        ]["properties"]
    )


# --- Running the judge ---------------------------------------------------------------------


def _judge(
    plan: judge.JudgePlan,
    tracked: prompt_set.PromptSet,
    rubric_set: rubrics.RubricSet,
    stub: Stub,
    *,
    concurrency: int = 1,
    only: str | None = None,
) -> judge.JudgeRun:
    return judge.run_judging(
        plan,
        tracked,
        rubric_set,
        effort="medium",
        cli=stub.cli(),
        concurrency=concurrency,
        select=lambda batch: only is None or batch.id == only,
    )


def test_judging_scores_every_batch_then_resumes_without_rescoring(
    run_dir: Path, stub: Stub, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet
) -> None:
    plan = _plan(run_dir, tracked, rubric_set)

    first = _judge(plan, tracked, rubric_set, stub)
    calls = len(stub.calls())
    again = _judge(plan, tracked, rubric_set, stub)

    assert (first.completed, first.missing, first.stopped) == (len(plan.batches), 0, None)
    assert (again.completed, again.skipped) == (0, len(plan.batches)) and len(stub.calls()) == calls
    record = json.loads(plan.result_path(plan.batches[0], "medium").read_text(encoding="utf-8"))
    assert record["status"] == "ok" and record["served_models"] == ["claude-opus-5-5"]
    assert record["cli_version"] == "9.9.9 (stub)" and record["rubrics_version"] == rubric_set.version
    assert [result["id"] for result in record["results"]] == list(plan.batches[0].items)


def test_malformed_output_is_retried_then_recorded_as_missing(
    run_dir: Path, stub: Stub, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet
) -> None:
    plan = _plan(run_dir, tracked, rubric_set)
    batch = plan.batches[0]

    stub.mode("malformed")
    missing = _judge(plan, tracked, rubric_set, stub, only=batch.id)
    record = json.loads(plan.result_path(batch, "medium").read_text(encoding="utf-8"))
    assert missing.missing == 1 and record["status"] == "missing" and record["results"] == []
    assert len(record["attempts"]) == judge.MAX_ATTEMPTS and "unknown item" in record["attempts"][0]["error"]

    # A rerun tries a missing batch again; one bad answer is retried and the second is kept.
    (stub.path.parent / "state").unlink()
    stub.mode("malformed-once")
    retried = _judge(plan, tracked, rubric_set, stub, only=batch.id)
    record = json.loads(plan.result_path(batch, "medium").read_text(encoding="utf-8"))
    assert retried.completed == 1 and record["status"] == "ok" and len(record["attempts"]) == 2


def test_a_usage_limit_stops_judging_and_a_rerun_resumes(
    run_dir: Path, stub: Stub, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet
) -> None:
    plan = _plan(run_dir, tracked, rubric_set)

    stub.mode("limit-after-1")
    stopped = _judge(plan, tracked, rubric_set, stub)
    stub.mode("ok")
    resumed = _judge(plan, tracked, rubric_set, stub)

    assert stopped.completed == 1 and stopped.stopped is not None and "usage limit" in stopped.stopped
    assert stopped.resumable is True
    assert sum(plan.result_path(batch, "medium").exists() for batch in plan.batches) == len(plan.batches)
    assert (resumed.completed, resumed.skipped) == (len(plan.batches) - 1, 1)


def test_each_call_runs_isolated_on_the_subscription(
    run_dir: Path, stub: Stub, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet,
    monkeypatch: pytest.MonkeyPatch,
) -> None:  # fmt: skip
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-not-sent")
    plan = _plan(run_dir, tracked, rubric_set)

    _judge(plan, tracked, rubric_set, stub, only=plan.batches[0].id)
    [call] = stub.calls()
    argv = call["argv"]
    assert argv[argv.index("--model") + 1] == judge.JUDGE_MODEL and argv[argv.index("--effort") + 1] == "medium"
    for flag in ("--restricted", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"):
        assert flag in argv
    assert argv[argv.index("--tools") + 1] == ""
    assert call["cwd_files"] == [] and not call["cwd"].startswith(str(ROOT))
    # Only the allowlisted variables reach the CLI: no API key, and no settings of the session it ran from. macOS adds
    # its own ``__CF_USER_TEXT_ENCODING`` to every process.
    inherited = {name for name in call["env"] if not name.startswith(("LC_", "__CF_"))}
    assert inherited <= set(judge._KEPT_ENV) and "ANTHROPIC_API_KEY" not in call["env"]
    assert "sk-ant-test-not-sent" not in call["prompt"]

    for mode in ("leak", "api-key"):
        stub.mode(mode)
        broken = _judge(plan, tracked, rubric_set, stub, only=plan.batches[1].id)
        assert broken.stopped is not None and "isolation" in broken.stopped and broken.resumable is False, mode
        assert not plan.result_path(plan.batches[1], "medium").exists()


@pytest.mark.parametrize(("mode", "reason"), [("rejected", "usage limit"), ("signed-out", "not signed in")])
def test_a_rejected_rate_limit_or_a_signed_out_cli_stops_judging(
    run_dir: Path, stub: Stub, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet, mode: str, reason: str
) -> None:
    plan = _plan(run_dir, tracked, rubric_set)
    stub.mode(mode)

    outcome = _judge(plan, tracked, rubric_set, stub)

    assert outcome.completed == 0 and outcome.stopped is not None and reason in outcome.stopped
    assert not any(plan.result_path(batch, "medium").exists() for batch in plan.batches)


def test_a_call_past_its_timeout_is_killed_and_retried(
    run_dir: Path, stub: Stub, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet
) -> None:
    plan = _plan(run_dir, tracked, rubric_set)
    stub.mode("ok", sleep=5)
    cli_ = judge.ClaudeCli(binary=str(stub.path), timeout=0.5)

    outcome = judge.run_judging(
        plan, tracked, rubric_set, effort="medium", cli=cli_, select=lambda batch: batch.id == plan.batches[0].id
    )

    record = json.loads(plan.result_path(plan.batches[0], "medium").read_text(encoding="utf-8"))
    assert (
        outcome.missing == 1
        and [attempt["error"] for attempt in record["attempts"]] == ["no answer within 0.5 s"] * judge.MAX_ATTEMPTS
    )
    # Each killed stub left its marker (named by its process id) behind; none of those processes still runs.
    assert all(_stopped(int(marker.name)) for marker in (stub.directory / "active").iterdir())


def test_sigterm_stops_judging_and_kills_the_running_calls(
    run_dir: Path, stub: Stub, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet
) -> None:
    plan = _plan(run_dir, tracked, rubric_set)
    stub.mode("ok", sleep=30)
    active = stub.directory / "active"
    stop = threading.Event()

    def send_sigterm() -> None:
        # Signal only once both calls are running: the judge then handles SIGTERM itself.
        while not stop.is_set():
            if active.exists() and len(list(active.iterdir())) == 2:
                os.kill(os.getpid(), signal.SIGTERM)
                return
            stop.wait(0.05)

    sender = threading.Thread(target=send_sigterm)
    sender.start()
    try:
        outcome = _judge(plan, tracked, rubric_set, stub, concurrency=2)
    finally:
        stop.set()
        sender.join()

    assert outcome.stopped == "stopped by SIGTERM" and outcome.resumable and outcome.completed == 0
    markers = list((stub.directory / "active").iterdir())
    assert len(markers) == 2
    assert all(_stopped(int(marker.name)) for marker in markers)


def test_judging_runs_at_most_the_concurrency_at_once(
    run_dir: Path, stub: Stub, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet
) -> None:
    plan = _plan(run_dir, tracked, rubric_set)
    stub.mode("ok", sleep=0.4)

    outcome = _judge(plan, tracked, rubric_set, stub, concurrency=2)

    assert outcome.completed == len(plan.batches) == 3
    assert max(call["concurrent"] for call in stub.calls()) == 2


def test_the_judge_command_checks_the_prompt_set_and_reports_missing_scores(
    run_dir: Path, stub: Stub, capsys: pytest.CaptureFixture[str]
) -> None:
    arguments = ["judge", "--run-dir", str(run_dir), "--effort", "high", "--claude", str(stub.path)]

    wrong = cli.main(
        [*arguments, "--prompts", str(Path(__file__).parent / "fixtures" / "model_benchmark" / "prompts.json")]
    )
    assert wrong == 2 and "is not the run's prompt set" in capsys.readouterr().err

    assert cli.main([*arguments, "--prompts", str(INPUTS / "prompts.json")]) == 0
    stub.mode("malformed")
    (run_dir / "judge" / "high" / "reply-0001.json").unlink()
    assert cli.main([*arguments, "--prompts", str(INPUTS / "prompts.json"), "--rubric", "reply"]) == 1
    stub.mode("limit")
    assert cli.main([*arguments, "--prompts", str(INPUTS / "prompts.json")]) == 3
    assert "rerun the same command to resume" in capsys.readouterr().err

    prompts = ["--prompts", str(INPUTS / "prompts.json")]
    assert cli.main([*arguments, *prompts, "--batch", "reply-001"]) == 2
    assert "no planned batches for reply-001" in capsys.readouterr().err
    missing = ["judge", "--run-dir", str(run_dir), "--effort", "high", "--claude", str(run_dir / "no-such-claude")]
    assert cli.main([*missing, *prompts, "--rubric", "reply"]) == 3
    assert "could not start the Claude CLI" in capsys.readouterr().err

    # A result from another rubric series is never mixed into this one.
    result = run_dir / "judge" / "high" / "expression-0001.json"
    result.write_text(json.dumps({**json.loads(result.read_text()), "rubrics_sha256": "0" * 64}), encoding="utf-8")
    assert cli.main([*arguments, *prompts]) == 2
    assert "another model or rubric version" in capsys.readouterr().err


def test_a_run_still_marked_running_is_judged_only_when_allowed(
    run_dir: Path, stub: Stub, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    (run_dir / "manifest.json").write_text(json.dumps({**manifest, "aborted": "running"}), encoding="utf-8")
    arguments = ["judge", "--run-dir", str(run_dir), "--effort", "medium", "--claude", str(stub.path)]
    arguments += ["--prompts", str(INPUTS / "prompts.json")]

    assert cli.main(arguments) == 2 and "--allow-unfinished" in capsys.readouterr().err
    assert cli.main([*arguments, "--allow-unfinished"]) == 0


def test_the_plan_estimates_judging(tracked: prompt_set.PromptSet) -> None:
    plan = planner.BenchmarkPlan(
        prompt_set=tracked.for_tier("smoke"),
        configurations=tuple(configs.standard_configurations(configs.builtin_chat_rows())),
        tier="smoke",
    )
    counts = planner.judged_items(plan, rubrics.load_rubrics(INPUTS / "rubrics.json"))
    lines, seconds = planner.judge_estimate(
        plan, rubrics.load_rubrics(INPUTS / "rubrics.json"), effort="high", concurrency=2
    )

    smoke = tracked.for_tier("smoke")
    singles = len(smoke.items) * len(smoke.personas)
    assert counts["expression"] == 4 * (singles + sum(len(chat.turns) for chat in smoke.scripted_chats))
    assert counts["memory_manager"] == 2 * len(smoke.manager_runs)  # Once per catalog row.
    batches = {rubric: -(-count // judge.BATCH_SIZES[rubric]) for rubric, count in counts.items() if count}
    per_batch = {
        rubric: planner.JUDGE_SECONDS_PER_BATCH["high"].get(rubric, planner.UNMEASURED_SECONDS_PER_BATCH["high"])
        for rubric in batches
    }
    assert seconds == sum(batches[rubric] * per_batch[rubric] for rubric in batches) / 2
    assert lines[0].startswith(f"Judging: {sum(counts.values())} items in {sum(batches.values())} batches")
    assert any("9,200 input tokens (measured)" in line for line in lines)


def test_the_tracked_stub_cli_judges_a_whole_run_for_rehearsals(
    run_dir: Path, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan = _plan(run_dir, tracked, rubric_set)
    # A relative path works too: it is resolved before calls start in their empty directories.
    monkeypatch.chdir(ROOT)
    stub_cli = judge.ClaudeCli(binary=os.path.join("scripts", "evals", "benchmark", "stub_claude.py"), timeout=60)

    outcome = judge.run_judging(plan, tracked, rubric_set, effort="medium", cli=stub_cli)

    assert (outcome.completed, outcome.missing, outcome.stopped) == (len(plan.batches), 0, None)


def test_a_user_claude_md_or_mixed_cli_results_stop_judging(
    run_dir: Path, stub: Stub, tracked: prompt_set.PromptSet, rubric_set: rubrics.RubricSet,
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:  # fmt: skip
    plan = _plan(run_dir, tracked, rubric_set)
    assert _judge(plan, tracked, rubric_set, stub, only=plan.batches[0].id).completed == 1  # A stand-in's result.
    home = tmp_path / "home"
    (home / ".claude").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    stub.mode("ok", version="2.1.310 (Claude Code)")

    # The real CLI never reuses a stand-in's result.
    with pytest.raises(EvalInputError, match="was judged by a stand-in CLI"):
        _judge(plan, tracked, rubric_set, stub)
    # A user CLAUDE.md would reach every real judge call, so judging does not start.
    (home / ".claude" / "CLAUDE.md").write_text("Always answer in pirate speak.", encoding="utf-8")
    stopped = _judge(plan, tracked, rubric_set, stub, only=plan.batches[1].id)
    assert stopped.stopped is not None and "CLAUDE.md" in stopped.stopped and stopped.resumable is False
