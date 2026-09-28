"""Offline PocketTTS runtime for voice authoring: encode voice states and render samples.

Ports the voice-conditioning, generation and stopping rules that the browser worker
(`src/frontend/web/public/tts/workers/inference-worker.js` and `pocket-runtime.js`)
uses with the shipped `english_2026-04` bundle. Those rules derive from the
KevinAHM/pocket-tts-onnx reference runtime (Apache-2.0); see
`licenses/third-party/code-and-models.md`. Rendering is deterministic for a seed
because sampling uses a seeded NumPy generator and every session runs on one CPU
thread.

Dependencies come from the inline metadata of `voices.py` (run it with `uv run`).
"""

from __future__ import annotations

import json
import math
import re
import struct
import wave
from dataclasses import dataclass
from math import gcd
from pathlib import Path

import numpy as np

SAMPLE_RATE = 24_000
LATENT_DIM = 32
TEMPERATURE = 0.3
EOS_THRESHOLD = -4.0
LSD_STEPS = 1
FIRST_DECODE_FRAMES = 3
DECODE_FRAMES = 12
TOKENS_PER_SECOND_ESTIMATE = 3
GEN_SECONDS_PADDING = 2
FRAME_RATE_HZ = 12.5
MAX_TOKENS_PER_CHUNK = 50
_SAFETENSORS_DTYPES = {"F32": np.float32, "I64": np.int64}
_STATE_DTYPES = {"float32": np.float32, "int64": np.int64, "bool": np.bool_}


