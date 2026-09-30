"""Embeddings role: model-tagged vectors, re-embedding and archive search (spec R4)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx
import pytest
from openai import AsyncOpenAI
from sqlalchemy import select, update

from animama.adapters.model_clients.openai_chat_completions.embedder import ConnectionEmbedder
from animama.adapters.repositories.sqlalchemy.archive_repo import SQLAlchemyArchiveRepository
from animama.adapters.repositories.sqlalchemy.embedding_refresh_repo import SQLAlchemyEmbeddingRefreshRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.model_clients import ModelClientProviderError
from animama.app.model_clients.credentials import EnvironmentModelCredentialResolver
from animama.app.model_clients.error_categories import ERROR_UNREACHABLE, model_error_category
from animama.app.services.archive_service import ArchiveService
from animama.app.services.embedding_refresh_service import EmbeddingRefreshError, EmbeddingRefreshService
from animama.domain import ModelConnection, ModelProvider, ModelProviderCapabilities
from animama.domain.model_connection import MODEL_KIND_EMBEDDING
from animama.orm import ORMAnima
from animama.orm.archive import ORMArchive
from animama.orm.archive_passage import ORMArchivePassage
from animama.orm.user_file import ORMUserFile
from animama.orm.user_file_chunk import ORMUserFileChunk
from animama.server import embedding_refresh
from animama.server.embedding_refresh import EmbeddingRefreshWorker, embedding_refresh_status
from animama.server.model_roles import ModelRoleSettings

OLD_MODEL = "owner:old-embed"
NEW_MODEL = "owner:new-embed"


class _Embedder:
    """Deterministic vectors: one axis per keyword so similarity is predictable."""

    def __init__(self, model_id: str = NEW_MODEL, *, fail: Exception | None = None) -> None:
        self.model_id = model_id
        self.fail = fail
        self.inputs: list[list[str]] = []

    async def embed_texts(self, texts):  # noqa: ANN001
        batch = list(texts)
        self.inputs.append(batch)
        if self.fail is not None:
            raise self.fail
        return [_vector(text) for text in batch]


def _vector(text: str) -> list[float]:
    lowered = text.lower()
    return [
        1.0 if "moon" in lowered else 0.0,
        1.0 if "garden" in lowered else 0.0,
        0.1,
    ]


class _OversizedRejectingEmbedder(_Embedder):
    async def embed_texts(self, texts):  # noqa: ANN001
        batch = list(texts)
        self.inputs.append(batch)
        if any(len(text) > 40 for text in batch):
            raise ModelClientProviderError(
                "too long",
                code="openai_bad_request",
                raw_metadata={"provider_error_message": "input is too large to process"},
            )
        return [_vector(text) for text in batch]


async def _owner_with_file(session, owner_id: str, *, status: str = "ready", chunks: list[dict[str, Any]]) -> str:  # noqa: ANN001
    file_id = f"file-{uuid4().hex[:8]}"
    session.add(
        ORMUserFile(
            id=file_id,
            user_id=owner_id,
            storage_locator=f"users/{owner_id}/files/{file_id}/original.txt",
            original_filename="notes.txt",
            normalized_extension=".txt",
            declared_size_bytes=64,
            status=status,
            upload_expires_at=datetime.now(UTC) + timedelta(minutes=10),
            metadata_={},
        )
    )
    await session.flush()
    for index, chunk in enumerate(chunks):
        session.add(
            ORMUserFileChunk(
                id=f"chunk-{file_id}-{index:06d}",
                file_id=file_id,
                user_id=owner_id,
                chunk_index=index,
                char_count=len(chunk["text"]),
                token_estimate=1,
                metadata_={},
                **chunk,
            )
        )
    await session.commit()
    return file_id


async def _anima_archive(session, owner_id: str, passages: list[dict[str, Any]]) -> str:  # noqa: ANN001
    archive_id = f"archive-{uuid4().hex[:8]}"
    session.add(ORMArchive(id=archive_id, name="Archive"))
    await session.flush()
    session.add(ORMAnima(id=f"anima-{uuid4().hex[:8]}", user_id=owner_id, display_name="Mira", archive_id=archive_id))
    for passage in passages:
        session.add(ORMArchivePassage(archive_id=archive_id, metadata_={}, **passage))
    await session.commit()
    return archive_id


def _refresh(session, *, batch_size: int = 32) -> EmbeddingRefreshService:  # noqa: ANN001
    return EmbeddingRefreshService(
        store=SQLAlchemyEmbeddingRefreshRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        batch_size=batch_size,
    )


async def test_refresh_replaces_vectors_from_other_models_and_promotes_keyword_only_files(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    file_id = await _owner_with_file(
        async_session,
        owner_id,
        status="ready_keyword_only",
        chunks=[
            {
                "text": "Moon base",
                "embedding_text": "Habitat > Moon base",
                "embedding": [0.0, 1.0, 0.0],
                "embedding_model_id": OLD_MODEL,
            },
            {"text": "Garden rows"},
        ],
    )
    archive_id = await _anima_archive(async_session, owner_id, [{"text": "The garden is blooming"}])
    embedder = _Embedder()
    service = _refresh(async_session)

    before = await service.pending(owner_id=owner_id, embedding_model_id=NEW_MODEL)
    handled = [await service.refresh_batch(owner_id=owner_id, embedder=embedder) for _ in range(3)]
    after = await service.pending(owner_id=owner_id, embedding_model_id=NEW_MODEL)

    async_session.expire_all()
    chunks = (
        (
            await async_session.execute(
                select(ORMUserFileChunk)
                .where(ORMUserFileChunk.file_id == file_id)
                .order_by(ORMUserFileChunk.chunk_index)
            )
        )
        .scalars()
        .all()
    )
    passage = (
        await async_session.execute(select(ORMArchivePassage).where(ORMArchivePassage.archive_id == archive_id))
    ).scalar_one()
    stored_file = await async_session.get(ORMUserFile, file_id)

    assert (before.chunks, before.passages) == (2, 1)
    assert handled == [2, 1, 0]
    assert after.total == 0
    # The contextualized text is what gets embedded again.
    assert embedder.inputs[0] == ["Habitat > Moon base", "Garden rows"]
    assert [chunk.embedding_model_id for chunk in chunks] == [NEW_MODEL, NEW_MODEL]
    assert list(chunks[0].embedding) == pytest.approx([1.0, 0.0, 0.1])
    assert passage.embedding_model_id == NEW_MODEL
    assert stored_file is not None and stored_file.status == "ready"


async def test_refresh_skips_rows_whose_text_changed_after_they_were_read(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    file_id = await _owner_with_file(async_session, owner_id, chunks=[{"text": "Moon base"}])
    store = SQLAlchemyEmbeddingRefreshRepository(async_session)

    stale = await store.stale_chunks(owner_id=owner_id, embedding_model_id=NEW_MODEL, limit=10)
    await async_session.execute(
        update(ORMUserFileChunk).where(ORMUserFileChunk.file_id == file_id).values(text="Garden plan")
    )
    await store.store_chunk_vectors(embedding_model_id=NEW_MODEL, vectors=[(stale[0], [1.0, 0.0, 0.1])])
    await async_session.commit()

    counts = await store.count_stale(owner_id=owner_id, embedding_model_id=NEW_MODEL)
    assert counts.chunks == 1


async def test_text_too_long_for_the_model_is_recorded_without_a_vector(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    file_id = await _owner_with_file(
        async_session,
        owner_id,
        chunks=[{"text": "Moon base"}, {"text": "Garden " * 20}],
    )
    service = _refresh(async_session)

    handled = await service.refresh_batch(owner_id=owner_id, embedder=_OversizedRejectingEmbedder())

    async_session.expire_all()
    chunks = (
        (
            await async_session.execute(
                select(ORMUserFileChunk)
                .where(ORMUserFileChunk.file_id == file_id)
                .order_by(ORMUserFileChunk.chunk_index)
            )
        )
        .scalars()
        .all()
    )
    assert handled == 2
    assert chunks[0].embedding is not None
    assert (chunks[1].embedding, chunks[1].embedding_model_id) == (None, NEW_MODEL)
    assert (await service.pending(owner_id=owner_id, embedding_model_id=NEW_MODEL)).total == 0


async def test_refresh_fails_the_batch_for_connection_errors_and_short_answers(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    await _owner_with_file(async_session, owner_id, chunks=[{"text": "Moon base"}, {"text": "Garden rows"}])
    service = _refresh(async_session)

    class _Short(_Embedder):
        async def embed_texts(self, texts):  # noqa: ANN001
            return [[1.0, 0.0, 0.0]]

    with pytest.raises(ModelClientProviderError):
        await service.refresh_batch(
            owner_id=owner_id,
            embedder=_Embedder(fail=ModelClientProviderError("down", code="openai_connection_error")),
        )
    with pytest.raises(EmbeddingRefreshError):
        await service.refresh_batch(owner_id=owner_id, embedder=_Short())
    await async_session.rollback()

    assert (await service.pending(owner_id=owner_id, embedding_model_id=NEW_MODEL)).chunks == 2


async def test_worker_reports_retrying_until_a_pass_succeeds(async_session, async_session_factory, monkeypatch):
    owner_id = f"owner-{uuid4().hex[:8]}"
    await _owner_with_file(async_session, owner_id, chunks=[{"text": "Moon base"}])
    embedders = {"current": _Embedder(fail=ModelClientProviderError("down", code="openai_connection_error"))}

    async def _role_embedder(_session, user_id, _roles):  # noqa: ANN001
        return embedders["current"] if user_id == owner_id else None

    monkeypatch.setattr(embedding_refresh, "role_embedder", _role_embedder)
    worker = EmbeddingRefreshWorker(async_session_factory, roles=ModelRoleSettings(owner_roles_enabled=True))

    progressed, failed = await worker.refresh_once()
    failing = await embedding_refresh_status(
        async_session, owner_id=owner_id, embedding_model_id=NEW_MODEL, worker=worker
    )
    embedders["current"] = _Embedder()
    await worker.refresh_once()
    recovered = await embedding_refresh_status(
        async_session, owner_id=owner_id, embedding_model_id=NEW_MODEL, worker=worker
    )

    assert (progressed, failed) == (False, True)
    assert (failing.state, failing.pending, failing.error_category) == ("retrying", 1, ERROR_UNREACHABLE)
    assert (recovered.state, recovered.pending, recovered.error_category) == ("current", 0, None)


def _archive_service(session, embedder=None) -> ArchiveService:  # noqa: ANN001
    return ArchiveService(
        archives=SQLAlchemyArchiveRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        embedder=embedder,
    )


async def test_archive_passages_record_the_model_and_search_only_its_vectors(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    archive_id = await _anima_archive(async_session, owner_id, [])
    embedder = _Embedder()
    service = _archive_service(async_session, embedder)

    moon = await service.create_passage(archive_id=archive_id, text="We toured the moon base")
    await service.create_passage(archive_id=archive_id, text="The garden is blooming")
    results = await service.search_passages(query="moon", limit=5, threshold=0.5, archive_id=archive_id)
    edited = moon
    edited.text = "Our garden grows tomatoes"
    updated = await service.update_passage(passage=edited)

    assert moon.embedding_model_id == NEW_MODEL
    assert [result.text for result in results] == ["We toured the moon base"]
    assert updated.embedding_model_id == NEW_MODEL
    assert updated.embedding is not None
    assert list(updated.embedding) == pytest.approx([0.0, 1.0, 0.1])


async def test_archive_search_uses_full_text_when_embeddings_are_off_pending_or_failing(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    archive_id = await _anima_archive(
        async_session,
        owner_id,
        [
            {"text": "We toured the moon base", "embedding": [1.0, 0.0, 0.1], "embedding_model_id": OLD_MODEL},
            {"text": "The garden is blooming"},
        ],
    )

    off = await _archive_service(async_session).search_passages(query="garden", archive_id=archive_id)
    pending = await _archive_service(async_session, _Embedder()).search_passages(query="moon", archive_id=archive_id)
    failing_embedder = _Embedder(fail=ModelClientProviderError("down", code="openai_connection_error"))
    await _refresh(async_session).refresh_batch(owner_id=owner_id, embedder=_Embedder())
    failing = await _archive_service(async_session, failing_embedder).search_passages(
        query="garden", archive_id=archive_id
    )

    assert [passage.text for passage in off] == ["The garden is blooming"]
    # A pending archive is searched by text; old-model vectors are never compared.
    assert [passage.text for passage in pending] == ["We toured the moon base"]
    assert [passage.text for passage in failing] == ["The garden is blooming"]
    assert len(failing_embedder.inputs) == 1


def _embedding_row(connection: ModelConnection) -> ModelProvider:
    return ModelProvider(
        id="owner:embed",
        provider_type="OpenAIHTTPAgent",
        model="nomic-embed-text",
        model_label="nomic-embed-text",
        provider_label=connection.name,
        active=True,
        model_kind=MODEL_KIND_EMBEDDING,
        capabilities=ModelProviderCapabilities(accepts=["text"], produces=["embedding"]),
        connection_id=connection.id,
        connection=connection,
    )


@pytest.fixture
def scripted_embeddings(monkeypatch):  # noqa: ANN001
    requests: list[httpx.Request] = []
    responses: list[httpx.Response] = []
    original_init = AsyncOpenAI.__init__

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if responses:
            return responses.pop(0)
        body = json.loads(request.content)
        data = [{"object": "embedding", "index": i, "embedding": [0.5, float(i)]} for i in range(len(body["input"]))]
        return httpx.Response(200, json={"object": "list", "model": body["model"], "data": data})

    def _init(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        kwargs["http_client"] = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(AsyncOpenAI, "__init__", _init)
    return requests, responses


async def test_connection_embedder_sends_float_requests_with_only_the_connection_key(scripted_embeddings, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-process-openai")
    requests, _responses = scripted_embeddings
    local = ModelConnection(id="conn-ollama", name="Ollama", preset="ollama", base_url="http://127.0.0.1:11434/v1")
    embedder = ConnectionEmbedder(
        _embedding_row(local),
        credential_resolver=EnvironmentModelCredentialResolver(openai_api_key="sk-openai", environ={}),
        openai_base_url="http://127.0.0.1:9/v1",
        default_timeout_seconds=5.0,
    )

    vectors = await embedder.embed_texts(["a", "b"])

    body = json.loads(requests[0].content)
    assert vectors == [[0.5, 0.0], [0.5, 1.0]]
    assert embedder.model_id == "owner:embed"
    assert str(requests[0].url) == "http://127.0.0.1:11434/v1/embeddings"
    assert body == {"model": "nomic-embed-text", "input": ["a", "b"], "encoding_format": "float"}
    assert "authorization" not in requests[0].headers


async def test_connection_embedder_reports_neutral_error_categories(scripted_embeddings):
    _requests, responses = scripted_embeddings
    local = ModelConnection(
        id="conn-custom",
        name="Server",
        preset="custom",
        base_url="http://127.0.0.1:8080/v1",
        credential_env="ANIMAMA_CONNECTION_C1_API_KEY",
    )
    missing_key = ConnectionEmbedder(
        _embedding_row(local),
        credential_resolver=EnvironmentModelCredentialResolver(openai_api_key=None, environ={}),
        openai_base_url="http://127.0.0.1:9/v1",
        default_timeout_seconds=5.0,
    )
    keyed = ConnectionEmbedder(
        _embedding_row(local),
        credential_resolver=EnvironmentModelCredentialResolver(
            openai_api_key=None, environ={"ANIMAMA_CONNECTION_C1_API_KEY": "sk-local"}
        ),
        openai_base_url="http://127.0.0.1:9/v1",
        default_timeout_seconds=5.0,
    )
    # llama.cpp answers an input larger than its batch with HTTP 500; the SDK
    # retries server errors, so every attempt gets the same answer.
    oversized = {"error": {"message": "input is too large to process. increase the physical batch size"}}
    responses.extend(httpx.Response(500, headers={"retry-after-ms": "1"}, json=oversized) for _ in range(3))

    with pytest.raises(ModelClientProviderError) as missing:
        await missing_key.embed_texts(["a"])
    with pytest.raises(ModelClientProviderError) as too_long:
        await keyed.embed_texts(["a"])

    assert model_error_category(missing.value.code, missing.value.raw_metadata) == "credential_missing"
    assert model_error_category(too_long.value.code, too_long.value.raw_metadata) == "context_exceeded"
    # Messages name the connection and a neutral category, never an OpenAI code.
    assert str(too_long.value) == "The embeddings request to Server failed (context exceeded)"


class _RejectingEmbedder(_Embedder):
    """Rejects texts containing a marker, like a server refusing one input."""

    def __init__(self, marker: str, *, code: str = "openai_bad_request") -> None:
        super().__init__()
        self.marker = marker
        self.code = code

    async def embed_texts(self, texts):  # noqa: ANN001
        batch = list(texts)
        self.inputs.append(batch)
        if any(self.marker in text for text in batch):
            raise ModelClientProviderError("rejected", code=self.code, raw_metadata={"provider_error_message": "bad"})
        return [_vector(text) for text in batch]


async def test_a_rejected_text_is_isolated_but_a_batch_that_always_fails_is_retried(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    file_id = await _owner_with_file(
        async_session,
        owner_id,
        chunks=[{"text": "Moon base"}, {"text": "REJECT me"}, {"text": "   "}, {"text": "Garden rows"}],
    )
    service = _refresh(async_session)

    handled = await service.refresh_batch(owner_id=owner_id, embedder=_RejectingEmbedder("REJECT"))

    async_session.expire_all()
    chunks = (
        (
            await async_session.execute(
                select(ORMUserFileChunk)
                .where(ORMUserFileChunk.file_id == file_id)
                .order_by(ORMUserFileChunk.chunk_index)
            )
        )
        .scalars()
        .all()
    )
    assert handled == 4
    assert [chunk.embedding is not None for chunk in chunks] == [True, False, False, True]
    assert {chunk.embedding_model_id for chunk in chunks} == {NEW_MODEL}

    other_owner = f"owner-{uuid4().hex[:8]}"
    await _owner_with_file(async_session, other_owner, chunks=[{"text": "REJECT a"}, {"text": "REJECT b"}])
    with pytest.raises(ModelClientProviderError):
        await service.refresh_batch(
            owner_id=other_owner, embedder=_RejectingEmbedder("REJECT", code="openai_server_error")
        )
    await async_session.rollback()
    assert (await service.pending(owner_id=other_owner, embedding_model_id=NEW_MODEL)).chunks == 2


async def _refresh_until_recorded(service, owner_id: str, embedder) -> list[int | str]:  # noqa: ANN001
    """Run passes until one succeeds, returning each failed pass's category or the handled count."""

    outcomes: list[int | str] = []
    for _ in range(5):
        try:
            outcomes.append(await service.refresh_batch(owner_id=owner_id, embedder=embedder))
            return outcomes
        except ModelClientProviderError as exc:
            outcomes.append(model_error_category(exc.code, exc.raw_metadata))
    return outcomes


