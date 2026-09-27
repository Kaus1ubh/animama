"""Provider-neutral categories for model-client failures.

Adapters report provider-specific codes (for example ``openai_timeout``). The
probe, chat errors and settings UI use these categories to explain a failure
and suggest a fix without exposing provider bodies or credentials.
"""

from __future__ import annotations

ERROR_UNREACHABLE = "unreachable"
ERROR_CREDENTIAL_MISSING = "credential_missing"
ERROR_CREDENTIAL_REJECTED = "credential_rejected"
ERROR_MODEL_NOT_FOUND = "model_not_found"
ERROR_TIMEOUT = "timeout"
ERROR_CONTEXT_EXCEEDED = "context_exceeded"
ERROR_RATE_LIMITED = "rate_limited"
ERROR_QUOTA_EXCEEDED = "quota_exceeded"
ERROR_SERVER_ERROR = "server_error"
ERROR_BAD_REQUEST = "bad_request"
ERROR_PROVIDER_ERROR = "provider_error"
ERROR_INVALID_BASE_URL = "invalid_base_url"
ERROR_UNEXPECTED_RESPONSE = "unexpected_response"
"""The endpoint answered, but not with an OpenAI-compatible response."""

_CATEGORY_BY_CODE = {
    "openai_connection_error": ERROR_UNREACHABLE,
    "connection_unavailable": ERROR_UNREACHABLE,
    "connection_base_url_missing": ERROR_UNREACHABLE,
    "openai_timeout": ERROR_TIMEOUT,
    "missing_api_key": ERROR_CREDENTIAL_MISSING,
    "openai_authentication_error": ERROR_CREDENTIAL_REJECTED,
    "openai_permission_denied": ERROR_CREDENTIAL_REJECTED,
    "openai_not_found": ERROR_MODEL_NOT_FOUND,
    "openai_rate_limit": ERROR_RATE_LIMITED,
    "openai_quota_exceeded": ERROR_QUOTA_EXCEEDED,
    "openai_server_error": ERROR_SERVER_ERROR,
    "openai_overloaded": ERROR_SERVER_ERROR,
    "openai_bad_request": ERROR_BAD_REQUEST,
    "openai_unprocessable_entity": ERROR_BAD_REQUEST,
}


def model_error_category(code: str | None) -> str:
    """Return the neutral category for an adapter error code."""

    return _CATEGORY_BY_CODE.get(code or "", ERROR_PROVIDER_ERROR)


__all__ = [
    "ERROR_BAD_REQUEST",
    "ERROR_CONTEXT_EXCEEDED",
    "ERROR_CREDENTIAL_MISSING",
    "ERROR_CREDENTIAL_REJECTED",
    "ERROR_INVALID_BASE_URL",
    "ERROR_MODEL_NOT_FOUND",
    "ERROR_PROVIDER_ERROR",
    "ERROR_QUOTA_EXCEEDED",
    "ERROR_RATE_LIMITED",
    "ERROR_SERVER_ERROR",
    "ERROR_TIMEOUT",
    "ERROR_UNEXPECTED_RESPONSE",
    "ERROR_UNREACHABLE",
    "model_error_category",
]
