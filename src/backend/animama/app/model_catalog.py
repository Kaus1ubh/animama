"""Provider + model catalog used by direct model clients.

Stores per-provider model information (modalities, streaming, tools, pricing,
and provider endpoint hints) and exposes serializers for durable catalog seeding.

Notes
- This module avoids importing server-side Pydantic schemas to keep
  dependencies light and import-safe in docs/tests.
- Modalities are represented using the domain ``Modality`` enum.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from animama.app.model_provider_native_tools import requestable_native_tool_support
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
OPENAI_PRICING_SOURCE_URL = "https://developers.openai.com/api/docs/pricing"
OPENAI_PRICING_SOURCE_CHECKED_AT = "2026-06-16"
OPENAI_GPT_56_PRICING_SOURCE_CHECKED_AT = "2026-08-08"
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_REASONING_EFFORTS = frozenset({"none", "high", "max"})
HUGGINGFACE_ROUTER_BASE_URL = "https://router.huggingface.co/v1"

OPENAI_GPT_5_NANO_PRICING: dict[str, Any] = {
    "status": "priced",
    "source_provider": "openai",
    "source_model": "gpt-5-nano",
    "source_url": OPENAI_PRICING_SOURCE_URL,
    "source_checked_at": OPENAI_PRICING_SOURCE_CHECKED_AT,
    "currency": "USD",
    "billing_unit": "1M_tokens",
    "standard": {"input": "0.05", "cached_input": "0.005", "output": "0.4"},
    "batch": {"input": "0.025", "cached_input": "0.0025", "output": "0.2"},
    "flex": {"input": "0.025", "cached_input": "0.0025", "output": "0.2"},
    "priority": None,
}

OPENAI_GPT_54_NANO_PRICING: dict[str, Any] = {
    "status": "priced",
    "source_provider": "openai",
    "source_model": "gpt-5.4-nano",
    "source_url": OPENAI_PRICING_SOURCE_URL,
    "source_checked_at": OPENAI_PRICING_SOURCE_CHECKED_AT,
    "currency": "USD",
    "billing_unit": "1M_tokens",
    "standard": {"input": "0.20", "cached_input": "0.02", "output": "1.25"},
    "batch": {"input": "0.10", "cached_input": "0.01", "output": "0.625"},
    "flex": {"input": "0.10", "cached_input": "0.01", "output": "0.625"},
    "priority": None,
    "regional_processing_uplift_factor": "1.10",
    "pricing_notes": ["Regional processing endpoints apply a 10 percent uplift for GPT-5.4 nano."],
}

OPENAI_GPT_56_LUNA_PRICING: dict[str, Any] = {
    "status": "priced",
    "source_provider": "openai",
    "source_model": "gpt-5.6-luna",
    "source_url": OPENAI_PRICING_SOURCE_URL,
    "source_checked_at": OPENAI_GPT_56_PRICING_SOURCE_CHECKED_AT,
    "currency": "USD",
    "billing_unit": "1M_tokens",
    "standard": {"input": "0.20", "cached_input": "0.02", "output": "1.20"},
    "batch": {"input": "0.10", "cached_input": "0.01", "output": "0.60"},
    "flex": {"input": "0.10", "cached_input": "0.01", "output": "0.60"},
    # The durable pricing schema and Responses usage use the priority-tier key;
    # keep that serialized key independent of the provider-facing label.
    "priority": {"input": "0.40", "cached_input": "0.04", "output": "2.40"},
    "long_context": {
        "token_threshold": 272_000,
        "standard": {"input": "0.40", "cached_input": "0.04", "output": "1.80"},
        "batch": {"input": "0.20", "cached_input": "0.02", "output": "0.90"},
        "flex": {"input": "0.20", "cached_input": "0.02", "output": "0.90"},
        "priority": {"input": "0.80", "cached_input": "0.08", "output": "3.60"},
    },
    "regional_processing_uplift_factor": "1.10",
    "pricing_notes": [
        "Requests with more than 272,000 input tokens use long-context rates for the full request.",
        "OpenAI cache-write pricing is not represented by Animama's current token cost estimate.",
        "OpenAI Fast mode rates are stored in the existing priority tier fields.",
        "Regional processing endpoints apply a 10 percent uplift for GPT-5.6 models.",
    ],
}

OPENAI_GPT_56_TERRA_PRICING: dict[str, Any] = {
    "status": "priced",
    "source_provider": "openai",
    "source_model": "gpt-5.6-terra",
    "source_url": OPENAI_PRICING_SOURCE_URL,
    "source_checked_at": OPENAI_GPT_56_PRICING_SOURCE_CHECKED_AT,
    "currency": "USD",
    "billing_unit": "1M_tokens",
    "standard": {"input": "2.00", "cached_input": "0.20", "output": "12.00"},
    "batch": {"input": "1.00", "cached_input": "0.10", "output": "6.00"},
    "flex": {"input": "1.00", "cached_input": "0.10", "output": "6.00"},
    "priority": {"input": "4.00", "cached_input": "0.40", "output": "24.00"},
    "long_context": {
        "token_threshold": 272_000,
        "standard": {"input": "4.00", "cached_input": "0.40", "output": "18.00"},
        "batch": {"input": "2.00", "cached_input": "0.20", "output": "9.00"},
        "flex": {"input": "2.00", "cached_input": "0.20", "output": "9.00"},
        "priority": {"input": "8.00", "cached_input": "0.80", "output": "36.00"},
    },
    "regional_processing_uplift_factor": "1.10",
    "pricing_notes": [
        "Requests with more than 272,000 input tokens use long-context rates for the full request.",
        "OpenAI cache-write pricing is not represented by Animama's current token cost estimate.",
        "OpenAI Fast mode rates are stored in the existing priority tier fields.",
        "Regional processing endpoints apply a 10 percent uplift for GPT-5.6 models.",
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


def _provider_family(provider_type: str, model: str, provider_attrs: dict[str, Any] | None = None) -> str | None:
    if isinstance(provider_attrs, dict):
        raw_family = provider_attrs.get("provider_family")
        if isinstance(raw_family, str) and raw_family.strip():
            return raw_family.strip().lower()
    if provider_type.startswith("OpenAI"):
        return "openai"
    if provider_type == "GeminiAgent":
        return "gemini"
    if provider_type == "LiteLLMAgent" and "/" in model:
        return model.split("/", 1)[0].strip().lower() or None
    return provider_type.removesuffix("Agent").lower() or None


def _api_family(provider_type: str, model: str, provider_attrs: dict[str, Any] | None = None) -> str | None:
    if isinstance(provider_attrs, dict):
        raw_family = provider_attrs.get("api_family")
        if isinstance(raw_family, str) and raw_family.strip():
            return raw_family.strip().lower()
    if provider_type == "LiteLLMAgent":
        return "litellm"
    return _provider_family(provider_type, model, provider_attrs)


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
        "base_url": str | None,
        "supports_developer_role": bool,        # optional, default true
      },
      ...
    }
  }
}
"""

