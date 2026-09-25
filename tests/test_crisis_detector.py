"""Local crisis detector fixtures and bounds (spec R3)."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from animama.app.safety.crisis_detector import MAX_DETECTOR_CHARS, detect_crisis

# Holdout floors sit one case below the measured values (precision 0.830, recall 0.520 on
# 2026-09-25). Change them only with a recorded rationale; never tune on holdout texts.
HOLDOUT_PRECISION_FLOOR = 0.81
HOLDOUT_RECALL_FLOOR = 0.50

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "safety" / "crisis_detection.json").read_text())


def test_fixture_set_meets_minimum_size() -> None:
    assert len(FIXTURES["positive"]) >= 25
    assert len(FIXTURES["negative"]) >= 40


@pytest.mark.parametrize("case", FIXTURES["positive"], ids=lambda case: case["text"][:40])
def test_detects_crisis_statements(case: dict[str, str]) -> None:
    result = detect_crisis(case["text"])
    assert result.positive, case["text"]
    # Categories label the strongest signal for logs; the crisis card is the same for all.
    assert result.category in {"intent", "plan", "method", "self_harm"}


@pytest.mark.parametrize("text", FIXTURES["negative"], ids=lambda text: text[:40])
def test_ignores_ordinary_emotional_conversation(text: str) -> None:
    assert not detect_crisis(text).positive, text


@pytest.mark.parametrize(
    "filler",
    ["I'm so sad and tired today, work was hard. ", "i keep thinking about how i want to be somewhere else "],
    ids=["punctuated", "unpunctuated"],
)
def test_detection_is_fast_on_maximum_length_message(filler: str) -> None:
    text = (filler * 1000)[:MAX_DETECTOR_CHARS] + " I want to kill myself"
    detect_crisis(text)  # warm the compiled patterns
    started = time.perf_counter()
    result = detect_crisis(text)
    elapsed_ms = (time.perf_counter() - started) * 1000
    assert result.positive
    # Spec target is 5 ms on a development machine; the bound leaves room for slow CI.
    assert elapsed_ms < 50, f"detector took {elapsed_ms:.2f} ms"


def test_result_never_carries_message_text() -> None:
    result = detect_crisis("I want to kill myself")
    assert "kill" not in repr(result)


@pytest.mark.parametrize("position", ["start", "end"])
def test_very_long_messages_scan_their_start_and_end(position: str) -> None:
    filler = "filler words here. " * (MAX_DETECTOR_CHARS // 5)
    text = f"I want to kill myself. {filler}" if position == "start" else f"{filler} I want to kill myself"
    assert detect_crisis(text).positive


CORPUS = json.loads((Path(__file__).parent / "fixtures" / "safety" / "crisis_corpus.json").read_text())


def _corpus_metrics(split: str) -> tuple[float, float]:
    cases = [case for case in CORPUS["cases"] if case["split"] == split]
    predicted = [(detect_crisis(case["text"]).positive, case["label"] == "crisis") for case in cases]
    true_positive = sum(1 for p, y in predicted if p and y)
    precision = true_positive / max(1, sum(1 for p, _ in predicted if p))
    recall = true_positive / max(1, sum(1 for _, y in predicted if y))
    return precision, recall


@pytest.mark.parametrize(
    "case",
    [case for case in CORPUS["cases"] if case["split"] == "tune"],
    ids=lambda case: case["text"][:40],
)
def test_tune_corpus_is_classified_correctly(case: dict[str, str]) -> None:
    assert detect_crisis(case["text"]).positive is (case["label"] == "crisis"), case["text"]


def test_holdout_corpus_meets_recorded_floor() -> None:
    """The holdout split is never used for tuning; it guards against regressions."""

    precision, recall = _corpus_metrics("holdout")
    assert precision >= HOLDOUT_PRECISION_FLOOR, precision
    assert recall >= HOLDOUT_RECALL_FLOOR, recall
