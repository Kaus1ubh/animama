"""Provider-neutral error categories (spec R7)."""

from __future__ import annotations

import pytest

from animama.app.model_clients.error_categories import model_error_category


@pytest.mark.parametrize(
    ("code", "metadata", "category"),
    [
        ("openai_connection_error", None, "unreachable"),
        ("openai_timeout", None, "timeout"),
        ("model_deadline_exceeded", None, "timeout"),
        ("model_input_limit_exceeded", None, "context_exceeded"),
        ("missing_api_key", None, "credential_missing"),
        ("openai_authentication_error", None, "credential_rejected"),
        ("openai_permission_denied", None, "credential_rejected"),
        ("openai_not_found", None, "model_not_found"),
        ("openai_rate_limit", None, "rate_limited"),
        ("openai_quota_exceeded", None, "quota_exceeded"),
        ("openai_overloaded", None, "server_error"),
        ("openai_bad_request", {"provider_error_message": "Unsupported parameter"}, "bad_request"),
        ("something_new", None, "provider_error"),
    ],
)
def test_adapter_codes_map_to_neutral_categories(code, metadata, category):
    assert model_error_category(code, metadata) == category


@pytest.mark.parametrize(
    "metadata",
    [
        {"provider_error_code": "context_length_exceeded"},
        {"provider_error_message": "This model's maximum context length is 8192 tokens."},
        {"provider_error_message": "the request exceeds the available context size, try increasing it"},
        {"provider_error_message": "Trying to keep the first 9000 tokens when context the overflows (n_ctx 8192)"},
        {"provider_error_message": "Prompt is too long"},
    ],
)
def test_oversized_prompts_are_reported_as_context_exceeded(metadata):
    assert model_error_category("openai_bad_request", metadata) == "context_exceeded"


def test_other_categories_are_not_reinterpreted_from_messages():
    metadata = {"provider_error_message": "maximum context length exceeded"}

    assert model_error_category("openai_authentication_error", metadata) == "credential_rejected"
    # A server failure such as a model load error may mention context without being one.
    assert model_error_category("openai_server_error", metadata) == "server_error"
