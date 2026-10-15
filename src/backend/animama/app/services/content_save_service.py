"""Direct creator Save use cases for the readable Local library."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO

from animama.app.contracts.avatar_effect import AvatarEffectDefinitionV2, project_avatar_effect_definition
from animama.app.services.avatar_effect_overrides import check_clip_effect_overrides
from animama.app.services.content_access_policy import ContentAccessPolicy
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_gltf import validate_vrm_stream
from animama.app.services.content_image import (
    CanonicalAvatarPortrait,
    CanonicalImage,
    canonicalize_avatar_portrait,
    canonicalize_image_stream,
    validate_appearance_image_stream,
)
from animama.app.services.content_kind_registry import RETIRED_CONTENT_KINDS, definition_for_kind, handler_for_kind
from animama.app.services.content_names import portable_name
from animama.app.services.content_package_capabilities import scene_emoji_items, validate_avatar_effect_document
from animama.app.services.content_portability import reject_restricted_bytes
from animama.app.services.local_content_mutations import mutation_digest
from animama.app.services.typed_content_service import TypedContentResolutionContext, TypedContentService
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentConflictError,
    ContentKind,
    ContentNotFoundError,
    ContentScope,
    ContentSource,
    ContentStatus,
    SavedContent,
)
from animama.domain.content_documents import (
    AvatarEffectDocumentV1,
    ContentDocumentError,
    GestureDocumentV1,
    ReactionDocumentV1,
    SceneEffectDocumentV1,
)

_ENTRY_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$")
# The frontend's MAX_ANIMA_POSE_CLIP_BYTES: no player reads a larger clip.
_MAX_CLIP_BYTES = 2 * 1024 * 1024


def readable_entry_name(value: str) -> str:
    """Normalize a display name to one portable, understandable path segment.

    Names outside ASCII fold to ASCII (accents dropped); names in other scripts
    keep a name hash so different names stay distinct. Invalid ASCII names are
    rejected unchanged.
    """

    stripped = value.strip()
    if not stripped.isascii():
        stripped = portable_name(stripped, separator="-", stem="item", limit=120)
    if not _ENTRY_NAME.fullmatch(stripped):
        raise ContentConflictError("invalid_entry_name", field="name")
    normalized = re.sub(r"[ _]+", "-", stripped).strip("-.").lower()
    if not normalized or normalized in {".", ".."}:
        raise ContentConflictError("invalid_entry_name", field="name")
    return normalized


class ContentSaveService:
    """Write one ordinary Local entry, then authoritatively reconcile it."""

    def __init__(
        self,
        *,
        content: ContentCatalogService,
    ) -> None:
        self._content = content
        self._store = content.mutations.store
        self._catalog = content.mutations.catalog

    async def _preflight(
        self,
        *,
        user_id: str,
        kind: ContentKind,
        relative_locator: str,
        catalog_item_id: str | None,
        expected_revision: str | None,
        rescan: bool = True,
    ) -> tuple[CatalogContentEntry | None, bool]:
        # Reconcile manual host changes before deciding whether a path is safe
        # to replace. A creator must never silently claim an operator file.
        if rescan:
            await self._content.rescan(user_id=user_id, include_included=False)
            await self._catalog.lock_source(source=ContentSource.LOCAL)
            await self._catalog.lock_save(relative_locator=relative_locator)
        existing = await self._catalog.get_by_locator(
            source=ContentSource.LOCAL,
            relative_locator=relative_locator,
        )
        if catalog_item_id is None:
            if existing is not None:
                raise ContentConflictError("content_path_exists", field="name")
            return None, True

        selected = await self._catalog.get_visible_item(item_id=catalog_item_id, user_id=user_id, for_update=True)
        if selected is None or selected.source is not ContentSource.LOCAL:
            raise ContentNotFoundError("Local catalog item was not found")
        if selected.relative_locator != relative_locator or selected.kind is not kind:
            raise ContentConflictError("content_destination_mismatch")
        if not ContentAccessPolicy.can_mutate(entry=selected, user_id=user_id):
            raise ContentNotFoundError("Local catalog item was not found")
        if expected_revision is None or selected.revision_sha256 != expected_revision:
            raise ContentConflictError(
                "catalog_revision_conflict",
                current_revision=selected.revision_sha256,
            )
        return selected, False

    async def _finish(
        self,
        *,
        user_id: str,
        relative_locator: str,
        operation_id: str,
        creator_claim_required: bool,
        invalid_field: str | None,
    ) -> SavedContent:
        # Admit ownership in the same reconciliation commit: a new upload must
        # never briefly appear as installation-shared content in network mode.
        await self._content.rescan(
            user_id=user_id,
            include_included=False,
            creator_claim_locator=relative_locator if creator_claim_required else None,
        )
        item = await self._catalog.get_by_locator(
            source=ContentSource.LOCAL,
            relative_locator=relative_locator,
        )
        if item is None:
            raise ContentNotFoundError("Saved Local content was not discovered")
        if creator_claim_required:
            if item.owner_user_id != user_id:
                raise ContentConflictError("content_creator_claim_conflict")
        if item.status is not ContentStatus.VALID:
            codes = {diagnostic.code for diagnostic in item.diagnostics}
            # Name policy refusals the editors can explain (effect creators
            # highlight their sound control); the save rolls back.
            if "non_portable_dependency" in codes:
                raise ContentConflictError("content_non_portable_dependency")
            if "dependency_optional_not_allowed" in codes:
                raise ContentConflictError("content_optional_dependency")
            raise ContentConflictError("saved_content_invalid", field=invalid_field)
        if item.missing_dependencies:
            # Only an Action saved before an Included effect was removed may
            # outlive it; a Save names content that exists.
            raise ContentConflictError("saved_content_invalid", field="dependencies")
        return SavedContent(operation_id=operation_id, item=item)

    async def save_standalone(
        self,
        *,
        user_id: str,
        kind: ContentKind,
        entry_name: str,
        filename: str,
        payload: bytes,
        metadata_sidecar: bytes | None,
        operation_id: str,
        catalog_item_id: str | None,
        expected_revision: str | None,
    ) -> SavedContent:
        return await self.save_standalone_stream(
            user_id=user_id,
            kind=kind,
            entry_name=entry_name,
            filename=filename,
            payload_stream=BytesIO(payload),
            payload_size_bytes=len(payload),
            metadata_sidecar=metadata_sidecar,
            operation_id=operation_id,
            catalog_item_id=catalog_item_id,
            expected_revision=expected_revision,
        )

    async def save_standalone_stream(
        self,
        *,
        user_id: str,
        kind: ContentKind,
        entry_name: str,
        filename: str,
        payload_stream: BinaryIO,
        payload_size_bytes: int,
        metadata_sidecar: bytes | None,
        operation_id: str,
        catalog_item_id: str | None,
        expected_revision: str | None,
        declared_content_type: str | None = None,
        creation_context: bool = False,
        portrait_source: tuple[str, str] | None = None,
    ) -> SavedContent:
        request_digest = await asyncio.to_thread(
            mutation_digest,
            {
                "operation": "save_standalone",
                "kind": kind.value,
                "entry_name": entry_name,
                "filename": filename,
                "size": payload_size_bytes,
                "metadata": hashlib.sha256(metadata_sidecar).hexdigest() if metadata_sidecar is not None else None,
                "catalog_item_id": catalog_item_id,
                "expected_revision": expected_revision,
                "declared_content_type": declared_content_type,
                "creation_context": creation_context,
                "portrait_source": portrait_source,
            },
            (payload_stream,),
        )

        async def apply() -> SavedContent:
            nonlocal payload_stream, payload_size_bytes, metadata_sidecar

            if kind in RETIRED_CONTENT_KINDS:
                raise ContentConflictError("content_kind_retired")
            await asyncio.to_thread(
                reject_restricted_bytes, self._store.restricted_sha256, (payload_stream,), (metadata_sidecar,)
            )

            if metadata_sidecar is not None:
                document = (
                    handler_for_kind(kind)
                    .parse_document(json.loads(metadata_sidecar), fallback_path=Path(filename), descriptor_backed=False)
                    .document
                )
                if any(dependency.kind in RETIRED_CONTENT_KINDS for dependency in document.dependencies):
                    raise ContentConflictError("content_dependency_retired")

            if portrait_source is not None:
                if kind is not ContentKind.APPEARANCE:
                    raise ContentConflictError("portrait_requires_appearance")
                avatar_id, avatar_revision = portrait_source
                avatar = await self._catalog.get_visible_item(item_id=avatar_id, user_id=user_id)
                if avatar is None or avatar.kind is not ContentKind.AVATAR or avatar.status is not ContentStatus.VALID:
                    raise ContentNotFoundError("typed catalog item was not found")
                if avatar.revision_sha256 != avatar_revision:
                    raise ContentConflictError("catalog_revision_conflict", current_revision=avatar.revision_sha256)
                document = TypedContentService.parse(avatar).document
                metadata_sidecar = json.dumps(
                    {
                        "name": f"{document.name} portrait",
                        "avatar_model": PurePosixPath(avatar.relative_locator).stem,
                        "presentation": {"avatar_item_id": avatar.id},
                    }
                ).encode()
            definition = definition_for_kind(kind)
            suffix = PurePosixPath(filename).suffix.lower()
            if suffix not in definition.standalone_extensions:
                raise ContentConflictError("unsupported_standalone_extension", field="files")
            model_sha256 = None
            if kind is ContentKind.AVATAR:
                # Validate and hash before reserving a destination or writing files.
                await asyncio.to_thread(validate_vrm_stream, content=payload_stream, size_bytes=payload_size_bytes)
                payload_stream.seek(0)
                model_sha256 = await asyncio.to_thread(_sha256_stream, payload_stream)
                payload_stream.seek(0)
            if kind is ContentKind.APPEARANCE:
                await asyncio.to_thread(
                    validate_appearance_image_stream,
                    extension=suffix,
                    content=payload_stream,
                    size_bytes=payload_size_bytes,
                    declared_content_type=declared_content_type,
                )
                canonical: CanonicalAvatarPortrait | CanonicalImage
                canonical = (
                    await asyncio.to_thread(canonicalize_avatar_portrait, content=payload_stream)
                    if portrait_source is not None
                    else await asyncio.to_thread(canonicalize_image_stream, extension=suffix, content=payload_stream)
                )
                payload_stream = BytesIO(canonical.content)
                payload_size_bytes = len(canonical.content)
                suffix = ".webp"
                metadata = json.loads(metadata_sidecar) if metadata_sidecar else {}
                if not isinstance(metadata, dict):
                    raise ContentConflictError("invalid_image_metadata")
                metadata.update({"width": canonical.width, "height": canonical.height})
                metadata_sidecar = json.dumps(metadata, ensure_ascii=False).encode("utf-8")
            relative_locator = f"{definition.directory}/{readable_entry_name(entry_name)}{suffix}"
            if catalog_item_id is not None:
                selected = await self._catalog.get_visible_item(item_id=catalog_item_id, user_id=user_id)
                if selected is not None:
                    relative_locator = selected.relative_locator
                    if PurePosixPath(relative_locator).suffix.lower() != suffix:
                        raise ContentConflictError(
                            "standalone_extension_change_requires_new_item",
                            field="files",
                        )
            await self._content.rescan(user_id=user_id, include_included=False)
            await self._catalog.lock_source(source=ContentSource.LOCAL)
            await self._catalog.lock_save(
                relative_locator=relative_locator, owner_digest=f"{user_id}:{model_sha256}" if model_sha256 else None
            )
            if model_sha256 is not None and catalog_item_id is None:
                matches = [
                    item
                    for item in await self._catalog.list_visible(user_id=user_id)
                    if item.kind is ContentKind.AVATAR
                    and item.source is ContentSource.LOCAL
                    and item.scope is ContentScope.OWNER
                    and item.owner_user_id == user_id
                    and item.status is ContentStatus.VALID
                    and any(
                        file.role == "model" and file.sha256 == model_sha256 and file.size_bytes == payload_size_bytes
                        for file in item.files
                    )
                ]
                for match in sorted(matches, key=lambda item: (item.relative_locator != relative_locator, item.id)):
                    current = await self._catalog.get_visible_item(item_id=match.id, user_id=user_id, for_update=True)
                    if (
                        current is not None
                        and current.status is ContentStatus.VALID
                        and current.revision_sha256 == match.revision_sha256
                    ):
                        return SavedContent(operation_id=operation_id, item=current)
            _, new_item = await self._preflight(
                user_id=user_id,
                kind=kind,
                relative_locator=relative_locator,
                catalog_item_id=catalog_item_id,
                expected_revision=expected_revision,
                rescan=False,
            )
            if (
                creation_context
                and kind is ContentKind.AVATAR
                and catalog_item_id is not None
                and await self._catalog.item_has_live_animas(item_id=catalog_item_id)
            ):
                raise ContentConflictError("avatar_in_use_choose_new_name", field="name")
            stored_operation_id = await asyncio.to_thread(
                self._store.save_standalone_stream,
                kind=kind,
                relative_locator=relative_locator,
                payload_stream=payload_stream,
                payload_size_bytes=payload_size_bytes,
                metadata_sidecar=metadata_sidecar,
                operation_id=operation_id,
            )
            return await self._finish(
                user_id=user_id,
                relative_locator=relative_locator,
                operation_id=stored_operation_id,
                creator_claim_required=new_item,
                invalid_field="files",
            )

        self._content.require_owner(user_id)
        return await self._content.mutations.run(
            user_id=user_id,
            operation_id=operation_id,
            request_digest=request_digest,
            result_type=SavedContent,
            action=apply,
        )

    async def save_descriptor(
        self,
        *,
        user_id: str,
        kind: ContentKind,
        entry_name: str,
        descriptor: bytes,
        companion_files: dict[str, bytes],
        operation_id: str,
        catalog_item_id: str | None,
        expected_revision: str | None,
    ) -> SavedContent:
        return await self.save_descriptor_streams(
            user_id=user_id,
            kind=kind,
            entry_name=entry_name,
            descriptor=descriptor,
            companion_files={name: (BytesIO(payload), len(payload)) for name, payload in companion_files.items()},
            operation_id=operation_id,
            catalog_item_id=catalog_item_id,
            expected_revision=expected_revision,
        )

    async def save_descriptor_streams(
        self,
        *,
        user_id: str,
        kind: ContentKind,
        entry_name: str,
        descriptor: bytes,
        companion_files: dict[str, tuple[BinaryIO, int]],
        operation_id: str,
        catalog_item_id: str | None,
        expected_revision: str | None,
        companion_media_types: dict[str, str | None] | None = None,
    ) -> SavedContent:
        paths = sorted(companion_files)
        request_digest = await asyncio.to_thread(
            mutation_digest,
            {
                "operation": "save_descriptor",
                "kind": kind.value,
                "entry_name": entry_name,
                "descriptor": hashlib.sha256(descriptor).hexdigest(),
                "files": [(path, companion_files[path][1]) for path in paths],
                "catalog_item_id": catalog_item_id,
                "expected_revision": expected_revision,
                "companion_media_types": companion_media_types or {},
            },
            tuple(companion_files[path][0] for path in paths),
        )

        async def apply() -> SavedContent:
            nonlocal descriptor, companion_files

            if kind in RETIRED_CONTENT_KINDS:
                raise ContentConflictError("content_kind_retired")
            await asyncio.to_thread(
                reject_restricted_bytes,
                self._store.restricted_sha256,
                (stream for stream, _ in companion_files.values()),
                (descriptor,),
            )
            document = (
                handler_for_kind(kind)
                .parse_document(json.loads(descriptor), fallback_path=Path(entry_name), descriptor_backed=True)
                .document
            )
            if any(dependency.kind in RETIRED_CONTENT_KINDS for dependency in document.dependencies):
                raise ContentConflictError("content_dependency_retired")
            if kind is ContentKind.AVATAR_EFFECT:
                # Save admits exactly what package export accepts, so a saved
                # effect can always be shared; the error names the JSON field.
                if not isinstance(document, AvatarEffectDocumentV1):
                    raise ContentDocumentError(
                        "avatar_effect_definition_invalid", "Avatar Effect definition is missing", field="definition"
                    )
                validate_avatar_effect_document(document, code="avatar_effect_definition_invalid")
            if isinstance(document, GestureDocumentV1 | ReactionDocumentV1):
                await self._check_effect_overrides(user_id=user_id, document=document, companion_files=companion_files)
            if isinstance(document, SceneEffectDocumentV1):
                # Animama no longer provides Twemoji: only Scenes saved before
                # its removal outlive an emoji item, and Save names the first.
                emoji_items = scene_emoji_items(document.definition)
                if emoji_items:
                    raise ContentConflictError("saved_content_invalid", field=emoji_items[0][0])

            definition = definition_for_kind(kind)
            if definition.descriptor_suffix is None:
                raise ContentConflictError("descriptor_not_supported")
            if kind is ContentKind.APPEARANCE:
                if len(companion_files) != 1:
                    raise ContentConflictError("appearance_requires_one_image", field="files")
                filename, (stream, size) = next(iter(companion_files.items()))
                extension = PurePosixPath(filename).suffix
                await asyncio.to_thread(
                    validate_appearance_image_stream,
                    extension=extension,
                    content=stream,
                    size_bytes=size,
                    declared_content_type=(companion_media_types or {}).get(filename),
                )
                canonical = await asyncio.to_thread(canonicalize_image_stream, extension=extension, content=stream)
                metadata = json.loads(descriptor)
                if not isinstance(metadata, dict):
                    raise ContentConflictError("invalid_image_metadata")
                metadata.update(
                    {
                        "width": canonical.width,
                        "height": canonical.height,
                        "files": [{"path": "image.webp", "role": "image"}],
                    }
                )
                descriptor = json.dumps(metadata, ensure_ascii=False).encode("utf-8")
                companion_files = {"image.webp": (BytesIO(canonical.content), len(canonical.content))}
            relative_locator = f"{definition.directory}/{readable_entry_name(entry_name)}"
            if catalog_item_id is not None:
                selected = await self._catalog.get_visible_item(item_id=catalog_item_id, user_id=user_id)
                if selected is not None:
                    relative_locator = selected.relative_locator
            _, new_item = await self._preflight(
                user_id=user_id,
                kind=kind,
                relative_locator=relative_locator,
                catalog_item_id=catalog_item_id,
                expected_revision=expected_revision,
            )
            stored_operation_id = await asyncio.to_thread(
                self._store.save_descriptor_entry_streams,
                kind=kind,
                relative_locator=relative_locator,
                descriptor=descriptor,
                companion_files=companion_files,
                operation_id=operation_id,
            )
            return await self._finish(
                user_id=user_id,
                relative_locator=relative_locator,
                operation_id=stored_operation_id,
                creator_claim_required=new_item,
                invalid_field=None,
            )

        self._content.require_owner(user_id)
        return await self._content.mutations.run(
            user_id=user_id,
            operation_id=operation_id,
            request_digest=request_digest,
            result_type=SavedContent,
            action=apply,
        )

    async def _check_effect_overrides(
        self,
        *,
        user_id: str,
        document: GestureDocumentV1 | ReactionDocumentV1,
        companion_files: dict[str, tuple[BinaryIO, int]],
    ) -> None:
        """Refuse a per-use effect override that its effect cannot play, naming the field.

        Only clips with overrides read the catalog. An effect the owner cannot
        see is skipped here, so Save names the missing dependency instead.
        """
        implementation = document.implementation
        if implementation.kind != "anima_clip":
            return
        paths = [file.path for file in document.files if file.role == implementation.file_role]
        if len(paths) != 1 or paths[0] not in companion_files:
            return
        stream, size = companion_files[paths[0]]
        if size > _MAX_CLIP_BYTES:
            return
        start = stream.tell()
        try:
            clip = await asyncio.to_thread(_read_json, stream)
        finally:
            stream.seek(start)
        events = clip.get("events") if isinstance(clip, dict) else None
        if not isinstance(events, list) or not any(
            isinstance(event, dict) and event.get("kind") == "avatar_vfx" and "override" in event for event in events
        ):
            return
        visible = {item.id: item for item in await self._catalog.list_visible(user_id=user_id)}
        context = TypedContentResolutionContext(visible)
        effects: dict[str, AvatarEffectDefinitionV2 | None] = {}
        for dependency in document.dependencies:
            if dependency.kind is not ContentKind.AVATAR_EFFECT:
                continue
            ids = context.logical_index.get(dependency.ref) or context.locator_index.get(dependency.ref) or ()
            if len(ids) != 1:
                continue
            definition = project_avatar_effect_definition(visible[ids[0]].metadata.get("definition"))[0]
            for selector in (dependency.alias, dependency.ref):
                if selector:
                    effects[selector] = definition
        check_clip_effect_overrides(clip, effects, code="action_effect_override_invalid")


def _read_json(stream: BinaryIO) -> Any:  # noqa: ANN401
    """Parse a JSON companion from its current position; ``None`` when it is not JSON."""
    try:
        return json.loads(stream.read())
    except (ValueError, UnicodeError, RecursionError):
        return None


def _sha256_stream(stream: BinaryIO) -> str:
    """Hash from the current position using bounded reads."""
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(256 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


__all__ = ["ContentSaveService", "readable_entry_name"]
