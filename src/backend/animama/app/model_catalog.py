"""Built-in provider + model catalog used by direct model clients.

Stores per-provider model information (modalities, streaming, tools and
pricing) for the release-managed rows of the built-in OpenAI connection, and
exposes serializers for durable catalog seeding. Other providers are reached
through owner-configured model connections, not built-in rows.

Notes
- This module avoids importing server-side Pydantic schemas to keep
  dependencies light and import-safe in docs/tests.
- Modalities are represented using the domain ``Modality`` enum.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from animama.app.model_clients.credentials import builtin_openai_connection
from animama.app.model_provider_native_tools import requestable_native_tool_support
from animama.domain.model_connection import (
    BUILTIN_OPENAI_CONNECTION_ID,
    MODEL_KIND_CHAT,
    MODEL_KIND_EMBEDDING,
    MODEL_SOURCE_BUILTIN,
)
from animama.domain.types import Modality
from animama.utils.type_helpers import coerce_modalities, coerce_provider_type

# ---------------------------- Helpers -------------------------------------


def _norm_provider_type(s: str) -> str:
    # Delegate to global coercer for consistency across layers
    out = coerce_provider_type(s)
    return out if isinstance(out, str) else (s or "")


# ---------------------------- Catalog -------------------------------------


def _s(*xs: str) -> set[Modality]:
    return coerce_modalities(xs)


MAIN_STRUCTURED_RESPONSE_KIND = "main_structured_response"
MAIN_STRUCTURED_RESPONSE_KINDS = frozenset({MAIN_STRUCTURED_RESPONSE_KIND})
STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA = "json_schema"
STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT = "json_object"

REASONING_EFFORT_ORDER = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
PRICE_TIERS = ("standard", "batch", "flex", "priority")
GPT_6_PRICING_SOURCE_CHECKED_AT = "2026-09-28"

OPENAI_GPT_6_LUNA_PRICING: dict[str, Any] = {
    "status": "priced",
    "source_provider": "openai",
    "source_model": "gpt-6-luna",
    # Standard rates were supplied by the owner; no published pricing page is recorded.
    "source_url": None,
    "source_checked_at": GPT_6_PRICING_SOURCE_CHECKED_AT,
    "currency": "USD",
    "billing_unit": "1M_tokens",
    # The cached-input rate is 10% of input (secondary sources, 2026-09-28;
    # owner gate G4 confirms it). No prompt-cache write rate is stored, so
    # turns that report cache writes stay unpriced.
    "standard": {"input": "0.10", "cached_input": "0.01", "output": "0.50"},
    # Batch, flex, priority and long-context rates are unknown; those tiers are
    # not listed as priced, so estimates for them stay unpriced.
    "batch": None,
    "flex": None,
    "priority": None,
    "pricing_notes": [
        "Standard input and output rates were supplied by the owner on 2026-09-28.",
        "The cached-input rate ($0.01 per 1M tokens) comes from secondary sources and awaits owner confirmation.",
        "Prompt-cache write, batch, flex, priority and long-context rates are not recorded and are not estimated.",
    ],
}


def _reasoning_efforts(values: Any) -> list[str]:
    raw_values = {str(value).strip() for value in (values or ()) if str(value).strip()}
    return [effort for effort in REASONING_EFFORT_ORDER if effort in raw_values]


def _native_tool_support(values: Any) -> list[str]:
    return sorted({str(value).strip() for value in (values or ()) if str(value).strip()})


def _capabilities_for_provider(cap_entry: dict[str, Any], provider_attrs: dict[str, Any]) -> dict[str, Any]:
    """Merge model capabilities with provider-specific overrides."""

    capabilities = dict(cap_entry)
    provider_capabilities = provider_attrs.get("capabilities")
    if isinstance(provider_capabilities, dict):
        capabilities.update(provider_capabilities)
    for key in (
        "accepts",
        "produces",
        "supports_tools",
        "supports_streaming",
        "structured_kinds",
        "structured_output_transport",
        "supports_developer_role",
        "supports_reasoning",
        "supported_reasoning_efforts",
        "native_tool_support",
    ):
        if key in provider_attrs:
            capabilities[key] = provider_attrs[key]
    return capabilities


def _chat_api_standard_fields(provider_type: str) -> dict[str, str | None]:
    from animama.app.chat.api_standard import chat_api_standard_for_provider_type

    profile = chat_api_standard_for_provider_type(provider_type)
    return {
        "model_client": profile.model_client if profile is not None else None,
        "api_standard": profile.api_standard if profile is not None else None,
    }


def _unpriced_pricing(source_provider: str) -> dict[str, Any]:
    return {
        "status": "unpriced",
        "source_provider": source_provider,
        "source_model": None,
        "source_url": None,
        "source_checked_at": None,
        "currency": None,
        "billing_unit": None,
        "standard": None,
        "batch": None,
        "flex": None,
        "priority": None,
    }


def _structured_output_transport_for_capabilities(capabilities: dict[str, Any]) -> str | None:
    raw = capabilities.get("structured_output_transport")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    if capabilities.get("structured_kinds"):
        return STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
    return None


def structured_output_transport(provider_type: str, model: str) -> str | None:
    """Return the configured structured-output transport for a provider/model pair."""

    if not provider_type or not model:
        return None
    provider = _norm_provider_type(provider_type)
    entry = MODEL_CATALOG.get(model)
    if not entry:
        return None
    providers = entry.get("providers") or {}
    raw_provider_attrs = providers.get(provider)
    if raw_provider_attrs is None:
        return None
    provider_attrs = raw_provider_attrs if isinstance(raw_provider_attrs, dict) else {}
    capabilities = _capabilities_for_provider(entry.get("capabilities") or {}, provider_attrs)
    return _structured_output_transport_for_capabilities(capabilities)


"""Built-in entries (conservative; can be extended later).

