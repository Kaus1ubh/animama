#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "numpy>=2.2,<3",
#     "scipy>=1.14,<2",
#     "onnxruntime>=1.22,<2",
#     "sentencepiece>=0.2,<0.3",
#     "onnx-asr>=0.7,<0.8",
# ]
# ///
"""Curate PocketTTS voices from pinned sources: inventory, encode, screen and listen.

Run with `uv run scripts/voices/voices.py <command>`. uv installs the voice-authoring
dependencies from the inline metadata and `voices.py.lock` into an isolated
environment, so the backend project and its lock never carry them.

Commands, in order:

- `pin`: record upstream sizes and SHA-256 for every pinned source in `sources.json`
  (network; only needed when the pinned revisions change).
- `fetch`: download the pinned files into the work directory and verify them.
- `encode`: encode every VCTK candidate into a voice state and record its SHA-256
  in the tracked `encoded-state-hashes.json` (a changed hash fails unless
  `--rehash`); `--check` reproduces Kyutai's own VCTK states and reports
  per-layer cosine similarity.
- `screen`: render fixed prompts for every candidate, then score intelligibility
  (Parakeet WER) and audio quality, ranked per gender.
- `inventory`: write `voice-inventory.json` and its Markdown summary beside the plan.
- `listen`: write a static listening page for owner curation.

Work files default to `<model store root>/../voice-tools` (override with
`--work-dir` or `ANIMAMA_VOICE_TOOLS_DIR`). Nothing in the work directory is tracked;
`pin`, `encode` and `inventory` also update the tracked files named above.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import struct
import sys
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from urllib import error, parse, request

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
if str(REPOSITORY / "scripts" / "models") not in sys.path:
    sys.path.insert(0, str(REPOSITORY / "scripts" / "models"))
import parakeet as store  # noqa: E402

SOURCES = HERE / "sources.json"
STATE_HASHES = HERE / "encoded-state-hashes.json"
PLAN_DIRECTORY = REPOSITORY / "docs" / "plans" / "pocket-tts-voice-catalog"
INVENTORY_JSON = PLAN_DIRECTORY / "voice-inventory.json"
INVENTORY_MD = PLAN_DIRECTORY / "voice-inventory.md"
PERMITTED_LICENSES = {"CC-BY-4.0", "CC0-1.0"}
HF_API = "https://huggingface.co/api/models/{repository}/tree/{revision}/{directory}"
HF_FILE = "https://huggingface.co/{repository}/resolve/{revision}/{path}"
DATASHARE_HOST = "datashare.ed.ac.uk"
SCREEN_PROMPTS = (
    "Hi there!",
    "Okay, sounds good.",
    "It looks like the rain will clear up by the afternoon, so we could go for a walk later.",
    "I read the whole book last night. The ending surprised me. I think you would enjoy it too.",
    "Could you pass me the blue notebook on the kitchen table?",
    "That was a wonderful idea, thank you so much!",
)
SCREEN_SEED = 20260926


class VoiceToolError(Exception):
    """An actionable failure in the voice-authoring workflow."""


# ---------------------------------------------------------------------------
# Sources and metadata


def load_sources(path: Path = SOURCES) -> dict:
    """Load the pinned source description, rejecting an unknown schema or duplicate voices."""
    sources = json.loads(path.read_text())
    if sources.get("schema") != "animama-pocket-voice-sources/1":
        raise VoiceToolError("Unexpected sources.json schema")
    names = [voice["name"] for voice in sources["kyutai_voices"]]
    if len(names) != len(set(names)):
        raise VoiceToolError("sources.json lists a Kyutai voice twice")
    return sources


@dataclass(frozen=True)
class Speaker:
    """One VCTK speaker from `speaker-info.txt`."""

    id: str
    age: int | None
    gender: str
    accent: str
    region: str


def parse_speaker_info(text: str) -> dict[str, Speaker]:
    """Parse VCTK 0.92 `speaker-info.txt` (ID, AGE, GENDER, ACCENTS, REGION/COMMENTS)."""
    speakers = {}
    for line in text.splitlines():
        fields = line.split()
        if not fields or fields[0].upper() == "ID" or not re.fullmatch(r"[ps]\d+", fields[0]):
            continue
        if len(fields) < 4 or fields[2] not in {"F", "M"}:
            raise VoiceToolError(f"Unparseable speaker-info line: {line!r}")
        age = int(fields[1]) if fields[1].isdigit() else None
        region = re.sub(r"[()]", "", " ".join(fields[4:])).strip()
        speakers[fields[0]] = Speaker(fields[0], age, "female" if fields[2] == "F" else "male", fields[3], region)
    return speakers


# ---------------------------------------------------------------------------
# Remote ZIP member extraction (VCTK metadata lives inside an 11.7 GB archive)

RangeReader = Callable[[int, int], bytes]


def http_range_reader(url: str) -> RangeReader:
    """Read byte ranges from an allowlisted HTTPS archive without following redirects."""
    parsed = parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != DATASHARE_HOST:
        raise VoiceToolError(f"Refusing an unreviewed archive URL: {url}")

    class NoRedirect(request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = request.build_opener(request.ProxyHandler({}), NoRedirect())

    def read(start: int, length: int) -> bytes:
        headers = {"Range": f"bytes={start}-{start + length - 1}", "User-Agent": "Animama-voice-tools/1"}
        try:
            with opener.open(request.Request(url, headers=headers), timeout=60) as response:
                if response.status != 206:
                    raise VoiceToolError(f"Archive host ignored the range request (HTTP {response.status})")
                data = response.read(length + 1)
        except error.HTTPError as exc:
            exc.close()
            raise VoiceToolError(f"Archive host returned HTTP {exc.code}; redirects are not followed") from exc
        except (error.URLError, TimeoutError, OSError) as exc:
            raise VoiceToolError("Archive range request failed; check connectivity and retry") from exc
        if len(data) != length:
            raise VoiceToolError("Archive range response had an unexpected length")
        return data

    return read


def _zip64_extra(extra: bytes, sizes: list[int]) -> list[int]:
    """Replace 0xFFFFFFFF placeholders with ZIP64 extra-field values, in order."""
    index = 0
    while index + 4 <= len(extra):
        tag, length = struct.unpack_from("<HH", extra, index)
        if tag == 0x0001:
            values = list(struct.unpack_from(f"<{length // 8}Q", extra, index + 4))
            return [values.pop(0) if value == 0xFFFFFFFF and values else value for value in sizes]
        index += 4 + length
    return sizes


def read_zip_member(read: RangeReader, archive_size: int, suffix: str) -> tuple[str, bytes]:
    """Return the single member whose path ends with `suffix`, using only range reads."""
    tail_length = min(archive_size, 65_536 + 22)
    tail = read(archive_size - tail_length, tail_length)
    eocd = tail.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise VoiceToolError("Archive end-of-central-directory record not found")
    _, _, _, _, entries, directory_size, directory_offset = struct.unpack_from("<IHHHHII", tail, eocd)
    locator = eocd - 20  # A ZIP64 locator, when present, immediately precedes the classic record.
    if locator >= 0 and tail[locator : locator + 4] == b"PK\x06\x07":
        (zip64_offset,) = struct.unpack_from("<Q", tail, locator + 8)
        record = read(zip64_offset, 56)
        if record[:4] != b"PK\x06\x06":
            raise VoiceToolError("Archive ZIP64 record not found")
        entries, directory_size, directory_offset = struct.unpack_from("<QQQ", record, 32)
    directory = read(directory_offset, directory_size)
    matches = []
    index = 0
    for _ in range(entries):
        if directory[index : index + 4] != b"PK\x01\x02":
            raise VoiceToolError("Archive central directory is malformed")
        method, _, _, _, compressed, uncompressed, name_length, extra_length, comment_length = struct.unpack_from(
            "<HHHIIIHHH", directory, index + 10
        )
        (local_offset,) = struct.unpack_from("<I", directory, index + 42)
        name = directory[index + 46 : index + 46 + name_length].decode("utf-8")
        extra = directory[index + 46 + name_length : index + 46 + name_length + extra_length]
        if name.endswith(suffix):
            uncompressed, compressed, local_offset = _zip64_extra(extra, [uncompressed, compressed, local_offset])
            matches.append((name, method, compressed, uncompressed, local_offset))
        index += 46 + name_length + extra_length + comment_length
    if len(matches) != 1:
        raise VoiceToolError(f"Expected one archive member ending in {suffix!r}, found {len(matches)}")
    name, method, compressed, uncompressed, local_offset = matches[0]
    header = read(local_offset, 30)
    if header[:4] != b"PK\x03\x04":
        raise VoiceToolError("Archive local header is malformed")
    name_length, extra_length = struct.unpack_from("<HH", header, 26)
    payload = read(local_offset + 30 + name_length + extra_length, compressed)
    if method == 0:
        data = payload
    elif method == 8:
        data = zlib.decompress(payload, -15)
    else:
        raise VoiceToolError(f"Unsupported archive compression method {method}")
    if len(data) != uncompressed:
        raise VoiceToolError("Archive member size mismatch")
    return name, data


# ---------------------------------------------------------------------------
# Work directory and verified downloads


def work_directory(value: str | None) -> Path:
    """Resolve the untracked work directory beside the shared model store."""
    configured = value or os.environ.get("ANIMAMA_VOICE_TOOLS_DIR")
    path = Path(configured).expanduser() if configured else store.resolve_root().parent / "voice-tools"
    if not path.is_absolute():
        raise VoiceToolError("--work-dir must be absolute")
    path.mkdir(parents=True, exist_ok=True)
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_verified(url: str, destination: Path, size: int, sha256: str) -> Path:
    """Download one pinned Hugging Face file unless a verified copy already exists."""
    if destination.exists():
        if destination.stat().st_size == size and sha256_file(destination) == sha256:
            return destination
        destination.unlink()
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".partial")
    partial.unlink(missing_ok=True)
    try:
        with store.open_download(url) as stream:
            store.copy_verified(stream, partial, {"path": destination.name, "size": size, "sha256": sha256})
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)
    return destination


def pinned_files(sources: dict) -> list[dict]:
    """Every pinned file with its URL and work-directory path."""
    pins = sources.get("pins")
    if not pins:
        raise VoiceToolError("sources.json has no pins; run `voices.py pin` first")
    files = []
    states, clips = sources["kyutai_states"], sources["clips"]
    for name, entry in sorted(pins["kyutai_states"].items()):
        path = states["path"].format(name=name)
        url = HF_FILE.format(repository=states["repository"], revision=states["revision"], path=path)
        files.append({**entry, "url": url, "local": Path("kyutai-states") / f"{name}.safetensors"})
    for speaker, entry in sorted(pins["vctk_clips"].items()):
        path = clips["vctk_path"].format(speaker=speaker)
        url = HF_FILE.format(repository=clips["repository"], revision=clips["revision"], path=path)
        files.append({**entry, "url": url, "local": Path("vctk-clips") / Path(path).name})
    return files


def command_pin(args: argparse.Namespace) -> None:
    """Record upstream sizes and SHA-256 at the pinned revisions (network)."""
    sources = load_sources()
    states, clips = sources["kyutai_states"], sources["clips"]

    def listing(repository: str, revision: str, directory: str) -> list[dict]:
        url = HF_API.format(repository=repository, revision=revision, directory=directory)
        with request.urlopen(request.Request(url, headers={"User-Agent": "Animama-voice-tools/1"}), timeout=60) as r:
            return json.loads(r.read())

    state_dir = str(Path(states["path"]).parent)
    kyutai = {}
    for item in listing(states["repository"], states["revision"], state_dir):
        name = Path(item["path"]).stem
        if item["path"].endswith(".safetensors") and "lfs" in item:
            kyutai[name] = {"size": item["lfs"]["size"], "sha256": item["lfs"]["oid"]}
    listed = {voice["name"] for voice in sources["kyutai_voices"]}
    if set(kyutai) != listed:
        raise VoiceToolError(f"Kyutai states differ from sources.json: {sorted(set(kyutai) ^ listed)}")
    vctk = {}
    for item in listing(clips["repository"], clips["revision"], "vctk"):
        match = re.fullmatch(r"vctk/([ps]\d+)_023_enhanced\.wav", item["path"])
        if match and "lfs" in item:
            vctk[match.group(1)] = {"size": item["lfs"]["size"], "sha256": item["lfs"]["oid"]}

    metadata = sources["vctk_metadata"]
    read = http_range_reader(metadata["url"])
    member, data = read_zip_member(read, metadata["archive_size"], "speaker-info.txt")
    speakers = parse_speaker_info(data.decode("utf-8"))
    sources["pins"] = {
        "kyutai_states": dict(sorted(kyutai.items())),
        "vctk_clips": dict(sorted(vctk.items())),
        "speaker_info": {"member": member, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()},
    }
    SOURCES.write_text(json.dumps(sources, indent=2) + "\n")
    print(f"Pinned {len(kyutai)} Kyutai states, {len(vctk)} VCTK clips and {len(speakers)} speaker records")


def command_fetch(args: argparse.Namespace) -> None:
    """Download and verify every pinned file into the work directory."""
    sources = load_sources()
    work = work_directory(args.work_dir)
    files = pinned_files(sources)
    for index, entry in enumerate(files, 1):
        fetch_verified(entry["url"], work / entry["local"], entry["size"], entry["sha256"])
        print(f"[{index}/{len(files)}] {entry['local']}", flush=True)
    speaker_info(sources, work)
    print(f"Verified {len(files)} files and speaker-info in {work}")


def speaker_info(sources: dict, work: Path) -> dict[str, Speaker]:
    """Read the pinned `speaker-info.txt`, extracting it from the archive on first use."""
    pin = sources["pins"]["speaker_info"]
    path = work / "vctk-speaker-info.txt"
    if not (path.exists() and sha256_file(path) == pin["sha256"]):
        metadata = sources["vctk_metadata"]
        member, data = read_zip_member(http_range_reader(metadata["url"]), metadata["archive_size"], pin["member"])
        if hashlib.sha256(data).hexdigest() != pin["sha256"]:
            raise VoiceToolError(f"Pinned speaker-info hash mismatch for {member}")
        path.write_bytes(data)
    return parse_speaker_info(path.read_text("utf-8"))


# ---------------------------------------------------------------------------
# Inventory


def build_candidates(sources: dict, speakers: dict[str, Speaker]) -> list[dict]:
    """Merge Kyutai states and VCTK clips into one candidate list with licence decisions.

    A VCTK speaker already backing a Kyutai state keeps Kyutai's state, so each
    speaker appears once. Only CC BY 4.0 and CC0 sources may be candidates.
    """
    pins = sources["pins"]
    candidates = []
    covered_speakers = set()
    for voice in sources["kyutai_voices"]:
        speaker = voice.get("vctk_speaker")
        if speaker:
            covered_speakers.add(speaker)
        info = speakers.get(speaker) if speaker else None
        status = "candidate"
        if voice.get("exclude"):
            status = f"excluded:{voice['exclude']}"
        elif voice["license"] not in PERMITTED_LICENSES:
            status = f"excluded:license {voice['license']}"
        candidates.append(
            {
                "id": voice["name"],
                "kind": "kyutai-state",
                "source": {
                    "repository": sources["kyutai_states"]["repository"],
                    "revision": sources["kyutai_states"]["revision"],
                    "path": sources["kyutai_states"]["path"].format(name=voice["name"]),
                    "sha256": pins["kyutai_states"][voice["name"]]["sha256"],
                    "recording": voice["recording"],
                },
                "license": voice["license"],
                "gender": info.gender if info else voice.get("gender"),
                "accent": info.accent if info else voice.get("accent"),
                "region": info.region if info else None,
                "labels": "vctk-speaker-info" if info else "manual",
                "status": status,
            }
        )
    for speaker_id, pin in sorted(pins["vctk_clips"].items()):
        if speaker_id in covered_speakers:
            continue
        info = speakers.get(speaker_id)
        candidates.append(
            {
                "id": f"vctk-{speaker_id}",
                "kind": "vctk-clip",
                "source": {
                    "repository": sources["clips"]["repository"],
                    "revision": sources["clips"]["revision"],
                    "path": sources["clips"]["vctk_path"].format(speaker=speaker_id),
                    "sha256": pin["sha256"],
                    "recording": f"CSTR VCTK Corpus 0.92 {speaker_id}_023 (mic1, Kyutai-enhanced)",
                },
                "license": "CC-BY-4.0",
                "gender": info.gender if info else None,
                "accent": info.accent if info else None,
                "region": info.region if info else None,
                "labels": "vctk-speaker-info" if info else "missing",
                "status": "candidate" if info else "excluded:missing speaker metadata",
            }
        )
    ids = [candidate["id"] for candidate in candidates]
    if len(ids) != len(set(ids)):
        raise VoiceToolError("Duplicate candidate IDs")
    return candidates


def command_inventory(args: argparse.Namespace) -> None:
    """Write the tracked inventory (with screening results when available)."""
    sources = load_sources()
    work = work_directory(args.work_dir)
    candidates = build_candidates(sources, speaker_info(sources, work))
    results_path = work / "screen" / "results.json"
    results = json.loads(results_path.read_text())["voices"] if results_path.exists() else {}
    state_hashes = load_state_hashes()
    for candidate in candidates:
        if candidate["kind"] == "vctk-clip" and candidate["id"] in state_hashes:
            candidate["encoded_state_sha256"] = state_hashes[candidate["id"]]
        if candidate["id"] in results:
            candidate["screening"] = results[candidate["id"]]["summary"]
    document = {
        "schema": "animama-pocket-voice-inventory/1",
        "sources": {key: sources[key] for key in ("kyutai_states", "clips", "vctk_metadata")},
        "speaker_info": sources["pins"]["speaker_info"],
        "candidates": candidates,
    }
    INVENTORY_JSON.write_text(json.dumps(document, indent=2) + "\n")
    INVENTORY_MD.write_text(render_inventory_markdown(candidates))
    counts = {}
    for candidate in candidates:
        key = candidate["status"].split(":")[0]
        counts[key] = counts.get(key, 0) + 1
    print(f"Wrote {INVENTORY_JSON.relative_to(REPOSITORY)}: {counts}")


def render_inventory_markdown(candidates: list[dict]) -> str:
    """A reviewable summary table of every candidate."""
    lines = [
        "# PocketTTS voice candidate inventory",
        "",
        "Generated by `uv run scripts/voices/voices.py inventory` from `scripts/voices/sources.json`.",
        "Hashes and full sources are in `voice-inventory.json`.",
        "",
        "| ID | Kind | Gender | Accent | Licence | Status | WER | Flags |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for c in candidates:
        screening = c.get("screening") or {}
        wer = f"{screening['mean_wer']:.3f}" if "mean_wer" in screening else ""
        flags = ", ".join(screening.get("flags", []))
        lines.append(
            f"| {c['id']} | {c['kind']} | {c['gender'] or '?'} | {c['accent'] or '?'} | {c['license']} "
            f"| {c['status']} | {wer} | {flags} |"
        )
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Encoding


def load_state_hashes(path: Path = STATE_HASHES) -> dict[str, str]:
    """The tracked SHA-256 of every self-encoded voice state."""
    return json.loads(path.read_text()) if path.exists() else {}


def record_state_hash(hashes: dict[str, str], voice_id: str, digest: str, *, rehash: bool) -> None:
    """Record a new state hash; a changed hash fails unless the change is deliberate."""
    recorded = hashes.get(voice_id)
    if recorded and recorded != digest and not rehash:
        raise VoiceToolError(
            f"{voice_id}: encoded state {digest[:16]} differs from the recorded {recorded[:16]}; "
            "investigate the toolchain change or rerun with --rehash deliberately"
        )
    hashes[voice_id] = digest


def check_reproduction(runtime, sources: dict, work: Path, only: list[str] | None, tolerance: float) -> float:
    """Re-encode Kyutai's VCTK voices and compare them with Kyutai's states; return the worst cosine."""
    import pocket_onnx

    voices = [v for v in sources["kyutai_voices"] if v.get("vctk_speaker") and (not only or v["name"] in only)]
    unknown = set(only or ()) - {v["name"] for v in voices}
    if unknown or not voices:
        raise VoiceToolError(f"No Kyutai VCTK voice to check for {sorted(unknown) or 'this selection'}")
    worst = 1.0
    for voice in voices:
        clip = work / "vctk-clips" / f"{voice['vctk_speaker']}_023_enhanced.wav"
        encoded = runtime.encode_voice_state(pocket_onnx.load_wav_24k(clip))
        reference = pocket_onnx.read_safetensors(work / "kyutai-states" / f"{voice['name']}.safetensors")
        try:
            lowest = min(pocket_onnx.compare_states(encoded, reference).values())
        except ValueError as exc:
            raise VoiceToolError(f"{voice['name']}: {exc}") from exc
        worst = min(worst, lowest)
        print(f"{voice['name']:>10} ({voice['vctk_speaker']}): min cosine {lowest:.5f}", flush=True)
    print(f"Checked {len(voices)} voices; worst per-layer cosine {worst:.5f} (tolerance {tolerance})")
    if worst < tolerance:
        raise VoiceToolError("Encoder does not reproduce Kyutai's states within tolerance")
    return worst


def command_encode(args: argparse.Namespace) -> None:
    """Encode VCTK candidates and record their hashes; `--check` reproduces Kyutai's VCTK states."""
    import pocket_onnx

    sources = load_sources()
    work = work_directory(args.work_dir)
    runtime = pocket_onnx.PocketOnnx(browser_store(), with_generation=False)
    if args.check:
        check_reproduction(runtime, sources, work, args.only, args.tolerance)
        return
    output = work / "encoded-states"
    output.mkdir(exist_ok=True)
    hashes = load_state_hashes()
    selected = [
        c
        for c in build_candidates(sources, speaker_info(sources, work))
        if c["kind"] == "vctk-clip" and c["status"] == "candidate" and (not args.only or c["id"] in args.only)
    ]
    if args.only and len(selected) != len(set(args.only)):
        raise VoiceToolError(f"Unknown VCTK candidates: {sorted(set(args.only) - {c['id'] for c in selected})}")
    try:
        for candidate in selected:
            clip = work / "vctk-clips" / Path(candidate["source"]["path"]).name
            target = output / f"{candidate['id']}.safetensors"
            pending = target.with_name(target.name + ".partial")
            pocket_onnx.write_safetensors(pending, runtime.encode_voice_state(pocket_onnx.load_wav_24k(clip)))
            try:
                record_state_hash(hashes, candidate["id"], sha256_file(pending), rehash=args.rehash)
            except VoiceToolError:
                pending.unlink()
                raise
            pending.replace(target)
            print(f"{candidate['id']}: {hashes[candidate['id']][:16]}", flush=True)
    finally:
        STATE_HASHES.write_text(json.dumps(dict(sorted(hashes.items())), indent=2) + "\n")


