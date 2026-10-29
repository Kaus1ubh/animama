"""The judged items of a benchmark run, one per rubric and record (spec R12).

An item's ``content`` is what the judge sees: the persona, the conversation,
the reply or saved memory, and the prompt set's own inputs. It never names
the configuration, model, effort, memory arm or language. Those, with the
record's line numbers, go only into the item's ``ref``, which the blind
mapping keeps apart from every batch the judge receives.

Failed turns and the warm-up are not judged; deterministic measures never are.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .prompt_set import PromptSet
from .rubrics import RubricSet

__all__ = ["CONTEXT_TURNS", "OPEN_PROBES_ONLY", "REFUSED_CODES", "TAGGED_REPLIES_ONLY", "JudgeItem", "build_items"]

CONTEXT_TURNS = 6
"""Earlier exchanges of the same chat shown with a reply; a long chat's whole transcript is judged on its own."""
TAGGED_REPLIES_ONLY = frozenset({"audio_tags"})
"""Rubrics that judge only replies whose speech holds an Audio tag."""
OPEN_PROBES_ONLY = frozenset({"recall"})
"""Rubrics that judge only recall probes without expected phrases; the others are matched deterministically."""
REFUSED_CODES = frozenset({"read_only", "unsupported_tool", "unsupported_tool_type", "memory_tool_round_limit"})
"""Tool-call codes that mean chat or the tool refused the call, rather than that it failed."""
_REF_KEYS = (
    "configuration",
    "model_provider_id",
    "effort",
    "kind",
    "area",
    "arm",
    "language",
    "persona",
    "unit_id",
    "pair_id",
    "held_out",
    "repeat",
    "turn",
    "probe_id",
)


@dataclass(frozen=True, slots=True)
class JudgeItem:
    rubric: str
    content: dict[str, Any]
    """What the judge sees for this item; the persona is named by id and given once per batch."""
    ref: dict[str, Any]
    """The record lines and labels the item came from; never sent to the judge."""
    entries: tuple[str, ...] | None = None
    """The checklist entry ids a capture judgement must cover."""


def build_items(turns: Sequence[Mapping[str, Any]], prompt_set: PromptSet, rubrics: RubricSet) -> list[JudgeItem]:
    """Every judged item of a run, rubric by rubric, in record order."""

    gestures = {gesture.selector: gesture for gesture in prompt_set.loadout.gestures}
    contexts = _contexts(turns)
    items: list[JudgeItem] = []
    for rubric in rubrics.rubrics:
        kinds = set(rubric.applies_to)
        for line, record in enumerate(turns):
            kind = record.get("kind")
            if kind not in kinds or not _judged(record):
                continue
            content = _content(rubric.id, record, contexts.get(line, []), prompt_set, gestures)
            if content is None:
                continue
            entries = tuple(entry["id"] for entry in record["checklist"]) if rubric.id == "capture" else None
            items.append(JudgeItem(rubric=rubric.id, content=content, ref=_ref(record, [line]), entries=entries))
        if "chat_transcript" in kinds:
            items.extend(_transcripts(rubric.id, turns, prompt_set, gestures))
    return items


def _judged(record: Mapping[str, Any]) -> bool:
    kind = record.get("kind")
    if kind == "capture":
        return isinstance(record.get("snapshot"), Mapping)
    if kind == "memory_manager":
        return record.get("error") is None and isinstance(record.get("result"), Mapping)
    return record.get("error") is None and record.get("speech") is not None


def _ref(record: Mapping[str, Any], lines: list[int]) -> dict[str, Any]:
    return {"lines": lines, **{key: record.get(key) for key in _REF_KEYS if key in record}}


