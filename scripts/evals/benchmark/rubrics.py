"""The judge's rubrics (spec R12): loaded from the tracked file, then turned into prompts and output schemas.

Each rubric scores the criteria of a set of judged items on 1-5 anchors, or,
for capture matching, judges each checklist entry present or absent. The
rubric file's version and hash identify a results series: changing either
starts a new one.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from scripts.evals.core.inputs import EvalInputError, read_json, require_unique, required_text

__all__ = [
    "JUDGED_KINDS",
    "TRACKED_RUBRICS",
    "Criterion",
    "JudgeOutputError",
    "Rubric",
    "RubricSet",
    "load_rubrics",
    "output_schema",
    "schema_text",
    "system_prompt",
    "validate_output",
]

JUDGED_KINDS = frozenset({"single", "chat", "memory", "recall", "chat_transcript", "capture", "memory_manager"})
"""What a rubric can apply to: turn kinds, plus a whole scripted chat (``chat_transcript``)."""
TRACKED_RUBRICS = Path(__file__).resolve().parents[3] / "docs" / "benchmarks" / "inputs" / "rubrics.json"
"""The rubric file the owner approved at G2."""
_ANCHORS = ("1", "2", "3", "4", "5")


class JudgeOutputError(ValueError):
    """The judge's output does not match the rubric's schema or the batch's items."""


@dataclass(frozen=True, slots=True)
class Criterion:
    key: str
    question: str
    anchors: Mapping[str, str]
    """The anchor text for each score, ``"1"`` to ``"5"``."""


@dataclass(frozen=True, slots=True)
class Rubric:
    id: str
    applies_to: tuple[str, ...]
    instructions: str
    criteria: tuple[Criterion, ...]
    item_judgement: Mapping[str, str] | None = None
    """Fields judged for each checklist entry instead of scored criteria (capture matching)."""


@dataclass(frozen=True, slots=True)
class RubricSet:
    version: str
    sha256: str
    rubrics: tuple[Rubric, ...] = field(default_factory=tuple)

    def get(self, rubric_id: str) -> Rubric:
        for rubric in self.rubrics:
            if rubric.id == rubric_id:
                return rubric
        raise EvalInputError(f"unknown rubric {rubric_id!r}")


def load_rubrics(path: Path) -> RubricSet:
    """Load and check the rubric file: unique ids, known kinds, and five anchors for every criterion."""

    data, sha256 = read_json(path)
    where = str(path)
    if not isinstance(data, Mapping) or not isinstance(data.get("rubrics"), list):
        raise EvalInputError(f"{where}: expected {{'version', 'rubrics': [...]}}")
    rubrics = tuple(_rubric(entry, f"{where}: rubrics[{index}]") for index, entry in enumerate(data["rubrics"]))
    require_unique([rubric.id for rubric in rubrics], f"{where}: rubric")
    return RubricSet(version=required_text(data, "version", where), sha256=sha256, rubrics=rubrics)


def _rubric(entry: Any, where: str) -> Rubric:
    if not isinstance(entry, Mapping):
        raise EvalInputError(f"{where}: expected an object")
    rubric_id = required_text(entry, "id", where)
    applies_to = entry.get("applies_to")
    if not isinstance(applies_to, list) or not applies_to or not set(applies_to) <= JUDGED_KINDS:
        raise EvalInputError(f"{where}: 'applies_to' must list kinds from {sorted(JUDGED_KINDS)}")
    if not isinstance(entry.get("criteria"), list):
        raise EvalInputError(f"{where}: 'criteria' must be a list")
    criteria = tuple(_criterion(item, f"{where}.criteria[{index}]") for index, item in enumerate(entry["criteria"]))
    require_unique([criterion.key for criterion in criteria], f"{where}: criterion")
    judgement = entry.get("item_judgement")
    if judgement is not None and (
        not isinstance(judgement, Mapping) or set(judgement) != {"present", "evidence"} or criteria
    ):
        raise EvalInputError(f"{where}: 'item_judgement' names 'present' and 'evidence', and has no criteria")
    if not criteria and judgement is None:
        raise EvalInputError(f"{where}: a rubric needs criteria or an item judgement")
    return Rubric(
        id=rubric_id,
        applies_to=tuple(applies_to),
        instructions=required_text(entry, "instructions", where),
        criteria=criteria,
        item_judgement=dict(judgement) if judgement is not None else None,
    )


def _criterion(entry: Any, where: str) -> Criterion:
    if not isinstance(entry, Mapping):
        raise EvalInputError(f"{where}: expected an object")
    anchors = entry.get("anchors")
    if not isinstance(anchors, Mapping) or sorted(anchors) != list(_ANCHORS):
        raise EvalInputError(f"{where}: 'anchors' must give the texts for 1 to 5")
    return Criterion(
        key=required_text(entry, "key", where),
        question=required_text(entry, "question", where),
        anchors={score: str(anchors[score]) for score in _ANCHORS},
    )


