"""Offline checks for the PocketTTS voice-authoring tools in `scripts/voices/`.

ONNX encoding and rendering need the voice-tools environment and local model
stores; they are verified with `uv run scripts/voices/voices.py encode --check`
and recorded in the voice catalog ExecPlan rather than run here.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import zipfile
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "voices"))
spec = importlib.util.spec_from_file_location("voice_tools", ROOT / "scripts/voices/voices.py")
assert spec and spec.loader
voices = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = voices  # dataclasses resolve their module by name
spec.loader.exec_module(voices)


def load_pocket_onnx() -> Any:
    """The ONNX runtime module needs numpy, which only some environments install."""
    pytest.importorskip("numpy")
    return importlib.import_module("pocket_onnx")


SPEAKER_INFO = """ID  AGE  GENDER  ACCENTS  REGION COMMENTS
p225  23  F    English    Southern  England
p228  22  F    English    Southern  England
p254  21  M    English    Surrey
p280  25  F    France     (mic2 files unavailable)
p315  42  M    American    New England (Text and mic2 files unavailable
s5  22  F    British    Southern England
"""


def sources_fixture() -> dict[str, Any]:
    return {
        "schema": "animama-pocket-voice-sources/1",
        "kyutai_states": {"repository": "kyutai/states", "revision": "r1", "path": "e/{name}.safetensors"},
        "clips": {"repository": "kyutai/tts-voices", "revision": "r2", "vctk_path": "vctk/{speaker}_023_enhanced.wav"},
        "vctk_metadata": {},
        "kyutai_voices": [
            {"name": "anna", "recording": "vctk p228", "license": "CC-BY-4.0", "vctk_speaker": "p228"},
            {"name": "estelle", "recording": "kyutai", "license": "CC0-1.0", "gender": "female", "accent": "French"},
            {"name": "cosette", "recording": "expresso", "license": "CC-BY-NC-4.0"},
            {"name": "daan", "recording": "?", "license": "NOASSERTION", "exclude": "no documented source recording"},
        ],
        "pins": {
            "kyutai_states": {n: {"size": 1, "sha256": n * 2} for n in ("anna", "estelle", "cosette", "daan")},
            "vctk_clips": {s: {"size": 1, "sha256": s} for s in ("p225", "p228", "p254", "p999")},
        },
    }


def test_speaker_info_parses_gender_accent_and_region():
    speakers = voices.parse_speaker_info(SPEAKER_INFO)
    assert set(speakers) == {"p225", "p228", "p254", "p280", "p315", "s5"}
    assert speakers["p225"].gender == "female" and speakers["p225"].accent == "English"
    assert speakers["p254"].gender == "male" and speakers["p254"].region == "Surrey"
    assert speakers["p280"].region == "mic2 files unavailable"
    assert speakers["p315"].region == "New England Text and mic2 files unavailable"


def test_speaker_info_rejects_an_unknown_gender():
    with pytest.raises(voices.VoiceToolError):
        voices.parse_speaker_info("p1  20  X  English  Somewhere\n")


def test_candidates_exclude_unlicensed_voices_and_deduplicate_vctk_speakers():
    candidates = {
        c["id"]: c for c in voices.build_candidates(sources_fixture(), voices.parse_speaker_info(SPEAKER_INFO))
    }
    # p228 backs Kyutai's anna, so it is not listed again as a VCTK clip.
    assert "vctk-p228" not in candidates
    assert candidates["anna"]["gender"] == "female" and candidates["anna"]["labels"] == "vctk-speaker-info"
    assert candidates["estelle"]["status"] == "candidate" and candidates["estelle"]["labels"] == "manual"
    assert candidates["cosette"]["status"] == "excluded:license CC-BY-NC-4.0"
    assert candidates["daan"]["status"] == "excluded:no documented source recording"
    assert candidates["vctk-p254"]["status"] == "candidate" and candidates["vctk-p254"]["gender"] == "male"
    # A clip without speaker metadata cannot be labelled, so it is excluded.
    assert candidates["vctk-p999"]["status"] == "excluded:missing speaker metadata"
    permitted = {c["license"] for c in candidates.values() if c["status"] == "candidate"}
    assert permitted <= voices.PERMITTED_LICENSES


def test_sources_reject_duplicate_kyutai_voices(tmp_path):
    value = sources_fixture()
    value["kyutai_voices"].append(dict(value["kyutai_voices"][0]))
    path = tmp_path / "sources.json"
    path.write_text(json.dumps(value))
    with pytest.raises(voices.VoiceToolError):
        voices.load_sources(path)


def test_checked_in_sources_only_permit_documented_licences():
    sources = voices.load_sources()
    for voice in sources["kyutai_voices"]:
        if voice["license"] not in voices.PERMITTED_LICENSES:
            continue
        assert voice.get("vctk_speaker") or voice.get("gender"), voice["name"]
    names = {voice["name"] for voice in sources["kyutai_voices"]}
    assert set(sources["pins"]["kyutai_states"]) == names


@pytest.mark.parametrize("compression", [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED])
def test_zip_member_is_read_through_range_requests(compression):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression) as archive:
        archive.writestr("VCTK/wav48/p225/p225_001.flac", b"x" * 5000)
        archive.writestr("speaker-info.txt", SPEAKER_INFO)
        archive.writestr("README.txt", "readme")
    data = buffer.getvalue()
    reads = []

    def read(start: int, length: int) -> bytes:
        reads.append(length)
        return data[start : start + length]

    name, member = voices.read_zip_member(read, len(data), "speaker-info.txt")
    assert name == "speaker-info.txt" and member.decode() == SPEAKER_INFO
    assert sum(reads) < len(data) + 70_000


def test_zip_member_must_be_unique():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("a/speaker-info.txt", "1")
        archive.writestr("b/speaker-info.txt", "2")
    data = buffer.getvalue()
    with pytest.raises(voices.VoiceToolError):
        voices.read_zip_member(lambda start, length: data[start : start + length], len(data), "speaker-info.txt")


def test_archive_reader_refuses_unreviewed_hosts():
    with pytest.raises(voices.VoiceToolError):
        voices.http_range_reader("https://example.com/VCTK.zip")


def test_word_error_rate_is_lenient_about_case_and_punctuation():
    assert voices.word_error_rate("Hi there!", "hi, there.") == 0
    assert voices.word_error_rate("Okay, sounds good.", "Okay sounds") == pytest.approx(1 / 3)
    assert voices.word_error_rate("one two", "one two three four") == 1


def render(**overrides) -> dict[str, Any]:
    base = {
        "wer": 0.0,
        "reached_eos": True,
        "clip_ratio": 0.0,
        "lead_silence": 0.7,
        "trail_silence": 0.2,
        "noise_floor_db": -75.0,
    }
    return {**base, **overrides}


def test_summary_flags_quality_problems():
    assert voices.summarize([render(), render(wer=0.1)]) == {"mean_wer": 0.05, "max_wer": 0.1, "flags": []}
    flagged = voices.summarize(
        [render(reached_eos=False, clip_ratio=0.01), render(lead_silence=1.5, noise_floor_db=-30, wer=0.6)]
    )
    assert flagged["flags"] == ["no-eos", "clipping", "lead-silence", "noisy", "unintelligible-prompt"]


def test_rank_orders_by_flags_then_error_rate_per_gender():
    candidates = [
        {"id": "a", "gender": "female"},
        {"id": "b", "gender": "female"},
        {"id": "c", "gender": "female"},
        {"id": "d", "gender": "male"},
        {"id": "unscreened", "gender": "male"},
    ]
    results = {
        "a": {"summary": {"mean_wer": 0.01, "max_wer": 0.05, "flags": ["noisy"]}},
        "b": {"summary": {"mean_wer": 0.05, "max_wer": 0.1, "flags": []}},
        "c": {"summary": {"mean_wer": 0.02, "max_wer": 0.1, "flags": []}},
        "d": {"summary": {"mean_wer": 0.0, "max_wer": 0.0, "flags": []}},
    }
    ranked = voices.rank(candidates, results)
    assert [c["id"] for c in ranked["female"]] == ["c", "b", "a"]
    assert [c["id"] for c in ranked["male"]] == ["d"]


def test_listening_page_exports_a_selection_for_each_set():
    page = voices.render_listening_page(
        {
            "female": [
                {"id": "eve", "license": "CC-BY-4.0", "accent": "English", "screening": {"mean_wer": 0.0, "flags": []}}
            ]
        },
        {"prompts": ["Hi <there>"], "temperature": 0.3, "seed": 1},
    )
    assert 'src="audio/eve-0.wav"' in page and "Hi &lt;there&gt;" in page
    for voice_set in ("core", "catalog", "recommended"):
        assert f'data-set="{voice_set}"' in page


def test_safetensors_round_trip_is_byte_stable(tmp_path):
    np = pytest.importorskip("numpy")
    pocket_onnx = load_pocket_onnx()

    tensors = {
        "layers.1/cache": np.arange(24, dtype=np.float32).reshape(2, 1, 3, 2, 2),
        "layers.0/offset": np.array([3], dtype=np.int64),
    }
    first, second = tmp_path / "a.safetensors", tmp_path / "b.safetensors"
    pocket_onnx.write_safetensors(first, tensors)
    pocket_onnx.write_safetensors(second, dict(reversed(tensors.items())))
    assert first.read_bytes() == second.read_bytes()
    loaded = pocket_onnx.read_safetensors(first)
    assert loaded.keys() == tensors.keys()
    assert np.array_equal(loaded["layers.1/cache"], tensors["layers.1/cache"])
    assert loaded["layers.0/offset"].tolist() == [3]


def test_zip64_archives_are_read_through_the_locator(monkeypatch):
    # Force the ZIP64 end records that the real 11.7 GB VCTK archive uses.
    monkeypatch.setattr(zipfile, "ZIP_FILECOUNT_LIMIT", 1)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("VCTK/README", "readme " * 50)
        archive.writestr("speaker-info.txt", SPEAKER_INFO)
    data = buffer.getvalue()
    assert b"PK\x06\x07" in data
    name, member = voices.read_zip_member(
        lambda start, length: data[start : start + length], len(data), "speaker-info.txt"
    )
    assert member.decode() == SPEAKER_INFO


def test_changed_state_hashes_fail_unless_rehashed():
    hashes = {"vctk-p225": "a" * 64}
    voices.record_state_hash(hashes, "vctk-p226", "b" * 64, rehash=False)
    voices.record_state_hash(hashes, "vctk-p225", "a" * 64, rehash=False)
    with pytest.raises(voices.VoiceToolError, match="differs from the recorded"):
        voices.record_state_hash(hashes, "vctk-p225", "c" * 64, rehash=False)
    voices.record_state_hash(hashes, "vctk-p225", "c" * 64, rehash=True)
    assert hashes == {"vctk-p225": "c" * 64, "vctk-p226": "b" * 64}


def test_checked_in_state_hashes_cover_only_vctk_candidates():
    hashes = voices.load_state_hashes()
    assert hashes, "encoded-state-hashes.json must record the published states"
    assert all(key.startswith("vctk-") and len(value) == 64 for key, value in hashes.items())


def test_reproduction_check_refuses_an_empty_selection(tmp_path):
    with pytest.raises(voices.VoiceToolError, match="No Kyutai VCTK voice"):
        voices.check_reproduction(None, sources_fixture(), tmp_path, ["not-a-voice"], 0.998)


def test_state_comparison_fails_on_structural_differences():
    np = pytest.importorskip("numpy")
    pocket_onnx = load_pocket_onnx()

    def state(positions: int, offset: int | None = None) -> dict[str, Any]:
        cache = np.linspace(0.1, 1.0, 2 * positions * 4, dtype=np.float32).reshape(2, 1, positions, 2, 2)
        return {"l0/cache": cache, "l0/offset": np.array([positions if offset is None else offset], dtype=np.int64)}

    assert pocket_onnx.compare_states(state(3), state(3)) == {"l0/cache": pytest.approx(1.0)}
    for candidate in (state(4), state(3, offset=2), {"l0/cache": state(3)["l0/cache"]}):
        with pytest.raises(ValueError):
            pocket_onnx.compare_states(candidate, state(3))
    silent = state(3)
    silent["l0/cache"] = np.zeros_like(silent["l0/cache"])
    with pytest.raises(ValueError, match="not finite"):
        pocket_onnx.compare_states(silent, state(3))


def test_generation_limits_match_the_worker():
    pocket_onnx = load_pocket_onnx()

    # Mirrors framesAfterEos and maxFramesForTokens in pocket-runtime.js.
    assert pocket_onnx.frames_after_eos("Hi there!") == 5
    assert pocket_onnx.frames_after_eos("Okay, sounds really very good.") == 3
    assert pocket_onnx.max_frames_for_tokens(12) == 75
    assert pocket_onnx.prepare_text("hello\nworld") == "Hello world."


def test_every_shipped_voice_is_licensed_recorded_and_credited():
    """R24: every core or downloadable voice has a reviewed licence, a licence record and its attribution."""
    sources = voices.load_sources()
    selection = voices.load_selection()
    kyutai = {voice["name"]: voice for voice in sources["kyutai_voices"]}
    core = {e["path"]: e for e in json.loads(voices.BROWSER_MANIFEST.read_text())["files"]}
    hosted = {e["path"]: e for e in json.loads(voices.VOICE_SET_MANIFEST.read_text())["files"]}
    records = json.loads(voices.LICENSE_RECORDS.read_text())
    pocket = next(group for group in records["groups"] if group["id"] == "browser-pocket")
    recorded = {entry["path"]: entry["sha256"] for entry in pocket["external_files"]}
    core_voices = {f"{v['id']}.safetensors" for v in selection["voices"] if v["delivery"] == "core"}
    assert core_voices == {n for n, e in core.items() if e["target"].startswith("models/pocket-tts/voices/")}
    for voice in selection["voices"]:
        name = f"{voice['id']}.safetensors"
        entry = core[name] if voice["delivery"] == "core" else hosted[name]
        # Core entries carry a per-file licence; the hosted set is CC BY 4.0 as a whole.
        assert entry.get("license", "CC-BY-4.0") == "CC-BY-4.0", voice["id"]
        if not voice["source"].startswith("vctk-"):
            origin = kyutai[voice["source"]]
            # The recording must be permitted and not excluded; the file carries the repository licence.
            assert origin["license"] in voices.PERMITTED_LICENSES and not origin.get("exclude"), voice["id"]
        record_path = core[name]["target"] if voice["delivery"] == "core" else f"models/{voices.VOICE_SET_ID}/{name}"
        assert recorded.get(record_path) == entry["sha256"], voice["id"]
    assert voices.voice_notice(sources, selection) in voices.ATTRIBUTION.read_text()
    assert selection["default"] == "eve"
    assert sum(voice["recommended"] for voice in selection["voices"]) == 14
    assert {v["id"] for v in selection["voices"] if v["delivery"] == "core"} == {
        v["id"] for v in selection["voices"] if v["recommended"] or v["id"] == "eve"
    }


def test_selection_rejects_unsafe_voice_ids(tmp_path):
    value = json.loads(voices.SELECTION.read_text())
    value["voices"][0]["id"] = "../eve"
    path = tmp_path / "selection.json"
    path.write_text(json.dumps(value))
    with pytest.raises(voices.VoiceToolError):
        voices.load_selection(path)


def test_hosted_set_notices_and_core_entries_match_the_generator():
    """The published ATTRIBUTION.md/README.md are exactly what `release` generates for the set."""
    sources, selection = voices.load_sources(), voices.load_selection()
    for name, text in voices.voice_set_notices(sources, selection).items():
        assert (voices.VOICE_SET_DIRECTORY / name).read_bytes() == text.encode(), name
    attribution = (voices.VOICE_SET_DIRECTORY / "ATTRIBUTION.md").read_text()
    hosted = [v for v in selection["voices"] if voices.is_hosted(v)]
    assert f"Voices in this set ({len(hosted)})" in attribution
    for voice in selection["voices"]:
        assert (f"\n- {voice['id']}" in attribution) == voices.is_hosted(voice), voice["id"]
    # Self-encoded core states are published once and referenced from both manifests.
    core = {e["path"]: e for e in json.loads(voices.BROWSER_MANIFEST.read_text())["files"]}
    hosted_entries = {e["path"]: e for e in json.loads(voices.VOICE_SET_MANIFEST.read_text())["files"]}
    for name, entry in core.items():
        if entry["source"].get("kind") == "release":
            assert entry["source"] == hosted_entries[name]["source"], name
            assert entry["sha256"] == hosted_entries[name]["sha256"], name


def test_every_selected_voice_has_its_pinned_source_recording_preview():
    """Previews resolve the reviewed recording, independently of state installation."""
    sources, selection = voices.load_sources(), voices.load_selection()
    origins = {voice["name"]: voice for voice in sources["kyutai_voices"]}
    base = "https://huggingface.co/kyutai/tts-voices/resolve/323332d33f997de8394f24a193e1a76df720e01a/"
    for voice in selection["voices"]:
        source = voice["source"]
        expected_path = (
            f"vctk/{source.removeprefix('vctk-')}_023_enhanced.wav"
            if source.startswith("vctk-")
            else origins[source]["recording"].split()[1]
        )
        assert voices.voice_preview_url(sources, source) == base + expected_path, voice["id"]
    assert voices.voice_preview_url(sources, "eve") == base + "vctk/p361_023_enhanced.wav"
    assert voices.voice_preview_url(sources, "azelma") == base + "vctk/p303_023_enhanced.wav"
    assert voices.voice_preview_url(sources, "javert") == base + "voice-donations/Butter.wav"
    assert voices.voice_preview_url(sources, "marius") == base + "voice-donations/Selfie.wav"


def test_frontend_catalog_matches_reproducible_metadata_generation():
    """Regenerating metadata from tracked inputs requires no models, installs or network."""
    sources, selection = voices.load_sources(), voices.load_selection()
    candidates = {
        candidate["id"]: candidate for candidate in json.loads(voices.INVENTORY_JSON.read_text())["candidates"]
    }
    entries = {
        entry["path"]: {"entry": entry}
        for manifest in (voices.BROWSER_MANIFEST, voices.VOICE_SET_MANIFEST)
        for entry in json.loads(manifest.read_text())["files"]
    }
    by_id = {voice["id"]: entries[f"{voice['id']}.safetensors"] for voice in selection["voices"]}
    assert voices.FRONTEND_CATALOG.read_text() == voices.frontend_catalog(selection, candidates, by_id, sources)


@pytest.mark.parametrize(
    "change",
    ["repository", "revision", "path", "recording", "traversal", "license", "excluded", "unknown", "speaker"],
)
def test_voice_previews_reject_unreviewed_or_arbitrary_urls(change):
    sources = voices.load_sources()
    source = "bill_boerst"
    origin = next(voice for voice in sources["kyutai_voices"] if voice["name"] == source)
    if change == "repository":
        sources["clips"]["repository"] = "example/other-voices"
    elif change == "revision":
        sources["clips"]["revision"] = "main"
    elif change == "path":
        sources["clips"]["vctk_path"] = "https://example.com/{speaker}.wav"
        source = "vctk-p236"
    elif change == "recording":
        origin["recording"] = "https://example.com/sample.wav (unreviewed)"
    elif change == "traversal":
        origin["recording"] = "kyutai/tts-voices voice-zero/../../other.wav (unreviewed)"
    elif change == "license":
        origin["license"] = "NOASSERTION"
    elif change == "excluded":
        origin["exclude"] = "source withdrawn"
    elif change == "unknown":
        source = "https://example.com/sample.wav"
    else:
        source = "vctk-p999"
    with pytest.raises(voices.VoiceToolError):
        voices.voice_preview_url(sources, source)
