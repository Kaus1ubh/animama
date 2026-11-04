"""Fully local operation: every role on a local server, no OpenAI request (spec R4, R6).

With no OpenAI key, the built-in OpenAI base URL pointed at an unused port and
every model role assigned to rows on a local connection, a chat turn, title
generation, compaction, a Memory Manager run with an approval, and embedding
writes, re-embedding and search all succeed. A spy on every OpenAI SDK client
proves that only the local server was constructed or called.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import uuid4

import httpx2
import pytest
from fastapi import Request
from openai import AsyncOpenAI
from sqlalchemy import delete, select

from animama.adapters.repositories.sqlalchemy.archive_repo import SQLAlchemyArchiveRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.model_clients import StaticModelClientRegistry
from animama.app.model_clients.credentials import static_credential_resolver
from animama.app.services.archive_service import ArchiveService
from animama.app.services.model_provider_catalog_service import ModelCatalogPolicy
from animama.domain.request_principal import RequestPrincipal
from animama.orm import ORMAnima, ORMChat, ORMModelProvider
from animama.orm.archive import ORMArchive
from animama.orm.chat_compactions import ORMChatCompaction
from animama.orm.settings import ORMUserSettings
from animama.orm.user_file import ORMUserFile
from animama.orm.user_file_chunk import ORMUserFileChunk
from animama.server.config import settings
from animama.server.embedding_refresh import EmbeddingRefreshWorker
from animama.server.embeddings import role_embedder
from animama.server.memory_manager import local_memory_manager_service
from animama.server.model_clients import build_model_client_registry
from animama.server.model_roles import ModelRoleSettings
from tests import test_anima_chat_sse as sse

LOCAL_BASE_URL = "http://127.0.0.1:11434/v1"
UNUSED_OPENAI_BASE_URL = "http://127.0.0.1:9/v1"
CHAT_ROW = "owner:local-qwen"
EMBED_ROW = "owner:local-embed"
LOCAL_ROLES = ModelRoleSettings(owner_roles_enabled=True)


class _LocalModelServer:
    """Answers like Ollama's OpenAI-compatible API and records every request."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, Any]]] = []
        self.foreign: list[str] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        if (request.url.host, request.url.port) != ("127.0.0.1", 11434):
            self.foreign.append(str(request.url))
            return httpx2.Response(500, json={"error": {"message": "not the local server"}})
        body = json.loads(request.content) if request.content else {}
        self.requests.append((request.url.path, body))
        if request.url.path == "/v1/embeddings":
            data = [
                {"object": "embedding", "index": index, "embedding": [1.0 if "moon" in text.lower() else 0.0, 0.5]}
                for index, text in enumerate(body["input"])
            ]
            return httpx2.Response(200, json={"object": "list", "model": body["model"], "data": data})
        if body.get("stream"):
            return _stream(body)
        return _memory_manager_reply(body)

    def paths(self, path: str) -> list[dict[str, Any]]:
        return [body for request_path, body in self.requests if request_path == path]


