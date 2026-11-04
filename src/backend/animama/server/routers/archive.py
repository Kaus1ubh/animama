from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.archive_repo import SQLAlchemyArchiveRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.archive_service import ArchiveService
from animama.domain.archive import Archive as ArchiveDomain, ArchivePassage as ArchivePassageDomain
from animama.domain.request_principal import RequestPrincipal
from animama.logging_config import get_logger
from animama.orm import ORMAnima
from animama.server.deps import get_async_session, get_current_principal
from animama.server.embeddings import role_embedder
from animama.server.model_roles import ModelRoleSettings, get_model_role_settings
from animama.server.schemas import (
    PyArchive,
    PyArchivePassageCreate,
    PyArchivePassageResponse,
    PyArchivePassageSearchRequest,
    PyArchivePassageSearchResult,
    PyArchivePassageUpdate,
)

router = APIRouter()
_log = get_logger("server.routers.archive")


def _archive_dom_to_schema(a: ArchiveDomain) -> PyArchive:
    return PyArchive(
        id=a.id,
        name=a.name,
        description=a.description,
        organization_id=a.organization_id,
        metadata=a.metadata or {},
        created_at=a.created_at,
        updated_at=a.updated_at,
    )


def _passage_dom_to_schema(p: ArchivePassageDomain) -> PyArchivePassageResponse:
    return PyArchivePassageResponse(
        id=p.id,
        archive_id=p.archive_id,
        text=p.text,
        tags=p.tags,
        metadata=p.metadata or {},
        source_id=p.source_id,
        file_id=p.file_id,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _passage_dom_to_search_result(p: ArchivePassageDomain) -> PyArchivePassageSearchResult:
    return PyArchivePassageSearchResult(
        id=p.id,
        archive_id=p.archive_id,
        text=p.text,
        tags=p.tags,
        metadata=p.metadata or {},
        source_id=p.source_id,
        file_id=p.file_id,
        created_at=p.created_at,
        updated_at=p.updated_at,
        score=p.score or 0.0,
    )


async def _get_anima_or_404(
    *,
    session: AsyncSession,
    user: RequestPrincipal,
    anima_id: str,
) -> ORMAnima:
    orm = await session.get(ORMAnima, anima_id)
    if orm is None or (orm.user_id is not None and orm.user_id != user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anima not found")
    return orm


@router.get(
    "/v1/animas/{anima_id}/archive",
    response_model=PyArchive,
    status_code=status.HTTP_200_OK,
)
async def get_anima_archive(
    anima_id: str,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyArchive:
    """Return archive metadata for a anima."""
    _log.info("HTTP Archive Get", anima_id=anima_id)
    orm_anima = await _get_anima_or_404(session=session, user=user, anima_id=anima_id)
    if not orm_anima.archive_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Archive not found")

    repo = SQLAlchemyArchiveRepository(session)
    uow = SQLAlchemyUnitOfWork(session)
    service = ArchiveService(archives=repo, uow=uow)
    archive = await service.get_archive(orm_anima.archive_id)
    if archive is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Archive not found")
    return _archive_dom_to_schema(archive)


@router.get(
    "/v1/animas/{anima_id}/archive/passages",
    response_model=list[PyArchivePassageResponse],
    status_code=status.HTTP_200_OK,
)
async def list_anima_archive_passages(
    anima_id: str,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    limit: int = 100,
    offset: int = 0,
) -> list[PyArchivePassageResponse]:
    """List archive passages for a anima.

    Returns an empty list when the anima has no archive yet.
    """
    _log.info("HTTP Archive ListPassages", anima_id=anima_id, limit=limit, offset=offset)
    orm_anima = await _get_anima_or_404(session=session, user=user, anima_id=anima_id)
    if not orm_anima.archive_id:
        return []

    repo = SQLAlchemyArchiveRepository(session)
    uow = SQLAlchemyUnitOfWork(session)
    service = ArchiveService(archives=repo, uow=uow)
    passages = await service.list_passages(archive_id=orm_anima.archive_id, limit=limit, offset=offset)
    return [_passage_dom_to_schema(p) for p in passages]


@router.post(
    "/v1/animas/{anima_id}/archive/passages",
    response_model=PyArchivePassageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_anima_archive_passage(
    anima_id: str,
    req: PyArchivePassageCreate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    roles: Annotated[ModelRoleSettings, Depends(get_model_role_settings)],
) -> PyArchivePassageResponse:
    """Create a new archive passage for a anima.

    If the anima has no archive yet, one is created implicitly.
    """
    _log.info("HTTP Archive CreatePassage", anima_id=anima_id)
    orm_anima = await _get_anima_or_404(session=session, user=user, anima_id=anima_id)

    repo = SQLAlchemyArchiveRepository(session)
    uow = SQLAlchemyUnitOfWork(session)
    service = ArchiveService(archives=repo, uow=uow, embedder=await role_embedder(session, user.id, roles))

    archive_id = orm_anima.archive_id
    if not archive_id:
        # Lazily create an archive scoped to this anima
        avatar_name = orm_anima.avatar.name if orm_anima.avatar is not None else orm_anima.id
        name = f"{avatar_name} Archive"
        description = f"Archive for anima {orm_anima.id}"
        archive = await service.create_archive(
            name=name,
            description=description,
            metadata={},
            organization_id=getattr(orm_anima, "organization_id", None),
        )
        archive_id = archive.id
        orm_anima.archive_id = archive_id
        await session.flush()
        await session.commit()

    passage = await service.create_passage(
        archive_id=archive_id,
        text=req.text,
        tags=req.tags,
        metadata=req.metadata,
        source_id=req.source_id,
        file_id=req.file_id,
    )
    return _passage_dom_to_schema(passage)


@router.patch(
    "/v1/animas/{anima_id}/archive/passages/{passage_id}",
    response_model=PyArchivePassageResponse,
    status_code=status.HTTP_200_OK,
)
async def update_anima_archive_passage(
    anima_id: str,
    passage_id: int,
    req: PyArchivePassageUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    roles: Annotated[ModelRoleSettings, Depends(get_model_role_settings)],
) -> PyArchivePassageResponse:
    """Update an existing archive passage."""
    _log.info("HTTP Archive UpdatePassage", anima_id=anima_id, passage_id=passage_id)
    orm_anima = await _get_anima_or_404(session=session, user=user, anima_id=anima_id)
    if not orm_anima.archive_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Archive not found")

    repo = SQLAlchemyArchiveRepository(session)
    uow = SQLAlchemyUnitOfWork(session)
    service = ArchiveService(archives=repo, uow=uow, embedder=await role_embedder(session, user.id, roles))

    existing = await service.get_passage(passage_id)
    if existing is None or existing.archive_id != orm_anima.archive_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passage not found")

    updated_dom = ArchivePassageDomain(
        id=existing.id,
        archive_id=existing.archive_id,
        text=req.text if req.text is not None else existing.text,
        tags=req.tags if req.tags is not None else existing.tags,
        metadata=req.metadata if req.metadata is not None else existing.metadata,
        source_id=req.source_id if req.source_id is not None else existing.source_id,
        file_id=req.file_id if req.file_id is not None else existing.file_id,
        created_at=existing.created_at,
        updated_at=existing.updated_at,
        score=existing.score,
        embedding=existing.embedding,
        embedding_model_id=existing.embedding_model_id,
    )

    stored = await service.update_passage(passage=updated_dom)
    return _passage_dom_to_schema(stored)


@router.delete(
    "/v1/animas/{anima_id}/archive/passages/{passage_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_anima_archive_passage(
    anima_id: str,
    passage_id: int,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> Response:
    """Delete an archive passage."""
    _log.info("HTTP Archive DeletePassage", anima_id=anima_id, passage_id=passage_id)
    orm_anima = await _get_anima_or_404(session=session, user=user, anima_id=anima_id)
    if not orm_anima.archive_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Archive not found")

    repo = SQLAlchemyArchiveRepository(session)
    uow = SQLAlchemyUnitOfWork(session)
    service = ArchiveService(archives=repo, uow=uow)

    existing = await service.get_passage(passage_id)
    if existing is None or existing.archive_id != orm_anima.archive_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passage not found")

    await service.delete_passage(passage_id=passage_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/v1/animas/{anima_id}/archive/search",
    response_model=list[PyArchivePassageSearchResult],
    status_code=status.HTTP_200_OK,
)
async def search_anima_archive_passages(
    anima_id: str,
    req: PyArchivePassageSearchRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    roles: Annotated[ModelRoleSettings, Depends(get_model_role_settings)],
) -> list[PyArchivePassageSearchResult]:
    """Search an Anima's archive passages by similarity, or by full text when embeddings are unavailable."""
    _log.info(
        "HTTP Archive SearchPassages",
        anima_id=anima_id,
        limit=req.limit,
        threshold=req.threshold,
    )
    orm_anima = await _get_anima_or_404(session=session, user=user, anima_id=anima_id)
    if not orm_anima.archive_id:
        return []

    service = ArchiveService(
        archives=SQLAlchemyArchiveRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        embedder=await role_embedder(session, user.id, roles),
    )
    results = await service.search_passages(
        query=req.query,
        limit=req.limit,
        threshold=req.threshold,
        archive_id=orm_anima.archive_id,
    )
    return [_passage_dom_to_search_result(p) for p in results]
