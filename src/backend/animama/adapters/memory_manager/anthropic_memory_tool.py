"""Anthropic's memory tool (``memory_20250818``) over the virtual memory workspace.

The Anthropic Memory Manager runtime offers Claude the client-side memory tool
and executes each command here against the database-backed memory files:

- Paths are ``/memories/<relative>``, where ``<relative>`` is the ordinary
  memory path (``notes/preferences.md``, ``animas/<anima_id>/MEMORIES.md``).
  Paths outside the root, traversal (``..``, backslashes) and encoded traversal
  are refused, and every path then follows the run's file scope
  (``ManagerFileAccess``), the usual normalization and the protected paths.
- ``view`` reads immediately: a directory lists entries two levels deep with
  sizes (generated episode logs are left out, as from the memory map), and a
  file shows its synthetic description header and body with line
  numbers (the same document ``memory_read_files`` returns to OpenAI models).
- ``create``, ``str_replace`` and ``insert`` compute the file's new content
  and become one approval, fenced by the version the edit was based on, exactly
  like an OpenAI ``apply_patch`` proposal. The tool result follows the
  owner's decision.
- ``delete`` and ``rename`` are refused: the Memory Manager cannot delete or
  move files on any model.

Return strings follow Anthropic's documented memory tool results; every
failure is an ``is_error`` result with a reason the model can act on.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import unquote

from animama.adapters.memory_patch import MemoryPatchTarget
from animama.app.ports.memory_manager_runtime import MemoryManagerRuntimeApprovalRequest
from animama.app.services.anima_identity_memory import AnimaManagerPath, ManagerFileAccess
from animama.app.services.memory_entry_service import MemoryEntryService, is_protected_memory_entry
from animama.app.services.memory_patch_document import (
    MemoryPatchDocumentError,
    ParsedMemoryPatchDocument,
    parse_memory_patch_document,
    render_memory_patch_document,
)
from animama.app.services.user_memory_read_tools import UserMemoryReadToolService
from animama.domain.anima_definition import ANIMA_IDENTITY_PATH, ANIMA_MEMORIES_PATH
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_DIRECTORY, MEMORY_ENTRY_TYPE_FILE

from .workspace import MemoryManagerPatchRejected, MemoryManagerVirtualWorkspace

MEMORY_TOOL_NAME = "memory"
MEMORY_TOOL_PARAM: dict[str, str] = {"type": "memory_20250818", "name": MEMORY_TOOL_NAME}
"""The tool entry; Anthropic defines its commands and input schema."""
MEMORY_ROOT = "/memories"
MEMORY_COMMAND_VIEW = "view"
MEMORY_COMMAND_CREATE = "create"
MEMORY_COMMAND_STR_REPLACE = "str_replace"
MEMORY_COMMAND_INSERT = "insert"
MEMORY_COMMAND_DELETE = "delete"
MEMORY_COMMAND_RENAME = "rename"
MEMORY_EDIT_COMMANDS = frozenset({MEMORY_COMMAND_CREATE, MEMORY_COMMAND_STR_REPLACE, MEMORY_COMMAND_INSERT})
VIEW_MAX_CHARS = 16_000
"""A file view is cut at a line boundary past this many characters, as the tool tells Claude it will be."""
_LINE_NUMBER_WIDTH = 6
_SNIPPET_CONTEXT_LINES = 2
_HEADER_LINES = 3
_LISTING_DEPTH = 2


@dataclass(frozen=True, slots=True)
class MemoryToolOutcome:
    """One memory command's tool result, or a proposed change waiting for the owner.

    When ``approval`` is set, ``content`` is the result the model receives once
    the owner approves; a rejection sends the rejection text instead.
    """

    content: str
    is_error: bool = False
    approval: MemoryManagerRuntimeApprovalRequest | None = None


class _MemoryToolError(Exception):
    """A command that cannot run; ``message`` is the tool's error result."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def memory_tool_path(relative_path: str) -> str:
    """Return the memory tool's absolute path for an ordinary memory path."""

    return f"{MEMORY_ROOT}/{relative_path}" if relative_path else MEMORY_ROOT


