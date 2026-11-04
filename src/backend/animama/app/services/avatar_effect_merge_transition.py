"""Point Local Gestures and Reactions at merged Included Avatar Effects (ADR 0025).

Runs with the other content transitions at startup, on ``POST /v1/content:rescan``
and from ``uv run python -m animama.server.content_cli``. A Local Action that
names an Included effect the merge removed is rewritten in place, keeping its
folder, content ID and other files: the dependency names the family effect and
each event carries the override (and sound) that reproduces the removed effect
(``rewrite_action_effect_merges``). The original bytes are retained under the
transition journal first. An Action that cannot be rewritten is left as it was;
it plays without the removed effect, as before, and the failure is logged.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from contextlib import ExitStack
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
from typing import Any, BinaryIO, cast

from animama.app.ports.content_store import LocalContentStore
from animama.app.services.avatar_effect_merges import (
    AvatarEffectMerge,
    load_avatar_effect_merges,
    rewrite_action_effect_merges,
)
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.local_content_mutations import mutation_digest
from animama.app.services.typed_content_service import TypedContentService
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentConflictError,
    ContentKind,
    ContentSource,
    ContentStatus,
    ContentValidationError,
)
from animama.domain.content_documents import ContentDocumentError, GestureDocumentV1, ReactionDocumentV1
from animama.logging import get_logger

_log = get_logger("app.services.avatar_effect_merge_transition")
_ACTION_KINDS = frozenset({ContentKind.GESTURE, ContentKind.REACTION})
# A descriptor is small; a clip is bounded as the players bound it.
_MAX_DESCRIPTOR_BYTES = 1024 * 1024
_MAX_CLIP_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class AvatarEffectMergeTransitionResult:
    """Receipt for one identity-preserving Action rewrite."""

    item_id: str
    source_revision: str


class AvatarEffectMergeTransitionService:
    """Rewrite Local Actions that name merged Included effects, under the shared mutation authority."""

    def __init__(
        self, *, content: ContentCatalogService, merges: Mapping[str, AvatarEffectMerge] | None = None
    ) -> None:
        self._content = content
        self._merges = load_avatar_effect_merges() if merges is None else merges

    async def convert(self, *, user_id: str) -> None:
        """Rewrite every eligible Local Action; a failed rewrite leaves its Action unchanged."""
        catalog = self._content.mutations.catalog
        for source in await catalog.list_visible(user_id=user_id):
            if (
                source.kind not in _ACTION_KINDS
                or source.status is not ContentStatus.VALID
                or source.source is not ContentSource.LOCAL
            ):
                continue
            try:
                document = TypedContentService.parse(source).document
            except Exception:  # An unreadable item stays reported by the scan.
                continue
            if not isinstance(document, GestureDocumentV1 | ReactionDocumentV1):
                continue
            if document.implementation.kind != "anima_clip" or not any(
                dependency.kind is ContentKind.AVATAR_EFFECT and dependency.ref in self._merges
                for dependency in document.dependencies
            ):
                continue
            try:
                await self._convert_one(user_id=user_id, source=source, clip_role=document.implementation.file_role)
            except (ContentDocumentError, ContentValidationError) as exc:
                _log.warning(
                    "Local Action still names a merged Avatar Effect",
                    code=getattr(exc, "code", "avatar_effect_merge_failed"),
                    item_id=source.id,
                )

    async def _convert_one(self, *, user_id: str, source: CatalogContentEntry, clip_role: str | None) -> None:
        catalog = self._content.mutations.catalog
        descriptor_file = _file(source, lambda file: file.role == "descriptor")
        clip_file = _file(source, lambda file: file.role == (clip_role or "sequence"))
        # The operation ID depends only on the exact source revision, so a retry
        # after a crash resumes the same journal entry instead of rewriting twice.
        digest = mutation_digest({"avatar_effect_merge": source.id, "revision": source.revision_sha256})
        operation_id = f"avatar-effect-merge-{digest[:32]}"

        async def rewrite(before: CatalogContentEntry = source) -> AvatarEffectMergeTransitionResult:
            current = await catalog.get_visible_item(item_id=before.id, user_id=user_id, for_update=True)
            if current is None or current.revision_sha256 != before.revision_sha256:
                raise ContentConflictError("content_transition_source_changed")
            store = cast(LocalContentStore, self._content.mutations.store)
            await asyncio.to_thread(
                store.retain_transition_originals, operation_id=operation_id, entry=before, binding_facts=[]
            )
            await asyncio.to_thread(self._publish, before, descriptor_file, clip_file)
            await self._content.rescan(user_id=user_id, include_included=False)
            return AvatarEffectMergeTransitionResult(before.id, before.revision_sha256 or "")

        await self._content.mutations.run(
            user_id=user_id,
            operation_id=operation_id,
            request_digest=digest,
            result_type=AvatarEffectMergeTransitionResult,
            action=rewrite,
        )

    def _publish(
        self, source: CatalogContentEntry, descriptor_file: CatalogContentFile, clip_file: CatalogContentFile
    ) -> None:
        """Rewrite the descriptor and clip and republish every other verified file unchanged."""
        store = self._content.mutations.store
        with ExitStack() as stack:

            def open_file(file: CatalogContentFile) -> tuple[BinaryIO, int]:
                opened = store.open_verified_file(
                    source=file.source,
                    source_mount_id=file.source_mount_id,
                    relative_path=file.relative_path,
                    expected_size_bytes=file.size_bytes,
                    expected_sha256=file.sha256,
                    media_type=file.media_type,
                )
                stack.callback(opened.handle.close)
                return opened.handle, opened.size_bytes

            descriptor_raw = _read_json(open_file(descriptor_file)[0], _MAX_DESCRIPTOR_BYTES)
            clip_raw = _read_json(open_file(clip_file)[0], _MAX_CLIP_BYTES)
            rewritten = rewrite_action_effect_merges(descriptor_raw[0], clip_raw[0], self._merges)
            if rewritten is None:
                return
            descriptor = (json.dumps(rewritten[0], ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            clip = _dump_like(rewritten[1], clip_raw[1]).encode("utf-8")
            if len(clip) > _MAX_CLIP_BYTES:
                raise ContentDocumentError("avatar_effect_merge_limits", "The rewritten clip is too large")
            clip_name = str(PurePosixPath(clip_file.relative_path).relative_to(source.relative_locator))
            companions: dict[str, tuple[BinaryIO, int]] = {clip_name: (BytesIO(clip), len(clip))}
            for file in source.files:
                if file.role in {"descriptor", "metadata"} or file.relative_path == clip_file.relative_path:
                    continue
                name = str(PurePosixPath(file.relative_path).relative_to(source.relative_locator))
                companions[name] = open_file(file)
            store.save_descriptor_entry_streams(
                kind=source.kind,
                relative_locator=source.relative_locator,
                descriptor=descriptor,
                companion_files=companions,
            )


def _file(source: CatalogContentEntry, matches: Any) -> CatalogContentFile:
    found = [
        file
        for file in source.files
        if matches(file) and str(PurePosixPath(file.relative_path).parent) == source.relative_locator
    ]
    if len(found) != 1:
        raise ContentDocumentError("avatar_effect_merge_folder_required", "The Action needs a descriptor folder")
    return found[0]


def _read_json(handle: BinaryIO, limit: int) -> tuple[dict[str, Any], str]:
    raw = handle.read(limit + 1)
    if len(raw) > limit:
        raise ContentDocumentError("avatar_effect_merge_limits", "The Action file is too large")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise ContentDocumentError("avatar_effect_merge_failed", "The Action file is not valid JSON") from exc
    if not isinstance(value, dict):
        raise ContentDocumentError("avatar_effect_merge_failed", "The Action file is not a JSON object")
    return value, text


def _dump_like(value: dict[str, Any], original: str) -> str:
    """Serialize like the original file: two-space indent or compact."""
    newline = "\n" if original.endswith("\n") else ""
    if original.lstrip().startswith("{\n"):
        return json.dumps(value, ensure_ascii=False, indent=2) + newline
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")) + newline


__all__ = ["AvatarEffectMergeTransitionResult", "AvatarEffectMergeTransitionService"]
