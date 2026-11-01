"""The tracked v1 benchmark inputs under docs/benchmarks/inputs (issue #470 spec R8-R11, R12 rubrics)."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import pytest

from animama.app.chat.memory_arm import EpisodicMemoryArm
from animama.app.services.anima_identity_memory import ANIMA_SELF_MEMORIES_ALIAS
from scripts.evals.benchmark import prompt_set
from tests.test_episodic_memory_arm import CANDIDATE, ROWS, _prepare

INPUTS = Path(__file__).resolve().parents[1] / "docs" / "benchmarks" / "inputs"


@pytest.fixture(scope="module")
def tracked() -> prompt_set.PromptSet:
    return prompt_set.load_prompt_set(INPUTS / "prompts.json")


def test_the_tracked_set_validates_with_both_languages_and_a_smoke_tier(tracked: prompt_set.PromptSet) -> None:
    assert {item.language for item in tracked.items} == {"en", "ja"}
    assert {chat.language for chat in tracked.memory_chats} == {"en", "ja"}
    assert tracked.episodic_guidance is not None and tracked.manager_runs
    smoke = tracked.for_tier("smoke")
    assert smoke.items and smoke.scripted_chats and smoke.memory_chats and smoke.manager_runs


def test_held_out_items_are_about_a_fifth_and_pairs_agree(tracked: prompt_set.PromptSet) -> None:
    by_area: dict[str, list[bool]] = defaultdict(list)
    for item in tracked.items:
        by_area[item.area].append(item.held_out)
    for area, held in by_area.items():
        assert 0.18 <= sum(held) / len(held) <= 0.22, area
    # A Japanese item is held out exactly when its English original is, so paired results never mix the splits.
    english = {item.id: item for item in tracked.items if item.language == "en"}
    assert all(item.held_out == english[item.pair_id].held_out for item in tracked.items if item.pair_id)


def test_every_rubric_scores_criteria_on_five_anchors_or_judges_items() -> None:
    rubrics: list[dict[str, Any]] = json.loads((INPUTS / "rubrics.json").read_text(encoding="utf-8"))["rubrics"]

    assert len({rubric["id"] for rubric in rubrics}) == len(rubrics)
    for rubric in rubrics:
        assert rubric["applies_to"] and rubric["instructions"].strip(), rubric["id"]
        keys = [criterion["key"] for criterion in rubric["criteria"]]
        # Capture matching judges each checklist item present or absent instead of scoring criteria.
        assert (keys or rubric.get("item_judgement")) and len(set(keys)) == len(keys), rubric["id"]
        for criterion in rubric["criteria"]:
            assert sorted(criterion["anchors"]) == ["1", "2", "3", "4", "5"], (rubric["id"], criterion["key"])


@pytest.mark.parametrize("row_id", ROWS)
async def test_arm_b_names_the_memories_path_only_through_the_tracked_guidance(
    row_id: str, tracked: prompt_set.PromptSet
) -> None:
    # The candidate guidance replaces the only prompt text that names the path (Phase 3 review, P3-F5).
    with_tracked = await _prepare(
        row_id,
        episodic_memory_arm=EpisodicMemoryArm(remember=False, anima_memories_write_guidance=tracked.episodic_guidance),
    )
    without_path = await _prepare(
        row_id, episodic_memory_arm=EpisodicMemoryArm(remember=False, anima_memories_write_guidance=CANDIDATE)
    )

    assert ANIMA_SELF_MEMORIES_ALIAS in with_tracked["system"]
    assert ANIMA_SELF_MEMORIES_ALIAS not in without_path["system"]