def _contexts(turns: Sequence[Mapping[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    """For each chat, memory or recall turn, the exchanges before it in the same chat."""

    history: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    contexts: dict[int, list[dict[str, Any]]] = {}
    for line, record in enumerate(turns):
        kind = record.get("kind")
        if kind not in {"chat", "memory", "recall"}:
            continue
        key = (record.get("configuration"), record.get("arm"), kind, record.get("unit_id"), record.get("repeat"))
        contexts[line] = history[key][-CONTEXT_TURNS:]
        history[key].append({"user": record.get("message"), "anima": record.get("speech")})
    return contexts


def _gesture(selector: Any, gestures: Mapping[str, Any], *, described: bool) -> Any:
    if not isinstance(selector, str) or not selector:
        return None
    gesture = gestures.get(selector)
    if gesture is None:
        return {"name": selector} if described else selector
    return {"name": gesture.name, "description": gesture.description} if described else gesture.name


def _reply(record: Mapping[str, Any], gestures: Mapping[str, Any], *, described: bool = False) -> dict[str, Any]:
    return {
        "speech": record.get("speech"),
        "display": record.get("display"),
        "emotional_tone": record.get("emotional_tone"),
        "emotional_intensity": record.get("emotional_intensity"),
        "gesture": _gesture(record.get("gesture"), gestures, described=described),
    }


def _content(
    rubric_id: str,
    record: Mapping[str, Any],
    context: list[dict[str, Any]],
    prompt_set: PromptSet,
    gestures: Mapping[str, Any],
) -> dict[str, Any] | None:
    """The judge's view of one record under one rubric, or ``None`` when the rubric skips it."""

    turn = {"persona": record.get("persona"), "conversation_so_far": context, "user_message": record.get("message")}
    if rubric_id == "reply":
        speech, display = record.get("speech") or "", record.get("display") or ""
        lengths = {"speech_characters": len(speech), "display_characters": len(display)}
        return {**turn, "reply": _reply(record, gestures), "length": lengths}
    if rubric_id == "expression":
        return {**turn, "reply": _reply(record, gestures, described=True)}
    if rubric_id in TAGGED_REPLIES_ONLY and not (record.get("speech_check") or {}).get("tags"):
        return None
    if rubric_id in OPEN_PROBES_ONLY and record.get("kind") == "recall" and record.get("expect"):
        return None
    if rubric_id == "audio_tags":
        reply = _reply(record, gestures)
        return {**turn, "reply": {key: reply[key] for key in ("speech", "display", "emotional_tone")}}
    if rubric_id == "memory_turn":
        calls = record.get("tool_calls") or []
        return {
            **turn,
            "reply": {"speech": record.get("speech"), "display": record.get("display")},
            "remember_note": record.get("remember"),
            "memory_tool_calls": [_tool_call(call) for call in calls],
            "memory_changes": list(record.get("memory_changes") or ()),
        }
    if rubric_id == "recall":
        return {
            **turn,
            "reply": {"speech": record.get("speech"), "display": record.get("display")},
            "reference": _reference(record, prompt_set),
        }
    if rubric_id == "capture":
        return {"checklist": list(record["checklist"]), "snapshot": _snapshot(record["snapshot"])}
    if rubric_id == "memory_manager":
        return _manager(record, prompt_set)
    return None


def _tool_call(call: Mapping[str, Any]) -> dict[str, Any]:
    """One memory tool call in provider-neutral terms: its action, path and outcome.

    Providers name and shape their memory tools differently (OpenAI Responses rows edit through native
    ``apply_patch`` diffs, other rows through function tools with replacement lists), which would reveal the
    model. Every write is therefore just ``write``; what it changed is the turn's ``memory_changes``, diffed
    from the stored files.
    """

    if call.get("ok"):
        outcome = "succeeded"
    else:
        outcome = "refused" if call.get("code") in REFUSED_CODES else "failed"
    tool = str(call.get("tool"))
    action = _READ_ACTIONS.get(tool, "write" if tool in _WRITE_TOOLS else "other")
    path = call.get("path")
    neutral: dict[str, Any] = {
        "action": action,
        "path": path.lstrip("/") if isinstance(path, str) else path,
        "outcome": outcome,
    }
    arguments = call.get("arguments")
    if action == "search" and isinstance(arguments, Mapping):
        neutral["query"] = arguments.get("query")
    return neutral


_READ_ACTIONS = {"memory_list_files": "list", "memory_read_files": "read", "search_memory_files": "search"}
_WRITE_TOOLS = frozenset({"memory_write_file", "memory_apply_patch", "apply_patch"})


def _reference(record: Mapping[str, Any], prompt_set: PromptSet) -> list[str]:
    """What the user said earlier that the probe asks about: the texts of its checklist entries."""

    chat = next((chat for chat in prompt_set.memory_chats if chat.id == record.get("unit_id")), None)
    if chat is None:
        return []
    texts = {entry.id: entry.text for entry in chat.checklist}
    return [texts[entry] for entry in record.get("checklist") or () if entry in texts]


def _snapshot(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Saved memory in the same sections for every arm, so the snapshot's shape does not reveal the arm."""

    files = list(snapshot.get("files") or ())
    memories = next((f for f in files if f.get("anima") and f.get("path") == "MEMORIES.md"), None)
    return {
        "episode_notes": [episode.get("text") for episode in snapshot.get("episodes") or ()],
        "MEMORIES.md": memories.get("content") if memories is not None else "",
        "shared_files": [{"path": f.get("path"), "content": f.get("content")} for f in files if f is not memories],
    }


def _manager(record: Mapping[str, Any], prompt_set: PromptSet) -> dict[str, Any] | None:
    run = next((run for run in prompt_set.manager_runs if run.id == record.get("unit_id")), None)
    if run is None:
        return None
    fixture = prompt_set.fixture(run.fixture)
    result = record["result"]
    replies = [message for message in result.get("messages") or () if message.get("role") == "assistant"]
    task: dict[str, Any] = {"message": run.message} if run.kind == "general" else {}
    if run.episodes:
        task["episodes"] = list(run.episodes)
    if run.turns:
        task["turns"] = [{"user": user, "anima": anima} for user, anima in run.turns]
    return {
        "run_kind": run.kind,
        "input": task,
        "store_before": {
            "MEMORIES.md": fixture.anima_memories,
            "shared_files": [{"path": f.path, "content": f.content} for f in fixture.user_files],
        },
        "edits": [
            {
                "operation": approval.get("operation"),
                "path": approval.get("target_path"),
                "summary": approval.get("summary"),
                "diff": approval.get("unified_diff"),
            }
            for approval in result.get("approvals") or ()
        ],
        "final_message": replies[-1].get("content") if replies else None,
    }


def _transcripts(
    rubric_id: str, turns: Sequence[Mapping[str, Any]], prompt_set: PromptSet, gestures: Mapping[str, Any]
) -> list[JudgeItem]:
    """One item per complete scripted chat: every turn, failed ones shown without a reply."""

    lengths = {chat.id: len(chat.turns) for chat in prompt_set.scripted_chats}
    chats: dict[tuple[Any, ...], list[int]] = defaultdict(list)
    for line, record in enumerate(turns):
        if record.get("kind") == "chat":
            chats[(record.get("configuration"), record.get("unit_id"), record.get("repeat"))].append(line)
    items: list[JudgeItem] = []
    for (_configuration, unit_id, _repeat), lines in chats.items():
        if len(lines) != lengths.get(unit_id):
            continue  # A chat the run did not finish is not judged as a whole.
        records = sorted((turns[line] for line in lines), key=lambda record: record.get("turn") or 0)
        transcript = [
            {
                "user": record.get("message"),
                "anima": _reply(record, gestures) if _judged(record) else None,
            }
            for record in records
        ]
        content = {"persona": records[0].get("persona"), "transcript": transcript}
        ref = _ref(records[0], sorted(lines))
        ref.pop("turn", None)
        items.append(JudgeItem(rubric=rubric_id, content=content, ref=ref))
    return items