async def test_a_chunk_the_model_always_rejects_is_recorded_after_three_isolated_failures(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    file_id = await _owner_with_file(async_session, owner_id, chunks=[{"text": "Moon base"}, {"text": "REJECT me"}])
    service = _refresh(async_session, batch_size=1)
    embedder = _RejectingEmbedder("REJECT")
    assert await service.refresh_batch(owner_id=owner_id, embedder=embedder) == 1

    outcomes = await _refresh_until_recorded(service, owner_id, embedder)

    # Rejected alone twice (the role reports retrying), then recorded without a vector.
    assert outcomes == ["bad_request", "bad_request", 1]
    assert (await service.pending(owner_id=owner_id, embedding_model_id=NEW_MODEL)).total == 0
    rejected = (
        await async_session.execute(
            select(ORMUserFileChunk).where(ORMUserFileChunk.file_id == file_id, ORMUserFileChunk.chunk_index == 1)
        )
    ).scalar_one()
    assert rejected.embedding is None
    assert rejected.embedding_model_id == NEW_MODEL


async def test_a_passage_the_model_always_rejects_is_recorded_after_three_isolated_failures(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    await _anima_archive(async_session, owner_id, [{"text": "Garden rows"}, {"text": "REJECT this"}])
    service = _refresh(async_session, batch_size=1)
    embedder = _RejectingEmbedder("REJECT", code="openai_unknown_failure")
    assert await service.refresh_batch(owner_id=owner_id, embedder=embedder) == 1

    outcomes = await _refresh_until_recorded(service, owner_id, embedder)

    assert outcomes == ["provider_error", "provider_error", 1]
    assert (await service.pending(owner_id=owner_id, embedding_model_id=NEW_MODEL)).total == 0


async def test_a_rejected_chunk_is_recorded_even_before_the_model_embedded_anything(async_session):
    # The only stale chunk must not block re-embedding (or the passages behind it).
    owner_id = f"owner-{uuid4().hex[:8]}"
    await _owner_with_file(async_session, owner_id, chunks=[{"text": "REJECT me"}])
    await _anima_archive(async_session, owner_id, [{"text": "Garden rows"}])
    service = _refresh(async_session)
    embedder = _RejectingEmbedder("REJECT")

    outcomes = await _refresh_until_recorded(service, owner_id, embedder)

    assert outcomes == ["bad_request", "bad_request", 1]
    assert await service.refresh_batch(owner_id=owner_id, embedder=embedder) == 1
    assert (await service.pending(owner_id=owner_id, embedding_model_id=NEW_MODEL)).total == 0


async def test_rejections_are_not_counted_while_the_model_rejects_everything(async_session):
    # A model that refuses every text, including a known check text, is broken or
    # misconfigured; recording would drop every vector.
    owner_id = f"owner-{uuid4().hex[:8]}"
    await _owner_with_file(async_session, owner_id, chunks=[{"text": "Moon base"}, {"text": "Garden rows"}])
    service = _refresh(async_session, batch_size=1)
    embedder = _RejectingEmbedder("")

    outcomes = await _refresh_until_recorded(service, owner_id, embedder)

    assert outcomes == ["bad_request"] * 5
    assert (await service.pending(owner_id=owner_id, embedding_model_id=NEW_MODEL)).chunks == 2


async def test_an_outage_after_progress_does_not_drop_vectors(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    await _owner_with_file(
        async_session, owner_id, chunks=[{"text": "Moon base"}, {"text": "Garden rows"}, {"text": "Moon garden"}]
    )
    service = _refresh(async_session, batch_size=1)
    assert await service.refresh_batch(owner_id=owner_id, embedder=_Embedder()) == 1

    outage = _RejectingEmbedder("", code="openai_unknown_failure")
    outcomes = await _refresh_until_recorded(service, owner_id, outage)

    assert outcomes == ["provider_error"] * 5
    assert (await service.pending(owner_id=owner_id, embedding_model_id=NEW_MODEL)).chunks == 2


async def test_rejections_by_another_model_do_not_count_toward_recording(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    await _owner_with_file(async_session, owner_id, chunks=[{"text": "Moon base"}, {"text": "REJECT me"}])
    service = _refresh(async_session, batch_size=1)
    first = _RejectingEmbedder("REJECT")
    first.model_id = OLD_MODEL
    assert await service.refresh_batch(owner_id=owner_id, embedder=first) == 1
    for _ in range(2):
        with pytest.raises(ModelClientProviderError):
            await service.refresh_batch(owner_id=owner_id, embedder=first)

    second = _RejectingEmbedder("REJECT")
    assert await service.refresh_batch(owner_id=owner_id, embedder=second) == 1
    outcomes = await _refresh_until_recorded(service, owner_id, second)

    assert outcomes == ["bad_request", "bad_request", 1]


async def test_vectors_are_not_stored_when_the_embedded_text_changed(async_session):
    owner_id = f"owner-{uuid4().hex[:8]}"
    file_id = await _owner_with_file(
        async_session, owner_id, chunks=[{"text": "Moon base", "embedding_text": "Old > Moon base"}]
    )
    store = SQLAlchemyEmbeddingRefreshRepository(async_session)

    stale = await store.stale_chunks(owner_id=owner_id, embedding_model_id=NEW_MODEL, limit=10)
    await async_session.execute(
        update(ORMUserFileChunk).where(ORMUserFileChunk.file_id == file_id).values(embedding_text="New > Moon base")
    )
    await store.store_chunk_vectors(embedding_model_id=NEW_MODEL, vectors=[(stale[0], [1.0, 0.0, 0.1])])
    await async_session.commit()

    assert stale[0].embedding_input == "Old > Moon base"
    assert (await store.count_stale(owner_id=owner_id, embedding_model_id=NEW_MODEL)).chunks == 1


def test_llama_cpp_oversized_input_errors_are_context_exceeded():
    oversized = {"provider_error_message": "input is too large to process. increase the physical batch size"}

    assert model_error_category("openai_server_error", oversized) == "context_exceeded"
    assert model_error_category("openai_server_error", {"provider_error_message": "failed to load model"}) == (
        "server_error"
    )
