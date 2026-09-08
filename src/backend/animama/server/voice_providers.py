from __future__ import annotations

import asyncio
import os

from animama.app.ports.voice import SpeechToTextProvider, TextToSpeechProvider
from animama.logging_config import get_logger

try:
    from animama.adapters.voice.echo import EchoSpeechToTextProvider, EchoTextToSpeechProvider
except Exception:  # pragma: no cover - defensive
    EchoSpeechToTextProvider = None  # type: ignore
    EchoTextToSpeechProvider = None  # type: ignore

try:
    from animama.adapters.voice.parakeet_http import ParakeetSTTProvider
except Exception:  # pragma: no cover - defensive
    ParakeetSTTProvider = None  # type: ignore

try:
    from animama.adapters.voice.kokoro_http import KokoroTTSProvider
except Exception:  # pragma: no cover - defensive
    KokoroTTSProvider = None  # type: ignore

_stt: SpeechToTextProvider | None = None
_tts: TextToSpeechProvider | None = None
_lock: asyncio.Lock | None = None
_log = get_logger("server.voice")


def create_stt_provider() -> SpeechToTextProvider:
    """Create a fresh STT provider instance (no caching)."""

    mode = os.getenv("ANIMAMA_STT_MODE", os.getenv("ANIMAMA_VOICE_MODE", "stub")).lower()
    sample_rate = int(os.getenv("ANIMAMA_VOICE_SAMPLE_RATE", "16000"))
    channels = int(os.getenv("ANIMAMA_VOICE_CHANNELS", "1"))

    if mode == "parakeet" and ParakeetSTTProvider is not None:
        base_url = os.getenv("ANIMAMA_STT_URL", "http://parakeet:9001")
        token = os.getenv("ANIMAMA_STT_AUTH_TOKEN") or None
        skip_vad = os.getenv("ANIMAMA_STT_SKIP_VAD", "false").lower() in ("true", "1", "yes")
        try:
            _log.info(
                "Initializing Parakeet STT provider",
                base_url=base_url,
                skip_vad=skip_vad,
            )
            return ParakeetSTTProvider(base_url=base_url, token=token, skip_vad=skip_vad)
        except Exception as exc:
            _log.error("Failed to init Parakeet STT, falling back to stub", exc=exc)

    _log.info("Initializing stub voice STT provider", sample_rate=sample_rate, channels=channels)
    stt = EchoSpeechToTextProvider(sample_rate=sample_rate, channels=channels) if EchoSpeechToTextProvider else None
    if stt is None:
        raise RuntimeError("Failed to initialize STT provider")
    return stt


async def ensure_voice_providers() -> tuple[SpeechToTextProvider, TextToSpeechProvider]:
    """Initialize and cache STT/TTS providers eagerly."""

    global _stt, _tts, _lock
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        if _stt is not None and _tts is not None:
            return _stt, _tts

        mode = os.getenv("ANIMAMA_STT_MODE", os.getenv("ANIMAMA_VOICE_MODE", "stub")).lower()
        sample_rate = int(os.getenv("ANIMAMA_VOICE_SAMPLE_RATE", "16000"))
        channels = int(os.getenv("ANIMAMA_VOICE_CHANNELS", "1"))

        if mode == "parakeet" and ParakeetSTTProvider is not None:
            base_url = os.getenv("ANIMAMA_STT_URL", "http://parakeet:9001")
            token = os.getenv("ANIMAMA_STT_AUTH_TOKEN") or None
            # Skip server-side VAD when client-side VAD is enabled
            skip_vad = os.getenv("ANIMAMA_STT_SKIP_VAD", "false").lower() in ("true", "1", "yes")
            try:
                _log.info(
                    "Initializing Parakeet STT provider",
                    base_url=base_url,
                    skip_vad=skip_vad,
                )
                _stt = ParakeetSTTProvider(base_url=base_url, token=token, skip_vad=skip_vad)
            except Exception as exc:
                _log.error("Failed to init Parakeet STT, falling back to stub", exc=exc)
                _stt = None
        if _stt is None:
            _log.info("Initializing stub voice STT provider", sample_rate=sample_rate, channels=channels)
            _stt = (
                EchoSpeechToTextProvider(sample_rate=sample_rate, channels=channels)
                if EchoSpeechToTextProvider
                else None
            )

        tts_mode = os.getenv("ANIMAMA_TTS_MODE", "stub").lower()
        if tts_mode == "kokoro" and KokoroTTSProvider is not None:
            tts_url = os.getenv("ANIMAMA_TTS_URL", "http://kokoro:9002")
            tts_token = os.getenv("ANIMAMA_TTS_AUTH_TOKEN") or None
            tts_fmt = os.getenv("ANIMAMA_TTS_FORMAT", "pcm")
            tts_sr = int(os.getenv("ANIMAMA_TTS_SAMPLE_RATE", "24000"))
            try:
                _log.info("Initializing Kokoro TTS provider", base_url=tts_url, format=tts_fmt, sample_rate=tts_sr)
                _tts = KokoroTTSProvider(base_url=tts_url, token=tts_token, response_format=tts_fmt, sample_rate=tts_sr)
            except Exception as exc:
                _log.error("Failed to init Kokoro TTS, falling back to stub", exc=exc)
                _tts = None
        if _tts is None:
            _tts = (
                EchoTextToSpeechProvider(sample_rate=sample_rate, channels=channels)
                if EchoTextToSpeechProvider
                else None
            )

        if _stt is None or _tts is None:
            raise RuntimeError("Failed to initialize voice providers")
        return _stt, _tts


def get_voice_providers() -> tuple[SpeechToTextProvider, TextToSpeechProvider]:
    if _stt is None or _tts is None:
        raise RuntimeError("Voice providers not initialized; call ensure_voice_providers() first")
    return _stt, _tts
