"""Offline tests for the speech-recognition evaluation tool (issue #509)."""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import tarfile
from pathlib import Path
from typing import Any

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/speech-eval/speech_eval.py"
spec = importlib.util.spec_from_file_location("speech_eval", SCRIPT)
assert spec and spec.loader
speech_eval = importlib.util.module_from_spec(spec)
# Dataclasses resolve their module through sys.modules.
sys.modules[spec.name] = speech_eval
spec.loader.exec_module(speech_eval)


def fleurs_line(sentence_id: int, file_name: str, raw: str, seconds: float) -> str:
    samples = int(seconds * speech_eval.SAMPLE_RATE)
    return f"{sentence_id}\t{file_name}\t{raw}\t{raw.lower()}\tx | y\t{samples}\tFEMALE\n"


def test_parse_fleurs_tsv_reads_raw_text_and_duration():
    rows = speech_eval.parse_fleurs_tsv(fleurs_line(7, "a.wav", "Hello, world.", 2.5))

    assert rows == [speech_eval.SourceRow(sentence_id="7", file_name="a.wav", text="Hello, world.", seconds=2.5)]


def test_parse_fleurs_tsv_rejects_unexpected_columns():
    with pytest.raises(speech_eval.EvalError, match="columns"):
        speech_eval.parse_fleurs_tsv("1\ta.wav\ttext\n")


def rows_for_selection() -> list[Any]:
    rows = []
    for sentence in range(60):
        seconds = 2 + (sentence % 13)  # 2–14 s
        for recording in range(2):
            rows.append(
                speech_eval.SourceRow(
                    sentence_id=str(sentence),
                    file_name=f"{sentence}-{recording}.wav",
                    text=f"sentence {sentence}",
                    seconds=seconds + recording * 0.1,
                )
            )
    rows.append(speech_eval.SourceRow("too-long", "long.wav", "x", 16.0))
    rows.append(speech_eval.SourceRow("too-short", "short.wav", "x", 0.5))
    return rows


def test_select_clips_is_deterministic_and_respects_bounds():
    rows = rows_for_selection()

    first = speech_eval.select_clips(rows, count=30, seed="animama-509")
    second = speech_eval.select_clips(list(reversed(rows)), count=30, seed="animama-509")

    assert first == second
    assert len(first) == 30
    assert len({row.sentence_id for row in first}) == 30, "one recording per sentence"
    assert all(1 <= row.seconds <= 15 for row in first)


def test_select_clips_spreads_across_duration_buckets():
    selected = speech_eval.select_clips(rows_for_selection(), count=30, seed="animama-509")

    buckets = [sum(1 for row in selected if low < row.seconds <= high) for low, high in speech_eval.DURATION_BUCKETS]
    assert min(buckets) >= 9, buckets


def test_select_clips_fills_from_other_buckets_when_one_is_short():
    rows = [speech_eval.SourceRow(str(i), f"{i}.wav", "t", 12.0) for i in range(20)]
    rows += [speech_eval.SourceRow(f"s{i}", f"s{i}.wav", "t", 3.0) for i in range(2)]

    selected = speech_eval.select_clips(rows, count=10, seed="x")

    assert len(selected) == 10
    assert sum(1 for row in selected if row.seconds == 3.0) == 2


def test_select_clips_reports_too_few_candidates():
    with pytest.raises(speech_eval.EvalError, match="only 2"):
        speech_eval.select_clips(rows_for_selection()[:4], count=3, seed="x")


@pytest.mark.parametrize(
    ("language", "text", "expected"),
    [
        ("en", "Hello, World!  It's  2 o'clock.", ["hello", "world", "it's", "2", "o'clock"]),
        ("ja", "こんにちは、世界！ １２３", list("こんにちは世界123")),
        ("ko", "안녕하세요, 세계.", list("안녕하세요세계")),
        ("zh", "你好，世界。", list("你好世界")),
        ("yue", "你好呀！", list("你好呀")),
    ],
)
def test_units_normalize_per_language(language, text, expected):
    assert speech_eval.units(text, language) == expected


def test_error_counts_use_words_for_english_and_characters_for_cjk():
    assert speech_eval.error_counts("the cat sat", "the cat sat down", "en") == (1, 3)
    assert speech_eval.error_counts("猫が座った", "猫は座った", "ja") == (1, 5)
    assert speech_eval.error_counts("", "", "ko") == (0, 0)