def relative_memory_path(path: object) -> str:
    """Map ``/memories/<relative>`` to ``<relative>`` (``""`` for the root itself).

    Paths outside the root, relative paths, ``.`` and ``..`` segments,
    backslashes, repeated slashes between segments and percent-encoded
    traversal are refused before any lookup. Slashes right after the root and a
    trailing slash are ignored, so ``/memories//x.md`` reads ``x.md``.
    Segment names are then validated by the memory services as usual.
    """

    if not isinstance(path, str) or not path.strip():
        raise _MemoryToolError(f"Error: A path under {MEMORY_ROOT} is required.")
    raw = path.strip()
    outside = _MemoryToolError(
        f"Error: The path {raw} is outside {MEMORY_ROOT}. Use absolute paths under {MEMORY_ROOT}, "
        f"such as {MEMORY_ROOT}/notes/preferences.md."
    )
    if "\\" in raw:
        raise outside
    decoded = unquote(raw)
    if decoded != raw and ("\\" in decoded or any(segment in {".", ".."} for segment in decoded.split("/"))):
        raise outside
    if raw != MEMORY_ROOT and not raw.startswith(f"{MEMORY_ROOT}/"):
        raise outside
    relative = raw[len(MEMORY_ROOT) :].strip("/")
    if relative and any(segment in {"", ".", ".."} for segment in relative.split("/")):
        raise outside
    return relative


