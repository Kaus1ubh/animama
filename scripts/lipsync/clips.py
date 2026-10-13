"""Maintainer tools for the lip-sync evaluation clips.

The evaluation (`pnpm --dir src/frontend/web lipsync:eval`) runs on committed
fixtures and never needs these tools. They make the inputs for
`lipsync:fixtures` in a clip directory kept outside the repository:

- `generate`: speak the test lines (`src/frontend/web/tests/lipsync/testset.json`)
  with Gemini (through the backend's own finalized speech stream), ElevenLabs v4
  Turbo over the Text to Dialogue socket, or Pocket TTS locally. Paid requests
  read keys from the environment, never print them, and skip clips that already
  exist, so a rerun never pays twice.
- `reference`: forced-align each clip's words for scoring (`reference.json`).
  It uses torchaudio's MMS aligner, whose weights are CC-BY-NC-4.0: evaluation
  only, never shipped.
- `estimated`: record the gruut phonemes today's estimated planner receives for
  each line (`estimated.json`), as the chat stream builds them.

Run from the repository root; see scripts/lipsync/README.md for each command's
dependencies.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import sys
import unicodedata
import wave
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TESTSET = REPO / "src/frontend/web/tests/lipsync/testset.json"
SAMPLE_RATE = 24_000
TAG = re.compile(r"<[^>]+>|\[[^\]]+\]")


def load_lines(only: list[str] | None) -> list[dict]:
    lines = json.loads(TESTSET.read_text())["lines"]
    return [line for line in lines if not only or line["id"] in only]


def write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm)


def sentences(text: str) -> list[str]:
    """Sentence inputs as the app's chunker sends them to the dialogue socket."""
    parts = re.split(r"(?<=[.!?;。！？])(?![.!?;。！？])\s*", text)
    return [part.strip() for part in parts if part.strip()]


# --- generate -----------------------------------------------------------------


async def speak_gemini(line: dict) -> bytes:
    """Speak a line through the backend's own Gemini finalized speech stream."""
    from animama.server.gemini_tts_service import GeminiFinalizedSpeech, stream_gemini_finalized_speech

    texts = sentences(line["text"]) if line.get("perSentence") else [line["text"]]
    pcm = bytearray()
    for text in texts:
        prepared = GeminiFinalizedSpeech(
            run_id=f"lipsync-{line['id']}",
            voice_id=line["voice"],
            model_id=line["model"],
            text=text,
            style=line.get("style"),
        )
        async for payload in stream_gemini_finalized_speech(prepared):
            if payload["type"] == "audio":
                pcm.extend(base64.b64decode(payload["audio_base64"]))
            elif payload["type"] == "error":
                # Never keep a partial clip: a kept file is never regenerated.
                raise SystemExit(f"{line['id']}: {payload['code']} {payload['error']}")
    return bytes(pcm)