def browser_store() -> Path:
    """The verified local browser speech store (acquire it with browser_speech.py)."""
    import browser_speech

    return browser_speech.store.verify(browser_speech.load_manifest(), store.resolve_root())


# ---------------------------------------------------------------------------
# Screening


def normalize_words(text: str) -> list[str]:
    """Lenient WER normalisation: lowercase words without punctuation."""
    return re.sub(r"[^a-z0-9' ]+", " ", text.lower().replace("-", " ")).split()


def word_error_rate(reference: str, hypothesis: str) -> float:
    """Levenshtein word distance divided by the reference length."""
    ref, hyp = normalize_words(reference), normalize_words(hypothesis)
    previous = list(range(len(hyp) + 1))
    for i, word in enumerate(ref, 1):
        current = [i]
        for j, other in enumerate(hyp, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (word != other)))
        previous = current
    return previous[-1] / max(len(ref), 1)


def audio_metrics(audio, sample_rate: int) -> dict:
    """Clipping, leading/trailing silence and noise-floor estimates for one render."""
    import numpy as np

    frame = int(sample_rate * 0.02)
    usable = len(audio) // frame * frame
    if usable == 0:
        return {"duration": 0.0, "clip_ratio": 0.0, "lead_silence": 0.0, "trail_silence": 0.0, "noise_floor_db": -120.0}
    rms = np.sqrt(np.mean(audio[:usable].reshape(-1, frame) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    active = np.flatnonzero(db > -40)
    lead = (active[0] if active.size else len(db)) * 0.02
    trail = (len(db) - 1 - active[-1] if active.size else len(db)) * 0.02
    return {
        "duration": round(len(audio) / sample_rate, 3),
        "clip_ratio": float(np.mean(np.abs(audio) >= 0.99)),
        "peak": float(np.max(np.abs(audio))),
        "lead_silence": round(float(lead), 2),
        "trail_silence": round(float(trail), 2),
        "noise_floor_db": round(float(np.percentile(db, 10)), 1),
    }


def summarize(renders: list[dict]) -> dict:
    """Aggregate per-prompt results into ranking fields and quality flags."""
    mean_wer = sum(r["wer"] for r in renders) / len(renders)
    flags = []
    if any(not r["reached_eos"] for r in renders):
        flags.append("no-eos")
    if max(r["clip_ratio"] for r in renders) > 0.001:
        flags.append("clipping")
    if max(r["lead_silence"] for r in renders) > 1.2:
        flags.append("lead-silence")
    if max(r["trail_silence"] for r in renders) > 1.0:
        flags.append("trail-silence")
    if max(r["noise_floor_db"] for r in renders) > -45:
        flags.append("noisy")
    if max(r["wer"] for r in renders) >= 0.5:
        flags.append("unintelligible-prompt")
    return {"mean_wer": round(mean_wer, 4), "max_wer": round(max(r["wer"] for r in renders), 4), "flags": flags}


def command_screen(args: argparse.Namespace) -> None:
    """Render the fixed prompts for every candidate, then score them."""
    import wave

    import numpy as np
    import onnx_asr
    import pocket_onnx
    import scipy.signal

    sources = load_sources()
    work = work_directory(args.work_dir)
    runtime = pocket_onnx.PocketOnnx(browser_store())
    parakeet_manifest = store.load_manifest(store.DEFAULT_MANIFEST)
    asr = onnx_asr.load_model(
        "nemo-parakeet-tdt-0.6b-v2", str(store.verify(parakeet_manifest, store.resolve_root())), quantization="int8"
    )
    output = work / "screen"
    (output / "audio").mkdir(parents=True, exist_ok=True)
    results_path = output / "results.json"
    parameters = {"prompts": list(SCREEN_PROMPTS), "seed": SCREEN_SEED, "temperature": pocket_onnx.TEMPERATURE}
    results = json.loads(results_path.read_text()) if results_path.exists() else {"voices": {}}
    if {key: results.get(key) for key in parameters} != parameters and results["voices"]:
        if not args.force:
            raise VoiceToolError("Saved screening used different prompts, seed or temperature; rerun with --force")
        results["voices"] = {}  # Never mix renders made with different parameters.
    results.update(parameters)
    candidates = [c for c in build_candidates(sources, speaker_info(sources, work)) if c["status"] == "candidate"]
    for number, candidate in enumerate(candidates, 1):
        if args.only and candidate["id"] not in args.only:
            continue
        if candidate["id"] in results["voices"] and not args.force:
            continue
        if candidate["kind"] == "kyutai-state":
            state_path = work / "kyutai-states" / f"{candidate['id']}.safetensors"
        else:
            state_path = work / "encoded-states" / f"{candidate['id']}.safetensors"
        voice = pocket_onnx.read_safetensors(state_path)
        renders = []
        for index, prompt in enumerate(SCREEN_PROMPTS):
            rendered = runtime.render(prompt, voice, seed=SCREEN_SEED + index)
            audio = rendered.audio.astype(np.float32)
            wav_path = output / "audio" / f"{candidate['id']}-{index}.wav"
            with wave.open(str(wav_path), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(pocket_onnx.SAMPLE_RATE)
                handle.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
            transcript = asr.recognize(scipy.signal.resample_poly(audio, 2, 3).astype(np.float32), sample_rate=16_000)
            renders.append(
                {
                    "prompt": index,
                    "transcript": transcript,
                    "wer": round(word_error_rate(prompt, transcript), 4),
                    "reached_eos": rendered.reached_eos,
                    "frames": rendered.frames,
                    **audio_metrics(audio, pocket_onnx.SAMPLE_RATE),
                }
            )
        results["voices"][candidate["id"]] = {"renders": renders, "summary": summarize(renders)}
        results_path.write_text(json.dumps(results, indent=2) + "\n")
        summary = results["voices"][candidate["id"]]["summary"]
        print(f"[{number}/{len(candidates)}] {candidate['id']}: WER {summary['mean_wer']:.3f} {summary['flags']}")


def rank(candidates: list[dict], results: dict) -> dict[str, list[dict]]:
    """Rank screened candidates per gender: fewer flags, then lower mean and max WER."""
    groups: dict[str, list[dict]] = {"female": [], "male": []}
    for candidate in candidates:
        summary = results.get(candidate["id"], {}).get("summary")
        if summary and candidate["gender"] in groups:
            groups[candidate["gender"]].append({**candidate, "screening": summary})
    for members in groups.values():
        members.sort(
            key=lambda c: (len(c["screening"]["flags"]), c["screening"]["mean_wer"], c["screening"]["max_wer"])
        )
    return groups


# ---------------------------------------------------------------------------
# Listening page


def command_listen(args: argparse.Namespace) -> None:
    """Write a static page for owner curation of the top-ranked voices per gender."""
    sources = load_sources()
    work = work_directory(args.work_dir)
    results = json.loads((work / "screen" / "results.json").read_text())
    candidates = [c for c in build_candidates(sources, speaker_info(sources, work)) if c["status"] == "candidate"]
    groups = rank(candidates, results["voices"])
    limits = {"female": args.female, "male": args.male}
    page = render_listening_page({g: members[: limits[g]] for g, members in groups.items()}, results)
    target = work / "screen" / "index.html"
    target.write_text(page)
    print(f"Listening page: {target}")


def render_listening_page(groups: dict[str, list[dict]], results: dict) -> str:
    """Self-contained HTML with audio players, scores and an exportable selection."""
    prompts = results["prompts"]
    rows = []
    for gender, members in groups.items():
        rows.append(
            f"<h2>{gender.title()} ({len(members)})</h2><table><thead><tr><th>Rank</th><th>Voice</th>"
            "<th>Accent</th><th>WER</th><th>Flags</th><th>Samples</th><th>Core</th><th>Catalog</th>"
            "<th>Recommended</th></tr></thead><tbody>"
        )
        for position, c in enumerate(members, 1):
            vid = html.escape(c["id"])
            players = "".join(
                f'<audio controls preload="none" title="{html.escape(p)}" src="audio/{vid}-{i}.wav"></audio>'
                for i, p in enumerate(prompts)
            )
            checks = "".join(
                f'<td><input type="checkbox" data-voice="{vid}" data-gender="{gender}" data-set="{s}" '
                f'aria-label="{s.title()}: {vid}"></td>'
                for s in ("core", "catalog", "recommended")
            )
            rows.append(
                f"<tr><td>{position}</td><td><b>{vid}</b><br><small>{html.escape(c['license'])}</small></td>"
                f"<td>{html.escape(c['accent'] or '?')}</td><td>{c['screening']['mean_wer']:.3f}</td>"
                f"<td>{html.escape(', '.join(c['screening']['flags']))}</td><td class=p>{players}</td>{checks}</tr>"
            )
        rows.append("</tbody></table>")
    prompt_list = "".join(f"<li>{html.escape(p)}</li>" for p in prompts)
    return f"""<!doctype html><html lang=en><head><meta charset=utf-8><title>Pocket voice curation</title>
<style>body{{font:14px system-ui;margin:24px}}table{{border-collapse:collapse;width:100%}}
td,th{{border-bottom:1px solid #ddd;padding:6px;vertical-align:top;text-align:left}}
td.p audio{{width:190px;height:28px;margin:2px}}</style></head><body>
<h1>Pocket voice curation</h1>
<p>Temperature {results["temperature"]}, seed {results["seed"]}. Prompts, in player order:</p><ol>{prompt_list}</ol>
<p><button id=export>Export selection JSON</button> <span id=counts></span></p>
{"".join(rows)}
<script>
const boxes=[...document.querySelectorAll('input[type=checkbox]')];
const KEY='pocket-voice-curation';
function selection(){{const s={{core:[],catalog:[],recommended:[]}};
for(const b of boxes) if(b.checked) s[b.dataset.set].push(b.dataset.voice); return s;}}
function count(set,gender){{return boxes.filter(b=>b.checked&&b.dataset.set===set&&b.dataset.gender===gender).length;}}
function update(){{document.getElementById('counts').textContent=['core','catalog','recommended'].map(set=>
`${{set}} ${{count(set,'female')}}F/${{count(set,'male')}}M`).join(' · ');
try{{localStorage.setItem(KEY,JSON.stringify(selection()));}}catch(e){{}}}}
try{{const saved=JSON.parse(localStorage.getItem(KEY)||'null');
if(saved) for(const b of boxes) b.checked=(saved[b.dataset.set]||[]).includes(b.dataset.voice);}}catch(e){{}}
boxes.forEach(b=>b.addEventListener('change',update));update();
document.getElementById('export').onclick=()=>{{const a=document.createElement('a');
a.href=URL.createObjectURL(new Blob([JSON.stringify(selection(),null,2)],{{type:'application/json'}}));
a.download='voice-selection.json';a.click();}};
</script></body></html>
"""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--work-dir", help="absolute untracked work directory")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("pin", help="record upstream hashes at the pinned revisions")
    commands.add_parser("fetch", help="download and verify pinned files")
    encode = commands.add_parser("encode", help="encode VCTK candidates into voice states")
    encode.add_argument("--check", action="store_true", help="reproduce Kyutai's VCTK states instead")
    encode.add_argument("--tolerance", type=float, default=0.998, help="minimum per-layer cosine for --check")
    encode.add_argument("--only", nargs="*", help="limit to these IDs")
    encode.add_argument("--rehash", action="store_true", help="accept changed state hashes deliberately")
    screen = commands.add_parser("screen", help="render and score every candidate")
    screen.add_argument("--only", nargs="*", help="limit to these IDs")
    screen.add_argument("--force", action="store_true", help="re-screen voices that already have results")
    commands.add_parser("inventory", help="write the tracked inventory files")
    listen = commands.add_parser("listen", help="write the listening page")
    listen.add_argument("--female", type=int, help="female voices to show (default: all screened)")
    listen.add_argument("--male", type=int, help="male voices to show (default: all screened)")
    args = parser.parse_args(argv)
    handlers = {
        "pin": command_pin,
        "fetch": command_fetch,
        "encode": command_encode,
        "screen": command_screen,
        "inventory": command_inventory,
        "listen": command_listen,
    }
    try:
        handlers[args.command](args)
    except (VoiceToolError, store.ModelStoreError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
