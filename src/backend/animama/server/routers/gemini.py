"""The local composition's Gemini voice samples for the voice picker.

Gemini voice is offered only by the local composition, so this route is local
and needs no shared port.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response

from animama.app.contracts.gemini import DEFAULT_GEMINI_TTS_MODEL_ID, GeminiPrebuiltVoice, GeminiTtsModelId
from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_current_principal
from animama.server.gemini_voice_samples import LocalGeminiVoiceSamples
from animama.server.local_runtime import LocalRuntimePaths
from animama.server.product_ports import local_file_response

router = APIRouter(tags=["gemini"])

_SAMPLE_RESPONSES: dict[int | str, dict[str, object]] = {
    200: {"content": {"audio/wav": {}}, "description": "The voice's sample as a 24 kHz mono WAV."},
    304: {"description": "The kept sample is unchanged."},
    502: {"description": "Gemini could not speak the sample; `detail.message` names at most the HTTP status."},
    503: {"description": "No Gemini API key (`gemini_tts_missing_credential`), or the data root is unavailable."},
}


async def get_gemini_voice_samples(request: Request) -> LocalGeminiVoiceSamples:
    """The app's sample store, created on first use under its derivatives root.

    Async, so it runs on the event loop: concurrent first plays share one store
    and therefore one in-flight request.
    """

    samples = getattr(request.app.state, "gemini_voice_samples", None)
    if isinstance(samples, LocalGeminiVoiceSamples):
        return samples
    # Startup prepares the runtime paths; a request never creates them.
    paths = getattr(request.app.state, "local_runtime_paths", None)
    if not isinstance(paths, LocalRuntimePaths):
        raise HTTPException(status_code=503, detail={"code": "content_unavailable"})
    samples = LocalGeminiVoiceSamples(paths.derivatives_root / "gemini-voice-samples")
    request.app.state.gemini_voice_samples = samples
    return samples


@router.get(
    "/v1/gemini/voices/{voice}/sample",
    response_class=Response,
    responses=_SAMPLE_RESPONSES,
)
async def get_gemini_voice_sample(
    voice: GeminiPrebuiltVoice,
    _user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    samples: Annotated[LocalGeminiVoiceSamples, Depends(get_gemini_voice_samples)],
    model_id: GeminiTtsModelId = DEFAULT_GEMINI_TTS_MODEL_ID,
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """A brief sample of a prebuilt voice; the first play of each model and voice uses the Gemini key."""

    file = await samples.open_sample(_user, voice=voice, model_id=model_id)
    return local_file_response(file, if_none_match=if_none_match, revalidate=True)
