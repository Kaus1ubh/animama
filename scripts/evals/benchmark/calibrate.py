"""The one-time calibration of the judge against the owner (spec R13, plan D15).

``export`` draws a blind, stratified sample of English replies from a run:
items of the ``reply`` and ``expression`` rubrics, spread over rubrics,
configurations and areas with a fixed seed. It writes the sample as its own
judge plan under ``calibration/judge/``, a rating sheet that shows every item
exactly as the judge receives it, and a ratings file for the owner to fill.
``import_ratings`` checks the owner's scores. ``pilot`` judges the sample at
medium and at high, measures each effort's agreement with the owner, and
pins the one that agrees better, medium on a tie. The sample is drawn before
any judging, so it cannot be stratified by score.
"""

from __future__ import annotations

import json
import random
import statistics
from collections import defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ..core.inputs import EvalInputError, read_json
from .intervals import agreement_table
from .judge import (
    EFFORTS,
    ClaudeCli,
    JudgePlan,
    JudgeRun,
    batch_prompt,
    inputs_fingerprint,
    load_plan,
    plan_judging,
    run_judging,
)
from .judge_items import JudgeItem, build_items
from .prompt_set import PromptSet
from .results import write_json
from .rubrics import RubricSet, system_prompt

__all__ = [
    "CALIBRATED_RUBRICS",
    "CALIBRATION_DIR",
    "SAMPLE_PER_RUBRIC",
    "export",
    "import_ratings",
    "pilot",
    "pin_effort",
    "sample",
]

CALIBRATION_DIR = "calibration"
CALIBRATED_RUBRICS = ("reply", "expression")
"""The rubrics the owner rates: the reply-level measures every core turn is judged on."""
SAMPLE_PER_RUBRIC = 18
"""36 items in all, within D15's 30 to 40 English replies."""


def _fingerprint(turns_sha256: str, prompt_set: PromptSet, rubrics: RubricSet, seed: int) -> dict[str, Any]:
    return inputs_fingerprint(turns_sha256, prompt_set, rubrics, seed, calibration_sample=SAMPLE_PER_RUBRIC)


def sample(items: Sequence[JudgeItem], *, seed: int) -> list[JudgeItem]:
    """Up to ``SAMPLE_PER_RUBRIC`` English items per calibrated rubric, taken in turn from each configuration
    and area so no stratum dominates."""

    rng = random.Random(seed)
    chosen: list[JudgeItem] = []
    for rubric in CALIBRATED_RUBRICS:
        # Configuration first, then area: each configuration takes the next item in turn, cycling its areas, so
        # every configuration gets an equal share whatever the labels sort as.
        queues: dict[str, list[JudgeItem]] = {}
        for configuration in sorted({str(item.ref.get("configuration")) for item in items}):
            areas: dict[str, list[JudgeItem]] = defaultdict(list)
            for item in items:
                ref = item.ref
                if (
                    item.rubric == rubric
                    and ref.get("language") == "en"
                    and str(ref.get("configuration")) == configuration
                ):
                    areas[str(ref.get("area"))].append(item)
            for members in areas.values():
                rng.shuffle(members)
            queues[configuration] = _interleave([areas[area] for area in sorted(areas)])
        order = sorted(queues)
        rng.shuffle(order)
        taken = 0
        while taken < SAMPLE_PER_RUBRIC and any(queues.values()):
            for configuration in order:
                if queues[configuration] and taken < SAMPLE_PER_RUBRIC:
                    chosen.append(queues[configuration].pop(0))
                    taken += 1
    return chosen


def _interleave(lists: Sequence[list[JudgeItem]]) -> list[JudgeItem]:
    """One from each list in turn, until all are empty."""

    merged: list[JudgeItem] = []
    for index in range(max((len(items) for items in lists), default=0)):
        merged.extend(items[index] for items in lists if index < len(items))
    return merged


def export(
    run_dir: Path, turns: Sequence[Mapping[str, Any]], turns_sha256: str, prompt_set: PromptSet,
    rubrics: RubricSet, *, seed: int,
) -> JudgePlan:  # fmt: skip
    """Write the sample's judge plan, the rating sheet and the empty ratings file; refuse to draw twice."""

    directory = run_dir / CALIBRATION_DIR
    if (directory / "judge" / "plan.json").exists():
        raise EvalInputError(f"{directory} already holds a calibration sample; rate that one")
    items = sample(build_items(turns, prompt_set, rubrics), seed=seed)
    if not items:
        raise EvalInputError(f"{run_dir} has no judged English replies to sample")
    plan = plan_judging(
        items, directory / "judge", seed=seed, fingerprint=_fingerprint(turns_sha256, prompt_set, rubrics, seed)
    )
    sheet = ["# Calibration rating sheet", "",
             "Rate every item with the rubric above it, as the judge would: an integer from 1 to 5 for each "
             "criterion. Enter the scores in `ratings.json` beside this file. You do not know which model wrote "
             "an item.", ""]  # fmt: skip
    ratings: dict[str, dict[str, None]] = {}
    for batch in plan.batches:
        rubric = rubrics.get(batch.rubric)
        payload = json.loads(plan.payload_path(batch).read_text(encoding="utf-8"))
        sheet += [f"## {batch.id}", "", "```text", system_prompt(rubric), "```", "", "```json",
                  batch_prompt(payload, prompt_set), "```", ""]  # fmt: skip
        for item_id in batch.items:
            ratings[item_id] = {criterion.key: None for criterion in rubric.criteria}
    (directory / "sheet.md").write_text("\n".join(sheet), encoding="utf-8")
    write_json(directory / "ratings.json", {"rubrics_sha256": rubrics.sha256, "items": ratings})
    return plan


