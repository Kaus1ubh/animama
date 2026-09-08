from __future__ import annotations

from collections.abc import AsyncIterator

import httpx

from animama.app.ports.voice import TextToSpeechProvider
from animama.domain.audio import SynthesisChunk
from animama.logging import get_logger


class KokoroTTSProvider(TextToSpeechProvider):
    """Text-to-speech provider that streams audio from Kokoro FastAPI (/v1/audio/speech)."""

    def __init__(
        self,
        *,
        base_url: str,
        token: str | None = None,
        response_format: str = "pcm",
        sample_rate: int = 24000,
        model: str = "tts-1",
        voice: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.response_format = response_format
        self.sample_rate = sample_rate
        self.model = model
        self.voice = voice
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None, write=None))
        self._log = get_logger("voice.kokoro")

    async def synthesize(
        self, text: str, *, voice_id: str | None = None, lang: str | None = None, speed: float | None = None
    ) -> AsyncIterator[SynthesisChunk]:
        url = f"{self.base_url}/v1/audio/speech"
        headers = {"Accept": "application/octet-stream"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        payload = {
            "model": self.model,
            "input": text,
            "voice": voice_id or self.voice or "alloy",
            "response_format": self.response_format,
            "stream": True,
        }
        if speed is not None:
            payload["speed"] = speed
        if lang is not None:
            payload["lang_code"] = lang

        self._log.info("Kokoro TTS request", url=url, model=self.model, format=self.response_format)
        async with self._client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            seq = 0
            async for chunk in resp.aiter_bytes():
                if not chunk:
                    continue
                seq += 1
                yield SynthesisChunk(
                    data=chunk,
                    sample_rate=self.sample_rate,
                    channels=1,
                    format=f"audio/{self.response_format}",
                    seq=seq,
                )

    async def synthesize_full(
        self, text: str, *, voice_id: str | None = None, lang: str | None = None, speed: float | None = None
    ) -> SynthesisChunk:
        """Synthesize the full text into a single SynthesisChunk (non-streaming)."""
        url = f"{self.base_url}/v1/audio/speech"
        headers = {"Accept": "application/octet-stream"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        payload = {
            "model": self.model,
            "input": text,
            "voice": voice_id or self.voice or "alloy",
            "response_format": self.response_format,
            "stream": False,
        }
        if speed is not None:
            payload["speed"] = speed
        if lang is not None:
            payload["lang_code"] = lang

        self._log.info(
            "Kokoro TTS full request",
            url=url,
            model=self.model,
            format=self.response_format,
        )
        resp = await self._client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.content
        # Even if Kokoro returns an empty body for some reason, produce
        # a valid SynthesisChunk object with empty data.
        return SynthesisChunk(
            data=data,
            sample_rate=self.sample_rate,
            channels=1,
            format=f"audio/{self.response_format}",
            seq=1,
        )

    async def aclose(self) -> None:
        try:
            await self._client.aclose()
        except Exception:
            pass
