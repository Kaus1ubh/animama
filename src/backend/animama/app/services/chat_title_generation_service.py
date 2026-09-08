"""Hidden backend service for first-turn chat title generation."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

from animama.domain.usage import Usage
from animama.logging import get_logger

from .direct_model_prompt_runner import DirectModelPromptRequest, DirectModelPromptRunner

CHAT_TITLE_AGENT_ID = "backend-chat-title-generator"
DEFAULT_CHAT_TITLE_MAX_CHARS = 48
DEFAULT_AUXILIARY_MODEL_PROVIDER = "OpenAIHTTPAgent"
DEFAULT_CHAT_TITLE_TIMEOUT_SECONDS = 10.0
DEFAULT_CHAT_TITLE_REASONING_EFFORT = "minimal"


@dataclass(frozen=True, slots=True)
class ChatTitleGenerationSettings:
    """Configuration for hidden direct-chat title generation."""

    enabled: bool = True
    model_provider: str = DEFAULT_AUXILIARY_MODEL_PROVIDER
    model: str = "gpt-5-nano"
    prompt_version: str = "chat-title-v1"
    max_chars: int = DEFAULT_CHAT_TITLE_MAX_CHARS
    timeout_seconds: float = DEFAULT_CHAT_TITLE_TIMEOUT_SECONDS
    reasoning_effort: str | None = DEFAULT_CHAT_TITLE_REASONING_EFFORT


@dataclass(frozen=True, slots=True)
class ChatTitleGenerationResult:
    """Generated title result for one first-turn chat request."""

    title: str | None
    raw_title: str | None
    reason: str
    usage: Usage | None
    model_provider: str
    model: str
    prompt_version: str


_TRAILING_TITLE_PUNCTUATION = " .,:;!?"
_OUTER_TITLE_QUOTES = " \t\r\n\"'`"


def sanitize_generated_chat_title(raw_title: str, *, max_chars: int = DEFAULT_CHAT_TITLE_MAX_CHARS) -> str:
    """Normalize model output into a displayable chat title."""

    raw_lines = [line.strip() for line in str(raw_title or "").splitlines() if line.strip()]
    if not raw_lines:
        return ""
    title = raw_lines[0].strip(_OUTER_TITLE_QUOTES)
    if title.lower().startswith("title:"):
        title = title[6:].strip(_OUTER_TITLE_QUOTES)
    title = re.sub(r"\s+", " ", title).strip(_OUTER_TITLE_QUOTES)
    title = title.rstrip(_TRAILING_TITLE_PUNCTUATION)
    if max_chars > 0 and len(title) > max_chars:
        title = title[:max_chars].rstrip(_OUTER_TITLE_QUOTES)
        title = title.rstrip(_TRAILING_TITLE_PUNCTUATION)
    return title


class ChatTitleGenerationService:
    """Generate short backend-owned titles for newly created direct chats."""

    def __init__(
        self,
        *,
        model_runner: DirectModelPromptRunner,
        settings: ChatTitleGenerationSettings | None = None,
    ) -> None:
        self._model_runner = model_runner
        self._settings = settings or ChatTitleGenerationSettings()
        self._log = get_logger("app.services.chat_title_generation")

    async def generate_title(
        self,
        *,
        anima_id: str,
        user_id: str,
        chat_id: str,
        source_run_id: str,
        user_message: str,
    ) -> ChatTitleGenerationResult:
        """Run the hidden title model and return sanitized output."""

        settings = self._settings
        if not settings.enabled:
            return self._result(None, None, "disabled", None)
        if not user_message.strip():
            return self._result(None, None, "empty_user_message", None)
        try:
            raw_title, usage = await asyncio.wait_for(
                self._run_title_model(
                    anima_id=anima_id,
                    user_id=user_id,
                    chat_id=chat_id,
                    prompt=self._build_title_prompt(user_message),
                ),
                timeout=max(0.1, float(settings.timeout_seconds)),
            )
        except TimeoutError:
            self._log.warning(
                "Chat title generation timed out",
                chat_id=chat_id,
                run_id=source_run_id,
                timeout_seconds=max(0.1, float(settings.timeout_seconds)),
            )
            return self._result(None, None, "timeout", None)
        except Exception as exc:
            self._log.warning(
                "Chat title generation failed",
                chat_id=chat_id,
                run_id=source_run_id,
                error=str(exc),
            )
            return self._result(None, None, "error", None)

        title = sanitize_generated_chat_title(raw_title, max_chars=max(1, int(settings.max_chars)))
        if not title:
            return self._result(None, raw_title, "empty_title", usage)
        return self._result(title, raw_title, "generated", usage)

    def _result(
        self,
        title: str | None,
        raw_title: str | None,
        reason: str,
        usage: Usage | None,
    ) -> ChatTitleGenerationResult:
        return ChatTitleGenerationResult(
            title=title,
            raw_title=raw_title,
            reason=reason,
            usage=usage,
            model_provider=self._settings.model_provider,
            model=self._settings.model,
            prompt_version=self._settings.prompt_version,
        )

    async def _run_title_model(
        self,
        *,
        anima_id: str,
        user_id: str,
        chat_id: str,
        prompt: str,
    ) -> tuple[str, Usage | None]:
        result = await self._model_runner.run_prompt(
            DirectModelPromptRequest(
                anima_id=anima_id,
                user_id=user_id,
                chat_id=chat_id,
                task="chat-title",
                model_provider=self._settings.model_provider,
                model=self._settings.model,
                prompt=prompt,
                prompt_version=self._settings.prompt_version,
                instructions="Generate concise chat titles. Return only the title.",
                request_options=_title_request_options(self._settings),
            )
        )
        return result.text, result.usage

    def _build_title_prompt(self, user_message: str) -> str:
        max_chars = max(1, int(self._settings.max_chars))
        return (
            "Generate a concise title for this chat from the user's first message.\n"
            "Return only the title.\n"
            "Use 3 to 8 words.\n"
            "Do not answer the user.\n"
            "Do not use quotes.\n"
            "Do not end with punctuation.\n"
            f"Maximum {max_chars} characters.\n\n"
            "User message:\n"
            f"{user_message.strip()}"
        )


def _title_request_options(settings: ChatTitleGenerationSettings) -> dict[str, object]:
    reasoning_effort = settings.reasoning_effort.strip() if isinstance(settings.reasoning_effort, str) else ""
    if not reasoning_effort:
        return {}
    return {"reasoning_effort": reasoning_effort}


__all__ = [
    "CHAT_TITLE_AGENT_ID",
    "DEFAULT_AUXILIARY_MODEL_PROVIDER",
    "DEFAULT_CHAT_TITLE_REASONING_EFFORT",
    "DEFAULT_CHAT_TITLE_MAX_CHARS",
    "DEFAULT_CHAT_TITLE_TIMEOUT_SECONDS",
    "ChatTitleGenerationResult",
    "ChatTitleGenerationService",
    "ChatTitleGenerationSettings",
    "sanitize_generated_chat_title",
]
