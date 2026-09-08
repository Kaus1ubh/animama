"""Runtime chat persistence service for direct avatar chat."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ...domain.chat import Chat, ChatContext, ChatMessage, MessageRole
from ...domain.usage import Usage
from ...logging import get_logger
from ..ports import UnitOfWork
from ..ports.chat_compaction_port import ChatCompactionRepository
from ..ports.chat_message_port import ChatMessageRepository
from ..ports.chat_port import ChatRepository
from ..util.json_values import json_safe_copy


def _active_context_tokens_from_usage(usage: Usage | None) -> int:
    """Return the latest-turn token footprint that will remain in next-turn context."""

    if usage is None:
        return 0
    reasoning_tokens = int(getattr(usage.output_tokens_details, "reasoning_tokens", 0) or 0)
    return max(0, int(usage.total_tokens or 0) - reasoning_tokens)


_OPENAI_RESPONSES_PROVIDER = "OpenAIResponsesHTTPAgent"
CHAT_API_STANDARD_MISMATCH_CODE = "chat_api_standard_mismatch"
CHAT_API_STANDARD_MISMATCH_ACTION = "start_new_chat"


class ChatApiStandardConflictError(RuntimeError):
    """Raised when a direct chat request would mix incompatible API standards."""

    def __init__(
        self,
        *,
        chat_id: str,
        chat_api_standard: str | None,
        requested_api_standard: str,
        requested_model_provider_id: str,
    ) -> None:
        self.chat_id = chat_id
        self.chat_api_standard = chat_api_standard
        self.requested_api_standard = requested_api_standard
        self.requested_model_provider_id = requested_model_provider_id
        super().__init__(CHAT_API_STANDARD_MISMATCH_CODE)

    @property
    def detail(self) -> dict[str, str | None]:
        return {
            "code": CHAT_API_STANDARD_MISMATCH_CODE,
            "chat_id": self.chat_id,
            "chat_api_standard": self.chat_api_standard,
            "requested_api_standard": self.requested_api_standard,
            "requested_model_provider_id": self.requested_model_provider_id,
            "action": CHAT_API_STANDARD_MISMATCH_ACTION,
        }


def _openai_responses_cursor_from_message(message: ChatMessage) -> str | None:
    if message.role is not MessageRole.ASSISTANT or not isinstance(message.data, Mapping):
        return None
    openai = message.data.get("openai")
    if not isinstance(openai, Mapping):
        return None
    if openai.get("provider") != _OPENAI_RESPONSES_PROVIDER:
        return None
    response_id = openai.get("response_id")
    if not isinstance(response_id, str):
        return None
    response_id = response_id.strip()
    return response_id or None


def _openai_responses_cursor_from_messages(messages: Sequence[ChatMessage]) -> str | None:
    cursor: str | None = None
    for message in messages:
        cursor = _openai_responses_cursor_from_message(message) or cursor
    return cursor


def _enrich_chat_metadata_patch(
    metadata_patch: Mapping[str, Any],
    *,
    messages: Sequence[ChatMessage],
) -> dict[str, Any]:
    patch = json_safe_copy(metadata_patch)
    if not isinstance(patch, dict):
        return {}
    memory_context = patch.get("memory_context")
    if isinstance(memory_context, dict):
        memory_context["last_messages"] = [
            {
                "role": message.role.value if isinstance(message.role, MessageRole) else str(message.role or ""),
                "run_id": message.run_id,
                "turn": message.turn,
                "internal": bool(message.internal),
            }
            for message in messages
        ]
    return patch


class ChatManager:
    """Owns request-local chat history, message writes, and chat usage totals."""

    def __init__(
        self,
        *,
        chats: ChatRepository,
        messages: ChatMessageRepository,
        uow: UnitOfWork,
        compactions: ChatCompactionRepository | None = None,
        history_limit: int | None = 200,
    ) -> None:
        self._chats = chats
        self._messages = messages
        self._uow = uow
        self._compactions = compactions
        self._history_limit = history_limit
        self._log = get_logger("app.services.chat_manager")

    async def ensure_owned_chat(
        self,
        *,
        anima_id: str,
        chat_id: str,
        user_id: str,
        api_standard: str | None = None,
        model_provider_id: str | None = None,
    ) -> Chat:
        """Return an existing owned chat or create it for this anima/user."""

        standard_requested = any(value is not None for value in (api_standard, model_provider_id))
        if standard_requested and not (api_standard and model_provider_id):
            raise ValueError("api_standard and model_provider_id must be provided together")

        chat = await self._chats.get(chat_id)
        if chat is None:
            created = await self._chats.create(
                Chat(
                    id=chat_id,
                    anima_id=anima_id,
                    user_id=user_id,
                    api_standard=api_standard,
                )
            )
            await self._uow.commit()
            self._log.info(
                "ChatManager created chat",
                chat_id=chat_id,
                anima_id=anima_id,
                user_id=user_id,
                api_standard=api_standard,
            )
            return created
        if chat.user_id != user_id or chat.anima_id != anima_id:
            raise PermissionError("chat not found")
        if standard_requested:
            assert api_standard is not None
            assert model_provider_id is not None
            chat = await self._chats.initialize_or_validate_api_standard(
                chat_id,
                api_standard=api_standard,
            )
            if chat is None or chat.user_id != user_id or chat.anima_id != anima_id:
                await self._uow.rollback()
                raise PermissionError("chat not found")
            if chat.api_standard != api_standard:
                await self._uow.rollback()
                raise ChatApiStandardConflictError(
                    chat_id=chat_id,
                    chat_api_standard=chat.api_standard,
                    requested_api_standard=api_standard,
                    requested_model_provider_id=model_provider_id,
                )
            await self._uow.commit()
        return chat

    async def prepare_chat_context(self, *, anima_id: str, chat_id: str, user_id: str) -> tuple[Chat, ChatContext]:
        """Return the owned chat and model replay context for the next turn."""

        chat = await self.ensure_owned_chat(anima_id=anima_id, chat_id=chat_id, user_id=user_id)
        context = await self.get_chat_context(chat_id=chat_id)
        return chat, context

    async def set_title_if_blank(
        self,
        *,
        chat_id: str,
        user_id: str,
        title: str,
        metadata_patch: dict[str, Any] | None = None,
    ) -> Chat | None:
        """Persist a generated title only while the chat still has no title."""

        try:
            chat = await self._chats.set_title_if_blank(
                chat_id=chat_id,
                user_id=user_id,
                title=title,
                metadata_patch=metadata_patch,
            )
            if chat is not None:
                await self._uow.commit()
            return chat
        except Exception:
            await self._uow.rollback()
            raise

    async def openai_previous_response_id(self, chat_id: str) -> str | None:
        """Return the durable OpenAI Responses cursor for a chat."""

        chat = await self._chats.get(chat_id)
        return chat.openai_previous_response_id if chat is not None else None

    async def get_chat_context(
        self,
        *,
        chat_id: str,
    ) -> ChatContext:
        """Fetch replayable chat history and active compaction for a model turn."""

        limit = self._history_limit if self._history_limit is not None else 200
        active_compaction = None
        if self._compactions is not None:
            candidate = await self._compactions.get_active(chat_id)
            summary_text = getattr(candidate, "summary_text", None)
            end_turn = getattr(candidate, "end_turn", None)
            if (
                candidate is not None
                and isinstance(summary_text, str)
                and summary_text.strip()
                and isinstance(end_turn, int)
            ):
                active_compaction = candidate

        if active_compaction is not None and active_compaction.end_turn is not None:
            messages = await self._messages.recent_model_history(
                chat_id,
                after_turn=active_compaction.end_turn,
                limit=limit,
            )
        else:
            messages = await self._messages.recent_model_history(chat_id, limit=limit)

        self._log.info(
            "Chat context fetched",
            chat_id=chat_id,
            message_count=len(messages),
            active_compaction_id=getattr(active_compaction, "id", None),
        )
        return ChatContext(messages=list(messages), active_compaction=active_compaction)

    async def record_turn(
        self,
        *,
        anima_id: str,
        chat_id: str,
        user_msg: ChatMessage,
        assistant_msg: ChatMessage | Sequence[ChatMessage],
        chat_metadata_patch: dict[str, Any] | None = None,
        last_model_client: str | None = None,
        last_model_id: str | None = None,
    ) -> tuple[ChatMessage | None, ChatMessage | Sequence[ChatMessage] | None, Usage | None]:
        """Persist one user/assistant turn and increment chat usage totals."""

        _ = anima_id
        if (last_model_client is None) != (last_model_id is None):
            raise ValueError("last_model_client and last_model_id must be provided together")
        if isinstance(assistant_msg, ChatMessage):
            assistant_messages = [assistant_msg]
        else:
            assistant_messages = [message for message in assistant_msg if isinstance(message, ChatMessage)]

        usage_total = Usage()
        has_usage = False
        latest_usage: Usage | None = None
        for message in assistant_messages:
            if message.usage is not None:
                usage_total.add(message.usage)
                latest_usage = message.usage
                has_usage = True
        openai_previous_response_id = _openai_responses_cursor_from_messages(assistant_messages)
        clear_openai_previous_response_id = bool(assistant_messages) and openai_previous_response_id is None

        # Reserve turns from the exact final list we will persist. The list
        # order is the durable order: user row first, then assistant rows in
        # runner-provided order.
        messages_to_persist = [user_msg, *assistant_messages]
        first_turn, _updated_usage = await self._chats.reserve_message_turns_and_add_usage(
            chat_id,
            message_count=len(messages_to_persist),
            usage=usage_total if has_usage else None,
            active_context_tokens=_active_context_tokens_from_usage(latest_usage) if has_usage else None,
            openai_previous_response_id=openai_previous_response_id,
            clear_openai_previous_response_id=clear_openai_previous_response_id,
            last_model_client=last_model_client,
            last_model_id=last_model_id,
        )
        if first_turn < 1:
            raise RuntimeError("failed to reserve chat message turns")
        for offset, message in enumerate(messages_to_persist):
            message.turn = first_turn + offset

        if chat_metadata_patch:
            enriched_patch = _enrich_chat_metadata_patch(
                chat_metadata_patch,
                messages=messages_to_persist,
            )
            if not await self._chats.merge_metadata(chat_id, enriched_patch):
                await self._uow.rollback()
                raise RuntimeError("failed to update chat metadata")

        persisted_messages = await self._messages.append_many(messages_to_persist)
        # The repository should persist the same batch without dropping,
        # expanding, or reordering rows after the turn range is reserved.
        expected_turns = [message.turn for message in messages_to_persist]
        persisted_turns = [message.turn for message in persisted_messages]
        if len(persisted_messages) != len(messages_to_persist) or persisted_turns != expected_turns:
            await self._uow.rollback()
            raise RuntimeError("chat message persistence did not preserve reserved turn range")
        await self._uow.commit()

        persisted_user = persisted_messages[0] if persisted_messages else None
        persisted_assistant_messages = persisted_messages[1:]
        persisted_assistant: ChatMessage | Sequence[ChatMessage] | None
        if isinstance(assistant_msg, ChatMessage):
            persisted_assistant = persisted_assistant_messages[0] if persisted_assistant_messages else None
        else:
            persisted_assistant = persisted_assistant_messages

        self._log.info("Chat turn recorded", chat_id=chat_id, assistant_message_count=len(assistant_messages))
        return persisted_user, persisted_assistant, usage_total if has_usage else None


__all__ = ["CHAT_API_STANDARD_MISMATCH_CODE", "ChatApiStandardConflictError", "ChatManager"]
