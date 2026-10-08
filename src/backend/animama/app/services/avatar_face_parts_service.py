"""Read and save an Avatar's face-part correction for one owner.

A Local Avatar keeps its correction as ``face_parts`` in its ``.meta.json``
sidecar, so saving it produces a new Avatar revision through the ordinary
atomic Local Save. An Included Avatar is immutable; the owner's correction is
an override row bound to the Avatar revision it was saved against.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Iterable
from typing import Any
from uuid import uuid4

from animama.app.contracts.avatar_face_parts import (
    AvatarFacePartCorrection,
    AvatarFacePartsState,
    AvatarFacePartsUpdate,
)
from animama.app.ports.avatar_face_parts import AvatarFacePartOverrideRepository
from animama.app.ports.content_catalog import ContentCatalog
from animama.app.ports.content_store import ContentStore
from animama.app.services.avatar_face_parts import (
    EffectiveFaceParts,
    correction_json,
    effective_face_parts,
    model_sha256,
)
from animama.app.services.content_access_policy import ContentAccessPolicy
from animama.app.services.content_kind_registry import MAX_JSON_BYTES
from animama.app.services.content_save_service import ContentSaveService
from animama.app.services.typed_content_service import TypedCatalogItem, TypedContentService
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentConflictError,
    ContentIntegrityError,
    ContentKind,
    ContentNotFoundError,
    ContentPathError,
    ContentSource,
    ContentStatus,
)
from animama.domain.content_documents import AvatarDocumentV1, ContentDocumentError


def _state(item: CatalogContentEntry, effective: EffectiveFaceParts) -> AvatarFacePartsState:
    return AvatarFacePartsState(
        item_id=item.id,
        revision=item.revision_sha256 or "",
        source=effective.source,
        face_parts=(
            AvatarFacePartCorrection.model_validate(effective.face_parts) if effective.face_parts is not None else None
        ),
    )


def _registered(item: CatalogContentEntry, role: str) -> CatalogContentFile | None:
    files = [file for file in item.files if file.role == role]
    if len(files) > 1:
        raise ContentConflictError("avatar_files_ambiguous")
    return files[0] if files else None


class AvatarFacePartsService:
    """Owner-scoped face-part authority for current admitted Avatars."""

    def __init__(
        self,
        *,
        catalog: ContentCatalog,
        overrides: AvatarFacePartOverrideRepository,
        store: ContentStore | None = None,
        saves: ContentSaveService | None = None,
        commit: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self._catalog = catalog
        self._overrides = overrides
        self._store = store
        self._saves = saves
        self._commit = commit

    async def effective_for_items(
        self, *, user_id: str, items: Iterable[TypedCatalogItem]
    ) -> dict[str, EffectiveFaceParts]:
        """Resolve many typed Avatars with at most one override query."""

        avatars = [value for value in items if isinstance(value.document, AvatarDocumentV1)]
        overrides = await self._overrides.list_for_items(
            owner_user_id=user_id,
            avatar_item_ids=[value.item.id for value in avatars if value.item.source is ContentSource.INCLUDED],
        )
        result: dict[str, EffectiveFaceParts] = {}
        for value in avatars:
            assert isinstance(value.document, AvatarDocumentV1)
            result[value.item.id] = effective_face_parts(
                item=value.item, document=value.document, override=overrides.get(value.item.id)
            )
        return result

    async def _avatar(self, *, user_id: str, item_id: str) -> tuple[CatalogContentEntry, AvatarDocumentV1]:
        item = await self._catalog.get_visible_item(item_id=item_id, user_id=user_id)
        if (
            item is None
            or item.kind is not ContentKind.AVATAR
            or item.status is not ContentStatus.VALID
            or item.revision_sha256 is None
        ):
            raise ContentNotFoundError("typed catalog item was not found")
        document = TypedContentService.parse(item).document
        if not isinstance(document, AvatarDocumentV1):
            raise ContentNotFoundError("typed catalog item was not found")
        return item, document

    async def get(self, *, user_id: str, item_id: str) -> AvatarFacePartsState:
        """Return the effective correction for the Avatar's current revision."""

        item, document = await self._avatar(user_id=user_id, item_id=item_id)
        overrides = (
            await self._overrides.list_for_items(owner_user_id=user_id, avatar_item_ids=[item.id])
            if item.source is ContentSource.INCLUDED
            else {}
        )
        return _state(item, effective_face_parts(item=item, document=document, override=overrides.get(item.id)))

    async def save(self, *, user_id: str, item_id: str, update: AvatarFacePartsUpdate) -> AvatarFacePartsState:
        """Replace or clear the correction for exactly ``update.expected_revision``.

        Raises ``ContentNotFoundError`` for an unknown, invalid or non-editable
        Avatar, ``ContentConflictError("catalog_revision_conflict")`` for a stale
        revision and ``ContentDocumentError("avatar_face_parts_digest_mismatch")``
        when the correction targets different VRM bytes.
        """

        item, document = await self._avatar(user_id=user_id, item_id=item_id)
        if item.revision_sha256 != update.expected_revision:
            raise ContentConflictError("catalog_revision_conflict", current_revision=item.revision_sha256)
        desired: dict[str, Any] | None = None
        if update.face_parts is not None:
            if update.face_parts.vrm_sha256 != model_sha256(item.files):
                raise ContentDocumentError(
                    "avatar_face_parts_digest_mismatch",
                    "face_parts.vrm_sha256 does not match this Avatar's VRM model file",
                    field="face_parts.vrm_sha256",
                )
            desired = correction_json(update.face_parts)
        if item.source is ContentSource.LOCAL:
            return await self._save_local(user_id=user_id, item=item, document=document, desired=desired)
        return await self._save_included(user_id=user_id, item=item, document=document, desired=desired)

    async def _save_included(
        self,
        *,
        user_id: str,
        item: CatalogContentEntry,
        document: AvatarDocumentV1,
        desired: dict[str, Any] | None,
    ) -> AvatarFacePartsState:
        """Store the owner's override; Included bytes and revision never change."""

        assert item.revision_sha256 is not None
        if desired is None:
            await self._overrides.delete(owner_user_id=user_id, avatar_item_id=item.id)
        else:
            await self._overrides.upsert(
                owner_user_id=user_id,
                avatar_item_id=item.id,
                avatar_revision_sha256=item.revision_sha256,
                parts=desired,
            )
        if self._commit is not None:
            await self._commit()
        overrides = await self._overrides.list_for_items(owner_user_id=user_id, avatar_item_ids=[item.id])
        return _state(item, effective_face_parts(item=item, document=document, override=overrides.get(item.id)))

    async def _save_local(
        self,
        *,
        user_id: str,
        item: CatalogContentEntry,
        document: AvatarDocumentV1,
        desired: dict[str, Any] | None,
    ) -> AvatarFacePartsState:
        """Rewrite the sidecar through the atomic Local Save, keeping identity and VRM bytes.

        Other sidecar keys are preserved byte-for-value. The Save re-checks the
        expected revision under the Local source lock, so a concurrent edit
        becomes a revision conflict instead of a lost update.
        """

        if self._store is None or self._saves is None:
            raise RuntimeError("Local face-part saves require the content store and Save service")
        if not ContentAccessPolicy.can_mutate(entry=item, user_id=user_id):
            raise ContentNotFoundError("Local catalog item was not found")
        if desired == document.face_parts:
            # Nothing would change; do not mint a new revision for a no-op.
            return _state(item, effective_face_parts(item=item, document=document, override=None))
        model = _registered(item, "model")
        if model is None:
            raise ContentNotFoundError("typed catalog item was not found")
        sidecar = await asyncio.to_thread(self._read_sidecar, item)
        if desired is None:
            sidecar.pop("face_parts", None)
        else:
            sidecar["face_parts"] = desired
        metadata = (json.dumps(sidecar, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if len(metadata) > MAX_JSON_BYTES:
            raise ContentConflictError("content_metadata_too_large", field="face_parts")
        opened = await asyncio.to_thread(self._open, item, model)
        try:
            saved = await self._saves.save_standalone_stream(
                user_id=user_id,
                kind=ContentKind.AVATAR,
                # The selected item's locator wins; this only satisfies name validation.
                entry_name="avatar",
                filename=model.relative_path.rsplit("/", 1)[-1],
                payload_stream=opened,
                payload_size_bytes=model.size_bytes,
                metadata_sidecar=metadata,
                operation_id=f"avatar-face-parts:{uuid4().hex}",
                catalog_item_id=item.id,
                expected_revision=item.revision_sha256,
            )
        finally:
            opened.close()
        saved_document = TypedContentService.parse(saved.item).document
        assert isinstance(saved_document, AvatarDocumentV1)
        return _state(saved.item, effective_face_parts(item=saved.item, document=saved_document, override=None))

    def _open(self, item: CatalogContentEntry, file: CatalogContentFile) -> Any:
        """Open one registered file, mapping drift since the catalog read to a revision conflict."""

        assert self._store is not None
        try:
            return self._store.open_verified_file(
                source=file.source,
                source_mount_id=file.source_mount_id,
                relative_path=file.relative_path,
                expected_size_bytes=file.size_bytes,
                expected_sha256=file.sha256,
                media_type=file.media_type,
            ).handle
        except (ContentIntegrityError, ContentPathError) as exc:
            raise ContentConflictError("catalog_revision_conflict", current_revision=item.revision_sha256) from exc

    def _read_sidecar(self, item: CatalogContentEntry) -> dict[str, Any]:
        """Return the raw sidecar object (not the normalized projection), or ``{}`` if absent."""

        metadata = _registered(item, "metadata")
        if metadata is None:
            return {}
        with self._open(item, metadata) as handle:
            value = json.loads(handle.read(MAX_JSON_BYTES + 1))
        if not isinstance(value, dict):
            raise ContentConflictError("catalog_revision_conflict", current_revision=item.revision_sha256)
        return value


__all__ = ["AvatarFacePartsService"]
