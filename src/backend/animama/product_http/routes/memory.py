"""Owner-scoped markdown memory entries and episodes, shared by every composition (ADR 0021)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Annotated, Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status

from animama.app.contracts.memory_entry import (
    PyAnimaIdentityItem,
    PyAnimaIdentityListResponse,
    PyMemoryEntryCreateRequest,
    PyMemoryEntryHeader,
    PyMemoryEntryListResponse,
    PyMemoryEntryPatchRequest,
    PyMemoryEntryResponse,
    PyMemoryEntryRevertRequest,
    PyMemoryEntryVersionDetail,
    PyMemoryEntryVersionFieldChange,
    PyMemoryEntryVersionListResponse,
    PyMemoryEntryVersionSummary,
    PySearchMemoryFileDebugResult,
    PySearchMemoryFilesDebugRequest,
    PySearchMemoryFilesDebugResponse,
)
from animama.app.contracts.memory_manager import PyMemoryEpisodeItem, PyMemoryEpisodeListResponse
from animama.app.services.memory_entry_service import (
    MemoryEntryConflictError,
    MemoryEntryNotFoundError,
    MemoryEntryProtectedError,
    MemoryEntryService,
    MemoryEntryValidationError,
)
from animama.app.services.memory_episode_service import (
    MemoryEpisodeNotFoundError,
    MemoryEpisodeService,
    MemoryEpisodeValidationError,
)
from animama.app.services.user_memory_read_tools import UserMemorySearchResult, search_user_memory_files
from animama.domain.memory_entry import (
    MemoryEntry,
    MemoryEntryHeader,
    MemoryEntryHeaderListing,
    MemoryEntryListing,
    MemoryEntryVersion,
    MemoryEntryVersionDetail,
    MemoryEntryVersionListing,
)
from animama.domain.memory_episode import MemoryEpisodeItem
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import Policy, ProductPolicy, ProductRepositories, ReadRepositories, WriteRepositories
from animama.product_http.principal import get_current_principal

router = APIRouter()
UserDep = Annotated[RequestPrincipal, Depends(get_current_principal)]


def _service(repositories: ProductRepositories, policy: ProductPolicy) -> MemoryEntryService:
    return MemoryEntryService(
        memory_entries=repositories.memory_entries,
        uow=repositories.unit_of_work,
        animas=repositories.animas,
        max_file_bytes=policy.memory_file_max_bytes,
    )


def _to_header(entry: MemoryEntry | MemoryEntryHeader) -> PyMemoryEntryHeader:
    return PyMemoryEntryHeader(
        id=entry.id,
        parent_id=entry.parent_id,
        anima_id=entry.anima_id,
        scope="anima" if entry.anima_id is not None else "user",
        type=entry.type,
        name=entry.name,
        path=entry.path,
        kind=entry.kind,
        description=entry.description,
        version=entry.version,
        size_bytes=entry.size_bytes,
        content_sha256=entry.content_sha256,
        metadata=dict(entry.metadata or {}),
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


def _to_response(entry: MemoryEntry) -> PyMemoryEntryResponse:
    return PyMemoryEntryResponse(
        **_to_header(entry).model_dump(),
        content=entry.content,
        aggregate_revision=entry.aggregate_revision,
    )


def _to_list_response(listing: MemoryEntryListing | MemoryEntryHeaderListing) -> PyMemoryEntryListResponse:
    return PyMemoryEntryListResponse(
        parent_id=listing.parent_id,
        recursive=listing.recursive,
        entries=[_to_header(entry) for entry in listing.entries],
    )


def _to_version_summary(version: MemoryEntryVersion) -> PyMemoryEntryVersionSummary:
    return PyMemoryEntryVersionSummary(
        entry_id=version.entry_id,
        parent_id=version.parent_id,
        anima_id=version.anima_id,
        scope="anima" if version.anima_id is not None else "user",
        type=version.type,
        name=version.name,
        path=version.path,
        kind=version.kind,
        description=version.description,
        version=version.version,
        operation=version.operation,
        size_bytes=version.size_bytes,
        content_sha256=version.content_sha256,
        change_metadata=dict(version.change_metadata or {}),
        created_at=version.created_at,
        deleted_at=version.deleted_at,
    )


def _to_version_list_response(listing: MemoryEntryVersionListing) -> PyMemoryEntryVersionListResponse:
    return PyMemoryEntryVersionListResponse(
        entry_id=listing.entry_id,
        versions=[_to_version_summary(version) for version in listing.versions],
        next_before_version=listing.next_before_version,
    )


def _to_version_detail(detail: MemoryEntryVersionDetail) -> PyMemoryEntryVersionDetail:
    version = detail.entry
    return PyMemoryEntryVersionDetail(
        **_to_version_summary(version).model_dump(),
        content=version.content,
        metadata=dict(version.metadata or {}),
        previous_version=detail.previous_version,
        unified_diff=detail.unified_diff,
        path_change=(
            PyMemoryEntryVersionFieldChange(old=detail.path_change.old, new=detail.path_change.new)
            if detail.path_change is not None
            else None
        ),
        description_change=(
            PyMemoryEntryVersionFieldChange(
                old=detail.description_change.old,
                new=detail.description_change.new,
            )
            if detail.description_change is not None
            else None
        ),
    )


def _to_debug_search_response(
    query: str,
    results: Sequence[UserMemorySearchResult],
) -> PySearchMemoryFilesDebugResponse:
    return PySearchMemoryFilesDebugResponse(
        query=query,
        memory_results=[
            PySearchMemoryFileDebugResult(
                path=result.path,
                description=result.description,
                snippet=result.snippet,
            )
            for result in results
        ],
    )


def _raise_http_error(exc: Exception) -> NoReturn:
    if isinstance(exc, MemoryEntryValidationError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.detail) from exc
    if isinstance(exc, MemoryEntryNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=exc.detail) from exc
    if isinstance(exc, MemoryEntryConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.detail) from exc
    if isinstance(exc, MemoryEntryProtectedError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=exc.detail) from exc
    raise exc


@router.get(
    "/v1/memory/entries",
    response_model=PyMemoryEntryListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_memory_entries(
    repositories: ReadRepositories,
    policy: Policy,
    user: UserDep,
    anima_id: Annotated[str | None, Query()] = None,
    parent_id: Annotated[str | None, Query()] = None,
    recursive: Annotated[bool, Query()] = False,
) -> PyMemoryEntryListResponse:
    """List current-user live memory entries under a scope parent."""

    try:
        listing = await _service(repositories, policy).list_entry_headers(
            user_id=user.id,
            anima_id=anima_id,
            parent_id=parent_id,
            recursive=recursive,
        )
    except (MemoryEntryValidationError, MemoryEntryNotFoundError) as exc:
        _raise_http_error(exc)
    return _to_list_response(listing)


@router.get(
    "/v1/memory/anima-identities",
    response_model=PyAnimaIdentityListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_anima_identities(
    repositories: ReadRepositories, policy: Policy, user: UserDep
) -> PyAnimaIdentityListResponse:
    """List every owned Anima in creation order with its IDENTITY.md and MEMORIES.md headers."""

    summaries = await _service(repositories, policy).list_anima_identities(user_id=user.id)
    return PyAnimaIdentityListResponse(
        identities=[
            PyAnimaIdentityItem(
                anima_id=summary.anima_id,
                display_name=summary.display_name,
                aggregate_revision=summary.aggregate_revision,
                identity_status=summary.identity_status,
                created_at=summary.created_at,
                entry=_to_header(summary.identity) if summary.identity is not None else None,
                memories_entry=_to_header(summary.memories) if summary.memories is not None else None,
            )
            for summary in summaries
        ]
    )


@router.post(
    "/v1/memory/anima-memories/{anima_id}:repair",
    response_model=PyMemoryEntryHeader,
    status_code=status.HTTP_200_OK,
)
async def repair_anima_memories(
    anima_id: str, repositories: WriteRepositories, policy: Policy, user: UserDep
) -> PyMemoryEntryHeader:
    """Recreate an owned Anima's missing MEMORIES.md from the template; existing files are unchanged."""

    try:
        entry = await _service(repositories, policy).repair_anima_memories(user_id=user.id, anima_id=anima_id)
    except (MemoryEntryNotFoundError, MemoryEntryConflictError) as exc:
        _raise_http_error(exc)
    return _to_header(entry)


