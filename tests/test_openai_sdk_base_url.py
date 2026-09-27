"""Regression tests: SDK clients must not inherit an empty OPENAI_BASE_URL."""

from __future__ import annotations

from typing import cast

import pytest

from animama.adapters.memory_manager.openai_agents_runtime import OpenAIAgentsMemoryManagerRuntime
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.embeddings import Embedder

OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1/"


def _memory_manager_runtime(base_url: str | None) -> OpenAIAgentsMemoryManagerRuntime:
    return OpenAIAgentsMemoryManagerRuntime(
        user_id="user-1",
        memory_entries=cast(MemoryEntryService, object()),
        api_key="test-key",
        base_url=base_url,
        model="gpt-5.4-mini",
        timeout_seconds=1.0,
    )


@pytest.mark.parametrize("configured_base_url", [None, "", "  "])
def test_memory_manager_client_defaults_to_openai_when_env_base_url_is_empty(
    monkeypatch: pytest.MonkeyPatch, configured_base_url: str | None
) -> None:
    """Compose passes OPENAI_BASE_URL="" by default; the SDK would otherwise use ''."""

    monkeypatch.setenv("OPENAI_BASE_URL", "")

    client = _memory_manager_runtime(configured_base_url)._client()

    assert str(client.base_url) == OPENAI_DEFAULT_BASE_URL


def test_memory_manager_client_uses_configured_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_BASE_URL", "")

    client = _memory_manager_runtime("https://proxy.example/v1/")._client()

    assert str(client.base_url) == "https://proxy.example/v1/"


def test_embedder_client_defaults_to_openai_when_env_base_url_is_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_BASE_URL", "")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    embedder = Embedder()

    assert str(embedder._client.base_url) == OPENAI_DEFAULT_BASE_URL
