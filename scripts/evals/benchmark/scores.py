"""Judge scores joined back to a run's records (spec R12, R16).

The blind mapping turns each judged item's opaque id back into its record
lines and labels. An item the plan holds but no completed batch scored is
kept as missing, so every summary can count what it lacks.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from scripts.evals.core.inputs import EvalInputError

from .judge import JUDGE_DIR

__all__ = ["JudgeResults", "JudgedItem", "by_line", "item_score", "load_judge_results"]


@dataclass(frozen=True, slots=True)
class JudgedItem:
    rubric: str
    ref: Mapping[str, Any]
    """The item's record lines and labels from the blind mapping."""
    scores: Mapping[str, int] | None
    """Criterion scores, or ``None`` when the item is missing."""
    entries: Mapping[str, bool] | None = None
    """For capture matching: each checklist entry id and whether the judge found it saved."""

    @property
    def missing(self) -> bool:
        return self.scores is None and self.entries is None


@dataclass(slots=True)
class JudgeResults:
    """One judge effort's results for a run: its items and what the batch records say about the judge."""

    effort: str | None
    items: list[JudgedItem] = field(default_factory=list)
    batches: dict[str, int] = field(default_factory=dict)
    """Planned batches, and those ``ok``, ``missing`` or not yet run."""
    models: list[str] = field(default_factory=list)
    """Served model ids reported by the CLI."""
    cli_versions: list[str] = field(default_factory=list)
    rubrics_version: str | None = None
    rubrics_sha256: str | None = None

    def for_rubric(self, rubric: str) -> list[JudgedItem]:
        return [item for item in self.items if item.rubric == rubric]


def item_score(item: JudgedItem) -> float | None:
    """An item's overall score: the mean of its criteria, or ``None`` when missing or not scored on criteria."""

    if not item.scores:
        return None
    return sum(item.scores.values()) / len(item.scores)


def load_judge_results(run_dir: Path, effort: str | None) -> JudgeResults:
    """The run's judged items at ``effort``.

    A run without a judge plan, or no effort, gives no items. With a plan, every planned item comes back, and one
    no completed batch at ``effort`` scored is missing.
    """

    directory = run_dir / JUDGE_DIR
    if effort is None or not (directory / "plan.json").exists():
        return JudgeResults(effort=effort)
    try:
        plan = json.loads((directory / "plan.json").read_text(encoding="utf-8"))
        mapping: Mapping[str, Mapping[str, Any]] = json.loads((directory / "mapping.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise EvalInputError(f"{directory} holds no readable judge plan ({exc})") from exc
    outcome = JudgeResults(effort=effort)
    statuses: Counter[str] = Counter()
    scored: dict[str, Mapping[str, Any]] = {}
    models: set[str] = set()
    versions: set[str] = set()
    for batch in plan["batches"]:
        path = directory / effort / f"{batch['id']}.json"
        if not path.exists():
            statuses["not_run"] += 1
            continue
        record = json.loads(path.read_text(encoding="utf-8"))
        statuses[record.get("status", "missing")] += 1
        if record.get("status") != "ok":
            continue
        models.update(record.get("served_models") or ())
        versions.add(str(record.get("cli_version")))
        outcome.rubrics_version = record.get("rubrics_version")
        outcome.rubrics_sha256 = record.get("rubrics_sha256")
        for result in record.get("results") or ():
            scored[result["id"]] = result
    for item_id, ref in sorted(mapping.items(), key=lambda pair: (pair[1]["rubric"], pair[1]["lines"])):
        result = scored.get(item_id)
        scores = entries = None
        if result is not None and "entries" in result:
            entries = {str(entry["entry"]): bool(entry["present"]) for entry in result["entries"]}
        elif result is not None:
            scores = {key: int(value) for key, value in result.items() if key != "id"}
        outcome.items.append(JudgedItem(rubric=ref["rubric"], ref=ref, scores=scores, entries=entries))
    outcome.batches = {"planned": len(plan["batches"]), **{key: statuses[key] for key in ("ok", "missing", "not_run")}}
    outcome.models = sorted(models)
    outcome.cli_versions = sorted(versions)
    return outcome


def by_line(items: Sequence[JudgedItem], rubric: str) -> dict[int, JudgedItem]:
    """A rubric's items keyed by their first record line."""

    return {item.ref["lines"][0]: item for item in items if item.rubric == rubric}
