"""Typed content, portrait and face-part routes over the one editable Content Catalog (ADR 0021)."""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Annotated, Any, BinaryIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from animama.app.contracts.avatar_face_parts import (
    AvatarFacePartCorrection,
    AvatarFacePartsState,
    AvatarFacePartsUpdate,
)
from animama.app.contracts.idle import PyIdlePlayback
from animama.app.contracts.typed_content import (
    PyAppearance,
    PyAppearancePage,
    PyAvatarContent,
    PyAvatarContentPage,
    PyAvatarEffect,
    PyAvatarEffectPage,
    PyAvatarPortrait,
    PyBuiltinPreviewSource,
    PyCatalogPreviewSource,
    PyContentEvidenceRequest,
    PyContentEvidenceResponse,
    PyContentPreviewsPrepareRequest,
    PyContentPreviewsPrepareResponse,
    PyGesture,
    PyGesturePage,
    PyParticleEffect,
    PyParticleEffectPage,
    PyPose,
    PyPosePage,
    PyReaction,
    PyReactionPage,
    PySceneEffect,
    PySceneEffectPage,
    PySoundEffect,
    PySoundEffectPage,
    PyTypedContentPreview,
    PyVoiceContent,
    PyVoiceContentPage,
    legacy_saved_content_response,
    typed_content_response,
)
from animama.app.services.avatar_portraits import portrait_image_url, portrait_matches
from animama.app.services.content_image import MAX_APPEARANCE_SOURCE_BYTES
from animama.app.services.content_kind_registry import MAX_JSON_BYTES, definition_for_kind
from animama.app.services.content_save_service import (
    AvatarPortraitSource,
    ContentSaveService,
    avatar_portrait_entry_name,
)
from animama.app.services.typed_content_batch_service import (
    BuiltinTypedRoot,
    CatalogTypedRoot,
    TypedContentBatchResolver,
)
from animama.app.services.typed_content_service import TypedCatalogItem, TypedContentService
from animama.domain.content_catalog import ContentConflictError, ContentKind, ContentStatus, SavedContent
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import ProductContent, ReadContent, WriteContent
from animama.product_http.principal import get_current_principal
from animama.product_http.routes.content import bounded_upload, raise_content_mutation

router = APIRouter(tags=["typed-content"])


async def _typed_responses(content: ProductContent, *, user_id: str, values: tuple[TypedCatalogItem, ...]) -> list[Any]:
    """Project typed items, adding each Avatar's effective owner-scoped face parts."""

    responses = [typed_content_response(value) for value in values]
    await _overlay_face_parts(content, user_id=user_id, values=values, responses=responses)
    await _overlay_portraits(content, user_id=user_id, values=values, responses=responses)
    return responses


async def _overlay_portraits(
    content: ProductContent,
    *,
    user_id: str,
    values: tuple[TypedCatalogItem, ...],
    responses: Sequence[Any],
) -> None:
    """Set each Avatar response's portrait from the caller's visible valid Appearances."""

    if not any(value.item.kind is ContentKind.AVATAR for value in values):
        return
    appearances = [
        item
        for item in await content.catalog.list_visible(user_id=user_id)
        if item.kind is ContentKind.APPEARANCE and item.status is ContentStatus.VALID
    ]
    for value, response in zip(values, responses, strict=True):
        if not isinstance(response, PyAvatarContent):
            continue
        matches = portrait_matches(value.item, appearances)
        url = portrait_image_url(matches[0]) if matches else None
        if url is None:
            continue
        portrait = matches[0]
        presentation = portrait.metadata.get("presentation")
        revision = presentation.get("avatar_revision_sha256") if isinstance(presentation, dict) else None
        response.portrait = PyAvatarPortrait(
            url=url,
            avatar_revision_sha256=revision if isinstance(revision, str) else None,
            renderer_version=_positive_int(portrait.metadata.get("renderer_version")),
            capture_preset_version=_positive_int(portrait.metadata.get("capture_preset_version")),
        )


def _positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


