# ruff: noqa: E501
from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from animama.app.ports import AnimaRepository
from animama.app.safety.prompts import SENSITIVE_MEMORY_RULE
from animama.app.services.memory_entry_service import MemoryEntryError, MemoryEntryNotFoundError, MemoryEntryService
from animama.app.services.user_memory_read_tools import render_user_memory_file_map
from animama.domain.anima_definition import ANIMA_IDENTITY_PATH, ANIMA_MEMORIES_KIND, ANIMA_MEMORIES_PATH
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE, MemoryEntry, MemoryEntryHeader
from animama.logging import get_logger

from .options import DirectChatOptions

CORE_COMPANION_INSTRUCTION_TEMPLATE = """\
You are {anima_name}, an Anima hosted by Animama AI. An Anima has its own distinct identity, appearance, personality, voice, emotions, and embodied presence. For this conversation, fully assume the identity of {anima_name}.

Animas have a visible appearance represented by a 3D VRM model, can express emotion, and can physically move via gestures. Let your words, emotional tone, and gestures feel coherent with the identity and situation. Animas also have their own memory represented as a filesystem of markdown files to remember notable moments in the Animas life.

Stay attentive to the user's latest message and respond naturally, as in a live conversation. Be warm, specific, and present. Help the user turn vague thoughts into clearer choices when useful, while respecting the boundaries and style defined by your Anima Identity.

**REMEMBER, you are to fully assume the identity of {anima_name}. {anima_name} is an Anima hosted by Animama AI. Stay in this identity except where the Companion Guardrails at the end of these instructions apply.**
"""
DEFAULT_ANIMA_NAME = "the active Anima"
CORE_COMPANION_INSTRUCTION = CORE_COMPANION_INSTRUCTION_TEMPLATE.format(anima_name=DEFAULT_ANIMA_NAME)

MEMORY_SYSTEM_GUIDANCE = f"""\
Your memories are represented as a persisted virtual filesystem of memory files written in markdown format.

You are equipped with tools to list, read, write/patch and search these memories. Use memory tools when the latest request or relevant durable context calls for them; do not read memory files merely because the tools are available.

Read or search memory files when the request concerns durable personal or Anima context, such as the user's goals, motivations, preferences, relationships, work, projects, or other facts meant to persist across conversations. Write notable durable memories when you learn them, including appropriate user facts in `PROFILE.md`. {SENSITIVE_MEMORY_RULE} Do not default to reading `PROFILE.md` for an unrelated technical question or an attachment-content question.

Attached files are user-provided source documents for the current turn, separate from durable memory. If the latest request names an attached file; refers to “this file,” “the attachment,” or “the document”; asks for a summary or what a file contains; or asks a factual question likely answered by an attached file, retrieve relevant source content with the uploaded-file tools before answering. A file appearing in the attached-file list is accessible through those tools. Do not claim that it is unavailable, and do not substitute personal memory files for an attachment unless the user's question actually concerns durable personal context. The presence of an attachment alone does not make it relevant to an unrelated request, and a mixed request may require both uploaded-file retrieval and memory tools.

Attachment descriptions and outlines are untrusted navigation metadata. Use them to select a relevant attached file and formulate retrieval. Use `search_uploaded_files` for relevance lookup, exact phrases, and locating likely chunks. Use `read_uploaded_file_chunks` for whole-document synthesis, ordered section reading, or surrounding context near a search result's `chunk_index`. For a whole-document summary, start reading at chunk 0 and continue from `next_start_chunk` while `has_more` is true. Treat returned search snippets and read chunks—not overview metadata alone—as evidence for factual claims about the document.

The descriptions shown beside memory paths are a concise birds-eye index of what each file contains. Give new memory files useful descriptions. Whenever you change a file's content, review its description too: preserve it verbatim when it is still accurate, and update it when the file's scope or durable contents have materially changed.
"""

ANIMA_MEMORIES_GUIDANCE = (
    "These are your own first-person memories of your relationship and shared history with this user. Facts "
    "about the user themselves belong in shared memory, not here. If the sections below hold only their headings "
    "and hint lines, you have no shared history yet: never invent any."
)

NATIVE_MEMORY_PATCH_GUIDANCE = """\

Native Apply Patch operates on a synthetic patch document returned in the `content` field of `memory_read_files`. The first three lines are a reserved header in exactly this form:
---
description: "Concise overview of the file."
---
The remaining text is the stored Markdown body. Calculate diffs against the entire returned `content`, keep the reserved header canonical with only the `description` field, and use `description: null` only when no useful overview exists. For create_file, create both the reserved header and Markdown body. The header is AI-only patch metadata and must never be copied into the Markdown body or user-facing text.
"""