def test_percentile_interpolates():
    assert speech_eval.percentile([1, 2, 3, 4], 50) == 2.5
    assert speech_eval.percentile([10], 90) == 10
    assert speech_eval.percentile([0, 10], 90) == pytest.approx(9.0)


def result_file(tmp_path: Path, clips: list[dict[str, object]], **overrides: object) -> Path:
    payload = {
        "engine": "parakeet",
        "backend": "wasm",
        "mode": "throughput",
        "runtime": "electron 39.8.9",
        "interim": False,
        "coldLoadMs": 1200.0,
        "warmLoadMs": 700.0,
        "memory": {"peakMb": 900.0, "medianMb": 800.0, "loadPeakMb": 1300.0, "method": "test"},
        "clips": clips,
    } | overrides
    path = tmp_path / f"{payload['engine']}-{payload['backend']}-{payload['mode']}-{len(list(tmp_path.iterdir()))}.json"
    path.write_text(json.dumps(payload))
    return path


def test_summarize_reports_corpus_error_rate_and_latency(tmp_path):
    references = {
        ("en", "a"): {"language": "en", "text": "the cat sat"},
        ("en", "b"): {"language": "en", "text": "a dog"},
        ("ja", "c"): {"language": "ja", "text": "猫が座った"},
    }
    path = result_file(
        tmp_path,
        [
            {"set": "en", "id": "a", "audioSeconds": 2.0, "text": "the cat sat", "finalLatencyMs": 100},
            {"set": "en", "id": "b", "audioSeconds": 4.0, "text": "a big dog", "finalLatencyMs": 300},
            {"set": "ja", "id": "c", "audioSeconds": 3.0, "text": "猫は座った", "finalLatencyMs": 200},
        ],
    )

    summary = speech_eval.summarize([path], references)

    en = next(row for row in summary if row["set"] == "en")
    assert en["errorRate"] == pytest.approx(1 / 5)
    assert en["metric"] == "WER"
    assert en["clips"] == 2
    assert en["finalP50Ms"] == pytest.approx(200)
    assert en["realTimeFactor"] == pytest.approx(0.4 / 6)
    ja = next(row for row in summary if row["set"] == "ja")
    assert ja["metric"] == "CER"
    assert ja["errorRate"] == pytest.approx(1 / 5)


def test_summarize_keeps_configurations_apart_and_refuses_repeated_runs(tmp_path):
    references = {("en", "a"): {"language": "en", "text": "hi"}}
    clip = {"set": "en", "id": "a", "audioSeconds": 1.0, "text": "hi", "finalLatencyMs": 50}
    paced = result_file(tmp_path, [clip], mode="paced", interim=True)
    paced_final_only = result_file(tmp_path, [clip], mode="paced", interim=False)

    rows = speech_eval.summarize([paced, paced_final_only], references)

    assert sorted(row["mode"] for row in rows) == ["paced", "paced, interim"]
    with pytest.raises(speech_eval.EvalError, match="twice"):
        speech_eval.summarize([paced, result_file(tmp_path, [clip], mode="paced", interim=True)], references)


def test_summarize_separates_model_sets_of_one_engine(tmp_path):
    references = {("en", "a"): {"language": "en", "text": "hi"}}
    clip = {"set": "en", "id": "a", "audioSeconds": 1.0, "text": "hi", "finalLatencyMs": 50}
    small = result_file(tmp_path, [clip], engine="nemotron", models="nemotron-560ms")
    large = result_file(tmp_path, [clip], engine="nemotron", models="nemotron-1120ms")

    rows = speech_eval.summarize([small, large], references)

    assert [row["engine"] for row in rows] == ["nemotron (nemotron-1120ms)", "nemotron (nemotron-560ms)"]


def test_summarize_rejects_unknown_clips(tmp_path):
    path = result_file(tmp_path, [{"set": "en", "id": "zzz", "audioSeconds": 1, "text": "x", "finalLatencyMs": 1}])

    with pytest.raises(speech_eval.EvalError, match="zzz"):
        speech_eval.summarize([path], {})


def test_summarize_counts_tags_and_reports_interim_latency(tmp_path):
    references = {("en", "a"): {"language": "en", "text": "hi"}}
    path = result_file(
        tmp_path,
        [
            {
                "set": "en",
                "id": "a",
                "audioSeconds": 1.0,
                "text": "<|en|> hi",
                "finalLatencyMs": 50,
                "firstInterimMs": 700,
            }
        ],
        mode="paced",
    )

    (row,) = speech_eval.summarize([path], references)

    assert row["tagLeaks"] == 1
    assert row["firstInterimP50Ms"] == 700