async def _overlay_face_parts(
    content: ProductContent,
    *,
    user_id: str,
    values: tuple[TypedCatalogItem, ...],
    responses: Sequence[Any],
) -> None:
    """Set each Avatar response's effective face parts, including the caller's Included override.

    ``typed_content_response`` alone knows only the Local sidecar; ``responses``
    must correspond to ``values`` one to one.
    """

    if not any(value.item.kind is ContentKind.AVATAR for value in values):
        return
    effective = await content.face_parts.effective_for_items(user_id=user_id, items=values)
    for value, response in zip(values, responses, strict=True):
        parts = effective.get(value.item.id)
        if parts is not None and isinstance(response, PyAvatarContent):
            response.face_parts = (
                AvatarFacePartCorrection.model_validate(parts.face_parts) if parts.face_parts is not None else None
            )


@router.post(
    "/v1/content/evidence:resolve",
    response_model=PyContentEvidenceResponse,
    operation_id="resolve_content_evidence",
)
async def resolve_content_evidence(
    body: PyContentEvidenceRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: ReadContent,
) -> PyContentEvidenceResponse:
    """Resolve exact revision metadata without issuing a file capability."""

    try:
        result = await TypedContentBatchResolver(catalog=content.catalog.mutations.catalog).resolve(
            user_id=user.id,
            locators=tuple(
                CatalogTypedRoot(
                    kind=ContentKind(root.kind),
                    item_id=root.source.item_id,
                    expected_revision_sha256=root.source.revision_sha256,
                )
                for root in body.roots
            ),
        )
        return PyContentEvidenceResponse.from_domain(result)
    except Exception as exc:
        raise_content_mutation(exc)


@router.post(
    "/v1/content/previews:prepare",
    response_model=PyContentPreviewsPrepareResponse,
    operation_id="prepare_content_previews",
)
async def prepare_content_previews(
    body: PyContentPreviewsPrepareRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: WriteContent,
) -> PyContentPreviewsPrepareResponse:
    """Prepare at most one owner-scoped lease for a successful root union."""

    try:
        locators: list[CatalogTypedRoot | BuiltinTypedRoot] = []
        for root in body.roots:
            if isinstance(root.source, PyCatalogPreviewSource):
                locators.append(
                    CatalogTypedRoot(
                        kind=ContentKind(root.kind),
                        item_id=root.source.catalog_item_id,
                    )
                )
            elif isinstance(root.source, PyBuiltinPreviewSource):
                locators.append(
                    BuiltinTypedRoot(
                        kind=ContentKind(root.kind),
                        content_id=root.source.content_id,
                        version=root.source.version,
                    )
                )
        result = await TypedContentBatchResolver(catalog=content.catalog.mutations.catalog).resolve(
            user_id=user.id,
            locators=tuple(locators),
        )
        preview = None
        if result.roots:
            preview = await content.catalog.issue_preview_bundle(
                anchor=result.roots[0].item.item,
                entries=tuple(item.item for item in result.entries),
                user_id=user.id,
            )
        prepared = PyContentPreviewsPrepareResponse.from_domain(result, preview)
        await _overlay_face_parts(content, user_id=user.id, values=tuple(result.entries), responses=prepared.items)
        return prepared
    except Exception as exc:
        raise_content_mutation(exc)


@router.get(
    "/v1/gestures/{item_id}/idle-playback", response_model=PyIdlePlayback, operation_id="get_gesture_idle_playback"
)
async def get_gesture_idle_playback(
    item_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: ReadContent,
) -> PyIdlePlayback:
    """Return finite Idle eligibility for this exact current Gesture revision."""
    try:
        value = await content.typed.gesture_idle_playback(user_id=user.id, item_id=item_id)
        return PyIdlePlayback.model_validate(value)
    except Exception as exc:
        raise_content_mutation(exc)