class AnthropicMemoryToolHandler:
    """Execute memory tool commands for one Memory Manager run.

    ``access`` is the run's file scope (``manager_file_access_for_run``):
    general runs reach owned Anima files, a Reflection changes only its own
    Anima's ``MEMORIES.md`` and episode processing reaches no Anima files.
    """

    def __init__(
        self,
        *,
        user_id: str,
        memory_entries: MemoryEntryService,
        access: ManagerFileAccess,
        runtime_name: str,
    ) -> None:
        self._user_id = user_id
        self._memory_entries = memory_entries
        self._access = access
        self._runtime_name = runtime_name
        self._workspace = MemoryManagerVirtualWorkspace(
            user_id=user_id,
            memory_entries=memory_entries,
            access=access,
        )
        self._reads = UserMemoryReadToolService(memory_entries=memory_entries, manager_access=access)

    async def execute(
        self,
        tool_input: Mapping[str, Any],
        *,
        tool_use_id: str,
        edits_allowed: bool = True,
    ) -> MemoryToolOutcome:
        """Run one command. ``edits_allowed`` is false while another change already waits in this response."""

        command = tool_input.get("command")
        try:
            if command == MEMORY_COMMAND_VIEW:
                return MemoryToolOutcome(await self._view(tool_input.get("path"), tool_input.get("view_range")))
            if command == MEMORY_COMMAND_DELETE:
                return _error(
                    f"Error: The Memory Manager cannot delete memory files, so {tool_input.get('path')} was not "
                    "deleted. To retire outdated facts, edit the file instead; the user can delete files on the "
                    "Memories page."
                )
            if command == MEMORY_COMMAND_RENAME:
                return _error(
                    f"Error: The Memory Manager cannot rename or move memory files, so {tool_input.get('old_path')} "
                    "was not renamed. Edit the file where it is; the user can move files on the Memories page."
                )
            if command not in MEMORY_EDIT_COMMANDS:
                return _error(f"Error: Unknown memory command {command!r}.")
            if not edits_allowed:
                return _error(
                    "Error: Propose one memory change at a time. Wait for the result of the pending change, then "
                    "propose this one again if it is still needed."
                )
            if command == MEMORY_COMMAND_CREATE:
                return await self._create(tool_input, tool_use_id=tool_use_id)
            if command == MEMORY_COMMAND_STR_REPLACE:
                return await self._str_replace(tool_input, tool_use_id=tool_use_id)
            return await self._insert(tool_input, tool_use_id=tool_use_id)
        except _MemoryToolError as exc:
            return _error(exc.message)

    # ------------------------------------------------------------------ view

    async def _view(self, path: object, view_range: object) -> str:
        relative = relative_memory_path(path)
        display = memory_tool_path(relative)
        if not relative.casefold().endswith(".md"):
            # Only files end in .md, so anything else is a directory or missing.
            tree = await self._tree()
            if relative == "" or relative.casefold() in tree.directories:
                return tree.listing(relative)
            raise _MemoryToolError(_not_found(display))
        result = await self._reads.read_files(user_id=self._user_id, paths=[relative], native_patch_mode=True)
        files = result.get("files") or []
        if not files:
            errors = result.get("errors") or []
            first = errors[0] if errors else {}
            if first.get("code") == "not_found":
                raise _MemoryToolError(_not_found(display))
            raise _MemoryToolError(f"Error: {first.get('message') or 'The file could not be read'}.")
        return _numbered_view(display, str(files[0].get("content") or ""), view_range)

    async def _tree(self) -> _MemoryTree:
        """The entries directory views list: user memory plus the Anima files in the run's scope.

        Generated episode logs are left out, as from the memory map and
        ``memory_list_files``; an exact path still reads them.
        """

        tree = _MemoryTree()
        listing = await self._memory_entries.list_entry_headers(user_id=self._user_id, anima_id=None, recursive=True)
        for header in listing.entries:
            if header.anima_id is not None or is_protected_memory_entry(header):
                continue
            if header.type == MEMORY_ENTRY_TYPE_DIRECTORY:
                tree.add_directory(header.path)
            elif header.type == MEMORY_ENTRY_TYPE_FILE:
                tree.add_file(header.path, header.size_bytes or 0)
        if self._access.anima_files:
            for summary in await self._memory_entries.list_anima_identities(user_id=self._user_id):
                for filename, file_header in (
                    (ANIMA_IDENTITY_PATH, summary.identity),
                    (ANIMA_MEMORIES_PATH, summary.memories),
                ):
                    target = AnimaManagerPath(anima_id=summary.anima_id, filename=filename)
                    if file_header is not None and self._access.allows(target):
                        tree.add_file(target.path, file_header.size_bytes or 0)
        return tree

    # ----------------------------------------------------------------- edits

    async def _create(self, tool_input: Mapping[str, Any], *, tool_use_id: str) -> MemoryToolOutcome:
        display, target = await self._edit_target(tool_input.get("path"))
        file_text = tool_input.get("file_text")
        if not isinstance(file_text, str):
            raise _MemoryToolError("Error: `file_text` is required for create.")
        parsed = _parse_document(file_text, display, created=True)
        result = (
            f"File created successfully at: {display}"
            if target.current is None
            else f"The file {display} has been replaced with the new content."
        )
        return self._proposal(
            target, parsed, command=MEMORY_COMMAND_CREATE, display=display, tool_use_id=tool_use_id, result=result
        )

    async def _str_replace(self, tool_input: Mapping[str, Any], *, tool_use_id: str) -> MemoryToolOutcome:
        display, target = await self._edit_target(tool_input.get("path"))
        old_str = tool_input.get("old_str")
        new_str = tool_input.get("new_str")
        if not isinstance(old_str, str) or not old_str:
            raise _MemoryToolError("Error: `old_str` is required for str_replace.")
        if new_str is None:
            new_str = ""
        if not isinstance(new_str, str):
            raise _MemoryToolError("Error: `new_str` must be a string.")
        document = self._existing_document(target, display, missing=f"{_not_found(display)}")
        count = document.count(old_str)
        if count == 0:
            raise _MemoryToolError(
                f"No replacement was performed, old_str `{old_str}` did not appear verbatim in {display}."
            )
        if count > 1:
            raise _MemoryToolError(
                f"No replacement was performed. Multiple occurrences of old_str `{old_str}` in lines: "
                f"{_occurrence_lines(document, old_str)}. Please ensure it is unique"
            )
        position = document.index(old_str)
        new_document = document.replace(old_str, new_str, 1)
        parsed = _parse_document(new_document, display)
        snippet = _snippet(new_document, changed_line=document[:position].count("\n"))
        result = (
            f"The memory file has been edited. Here is the snippet showing the change (with line numbers):\n{snippet}"
        )
        return self._proposal(
            target, parsed, command=MEMORY_COMMAND_STR_REPLACE, display=display, tool_use_id=tool_use_id, result=result
        )

    async def _insert(self, tool_input: Mapping[str, Any], *, tool_use_id: str) -> MemoryToolOutcome:
        display, target = await self._edit_target(tool_input.get("path"))
        insert_line = tool_input.get("insert_line")
        insert_text = tool_input.get("insert_text")
        if isinstance(insert_line, bool) or not isinstance(insert_line, int):
            raise _MemoryToolError("Error: `insert_line` must be a line number.")
        if not isinstance(insert_text, str):
            raise _MemoryToolError("Error: `insert_text` is required for insert.")
        document = self._existing_document(target, display, missing=f"Error: The path {display} does not exist")
        lines, trailing_newline = _document_lines(document)
        if insert_line < 0 or insert_line > len(lines):
            raise _MemoryToolError(
                f"Error: Invalid `insert_line` parameter: {insert_line}. It should be within the range of lines "
                f"of the file: [0, {len(lines)}]"
            )
        lines.insert(insert_line, insert_text.rstrip("\n"))
        new_document = "\n".join(lines) + ("\n" if trailing_newline else "")
        parsed = _parse_document(new_document, display)
        return self._proposal(
            target,
            parsed,
            command=MEMORY_COMMAND_INSERT,
            display=display,
            tool_use_id=tool_use_id,
            result=f"The file {display} has been edited.",
        )

    async def _edit_target(self, path: object) -> tuple[str, MemoryPatchTarget]:
        """Resolve an edit's file within the run's scope; protected and out-of-scope paths are refused."""

        relative = relative_memory_path(path)
        display = memory_tool_path(relative)
        if not relative:
            raise _MemoryToolError(f"Error: {MEMORY_ROOT} is a directory; give a file path ending in .md.")
        try:
            return display, await self._workspace.resolve_target(relative)
        except MemoryManagerPatchRejected as exc:
            raise _MemoryToolError(f"Error: {exc.detail}.") from exc

    @staticmethod
    def _existing_document(target: MemoryPatchTarget, display: str, *, missing: str) -> str:
        current = target.current
        if current is None:
            raise _MemoryToolError(missing)
        return render_memory_patch_document(description=current.description, content=current.content or "")

    def _proposal(
        self,
        target: MemoryPatchTarget,
        parsed: ParsedMemoryPatchDocument,
        *,
        command: str,
        display: str,
        tool_use_id: str,
        result: str,
    ) -> MemoryToolOutcome:
        """Turn the computed file into an approval fenced by the version it was computed from.

        ``result`` is the tool result the model receives if the owner approves.
        """

        try:
            approval = self._workspace.plan_target_content(
                target,
                new_content=parsed.content,
                new_description=parsed.description,
                summary=f"{'Create' if target.current is None else 'Update'} `{target.path}`.",
                metadata={
                    "runtime": self._runtime_name,
                    # The shared key the service dedupes approvals by: the tool_use id.
                    "sdk_call_id": tool_use_id,
                    "sdk_tool_name": MEMORY_TOOL_NAME,
                    "memory_command": command,
                    "memory_tool_path": display,
                    "memory_tool_result": result,
                },
            )
        except MemoryManagerPatchRejected as exc:
            raise _MemoryToolError(f"Error: {exc.detail}.") from exc
        return MemoryToolOutcome(content=result, approval=approval)


