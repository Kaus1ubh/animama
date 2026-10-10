"""Private supervisor preflights mounted only by the desktop composition."""

import hashlib
import json
import secrets
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.feature_pack_removal_repo import (
    content_operations_idle,
    document_job_blockers,
    included_source_blockers,
)
from animama.app.model_clients.credential_store import CredentialStoreError
from animama.domain.feature_packs import FEATURE_PACK_IDS, PackRemovalBlocker
from animama.server.deps import get_async_session
from animama.server.runtime_capabilities import get_runtime_settings
from animama.server.runtime_credentials import runtime_credentials

router = APIRouter(prefix="/_desktop", include_in_schema=False)


def require_desktop_control(request: Request) -> None:
    """Missing and invalid control credentials are indistinguishable from 404."""

    expected = get_runtime_settings(request).animama_desktop_control_token
    received = request.headers.get("X-Animama-Desktop-Control", "")
    if not expected or len(expected) < 32 or not secrets.compare_digest(expected.encode(), received.encode()):
        raise HTTPException(status_code=404, detail="Not Found")


@router.post("/feature-packs/{pack_id}:removal-check", dependencies=[Depends(require_desktop_control)])
async def feature_pack_removal_check(
    pack_id: str, request: Request, session: Annotated[AsyncSession, Depends(get_async_session)]
) -> dict[str, object]:
    """Bounded preflight; the later drained restart repeats catalog custody checks."""

    if pack_id not in FEATURE_PACK_IDS:
        raise HTTPException(status_code=404, detail="Not Found")
    runtime = get_runtime_settings(request)
    paths = getattr(request.app.state, "local_runtime_paths", None)
    if paths is None:
        raise HTTPException(status_code=503, detail="runtime_starting")
    now = datetime.now(UTC)
    sources = [source for source in paths.included_sources if source.pack_id == pack_id]
    blockers = []
    if pack_id == "expanded-included-content":
        if not await content_operations_idle(session):
            blockers.append(
                PackRemovalBlocker("content_operation", "content-reconciliation", "Content is being reconciled")
            )
        blockers.extend(
            await included_source_blockers(session, mount_ids=[source.mount_id for source in sources], now=now)
        )
        # Journals survive interrupted imports and must be recovered before
        # bytes can be removed. Do not expose their paths or payloads.
        if paths.operations_root.exists():
            for journal in paths.operations_root.glob("package-install-*.json"):
                blockers.append(
                    PackRemovalBlocker(
                        "content_operation",
                        hashlib.sha256(journal.name.encode()).hexdigest()[:32],
                        "Pending content import",
                    )
                )
                if len(blockers) >= 32:
                    break
    elif pack_id == "document-processing":
        blockers = await document_job_blockers(
            session, now=now, lease_seconds=runtime.anima_user_file_processing_lease_seconds
        )
    return {
        "schema_version": 1,
        "pack_id": pack_id,
        "source_version": sources[0].version if sources else None,
        "pack_version": (
            runtime.animama_document_pack_version
            if pack_id == "document-processing"
            else sources[0].version
            if sources
            else None
        ),
        "removable": not blockers,
        "blockers": [asdict(item) for item in sorted(blockers, key=lambda item: (item.kind, item.id))[:32]],
    }


_MAX_CREDENTIALS_BODY_BYTES = 512 * 1024
"""Room for both provider keys and 32 connection keys at the 8192-character limit."""
_CREDENTIALS_FIELDS = frozenset({"schema_version", "generation", "credentials"})


class _RefusedDelivery(Exception):
    """A refused delivery; carries only a stable code, never request content."""

    def __init__(self, status_code: int, code: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _refusal(status_code: int, code: str) -> JSONResponse:
    return JSONResponse({"detail": {"code": code}}, status_code=status_code, headers={"cache-control": "no-store"})


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise _RefusedDelivery(400, "credentials_invalid")
        result[key] = value
    return result


async def _bounded_body(request: Request) -> bytes:
    length = request.headers.get("content-length")
    if length is not None and length.isdecimal() and int(length) > _MAX_CREDENTIALS_BODY_BYTES:
        raise _RefusedDelivery(413, "credentials_too_large")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > _MAX_CREDENTIALS_BODY_BYTES:
            raise _RefusedDelivery(413, "credentials_too_large")
    return bytes(body)


def _delivery(body: bytes) -> tuple[int, dict[str, object]]:
    try:
        value = json.loads(body.decode("utf-8"), object_pairs_hook=_unique_object)
    except (ValueError, RecursionError):
        # UnicodeDecodeError and JSONDecodeError are ValueErrors whose
        # attributes hold the whole body; they are dropped here, never
        # returned, logged or re-raised.
        raise _RefusedDelivery(400, "credentials_invalid") from None
    if (
        not isinstance(value, dict)
        or set(value) != _CREDENTIALS_FIELDS
        or type(value["schema_version"]) is not int
        or value["schema_version"] != 1
        or type(value["generation"]) is not int
        or not isinstance(value["credentials"], dict)
    ):
        raise _RefusedDelivery(400, "credentials_invalid")
    return value["generation"], value["credentials"]


@router.put("/credentials", dependencies=[Depends(require_desktop_control)])
async def replace_credentials(request: Request) -> JSONResponse:
    """Replace every runtime key with Electron main's current vault contents.

    The body is ``{"schema_version": 1, "generation": N, "credentials": {name:
    value}}``; names absent from ``credentials`` are removed. Validation is
    manual rather than a Pydantic model so no error response or log can echo a
    value. Only stable codes are returned: ``credentials_media_type`` (415),
    ``credentials_too_large`` (413), ``credentials_invalid`` (400) and
    ``credentials_generation_stale`` (409).
    """

    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type != "application/json":
        return _refusal(415, "credentials_media_type")
    try:
        generation, credentials = _delivery(await _bounded_body(request))
        snapshot = runtime_credentials.replace(credentials, generation=generation)
    except _RefusedDelivery as refused:
        return _refusal(refused.status_code, refused.code)
    except CredentialStoreError as refused:
        return _refusal(409 if refused.code == "credentials_generation_stale" else 400, refused.code)
    return JSONResponse({"schema_version": 1, "generation": snapshot.generation}, headers={"cache-control": "no-store"})
