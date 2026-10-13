"""Brief Gemini voice samples for the voice picker, spoken on first play and kept per installation.

Google publishes no sample audio for its prebuilt voices, so the first play of a
voice speaks a short line with the owner's key. The WAV is kept under the data
root's derivatives directory, one file per model and voice, so each is billed
once. One generation runs per file at a time and survives a stopped play. A
kept sample plays without a key.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import io
import os
import stat
import uuid
import wave
from base64 import b64decode
from pathlib import Path

from fastapi import HTTPException, status

from animama.app.contracts.gemini import (
    GEMINI_TTS_MISSING_CREDENTIAL_CODE,
    GEMINI_TTS_MISSING_CREDENTIAL_MESSAGE,
    GeminiPrebuiltVoice,
    GeminiTtsModelId,
)
from animama.app.voice_emotional_tone import gemini_speaking_style
from animama.domain.content_catalog import VerifiedContentFile
from animama.domain.request_principal import RequestPrincipal
from animama.logging_config import get_logger
from animama.server.gemini_tts_service import (
    GEMINI_TTS_SAMPLE_RATE,
    GeminiFinalizedSpeech,
    stream_gemini_finalized_speech,
)
from animama.utils.files import open_no_follow, replace, sync_directory

_log = get_logger("server.gemini_voice_samples")

SAMPLE_TEXT = "Hi there! This is how I sound when we talk."
SAMPLE_STYLE = gemini_speaking_style(emotional_tone=None, emotional_state=None)
"""The friendly style a neutral reply gets, so the sample sounds like chat."""
SAMPLE_VERSION = "1"
"""Bump to replace every kept sample, for example after Google changes a voice."""
MAX_SAMPLE_PCM_BYTES = 10 * GEMINI_TTS_SAMPLE_RATE * 2
"""Ten seconds of 16-bit mono PCM."""
_WAV_HEADER_BYTES = 44

GEMINI_TTS_SAMPLE_FAILED_CODE = "gemini_tts_sample_failed"


def _refusal(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _wav(pcm: bytes) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(GEMINI_TTS_SAMPLE_RATE)
        wav.writeframes(pcm)
    return buffer.getvalue()


def _is_wav(data: bytes) -> bool:
    return len(data) > _WAV_HEADER_BYTES and data[:4] == b"RIFF" and data[8:12] == b"WAVE"


async def _speak(voice: GeminiPrebuiltVoice, model_id: GeminiTtsModelId) -> bytes:
    """Speak the sample line; failures become browser-safe refusals."""

    prepared = GeminiFinalizedSpeech(
        run_id=f"voice-sample-{uuid.uuid4().hex}",
        voice_id=voice,
        model_id=model_id,
        text=SAMPLE_TEXT,
        style=SAMPLE_STYLE,
    )
    pcm = bytearray()
    async with contextlib.aclosing(stream_gemini_finalized_speech(prepared)) as stream:
        async for payload in stream:
            if payload["type"] == "audio":
                pcm.extend(b64decode(payload["audio_base64"]))
                if len(pcm) >= MAX_SAMPLE_PCM_BYTES:
                    break
            elif payload["type"] == "error":
                if payload["code"] == GEMINI_TTS_MISSING_CREDENTIAL_CODE:
                    raise _refusal(
                        status.HTTP_503_SERVICE_UNAVAILABLE,
                        GEMINI_TTS_MISSING_CREDENTIAL_CODE,
                        GEMINI_TTS_MISSING_CREDENTIAL_MESSAGE,
                    )
                # The service's error text names at most the HTTP status.
                raise _refusal(status.HTTP_502_BAD_GATEWAY, GEMINI_TTS_SAMPLE_FAILED_CODE, payload["error"])
    if not pcm:
        raise _refusal(
            status.HTTP_502_BAD_GATEWAY, GEMINI_TTS_SAMPLE_FAILED_CODE, "Gemini text-to-speech returned no audio."
        )
    return _wav(bytes(pcm[:MAX_SAMPLE_PCM_BYTES]))


class LocalGeminiVoiceSamples:
    """Kept Gemini voice samples under ``root``, one WAV per model and voice."""

    def __init__(self, root: Path) -> None:
        self._root = root
        self._speaking: dict[Path, asyncio.Task[bytes]] = {}

    async def open_sample(
        self, principal: RequestPrincipal, *, voice: GeminiPrebuiltVoice, model_id: GeminiTtsModelId
    ) -> VerifiedContentFile:
        """The voice's kept sample, speaking it first if none is kept.

        Raises ``HTTPException`` with ``detail.code`` and a browser-safe
        ``detail.message`` when a new sample cannot be spoken.
        """

        path = self._path(voice, model_id)
        data = await asyncio.to_thread(self._read, path)
        if data is None:
            task = self._speaking.get(path)
            if task is None:
                task = asyncio.create_task(self._speak_and_keep(path, voice, model_id))
                self._speaking[path] = task
                task.add_done_callback(lambda done: self._finished(path, done))
            # A stopped play does not cancel a billed request; the next play finds its file.
            data = await asyncio.shield(task)
        return VerifiedContentFile(
            handle=io.BytesIO(data),
            size_bytes=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
            media_type="audio/wav",
        )

    def _path(self, voice: GeminiPrebuiltVoice, model_id: GeminiTtsModelId) -> Path:
        # Voice and model are validated literals, so they are safe file names.
        digest = hashlib.sha256(f"{SAMPLE_VERSION}\n{SAMPLE_TEXT}\n{SAMPLE_STYLE}".encode()).hexdigest()[:12]
        return self._root / model_id / f"{voice}.{digest}.wav"

    def _finished(self, path: Path, task: asyncio.Task[bytes]) -> None:
        if self._speaking.get(path) is task:
            del self._speaking[path]
        if not task.cancelled():
            # Every waiter may have stopped; read the outcome so it is never reported as lost.
            task.exception()

    async def _speak_and_keep(self, path: Path, voice: GeminiPrebuiltVoice, model_id: GeminiTtsModelId) -> bytes:
        # Another play may have kept the file since this one looked.
        kept = await asyncio.to_thread(self._read, path)
        if kept is not None:
            return kept
        data = await _speak(voice, model_id)
        try:
            await asyncio.to_thread(self._keep, path, data)
        except OSError as exc:
            # The audio is already paid for, so play it even if it cannot be kept.
            _log.warning("Gemini voice sample could not be kept", voice=voice, model_id=model_id, error=str(exc))
        return data

    @staticmethod
    def _read(path: Path) -> bytes | None:
        """A kept, intact sample, or ``None``; a damaged file is removed."""

        try:
            info = path.lstat()
        except FileNotFoundError:
            return None
        max_bytes = _WAV_HEADER_BYTES + MAX_SAMPLE_PCM_BYTES
        if stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= max_bytes:
            with os.fdopen(open_no_follow(path, os.O_RDONLY), "rb") as file:
                data = file.read(max_bytes + 1)
            if _is_wav(data):
                return data
        path.unlink(missing_ok=True)
        return None

    @staticmethod
    def _keep(path: Path, data: bytes) -> None:
        """Write ``data`` atomically, then remove samples of the same voice from older lines."""

        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as file:
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            replace(temporary, path)
            sync_directory(path.parent)
        finally:
            temporary.unlink(missing_ok=True)
        voice = path.name.split(".", 1)[0]
        for older in path.parent.glob(f"{voice}.*.wav"):
            if older != path:
                older.unlink(missing_ok=True)


__all__ = [
    "GEMINI_TTS_SAMPLE_FAILED_CODE",
    "MAX_SAMPLE_PCM_BYTES",
    "SAMPLE_STYLE",
    "SAMPLE_TEXT",
    "SAMPLE_VERSION",
    "LocalGeminiVoiceSamples",
]