MODEL_CATALOG: dict[str, dict[str, Any]] = {
    # OpenAI chat models
    "gpt-5-nano": {
        "model_metadata": {
            "model_type": "reasoning",
            "current_snapshot": "gpt-5-nano-2025-08-07",
        },
        "capabilities": {
            "accepts": _s("text", "image"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
            "supports_reasoning": True,
            "supported_reasoning_efforts": {"minimal", "low", "medium", "high"},
        },
        "providers": {
            "OpenAIHTTPAgent": {"base_url": "https://api.openai.com/v1"},
            "OpenAIResponsesHTTPAgent": {"base_url": "https://api.openai.com/v1"},
        },
        "pricing": OPENAI_GPT_5_NANO_PRICING,
    },
    "gpt-5.4-nano": {
        "model_metadata": {
            "model_type": "reasoning",
            "current_snapshot": "gpt-5.4-nano-2026-03-17",
        },
        "capabilities": {
            "accepts": _s("text", "image"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
            "supports_reasoning": True,
            "supported_reasoning_efforts": {"none", "low", "medium", "high", "xhigh"},
        },
        "providers": {
            "OpenAIHTTPAgent": {"base_url": "https://api.openai.com/v1"},
            "OpenAIResponsesHTTPAgent": {
                "base_url": "https://api.openai.com/v1",
                "native_tool_support": {"web_search", "apply_patch"},
            },
        },
        "pricing": OPENAI_GPT_54_NANO_PRICING,
    },
    "gpt-5.6-luna": {
        "model_metadata": {
            "model_type": "reasoning",
            "current_snapshot": "gpt-5.6-luna",
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
            "OpenAIResponsesHTTPAgent": {
                "base_url": "https://api.openai.com/v1",
                "native_tool_support": {"web_search", "apply_patch"},
            },
        },
        "pricing": OPENAI_GPT_56_LUNA_PRICING,
    },
    "gpt-5.6-terra": {
        "model_metadata": {
            "model_type": "reasoning",
            "current_snapshot": "gpt-5.6-terra",
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
            "OpenAIResponsesHTTPAgent": {
                "base_url": "https://api.openai.com/v1",
                "native_tool_support": {"web_search", "apply_patch"},
            },
        },
        "pricing": OPENAI_GPT_56_TERRA_PRICING,
    },
    "deepseek-v4-flash": {
        "model_metadata": {
            "model_type": "reasoning",
            "context_window_tokens": 1_000_000,
            "max_output_tokens": 384_000,
        },
        "capabilities": {
            "accepts": _s("text"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT,
            "supports_reasoning": True,
            "supported_reasoning_efforts": DEEPSEEK_REASONING_EFFORTS,
        },
        "providers": {
            "OpenAIHTTPAgent": {
                "base_url": DEEPSEEK_BASE_URL,
                "provider_label": "DeepSeek",
                "logo_provider": "deepseek",
                "provider_family": "deepseek",
                "api_family": "deepseek",
                "supports_developer_role": False,
            },
        },
        "metadata": {
            "openai_compatible_provider": "deepseek",
        },
        "pricing": _unpriced_pricing("deepseek"),
    },
    "deepseek-v4-pro": {
        "model_metadata": {
            "model_type": "reasoning",
            "context_window_tokens": 1_000_000,
            "max_output_tokens": 384_000,
        },
        "capabilities": {
            "accepts": _s("text"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT,
            "supports_reasoning": True,
            "supported_reasoning_efforts": DEEPSEEK_REASONING_EFFORTS,
        },
        "providers": {
            "OpenAIHTTPAgent": {
                "base_url": DEEPSEEK_BASE_URL,
                "provider_label": "DeepSeek",
                "logo_provider": "deepseek",
                "provider_family": "deepseek",
                "api_family": "deepseek",
                "supports_developer_role": False,
            },
        },
        "metadata": {
            "openai_compatible_provider": "deepseek",
        },
        "pricing": _unpriced_pricing("deepseek"),
    },
    "zai-org/GLM-5.2:deepinfra": {
        "capabilities": {
            "accepts": _s("text"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
        },
        "providers": {
            "OpenAIHTTPAgent": {
                "base_url": HUGGINGFACE_ROUTER_BASE_URL,
                "provider_label": "Hugging Face",
                "logo_provider": "huggingface",
                "provider_family": "huggingface",
                "api_family": "huggingface",
                "supports_developer_role": False,
            },
        },
        "metadata": {
            "openai_compatible_provider": "huggingface",
        },
        "pricing": _unpriced_pricing("huggingface"),
    },
    "deepseek-ai/DeepSeek-V4-Pro:deepinfra": {
        "capabilities": {
            "accepts": _s("text"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
        },
        "providers": {
            "OpenAIHTTPAgent": {
                "base_url": HUGGINGFACE_ROUTER_BASE_URL,
                "provider_label": "Hugging Face",
                "logo_provider": "huggingface",
                "provider_family": "huggingface",
                "api_family": "huggingface",
                "supports_developer_role": False,
            },
        },
        "metadata": {
            "openai_compatible_provider": "huggingface",
        },
        "pricing": _unpriced_pricing("huggingface"),
    },
    # LiteLLM provider-prefixed aliases. These are intentionally strict:
    # LiteLLMAgent does not accept arbitrary model ids in v1.
    "openai/gpt-5.4-nano": {
        "model_metadata": {
            "model_type": "reasoning",
            "current_snapshot": "gpt-5.4-nano-2026-03-17",
        },
        "capabilities": {
            "accepts": _s("text", "image"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
            "supports_reasoning": True,
            "supported_reasoning_efforts": {"none", "low", "medium", "high", "xhigh"},
        },
        "providers": {
            "LiteLLMAgent": {"base_url": None, "supports_developer_role": False},
        },
        "pricing": OPENAI_GPT_54_NANO_PRICING,
    },
    "gemini/gemini-3.1-flash-lite-preview": {
        "capabilities": {
            "accepts": _s("text", "image"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
        },
        "providers": {
            "LiteLLMAgent": {"base_url": None, "supports_developer_role": False},
        },
        "pricing": _unpriced_pricing("gemini"),
    },
    "xai/grok-4-1-fast-reasoning-latest": {
        "capabilities": {
            "accepts": _s("text"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
        },
        "providers": {
            "LiteLLMAgent": {"base_url": None, "supports_developer_role": False},
        },
        "pricing": _unpriced_pricing("xai"),
    },
    "groq/openai/gpt-oss-120b": {
        "capabilities": {
            "accepts": _s("text"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
        },
        "providers": {
            "LiteLLMAgent": {"base_url": None, "supports_developer_role": False},
        },
        "pricing": _unpriced_pricing("groq"),
    },
    # Gemini models
    "gemini-3.1-flash-lite-preview": {
        "capabilities": {
            "accepts": _s("text", "image"),
            "produces": _s("text"),
            "supports_tools": True,
            "supports_streaming": True,
            "structured_kinds": MAIN_STRUCTURED_RESPONSE_KINDS,
            "structured_output_transport": STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
        },
        "providers": {
            "GeminiAgent": {"base_url": None, "supports_developer_role": False},
        },
        "pricing": _unpriced_pricing("gemini"),
    },
}


# ---------------------------- API -----------------------------------------


PROVIDER_LABELS: dict[str, str] = {
    "OpenAIHTTPAgent": "OpenAI HTTP",
    "OpenAIResponsesHTTPAgent": "OpenAI Responses HTTP",
    "GeminiAgent": "Gemini",
    "LiteLLMAgent": "LiteLLM",
}

PROVIDER_LOGOS: dict[str, str] = {
    "OpenAIHTTPAgent": "openai",
    "OpenAIResponsesHTTPAgent": "openai",
    "GeminiAgent": "google",
    "LiteLLMAgent": "litellm",
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


def _logo_provider(provider_type: str, model: str, provider_attrs: dict[str, Any] | None = None) -> str | None:
    if isinstance(provider_attrs, dict):
        raw_logo = provider_attrs.get("logo_provider")
        if isinstance(raw_logo, str) and raw_logo.strip():
            return raw_logo.strip()
    if provider_type != "LiteLLMAgent":
        return PROVIDER_LOGOS.get(provider_type)
    prefix = model.split("/", 1)[0].strip().lower()
    return {
        "openai": "openai",
        "gemini": "google",
        "xai": "xai",
        "groq": "groq",
        "deepseek": "deepseek",
    }.get(prefix, PROVIDER_LOGOS.get(provider_type))


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
    """Return public model catalog rows for API/UI use.

    Provider credentials, registry base URLs, and user-supplied overrides are
    intentionally omitted from this payload.
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
                "logo_provider": _logo_provider(provider_type, model, provider_attrs),
                **_chat_api_standard_fields(provider_type),
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
    """Return internal provider/model catalog rows for future database seeding."""

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
                source_provider = _provider_family(provider_type, model, provider_attrs) or provider_type
                pricing = _unpriced_pricing(source_provider)
            row = {
                "id": f"{provider_type}:{model}",
                "model": model,
                "provider_type": provider_type,
                "model_label": _model_label(model),
                "provider_label": _provider_label(provider_type, provider_attrs),
                "logo_provider": _logo_provider(provider_type, model, provider_attrs),
                "model_type": model_metadata.get("model_type"),
                "current_snapshot": model_metadata.get("current_snapshot"),
                "context_window_tokens": model_metadata.get("context_window_tokens"),
                "max_output_tokens": model_metadata.get("max_output_tokens"),
                "provider_base_url": provider_attrs.get("base_url"),
                "api_family": _api_family(provider_type, model, provider_attrs),
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


__all__ = [
    "DEEPSEEK_BASE_URL",
    "DEEPSEEK_REASONING_EFFORTS",
    "HUGGINGFACE_ROUTER_BASE_URL",
    "MAIN_STRUCTURED_RESPONSE_KIND",
    "MAIN_STRUCTURED_RESPONSE_KINDS",
    "REASONING_EFFORT_ORDER",
    "STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT",
    "STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA",
    "serialize_model_catalog",
    "serialize_model_provider_catalog",
    "structured_output_transport",
    "MODEL_CATALOG",
]