def test_markdown_report_has_one_row_per_summary(tmp_path):
    rows = [
        {
            "engine": "parakeet",
            "backend": "wasm",
            "mode": "throughput",
            "runtime": "electron 39.8.9",
            "set": "en",
            "metric": "WER",
            "errorRate": 0.05,
            "clips": 75,
            "finalP50Ms": 900.0,
            "finalP90Ms": 1500.0,
            "firstInterimP50Ms": None,
            "realTimeFactor": 0.2,
            "coldLoadMs": 1200.0,
            "warmLoadMs": 700.0,
            "peakMb": 900.0,
            "medianMb": 800.0,
            "loadPeakMb": 1300.0,
            "interimStops": 2,
            "tagLeaks": 0,
        }
    ]

    table = speech_eval.markdown_table(rows)

    assert table.count("\n") == 2
    assert "| parakeet | wasm | throughput | electron 39.8.9 | en | WER 5.0% |" in table
    assert "| 2 | 0.20 | 1,200 | 700 | 1,300 | 800 | 900 | 0 |" in table


def test_extract_selected_writes_only_listed_members(tmp_path):
    archive = tmp_path / "test.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        for name in ("test/keep.wav", "test/skip.wav"):
            data = name.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            bundle.addfile(info, io.BytesIO(data))

    written = speech_eval.extract_selected(archive, {"keep.wav"}, tmp_path / "out")

    assert written == {"keep.wav"}
    assert (tmp_path / "out/keep.wav").read_bytes() == b"test/keep.wav"
    assert not (tmp_path / "out/skip.wav").exists()


def test_extract_selected_rejects_unsafe_member_names(tmp_path):
    archive = tmp_path / "evil.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        info = tarfile.TarInfo("../escape.wav")
        info.size = 1
        bundle.addfile(info, io.BytesIO(b"x"))

    assert speech_eval.extract_selected(archive, {"escape.wav"}, tmp_path / "out") == set()
    assert not (tmp_path / "escape.wav").exists()


def test_tracked_testset_is_well_formed():
    testset = speech_eval.load_testset()

    sets = {entry["id"]: entry for entry in testset["sets"]}
    assert {"en", "ja", "ko", "zh-Hans"} <= set(sets)
    for entry in sets.values():
        if entry.get("clips"):
            assert len(entry["clips"]) == len(set(entry["clips"]))
            assert 50 <= len(entry["clips"]) <= 100


def protobuf_string(field: int, value: bytes) -> bytes:
    return bytes([(field << 3) | 2, len(value)]) + value


def test_onnx_metadata_reads_metadata_props_and_skips_the_graph(tmp_path):
    entry = protobuf_string(1, b"lang_ja") + protobuf_string(2, b"11")
    model = (
        bytes([0x08, 7])  # ir_version
        + protobuf_string(7, b"\x01" * 40)  # graph, skipped
        + protobuf_string(14, entry)
        + protobuf_string(14, protobuf_string(1, "名前".encode()) + protobuf_string(2, b""))
    )
    path = tmp_path / "model.onnx"
    path.write_bytes(model)

    assert speech_eval.onnx_metadata(path) == {"lang_ja": "11", "名前": ""}


CONVERTED_REFERENCES = {("zh-Hant", "a"): {"language": "zh", "text": "简体字", "referenceScript": "Hans"}}


def converted_clip(**overrides: object) -> dict[str, object]:
    return {"set": "zh-Hant", "id": "a", "audioSeconds": 1.0, "text": "簡體字", "finalLatencyMs": 1} | overrides


def test_summarize_scores_against_a_reference_the_page_converted(tmp_path):
    path = result_file(tmp_path, [converted_clip(reference="簡體字")])

    (row,) = speech_eval.summarize([path], CONVERTED_REFERENCES)

    assert row["errorRate"] == 0


def test_summarize_rejects_a_missing_converted_reference(tmp_path):
    path = result_file(tmp_path, [converted_clip()])

    with pytest.raises(speech_eval.EvalError, match="converted reference"):
        speech_eval.summarize([path], CONVERTED_REFERENCES)
