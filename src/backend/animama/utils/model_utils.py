"""Provider-centric helpers for model/provider configuration.

Deprecated (legacy): The old model adapter registry is replaced by provider
adapters under ``animama.adapters.providers``. This module provides a small
compatibility layer and new helpers focused on provider configs.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

# ---- New provider-centric helpers ----


_PROVIDER_ENV: dict[str, tuple[str, ...]] = {
    # New names
    "openai": ("OPENAI_API_KEY",),
    "gemini": ("GEMINI_API_KEY",),  # OpenAI-compatible Gemini endpoint
    "litellm": (),  # depends on upstream model; leave empty by default
    # Back-compat legacy adapter kinds
    "httpx_openai_chat": ("OPENAI_API_KEY",),
    "sdk_openai_chat": ("OPENAI_API_KEY",),
    "httpx_gemini_generate_content": ("GEMINI_API_KEY",),
    "sdk_gemini_generate_content": ("GEMINI_API_KEY",),
}


def required_environment_keys_for_kind(kind: str) -> tuple[str, ...]:
    """Return environment variables required by a provider or legacy kind.

    Accepts new provider names (e.g., "openai", "gemini", "litellm") and legacy
    adapter kind strings for back-compat.
    """

    return _PROVIDER_ENV.get(kind.strip().lower(), ())


def required_environment_keys_for_model(model: Any) -> tuple[str, ...]:
    """Return environment variables required by a given config/model.

    If ``model`` is a mapping with a ``provider`` key, uses that. Otherwise
    returns an empty tuple.
    """

    if isinstance(model, Mapping):
        prov = str(model.get("provider") or "").lower()
        return required_environment_keys_for_kind(prov)
    return ()


def serialize_provider_config(provider: str, model_name: str, **options: Any) -> dict[str, Any]:
    """Serialize a minimal provider config.

    Returns a dictionary suitable for persistence in node metadata.
    """

    payload: dict[str, Any] = {"provider": provider, "model": model_name}
    if options:
        payload["options"] = options
    return payload


def deserialize_provider_config(metadata: Mapping[str, Any]) -> dict[str, Any] | None:
    """Normalize a provider config mapping.

    Returns a dict with required keys ("provider", "model", optional "options")
    or ``None`` if the mapping does not describe a provider config.
    """

    if not metadata:
        return None
    provider = metadata.get("provider")
    model = metadata.get("model")
    if not provider or not model:
        return None
    options = metadata.get("options") if isinstance(metadata.get("options"), Mapping) else None
    out: dict[str, Any] = {"provider": str(provider), "model": str(model)}
    if options:
        out["options"] = dict(options)
    return out


# ---- Legacy shims (deprecated) ----

MODEL_KIND_OPENAI_CHAT = "openai_chat_completions"  # deprecated
MODEL_KIND_LITELLM = "litellm"  # deprecated


def serialize_agent_model(model: Any) -> dict[str, Any] | None:  # pragma: no cover - legacy shim
    """Deprecated: Only supports mapping-based provider configs now.

    If ``model`` is already a provider config mapping, return a normalized copy;
    otherwise return ``None``.
    """

    if isinstance(model, Mapping):
        return deserialize_provider_config(model)
    return None


def deserialize_agent_model(metadata: Mapping[str, Any]) -> Any | None:  # pragma: no cover - legacy shim
    """Deprecated: Return a normalized provider config mapping when possible."""

    return deserialize_provider_config(metadata)


__all__ = [
    # New helpers
    "serialize_provider_config",
    "deserialize_provider_config",
    "required_environment_keys_for_kind",
    "required_environment_keys_for_model",
    # Legacy constants and shims (deprecated)
    "MODEL_KIND_OPENAI_CHAT",
    "MODEL_KIND_LITELLM",
    "serialize_agent_model",
    "deserialize_agent_model",
]
