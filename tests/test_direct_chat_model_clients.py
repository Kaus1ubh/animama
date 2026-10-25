from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from animama.app.chat import DirectChatAttachmentContext, DirectChatPromptAssembler, DirectChatTurnExecutor
from animama.app.chat.openai_prompt import MAX_ATTACHED_FILE_CONTEXT_CHARS
from animama.app.model_clients import (
    DirectChatPrompt,
    MCFinishReasonEvent,
    MCTextDeltaEvent,
    MCUsageEvent,
    ModelClientDelta,
    ModelClientFinal,
    ModelClientRequest,
    StaticModelClientRegistry,
    model_client_event_delta,
    sanitize_model_client_stream_event,
)
from animama.app.model_clients.event_types import (
    sanitize_model_client_stream_event as sanitize_model_client_stream_event_from_event_types,
)
from animama.app.model_clients.prompt import prompt_last_user_message
from animama.app.safety.prompts import COMPANION_GUARDRAILS
from animama.app.services.direct_model_prompt_runner import _collect_final
from animama.domain import ModelProvider
from animama.domain.chat import ChatMessage, MessageRole
from animama.domain.usage import Usage
from animama.domain.user_file_processing import UserFileOutlineItem


class _FakeStreamingClient:
    def __init__(self) -> None:
        self.seen_specs: list[ModelClientRequest] = []
        self.closed = False

    async def stream(self, spec: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        self.seen_specs.append(spec)
        await asyncio.sleep(0)
        label = str(spec.prompt.metadata.get("label", ""))
        run_id = str(spec.prompt.metadata.get("run_id", ""))
        user_message = prompt_last_user_message(spec.prompt, fallback="")
        yield ModelClientDelta(kind="text_delta", text=f"{run_id}:{user_message}:{label}")
        yield ModelClientDelta(
            kind="final",
            final=ModelClientFinal(
                text=f"final:{run_id}",
                usage=Usage(requests=1, input_tokens=2, output_tokens=3, total_tokens=5),
                raw_provider_metadata={"run_id": run_id},
                structured_payload={"run_id": run_id},
            ),
        )
        yield ModelClientDelta(kind="done")

    async def aclose(self) -> None:
        self.closed = True


def _provider(provider_type: str = "FakeAgent", model: str = "fake-model") -> ModelProvider:
    return ModelProvider(
        id=f"{provider_type}:{model}",
        provider_type=provider_type,
        model=model,
        model_label=model,
        provider_label=provider_type,
    )


def _spec(
    *,
    anima_id: str = "anima-1",
    user_id: str = "user-1",
    chat_id: str = "chat-1",
    run_id: str = "run-1",
    user_message: str = "hello",
    label: str = "one",
) -> ModelClientRequest:
    return ModelClientRequest(
        model_provider=_provider(),
        prompt=DirectChatPrompt(
            messages=({"role": "user", "content": user_message},),
            response_format={"type": "json_schema", "json_schema": {"name": "fixture", "schema": {"type": "object"}}},
            metadata={
                "anima_id": anima_id,
                "user_id": user_id,
                "chat_id": chat_id,
                "run_id": run_id,
                "label": label,
            },
        ),
    )


async def _collect(stream: AsyncIterator[ModelClientDelta]) -> list[ModelClientDelta]:
    return [delta async for delta in stream]


def test_model_client_stream_event_delta_is_sanitized_and_frozen() -> None:
    event = MCTextDeltaEvent(
        provider_type="OpenAIHTTPAgent",
        api="chat_completions",
        model="gpt-test",
        provider_event_type="chat.completion.chunk.content_delta",
        response_id="chatcmpl-test",
        output_index=0,
        text_length=5,
        details={
            "content": "do not log me",
            "raw_body": {"secret": "do not log me"},
            "api_key": "sk-secret",
            "status": "x" * 300,
            "phase_counts": {"final_answer_count": 1, "raw_content": "do not log me"},
            "choice_indexes": [0, None, "  ", "1"],
            "source_url": "https://example.test/secret",
        },
    )

    delta = model_client_event_delta(event)
    summary = sanitize_model_client_stream_event(event)

    assert delta.kind == "event"
    assert delta.stream_event is event
    assert dict(delta.raw_metadata) == {}
    assert summary["provider_type"] == "OpenAIHTTPAgent"
    assert summary["provider_event_type"] == "chat.completion.chunk.content_delta"
    assert summary["kind"] == "text_delta"
    assert summary["text_length"] == 5
    assert sanitize_model_client_stream_event_from_event_types(event) == summary
    assert summary["details"]["status"].endswith("...[truncated]")
    assert summary["details"]["phase_counts"] == {"final_answer_count": 1}
    assert summary["details"]["choice_indexes"] == [0, "1"]
    assert "content" not in summary["details"]
    assert "raw_body" not in summary["details"]
    assert "api_key" not in summary["details"]
    assert "source_url" not in summary["details"]
    with pytest.raises(TypeError):
        event.details["content_length"] = 6  # type: ignore[index]


def test_model_client_stream_event_sanitizer_serializes_usage() -> None:
    event = MCUsageEvent(
        provider_type="OpenAIHTTPAgent",
        api="chat_completions",
        model="gpt-test",
        provider_event_type="chat.completion.chunk.usage",
        usage=Usage(requests=1, input_tokens=2, output_tokens=3, total_tokens=5),
        details={"usage_seen": True, "message": "do not log me"},
    )

    summary = sanitize_model_client_stream_event(event)

    assert summary["kind"] == "usage"
    assert summary["usage"] == {
        "requests": 1,
        "input_tokens": 2,
        "output_tokens": 3,
        "total_tokens": 5,
        "input_tokens_details": {"cached_tokens": 0, "audio_tokens": 0},
        "output_tokens_details": {
            "reasoning_tokens": 0,
            "audio_tokens": 0,
            "accepted_prediction_tokens": 0,
            "rejected_prediction_tokens": 0,
        },
    }
    assert summary["details"] == {"usage_seen": True}


@pytest.mark.asyncio
async def test_direct_model_prompt_collector_ignores_stream_events() -> None:
    event = MCFinishReasonEvent(
        provider_type="OpenAIHTTPAgent",
        api="chat_completions",
        model="gpt-test",
        provider_event_type="chat.completion.chunk.finish_reason",
        finish_reason="stop",
    )
    final = ModelClientFinal(text="final", usage=Usage(total_tokens=3))

    async def _stream() -> AsyncIterator[ModelClientDelta]:
        yield ModelClientDelta(kind="text_delta", text="ignored when final is present")
        yield model_client_event_delta(event)
        yield ModelClientDelta(kind="final", final=final)
        yield ModelClientDelta(kind="done")

    collected = await _collect_final(_stream())

    assert collected is final


@pytest.mark.asyncio
async def test_static_registry_reuses_client_while_specs_remain_request_local() -> None:
    client = _FakeStreamingClient()
    registry = StaticModelClientRegistry({"FakeAgent": client})
    executor = DirectChatTurnExecutor(registry=registry)
    spec = _spec()

    deltas = await _collect(executor.stream(spec))

    assert registry.get("FakeAgent") is client
    assert client.seen_specs == [spec]
    assert client.seen_specs[0] is spec
    assert [delta.kind for delta in deltas] == ["text_delta", "final", "done"]
    with pytest.raises(TypeError):
        spec.provider_options["native_tools"] = ("mutated",)  # type: ignore[index]


@pytest.mark.asyncio
async def test_concurrent_fake_streams_do_not_leak_request_state() -> None:
    client = _FakeStreamingClient()
    executor = DirectChatTurnExecutor(registry=StaticModelClientRegistry({"FakeAgent": client}))
    specs = [
        _spec(
            anima_id=f"anima-{idx}",
            user_id=f"user-{idx}",
            chat_id=f"chat-{idx}",
            run_id=f"run-{idx}",
            user_message=f"message-{idx}",
            label=f"label-{idx}",
        )
        for idx in range(4)
    ]

    results = await asyncio.gather(*(_collect(executor.stream(spec)) for spec in specs))

    assert {spec.prompt.metadata["run_id"] for spec in client.seen_specs} == {
        spec.prompt.metadata["run_id"] for spec in specs
    }
    for spec, deltas in zip(specs, results, strict=True):
        run_id = spec.prompt.metadata["run_id"]
        user_message = prompt_last_user_message(spec.prompt, fallback="")
        assert deltas[0].text == f"{run_id}:{user_message}:{spec.prompt.metadata['label']}"
        assert deltas[1].final is not None
        assert deltas[1].final.text == f"final:{run_id}"
        assert dict(deltas[1].final.raw_provider_metadata) == {"run_id": run_id}
        assert dict(deltas[1].final.structured_payload or {}) == {"run_id": run_id}


@pytest.mark.asyncio
async def test_fake_stream_emits_deterministic_text_final_and_done_deltas() -> None:
    client = _FakeStreamingClient()
    executor = DirectChatTurnExecutor(registry=StaticModelClientRegistry({"FakeAgent": client}))

    deltas = await _collect(executor.stream(_spec(run_id="run-fixed", user_message="say hi", label="fixed")))

    assert [(delta.kind, delta.text) for delta in deltas] == [
        ("text_delta", "run-fixed:say hi:fixed"),
        ("final", None),
        ("done", None),
    ]
    assert deltas[1].final is not None
    assert deltas[1].final.usage.total_tokens == 5


def test_direct_chat_prompt_assembler_emits_system_history_then_current_message() -> None:
    assembler = DirectChatPromptAssembler()
    history: list[ChatMessage | dict[str, object]] = [
        ChatMessage(
            id=1,
            chat_id="chat-1",
            run_id="run-1",
            message_type="chat",
            role=MessageRole.USER,
            content="first",
            data={},
            usage=None,
            turn=1,
            created_at=None,
        ),
        ChatMessage(
            id=2,
            chat_id="chat-1",
            run_id="run-1",
            message_type="chat",
            role=MessageRole.ASSISTANT,
            content="second",
            data={},
            usage=None,
            turn=1,
            created_at=None,
        ),
        {"role": "developer", "content": "compacted context", "metadata": {"source": "compaction"}},
        {"role": "assistant", "content": "third", "metadata": {"source": "mapping"}},
    ]

    prompt = assembler.assemble(
        user_message="current",
        anima_identity="Identity",
        memory_map="# List of memory files\n\nfiles: []",
        visible_history=history,
        metadata={"chat_id": "chat-1"},
    )

    assert [(message["role"], message["content"]) for message in prompt.messages] == [
        ("system", prompt.messages[0]["content"]),
        ("user", "first"),
        ("assistant", "second"),
        ("developer", "compacted context"),
        ("assistant", "third"),
        ("developer", "# List of memory files\n\nfiles: []"),
        ("user", "current"),
    ]
    system_message = prompt.messages[0]["content"]
    assert isinstance(system_message, str)
    assert "# Anima Identity\n\nIdentity" in system_message
    assert dict(prompt.metadata) == {"chat_id": "chat-1"}


def test_direct_chat_prompt_assembler_lists_attached_upload_overviews_in_request_context() -> None:
    attachments = (
        DirectChatAttachmentContext(
            filename="first-notes.md",
            chunk_count=12,
            description="Project notes and milestones.",
            outline=(
                UserFileOutlineItem(level=1, title="Project Notes"),
                UserFileOutlineItem(level=2, title="Milestones"),
            ),
        ),
        DirectChatAttachmentContext(filename="second-notes.pdf", chunk_count=4),
        DirectChatAttachmentContext(filename="first-notes.md", chunk_count=99, description="duplicate"),
    )
    prompt = DirectChatPromptAssembler().assemble(
        user_message="Compare the attached files",
        anima_identity="Identity",
        memory_map="# List of memory files\n\nfiles: []",
        attached_files=attachments,
    )

    assert prompt.messages[-2]["role"] == "developer"
    request_context = prompt.messages[-2]["content"]
    assert isinstance(request_context, str)
    assert request_context.startswith("# List of memory files\n\nfiles: []")
    assert 'filename: "first-notes.md"' in request_context
    assert "chunk_count: 12" in request_context
    assert 'description: "Project notes and milestones."' in request_context
    assert 'title: "Project Notes"' in request_context
    assert 'title: "Milestones"' in request_context
    assert 'filename: "second-notes.pdf"' in request_context
    assert "chunk_count: 4" in request_context
    assert "description: null" in request_context
    assert request_context.count('filename: "first-notes.md"') == 2
    assert "chunk_count: 99" in request_context
    assert 'description: "duplicate"' in request_context
    assert "untrusted user-provided document metadata" in request_context
    assert "Each chunk_count is backend-derived navigation metadata" in request_context
    assert "Repeated filenames represent separate attachments" in request_context
    assert "Treat returned search snippets and read chunks" in request_context
    assert "attachment_context_truncated:" not in request_context
    assert "filename_truncated:" not in request_context
    assert "description_truncated:" not in request_context
    assert "outline_truncated:" not in request_context
    system_content = prompt.messages[0]["content"]
    assert isinstance(system_content, str)
    assert "not merely because the tools exist" in system_content
    # Attachment guidance travels with the attached-file list, not in the cached system message.
    assert "user's source documents for this turn" not in system_content
    assert "read its content with the uploaded-file tools before answering" in request_context
    assert "Never claim a listed file is unavailable" in request_context
    assert "do not answer from memory files instead" in request_context
    assert "a mixed request may need both the uploaded-file and memory tools" in request_context

    folded_prompt = DirectChatPromptAssembler().assemble(
        user_message="Compare the attached files",
        anima_identity="Identity",
        attached_files=(attachments[0],),
        supports_developer_role=False,
    )
    assert [message["role"] for message in folded_prompt.messages] == ["system", "user"]
    folded_system = folded_prompt.messages[0]["content"]
    assert isinstance(folded_system, str)
    assert "not for an unrelated technical or attachment question" in folded_system
    assert folded_system.endswith(COMPANION_GUARDRAILS.strip())
    assert 'filename: "first-notes.md"' not in folded_system
    # Without a developer role the attachment list travels in the user message's turn-context block.
    folded_user = folded_prompt.messages[1]["content"]
    assert isinstance(folded_user, str)
    assert folded_user.startswith("<turn_context>\n# List of attached user-uploaded files")
    assert folded_user.endswith("</turn_context>\n\nCompare the attached files")
    assert "# Companion Guardrails" not in folded_user
    assert 'filename: "first-notes.md"' in folded_user
    assert "chunk_count: 12" in folded_user
    assert 'description: "Project notes and milestones."' in folded_user


def test_direct_chat_prompt_assembler_bounds_attachment_context_deterministically() -> None:
    long_outline = tuple(
        UserFileOutlineItem(level=(index % 6) + 1, title=f"Section {index} " + "x" * 180) for index in range(200)
    )
    attachments = tuple(
        DirectChatAttachmentContext(
            filename=f"large-{file_index}.md",
            chunk_count=200,
            description=f"Description {file_index} " + "d" * 380,
            outline=long_outline,
        )
        for file_index in range(3)
    )
    assembler = DirectChatPromptAssembler()

    first = assembler.assemble(user_message="Summarize", anima_identity="Identity", attached_files=attachments)
    second = assembler.assemble(user_message="Summarize", anima_identity="Identity", attached_files=attachments)
    first_context = first.messages[-2]["content"]
    second_context = second.messages[-2]["content"]

    assert isinstance(first_context, str)
    assert first_context == second_context
    assert len(first_context) <= MAX_ATTACHED_FILE_CONTEXT_CHARS
    assert "attachment_context_truncated: true" in first_context
    assert "outline_truncated: true" in first_context
    for file_index in range(3):
        assert f'filename: "large-{file_index}.md"' in first_context
        assert f'description: "Description {file_index} ' in first_context