def load_wav_24k(path: Path) -> np.ndarray:
    """Read a 16-bit PCM WAV, mix to mono and resample to 24 kHz like the reference runtime."""
    with wave.open(str(path), "rb") as handle:
        if handle.getsampwidth() != 2:
            raise ValueError(f"{path.name}: expected 16-bit PCM")
        rate = handle.getframerate()
        channels = handle.getnchannels()
        audio = np.frombuffer(handle.readframes(-1), dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != SAMPLE_RATE:
        import scipy.signal

        divisor = gcd(rate, SAMPLE_RATE)
        audio = scipy.signal.resample_poly(audio, SAMPLE_RATE // divisor, rate // divisor).astype(np.float32)
    return audio


def read_safetensors(path: Path) -> dict[str, np.ndarray]:
    """Parse the F32/I64 tensors used by Pocket voice states."""
    raw = path.read_bytes()
    (length,) = struct.unpack("<Q", raw[:8])
    header = json.loads(raw[8 : 8 + length])
    payload = raw[8 + length :]
    tensors = {}
    for name, info in header.items():
        if name == "__metadata__":
            continue
        start, end = info["data_offsets"]
        dtype = _SAFETENSORS_DTYPES[info["dtype"]]
        tensors[name] = np.frombuffer(payload[start:end], dtype=dtype).reshape(info["shape"])
    return tensors


def write_safetensors(path: Path, tensors: dict[str, np.ndarray]) -> None:
    """Write tensors in sorted-name order so identical states produce identical bytes."""
    names = {np.dtype(np.float32): "F32", np.dtype(np.int64): "I64"}
    header: dict[str, dict] = {}
    chunks = []
    offset = 0
    for name in sorted(tensors):
        array = np.ascontiguousarray(tensors[name])
        data = array.astype(array.dtype.newbyteorder("<"), copy=False).tobytes()
        header[name] = {
            "dtype": names[array.dtype],
            "shape": list(array.shape),
            "data_offsets": [offset, offset + len(data)],
        }
        chunks.append(data)
        offset += len(data)
    encoded = json.dumps(header, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 8)
    path.write_bytes(struct.pack("<Q", len(encoded)) + encoded + b"".join(chunks))


def frames_after_eos(text: str) -> int:
    """Short prompts keep a longer tail so their endings are not clipped (worker rule)."""
    return 5 if len(text.split()) <= 4 else 3


def max_frames_for_tokens(token_count: int) -> int:
    """Upper bound on generated frames for one text chunk (worker rule)."""
    return int(np.ceil((token_count / TOKENS_PER_SECOND_ESTIMATE + GEN_SECONDS_PADDING) * FRAME_RATE_HZ))


def prepare_text(text: str) -> str:
    """April text preparation for plain prompts: newlines to spaces, capitalised, terminated."""
    text = text.strip().replace("\n", " ").replace("\r", " ").replace("  ", " ")
    if not text:
        raise ValueError("Text cannot be empty")
    text = text[0].upper() + text[1:]
    return text + "." if text[-1].isalnum() else text


@dataclass(frozen=True)
class Rendered:
    """One rendered prompt: 24 kHz mono audio and whether generation reached EOS."""

    audio: np.ndarray
    reached_eos: bool
    frames: int


class PocketOnnx:
    """Single-threaded CPU sessions over a verified browser speech store directory."""

    def __init__(self, store: Path, *, encoder: Path, with_generation: bool = True) -> None:
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1

        def session(name: str):
            return ort.InferenceSession(str(store / name), options, providers=["CPUExecutionProvider"])

        bundle = json.loads((store / "bundle.json").read_text())
        self.flow_manifest = bundle["flow_lm_state_manifest"]
        self.mimi_manifest = bundle["mimi_state_manifest"]
        self.bos = np.load(store / "bos_before_voice.npy").astype(np.float32)
        self.encoder = ort.InferenceSession(str(encoder), options, providers=["CPUExecutionProvider"])
        self.main = session("flow_lm_main_int8.onnx")
        if with_generation:
            import sentencepiece

            self.flow = session("flow_lm_flow.onnx")
            self.decoder = session("mimi_decoder.onnx")
            self.text_conditioner = session("text_conditioner.onnx")
            self.tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(store / "tokenizer.model"))

    @staticmethod
    def _initial_state(manifest: list[dict]) -> dict[str, np.ndarray]:
        state = {}
        for entry in manifest:
            dtype = _STATE_DTYPES[entry["dtype"]]
            if entry["fill"] == "nan":
                state[entry["input_name"]] = np.full(entry["shape"], np.nan, dtype=dtype)
            elif entry["fill"] == "ones":
                state[entry["input_name"]] = np.ones(entry["shape"], dtype=dtype)
            else:
                state[entry["input_name"]] = np.zeros(entry["shape"], dtype=dtype)
        return state

    @staticmethod
    def _update(state: dict[str, np.ndarray], outputs: list[np.ndarray], manifest: list[dict], offset: int) -> None:
        for entry in manifest:
            state[entry["input_name"]] = outputs[offset + entry["index"]]

    def encode_voice_state(self, audio: np.ndarray) -> dict[str, np.ndarray]:
        """Encode 24 kHz audio into a Kyutai-format voice state (per-layer cache and offset)."""
        embedding = self.encoder.run(None, {"audio": audio.reshape(1, 1, -1).astype(np.float32)})[0]
        while embedding.ndim > 3:
            embedding = embedding.squeeze(0)
        conditioning = np.concatenate([self.bos, embedding], axis=1).astype(np.float32)
        state = self._initial_state(self.flow_manifest)
        outputs = self.main.run(
            None,
            {"sequence": np.zeros((1, 0, LATENT_DIM), np.float32), "text_embeddings": conditioning, **state},
        )
        self._update(state, outputs, self.flow_manifest, offset=2)
        voice: dict[str, np.ndarray] = {}
        for entry in self.flow_manifest:
            if entry["key"] != "step":
                continue
            positions = int(state[entry["input_name"]][0])
            cache = next(e for e in self.flow_manifest if e["module"] == entry["module"] and e["key"] == "cache")
            voice[f"{entry['module']}/cache"] = np.ascontiguousarray(state[cache["input_name"]][:, :, :positions])
            voice[f"{entry['module']}/offset"] = np.array([positions], dtype=np.int64)
        return voice

    def state_from_voice(self, voice: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
        """Expand a voice state into full flow LM state (mirrors `stateArraysFromVoiceState`)."""
        state = self._initial_state(self.flow_manifest)
        for entry in self.flow_manifest:
            name = entry["input_name"]
            if entry["key"] == "cache":
                cache = voice[f"{entry['module']}/cache"]
                state[name][:, :, : cache.shape[2]] = cache
            elif entry["key"] == "step":
                state[name][0] = int(voice[f"{entry['module']}/offset"][0])
        return state

    def render(self, text: str, voice: dict[str, np.ndarray], *, seed: int) -> Rendered:
        """Render one short prompt (a single chunk) with the shipped sampling and stopping rules."""
        if re.search(r"[0-9&%$@#/]", text):
            raise ValueError("render() skips the worker's number and symbol normalisation; spell prompts out")
        rng = np.random.default_rng(seed)
        prepared = prepare_text(text)
        token_ids = np.array([self.tokenizer.encode(prepared)], dtype=np.int64)
        if token_ids.shape[1] > MAX_TOKENS_PER_CHUNK:
            raise ValueError("render() handles one worker chunk; keep prompts under 50 tokens")
        text_embeddings = self.text_conditioner.run(None, {"token_ids": token_ids})[0]
        if text_embeddings.ndim == 2:
            text_embeddings = text_embeddings[None]
        state = self.state_from_voice(voice)
        empty_sequence = np.zeros((1, 0, LATENT_DIM), np.float32)
        empty_text = np.zeros((1, 0, text_embeddings.shape[-1]), np.float32)
        outputs = self.main.run(None, {"sequence": empty_sequence, "text_embeddings": text_embeddings, **state})
        self._update(state, outputs, self.flow_manifest, offset=2)

        tail = frames_after_eos(prepared)
        limit = max_frames_for_tokens(token_ids.shape[1])
        current = np.full((1, 1, LATENT_DIM), np.nan, np.float32)
        latents = []
        eos_step = None
        for step in range(limit):
            outputs = self.main.run(None, {"sequence": current, "text_embeddings": empty_text, **state})
            conditioning, eos_logit = outputs[0], float(np.asarray(outputs[1]).ravel()[0])
            self._update(state, outputs, self.flow_manifest, offset=2)
            if eos_logit > EOS_THRESHOLD and eos_step is None:
                eos_step = step
            x = rng.normal(0.0, np.sqrt(TEMPERATURE), (1, LATENT_DIM)).astype(np.float32)
            for j in range(LSD_STEPS):
                s = np.array([[j / LSD_STEPS]], np.float32)
                t = np.array([[(j + 1) / LSD_STEPS]], np.float32)
                x = x + self.flow.run(None, {"c": conditioning, "s": s, "t": t, "x": x})[0] / LSD_STEPS
            latents.append(x.reshape(1, 1, LATENT_DIM))
            current = latents[-1]
            if eos_step is not None and step >= eos_step + tail - 1:
                break
        return Rendered(self._decode(latents), eos_step is not None, len(latents))

    def _decode(self, latents: list[np.ndarray]) -> np.ndarray:
        state = self._initial_state(self.mimi_manifest)
        audio = []
        index = 0
        size = FIRST_DECODE_FRAMES
        while index < len(latents):
            block = np.concatenate(latents[index : index + size], axis=1)
            outputs = self.decoder.run(None, {"latent": block, **state})
            audio.append(np.asarray(outputs[0]).reshape(-1))
            self._update(state, outputs, self.mimi_manifest, offset=1)
            index += block.shape[1]
            size = DECODE_FRAMES
        return np.concatenate(audio) if audio else np.zeros(0, np.float32)


def compare_states(candidate: dict[str, np.ndarray], reference: dict[str, np.ndarray]) -> dict[str, float]:
    """Per-layer cache cosine similarity of two voice states.

    Raises ValueError unless both states have the same tensors, shapes and offsets,
    so a structural regression can never pass as a similarity score.
    """
    if candidate.keys() != reference.keys():
        raise ValueError(f"Voice state tensors differ: {sorted(candidate.keys() ^ reference.keys())}")
    result = {}
    for name, expected in reference.items():
        actual = candidate[name]
        if actual.shape != expected.shape or actual.dtype != expected.dtype:
            raise ValueError(f"{name}: {actual.dtype}{list(actual.shape)} != {expected.dtype}{list(expected.shape)}")
        if name.endswith("/offset"):
            if not np.array_equal(actual, expected):
                raise ValueError(f"{name}: offset {actual.tolist()} != {expected.tolist()}")
            continue
        a, b = actual.ravel().astype(np.float64), expected.ravel().astype(np.float64)
        cosine = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))
        if not math.isfinite(cosine):
            raise ValueError(f"{name}: cosine is not finite")
        result[name] = cosine
    return result