class _MemoryTree:
    """User memory and in-scope Anima files, keyed by case-folded path, for directory views."""

    def __init__(self) -> None:
        self.directories: dict[str, str] = {}
        self._files: dict[str, tuple[str, int]] = {}

    def add_directory(self, path: str) -> None:
        segments = path.split("/")
        for depth in range(1, len(segments) + 1):
            parent = "/".join(segments[:depth])
            self.directories.setdefault(parent.casefold(), parent)

    def add_file(self, path: str, size: int) -> None:
        if "/" in path:
            self.add_directory(path.rsplit("/", 1)[0])
        self._files[path.casefold()] = (path, max(0, size))

    def listing(self, relative: str) -> str:
        """List entries up to two levels below ``relative``, hidden names excluded, directories with ``/``."""

        prefix = f"{relative.casefold()}/" if relative else ""
        display = memory_tool_path(self.directories.get(relative.casefold(), relative))
        rows: list[tuple[str, str]] = []
        for key, path in self.directories.items():
            if key.startswith(prefix) and key != relative.casefold() and self._visible(key, prefix):
                rows.append((path, f"{_human_size(self._size_under(key))}\t{memory_tool_path(path)}/"))
        for key, (path, size) in self._files.items():
            if key.startswith(prefix) and self._visible(key, prefix):
                rows.append((path, f"{_human_size(size)}\t{memory_tool_path(path)}"))
        lines = [f"{_human_size(self._size_under(relative.casefold()))}\t{display}"]
        lines.extend(line for _path, line in sorted(rows, key=lambda row: row[0].casefold()))
        return (
            f"Here're the files and directories up to 2 levels deep in {display}, excluding hidden items and "
            "node_modules:\n" + "\n".join(lines)
        )

    def _size_under(self, key: str) -> int:
        prefix = f"{key}/" if key else ""
        return sum(size for file_key, (_path, size) in self._files.items() if file_key.startswith(prefix))

    @staticmethod
    def _visible(key: str, prefix: str) -> bool:
        segments = key[len(prefix) :].split("/")
        return len(segments) <= _LISTING_DEPTH and not any(segment.startswith(".") for segment in segments)


def _error(message: str) -> MemoryToolOutcome:
    return MemoryToolOutcome(content=message, is_error=True)


def _not_found(display: str) -> str:
    return f"The path {display} does not exist. Please provide a valid path."


def _document_lines(document: str) -> tuple[list[str], bool]:
    """Split a document into lines; a trailing newline does not add an empty last line."""

    lines = document.split("\n")
    trailing_newline = len(lines) > 1 and lines[-1] == ""
    if trailing_newline:
        lines.pop()
    return lines, trailing_newline