async def speak_eleven_socket(line: dict) -> tuple[bytes, dict]:
    """Speak a line over the Text to Dialogue socket as the app does; keep every frame's timing."""
    import urllib.parse

    import httpx
    import websockets

    key = os.environ["ELEVENLABS_API_KEY"]
    token = httpx.post(
        "https://api.elevenlabs.io/v1/single-use-token/ttd_websocket", headers={"xi-api-key": key}, timeout=20
    )
    token.raise_for_status()
    query = urllib.parse.urlencode(
        {
            "model_id": line["model"],
            "output_format": "pcm_24000",
            "sync_alignment": "true",
            "single_use_token": token.json()["token"],
        }
    )
    chunks = sentences(line["text"])
    messages: list[dict] = []
    pcm = bytearray()
    url = f"wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?{query}"
    async with websockets.connect(url, max_size=None) as socket:
        await socket.send(json.dumps({"voices": [line["voice"]]}))
        for index, chunk in enumerate(chunks):
            await socket.send(json.dumps({"inputs": [{"text": f"{chunk} ", "voice_id": line["voice"]}]}))
            if index == 0:
                await socket.send(json.dumps({"flush": True}))
        await socket.send(json.dumps({"close_socket": True}))
        async for raw in socket:
            payload = json.loads(raw)
            if payload.get("error"):
                raise SystemExit(f"{line['id']}: {payload.get('code')} {payload.get('message')}")
            audio = base64.b64decode(payload["audio"]) if payload.get("audio") else b""
            pcm.extend(audio)
            message: dict = {"samples": len(audio) // 2, "alignment": payload.get("alignment")}
            for flag in ("is_final_audio_for_turn", "is_final"):
                if payload.get(flag) is True:
                    message[flag] = True
            messages.append(message)
            if payload.get("is_final") is True:
                break
    sent = "".join(f"{chunk} " for chunk in chunks)
    return bytes(pcm), {
        "source": f"ElevenLabs Text to Dialogue socket, {line['model']}",
        "text": sent,
        "messages": messages,
    }


def speak_pocket(runtime, pocket_onnx, store: Path, line: dict) -> bytes:
    """Render sentence by sentence with the worker's 0.25 s gap, as the browser worker does."""
    import numpy as np

    voice = pocket_onnx.read_safetensors(store / f"{line['voice']}.safetensors")
    parts = []
    for index, chunk in enumerate(sentences(line["text"])):
        if parts:
            parts.append(np.zeros(int(0.25 * SAMPLE_RATE), np.float32))
        parts.append(runtime.render(chunk, voice, seed=7 + index).audio.astype(np.float32))
    return (np.clip(np.concatenate(parts), -1, 1) * 32767).astype("<i2").tobytes()


async def generate(args: argparse.Namespace) -> None:
    args.clips.mkdir(parents=True, exist_ok=True)
    pocket = None
    sent = 0
    for line in load_lines(args.only):
        path = args.clips / f"{line['id']}.wav"
        if path.exists() or line["provider"] == "openai" or line.get("transport") == "http":
            continue
        if args.dry_run:
            print(f"{line['id']}: would speak {len(line['text'])} characters with {line['provider']}")
            continue
        if line["provider"] == "gemini":
            pcm = await speak_gemini(line)
        elif line["provider"] == "elevenlabs":
            pcm, frames = await speak_eleven_socket(line)
            (args.clips / f"{line['id']}.socket.json").write_text(json.dumps(frames, ensure_ascii=False))
        elif line["provider"] == "pocket":
            if pocket is None:
                sys.path.insert(0, str(REPO / "scripts/voices"))
                import pocket_onnx

                store = args.pocket_store
                pocket = (pocket_onnx.PocketOnnx(store, encoder=store / "text_conditioner.onnx"), pocket_onnx, store)
            pcm = speak_pocket(pocket[0], pocket[1], pocket[2], line)
        else:
            continue
        write_wav(path, pcm)
        sent += 1
        print(f"{line['id']}: {len(pcm) / (2 * SAMPLE_RATE):.2f} s")
    print(f"clips made: {sent}")


# --- reference ------------------------------------------------------------------


def reference(args: argparse.Namespace) -> None:
    import numpy as np
    import torch
    import torchaudio
    import uroman
    from pypinyin import lazy_pinyin

    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=False)
    tokenizer = bundle.get_tokenizer()
    aligner = bundle.get_aligner()
    letters = set(bundle.get_dict().keys())
    roman = uroman.Uroman()

    def words_for(line: dict) -> list[str]:
        text = TAG.sub(" ", line["text"])
        if line["lang"] == "ja":
            import pyopenjtalk

            kana = pyopenjtalk.g2p(text, kana=True)
            raw = [roman.romanize_string(c, lcode="jpn") for c in re.split(r"[、。！？!?,.\s]+", kana) if c]
        elif line["lang"] == "zh":
            raw = lazy_pinyin(re.sub(r"[^一-鿿]", "", text))
        elif line["lang"] == "ko":
            raw = [roman.romanize_string(w, lcode="kor") for w in text.split()]
        else:
            raw = text.split()
        # Fold accents (qué -> que) before keeping the aligner's letters.
        plain = ["".join(c for c in unicodedata.normalize("NFD", w) if not unicodedata.combining(c)) for w in raw]
        cleaned = ["".join(c for c in w.lower().replace("’", "'") if c in letters) for w in plain]
        return [w for w in cleaned if w]

    out_path = args.clips / "reference.json"
    result = json.loads(out_path.read_text()) if out_path.exists() else {}
    for line in load_lines(args.only):
        path = args.clips / f"{line['id']}.wav"
        if not path.exists() or (line["id"] in result and not args.force):
            continue
        with wave.open(str(path)) as handle:
            rate = handle.getframerate()
            audio = np.frombuffer(handle.readframes(-1), np.int16).astype(np.float32) / 32768
        wav = torchaudio.functional.resample(torch.from_numpy(audio)[None], rate, bundle.sample_rate)
        words = words_for(line)
        with torch.inference_mode():
            emission, _ = model(wav)
            spans = aligner(emission[0], tokenizer(words))
        ratio = wav.shape[1] / emission.shape[1] / bundle.sample_rate
        entry = []
        for word, word_spans in zip(words, spans, strict=True):
            chars = [
                [word[k], round(s.start * ratio, 3), round(s.end * ratio, 3), round(float(s.score), 3)]
                for k, s in enumerate(word_spans)
            ]
            entry.append({"word": word, "start": chars[0][1], "end": chars[-1][2], "chars": chars})
        result[line["id"]] = entry
        print(f"{line['id']}: {len(words)} words")
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=1))


# --- estimated -----------------------------------------------------------------


def estimated(args: argparse.Namespace) -> None:
    from animama.app.gruut_text import build_gruut_sse_text

    out_path = args.clips / "estimated.json"
    result = json.loads(out_path.read_text()) if out_path.exists() else {}
    for line in load_lines(args.only):
        # The chat stream phonemizes the speech text with tags as written.
        payload = build_gruut_sse_text(line["text"], lang="en_US") or {}
        result[line["id"]] = {
            "tokenizedText": payload.get("tokenized_text") or "",
            "phonemizedText": payload.get("phonemized_text") or [],
        }
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(f"estimated inputs: {len(result)} lines")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("generate", "reference", "estimated"):
        command = commands.add_parser(name)
        command.add_argument("clips", type=Path, help="clip directory outside the repository")
        command.add_argument("--only", nargs="*", help="line ids")
        if name == "generate":
            command.add_argument("--dry-run", action="store_true")
            command.add_argument("--pocket-store", type=Path, help="verified browser-speech model set")
        if name == "reference":
            command.add_argument("--force", action="store_true", help="realign clips already aligned")
    args = parser.parse_args()
    if args.command == "generate":
        asyncio.run(generate(args))
    elif args.command == "reference":
        reference(args)
    else:
        estimated(args)


if __name__ == "__main__":
    main()