def import_ratings(run_dir: Path, ratings_path: Path, rubrics: RubricSet) -> int:
    """Check the owner's ratings against the sample and keep them as ``owner.json``; return the items rated."""

    directory = run_dir / CALIBRATION_DIR
    expected, _ = read_json(directory / "ratings.json")
    ratings, _ = read_json(ratings_path)
    if not isinstance(ratings, Mapping) or ratings.get("rubrics_sha256") != rubrics.sha256:
        raise EvalInputError(f"{ratings_path} rates another rubric version, or is not a ratings file")
    items = ratings.get("items")
    if not isinstance(items, Mapping) or set(items) != set(expected["items"]):
        raise EvalInputError(f"{ratings_path} must rate exactly the sample's items")
    for item_id, criteria in expected["items"].items():
        given = items[item_id]
        if not isinstance(given, Mapping) or set(given) != set(criteria):
            raise EvalInputError(f"{item_id}: rate exactly {sorted(criteria)}")
        for key, score in given.items():
            if isinstance(score, bool) or not isinstance(score, int) or not 1 <= score <= 5:
                raise EvalInputError(f"{item_id}: {key} must be an integer from 1 to 5")
    write_json(directory / "owner.json", ratings)
    return len(items)


def pilot(
    run_dir: Path, turns_sha256: str, prompt_set: PromptSet, rubrics: RubricSet, *, seed: int, cli: ClaudeCli,
    concurrency: int,
) -> tuple[dict[str, Any] | None, JudgeRun | None]:  # fmt: skip
    """Judge the sample at each effort, then record the agreement and the pinned effort in ``result.json``.

    Returns the result, or ``None`` and the judge run that stopped early (resume by running the pilot again).
    """

    directory = run_dir / CALIBRATION_DIR
    if not (directory / "owner.json").exists():
        raise EvalInputError(f"{directory} has no imported owner ratings; run `calibrate import` first")
    plan = load_plan(directory / "judge", _fingerprint(turns_sha256, prompt_set, rubrics, seed), seed=seed)
    if plan is None:
        raise EvalInputError(f"{directory} has no calibration sample; run `calibrate export` first")
    for effort in EFFORTS:
        outcome = run_judging(plan, prompt_set, rubrics, effort=effort, cli=cli, concurrency=concurrency)
        if outcome.stopped is not None or outcome.missing:
            return None, outcome
    owner = json.loads((directory / "owner.json").read_text(encoding="utf-8"))["items"]
    agreement = {effort: agreement_table(_pairs(plan, owner, effort)) for effort in EFFORTS}
    means, pinned = pin_effort(agreement)
    result = {
        "prompt_set_version": prompt_set.version,
        "rubrics_sha256": rubrics.sha256,
        "agreement": agreement,
        "mean_kappa": means,
        "pinned": pinned,
    }
    write_json(directory / "result.json", result)
    return result, None


def pin_effort(agreement: Mapping[str, Mapping[str, Mapping[str, Any]]]) -> tuple[dict[str, float | None], str]:
    """Each effort's mean weighted kappa and the pinned effort: high only when it agrees better, else medium.

    The means cover the same criteria for every effort: those where each effort had a kappa.
    """

    shared = set.intersection(
        *({measure for measure, value in values.items() if value["kappa"] is not None} for values in agreement.values())
    )
    means = {
        effort: statistics.fmean(values[measure]["kappa"] for measure in sorted(shared)) if shared else None
        for effort, values in agreement.items()
    }
    medium, high = means.get("medium"), means.get("high")
    return means, "high" if high is not None and (medium is None or high > medium) else "medium"


def _pairs(plan: JudgePlan, owner: Mapping[str, Mapping[str, int]], effort: str) -> dict[str, list[tuple[int, int]]]:
    """``(owner, judge)`` score pairs per ``rubric.criterion`` for the sample at ``effort``."""

    pairs: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for batch in plan.batches:
        record = json.loads(plan.result_path(batch, effort).read_text(encoding="utf-8"))
        for result in record["results"]:
            for key, judged in result.items():
                if key != "id":
                    pairs[f"{batch.rubric}.{key}"].append((owner[result["id"]][key], int(judged)))
    return pairs