Structure:
{
  <model>: {
    "capabilities": {
      "accepts": set[Modality],
      "produces": set[Modality],
      "supports_tools": bool,
      "supports_streaming": bool,
      "structured_kinds": set[str],
      "structured_output_transport": str,          # optional, json_schema/json_object
      "supports_reasoning": bool,                 # optional
      "supported_reasoning_efforts": set[str],    # optional
      "native_tool_support": set[str],            # optional
    },
    "providers": {
      <provider_type>: {
        "supports_developer_role": bool,        # optional, default true
        "native_tool_support": set[str],        # optional
      },
      ...
    }
  }
}
"""

MODEL_CATALOG: dict[str, dict[str, Any]] = {
    # OpenAI chat models. Knowledge cutoff 2026-05-18.
    "gpt-6-luna": {
        "model_metadata": {
            "model_type": "reasoning",
            "current_snapshot": "gpt-6-luna",
            "context_window_tokens": 1_050_000,
            "max_output_tokens": 128_000,
        },
        "capabilities": {
            "accepts": _s("text", "image"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
            "supports_reasoning": True,
            "supported_reasoning_efforts": {"none", "low", "medium", "high", "xhigh", "max"},
        },
        "providers": {
            "OpenAIHTTPAgent": {},
            "OpenAIResponsesHTTPAgent": {
                "native_tool_support": {"web_search", "apply_patch"},
            },
        },
        "pricing": OPENAI_GPT_6_LUNA_PRICING,
    },
    # OpenAI embedding models, used only by the embeddings role.
    "text-embedding-3-small": {
        "model_kind": MODEL_KIND_EMBEDDING,
        "capabilities": {"accepts": _s("text"), "produces": _s("embedding")},
        "providers": {"OpenAIHTTPAgent": {}},
    },
    "text-embedding-3-large": {
        "model_kind": MODEL_KIND_EMBEDDING,
        "capabilities": {"accepts": _s("text"), "produces": _s("embedding")},
        "providers": {"OpenAIHTTPAgent": {}},
    },
}


RETIRED_BUILTIN_REPLACEMENTS: dict[str, str] = {
    "OpenAIResponsesHTTPAgent:gpt-5.6-luna": "OpenAIResponsesHTTPAgent:gpt-6-luna",
    "OpenAIResponsesHTTPAgent:gpt-5.6-terra": "OpenAIResponsesHTTPAgent:gpt-6-luna",
    "OpenAIResponsesHTTPAgent:gpt-5-nano": "OpenAIResponsesHTTPAgent:gpt-6-luna",
    "OpenAIResponsesHTTPAgent:gpt-5.4-nano": "OpenAIResponsesHTTPAgent:gpt-6-luna",
    "OpenAIHTTPAgent:gpt-5-nano": "OpenAIHTTPAgent:gpt-6-luna",
    "OpenAIHTTPAgent:gpt-5.4-nano": "OpenAIHTTPAgent:gpt-6-luna",
}
"""Retired built-in chat rows and the current built-in row on the same API.

