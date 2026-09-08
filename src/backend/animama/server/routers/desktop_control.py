"""Private supervisor preflights. Hono never proxies this prefix."""

import hashlib
import secrets
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.feature_pack_removal_repo import (
    content_operations_idle,
    document_job_blockers,
    included_source_blockers,
)
from animama.domain.feature_packs import FEATURE_PACK_IDS, PackRemovalBlocker
from animama.server.deps import get_async_session
from animama.server.routers.runtime_capabilities import get_runtime_settings

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
) -> dict:
    """Bounded preflight; the later drained restart repeats catalog custody checks."""

    if pack_id not in FEATURE_PACK_IDS:
        raise HTTPException(status_code=404, detail="Not Found")
    runtime = get_runtime_settings(request)
    paths = getattr(request.app.state, "local_runtime_paths", None)
    if paths is None:
        raise HTTPException(status_code=503, detail="runtime_starting")
    now = datetime.now(timezone.utc)
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
            else runtime.animama_parakeet_asset_version
            if pack_id == "parakeet-stt"
            else sources[0].version
            if sources
            else None
        ),
        "removable": not blockers,
        "blockers": [asdict(item) for item in sorted(blockers, key=lambda item: (item.kind, item.id))[:32]],
    }
