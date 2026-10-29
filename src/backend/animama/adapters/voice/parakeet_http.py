"""Optional server-side Parakeet WebSocket adapter.

The local voice-provider registry can construct this adapter when voice is
enabled. Browser and desktop speech recognition use client-side ONNX inference;
the local API does not expose an STT or LiveKit session route.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from animama.app.ports.voice import SpeechToTextProvider
from animama.domain.audio import AudioChunk, TranscriptSegment
from animama.logging import get_logger


class ParakeetSTTProvider(SpeechToTextProvider):
    """Streaming STT provider for the Parakeet FastAPI WS (/ws).

    Args:
        base_url: Base URL of the Parakeet service (e.g., "http://localhost:8001")
        token: Optional authentication token
        skip_vad: If True, bypass server-side VAD. Use when client-side VAD is enabled.
    """

    def __init__(self, *, base_url: str, token: str | None = None, skip_vad: bool = False) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.skip_vad = skip_vad
        self._ws: Any = None
        self._lock = asyncio.Lock()
        self._log = get_logger("voice.parakeet")
        self._closed = False

    async def _ensure_ws(self):
        import websockets

        # Check if existing connection is still open
        if self._ws is not None:
            try:
                if self._ws.state == websockets.protocol.State.OPEN:
                    return self._ws
            except Exception:
                pass
            # Connection is closed or invalid, clear it
            self._ws = None

        url = self.base_url
        if not url.startswith("ws"):
            url = url.replace("http://", "ws://").replace("https://", "wss://")
        if not url.endswith("/ws"):
            url = url + "/ws"
        # Logged without the query string, which carries the service token.
        endpoint = url

        # Add query parameters
        params = []
        if self.skip_vad:
            params.append("skip_vad=true")
        if self.token:
            params.append(f"token={self.token}")
        if params:
            url = f"{url}?{'&'.join(params)}"

        self._log.info("Connecting to Parakeet WS", url=endpoint, skip_vad=self.skip_vad)
        self._ws = await websockets.connect(url, max_size=2**24, write_limit=2**20)
        self._log.info("Connected to Parakeet WS", url=endpoint, skip_vad=self.skip_vad)
        return self._ws

    async def stream(self, chunks):
        """Send PCM chunks, yield TranscriptSegment (final-only).

        Uses concurrent send/receive so transcripts are yielded as they arrive,
        not after the audio stream ends.
        """

        ws = await self._ensure_ws()
        seg_q: asyncio.Queue[TranscriptSegment | None] = asyncio.Queue()
        send_done = asyncio.Event()

        async def _recv_loop():
            seq = 0
            try:
                async for msg in ws:
                    try:
                        payload = json.loads(msg)
                    except Exception as e:
                        self._log.warning(f"Failed to parse JSON: {e}")
                        continue
                    text = payload.get("text")
                    if text is None:
                        continue
                    seq += 1
                    self._log.info("Transcript received", seq=seq, chars=len(str(text)))
                    await seg_q.put(TranscriptSegment(text=str(text), is_final=True, seq=seq))
            except Exception as exc:
                self._log.warning("Parakeet recv failed", exc=exc)
            finally:
                await seg_q.put(None)

        async def _send_loop():
            chunk_count = 0
            try:
                async for ch in chunks:
                    if ch is None:
                        break
                    if not isinstance(ch, AudioChunk):
                        continue
                    try:
                        await ws.send(ch.data)
                        chunk_count += 1
                        if chunk_count == 1:
                            self._log.info("Started sending audio to Parakeet")
                    except Exception as exc:
                        self._log.warning("Parakeet send failed", exc=exc, chunk_num=chunk_count)
                        break
            finally:
                send_done.set()
                self._log.info(f"Audio send complete, {chunk_count} chunks sent")

        recv_task = asyncio.create_task(_recv_loop())
        send_task = asyncio.create_task(_send_loop())

        try:
            # Yield segments as they arrive (don't wait for send to complete)
            while True:
                seg = await seg_q.get()
                if seg is None:
                    break
                yield seg
        finally:
            # Clean up: cancel send if still running, close WS
            if not send_task.done():
                send_task.cancel()
            try:
                await ws.close()
            except Exception:
                pass
            self._ws = None  # Clear reference so next stream() creates fresh connection
            # Wait for tasks to finish
            try:
                await send_task
            except asyncio.CancelledError:
                pass
            try:
                await recv_task
            except asyncio.CancelledError:
                pass

    async def aclose(self) -> None:
        self._closed = True
        try:
            if self._ws:
                await self._ws.close()
        except Exception:
            pass
        self._ws = None