def system_prompt(rubric: Rubric) -> str:
    """The judge's system prompt: the rubric's instructions, its criteria with anchors, and the output rule."""

    lines = [rubric.instructions.strip(), ""]
    if rubric.item_judgement is not None:
        lines.append("For every checklist entry of every item, return:")
        lines.extend(f"- {name}: {text}" for name, text in rubric.item_judgement.items())
    else:
        lines.append("Score every item on each criterion with an integer from 1 to 5, using these anchors:")
        for criterion in rubric.criteria:
            lines.append(f"\n{criterion.key}: {criterion.question}")
            lines.extend(f"  {score}: {text}" for score, text in criterion.anchors.items())
    lines.append(
        "\nThe user message holds one batch as JSON. Return exactly one result for each item, with the item's id, "
        "through the structured output."
    )
    return "\n".join(lines)


def output_schema(rubric: Rubric) -> dict[str, Any]:
    """The JSON Schema of one batch's judge output."""

    item: dict[str, Any]
    if rubric.item_judgement is not None:
        entry = {
            "type": "object",
            "properties": {
                "entry": {"type": "string"},
                "present": {"type": "boolean"},
                "evidence": {"type": "string"},
            },
            "required": ["entry", "present", "evidence"],
            "additionalProperties": False,
        }
        item = {
            "type": "object",
            "properties": {"id": {"type": "string"}, "entries": {"type": "array", "items": entry}},
            "required": ["id", "entries"],
            "additionalProperties": False,
        }
    else:
        scores = {criterion.key: {"type": "integer", "minimum": 1, "maximum": 5} for criterion in rubric.criteria}
        item = {
            "type": "object",
            "properties": {"id": {"type": "string"}, **scores},
            "required": ["id", *scores],
            "additionalProperties": False,
        }
    return {
        "type": "object",
        "properties": {"items": {"type": "array", "items": item}},
        "required": ["items"],
        "additionalProperties": False,
    }


def validate_output(rubric: Rubric, output: Any, expected: Mapping[str, Sequence[str] | None]) -> list[dict[str, Any]]:
    """Check one batch's output against the schema and the batch: one result per item, nothing extra.

    ``expected`` maps each item id to its checklist entry ids (capture) or ``None``. Returns the results in the
    batch's item order; raises ``JudgeOutputError`` naming the first problem.
    """

    if not isinstance(output, Mapping) or set(output) != {"items"} or not isinstance(output["items"], list):
        raise JudgeOutputError("expected an object with one 'items' list")
    results: dict[str, dict[str, Any]] = {}
    for result in output["items"]:
        if not isinstance(result, Mapping) or not isinstance(result.get("id"), str):
            raise JudgeOutputError("every result needs a string 'id'")
        item_id = result["id"]
        if item_id not in expected:
            raise JudgeOutputError(f"result for unknown item {item_id!r}")
        if item_id in results:
            raise JudgeOutputError(f"two results for item {item_id!r}")
        results[item_id] = _checked(rubric, dict(result), expected[item_id])
    missing = [item_id for item_id in expected if item_id not in results]
    if missing:
        raise JudgeOutputError(f"no result for {len(missing)} item(s), first {missing[0]!r}")
    return [results[item_id] for item_id in expected]


def _checked(rubric: Rubric, result: dict[str, Any], entries: Sequence[str] | None) -> dict[str, Any]:
    item_id = result["id"]
    if rubric.item_judgement is not None:
        if set(result) != {"id", "entries"} or not isinstance(result["entries"], list):
            raise JudgeOutputError(f"{item_id}: expected 'id' and an 'entries' list")
        seen: list[str] = []
        for entry in result["entries"]:
            if (
                not isinstance(entry, Mapping)
                or set(entry) != {"entry", "present", "evidence"}
                or not isinstance(entry["present"], bool)
                or not isinstance(entry["evidence"], str)
            ):
                raise JudgeOutputError(f"{item_id}: every entry needs 'entry', a boolean 'present' and 'evidence'")
            seen.append(str(entry["entry"]))
        if sorted(seen) != sorted(entries or ()):
            raise JudgeOutputError(f"{item_id}: the entries must be exactly the item's checklist")
        return result
    keys = [criterion.key for criterion in rubric.criteria]
    if set(result) != {"id", *keys}:
        raise JudgeOutputError(f"{item_id}: expected 'id' and the scores {keys}")
    for key in keys:
        score = result[key]
        if isinstance(score, bool) or not isinstance(score, int) or not 1 <= score <= 5:
            raise JudgeOutputError(f"{item_id}: {key} must be an integer from 1 to 5")
    return result


def schema_text(rubric: Rubric) -> str:
    """The output schema as the compact JSON the CLI takes."""

    return json.dumps(output_schema(rubric), separators=(",", ":"))
