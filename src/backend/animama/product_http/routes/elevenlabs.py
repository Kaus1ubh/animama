"""ElevenLabs voice cloning, text-to-speech and sound effects, shared by every composition (ADR 0021).

The composition's speech port makes the provider calls with its own credentials,
retries and limits; these routes read the uploads and keep the public shapes.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from animama.app.contracts.elevenlabs import (
    PyElevenLabsAudioResponse,
    PyElevenLabsSoundEffectsRequest,
    PyElevenLabsTextToSpeechRequest,
    PyElevenLabsVoice,
)
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import Ports, ProductRefusal, refusal_error
from animama.product_http.principal import get_current_principal
from animama.product_http.uploads import read_audio_upload

router = APIRouter(tags=["elevenlabs"])


@router.post(
    "/v1/elevenlabs/voices/clone",
    response_model=PyElevenLabsVoice,
    status_code=status.HTTP_201_CREATED,
)
async def clone_voice_endpoint(
    name: Annotated[str, Form(...)],
    files: Annotated[list[UploadFile], File(...)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    ports: Ports,
    description: Annotated[str | None, Form()] = None,
    remove_background_noise: Annotated[bool, Form()] = False,
) -> PyElevenLabsVoice:
    speech = ports.speech
    prepared_files = [await read_audio_upload(upload, max_bytes=speech.audio_upload_max_bytes) for upload in files]
    try:
        return await speech.clone_voice(
            user,
            name=name.strip(),
            files=prepared_files,
            description=description.strip() if isinstance(description, str) and description.strip() else None,
            remove_background_noise=remove_background_noise,
        )
    except ProductRefusal as exc:
        raise refusal_error(exc) from exc


@router.post(
    "/v1/elevenlabs/text-to-speech",
    response_model=PyElevenLabsAudioResponse,
    status_code=status.HTTP_200_OK,
)
async def text_to_speech_endpoint(
    req: PyElevenLabsTextToSpeechRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    ports: Ports,
) -> PyElevenLabsAudioResponse:
    try:
        return await ports.speech.synthesize_text(user, req)
    except ProductRefusal as exc:
        raise refusal_error(exc) from exc


@router.post(
    "/v1/elevenlabs/sound-effects",
    response_model=PyElevenLabsAudioResponse,
    status_code=status.HTTP_200_OK,
)
async def sound_effects_endpoint(
    req: PyElevenLabsSoundEffectsRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    ports: Ports,
) -> PyElevenLabsAudioResponse:
    try:
        return await ports.speech.generate_sound_effect(user, req)
    except ProductRefusal as exc:
        raise refusal_error(exc) from exc


__all__ = ["router"]
