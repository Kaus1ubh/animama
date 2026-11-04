#!/usr/bin/env python3
"""Select, fetch and score the offline speech-recognition test set (issue #509).

Development and evaluation tool only. Audio is fetched into the evaluation root
(``ANIMAMA_SPEECH_EVAL_ROOT``, default ``<model cache>/../speech-eval``) and is
never committed; ``testset.json`` tracks dataset revisions, hashes and clip
names only. Benchmark results come from the development speech benchmark page
(``speech-bench.html``) through ``src/frontend/scripts/speech-bench.mjs``.

Commands:

- ``select``: choose clips for the FLEURS sets from their pinned TSVs and record
  them in ``testset.json`` (maintainer step; reruns are deterministic).
- ``fetch``: download the pinned FLEURS files, verify their hashes and extract the
  selected clips plus ``clips/clips.json`` for the benchmark page.
- ``models``: download the pinned evaluation-only candidate model files listed in
  ``models.json`` into ``<root>/models/<name>/`` and write their ``metadata.json``.
- ``score``: turn benchmark result files into error rates, latency percentiles
  and a Markdown table.
- ``root``: print the evaluation root (used by the benchmark runner).
"""

from __future__ import annotations

import argparse
import io
import json
import os
import random
import re
import shutil
import sys
import tarfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "models"))
import parakeet as store  # Reuse the reviewed HTTPS download helpers

TESTSET = Path(__file__).with_name("testset.json")
MODELS = Path(__file__).with_name("models.json")
SAMPLE_RATE = 16000
MIN_SECONDS = 1.0
MAX_SECONDS = 15.0
# Half-open (low, high] buckets so short and long windows are both represented.
DURATION_BUCKETS = ((0.0, 6.0), (6.0, 10.0), (10.0, 15.0))
CJK_LANGUAGES = {"ja", "ko", "zh", "yue"}
TAG_PATTERN = re.compile(r"<\|[^|]*\|>")
FLEURS_COLUMNS = 7


class EvalError(Exception):
    """A reportable evaluation failure."""


@dataclass(frozen=True)
class SourceRow:
    sentence_id: str
    file_name: str
    text: str
    seconds: float


def eval_root() -> Path:
    configured = os.environ.get("ANIMAMA_SPEECH_EVAL_ROOT")
    root = Path(configured).expanduser() if configured else store.resolve_root().parent / "speech-eval"
    if not root.is_absolute():
        raise EvalError("ANIMAMA_SPEECH_EVAL_ROOT must be an absolute directory")
    return root


