"""Regression tests: SDK clients must not inherit an empty OPENAI_BASE_URL."""

from __future__ import annotations

from typing import cast

import pytest

from animama.adapters.memory_manager.openai_agents_runtime import OpenAIAgentsMemoryManagerRuntime
from animama.adapters.model_clients.openai_chat_completions.support import resolve_openai_base_url
from animama.app.model_clients.credentials import static_credential_resolver
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.domain.model_provider import ModelProvider, ModelProviderCapabilities
from animama.server.model_clients import openai_base_url

OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"


def _memory_manager_runtime(base_url: str | None) -> OpenAIAgentsMemoryManagerRuntime:
    return OpenAIAgentsMemoryManagerRuntime(
        user_id="user-1",
        memory_entries=cast(MemoryEntryService, object()),
        model_provider=ModelProvider(
            id="OpenAIResponsesHTTPAgent:gpt-5.4-mini",
            model="gpt-5.4-mini",
            provider_type="OpenAIResponsesHTTPAgent",
            model_label="gpt-5.4-mini",
            provider_label="OpenAI",
            capabilities=ModelProviderCapabilities(supports_tools=True, supports_streaming=True),
        ),
        credential_resolver=static_credential_resolver({"OPENAI_API_KEY": "test-key"}),
        openai_base_url=base_url,
        timeout_seconds=1.0,
    )


@pytest.mark.parametrize("environment_value", ["", "  "])
def test_blank_environment_base_url_means_the_openai_default(
    monkeypatch: pytest.MonkeyPatch, environment_value: str
) -> None:
    """Compose passes OPENAI_BASE_URL="" by default; the SDK would otherwise use ''."""

    monkeypatch.setenv("OPENAI_BASE_URL", environment_value)

    assert resolve_openai_base_url() == OPENAI_DEFAULT_BASE_URL
    assert resolve_openai_base_url("  ") == OPENAI_DEFAULT_BASE_URL
    assert openai_base_url() == OPENAI_DEFAULT_BASE_URL


@pytest.mark.parametrize("configured_base_url", [None, "", "  "])
def test_memory_manager_client_defaults_to_openai_when_env_base_url_is_empty(
    monkeypatch: pytest.MonkeyPatch, configured_base_url: str | None
) -> None:
    monkeypatch.setenv("OPENAI_BASE_URL", "")
    runtime = _memory_manager_runtime(configured_base_url)

    client = runtime._client(*runtime._require_model())

    assert str(client.base_url) == f"{OPENAI_DEFAULT_BASE_URL}/"


def test_memory_manager_client_uses_configured_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_BASE_URL", "")
    runtime = _memory_manager_runtime("https://proxy.example/v1/")

    client = runtime._client(*runtime._require_model())

    assert str(client.base_url) == "https://proxy.example/v1/"