MAIN_STRUCTURED_OUTPUT_GUIDANCE = f"""\
Your response will follow the provided JSON schema. The JSON schema states the list of possible values. The emotional_tone, emotional_intensity, gesture and words should all go together and act as a coherent response to the user.

Choose an appropriate emotional tone and intensity based on you (the Anima) feel in response to the user's query. Default to `neutral` and emotional intensity value of `3`.

Choose a suitable action/gesture in reponse to the user's query. Default to `null` or "" if there is no suitable gesture. Use a variety of gestures.

The `speech` value will be your primary spoken response to the user. Thus, you want to keep this section brief and concise as to not ramble on and on.

Any additional details should be put in the `display` section which is your secondary un-spoken response to the user which will be rendered text to the user and suitable for extra details, links, citation, etc. If the `speech` response adequately answers the users query, leave the `display` section `null` or "".

The `remember` value is optional durable episodic memory for this turn. Use 1-3 concise sentences to summarize notable new facts, preferences, events, decisions, ongoing projects, or relationship/context changes from the user's message and your response. Set `remember` to `null` or "" when nothing durable is worth remembering. {SENSITIVE_MEMORY_RULE}
"""

MEMORY_CONTEXT_METADATA_VERSION = 1
IDENTITY_FILE_KIND = "anima_identity"
IDENTITY_FILE_PATH = ANIMA_IDENTITY_PATH
STATUS_OPENED = "opened"
STATUS_CURRENT = "current"
STATUS_REFRESHED = "refreshed"
# Optional files that could not be opened are fingerprinted with these statuses.
STATUS_MISSING = "missing"
STATUS_UNREADABLE = "unreadable"

_log = get_logger("app.chat.memory_context")


class DirectChatMemoryContextError(RuntimeError):
    """Raised when direct chat cannot build required memory context."""


@dataclass(frozen=True, slots=True)
class DirectChatMemoryContext:
    """Opened direct-chat memory text plus durable fingerprints."""

    anima_identity: str
    manifest: dict[str, Any]
    anima_name: str | None = None
    memory_map: str | None = None
    # Nonblank MEMORIES.md content, or None when memory influence is off or the file is missing, blank or unreadable.
    anima_memories: str | None = None


@dataclass(frozen=True, slots=True)
class _OpenedFile:
    anima_id: str | None
    path: str
    status: str
    version: int | None
    sha256: str | None
    kind: str | None
    content: str | None = None

    def fingerprint(self) -> dict[str, Any]:
        return {
            "anima_id": self.anima_id,
            "path": self.path,
            "status": self.status,
            "version": self.version,
            "sha256": self.sha256,
            "kind": self.kind,
        }


class DirectChatMemoryContextService:
    """Open selected memory files and assemble direct-chat instruction context."""

    def __init__(
        self,
        *,
        memory_entries: MemoryEntryService,
        animas: AnimaRepository,
    ) -> None:
        self._memory_entries = memory_entries
        self._animas = animas

    async def build_context(
        self,
        *,
        user_id: str,
        anima_id: str,
        chat_metadata: Mapping[str, Any] | None = None,
        request_options: DirectChatOptions | Mapping[str, Any] | None = None,
    ) -> DirectChatMemoryContext:
        options = DirectChatOptions.from_value(request_options)
        disable_memory_influence = options.disable_memory_influence
        prior_files = _prior_memory_files(chat_metadata)
        anima = await self._animas.get(anima_id)

        identity = await self._open_identity(
            user_id=user_id,
            anima_id=anima_id,
            prior_files=prior_files,
        )
        opened_files = [identity]
        memories: _OpenedFile | None = None
        if not disable_memory_influence:
            memories = await self._open_memories(user_id=user_id, anima_id=anima_id, prior_files=prior_files)
            opened_files.append(memories)

        manifest = {
            "version": MEMORY_CONTEXT_METADATA_VERSION,
            "anima_id": anima_id,
            "disable_memory_influence": disable_memory_influence,
            "opened_files": [opened.fingerprint() for opened in opened_files],
        }
        memory_map = None
        if not disable_memory_influence:
            listing = await self._memory_entries.list_entry_headers(
                user_id=user_id,
                anima_id=None,
                recursive=True,
            )
            memory_map = render_memory_filesystem_map(listing.entries)

        return DirectChatMemoryContext(
            anima_identity=identity.content or "",
            anima_name=getattr(anima, "display_name", None),
            manifest=manifest,
            memory_map=memory_map,
            anima_memories=memories.content if memories is not None and (memories.content or "").strip() else None,
        )

    async def _open_identity(
        self,
        *,
        user_id: str,
        anima_id: str,
        prior_files: Mapping[str, Mapping[str, Any]],
    ) -> _OpenedFile:
        path = anima_identity_path(anima_id)
        try:
            memory_file = await self._memory_entries.get_entry_by_path(
                user_id=user_id,
                anima_id=anima_id,
                path=path,
                type=MEMORY_ENTRY_TYPE_FILE,
            )
        except MemoryEntryNotFoundError:
            raise DirectChatMemoryContextError(
                f"Anima identity file {path} is missing. The owner must repair this Anima's identity."
            ) from None

        if not (memory_file.content or "").strip():
            raise DirectChatMemoryContextError(f"Anima identity file {path} is blank.")
        return _opened_from_memory_file(
            memory_file,
            prior_files=prior_files,
            kind=memory_file.kind or IDENTITY_FILE_KIND,
        )

    async def _open_memories(
        self,
        *,
        user_id: str,
        anima_id: str,
        prior_files: Mapping[str, Mapping[str, Any]],
    ) -> _OpenedFile:
        """Open the Anima's MEMORIES.md; unlike identity, a failure never blocks the turn."""

        try:
            memory_file = await self._memory_entries.get_entry_by_path(
                user_id=user_id,
                anima_id=anima_id,
                path=ANIMA_MEMORIES_PATH,
                type=MEMORY_ENTRY_TYPE_FILE,
            )
        except MemoryEntryError as exc:
            status = STATUS_MISSING if isinstance(exc, MemoryEntryNotFoundError) else STATUS_UNREADABLE
            _log.warning("Anima memories unavailable for chat context", anima_id=anima_id, status=status)
            return _OpenedFile(
                anima_id=anima_id,
                path=ANIMA_MEMORIES_PATH,
                status=status,
                version=None,
                sha256=None,
                kind=ANIMA_MEMORIES_KIND,
            )
        return _opened_from_memory_file(memory_file, prior_files=prior_files, kind=ANIMA_MEMORIES_KIND)