def load_testset(path: Path = TESTSET) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_testset(testset: dict, path: Path = TESTSET) -> None:
    path.write_text(json.dumps(testset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_fleurs_tsv(text: str) -> list[SourceRow]:
    """FLEURS columns: sentence id, file, raw text, normalized text, characters, samples, gender."""
    rows = []
    for line in text.splitlines():
        if not line.strip():
            continue
        fields = line.split("\t")
        if len(fields) != FLEURS_COLUMNS:
            raise EvalError(f"Expected {FLEURS_COLUMNS} FLEURS columns, got {len(fields)}")
        rows.append(SourceRow(fields[0], fields[1], fields[2], int(fields[5]) / SAMPLE_RATE))
    return rows


def select_clips(rows: list[SourceRow], *, count: int, seed: str) -> list[SourceRow]:
    """Pick one recording per sentence, spread across duration buckets, reproducibly."""
    rng = random.Random(seed)
    by_sentence: dict[str, list[SourceRow]] = {}
    for row in sorted(rows, key=lambda row: (row.sentence_id, row.file_name)):
        if MIN_SECONDS <= row.seconds <= MAX_SECONDS:
            by_sentence.setdefault(row.sentence_id, []).append(row)
    if len(by_sentence) < count:
        raise EvalError(f"Need {count} sentences of {MIN_SECONDS:g}–{MAX_SECONDS:g} s; only {len(by_sentence)}")
    picks = [rng.choice(recordings) for _, recordings in sorted(by_sentence.items())]

    buckets: list[list[SourceRow]] = [[] for _ in DURATION_BUCKETS]
    for row in picks:
        index = next(i for i, (low, high) in enumerate(DURATION_BUCKETS) if low < row.seconds <= high)
        buckets[index].append(row)
    for bucket in buckets:
        rng.shuffle(bucket)

    quota = [count // len(buckets) + (1 if i < count % len(buckets) else 0) for i in range(len(buckets))]
    selected = []
    leftovers = []
    for bucket, target in zip(buckets, quota, strict=True):
        selected += bucket[:target]
        leftovers += bucket[target:]
    rng.shuffle(leftovers)
    selected += leftovers[: count - len(selected)]
    return sorted(selected, key=lambda row: row.file_name)


def units(text: str, language: str) -> list[str]:
    """Scoring units: words for English, letters and digits for CJK languages."""
    folded = unicodedata.normalize("NFKC", TAG_PATTERN.sub(" ", text)).casefold()
    if language in CJK_LANGUAGES:
        return [ch for ch in folded if unicodedata.category(ch)[0] in "LN"]
    kept = "".join(ch if unicodedata.category(ch)[0] in "LN" or ch in "'’" else " " for ch in folded)
    return [word.strip("'’") for word in kept.replace("’", "'").split() if word.strip("'’")]


def edit_distance(reference: list[str], hypothesis: list[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for i, ref_unit in enumerate(reference, start=1):
        current = [i]
        for j, hyp_unit in enumerate(hypothesis, start=1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ref_unit != hyp_unit)))
        previous = current
    return previous[-1]


def error_counts(reference: str, hypothesis: str, language: str) -> tuple[int, int]:
    ref = units(reference, language)
    return edit_distance(ref, units(hypothesis, language)), len(ref)


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise EvalError("percentile of an empty list")
    position = (len(ordered) - 1) * q / 100
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def summarize(result_paths: list[Path], references: dict[tuple[str, str], dict]) -> list[dict]:
    """Corpus-level error rates and latency per engine configuration and set.

    A configuration is engine and model set, backend, mode, interim text and
    runtime; scoring two runs of the same configuration together is refused
    rather than merged.
    """
    groups: dict[tuple, dict] = {}
    for path in result_paths:
        run = json.loads(Path(path).read_text(encoding="utf-8"))
        for clip in run["clips"]:
            key = (clip["set"], clip["id"])
            if key not in references:
                raise EvalError(f"Result clip {clip['set']}/{clip['id']} is not in the test set ({path})")
            reference = references[key]
            engine = f"{run['engine']} ({run['models']})" if run.get("models") else run["engine"]
            configuration = (engine, run["backend"], run["mode"], bool(run.get("interim")), run["runtime"])
            group = groups.setdefault(
                (*configuration, clip["set"]),
                {
                    "language": reference["language"],
                    "ids": set(),
                    "edits": 0,
                    "units": 0,
                    "final": [],
                    "interim": [],
                    "processing": 0.0,
                    "audio": 0.0,
                    "tagLeaks": 0,
                    "coldLoadMs": run.get("coldLoadMs"),
                    "warmLoadMs": run.get("warmLoadMs"),
                    "peakMb": (run.get("memory") or {}).get("peakMb"),
                    "medianMb": (run.get("memory") or {}).get("medianMb"),
                    "loadPeakMb": (run.get("memory") or {}).get("loadPeakMb"),
                    "peakByProcessMb": (run.get("memory") or {}).get("peakByProcessMb"),
                    "interimStops": 0,
                },
            )
            if clip["id"] in group["ids"]:
                raise EvalError(f"{clip['set']}/{clip['id']} appears twice for one configuration; score one run each")
            group["ids"].add(clip["id"])
            # The page converts the reference too when a set is scored in another
            # script than its source (zh-Hant from Mainland Mandarin clips).
            if reference.get("referenceScript") and not clip.get("reference"):
                raise EvalError(f"{clip['set']}/{clip['id']} has no converted reference; rerun it")
            reference_text = clip.get("reference") or reference["text"]
            edits, count = error_counts(reference_text, clip["text"], reference["language"])
            group["edits"] += edits
            group["units"] += count
            group["final"].append(clip["finalLatencyMs"])
            if clip.get("firstInterimMs") is not None:
                group["interim"].append(clip["firstInterimMs"])
            group["processing"] += clip.get("processingMs", clip["finalLatencyMs"]) / 1000
            group["audio"] += clip["audioSeconds"]
            group["tagLeaks"] += bool(TAG_PATTERN.search(clip["text"]))
            group["interimStops"] += clip.get("interimStops", 0)

    summary = []
    for (engine, backend, mode, interim, runtime, set_id), group in sorted(groups.items()):
        summary.append(
            {
                "engine": engine,
                "backend": backend,
                "mode": f"{mode}, interim" if interim else mode,
                "runtime": runtime,
                "set": set_id,
                "metric": "CER" if group["language"] in CJK_LANGUAGES else "WER",
                "errorRate": group["edits"] / group["units"] if group["units"] else 0.0,
                "clips": len(group["final"]),
                "finalP50Ms": percentile(group["final"], 50),
                "finalP90Ms": percentile(group["final"], 90),
                "firstInterimP50Ms": percentile(group["interim"], 50) if group["interim"] else None,
                "realTimeFactor": group["processing"] / group["audio"] if group["audio"] else None,
                "coldLoadMs": group["coldLoadMs"],
                "warmLoadMs": group["warmLoadMs"],
                "peakMb": group["peakMb"],
                "medianMb": group["medianMb"],
                "loadPeakMb": group["loadPeakMb"],
                "peakByProcessMb": group["peakByProcessMb"],
                "interimStops": group["interimStops"],
                "tagLeaks": group["tagLeaks"],
            }
        )
    return summary


def _number(value: float | None, digits: int = 0) -> str:
    return "–" if value is None else f"{value:,.{digits}f}"


def markdown_table(rows: list[dict]) -> str:
    lines = [
        "| Engine | Backend | Mode | Runtime | Set | Error | Clips | Final p50 ms | Final p90 ms "
        "| First interim p50 ms | Interim stops | RTF | Cold load ms | Warm load ms "
        "| Load peak MB | Clip median MB | Clip peak MB | Tag leaks |",
        "|" + " --- |" * 6 + " ---: |" * 12,
    ]
    for row in rows:
        lines.append(
            f"| {row['engine']} | {row['backend']} | {row['mode']} | {row['runtime']} | {row['set']} "
            f"| {row['metric']} {row['errorRate'] * 100:.1f}% | {row['clips']} "
            f"| {_number(row['finalP50Ms'])} | {_number(row['finalP90Ms'])} "
            f"| {_number(row['firstInterimP50Ms'])} | {row['interimStops']} | {_number(row['realTimeFactor'], 2)} "
            f"| {_number(row['coldLoadMs'])} | {_number(row['warmLoadMs'])} "
            f"| {_number(row['loadPeakMb'])} | {_number(row['medianMb'])} | {_number(row['peakMb'])} "
            f"| {row['tagLeaks']} |"
        )
    return "\n".join(lines)


def extract_selected(archive: Path, names: set[str], destination: Path) -> set[str]:
    """Copy only the selected regular files, by base name, refusing unsafe paths."""
    destination.mkdir(parents=True, exist_ok=True)
    written = set()
    with tarfile.open(archive, "r:*") as bundle:
        for member in bundle:
            path = PurePosixPath(member.name)
            if not member.isfile() or path.is_absolute() or ".." in path.parts or path.name not in names:
                continue
            source = bundle.extractfile(member)
            if source is None:
                continue
            with source, (destination / path.name).open("wb") as output:
                shutil.copyfileobj(source, output)
            written.add(path.name)
    return written


def _fleurs_url(source: dict, path: str) -> str:
    return f"https://huggingface.co/datasets/{source['repository']}/resolve/{source['revision']}/{path}"


def _download(url: str, entry: dict, destination: Path) -> Path:
    """Reuse a verified copy or download with the reviewed size and hash checks."""
    if destination.exists():
        try:
            store.verify_file(destination, entry)
            return destination
        except store.ModelStoreError:
            destination.unlink()
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + ".partial")
    partial.unlink(missing_ok=True)
    with store.open_download(url) as response:
        store.copy_verified(response, partial, entry)
    partial.replace(destination)
    return destination


def _fleurs_rows(testset: dict, entry: dict, root: Path) -> list[SourceRow]:
    source = testset["sources"]["fleurs"]
    path = f"data/{entry['config']}/test.tsv"
    file_entry = {"path": path} | source["files"][path]
    local = _download(_fleurs_url(source, path), file_entry, root / "downloads/fleurs" / path)
    return parse_fleurs_tsv(local.read_text(encoding="utf-8"))


def command_select(testset: dict, root: Path, set_ids: list[str] | None) -> None:
    by_id = {entry["id"]: entry for entry in testset["sets"]}
    for entry in testset["sets"]:
        if entry["source"] != "fleurs" or (set_ids and entry["id"] not in set_ids):
            continue
        if "sameClipsAs" in entry:
            entry["clips"] = list(by_id[entry["sameClipsAs"]]["clips"])
            continue
        rows = _fleurs_rows(testset, entry, root)
        chosen = select_clips(rows, count=testset["clipsPerSet"], seed=f"{testset['seed']}:{entry['id']}")
        entry["clips"] = [row.file_name for row in chosen]
        print(f"{entry['id']}: {len(chosen)} clips, {sum(row.seconds for row in chosen):.0f} s")
    save_testset(testset)


def _write_manifest(root: Path, clips: list[dict]) -> None:
    manifest = root / "clips/clips.json"
    existing = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else []
    replaced = {clip["set"] for clip in clips}
    merged = [clip for clip in existing if clip["set"] not in replaced] + clips
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps(merged, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def command_fetch(testset: dict, root: Path, set_ids: list[str] | None) -> None:
    """Fetch the FLEURS sets; optional sets only when named with ``--set``."""
    source = testset["sources"]["fleurs"]
    for entry in testset["sets"]:
        wanted = entry["id"] in set_ids if set_ids else not entry.get("optional")
        if entry["source"] != "fleurs" or not wanted:
            continue
        if not entry.get("clips"):
            raise EvalError(f"{entry['id']} has no selected clips; run select first")
        rows = {row.file_name: row for row in _fleurs_rows(testset, entry, root)}
        archive_path = f"data/{entry['config']}/audio/test.tar.gz"
        archive = _download(
            _fleurs_url(source, archive_path),
            {"path": archive_path} | source["files"][archive_path],
            root / "downloads/fleurs" / archive_path,
        )
        wanted = set(entry["clips"])
        written = extract_selected(archive, wanted, root / "clips" / entry["id"])
        if written != wanted:
            raise EvalError(f"{entry['id']}: missing clips in archive: {sorted(wanted - written)[:5]}")
        _write_manifest(
            root,
            [
                {
                    "set": entry["id"],
                    "id": name,
                    "language": entry["language"],
                    "text": rows[name].text,
                    "url": f"{entry['id']}/{name}",
                    **{key: entry[key] for key in ("script", "referenceScript") if key in entry},
                }
                for name in entry["clips"]
            ],
        )
        print(f"{entry['id']}: {len(written)} clips ready")


METADATA_FIELD = 14  # ModelProto.metadata_props


def _varint(stream) -> int:
    shift = result = 0
    while True:
        byte = stream.read(1)
        if not byte:
            raise EOFError
        result |= (byte[0] & 0x7F) << shift
        shift += 7
        if not byte[0] & 0x80:
            return result


def onnx_metadata(path: Path) -> dict[str, str]:
    """Read an ONNX model's metadata_props without loading its graph.

    Walks the top-level ModelProto fields and skips every length-delimited field
    other than metadata_props, so a large model is never read into memory.
    """
    metadata: dict[str, str] = {}
    with path.open("rb") as stream:
        while True:
            try:
                tag = _varint(stream)
            except EOFError:
                break
            field, wire = tag >> 3, tag & 7
            if wire == 0:
                _varint(stream)
            elif wire == 1:
                stream.seek(8, 1)
            elif wire == 5:
                stream.seek(4, 1)
            elif wire == 2:
                size = _varint(stream)
                if field != METADATA_FIELD:
                    stream.seek(size, 1)
                    continue
                entry = io.BytesIO(stream.read(size))
                pair = {}
                while entry.tell() < size:
                    key = _varint(entry)
                    pair[key >> 3] = entry.read(_varint(entry)).decode("utf-8")
                metadata[pair.get(1, "")] = pair.get(2, "")
            else:
                raise EvalError(f"Unsupported protobuf wire type {wire} in {path.name}")
    return metadata


def command_models(root: Path, names: list[str] | None) -> None:
    """Fetch pinned evaluation-only candidate files and write metadata.json."""
    catalog = json.loads(MODELS.read_text(encoding="utf-8"))["models"]
    for name, model in catalog.items():
        if names and name not in names:
            continue
        directory = root / "models" / name
        for file, entry in model["files"].items():
            url = f"https://huggingface.co/{model['repository']}/resolve/{model['revision']}/{file}"
            _download(url, {"path": file} | entry, directory / file)
        # The browser runtime cannot read ONNX metadata, so it is saved beside the files.
        metadata = onnx_metadata(directory / model["metadataFrom"])
        (directory / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )
        print(f"{name}: ready ({model['license']})")


def load_references(root: Path) -> dict[tuple[str, str], dict]:
    manifest = root / "clips/clips.json"
    if not manifest.exists():
        raise EvalError(f"{manifest} is missing; run fetch first")
    return {(clip["set"], clip["id"]): clip for clip in json.loads(manifest.read_text(encoding="utf-8"))}


def command_score(root: Path, paths: list[Path], output: Path | None) -> None:
    summary = summarize(paths, load_references(root))
    if output:
        output.write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(markdown_table(summary))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("select", "fetch"):
        command = commands.add_parser(name)
        command.add_argument("--set", action="append", dest="sets", help="limit to a set id (repeatable)")
    models = commands.add_parser("models")
    models.add_argument("--model", action="append", dest="models", help="limit to a model name (repeatable)")
    score = commands.add_parser("score")
    score.add_argument("results", type=Path, nargs="+")
    score.add_argument("--output", type=Path)
    commands.add_parser("root")
    args = parser.parse_args(argv)

    try:
        testset = load_testset()
        root = eval_root()
        if args.command == "root":
            print(root)
        elif args.command == "select":
            command_select(testset, root, args.sets)
        elif args.command == "fetch":
            command_fetch(testset, root, args.sets)
        elif args.command == "models":
            command_models(root, args.models)
        else:
            command_score(root, args.results, args.output)
    except (EvalError, store.ModelStoreError) as exc:
        print(f"speech-eval: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
