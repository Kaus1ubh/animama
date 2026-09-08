"""Typed product routes backed by the one editable Content Catalog."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.content_image import MAX_APPEARANCE_SOURCE_BYTES
from animama.app.services.typed_content_batch_service import (
    BuiltinTypedRoot,
    CatalogTypedRoot,
    TypedContentBatchResolver,
)
from animama.app.services.typed_content_service import TypedContentService
from animama.domain.content_catalog import ContentKind
from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_async_session, get_current_principal
from animama.server.schemas.typed_content import (
    PyAppearance,
    PyAppearancePage,
    PyAvatarContent,
    PyAvatarContentPage,
    PyAvatarEffect,
    PyAvatarEffectPage,
    PyBuiltinPreviewSource,
    PyCatalogPreviewSource,
    PyContentEvidenceRequest,
    PyContentEvidenceResponse,
    PyContentPreviewsPrepareRequest,
    PyContentPreviewsPrepareResponse,
    PyGesture,
    PyGesturePage,
    PyIdleStyle,
    PyIdleStylePage,
    PyMusicTrack,
    PyMusicTrackPage,
    PyParticleEffect,
    PyParticleEffectPage,
    PyPoseClip,
    PyPoseClipPage,
    PyReaction,
    PyReactionPage,
    PySceneEffect,
    PySceneEffectPage,
    PySoundEffect,
    PySoundEffectPage,
    PyTypedContentPreview,
    PyVoiceContent,
    PyVoiceContentPage,
    typed_content_response,
)

from .content import _bounded_upload, _raise_content_mutation, _save_service, _service, save_content_item

router = APIRouter(tags=["typed-content"])


def _typed_service(request: Request, session: AsyncSession) -> TypedContentService:
    """Compose typed product views over the shared catalog services."""

    return TypedContentService(
        catalog=SQLAlchemyContentCatalog(session),
        content=_service(request, session),
    )


@router.post(
    "/v1/content/evidence:resolve",
    response_model=PyContentEvidenceResponse,
    operation_id="resolve_content_evidence",
)
async def resolve_content_evidence(
    body: PyContentEvidenceRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyContentEvidenceResponse:
    """Resolve exact revision metadata without issuing a file capability."""

    try:
        result = await TypedContentBatchResolver(catalog=SQLAlchemyContentCatalog(session)).resolve(
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
        _raise_content_mutation(exc)


@router.post(
    "/v1/content/previews:prepare",
    response_model=PyContentPreviewsPrepareResponse,
    operation_id="prepare_content_previews",
)
async def prepare_content_previews(
    body: PyContentPreviewsPrepareRequest,
    request: Request,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyContentPreviewsPrepareResponse:
    """Prepare at most one owner-scoped lease for a successful root union."""

    try:
        locators = []
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
        result = await TypedContentBatchResolver(catalog=SQLAlchemyContentCatalog(session)).resolve(
            user_id=user.id,
            locators=tuple(locators),
        )
        preview = None
        if result.roots:
            preview = await _service(request, session).issue_preview_bundle(
                anchor=result.roots[0].item.item,
                entries=tuple(item.item for item in result.entries),
                user_id=user.id,
            )
        return PyContentPreviewsPrepareResponse.from_domain(result, preview)
    except Exception as exc:
        _raise_content_mutation(exc)


def _install_family_routes(
    *,
    path: str,
    singular: str,
    kind: ContentKind,
    item_model: type[BaseModel],
    page_model: type[BaseModel],
    writable: bool = True,
) -> None:
    """Register one family without weakening its exact OpenAPI response model."""

    async def list_family(
        request: Request,
        user: Annotated[RequestPrincipal, Depends(get_current_principal)],
        session: Annotated[AsyncSession, Depends(get_async_session)],
    ) -> Any:
        try:
            values = await _typed_service(request, session).list_kind(user_id=user.id, kind=kind)
            return page_model(items=[typed_content_response(value) for value in values])
        except Exception as exc:
            _raise_content_mutation(exc)

    async def get_family(
        item_id: str,
        request: Request,
        user: Annotated[RequestPrincipal, Depends(get_current_principal)],
        session: Annotated[AsyncSession, Depends(get_async_session)],
    ) -> Any:
        try:
            value = await _typed_service(request, session).get(
                user_id=user.id,
                kind=kind,
                item_id=item_id,
            )
            return typed_content_response(value)
        except Exception as exc:
            _raise_content_mutation(exc)

    async def preview_family(
        item_id: str,
        request: Request,
        user: Annotated[RequestPrincipal, Depends(get_current_principal)],
        session: Annotated[AsyncSession, Depends(get_async_session)],
    ) -> PyTypedContentPreview:
        try:
            value = await _typed_service(request, session).preview(
                user_id=user.id,
                kind=kind,
                item_id=item_id,
            )
            return PyTypedContentPreview.from_domain(value)
        except Exception as exc:
            _raise_content_mutation(exc)

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
        request: Request,
        user: Annotated[RequestPrincipal, Depends(get_current_principal)],
        session: Annotated[AsyncSession, Depends(get_async_session)],
        operation_id: Annotated[str, Form(min_length=1, max_length=128)],
        files: Annotated[list[UploadFile] | None, File()] = None,
        catalog_item_id: Annotated[str | None, Form()] = None,
        expected_revision: Annotated[str | None, Form(pattern=r"^[0-9a-f]{64}$")] = None,
        descriptor_json: Annotated[str | None, Form()] = None,
        metadata_json: Annotated[str | None, Form()] = None,
        companion_paths_json: Annotated[str, Form()] = "[]",
        creation_context: Annotated[bool, Form()] = False,
    ) -> Any:
        saved = await save_content_item(
            request=request,
            kind=kind,
            entry_name=entry_name,
            user=user,
            session=session,
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
        return typed_content_response(value)

    save_family.__name__ = f"save_{singular}"
    router.add_api_route(
        f"{path}/{{entry_name}}",
        save_family,
        methods=["PUT"],
        response_model=item_model,
        operation_id=save_family.__name__,
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
    path="/v1/pose-clips",
    singular="pose_clip",
    kind=ContentKind.POSE_CLIP,
    item_model=PyPoseClip,
    page_model=PyPoseClipPage,
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
    path="/v1/idle-styles",
    singular="idle_style",
    kind=ContentKind.IDLE_STYLE,
    item_model=PyIdleStyle,
    page_model=PyIdleStylePage,
)
_install_family_routes(
    path="/v1/music-tracks",
    singular="music_track",
    kind=ContentKind.MUSIC_TRACK,
    item_model=PyMusicTrack,
    page_model=PyMusicTrackPage,
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
    request: Request,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    file: Annotated[UploadFile, File()],
    entry_name: Annotated[str, Form(min_length=1, max_length=120)],
    operation_id: Annotated[str, Form(min_length=1, max_length=128)],
    expected_avatar_revision: Annotated[str, Form(pattern=r"^[0-9a-f]{64}$")],
) -> Any:
    """Save a confirmed browser capture as ordinary owner-scoped Appearance.

    The source must be a current admitted Avatar. No provider or browser render
    runs on the backend, and no live Anima or Avatar metadata is changed.
    """

    try:
        stream, size = await _bounded_upload(file, limit=MAX_APPEARANCE_SOURCE_BYTES)
        saved = await _save_service(request, session).save_standalone_stream(
            user_id=user.id,
            kind=ContentKind.APPEARANCE,
            entry_name=entry_name,
            filename=file.filename or "portrait.webp",
            payload_stream=stream,
            payload_size_bytes=size,
            metadata_sidecar=None,
            operation_id=operation_id,
            catalog_item_id=None,
            expected_revision=None,
            declared_content_type=file.content_type,
            portrait_source=(item_id, expected_avatar_revision),
        )
        value = TypedContentService.parse(saved.item)
        return typed_content_response(value)
    except Exception as exc:
        _raise_content_mutation(exc)


__all__ = ["router"]