def _numbered(lines: list[str], *, first_number: int) -> list[str]:
    return [f"{str(first_number + index).rjust(_LINE_NUMBER_WIDTH)}\t{line}" for index, line in enumerate(lines)]


def _numbered_view(display: str, document: str, view_range: object) -> str:
    """Render a file view with 1-based line numbers, honouring ``view_range`` and ``VIEW_MAX_CHARS``."""

    lines, _trailing = _document_lines(document)
    start, end = 1, len(lines)
    if view_range is not None:
        if (
            not isinstance(view_range, list | tuple)
            or len(view_range) != 2
            or not all(isinstance(value, int) and not isinstance(value, bool) for value in view_range)
        ):
            raise _MemoryToolError(
                "Error: `view_range` must be two line numbers, [start_line, end_line]; use -1 as end_line to "
                "read to the end of the file."
            )
        start, requested_end = int(view_range[0]), int(view_range[1])
        if start < 1 or start > len(lines):
            raise _MemoryToolError(
                f"Error: Invalid `view_range` parameter: {list(view_range)}. Its first element `{start}` should be "
                f"within the range of lines of the file: [1, {len(lines)}]"
            )
        if requested_end != -1 and requested_end < start:
            raise _MemoryToolError(
                f"Error: Invalid `view_range` parameter: {list(view_range)}. Its second element `{requested_end}` "
                f"should be -1 or at least its first element `{start}`."
            )
        end = len(lines) if requested_end == -1 else min(requested_end, len(lines))
    numbered = _numbered(lines[start - 1 : end], first_number=start)
    shown: list[str] = []
    used = 0
    for line in numbered:
        if shown and used + len(line) + 1 > VIEW_MAX_CHARS:
            break
        shown.append(line)
        used += len(line) + 1
    body = "\n".join(shown)
    if len(shown) < len(numbered):
        last = start + len(shown) - 1
        body += f"\n[Showing lines {start}-{last} of {len(lines)}. Use view_range [{last + 1}, -1] to read the rest.]"
    return f"Here's the content of {display} with line numbers:\n{body}"


def _occurrence_lines(document: str, needle: str) -> str:
    lines: list[str] = []
    start = 0
    while (position := document.find(needle, start)) != -1:
        lines.append(str(document[:position].count("\n") + 1))
        start = position + 1
    return ", ".join(lines)


def _snippet(document: str, *, changed_line: int) -> str:
    lines, _trailing = _document_lines(document)
    first = max(0, changed_line - _SNIPPET_CONTEXT_LINES)
    last = min(len(lines), changed_line + _SNIPPET_CONTEXT_LINES + 1)
    return "\n".join(_numbered(lines[first:last], first_number=first + 1))


def _parse_document(document: str, display: str, *, created: bool = False) -> ParsedMemoryPatchDocument:
    """Split an edited document into its description and Markdown body, or explain the header rule."""

    try:
        return parse_memory_patch_document(document)
    except MemoryPatchDocumentError as exc:
        start = "Start the file_text with" if created else "Keep the first three lines exactly as"
        raise _MemoryToolError(
            f"Error: {display} must begin with its reserved three-line description header ({exc}). {start}:\n"
            '---\ndescription: "Concise overview of the file."\n---\n'
            f"Edit line 2 to change the description; the Markdown body starts at line {_HEADER_LINES + 1}."
        ) from exc


def _human_size(size: int) -> str:
    """Format a byte count like the reference memory tool: ``512B``, ``1.5K``, ``2M``."""

    if size <= 0:
        return "0B"
    units = ("B", "K", "M", "G")
    index = min((size.bit_length() - 1) // 10, len(units) - 1)
    value = size / (1024**index)
    return f"{int(value)}{units[index]}" if value == int(value) else f"{value:.1f}{units[index]}"


__all__ = [
    "MEMORY_COMMAND_CREATE",
    "MEMORY_COMMAND_DELETE",
    "MEMORY_COMMAND_INSERT",
    "MEMORY_COMMAND_RENAME",
    "MEMORY_COMMAND_STR_REPLACE",
    "MEMORY_COMMAND_VIEW",
    "MEMORY_EDIT_COMMANDS",
    "MEMORY_ROOT",
    "MEMORY_TOOL_NAME",
    "MEMORY_TOOL_PARAM",
    "VIEW_MAX_CHARS",
    "AnthropicMemoryToolHandler",
    "MemoryToolOutcome",
    "memory_tool_path",
    "relative_memory_path",
]