async def _save_content_item(
    *,
    saves: ContentSaveService,
    kind: ContentKind,
    entry_name: str,
    user_id: str,
    operation_id: str,
    files: list[UploadFile] | None,
    catalog_item_id: str | None,
    expected_revision: str | None,
    descriptor_json: str | None,
    metadata_json: str | None,
    companion_paths_json: str,
    creation_context: bool,
) -> SavedContent:
    """Save one typed entry from its standalone file or descriptor and companions."""

    definition = definition_for_kind(kind)
    uploads = files or []
    try:
        if descriptor_json is None:
            if len(uploads) != 1:
                raise ContentConflictError("standalone_requires_one_file", field="files")
            upload = uploads[0]
            payload_stream, payload_size_bytes = await bounded_upload(upload, limit=definition.max_file_bytes)
            metadata = metadata_json.encode() if metadata_json is not None else None
            if metadata is not None and len(metadata) > MAX_JSON_BYTES:
                raise HTTPException(status_code=413, detail={"code": "content_metadata_too_large"})
            saved = await saves.save_standalone_stream(
                user_id=user_id,
                kind=kind,
                entry_name=entry_name,
                filename=upload.filename or entry_name,
                payload_stream=payload_stream,
                payload_size_bytes=payload_size_bytes,
                metadata_sidecar=metadata,
                operation_id=operation_id,
                catalog_item_id=catalog_item_id,
                expected_revision=expected_revision,
                declared_content_type=upload.content_type if kind is ContentKind.APPEARANCE else None,
                creation_context=creation_context,
            )
        else:
            try:
                companion_paths = json.loads(companion_paths_json)
            except json.JSONDecodeError as exc:
                raise ContentConflictError("invalid_companion_paths", field="files") from exc
            if (
                not isinstance(companion_paths, list)
                or len(companion_paths) != len(uploads)
                or not all(isinstance(value, str) for value in companion_paths)
            ):
                raise ContentConflictError("invalid_companion_paths", field="files")
            companions: dict[str, tuple[BinaryIO, int]] = {}
            descriptor = descriptor_json.encode()
            total = len(descriptor)
            if total > MAX_JSON_BYTES:
                raise HTTPException(status_code=413, detail={"code": "content_descriptor_too_large"})
            for path, upload in zip(companion_paths, uploads, strict=True):
                if path in companions:
                    raise ContentConflictError("duplicate_companion_path", field="files")
                payload_stream, payload_size_bytes = await bounded_upload(upload, limit=definition.max_file_bytes)
                total += payload_size_bytes
                if total > definition.max_entry_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail={"code": "content_entry_too_large", "field": "files"},
                    )
                companions[path] = (payload_stream, payload_size_bytes)
            saved = await saves.save_descriptor_streams(
                user_id=user_id,
                kind=kind,
                entry_name=entry_name,
                descriptor=descriptor,
                companion_files=companions,
                operation_id=operation_id,
                catalog_item_id=catalog_item_id,
                expected_revision=expected_revision,
                companion_media_types={
                    path: upload.content_type for path, upload in zip(companion_paths, uploads, strict=True)
                },
            )
        return saved
    except HTTPException:
        raise
    except Exception as exc:
        raise_content_mutation(exc)