The catalog seed moves Anima chat profiles and the owner's chat-model role
preferences from a retired row to its replacement, so existing installations
keep chatting after an upgrade. Retired rows stay in the database for history.
"""


# ---------------------------- API -----------------------------------------


PROVIDER_LABELS: dict[str, str] = {
    "OpenAIHTTPAgent": "OpenAI HTTP",
    "OpenAIResponsesHTTPAgent": "OpenAI Responses HTTP",
}

PROVIDER_LOGOS: dict[str, str] = {
    "OpenAIHTTPAgent": "openai",
    "OpenAIResponsesHTTPAgent": "openai",
}


def _modality_values(values: Any) -> list[str]:
    modalities = coerce_modalities(values or ())
    return sorted(getattr(modality, "value", str(modality)) for modality in modalities)


def _string_values(values: Any) -> list[str]:
    return sorted({str(value).strip() for value in (values or ()) if str(value).strip()})


def _model_label(model: str) -> str:
    return model


def _provider_label(provider_type: str, provider_attrs: dict[str, Any]) -> str:
    raw_label = provider_attrs.get("provider_label")
    if isinstance(raw_label, str) and raw_label.strip():
        return raw_label.strip()
    return PROVIDER_LABELS.get(provider_type, provider_type)


def _logo_provider(provider_type: str, provider_attrs: dict[str, Any] | None = None) -> str | None:
    if isinstance(provider_attrs, dict):
        raw_logo = provider_attrs.get("logo_provider")
        if isinstance(raw_logo, str) and raw_logo.strip():
            return raw_logo.strip()
    return PROVIDER_LOGOS.get(provider_type)


def _decimal_or_none(value: Any) -> Decimal | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw or raw == "-":
        return None
    return Decimal(raw)


def _date_or_none(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    raw = str(value).strip()
    return date.fromisoformat(raw) if raw else None


def _pricing_tier_fields(pricing: dict[str, Any], tier: str) -> dict[str, Decimal | None]:
    tier_values = pricing.get(tier)
    if not isinstance(tier_values, dict):
        tier_values = {}
    return {
        f"{tier}_input_price_per_million": _decimal_or_none(tier_values.get("input")),
        f"{tier}_cached_input_price_per_million": _decimal_or_none(tier_values.get("cached_input")),
        f"{tier}_output_price_per_million": _decimal_or_none(tier_values.get("output")),
    }


def _long_context_pricing_fields(pricing: dict[str, Any]) -> dict[str, Decimal | int | None]:
    long_context = pricing.get("long_context")
    if not isinstance(long_context, dict):
        long_context = {}

    fields: dict[str, Decimal | int | None] = {
        "long_context_token_threshold": long_context.get("token_threshold"),
    }
    for tier in PRICE_TIERS:
        tier_values = long_context.get(tier)
        if not isinstance(tier_values, dict):
            tier_values = {}
        fields.update(
            {
                f"{tier}_long_context_input_price_per_million": _decimal_or_none(tier_values.get("input")),
                f"{tier}_long_context_cached_input_price_per_million": _decimal_or_none(
                    tier_values.get("cached_input")
                ),
                f"{tier}_long_context_output_price_per_million": _decimal_or_none(tier_values.get("output")),
            }
        )
    return fields


def _service_tiers_supported(pricing: dict[str, Any]) -> list[str]:
    configured = pricing.get("service_tiers_supported")
    if configured is not None:
        return _string_values(configured)
    return [tier for tier in PRICE_TIERS if isinstance(pricing.get(tier), dict)]


def _serialize_pricing(pricing: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "pricing_status": str(pricing.get("status") or "unpriced"),
        "pricing_source_provider": pricing.get("source_provider"),
        "pricing_source_model": pricing.get("source_model"),
        "pricing_source_url": pricing.get("source_url"),
        "pricing_source_checked_at": _date_or_none(pricing.get("source_checked_at")),
        "currency": pricing.get("currency"),
        "billing_unit": pricing.get("billing_unit"),
        "regional_processing_uplift_factor": _decimal_or_none(pricing.get("regional_processing_uplift_factor")),
        "pricing_notes": _string_values(pricing.get("pricing_notes")),
    }
    for tier in PRICE_TIERS:
        fields.update(_pricing_tier_fields(pricing, tier))
    fields.update(_long_context_pricing_fields(pricing))
    return fields


def _metadata_for_provider(entry: dict[str, Any], provider_attrs: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(entry.get("metadata") or {})
    provider_metadata = provider_attrs.get("metadata")
    if isinstance(provider_metadata, dict):
        metadata.update(provider_metadata)
    return metadata


def serialize_model_catalog() -> list[dict[str, Any]]:
    """Return the public `/v1/model-providers` rows the built-in catalog seeds.

    The API serves rows from the database; this projection lets tests check
    that seeded rows keep the public shape. Credentials, base URLs and pricing
    are omitted.
    """

    rows: list[dict[str, Any]] = []
    for model, entry in MODEL_CATALOG.items():
        cap_entry = entry.get("capabilities") or {}
        providers = entry.get("providers") or {}
        for raw_provider, raw_provider_attrs in providers.items():
            provider_type = _norm_provider_type(str(raw_provider))
            provider_attrs = raw_provider_attrs if isinstance(raw_provider_attrs, dict) else {}
            capabilities = _capabilities_for_provider(cap_entry, provider_attrs)
            row = {
                "id": f"{provider_type}:{model}",
                "model": model,
                "model_provider": provider_type,
                "model_label": _model_label(model),
                "provider_label": _provider_label(provider_type, provider_attrs),
                "logo_provider": _logo_provider(provider_type, provider_attrs),
                **_chat_api_standard_fields(provider_type),
                "source": MODEL_SOURCE_BUILTIN,
                "connection_id": BUILTIN_OPENAI_CONNECTION_ID,
                "connection_name": "OpenAI",
                "model_kind": entry.get("model_kind", MODEL_KIND_CHAT),
                "hidden": False,
                "context_window_tokens": (entry.get("model_metadata") or {}).get("context_window_tokens"),
                "accepts": _modality_values(capabilities.get("accepts")),
                "produces": _modality_values(capabilities.get("produces")),
                "supports_developer_role": bool(capabilities.get("supports_developer_role", True)),
                "supports_tools": bool(capabilities.get("supports_tools", False)),
                "supports_streaming": bool(capabilities.get("supports_streaming", False)),
            }
            if "supports_reasoning" in capabilities:
                row["supports_reasoning"] = bool(capabilities.get("supports_reasoning", False))
            if "supported_reasoning_efforts" in capabilities:
                row["supported_reasoning_efforts"] = _reasoning_efforts(
                    capabilities.get("supported_reasoning_efforts"),
                )
            if "native_tool_support" in capabilities:
                native_tools = _native_tool_support(capabilities.get("native_tool_support"))
                row["native_tool_support"] = native_tools
                row["requestable_native_tool_support"] = requestable_native_tool_support(
                    provider_type,
                    native_tools,
                )
            rows.append(row)
    return sorted(rows, key=lambda row: (str(row["provider_label"]), str(row["model_label"]), str(row["id"])))


def serialize_model_provider_catalog() -> list[dict[str, Any]]:
    """Return internal built-in provider/model rows for database seeding."""

    rows: list[dict[str, Any]] = []
    for model, entry in MODEL_CATALOG.items():
        cap_entry = entry.get("capabilities") or {}
        model_metadata = entry.get("model_metadata") or {}
        providers = entry.get("providers") or {}
        pricing_entry = entry.get("pricing") or {}
        for raw_provider, raw_provider_attrs in providers.items():
            provider_type = _norm_provider_type(str(raw_provider))
            provider_attrs = raw_provider_attrs if isinstance(raw_provider_attrs, dict) else {}
            capabilities = _capabilities_for_provider(cap_entry, provider_attrs)
            pricing = pricing_entry if isinstance(pricing_entry, dict) else {}
            if not pricing:
                pricing = _unpriced_pricing("openai")
            row = {
                "id": f"{provider_type}:{model}",
                "model": model,
                "provider_type": provider_type,
                "model_label": _model_label(model),
                "provider_label": _provider_label(provider_type, provider_attrs),
                "logo_provider": _logo_provider(provider_type, provider_attrs),
                "model_type": model_metadata.get("model_type"),
                "current_snapshot": model_metadata.get("current_snapshot"),
                "context_window_tokens": model_metadata.get("context_window_tokens"),
                "max_output_tokens": model_metadata.get("max_output_tokens"),
                "connection_id": BUILTIN_OPENAI_CONNECTION_ID,
                "source": MODEL_SOURCE_BUILTIN,
                "model_kind": entry.get("model_kind", MODEL_KIND_CHAT),
                "service_tiers_supported": _service_tiers_supported(pricing),
                "active": bool(entry.get("active", True)),
                "deprecated_at": entry.get("deprecated_at"),
                "accepts": _modality_values(capabilities.get("accepts")),
                "produces": _modality_values(capabilities.get("produces")),
                "supports_developer_role": bool(capabilities.get("supports_developer_role", True)),
                "supports_tools": bool(capabilities.get("supports_tools", False)),
                "supports_streaming": bool(capabilities.get("supports_streaming", False)),
                "structured_kinds": _string_values(capabilities.get("structured_kinds")),
                "structured_output_transport": _structured_output_transport_for_capabilities(capabilities),
                "supports_reasoning": (
                    bool(capabilities.get("supports_reasoning", False))
                    if "supports_reasoning" in capabilities
                    else None
                ),
                "supported_reasoning_efforts": (
                    _reasoning_efforts(capabilities.get("supported_reasoning_efforts"))
                    if "supported_reasoning_efforts" in capabilities
                    else None
                ),
                "native_tool_support": (
                    _native_tool_support(capabilities.get("native_tool_support"))
                    if "native_tool_support" in capabilities
                    else None
                ),
                "metadata": _metadata_for_provider(entry, provider_attrs),
            }
            row.update(_serialize_pricing(pricing))
            rows.append(row)
    return sorted(rows, key=lambda row: (str(row["provider_label"]), str(row["model_label"]), str(row["id"])))


def serialize_builtin_model_connections() -> list[dict[str, Any]]:
    """Return the release-managed connection rows for database seeding.

    The built-in OpenAI connection stores no base URL or credential reference:
    it uses the process OpenAI configuration (``OPENAI_BASE_URL`` and
    ``OPENAI_API_KEY``).
    """

    connection = builtin_openai_connection()
    return [
        {
            "id": connection.id,
            "source": connection.source,
            "name": connection.name,
            "preset": connection.preset,
            "base_url": connection.base_url,
            "credential_env": connection.credential_env,
            "compatibility": connection.compatibility.to_dict(),
            "timeout_seconds": connection.timeout_seconds,
            "active": connection.active,
        }
    ]


__all__ = [
    "MAIN_STRUCTURED_RESPONSE_KIND",
    "MAIN_STRUCTURED_RESPONSE_KINDS",
    "REASONING_EFFORT_ORDER",
    "RETIRED_BUILTIN_REPLACEMENTS",
    "STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT",
    "STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA",
    "serialize_builtin_model_connections",
    "serialize_model_catalog",
    "serialize_model_provider_catalog",
    "structured_output_transport",
    "MODEL_CATALOG",
]
