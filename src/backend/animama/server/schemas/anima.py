"""Compatibility imports for shared anima contracts; delivery owns no schema copy."""

from animama.app.contracts.anima import (
    EmotionScore as EmotionScore,
    PyAnimaChatProfileResponse as PyAnimaChatProfileResponse,
    PyAnimaChatProfileUpdateRequest as PyAnimaChatProfileUpdateRequest,
    PyAnimaListItem as PyAnimaListItem,
    PyAnimaPresentation as PyAnimaPresentation,
    PyAnimaResponse as PyAnimaResponse,
    PyAnimaUpdate as PyAnimaUpdate,
    PyAnimaUpdateRequest as PyAnimaUpdateRequest,
    PyEmotionalState as PyEmotionalState,
    PyRuntimeImagePresentation as PyRuntimeImagePresentation,
    PyRuntimeImageReference as PyRuntimeImageReference,
    _trim_nonblank_model_provider_id as _trim_nonblank_model_provider_id,
    _trim_nonblank_required_text as _trim_nonblank_required_text,
)