def _install_family_routes(
    *,
    path: str,
    singular: str,
    kind: ContentKind,
    item_model: type[BaseModel],
    page_model: type[BaseModel],
    writable: bool = True,
    retired: bool = False,
) -> None:
    """Register one family without weakening its exact OpenAPI response model."""

    async def list_family(
        user: Annotated[RequestPrincipal, Depends(get_current_principal)],
        content: ReadContent,
    ) -> Any:
        try:
            values = await content.typed.list_kind(user_id=user.id, kind=kind)
            return page_model(items=await _typed_responses(content, user_id=user.id, values=values))
        except Exception as exc:
            raise_content_mutation(exc)

    async def get_family(
        item_id: str,
        user: Annotated[RequestPrincipal, Depends(get_current_principal)],
        content: ReadContent,
    ) -> Any:
        try:
            value = await content.typed.get(
                user_id=user.id,
                kind=kind,
                item_id=item_id,
            )
            (response,) = await _typed_responses(content, user_id=user.id, values=(value,))
            return response
        except Exception as exc:
            raise_content_mutation(exc)

    async def preview_family(
        item_id: str,
        user: Annotated[RequestPrincipal, Depends(get_current_principal)],
        content: WriteContent,
    ) -> PyTypedContentPreview:
        try:
            value = await content.typed.preview(
                user_id=user.id,
                kind=kind,
                item_id=item_id,
            )
            response = PyTypedContentPreview.from_domain(value)
            await _overlay_face_parts(
                content,
                user_id=user.id,
                values=(value.item, *value.supports),
                responses=[response.item, *response.supports],
            )
            return response
        except Exception as exc:
            raise_content_mutation(exc)

    if not retired:
        list_family.__name__ = f"list_{singular}s"
        get_family.__name__ = f"get_{singular}"
        preview_family.__name__ = f"preview_{singular}"
        router.add_api_route(
            path,
            list_family,
            methods=["GET"],
            response_model=page_model,
            operation_id=list_family.__name__,
        )
        router.add_api_route(
            f"{path}/{{item_id}}",
            get_family,
            methods=["GET"],
            response_model=item_model,
            operation_id=get_family.__name__,
        )
        router.add_api_route(
            f"{path}/{{item_id}}:preview",
            preview_family,
            methods=["POST"],
            response_model=PyTypedContentPreview,
            operation_id=preview_family.__name__,
        )

    if not writable:
        return

    async def save_family(
        entry_name: str,
        user: Annotated[RequestPrincipal, Depends(get_current_principal)],
        content: WriteContent,
        operation_id: Annotated[str, Form(min_length=1, max_length=128)],
        files: Annotated[list[UploadFile] | None, File()] = None,
        catalog_item_id: Annotated[str | None, Form()] = None,
        expected_revision: Annotated[str | None, Form(pattern=r"^[0-9a-f]{64}$")] = None,
        descriptor_json: Annotated[str | None, Form()] = None,
        metadata_json: Annotated[str | None, Form()] = None,
        companion_paths_json: Annotated[str, Form()] = "[]",
        creation_context: Annotated[bool, Form()] = False,
    ) -> Any:
        saved = await _save_content_item(
            saves=content.saves,
            kind=kind,
            entry_name=entry_name,
            user_id=user.id,
            operation_id=operation_id,
            files=files,
            catalog_item_id=catalog_item_id,
            expected_revision=expected_revision,
            descriptor_json=descriptor_json,
            metadata_json=metadata_json,
            companion_paths_json=companion_paths_json,
            creation_context=creation_context,
        )
        # A completed retry owns its original result even after later edits or
        # deletion. Project that saved snapshot without rereading live content.
        value = TypedContentService.parse(saved.item)
        return JSONResponse(content=legacy_saved_content_response(value))

    save_family.__name__ = f"save_{singular}"
    router.add_api_route(
        f"{path}/{{entry_name}}",
        save_family,
        methods=["PUT"],
        response_model=item_model,
        operation_id=save_family.__name__,
        include_in_schema=not retired,
    )


_install_family_routes(
    path="/v1/gestures",
    singular="gesture",
    kind=ContentKind.GESTURE,
    item_model=PyGesture,
    page_model=PyGesturePage,
)
_install_family_routes(
    path="/v1/reactions",
    singular="reaction",
    kind=ContentKind.REACTION,
    item_model=PyReaction,
    page_model=PyReactionPage,
)
_install_family_routes(
    path="/v1/poses",
    singular="pose",
    kind=ContentKind.POSE,
    item_model=PyPose,
    page_model=PyPosePage,
)
_install_family_routes(
    path="/v1/pose-clips",
    singular="pose_clip",
    kind=ContentKind.POSE_CLIP,
    item_model=BaseModel,
    page_model=BaseModel,
    retired=True,
)
_install_family_routes(
    path="/v1/particle-effects",
    singular="particle_effect",
    kind=ContentKind.PARTICLE_EFFECT,
    item_model=PyParticleEffect,
    page_model=PyParticleEffectPage,
)
_install_family_routes(
    path="/v1/avatar-effects",
    singular="avatar_effect",
    kind=ContentKind.AVATAR_EFFECT,
    item_model=PyAvatarEffect,
    page_model=PyAvatarEffectPage,
)
_install_family_routes(
    path="/v1/scene-effects",
    singular="scene_effect",
    kind=ContentKind.SCENE_EFFECT,
    item_model=PySceneEffect,
    page_model=PySceneEffectPage,
)
_install_family_routes(
    path="/v1/sound-effects",
    singular="sound_effect",
    kind=ContentKind.SOUND_EFFECT,
    item_model=PySoundEffect,
    page_model=PySoundEffectPage,
)
_install_family_routes(
    path="/v1/music-tracks",
    singular="music_track",
    kind=ContentKind.MUSIC_TRACK,
    item_model=BaseModel,
    page_model=BaseModel,
    retired=True,
)