def _stream(body: dict[str, Any]) -> httpx2.Response:
    structured = body.get("response_format") is not None
    content = sse._direct_structured_response(speech="Hello from the local model") if structured else "Moon plans"
    base = {"id": "local", "object": "chat.completion.chunk", "created": 1, "model": body["model"]}
    chunks = [
        {**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": content}, "finish_reason": None}]},
        {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
        {**base, "choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 6, "total_tokens": 18}},
    ]
    payload = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"
    return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=payload.encode())


def _memory_manager_reply(body: dict[str, Any]) -> httpx2.Response:
    """Propose one memory patch, then finish once the tool result arrives."""

    message: dict[str, Any] = {"role": "assistant", "content": None}
    if body["messages"][-1]["role"] == "tool":
        message["content"] = "Saved your note about the moon."
    else:
        operation = {
            "type": "create_file",
            "path": "moon.md",
            "diff": '+---\n+description: "Moon"\n+---\n+Loves watching the moon.',
        }
        message["tool_calls"] = [
            {
                "id": "call-local-patch",
                "type": "function",
                "function": {"name": "apply_patch", "arguments": json.dumps({"operation": operation})},
            }
        ]
    return httpx2.Response(
        200,
        json={
            "id": "local",
            "object": "chat.completion",
            "created": 1,
            "model": body["model"],
            "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        },
    )


class _ForbiddenClient:
    """Stands in for the OpenAI Responses client, which a local setup never uses."""

    calls = 0

    async def aclose(self) -> None:
        pass

    async def stream(self, request):
        _ForbiddenClient.calls += 1
        raise AssertionError("the OpenAI Responses client was used")
        yield  # pragma: no cover


@pytest.fixture
def local_only(monkeypatch, set_runtime_credentials):
    """Remove OpenAI credentials and route every SDK client to the local server."""

    server = _LocalModelServer()
    base_urls: list[str] = []
    original_init = AsyncOpenAI.__init__

    def _init(self, *args, **kwargs):
        base_urls.append(str(kwargs.get("base_url")))
        kwargs["http_client"] = httpx2.AsyncClient(transport=httpx2.MockTransport(server))
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(AsyncOpenAI, "__init__", _init)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANIMAMA_LLM_SKIP", raising=False)
    monkeypatch.setenv("OPENAI_BASE_URL", UNUSED_OPENAI_BASE_URL)
    set_runtime_credentials()
    return server, base_urls


async def _seed_local_roles(session, owner_id: str) -> None:
    await sse._seed_owner_connection(
        session, "conn-local-ollama", preset="ollama", base_url=LOCAL_BASE_URL, name="Ollama"
    )
    await sse._seed_chat_model_provider(
        session,
        CHAT_ROW,
        provider_type="OpenAIHTTPAgent",
        model="qwen3.5:4b-mlx",
        provider_label="Ollama",
        connection_id="conn-local-ollama",
        source="owner",
        context_window_tokens=32_768,
        supports_reasoning=False,
        supported_reasoning_efforts=[],
        native_tool_support=[],
    )
    session.add(
        ORMModelProvider(
            id=EMBED_ROW,
            provider_type="OpenAIHTTPAgent",
            model="nomic-embed-text",
            model_label="nomic-embed-text",
            provider_label="Ollama",
            connection_id="conn-local-ollama",
            source="owner",
            model_kind="embedding",
            accepts=["text"],
            produces=["embedding"],
            supports_streaming=False,
            supports_tools=False,
            metadata_={},
        )
    )
    await session.execute(delete(ORMUserSettings).where(ORMUserSettings.user_id == owner_id))
    session.add(
        ORMUserSettings(
            user_id=owner_id,
            preferences={
                "chat": {"default_model_provider_id": CHAT_ROW},
                "models": {
                    "utility_model_provider_id": CHAT_ROW,
                    "memory_manager_model_provider_id": CHAT_ROW,
                    "embedding_model_provider_id": EMBED_ROW,
                },
            },
        )
    )
    await session.commit()


def _local_request(registry: StaticModelClientRegistry) -> Request:
    """A request to the local composition, which enables owner model roles."""

    app = sse._route_app()
    app.state.model_client_registry = registry
    app.state.model_catalog_policy = ModelCatalogPolicy(owner_models_enabled=True)
    return Request({"type": "http", "app": app})


async def _chat_turn(
    registry: StaticModelClientRegistry, anima_id: str, chat_id: str, owner_id: str, run_id: str
) -> list[str]:
    response = await sse.chat_anima_direct_sse(
        anima_id,
        sse._chat_request(message="Tell me about the moon", run_id=run_id, chat_id=chat_id),
        request=_local_request(registry),
        user=RequestPrincipal(id=owner_id),
    )
    return await sse._collect_chunks(response)


async def test_local_roles_complete_every_job_without_an_openai_request(
    monkeypatch, async_session, async_session_factory, local_only
):
    server, base_urls = local_only
    owner_id = f"owner-local-{uuid4().hex[:8]}"
    anima_id = f"anima-local-{uuid4().hex[:8]}"
    title_chat = f"chat-title-{uuid4().hex[:8]}"
    compact_chat = f"chat-compact-{uuid4().hex[:8]}"
    archive_id = f"archive-{uuid4().hex[:8]}"
    async_session.add(ORMArchive(id=archive_id, name="Local archive"))
    await async_session.flush()
    async_session.add(ORMAnima(id=anima_id, user_id=owner_id, archive_id=archive_id))
    async_session.add(ORMChat(id=title_chat, anima_id=anima_id, user_id=owner_id, metadata_={}))
    async_session.add(
        ORMChat(id=compact_chat, anima_id=anima_id, user_id=owner_id, api_standard="chat_completions", metadata_={})
    )
    await async_session.commit()
    await sse._seed_anima_identity_file(async_session, anima_id=anima_id, user_id=owner_id)
    await _seed_local_roles(async_session, owner_id)
    await sse._seed_visible_chat_messages(
        async_session, chat_id=compact_chat, contents=["old-user-1", "old-assistant-1", "old-user-2", "old-assistant-2"]
    )

    registry = build_model_client_registry(credential_resolver=static_credential_resolver())
    local_client = cast(Any, registry.get("OpenAIHTTPAgent"))
    sse._install_db_route_mocks(
        monkeypatch, async_session_factory, model_client=local_client, default_model_provider_id=CHAT_ROW
    )
    registry.register("OpenAIResponsesHTTPAgent", _ForbiddenClient())
    sse._CURRENT_SETTINGS_UPDATES.update(
        anima_chat_title_generation_enabled=True,
        anima_chat_title_generation_prompt_version="local-title",
        anima_chat_title_generation_max_chars=48,
        anima_chat_compaction_enabled=True,
        anima_chat_compaction_threshold_tokens=1,
        anima_chat_compaction_recent_message_min_count=2,
    )

    # A chat turn and the first-turn title.
    title_chunks = await _chat_turn(registry, anima_id, title_chat, owner_id, "run-local-title")
    # A turn in a longer chat compacts older messages afterwards.
    compact_chunks = await _chat_turn(registry, anima_id, compact_chat, owner_id, "run-local-compact")

    # A Memory Manager run proposes a patch, waits for approval and finishes.
    manager = await local_memory_manager_service(
        async_session, owner_id, roles=LOCAL_ROLES.resolver(async_session), runtime_settings=settings
    )
    waiting = await manager.create_run(user_id=owner_id, initial_message="Remember that I love the moon")
    await manager.decide_approval(user_id=owner_id, approval_id=waiting.approvals[0].id, decision="approve")
    finished = await manager.get_run_snapshot(user_id=owner_id, run_id=waiting.run.id)

    # Archive writes and search, and re-embedding of an upload chunk, use the local embedder.
    archive = ArchiveService(
        archives=SQLAlchemyArchiveRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
        embedder=await role_embedder(async_session, owner_id, LOCAL_ROLES),
    )
    await archive.create_passage(archive_id=archive_id, text="We watched the moon rise")
    await archive.create_passage(archive_id=archive_id, text="The garden needs water")
    found = await archive.search_passages(query="moon", threshold=0.5, archive_id=archive_id)
    file_id = f"file-{uuid4().hex[:8]}"
    async_session.add(
        ORMUserFile(
            id=file_id,
            user_id=owner_id,
            storage_locator=f"users/{owner_id}/files/{file_id}/original.txt",
            original_filename="moon.txt",
            normalized_extension=".txt",
            declared_size_bytes=10,
            status="ready",
            upload_expires_at=datetime.now(UTC) + timedelta(minutes=10),
            metadata_={},
        )
    )
    await async_session.flush()
    async_session.add(
        ORMUserFileChunk(
            id=f"chunk-{file_id}-000000",
            file_id=file_id,
            user_id=owner_id,
            chunk_index=0,
            text="Moon phases",
            char_count=11,
            token_estimate=3,
            metadata_={},
        )
    )
    await async_session.commit()
    await EmbeddingRefreshWorker(async_session_factory, roles=LOCAL_ROLES).refresh_once()

    async_session.expire_all()
    title_row = await async_session.get(ORMChat, title_chat)
    compaction = (
        await async_session.execute(select(ORMChatCompaction).where(ORMChatCompaction.chat_id == compact_chat))
    ).scalar_one()
    chunk = await async_session.get(ORMUserFileChunk, f"chunk-{file_id}-000000")

    assert sse._event_data(title_chunks, "run.completed")["chat_id"] == title_chat
    assert any('"text": "Hello from the local model"' in chunk for chunk in title_chunks)
    assert sse._event_data(title_chunks, "chat.title.updated")["title"] == "Moon plans"
    assert title_row is not None and title_row.title == "Moon plans"
    assert sse._event_data(compact_chunks, "run.completed")["chat_id"] == compact_chat
    assert compaction.summary_text == "Moon plans"
    assert (compaction.model_provider, compaction.model) == ("OpenAIHTTPAgent", "qwen3.5:4b-mlx")
    assert waiting.run.status == "waiting_approval"
    assert waiting.approvals[0].target_path == "moon.md"
    assert finished.run.status == "active"
    assert (finished.run.model_provider, finished.run.model_name) == ("OpenAIHTTPAgent", "qwen3.5:4b-mlx")
    assert (finished.run.metadata or {})["model_provider_id"] == CHAT_ROW
    assert finished.approvals[0].status == "approved"
    assert finished.messages[-1].content == "Saved your note about the moon."
    assert [passage.text for passage in found] == ["We watched the moon rise"]
    assert chunk is not None and chunk.embedding_model_id == EMBED_ROW

    # Every model request reached the local server; OpenAI was never constructed or called.
    assert server.foreign == []
    assert base_urls and all(url.rstrip("/") == LOCAL_BASE_URL for url in base_urls)
    assert _ForbiddenClient.calls == 0
    chat_requests = server.paths("/v1/chat/completions")
    # Two turns, a title and a compaction stream; the Memory Manager proposes, then finishes.
    assert sum(1 for body in chat_requests if body.get("stream")) == 4
    manager_requests = [body for body in chat_requests if not body.get("stream")]
    assert len(manager_requests) == 2
    assert all("store" not in body and "prompt_cache_key" not in body for body in manager_requests)
    assert {body["model"] for body in chat_requests} == {"qwen3.5:4b-mlx"}
    assert {body["model"] for body in server.paths("/v1/embeddings")} == {"nomic-embed-text"}
