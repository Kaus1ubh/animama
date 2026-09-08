from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_current_principal
from animama.server.elevenlabs_service import (
    clone_voice,
    generate_sound_effect,
    isolate_audio,
    read_audio_upload,
    synthesize_text,
)
from animama.server.schemas.elevenlabs import (
    PyElevenLabsAudioResponse,
    PyElevenLabsSoundEffectsRequest,
    PyElevenLabsTextToSpeechRequest,
    PyElevenLabsVoice,
)

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
    description: Annotated[str | None, Form()] = None,
    remove_background_noise: Annotated[bool, Form()] = False,
) -> PyElevenLabsVoice:
    prepared_files = [await read_audio_upload(upload) for upload in files]
    return await clone_voice(
        user_id=user.id,
        name=name.strip(),
        files=prepared_files,
        description=description.strip() if isinstance(description, str) and description.strip() else None,
        remove_background_noise=remove_background_noise,
    )


@router.post(
    "/v1/elevenlabs/text-to-speech",
    response_model=PyElevenLabsAudioResponse,
    status_code=status.HTTP_200_OK,
)
async def text_to_speech_endpoint(
    req: PyElevenLabsTextToSpeechRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyElevenLabsAudioResponse:
    return await synthesize_text(user_id=user.id, request=req)


@router.post(
    "/v1/elevenlabs/sound-effects",
    response_model=PyElevenLabsAudioResponse,
    status_code=status.HTTP_200_OK,
)
async def sound_effects_endpoint(
    req: PyElevenLabsSoundEffectsRequest,
    _user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyElevenLabsAudioResponse:
    return await generate_sound_effect(req)


@router.post(
    "/v1/elevenlabs/audio-isolation",
    response_model=PyElevenLabsAudioResponse,
    status_code=status.HTTP_200_OK,
)
async def audio_isolation_endpoint(
    audio: Annotated[UploadFile, File(...)],
    _user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    file_format: Annotated[str | None, Form()] = None,
) -> PyElevenLabsAudioResponse:
    filename, audio_bytes, _content_type = await read_audio_upload(audio)
    return await isolate_audio(
        filename=filename,
        audio_bytes=audio_bytes,
        file_format=file_format,
    )