# These portable lanes are typed and mountable, but their current editors use
# dedicated product flows. Read/Preview keeps them out of loose catalog casts.
_install_family_routes(
    path="/v1/avatar-content",
    singular="avatar_content",
    kind=ContentKind.AVATAR,
    item_model=PyAvatarContent,
    page_model=PyAvatarContentPage,
)
_install_family_routes(
    path="/v1/appearance-content",
    singular="appearance_content",
    kind=ContentKind.APPEARANCE,
    item_model=PyAppearance,
    page_model=PyAppearancePage,
)
_install_family_routes(
    path="/v1/voice-content",
    singular="voice_content",
    kind=ContentKind.VOICE,
    item_model=PyVoiceContent,
    page_model=PyVoiceContentPage,
)


@router.put("/v1/avatar-content/{item_id}/portrait", response_model=PyAppearance, operation_id="save_avatar_portrait")
async def save_avatar_portrait(
    item_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: WriteContent,
    file: Annotated[UploadFile, File()],
    operation_id: Annotated[str, Form(min_length=1, max_length=128)],
    expected_avatar_revision: Annotated[str, Form(pattern=r"^[0-9a-f]{64}$")],
    renderer_version: Annotated[int, Form(ge=1, le=1000)],
    capture_preset_version: Annotated[int, Form(ge=1, le=1000)],
) -> Any:
    """Save a confirmed browser capture as the Local Avatar's one portrait.

    The portrait is an ordinary owner-scoped Appearance; saving again replaces
    it in place. The source must be a current admitted Local Avatar. No
    provider or browser render runs on the backend, and no live Anima or Avatar
    metadata is changed.
    """

    try:
        stream, size = await bounded_upload(file, limit=MAX_APPEARANCE_SOURCE_BYTES)
        saved = await content.saves.save_standalone_stream(
            user_id=user.id,
            kind=ContentKind.APPEARANCE,
            entry_name=avatar_portrait_entry_name(item_id),
            filename=file.filename or "portrait.webp",
            payload_stream=stream,
            payload_size_bytes=size,
            metadata_sidecar=None,
            operation_id=operation_id,
            catalog_item_id=None,
            expected_revision=None,
            declared_content_type=file.content_type,
            portrait_source=AvatarPortraitSource(
                avatar_id=item_id,
                avatar_revision_sha256=expected_avatar_revision,
                renderer_version=renderer_version,
                capture_preset_version=capture_preset_version,
            ),
        )
        value = TypedContentService.parse(saved.item)
        return typed_content_response(value)
    except Exception as exc:
        raise_content_mutation(exc)


@router.get(
    "/v1/avatar-content/{item_id}/face-parts",
    response_model=AvatarFacePartsState,
    operation_id="get_avatar_face_parts",
)
async def get_avatar_face_parts(
    item_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: ReadContent,
) -> AvatarFacePartsState:
    """Return the effective face-part correction for a current admitted Avatar.

    Local Avatars report their sidecar ``face_parts``; Included Avatars report
    the caller's override only while it matches the current revision and VRM.
    """

    try:
        return await content.face_parts.get(user_id=user.id, item_id=item_id)
    except Exception as exc:
        raise_content_mutation(exc)


@router.put(
    "/v1/avatar-content/{item_id}/face-parts",
    response_model=AvatarFacePartsState,
    operation_id="save_avatar_face_parts",
)
async def save_avatar_face_parts(
    item_id: str,
    body: AvatarFacePartsUpdate,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: WriteContent,
) -> AvatarFacePartsState:
    """Replace or clear (``face_parts: null``) an Avatar's face-part correction.

    ``expected_revision`` must be the Avatar's current revision (409
    ``catalog_revision_conflict`` otherwise) and a correction must name this
    Avatar's VRM sha256 (422 ``avatar_face_parts_digest_mismatch``). A Local save
    rewrites the sidecar and returns the new revision; an Included save stores
    the caller's override and never writes Included bytes.
    """

    try:
        return await content.face_parts.save(user_id=user.id, item_id=item_id, update=body)
    except Exception as exc:
        raise_content_mutation(exc)


__all__ = ["router"]
