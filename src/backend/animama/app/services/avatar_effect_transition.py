"""Convert Local ``animama/avatar-effect/1`` effects to ``/2`` in place.

Runs with the other content transitions at startup, on ``POST /v1/content:rescan``
and from ``uv run python -m animama.server.content_cli``. Each conversion keeps
the effect's folder, content ID, files and every other descriptor field; only
``definition`` changes. The original bytes are retained under the transition
journal before the descriptor is replaced, and a failed conversion is reported
to the caller, which records it on the item.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import BinaryIO

from animama.app.services.avatar_effect_conversion import (
    OFFSET_MIRRORED,
    convert_avatar_effect_definition,
    is_unconverted_avatar_effect,
    mirrors_offset_differently,
)
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_capabilities import MAX_DEFINITION_BYTES
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
from animama.domain.content_documents import ContentDocumentError
from animama.logging import get_logger

_log = get_logger("app.services.avatar_effect_transition")


@dataclass(frozen=True, slots=True)
class AvatarEffectTransitionResult:
    """Receipt for one identity-preserving Avatar Effect conversion."""

    item_id: str
    source_revision: str


class AvatarEffectTransitionService:
    """Convert Local ``/1`` Avatar Effects under the shared mutation authority."""

    def __init__(self, *, content: ContentCatalogService) -> None:
        self._content = content

    async def convert(self, *, user_id: str) -> list[tuple[CatalogContentEntry, str]]:
        """Return safe per-item failure codes; uncertain recovery conflicts propagate."""
        catalog = self._content.mutations.catalog
        failures: list[tuple[CatalogContentEntry, str]] = []
        for source in await catalog.list_visible(user_id=user_id):
            if (
                source.kind is not ContentKind.AVATAR_EFFECT
                or source.status is not ContentStatus.VALID
                or source.source is not ContentSource.LOCAL
            ):
                continue
            try:
                document = TypedContentService.parse(source).document
            except Exception:  # An unreadable item stays reported by the scan.
                continue
            if not is_unconverted_avatar_effect(document):
                continue
            try:
                # Check the definition before any journal work, so a malformed
                # effect is only reported and its files stay untouched.
                definition = getattr(document, "definition", None)
                convert_avatar_effect_definition(definition)
                await self._convert_one(user_id=user_id, source=source)
                if mirrors_offset_differently(definition):
                    # Visible change: /2 mirrors the other eye's lateral offset.
                    _log.warning(
                        "Converted Avatar Effect now mirrors its eye offset",
                        code=OFFSET_MIRRORED,
                        item_id=source.id,
                    )
            except ContentDocumentError as exc:
                failures.append((source, exc.code))
            except ContentValidationError:
                failures.append((source, "avatar_effect_conversion_limits"))
        return failures

    async def _convert_one(self, *, user_id: str, source: CatalogContentEntry) -> None:
        catalog = self._content.mutations.catalog
        descriptor_file = next(
            (
                file
                for file in source.files
                if file.role == "descriptor"
                and str(PurePosixPath(file.relative_path).parent) == source.relative_locator
            ),
            None,
        )
        if descriptor_file is None:
            raise ContentDocumentError(
                "avatar_effect_conversion_folder_required", "Avatar Effect needs a descriptor folder"
            )
        # The operation ID depends only on the exact source revision, so a retry
        # after a crash resumes the same journal entry instead of converting twice.
        digest = mutation_digest({"avatar_effect": source.id, "revision": source.revision_sha256})
        operation_id = f"avatar-effect-v2-{digest[:32]}"

        async def convert(before: CatalogContentEntry = source) -> AvatarEffectTransitionResult:
            current = await catalog.get_visible_item(item_id=before.id, user_id=user_id, for_update=True)
            if current is None or current.revision_sha256 != before.revision_sha256:
                raise ContentConflictError("content_transition_source_changed")
            store = self._content.mutations.store
            await asyncio.to_thread(
                store.retain_transition_originals, operation_id=operation_id, entry=before, binding_facts=[]
            )
            await asyncio.to_thread(self._publish, before, descriptor_file)
            await self._content.rescan(user_id=user_id, include_included=False)
            return AvatarEffectTransitionResult(before.id, before.revision_sha256 or "")

        await self._content.mutations.run(
            user_id=user_id,
            operation_id=operation_id,
            request_digest=digest,
            result_type=AvatarEffectTransitionResult,
            action=convert,
        )

    def _publish(self, source: CatalogContentEntry, descriptor_file: CatalogContentFile) -> None:
        """Rewrite only ``definition`` and republish the verified companion files unchanged."""
        store = self._content.mutations.store
        with ExitStack() as stack:
            opened = store.open_verified_file(
                source=descriptor_file.source,
                source_mount_id=descriptor_file.source_mount_id,
                relative_path=descriptor_file.relative_path,
                expected_size_bytes=descriptor_file.size_bytes,
                expected_sha256=descriptor_file.sha256,
                media_type=descriptor_file.media_type,
            )
            stack.callback(opened.handle.close)
            raw = opened.handle.read(MAX_DEFINITION_BYTES + 1)
            if len(raw) > MAX_DEFINITION_BYTES:
                raise ContentDocumentError("avatar_effect_conversion_limits", "Avatar Effect descriptor is too large")
            try:
                payload = json.loads(raw)
            except (ValueError, UnicodeError, RecursionError) as exc:
                raise ContentDocumentError(
                    "avatar_effect_conversion_failed", "Avatar Effect descriptor is not valid JSON"
                ) from exc
            if not isinstance(payload, dict):
                raise ContentDocumentError("avatar_effect_conversion_failed", "Avatar Effect descriptor is invalid")
            payload["definition"] = convert_avatar_effect_definition(payload.get("definition"))
            descriptor = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            companions: dict[str, tuple[BinaryIO, int]] = {}
            for file in source.files:
                if file.role in {"descriptor", "metadata"}:
                    continue
                handle = store.open_verified_file(
                    source=file.source,
                    source_mount_id=file.source_mount_id,
                    relative_path=file.relative_path,
                    expected_size_bytes=file.size_bytes,
                    expected_sha256=file.sha256,
                    media_type=file.media_type,
                )
                stack.callback(handle.handle.close)
                name = str(PurePosixPath(file.relative_path).relative_to(source.relative_locator))
                companions[name] = (handle.handle, handle.size_bytes)
            store.save_descriptor_entry_streams(
                kind=source.kind,
                relative_locator=source.relative_locator,
                descriptor=descriptor,
                companion_files=companions,
            )


__all__ = ["AvatarEffectTransitionResult", "AvatarEffectTransitionService"]
