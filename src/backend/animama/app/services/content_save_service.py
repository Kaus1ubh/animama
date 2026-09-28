"""Direct creator Save use cases for the readable Local library."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import BinaryIO

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
from animama.app.services.local_content_mutations import mutation_digest
from animama.app.services.typed_content_service import TypedContentService, validate_idle_style
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
from animama.domain.content_documents import IdleStyleDocumentV2

_ENTRY_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$")


def readable_entry_name(value: str) -> str:
    """Normalize a display name to one portable, understandable path segment."""

    stripped = value.strip()
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
            raise ContentConflictError("saved_content_invalid", field=invalid_field)
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
            document = (
                handler_for_kind(kind)
                .parse_document(json.loads(descriptor), fallback_path=Path(entry_name), descriptor_backed=True)
                .document
            )
            if any(dependency.kind in RETIRED_CONTENT_KINDS for dependency in document.dependencies):
                raise ContentConflictError("content_dependency_retired")

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
            if kind is ContentKind.IDLE_STYLE:
                document = (
                    handler_for_kind(kind)
                    .parse_document(
                        json.loads(descriptor),
                        fallback_path=Path(relative_locator),
                        descriptor_backed=True,
                    )
                    .document
                )
                if not isinstance(document, IdleStyleDocumentV2):
                    raise ContentConflictError("idle_style_conversion_required")
                await validate_idle_style(
                    document=document,
                    visible={item.id: item for item in await self._catalog.list_visible(user_id=user_id)},
                    store=self._store,
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

        return await self._content.mutations.run(
            user_id=user_id,
            operation_id=operation_id,
            request_digest=request_digest,
            result_type=SavedContent,
            action=apply,
        )


def _sha256_stream(stream: BinaryIO) -> str:
    """Hash from the current position using bounded reads."""
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(256 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


__all__ = ["ContentSaveService", "readable_entry_name"]
