"""Hand an ElevenLabs reply's speech to a composition that speaks it through its own socket."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from animama.app.contracts.elevenlabs import PyElevenLabsRealtimeTtsSessionResponse
from animama.domain.audio_tags import ProviderSpeechText
from animama.logging import get_logger
from animama.product_http.ports import ServerSpeechText

_log = get_logger("product_http.chat.server_speech")


@dataclass(slots=True)
class ServerSpeechFeed:
    """One reply's speech for ``ChatTurnServices.server_speech_text``.

    Each speakable segment (already without emoji) is prepared for ElevenLabs with
    one ``ProviderSpeechText`` per reply, so its sound cap counts across the reply,
    as the browser prepares its chunks. The reply's tone tag leads the first piece
    that has text.

    The sink receives text only once the turn's realtime session is known to be a
    server-transport session (``session_ready``). Until then pieces wait here; a
    direct or declined session discards them and the sink hears nothing. ``end``
    and ``abort`` reach the sink at most once each, nothing is appended after
    either, and a sink that raises is logged, so the turn's cleanup still runs.
    """

    sink: ServerSpeechText
    speech_text: ProviderSpeechText = field(default_factory=lambda: ProviderSpeechText("elevenlabs"))
    tone_tag: str | None = None
    """The reply's tone tag, still waiting for the first piece with text."""
    session: Literal["pending", "server", "none"] = "pending"
    waiting: list[str] = field(default_factory=list)
    ended: bool = False
    aborted: bool = False

    def add(self, text: str) -> None:
        if self.ended or self.aborted or self.session == "none":
            return
        prepared = self.speech_text.prepare(text)
        if not prepared:
            return
        if self.tone_tag:
            prepared = f"{self.tone_tag} {prepared}"
            self.tone_tag = None
        if self.session == "server":
            self._call("append", prepared)
        else:
            self.waiting.append(prepared)

    def session_ready(self, session: PyElevenLabsRealtimeTtsSessionResponse | None) -> None:
        """The turn's realtime session resolved; ``None`` when it was declined or failed."""

        if self.session != "pending":
            return
        if session is None or session.transport != "server":
            self.session, self.waiting = "none", []
            return
        self.session = "server"
        waiting, self.waiting = self.waiting, []
        if self.aborted:
            return
        for prepared in waiting:
            self._call("append", prepared)
        if self.ended:
            self._call("end")

    def end(self) -> None:
        if self.ended or self.aborted:
            return
        self.ended = True
        if self.session == "server":
            self._call("end")

    def abort(self) -> None:
        if self.aborted:
            return
        self.aborted = True
        self.waiting = []
        # A pending session may already be a server session the composition opened.
        if self.session != "none":
            self._call("abort")

    def _call(self, name: Literal["append", "end", "abort"], *args: str) -> None:
        try:
            getattr(self.sink, name)(*args)
        except Exception as exc:
            _log.warning("Server speech sink failed", method=name, exc_type=exc.__class__.__name__)


__all__ = ["ServerSpeechFeed"]