@router.get(
    "/v1/memory/entries/by-path",
    response_model=PyMemoryEntryResponse,
    status_code=status.HTTP_200_OK,
)
async def get_memory_entry_by_path(
    repositories: ReadRepositories,
    policy: Policy,
    user: UserDep,
    path: Annotated[str, Query()],
    anima_id: Annotated[str | None, Query()] = None,
    type: Annotated[Literal["file", "directory"], Query()] = "file",
) -> PyMemoryEntryResponse:
    """Read one current-user memory entry by cached path within a scope."""

    try:
        entry = await _service(repositories, policy).get_entry_by_path(
            user_id=user.id,
            anima_id=anima_id,
            path=path,
            type=type,
        )
    except (MemoryEntryValidationError, MemoryEntryNotFoundError) as exc:
        _raise_http_error(exc)
    return _to_response(entry)


@router.get(
    "/v1/memory/entries/{entry_id}/versions",
    response_model=PyMemoryEntryVersionListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_memory_entry_versions(
    entry_id: str,
    repositories: ReadRepositories,
    policy: Policy,
    user: UserDep,
    before_version: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> PyMemoryEntryVersionListResponse:
    """List content-free immutable versions for one owned memory entry."""

    try:
        listing = await _service(repositories, policy).list_versions(
            user_id=user.id,
            entry_id=entry_id,
            before_version=before_version,
            limit=limit,
        )
    except (MemoryEntryValidationError, MemoryEntryNotFoundError) as exc:
        _raise_http_error(exc)
    return _to_version_list_response(listing)


@router.get(
    "/v1/memory/entries/{entry_id}/versions/{version}",
    response_model=PyMemoryEntryVersionDetail,
    status_code=status.HTTP_200_OK,
)
async def get_memory_entry_version(
    entry_id: str,
    version: Annotated[int, Path(ge=1)],
    repositories: ReadRepositories,
    policy: Policy,
    user: UserDep,
) -> PyMemoryEntryVersionDetail:
    """Read Version N and its immutable Version N-1 adjacent diff."""

    try:
        detail = await _service(repositories, policy).get_version_detail(
            user_id=user.id,
            entry_id=entry_id,
            version=version,
        )
    except (MemoryEntryValidationError, MemoryEntryNotFoundError, MemoryEntryConflictError) as exc:
        _raise_http_error(exc)
    return _to_version_detail(detail)


@router.get(
    "/v1/memory/entries/{entry_id}",
    response_model=PyMemoryEntryResponse,
    status_code=status.HTTP_200_OK,
)
async def get_memory_entry(
    entry_id: str,
    repositories: ReadRepositories,
    policy: Policy,
    user: UserDep,
) -> PyMemoryEntryResponse:
    """Read one current-user memory entry by stable ID."""

    try:
        entry = await _service(repositories, policy).get_entry(user_id=user.id, entry_id=entry_id)
    except MemoryEntryNotFoundError as exc:
        _raise_http_error(exc)
    return _to_response(entry)


@router.post(
    "/v1/memory/debug/search-memory-files",
    response_model=PySearchMemoryFilesDebugResponse,
    status_code=status.HTTP_200_OK,
)
async def debug_search_memory_files(
    req: PySearchMemoryFilesDebugRequest,
    repositories: ReadRepositories,
    policy: Policy,
    user: UserDep,
) -> PySearchMemoryFilesDebugResponse:
    """Search the same current-user markdown memory files exposed to the AI tool."""

    results = await search_user_memory_files(
        user_id=user.id,
        query=req.query,
        memory_entries=_service(repositories, policy),
    )
    return _to_debug_search_response(req.query, results)


@router.post(
    "/v1/memory/entries",
    response_model=PyMemoryEntryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_memory_entry(
    req: PyMemoryEntryCreateRequest,
    repositories: WriteRepositories,
    policy: Policy,
    user: UserDep,
) -> PyMemoryEntryResponse:
    """Create an entry, optionally creating missing parents for a file path."""

    try:
        entry = await _service(repositories, policy).create_entry(
            user_id=user.id,
            anima_id=req.anima_id,
            parent_id=req.parent_id,
            type=req.type,
            name=req.name,
            content=req.content,
            kind=req.kind,
            description=req.description,
            metadata=req.metadata,
            expected_version=req.expected_version,
            expected_aggregate_revision=req.expected_aggregate_revision,
            create_parents=req.create_parents,
        )
    except (
        MemoryEntryValidationError,
        MemoryEntryNotFoundError,
        MemoryEntryConflictError,
        MemoryEntryProtectedError,
    ) as exc:
        _raise_http_error(exc)
    return _to_response(entry)


@router.patch(
    "/v1/memory/entries/{entry_id}",
    response_model=PyMemoryEntryResponse,
    status_code=status.HTTP_200_OK,
)
async def patch_memory_entry(
    entry_id: str,
    req: PyMemoryEntryPatchRequest,
    repositories: WriteRepositories,
    policy: Policy,
    user: UserDep,
) -> PyMemoryEntryResponse:
    """Patch file content/metadata or move/rename one memory entry."""

    fields_set = req.model_fields_set
    try:
        entry = await _service(repositories, policy).patch_entry(
            user_id=user.id,
            entry_id=entry_id,
            expected_version=req.expected_version,
            expected_aggregate_revision=req.expected_aggregate_revision,
            content=req.content,
            content_set="content" in fields_set,
            kind=req.kind,
            kind_set="kind" in fields_set,
            description=req.description,
            description_set="description" in fields_set,
            metadata=req.metadata,
            metadata_set="metadata" in fields_set,
            name=req.name,
            name_set="name" in fields_set,
            parent_id=req.parent_id,
            parent_id_set="parent_id" in fields_set,
        )
    except (
        MemoryEntryValidationError,
        MemoryEntryNotFoundError,
        MemoryEntryConflictError,
        MemoryEntryProtectedError,
    ) as exc:
        _raise_http_error(exc)
    return _to_response(entry)


@router.post(
    "/v1/memory/entries/{entry_id}:revert",
    response_model=PyMemoryEntryResponse,
    status_code=status.HTTP_200_OK,
)
async def revert_memory_entry(
    entry_id: str,
    req: PyMemoryEntryRevertRequest,
    repositories: WriteRepositories,
    policy: Policy,
    user: UserDep,
) -> PyMemoryEntryResponse:
    """Copy an older Version's content and description into a new Version."""

    try:
        entry = await _service(repositories, policy).revert_entry(
            user_id=user.id,
            entry_id=entry_id,
            target_version=req.target_version,
            expected_version=req.expected_version,
            expected_aggregate_revision=req.expected_aggregate_revision,
        )
    except (
        MemoryEntryValidationError,
        MemoryEntryNotFoundError,
        MemoryEntryConflictError,
        MemoryEntryProtectedError,
    ) as exc:
        _raise_http_error(exc)
    return _to_response(entry)


@router.delete(
    "/v1/memory/entries/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_memory_entry(
    entry_id: str,
    repositories: WriteRepositories,
    policy: Policy,
    user: UserDep,
    expected_version: Annotated[int, Query(ge=0)],
    recursive: Annotated[bool, Query()] = False,
) -> Response:
    """Soft-delete one memory entry after a version check."""

    try:
        await _service(repositories, policy).delete_entry(
            user_id=user.id,
            entry_id=entry_id,
            expected_version=expected_version,
            recursive=recursive,
        )
    except (
        MemoryEntryValidationError,
        MemoryEntryNotFoundError,
        MemoryEntryConflictError,
        MemoryEntryProtectedError,
    ) as exc:
        _raise_http_error(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _raise_episode_error(exc: MemoryEpisodeValidationError | MemoryEpisodeNotFoundError) -> NoReturn:
    # The listing's ``status`` query parameter shadows the module inside the handler.
    not_found = isinstance(exc, MemoryEpisodeNotFoundError)
    status_code = status.HTTP_404_NOT_FOUND if not_found else status.HTTP_400_BAD_REQUEST
    raise HTTPException(status_code=status_code, detail=exc.detail) from exc


def _to_episode_item(item: MemoryEpisodeItem) -> PyMemoryEpisodeItem:
    return PyMemoryEpisodeItem(
        id=item.id,
        source_anima_id=item.source_anima_id,
        source_chat_id=item.source_chat_id,
        source_run_id=item.source_run_id,
        source_message_id=item.source_message_id,
        occurred_at=item.occurred_at,
        local_date=item.local_date,
        local_timezone=item.local_timezone,
        episode_path=item.episode_path,
        kind=item.kind,
        text=item.text,
        status=item.status,
        processed_at=item.processed_at,
        processed_by_run_id=item.processed_by_run_id,
        metadata=dict(item.metadata or {}),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get(
    "/v1/memory/episodes",
    response_model=PyMemoryEpisodeListResponse,
    status_code=status.HTTP_200_OK,
)
async def list_memory_episodes(
    repositories: ReadRepositories,
    policy: Policy,
    user: UserDep,
    status: Annotated[Literal["pending", "processed"] | None, Query()] = "pending",
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
) -> PyMemoryEpisodeListResponse:
    """List current-user episodic-memory items for manual review."""

    episodes = MemoryEpisodeService(
        memory_episodes=repositories.memory_episodes,
        memory_entries=_service(repositories, policy),
        uow=repositories.unit_of_work,
    )
    try:
        items = await episodes.list_episode_items(user_id=user.id, status=status, limit=limit)
    except (MemoryEpisodeValidationError, MemoryEpisodeNotFoundError) as exc:
        _raise_episode_error(exc)
    return PyMemoryEpisodeListResponse(items=[_to_episode_item(item) for item in items])


__all__ = [
    "create_memory_entry",
    "debug_search_memory_files",
    "delete_memory_entry",
    "get_memory_entry",
    "get_memory_entry_by_path",
    "get_memory_entry_version",
    "list_anima_identities",
    "list_memory_entries",
    "list_memory_entry_versions",
    "list_memory_episodes",
    "patch_memory_entry",
    "repair_anima_memories",
    "revert_memory_entry",
    "router",
]
