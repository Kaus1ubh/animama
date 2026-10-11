"""The local composition's direct chat streaming route.

The shared Anima list, read, edit and delete routes live in
``animama.product_http.routes.animas`` and the voice-catalog uploads in
``animama.product_http.routes.voice_catalogs``.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_current_principal
from animama.server.gruut_text import build_gruut_sse_text
from animama.server.model_clients import get_model_client_registry
from animama.server.routers.chat.chat_sse import stream_direct_chat_sse

from ..schemas import PyAnimaChatRequest

router = APIRouter()


def _build_gruut_sse_text(
    text: str,
    *,
    lang: str = "en_US",
    tokenized_text_source: Literal["input", "text_with_ws"] = "input",
) -> dict[str, str | list[list[str]]] | None:
    """Expand/tokenize and phonemize text for SSE completion payloads."""

    return build_gruut_sse_text(
        text,
        lang=lang,
        tokenized_text_source=tokenized_text_source,
    )


async def _chat_anima_direct_sse(
    anima_id: str,
    req: PyAnimaChatRequest,
    user: RequestPrincipal,
    request: Request,
) -> StreamingResponse:
    return await stream_direct_chat_sse(
        app=request.app,
        anima_id=anima_id,
        req=req,
        user=user,
        model_client_registry=get_model_client_registry(request.app),
        build_gruut_sse_text=_build_gruut_sse_text,
    )


@router.post("/v1/animas/{anima_id}/chat:sse")
async def chat_anima_direct_sse(
    anima_id: str,
    req: PyAnimaChatRequest,
    request: Request,
    user: RequestPrincipal = Depends(get_current_principal),
) -> StreamingResponse:
    """Run a direct avatar companion chat turn over SSE."""
    return await _chat_anima_direct_sse(anima_id, req, user, request)