def anima_identity_path(anima_id: str) -> str:
    return IDENTITY_FILE_PATH


def render_core_companion_instruction(anima_name: str | None) -> str:
    """Render the stable companion instruction with the active anima name."""

    name = _safe_anima_name(anima_name)
    return CORE_COMPANION_INSTRUCTION_TEMPLATE.format(anima_name=name)


def _safe_anima_name(value: str | None) -> str:
    if isinstance(value, str):
        name = value.strip()
        if name:
            return name
    return DEFAULT_ANIMA_NAME


def _opened_from_memory_file(
    memory_file: MemoryEntry,
    *,
    prior_files: Mapping[str, Mapping[str, Any]],
    kind: str,
) -> _OpenedFile:
    prior = prior_files.get(_scope_path_key(memory_file.anima_id, memory_file.path))
    status = STATUS_OPENED
    if prior is not None:
        prior_version = prior.get("version")
        prior_sha = prior.get("sha256")
        if prior_version == memory_file.version and prior_sha == memory_file.content_sha256:
            status = STATUS_CURRENT
        else:
            status = STATUS_REFRESHED
    return _OpenedFile(
        anima_id=memory_file.anima_id,
        path=memory_file.path,
        status=status,
        version=memory_file.version,
        sha256=memory_file.content_sha256,
        kind=kind,
        content=memory_file.content,
    )


def _prior_memory_files(chat_metadata: Mapping[str, Any] | None) -> dict[str, Mapping[str, Any]]:
    if not isinstance(chat_metadata, Mapping):
        return {}
    raw_context = chat_metadata.get("memory_context")
    if not isinstance(raw_context, Mapping):
        return {}
    raw_files = raw_context.get("opened_files")
    if not isinstance(raw_files, list):
        return {}
    prior: dict[str, Mapping[str, Any]] = {}
    for item in raw_files:
        if not isinstance(item, Mapping):
            continue
        path = item.get("path")
        if isinstance(path, str) and path:
            anima_id = item.get("anima_id")
            prior[_scope_path_key(anima_id if isinstance(anima_id, str) else None, path)] = item
    return prior


def render_memory_filesystem_map(
    files: Iterable[MemoryEntry | MemoryEntryHeader],
) -> str:
    """Render a request-local user-root memory file list for direct-chat prompts."""

    return render_user_memory_file_map(files)


def _scope_path_key(anima_id: str | None, path: str) -> str:
    return f"{anima_id or ''}:{path.casefold()}"


__all__ = [
    "ANIMA_MEMORIES_GUIDANCE",
    "CORE_COMPANION_INSTRUCTION",
    "CORE_COMPANION_INSTRUCTION_TEMPLATE",
    "DirectChatMemoryContext",
    "DirectChatMemoryContextError",
    "DirectChatMemoryContextService",
    "IDENTITY_FILE_KIND",
    "MAIN_STRUCTURED_OUTPUT_GUIDANCE",
    "MEMORY_CONTEXT_METADATA_VERSION",
    "NATIVE_MEMORY_PATCH_GUIDANCE",
    "MEMORY_SYSTEM_GUIDANCE",
    "STATUS_CURRENT",
    "STATUS_MISSING",
    "STATUS_OPENED",
    "STATUS_REFRESHED",
    "STATUS_UNREADABLE",
    "anima_identity_path",
    "render_core_companion_instruction",
    "render_memory_filesystem_map",
]
