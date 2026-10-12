"""The local composition's ElevenLabs audio isolation route.

Voice cloning, text-to-speech and sound effects are shared and live in
``animama.product_http.routes.elevenlabs``. Audio isolation has no web caller and
stays local (owner, 2026-10-10).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from animama.domain.request_principal import RequestPrincipal
from animama.product_http.uploads import read_audio_upload
from animama.server.config import settings
from animama.server.deps import get_current_principal
from animama.server.elevenlabs_service import isolate_audio
from animama.server.schemas.elevenlabs import PyElevenLabsAudioResponse

router = APIRouter(tags=["elevenlabs"])


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
    filename, audio_bytes, _content_type = await read_audio_upload(
        audio, max_bytes=settings.elevenlabs_audio_max_upload_bytes
    )
    return await isolate_audio(
        filename=filename,
        audio_bytes=audio_bytes,
        file_format=file_format,
    )
